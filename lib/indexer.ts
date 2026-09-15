import { chunkText, clampChunkSize } from "./chunk";
import { UnsupportedFile, extractTextFrom } from "./extract";
import { callEdgeFunction, supabaseAdmin } from "./supabase";

/**
 * The one indexing pipeline: bytes -> text -> chunks -> embeddings -> pgvector.
 *
 * Nothing here knows or cares where a document came from. A Drive file, a file
 * uploaded through the admin page, and (later) a file reached over OAuth all
 * arrive as the same `SourceDoc`, so adding a way in never means rewriting
 * extraction, chunking, replacement or bookkeeping.
 */

const EMBED_BATCH = 40;

export type SourceType = "drive" | "upload";

export type SourceDoc = {
  /** Stable id for this document: a Drive file id, or `upload:<uuid>`. */
  sourceKey: string;
  sourceType: SourceType;
  name: string;
  mimeType: string;
  sourceUrl?: string | null;
  storagePath?: string | null;
  md5?: string | null;
  modifiedTime?: string | null;
  sizeBytes?: number | null;
};

export type IndexOptions = { chunkSize: number; chunkOverlap: number };

export type IndexOutcome = {
  sourceKey: string;
  name: string;
  status: "indexed" | "updated" | "failed" | "skipped" | "removed";
  chunks?: number;
  reason?: string;
};

function titleOf(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || name;
}

/** Everything kb_sources needs, whichever source type this is. */
function registryRow(doc: SourceDoc) {
  return {
    source_key: doc.sourceKey,
    source_type: doc.sourceType,
    name: doc.name,
    mime_type: doc.mimeType,
    modified_time: doc.modifiedTime ?? null,
    size_bytes: doc.sizeBytes ?? null,
    md5: doc.md5 ?? null,
    storage_path: doc.sourceType === "upload" ? (doc.storagePath ?? null) : null,
  };
}

/**
 * Extracts, chunks and embeds one document, replacing any chunks it already
 * had. Throws `UnsupportedFile` when the bytes hold no usable text — a caller
 * should record that as `skipped`, not retry it.
 */
export async function indexDocument(
  doc: SourceDoc,
  buffer: Buffer,
  opts: IndexOptions,
): Promise<{ chunks: number; chars: number }> {
  const db = supabaseAdmin();

  const text = await extractTextFrom(buffer, doc.mimeType, doc.name);
  const title = titleOf(doc.name);

  const pieces = chunkText(text, clampChunkSize(opts.chunkSize), opts.chunkOverlap);
  if (pieces.length === 0) {
    throw new UnsupportedFile(`${doc.name}: produced no usable chunks.`);
  }

  // Replace-then-insert, so re-indexing an edited file never leaves the old
  // version's chunks behind to be retrieved alongside the new ones.
  const { error: delError } = await db.rpc("delete_source_chunks", {
    p_source_key: doc.sourceKey,
  });
  if (delError) throw new Error(`Couldn't clear old chunks: ${delError.message}`);

  // The leading "Product:" line gives the embedding the document's title for
  // context; kb_documents.fts strips that same line, so it can't dominate the
  // keyword half of the hybrid search.
  const chunks = pieces.map((content, i) => ({
    product: title,
    file_name: doc.name,
    source_url: doc.sourceUrl ?? null,
    category: doc.sourceType,
    source: doc.sourceType,
    source_key: doc.sourceKey,
    chunk_index: i,
    content: `Product: ${title}\n${content}`,
  }));

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    await callEdgeFunction("ingest", { chunks: chunks.slice(i, i + EMBED_BATCH) });
  }

  return { chunks: chunks.length, chars: text.length };
}

export async function markIndexed(
  doc: SourceDoc,
  chunks: number,
  chars: number,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("kb_sources")
    .upsert(
      {
        ...registryRow(doc),
        status: "indexed",
        chunk_count: chunks,
        char_count: chars,
        error: null,
        indexed_at: new Date().toISOString(),
      },
      { onConflict: "source_key" },
    );
  if (error) throw new Error(`Couldn't record the indexed file: ${error.message}`);
}

export async function markFailed(
  doc: SourceDoc,
  reason: string,
  skipped = false,
): Promise<void> {
  await supabaseAdmin()
    .from("kb_sources")
    .upsert(
      {
        ...registryRow(doc),
        status: skipped ? "skipped" : "failed",
        chunk_count: 0,
        error: reason,
      },
      { onConflict: "source_key" },
    );
}

/** Drops a document's chunks and marks it removed, keeping the audit row. */
export async function removeSource(sourceKey: string): Promise<void> {
  const db = supabaseAdmin();
  await db.rpc("delete_source_chunks", { p_source_key: sourceKey });
  await db
    .from("kb_sources")
    .update({ status: "removed", chunk_count: 0, indexed_at: new Date().toISOString() })
    .eq("source_key", sourceKey);
}

/**
 * Runs one document all the way through and records the result instead of
 * throwing, so a batch keeps going when a single file is unreadable.
 */
export async function indexAndRecord(
  doc: SourceDoc,
  buffer: Buffer,
  opts: IndexOptions,
  wasIndexed = false,
): Promise<IndexOutcome> {
  try {
    const { chunks, chars } = await indexDocument(doc, buffer, opts);
    await markIndexed(doc, chunks, chars);
    return {
      sourceKey: doc.sourceKey,
      name: doc.name,
      status: wasIndexed ? "updated" : "indexed",
      chunks,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const skipped = e instanceof UnsupportedFile;
    await markFailed(doc, reason, skipped);
    return {
      sourceKey: doc.sourceKey,
      name: doc.name,
      status: skipped ? "skipped" : "failed",
      reason,
    };
  }
}
