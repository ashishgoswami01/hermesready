import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";

import { chunkText, clampChunkSize, MAX_EMBEDDABLE_CHARS } from "../lib/chunk";
import { extractTextFrom, cleanText, UnsupportedFile } from "../lib/extract";
import { allowedMimeTypes } from "../lib/drive";
import { sanitizeSettings, refreshIntervalMinutes } from "../lib/server-settings";
import { DEFAULTS, validateStep, parseNumbers } from "../lib/settings";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

console.log("\nchunk.ts");

ok("clamps chunk size to the embedding limit", () => {
  assert.equal(clampChunkSize(4000), MAX_EMBEDDABLE_CHARS);
  assert.equal(clampChunkSize(50), 200);
  assert.equal(clampChunkSize(1000), 1000);
  assert.equal(clampChunkSize(Number.NaN), 1000);
});

const prose = Array.from(
  { length: 60 },
  (_, i) =>
    `Clause ${i + 1}. The waiting period for specified diseases is twenty four months from the date of inception of the first policy. This condition applies to each insured person separately.`,
).join(" ");

ok("no chunk exceeds the requested size", () => {
  for (const size of [200, 400, 800, 1200, 1800]) {
    for (const c of chunkText(prose, size, 100)) {
      assert.ok(c.length <= size, `chunk of ${c.length} exceeds ${size}`);
    }
  }
});

ok("chunks cover the whole document", () => {
  const chunks = chunkText(prose, 600, 120);
  // Every clause number must survive somewhere in the output.
  const joined = chunks.join(" ");
  for (let i = 1; i <= 60; i++) {
    assert.ok(joined.includes(`Clause ${i}.`), `Clause ${i} was dropped`);
  }
});

ok("consecutive chunks actually overlap", () => {
  const chunks = chunkText(prose, 600, 150);
  assert.ok(chunks.length > 2);
  let overlapping = 0;
  for (let i = 1; i < chunks.length; i++) {
    const tail = chunks[i - 1].slice(-60);
    if (chunks[i].includes(tail.slice(-25))) overlapping += 1;
  }
  assert.ok(overlapping > 0, "no overlap found between any pair of chunks");
});

ok("short text stays a single chunk", () => {
  assert.deepEqual(chunkText("Only one short line.", 1000, 100), ["Only one short line."]);
});

ok("empty text yields no chunks", () => {
  assert.deepEqual(chunkText("   \n  ", 1000, 100), []);
});

ok("overlap larger than the chunk cannot stall the loop", () => {
  const chunks = chunkText(prose, 300, 5000);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 300);
});

console.log("\nextract.ts");

ok("cleanText de-hyphenates and collapses whitespace", () => {
  assert.equal(cleanText("wait-\ning   period\n\n\n\nhere"), "waiting period\n\nhere");
});

// Point PDF_FIXTURE at any text-bearing PDF to exercise the real extractor.
const fixture = process.env.PDF_FIXTURE;
if (fixture && existsSync(fixture)) {
  const pdfText = await extractTextFrom(readFileSync(fixture), "application/pdf", "fixture.pdf");

  ok("reads a real PDF", () => {
    assert.ok(pdfText.length > 500, `only got ${pdfText.length} chars`);
    assert.ok(/[a-z]{4,}/.test(pdfText), "no words came out");
  });

  ok("chunks the extracted PDF within limits", () => {
    const chunks = chunkText(pdfText, 900, 120);
    assert.ok(chunks.length >= 2, `expected several chunks, got ${chunks.length}`);
    for (const c of chunks) assert.ok(c.length <= 900);
  });
} else {
  console.log("  --  PDF extraction (set PDF_FIXTURE=<file.pdf> to run)");
}

ok("plain text passes through", async () => {
  const text = await extractTextFrom(
    Buffer.from("Product: X\n" + "policy detail ".repeat(30)),
    "text/plain",
    "a.txt",
  );
  assert.ok(text.startsWith("Product: X"));
});

ok("rejects a binary type it cannot read", async () => {
  await assert.rejects(
    () => extractTextFrom(Buffer.from([0, 1, 2]), "application/zip", "a.zip"),
    UnsupportedFile,
  );
});

