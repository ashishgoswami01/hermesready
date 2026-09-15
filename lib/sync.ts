import { clampChunkSize } from "./chunk";
import {
  DriveError,
  allowedMimeTypes,
  downloadFile,
  listFiles,
  type DriveFile,
} from "./drive";
import {
  indexAndRecord,
  markFailed,
  removeSource,
  type IndexOutcome,
  type SourceDoc,
} from "./indexer";
import { readSettings } from "./server-settings";
import { supabaseAdmin } from "./supabase";

/**
 * The Google Drive ingestion pass. Extraction, chunking and embedding live in
 * `indexer.ts`; this file owns only what is Drive-specific — listing a folder,
 * deciding what changed, and downloading bytes.
 *
 * One invocation is deliberately bounded. Serverless functions get 60 seconds,
 * and a folder of 40 PDFs takes far longer, so a run processes files until its
 * time budget is nearly spent and reports `hasMore`. The caller (the admin
 * dashboard or the cron route) calls again until that's false. A big first
 * import therefore becomes a series of short, resumable steps instead of one
 * request that dies at the timeout with nothing written.
 */

export type SyncResult = {
  runId: number | null;
  status: "success" | "partial" | "failed";
  scanned: number;
  indexed: number;
  updated: number;
  removed: number;
  failed: number;
  chunksAdded: number;
  pending: number;
  hasMore: boolean;
  files: IndexOutcome[];
  error?: string;
};

type RegistryRow = {
  source_key: string;
  md5: string | null;
  modified_time: string | null;
  status: string;
};

function toSourceDoc(file: DriveFile): SourceDoc {
  return {
    sourceKey: file.id,
    sourceType: "drive",
    name: file.name,
    mimeType: file.mimeType,
    sourceUrl: `https://drive.google.com/file/d/${file.id}/view`,
    md5: file.md5Checksum ?? null,
    modifiedTime: file.modifiedTime,
    sizeBytes: file.size ? Number(file.size) : null,
  };
}

/** True when Drive's copy differs from what we last indexed. */
function hasChanged(file: DriveFile, row: RegistryRow | undefined): boolean {
  if (!row || row.status !== "indexed") return true;
  if (file.md5Checksum && row.md5) return file.md5Checksum !== row.md5;
  if (row.modified_time) {
    return new Date(file.modifiedTime).getTime() !== new Date(row.modified_time).getTime();
  }
  return true;
}

export async function runSync(opts: {
  trigger: "manual" | "cron" | "webhook";
  budgetMs?: number;
  maxFiles?: number;
}): Promise<SyncResult> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 45_000;
  const db = supabaseAdmin();

  const empty: SyncResult = {
    runId: null,
    status: "failed",
    scanned: 0,
    indexed: 0,
    updated: 0,
    removed: 0,
    failed: 0,
    chunksAdded: 0,
    pending: 0,
    hasMore: false,
    files: [],
  };

  const { settings } = await readSettings();
  const folderId = settings.driveFolderId?.trim();
  if (!folderId) {
    return {
      ...empty,
      error:
        "No Drive folder configured. Upload files on the knowledge page, or finish step 1 of the wizard to connect Drive.",
    };
  }

  const { data: runRow } = await db
    .from("sync_runs")
    .insert({ trigger: opts.trigger, status: "running" })
    .select("id")
    .single();
  const runId = (runRow?.id as number) ?? null;

  const result: SyncResult = { ...empty, runId, status: "success" };

  const finish = async (status: SyncResult["status"], error?: string) => {
    result.status = status;
    if (error) result.error = error;
    if (runId) {
      await db
        .from("sync_runs")
        .update({
          status,
          finished_at: new Date().toISOString(),
          files_scanned: result.scanned,
          files_indexed: result.indexed,
          files_updated: result.updated,
          files_removed: result.removed,
          files_failed: result.failed,
          chunks_added: result.chunksAdded,
          error: error ?? null,
          log: result.files,
        })
        .eq("id", runId);
    }
    return result;
  };

  let driveFiles: DriveFile[];
  try {
    driveFiles = await listFiles(folderId);
  } catch (e) {
    const message =
      e instanceof DriveError
        ? [e.message, e.hint].filter(Boolean).join(" ")
        : String(e instanceof Error ? e.message : e);
    return finish("failed", message);
  }

  const allowed = allowedMimeTypes(settings.fileTypes);
  const candidates = driveFiles.filter((f) => allowed.has(f.mimeType));
  const ignored = driveFiles.filter((f) => !allowed.has(f.mimeType));
  result.scanned = driveFiles.length;

  // Only Drive rows take part in this diff — uploaded documents are not in the
  // folder and must never be treated as deleted from it.
  const { data: registryRows } = await db
    .from("kb_sources")
    .select("source_key, md5, modified_time, status")
    .eq("source_type", "drive");
  const registry = new Map<string, RegistryRow>(
    ((registryRows ?? []) as RegistryRow[]).map((r) => [r.source_key, r]),
  );

  // 1. Files deleted from Drive lose their chunks, so Hermes stops quoting them.
  const present = new Set(driveFiles.map((f) => f.id));
  for (const [key, row] of registry) {
    if (present.has(key) || row.status === "removed") continue;
    await removeSource(key);
    result.removed += 1;
    result.files.push({ sourceKey: key, name: key, status: "removed" });
  }

  // 2. Types the wizard didn't tick are recorded once, not retried every run.
  for (const file of ignored) {
    if (registry.get(file.id)?.status === "skipped") continue;
    await markFailed(
      toSourceDoc(file),
      "File type is not selected in the knowledge rules step.",
      true,
    );
  }

  // 3. Index what's new or edited, within the time budget.
  const queue = candidates.filter((f) => hasChanged(f, registry.get(f.id)));
  const indexOpts = {
    chunkSize: clampChunkSize(Number(settings.chunkSize)),
    chunkOverlap: Number(settings.chunkOverlap) || 0,
  };
  const maxFiles = opts.maxFiles ?? queue.length;
  let processed = 0;

  for (const file of queue) {
    if (processed >= maxFiles) break;
    // Stop before the timeout rather than in the middle of a file.
    if (processed > 0 && Date.now() - started > budgetMs) break;

    const wasIndexed = registry.get(file.id)?.status === "indexed";
    const doc = toSourceDoc(file);
    processed += 1;

    let outcome: IndexOutcome;
    try {
      const { buffer, effectiveMime } = await downloadFile(file);
      // A Google Doc arrives as exported text, so the MIME the indexer sees is
      // the exported one, not the Drive one.
      outcome = await indexAndRecord(
        { ...doc, mimeType: effectiveMime },
        buffer,
        indexOpts,
        wasIndexed,
      );
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await markFailed(doc, reason);
      outcome = { sourceKey: file.id, name: file.name, status: "failed", reason };
    }

    result.files.push(outcome);
    if (outcome.status === "indexed") result.indexed += 1;
    else if (outcome.status === "updated") result.updated += 1;
    else result.failed += 1;
    result.chunksAdded += outcome.chunks ?? 0;
  }

  result.pending = Math.max(queue.length - processed, 0);
  result.hasMore = result.pending > 0;

  return finish(result.failed > 0 ? "partial" : "success");
}
