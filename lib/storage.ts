import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "./supabase";

/**
 * Uploaded documents live in the private `knowledge` bucket.
 *
 * The browser uploads straight to Supabase Storage using a short-lived signed
 * URL, never through a Next.js route: a Vercel function's request body is
 * capped at 4.5 MB, and Star's prospectus PDFs are bigger than that. The
 * signed URL sidesteps the API layer entirely, so file size stops being a
 * function-limit problem.
 */

export const BUCKET = "knowledge";

export const UPLOAD_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Keeps a stored name safe for a URL path without losing recognisability. */
export function safeName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(0, 120) || "document";
}

export function mimeForFile(name: string, declared?: string | null): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const byExt = UPLOAD_MIME_TYPES[ext];
  if (byExt) return byExt;
  // Trust a declared type only if it is one the bucket accepts.
  if (declared && Object.values(UPLOAD_MIME_TYPES).includes(declared)) return declared;
  return null;
}

export type PendingUpload = {
  sourceKey: string;
  storagePath: string;
  token: string;
  url: string;
};

/**
 * Mints a one-shot upload URL. The source key is decided here rather than by
 * the browser, so a client can't overwrite another document's chunks by
 * claiming its key.
 */
export async function createSignedUpload(fileName: string): Promise<PendingUpload> {
  const id = randomUUID();
  const storagePath = `${id}/${safeName(fileName)}`;

  const { data, error } = await supabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    throw new Error(`Couldn't create an upload URL: ${error?.message ?? "unknown error"}`);
  }

  return {
    sourceKey: `upload:${id}`,
    storagePath,
    token: data.token,
    url: data.signedUrl,
  };
}

export async function downloadFromStorage(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Couldn't read the uploaded file: ${error?.message ?? "not found"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteFromStorage(storagePath: string): Promise<void> {
  // A failed remove shouldn't block un-indexing: the chunks matter more than
  // the orphaned object, and the storage path stays on the row either way.
  await supabaseAdmin().storage.from(BUCKET).remove([storagePath]);
}

/** Signed download link so the admin page can open what was uploaded. */
export async function signedDownloadUrl(
  storagePath: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  return data?.signedUrl ?? null;
}