ok("rejects a file with no text layer", async () => {
  await assert.rejects(
    () => extractTextFrom(Buffer.from("tiny"), "text/plain", "a.txt"),
    UnsupportedFile,
  );
});

console.log("\ndrive.ts");

ok("wizard file types map to Drive MIME types", () => {
  const all = allowedMimeTypes(["pdf", "docx", "sheets", "slides", "txt"]);
  assert.ok(all.has("application/pdf"));
  assert.ok(all.has("application/vnd.google-apps.document"));
  assert.ok(all.has("application/vnd.google-apps.spreadsheet"));
  assert.ok(all.has("text/plain"));

  const pdfOnly = allowedMimeTypes(["pdf"]);
  assert.ok(pdfOnly.has("application/pdf"));
  assert.ok(!pdfOnly.has("application/vnd.google-apps.document"));
  assert.equal(allowedMimeTypes([]).size, 0);
});

console.log("\nserver-settings.ts");

ok("sanitize drops unknown keys and wrong types", () => {
  const out = sanitizeSettings({
    driveFolderId: "1AbCDefGHIjklMNOpqrsTuvWxyz",
    chunkSize: 900,
    fileTypes: ["pdf", 42, "txt"],
    humanHandoff: "yes",
    evil: "DROP TABLE",
  });
  assert.equal(out.driveFolderId, "1AbCDefGHIjklMNOpqrsTuvWxyz");
  assert.equal(out.chunkSize, "900", "numeric chunkSize should coerce to string");
  assert.deepEqual(out.fileTypes, ["pdf", "txt"]);
  assert.equal(out.humanHandoff, DEFAULTS.humanHandoff, "non-boolean should fall back");
  assert.ok(!("evil" in out));
});

ok("refresh interval follows the wizard setting", () => {
  assert.equal(refreshIntervalMinutes({ ...DEFAULTS, updateFrequency: "realtime" }), 15);
  assert.equal(refreshIntervalMinutes({ ...DEFAULTS, updateFrequency: "hourly" }), 60);
  assert.equal(refreshIntervalMinutes({ ...DEFAULTS, updateFrequency: "daily" }), 1440);
});

console.log("\nsettings.ts validation");

ok("chunk size above the embedding limit is now rejected", () => {
  const errs = validateStep(2, { ...DEFAULTS, chunkSize: "3000" });
  assert.ok(errs.chunkSize, "3000 should be rejected");
  assert.ok(!validateStep(2, { ...DEFAULTS, chunkSize: "1800" }).chunkSize);
  assert.ok(!validateStep(2, { ...DEFAULTS, chunkSize: "1000" }).chunkSize);
});

ok("overlap must be smaller than chunk size", () => {
  assert.ok(validateStep(2, { ...DEFAULTS, chunkSize: "500", chunkOverlap: "500" }).chunkOverlap);
});

ok("number lists parse and flag bad lines", () => {
  const r = parseNumbers("919876543210 - VIP\n12345\n+91 98765 43211");
  assert.deepEqual(r.valid, ["919876543210", "919876543211"]);
  assert.equal(r.invalid.length, 1);
});

ok("step 1 rejects a folder id that is too short", () => {
  assert.ok(validateStep(1, { ...DEFAULTS, driveFolderId: "abc", serviceAccount: "a@b.co" }).driveFolderId);
  assert.ok(
    !validateStep(1, {
      ...DEFAULTS,
      driveFolderId: "1AbCDefGHIjklMNOpqrsTuvWxyz",
      serviceAccount: "hermes@p.iam.gserviceaccount.com",
    }).driveFolderId,
  );
});

console.log(`\n${pass} checks passed\n`);

console.log("\nregression — spaced Indian numbers");

ok("common paste formats all parse", () => {
  const r = parseNumbers(
    [
      "919876543210 - VIP",
      "+91 98765 43211",
      "98765 43212",
      "9876-543-213",
      "919876543214 SM Jodhpur",
      "12345",
      "hello",
    ].join("\n"),
  );
  assert.deepEqual(r.valid, [
    "919876543210",
    "919876543211",
    "9876543212",
    "9876543213",
    "919876543214",
  ]);
  assert.deepEqual(r.invalid, ["12345", "hello"]);
});
