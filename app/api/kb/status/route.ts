import { NextResponse } from "next/server";

import { readSettings, refreshIntervalMinutes } from "@/lib/server-settings";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type KbStatus = {
  driveConfigured: boolean;
  totals: {
    chunks: number;
    prospectusChunks: number;
    driveChunks: number;
    uploadChunks: number;
  };
  files: {
    total: number;
    indexed: number;
    failed: number;
    skipped: number;
    removed: number;
    pending: number;
  };
  sources: Array<{
    sourceKey: string;
    sourceType: "drive" | "upload";
    name: string;
    mimeType: string | null;
    status: string;
    chunkCount: number;
    error: string | null;
    indexedAt: string | null;
    modifiedTime: string | null;
    hasStoredCopy: boolean;
  }>;
  lastRun: {
    id: number;
    trigger: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    filesIndexed: number;
    filesUpdated: number;
    filesRemoved: number;
    filesFailed: number;
    chunksAdded: number;
    error: string | null;
  } | null;
  refreshEveryMinutes: number;
};

export async function GET() {
  try {
    const db = supabaseAdmin();
    const { settings } = await readSettings();

    const [allChunks, driveChunks, uploadChunks, sources, runs] = await Promise.all([
      db.from("kb_documents").select("*", { count: "exact", head: true }),
      db
        .from("kb_documents")
        .select("*", { count: "exact", head: true })
        .eq("source", "drive"),
      db
        .from("kb_documents")
        .select("*", { count: "exact", head: true })
        .eq("source", "upload"),
      db
        .from("kb_sources")
        .select(
          "source_key, source_type, storage_path, name, mime_type, status, chunk_count, error, indexed_at, modified_time",
        )
        .order("indexed_at", { ascending: false, nullsFirst: false })
        .limit(200),
      db
        .from("sync_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1),
    ]);

    const rows = sources.data ?? [];
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    const total = allChunks.count ?? 0;
    const drive = driveChunks.count ?? 0;
    const upload = uploadChunks.count ?? 0;
    const run = runs.data?.[0];

    const status: KbStatus = {
      driveConfigured: Boolean(settings.driveFolderId?.trim()),
      totals: {
        chunks: total,
        prospectusChunks: total - drive - upload,
        driveChunks: drive,
        uploadChunks: upload,
      },
      files: {
        total: rows.length,
        indexed: count("indexed"),
        failed: count("failed"),
        skipped: count("skipped"),
        removed: count("removed"),
        pending: count("pending"),
      },
      sources: rows.map((r) => ({
        sourceKey: r.source_key,
        sourceType: r.source_type as "drive" | "upload",
        name: r.name,
        mimeType: r.mime_type,
        status: r.status,
        chunkCount: r.chunk_count,
        error: r.error,
        indexedAt: r.indexed_at,
        modifiedTime: r.modified_time,
        hasStoredCopy: Boolean(r.storage_path),
      })),
      lastRun: run
        ? {
            id: run.id,
            trigger: run.trigger,
            status: run.status,
            startedAt: run.started_at,
            finishedAt: run.finished_at,
            filesIndexed: run.files_indexed,
            filesUpdated: run.files_updated,
            filesRemoved: run.files_removed,
            filesFailed: run.files_failed,
            chunksAdded: run.chunks_added,
            error: run.error,
          }
        : null,
      refreshEveryMinutes: refreshIntervalMinutes(settings),
    };

    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
