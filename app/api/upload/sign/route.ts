import { NextResponse } from "next/server";

import {
  MAX_UPLOAD_BYTES,
  UPLOAD_MIME_TYPES,
  createSignedUpload,
  mimeForFile,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 1 of an upload: mint a short-lived signed URL the browser posts the
 * file to directly.
 *
 * The bytes never pass through this function, which is the point — a Vercel
 * request body is capped at 4.5 MB and the prospectus PDFs are larger. Only
 * the file's name and size are checked here.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      fileName?: string;
      sizeBytes?: number;
      mimeType?: string;
    };

    const fileName = String(body.fileName ?? "").trim();
    if (!fileName) {
      return NextResponse.json({ error: "fileName is required." }, { status: 400 });
    }

    const mimeType = mimeForFile(fileName, body.mimeType);
    if (!mimeType) {
      return NextResponse.json(
        {
          error: `Can't read "${fileName}". Supported: ${Object.keys(UPLOAD_MIME_TYPES).join(", ")}.`,
        },
        { status: 415 },
      );
    }

    const sizeBytes = Number(body.sizeBytes ?? 0);
    if (sizeBytes > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `"${fileName}" is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        },
        { status: 413 },
      );
    }

    const pending = await createSignedUpload(fileName);

    // The signed URL is safe to hand to the browser: that is what it is for,
    // it is one-shot, short-lived, and scoped to this one object path.
    return NextResponse.json({
      sourceKey: pending.sourceKey,
      storagePath: pending.storagePath,
      uploadUrl: pending.url,
      mimeType,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
