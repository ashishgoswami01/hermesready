import { NextResponse } from "next/server";

import { clampChunkSize } from "@/lib/chunk";
import { indexAndRecord, type SourceDoc } from "@/lib/indexer";
import { readSettings } from "@/lib/server-settings";
import { deleteFromStorage, downloadFromStorage, mimeForFile } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Step 2 of an upload: the file is already in Storage, so read it back, extract
 * the text, chunk it and embed it.
 *
 * A file whose text can't be read is deleted from Storage again rather than
 * left sitting there — an un-indexable object in the bucket is dead weight, and
 * keeping it would make the file counts on the dashboard lie.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      sourceKey?: string;
      storagePath?: string;
      fileName?: string;
      sizeBytes?: number;
    };

    const sourceKey = String(body.sourceKey ?? "");
    const storagePath = String(body.storagePath ?? "");
    const fileName = String(body.fileName ?? "").trim();

    if (!sourceKey.startsWith("upload:") || !storagePath || !fileName) {
      return NextResponse.json(
        { error: "sourceKey, storagePath and fileName are all required." },
        { status: 400 },
      );
    }
    // The signed URL decided the path; refuse a mismatched pair so one upload
    // can't be pointed at another document's key.
    if (!storagePath.startsWith(`${sourceKey.slice("upload:".length)}/`)) {
      return NextResponse.json(
        { error: "storagePath doesn't belong to this sourceKey." },
        { status: 400 },
      );
    }

    const mimeType = mimeForFile(fileName);
    if (!mimeType) {
      return NextResponse.json({ error: `Unsupported file type: ${fileName}` }, { status: 415 });
    }

    const { settings } = await readSettings();
    const wasIndexed = Boolean(
      (
        await supabaseAdmin()
          .from("kb_sources")
          .select("status")
          .eq("source_key", sourceKey)
          .maybeSingle()
      ).data?.status === "indexed",
    );

    const doc: SourceDoc = {
      sourceKey,
      sourceType: "upload",
      name: fileName,
      mimeType,
      storagePath,
      sizeBytes: Number(body.sizeBytes) || null,
      modifiedTime: new Date().toISOString(),
    };

    const buffer = await downloadFromStorage(storagePath);

    const outcome = await indexAndRecord(
      doc,
      buffer,
      {
        chunkSize: clampChunkSize(Number(settings.chunkSize)),
        chunkOverlap: Number(settings.chunkOverlap) || 0,
      },
      wasIndexed,
    );

    if (outcome.status === "failed" || outcome.status === "skipped") {
      await deleteFromStorage(storagePath);
      return NextResponse.json(outcome, { status: 422 });
    }

    return NextResponse.json(outcome);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
