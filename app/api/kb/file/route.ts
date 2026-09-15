import { NextResponse } from "next/server";

import { removeSource } from "@/lib/indexer";
import { deleteFromStorage, signedDownloadUrl } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A short-lived link to the stored original, so the admin page can open it. */
export async function GET(req: Request) {
  const sourceKey = new URL(req.url).searchParams.get("sourceKey");
  if (!sourceKey) {
    return NextResponse.json({ error: "sourceKey is required." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("kb_sources")
    .select("storage_path, source_type")
    .eq("source_key", sourceKey)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.storage_path) {
    return NextResponse.json(
      { error: "That file has no stored copy — Drive files open in Drive." },
      { status: 404 },
    );
  }

  const url = await signedDownloadUrl(data.storage_path);
  if (!url) return NextResponse.json({ error: "Couldn't sign a link." }, { status: 500 });
  return NextResponse.json({ url });
}

/**
 * Un-indexes a document: chunks go first, then the stored object.
 *
 * Order matters. Chunks are what Hermes can quote, so they must stop being
 * retrievable even if removing the object afterwards fails.
 */
export async function DELETE(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { sourceKey?: string };
    const sourceKey = String(body.sourceKey ?? "");
    if (!sourceKey) {
      return NextResponse.json({ error: "sourceKey is required." }, { status: 400 });
    }

    const db = supabaseAdmin();
    const { data: row } = await db
      .from("kb_sources")
      .select("storage_path, source_type, name")
      .eq("source_key", sourceKey)
      .maybeSingle();

    await removeSource(sourceKey);

    if (row?.source_type === "upload" && row.storage_path) {
      await deleteFromStorage(row.storage_path);
      // The audit row has served its purpose for an upload — there is no folder
      // to keep diffing it against, unlike a Drive file.
      await db.from("kb_sources").delete().eq("source_key", sourceKey);
    }

    return NextResponse.json({ ok: true, name: row?.name ?? sourceKey });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
