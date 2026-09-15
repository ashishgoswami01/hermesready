import { readFileSync } from "node:fs";

import { chunkText, clampChunkSize } from "../lib/chunk";
import { extractTextFrom } from "../lib/extract";

/**
 * End-to-end exercise of the upload pipeline against the live Supabase project,
 * using the anon key (which is all the Edge Functions need).
 *
 * This runs the real extraction and chunking code, pushes the chunks through
 * the real `ingest` function, then asks a question through the real `answer`
 * function and checks the uploaded document is what comes back.
 */

const URL = "https://jvyxyajucqygywigyftt.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY!;
const SOURCE_KEY = "upload:e2e-test-onboarding";
const FILE_NAME = "Agent Onboarding Checklist - Jodhpur Zone.pdf";

async function fn<T>(slug: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${URL}/functions/v1/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures += 1;
}

// --- 1. Extract and chunk, exactly as indexDocument does -------------------
const buffer = readFileSync("/tmp/onboarding.pdf");
const text = await extractTextFrom(buffer, "application/pdf", FILE_NAME);
const title = FILE_NAME.replace(/\.[a-z0-9]{1,5}$/i, "");
const pieces = chunkText(text, clampChunkSize(1000), 120);

console.log("\n1. extraction & chunking");
check("PDF text extracted", text.length > 1500, `${text.length} chars`);
check("pass mark survived extraction", text.includes("twenty eight"));
check("chunks produced", pieces.length >= 2, `${pieces.length} chunks`);
check(
  "every chunk within the embedding limit",
  pieces.every((p) => p.length <= 1000),
  `max ${Math.max(...pieces.map((p) => p.length))}`,
);

const chunks = pieces.map((content, i) => ({
  product: title,
  file_name: FILE_NAME,
  source_url: null,
  category: "upload",
  source: "upload" as const,
  source_key: SOURCE_KEY,
  chunk_index: i,
  content: `Product: ${title}\n${content}`,
}));

// --- 2. Embed through the real ingest function -----------------------------
console.log("\n2. ingest (gte-small embeddings)");
const ingested = await fn<{ inserted?: number; error?: string }>("ingest", { chunks });
check(
  "ingest accepted the upload-shaped chunks",
  ingested.status === 200,
  ingested.data.error ?? `inserted ${ingested.data.inserted}`,
);
check("all chunks inserted", ingested.data.inserted === chunks.length);

// --- 3. Retrieve through the real answer function ---------------------------
console.log("\n3. retrieval & attribution");

type AnswerBody = {
  sources?: Array<{ product: string; file_name: string | null; source: string }>;
  answer?: string;
  error?: string;
  retrieval_only?: boolean;
};

const asked = await fn<AnswerBody>("answer", {
  question: "Agent onboarding assessment ka pass mark kitna hai aur kitne attempts milte hain?",
});

const sources = asked.data.sources ?? [];
check("answer function responded", asked.status === 200 || asked.status === 503, `HTTP ${asked.status}`);
check("retrieval returned chunks", sources.length > 0, `${sources.length} sources`);
check(
  "the uploaded document is the top source",
  sources[0]?.source === "upload" && sources[0]?.file_name === FILE_NAME,
  `top = ${sources[0]?.file_name} (${sources[0]?.source})`,
);

// A question about a prospectus must still reach the prospectus corpus — the
// upload must not crowd out the 3,575 chunks that were already there.
const control = await fn<AnswerBody>("answer", {
  question: "Star Comprehensive mein pre-existing disease ka waiting period kitna hai?",
});
const controlSources = control.data.sources ?? [];
check(
  "prospectus questions still hit the prospectus corpus",
  controlSources[0]?.source === "prospectus",
  `top = ${controlSources[0]?.product} (${controlSources[0]?.source})`,
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
