import { NextResponse } from "next/server";

import { DriveError, allowedMimeTypes, getFolder, listFiles } from "@/lib/drive";
import { DEFAULTS } from "@/lib/settings";
import { readSettings } from "@/lib/server-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The real connection check the wizard's step 1 used to fake: authenticates as
 * the service account, resolves the folder, and reports exactly what Hermes
 * would index — so a wrong folder or a missing share shows up here rather than
 * as an empty knowledge bank later.
 */
export async function POST(req: Request) {
  let folderId = "";
  let fileTypes: string[] = DEFAULTS.fileTypes;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      driveFolderId?: string;
      fileTypes?: string[];
    };
    folderId = String(body.driveFolderId ?? "").trim();
    if (Array.isArray(body.fileTypes) && body.fileTypes.length) fileTypes = body.fileTypes;

    if (!folderId) {
      const stored = await readSettings();
      folderId = stored.settings.driveFolderId.trim();
      fileTypes = stored.settings.fileTypes;
    }
    if (!folderId) {
      return NextResponse.json({ ok: false, error: "Enter a Drive folder ID first." }, { status: 400 });
    }

    const folder = await getFolder(folderId);
    const files = await listFiles(folderId);
    const allowed = allowedMimeTypes(fileTypes);

    const indexable = files.filter((f) => allowed.has(f.mimeType));
    const ignoredTypes = [
      ...new Set(files.filter((f) => !allowed.has(f.mimeType)).map((f) => f.mimeType)),
    ];

    return NextResponse.json({
      ok: true,
      folder,
      totalFiles: files.length,
      indexableFiles: indexable.length,
      ignoredTypes,
      preview: indexable.slice(0, 8).map((f) => ({
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        sizeBytes: f.size ? Number(f.size) : null,
      })),
    });
  } catch (e) {
    if (e instanceof DriveError) {
      return NextResponse.json(
        { ok: false, error: e.message, hint: e.hint },
        { status: e.status && e.status < 500 ? 400 : 502 },
      );
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
