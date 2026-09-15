import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Embeds plain-text chunks with Supabase's built-in gte-small model (384 dims,
 * no external API key) and inserts them into kb_documents.
 *
 * Every ingestion path ends here — the one-off prospectus load, an admin-page
 * upload, a Drive sync. The Next.js app does the downloading, text extraction
 * and chunking; only the embedding has to happen in this runtime, because
 * Supabase.ai exists nowhere else. That is what keeps embeddings free and
 * key-less.
 */

const session = new Supabase.ai.Session("gte-small");

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Chunk = {
  product: string;
  uin?: string;
  source_url?: string;
  file_name: string;
  category?: string;
  chunk_index: number;
  content: string;
  source?: "prospectus" | "drive" | "upload";
  source_key?: string;
  has_premium_figures?: boolean;
};

// gte-small truncates past 512 tokens; refusing an over-long chunk is better
// than silently embedding only its first half.
const MAX_CHARS = 2400;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  let chunks: Chunk[];
  try {
    const body = await req.json();
    chunks = body.chunks;
    if (!Array.isArray(chunks) || chunks.length === 0) throw new Error("no chunks");
    if (chunks.length > 100) throw new Error("send at most 100 chunks per call");
    for (const c of chunks) {
      if (typeof c.content !== "string" || !c.content.trim()) {
        throw new Error("every chunk needs non-empty content");
      }
      if (c.content.length > MAX_CHARS) {
        throw new Error(
          `chunk ${c.chunk_index} of ${c.file_name} is ${c.content.length} chars; keep chunks under ${MAX_CHARS}`,
        );
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = [];
  for (const c of chunks) {
    const embedding = (await session.run(c.content, {
      mean_pool: true,
      normalize: true,
    })) as number[];
    rows.push({
      ...c,
      source: c.source ?? "prospectus",
      embedding: JSON.stringify(embedding),
    });
  }

  const { error } = await admin.from("kb_documents").insert(rows);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ inserted: rows.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
