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
    driveFileId: string;
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
  configured: boolean;
  totals: { chunks: number; prospectusChunks: number; driveChunks: number };
  files: {
    total: number;
    indexed: number;
    failed: number;
    skipped: number;
    removed: number;
    pending: number;
  };
  sources: Array<{
    driveFileId: string;
    name: string;
    mimeType: string | null;
    status: string;
    chunkCount: number;
    error: string | null;
    indexedAt: string | null;
    modifiedTime: string | null;
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
