import type { Settings } from "./settings";

/** Browser-side wrappers around the /api routes. Server keys stay server-side. */

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 300) || `Request failed (${res.status})`);
  }
  if (!res.ok) {
    const e = body as { error?: string; hint?: string };
    throw new Error([e.error ?? `Request failed (${res.status})`, e.hint].filter(Boolean).join(" "));
  }
  return body as T;
}

export type StoredSettingsResponse = {
  settings: Settings;
  completed: number[];
  updatedAt: string | null;
};

export function fetchSettings() {
  return fetch("/api/settings", { cache: "no-store" }).then(json<StoredSettingsResponse>);
}

export function saveSettings(settings: Settings, completed: number[]) {
  return fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings, completed }),
  }).then(json<{ ok: true; updatedAt: string }>);
}

export type DriveTestResult = {
  ok: true;
  folder: { id: string; name: string };
  totalFiles: number;
  indexableFiles: number;
  ignoredTypes: string[];
  preview: Array<{
    name: string;
    mimeType: string;
    modifiedTime: string;
    sizeBytes: number | null;
  }>;
};

export function testDrive(driveFolderId: string, fileTypes: string[]) {
  return fetch("/api/drive/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ driveFolderId, fileTypes }),
  }).then(json<DriveTestResult>);
}

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
  files: Array<{
    sourceKey: string;
    name: string;
    status: string;
    chunks?: number;
    reason?: string;
  }>;
  error?: string;
};

export function runSyncPass(maxFiles?: number) {
  return fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxFiles }),
  }).then(json<SyncResult>);
}

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

export function fetchKbStatus() {
  return fetch("/api/kb/status", { cache: "no-store" }).then(json<KbStatus>);
}

export type AskResult = {
  answer: string;
  grounded: boolean;
  sources: Array<{
    product: string;
    uin: string | null;
    file_name: string | null;
    source: string;
    source_url: string | null;
    score: number;
  }>;
  product_filter: string | null;
  model: string | null;
  latency_ms: number;
};

export function ask(question: string, audience: "agent" | "customer") {
  return fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, audience }),
  }).then(json<AskResult>);
}

/* ------------------------------------------------------------------
   Uploads
   ------------------------------------------------------------------ */

export type UploadOutcome = {
  sourceKey: string;
  name: string;
  status: "indexed" | "updated" | "failed" | "skipped";
  chunks?: number;
  reason?: string;
};

/**
 * Uploads one file in three hops: ask for a signed URL, PUT the bytes straight
 * to Supabase Storage, then tell the server to index what landed.
 *
 * The middle hop bypasses the API layer on purpose — a Vercel function's
 * request body is capped at 4.5 MB, and the prospectus PDFs are bigger. Going
 * direct to Storage means file size is governed by the bucket's 50 MB limit
 * instead of a function limit.
 */
export async function uploadDocument(
  file: File,
  onStage?: (stage: "signing" | "uploading" | "indexing") => void,
): Promise<UploadOutcome> {
  onStage?.("signing");
  const signed = await fetch("/api/upload/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: file.type || undefined,
    }),
  }).then(
    json<{ sourceKey: string; storagePath: string; uploadUrl: string; mimeType: string }>,
  );

  onStage?.("uploading");
  const put = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": signed.mimeType },
    body: file,
  });
  if (!put.ok) {
    throw new Error(
      `Upload to storage failed (${put.status}). ${(await put.text()).slice(0, 200)}`,
    );
  }

  onStage?.("indexing");
  return fetch("/api/upload/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceKey: signed.sourceKey,
      storagePath: signed.storagePath,
      fileName: file.name,
      sizeBytes: file.size,
    }),
  }).then(json<UploadOutcome>);
}

export function deleteDocument(sourceKey: string) {
  return fetch("/api/kb/file", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceKey }),
  }).then(json<{ ok: true; name: string }>);
}

export function storedFileUrl(sourceKey: string) {
  return fetch(`/api/kb/file?sourceKey=${encodeURIComponent(sourceKey)}`).then(
    json<{ url: string }>,
  );
}
