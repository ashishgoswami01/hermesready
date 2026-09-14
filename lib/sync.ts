import { chunkText, clampChunkSize } from "./chunk";
import {
  DriveError,
  allowedMimeTypes,
  downloadFile,
  listFiles,
  type DriveFile,
} from "./drive";
import { UnsupportedFile, extractTextFrom } from "./extract";
import { readSettings } from "./server-settings";
import { callEdgeFunction, supabaseAdmin } from "./supabase";

/**
 * The ingestion pass: Drive folder -> text -> chunks -> embeddings -> pgvector.
 *
 * One invocation is deliberately bounded. Serverless functions get 60 seconds,
 * and a folder of 40 PDFs takes far longer than that, so a run processes files
 * until its time budget is nearly spent and reports `hasMore`. The caller (the
 * admin dashboard or the cron route) simply calls again until `hasMore` is
 * false. That makes a big first import a series of short, resumable steps
 * instead of one request that dies at the timeout with nothing written.
 */

const EMBED_BATCH = 40;

export type FileOutcome = {
  driveFileId: string;
  name: string;
  status: "indexed" | "updated" | "failed" | "skipped" | "removed";
  chunks?: number;
  reason?: string;
};

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
  files: FileOutcome[];
  error?: string;
};

type RegistryRow = {
  drive_file_id: string;
  md5: string | null;
  modified_time: string | null;
  status: string;
};

function sourceUrl(file: DriveFile): string {
  return `https://drive.google.com/file/d/${file.id}/view`;
}

function titleOf(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || name;
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

async function indexOneFile(
  file: DriveFile,
  chunkSize: number,
  chunkOverlap: number,
): Promise<{ chunks: number; chars: number }> {
  const db = supabaseAdmin();

  const { buffer, effectiveMime } = await downloadFile(file);
  const text = await extractTextFrom(buffer, effectiveMime, file.name);

  const title = titleOf(file.name);
  const pieces = chunkText(text, chunkSize, chunkOverlap);
  if (pieces.length === 0) {
    throw new UnsupportedFile(`${file.name}: produced no usable chunks.`);
  }

  // Replace-then-insert, so re-indexing an edited file never leaves the old
  // version's chunks behind to be retrieved alongside the new ones.
  const { error: delError } = await db.rpc("delete_drive_chunks", {
    p_drive_file_id: file.id,
  });
  if (delError) throw new Error(`Couldn't clear old chunks: ${delError.message}`);

  // The leading "Product:" line gives the embedding the document's title for
  // context; kb_documents.fts strips that same line, so it can't dominate the
  // keyword half of the hybrid search.
  const chunks = pieces.map((content, i) => ({
    product: title,
    file_name: file.name,
    source_url: sourceUrl(file),
    category: "drive",
    source: "drive",
    drive_file_id: file.id,
    chunk_index: i,
    content: `Product: ${title}\n${content}`,
  }));

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    await callEdgeFunction("ingest", { chunks: chunks.slice(i, i + EMBED_BATCH) });
  }

  return { chunks: chunks.length, chars: text.length };
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
    return { ...empty, error: "No Drive folder configured — finish step 1 of the wizard first." };
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

  const { data: registryRows } = await db
    .from("kb_sources")
    .select("drive_file_id, md5, modified_time, status");
  const registry = new Map<string, RegistryRow>(
    ((registryRows ?? []) as RegistryRow[]).map((r) => [r.drive_file_id, r]),
  );

  // 1. Files deleted from Drive lose their chunks, so Hermes stops quoting them.
  const present = new Set(driveFiles.map((f) => f.id));
  for (const [id, row] of registry) {
    if (present.has(id) || row.status === "removed") continue;
    await db.rpc("delete_drive_chunks", { p_drive_file_id: id });
    await db
      .from("kb_sources")
      .update({ status: "removed", chunk_count: 0, indexed_at: new Date().toISOString() })
      .eq("drive_file_id", id);
    result.removed += 1;
    result.files.push({ driveFileId: id, name: id, status: "removed" });
  }

  // 2. Types the wizard didn't tick are recorded once, not retried every run.
  for (const file of ignored) {
    const row = registry.get(file.id);
    if (row?.status === "skipped") continue;
    await db.from("kb_sources").upsert(
      {
        drive_file_id: file.id,
        name: file.name,
        mime_type: file.mimeType,
        modified_time: file.modifiedTime,
        size_bytes: file.size ? Number(file.size) : null,
        md5: file.md5Checksum ?? null,
        status: "skipped",
        chunk_count: 0,
        error: "File type is not selected in the knowledge rules step.",
      },
      { onConflict: "drive_file_id" },
    );
  }

  // 3. Index what's new or edited, within the time budget.
  const queue = candidates.filter((f) => hasChanged(f, registry.get(f.id)));
  const chunkSize = clampChunkSize(Number(settings.chunkSize));
  const chunkOverlap = Number(settings.chunkOverlap) || 0;
  const maxFiles = opts.maxFiles ?? queue.length;
  let processed = 0;

  for (const file of queue) {
    if (processed >= maxFiles) break;
    // Stop before the timeout rather than in the middle of a file.
    if (processed > 0 && Date.now() - started > budgetMs) break;

    const isUpdate = registry.get(file.id)?.status === "indexed";
    processed += 1;

    try {
      const { chunks, chars } = await indexOneFile(file, chunkSize, chunkOverlap);

      await db.from("kb_sources").upsert(
        {
          drive_file_id: file.id,
          name: file.name,
          mime_type: file.mimeType,
          modified_time: file.modifiedTime,
          size_bytes: file.size ? Number(file.size) : null,
          md5: file.md5Checksum ?? null,
          status: "indexed",
          chunk_count: chunks,
          char_count: chars,
          error: null,
          indexed_at: new Date().toISOString(),
        },
        { onConflict: "drive_file_id" },
      );

      result.chunksAdded += chunks;
      if (isUpdate) result.updated += 1;
      else result.indexed += 1;
      result.files.push({
        driveFileId: file.id,
        name: file.name,
        status: isUpdate ? "updated" : "indexed",
        chunks,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await db.from("kb_sources").upsert(
        {
          drive_file_id: file.id,
          name: file.name,
          mime_type: file.mimeType,
          modified_time: file.modifiedTime,
          size_bytes: file.size ? Number(file.size) : null,
          md5: file.md5Checksum ?? null,
          status: e instanceof UnsupportedFile ? "skipped" : "failed",
          chunk_count: 0,
          error: reason,
        },
        { onConflict: "drive_file_id" },
      );
      result.failed += 1;
      result.files.push({
        driveFileId: file.id,
        name: file.name,
        status: e instanceof UnsupportedFile ? "skipped" : "failed",
        reason,
      });
    }
  }

  result.pending = Math.max(queue.length - processed, 0);
  result.hasMore = result.pending > 0;

  return finish(result.failed > 0 ? "partial" : "success");
}
