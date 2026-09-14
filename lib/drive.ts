import { JWT } from "google-auth-library";

/**
 * Read-only Google Drive access through a service account.
 *
 * The service account only ever sees what Ashish shares with it: he shares the
 * knowledge-bank folder with GOOGLE_SERVICE_ACCOUNT_EMAIL as Viewer, and
 * nothing else in his Drive is reachable.
 */

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const API = "https://www.googleapis.com/drive/v3";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  md5Checksum?: string;
};

export class DriveError extends Error {
  hint?: string;
  status?: number;

  constructor(message: string, hint?: string, status?: number) {
    super(message);
    this.name = "DriveError";
    this.hint = hint;
    this.status = status;
  }
}

function jwt(): JWT {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Vercel stores the PEM with literal \n, a local .env may keep real newlines.
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new DriveError(
      "Google service account is not configured.",
      "Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in the environment.",
    );
  }
  if (!key.includes("BEGIN PRIVATE KEY")) {
    throw new DriveError(
      "GOOGLE_PRIVATE_KEY doesn't look like a PEM key.",
      'Copy the whole private_key value from the service account JSON, including "-----BEGIN PRIVATE KEY-----".',
    );
  }

  return new JWT({ email, key, scopes: SCOPES });
}

async function accessToken(): Promise<string> {
  try {
    const { token } = await jwt().getAccessToken();
    if (!token) throw new Error("empty token");
    return token;
  } catch (e) {
    if (e instanceof DriveError) throw e;
    throw new DriveError(
      "Google refused the service account credentials.",
      "Check that the private key matches the service account email and that the Drive API is enabled in that Google Cloud project.",
    );
  }
}

async function driveFetch(path: string, token: string): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.ok) return res;

  const body = await res.text();
  let message = `Drive API returned ${res.status}`;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) message = parsed.error.message;
  } catch {
    /* keep the generic message */
  }

  let hint: string | undefined;
  if (res.status === 404) {
    hint =
      "Folder not found. Check the folder ID, and make sure the folder is shared with the service account email.";
  } else if (res.status === 403) {
    hint =
      "Access denied. Share the folder with the service account email as Viewer, and confirm the Drive API is enabled.";
  } else if (res.status === 401) {
    hint = "Credentials rejected — regenerate the service account key.";
  }

  throw new DriveError(message, hint, res.status);
}

/** Confirms the folder exists and the service account can see it. */
export async function getFolder(folderId: string): Promise<{ id: string; name: string }> {
  const token = await accessToken();
  const res = await driveFetch(
    `/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`,
    token,
  );
  const file = (await res.json()) as { id: string; name: string; mimeType: string };

  if (file.mimeType !== "application/vnd.google-apps.folder") {
    throw new DriveError(
      `"${file.name}" is a file, not a folder.`,
      "Open the knowledge-bank folder in Drive and copy the ID from the address bar.",
    );
  }
  return { id: file.id, name: file.name };
}

/** Every non-trashed file directly inside the folder (paginated). */
export async function listFiles(folderId: string): Promise<DriveFile[]> {
  const token = await accessToken();
  const fields = "nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum)";
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields,
      pageSize: "200",
      orderBy: "modifiedTime desc",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await driveFetch(`/files?${params.toString()}`, token);
    const page = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return files.filter((f) => f.mimeType !== "application/vnd.google-apps.folder");
}

/* ------------------------------------------------------------------
   MIME handling
   ------------------------------------------------------------------ */

export const GOOGLE_DOC = "application/vnd.google-apps.document";
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";
export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Which Drive MIME types each wizard file-type checkbox covers. */
const TYPE_MAP: Record<string, string[]> = {
  pdf: ["application/pdf"],
  docx: [DOCX, GOOGLE_DOC, "application/msword"],
  sheets: [GOOGLE_SHEET],
  slides: [GOOGLE_SLIDES],
  txt: ["text/plain", "text/markdown", "text/csv", "application/json"],
};

export function allowedMimeTypes(fileTypes: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const t of fileTypes) for (const m of TYPE_MAP[t] ?? []) allowed.add(m);
  return allowed;
}

/** Google-native files have no bytes — they must be exported to a text format. */
const EXPORT_AS: Record<string, string> = {
  [GOOGLE_DOC]: "text/plain",
  [GOOGLE_SHEET]: "text/csv",
  [GOOGLE_SLIDES]: "text/plain",
};

/** Downloads a file's bytes, exporting Google-native docs to text first. */
export async function downloadFile(
  file: DriveFile,
): Promise<{ buffer: Buffer; effectiveMime: string }> {
  const token = await accessToken();
  const exportMime = EXPORT_AS[file.mimeType];

  const path = exportMime
    ? `/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportMime)}&supportsAllDrives=true`
    : `/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`;

  const res = await driveFetch(path, token);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, effectiveMime: exportMime ?? file.mimeType };
}
