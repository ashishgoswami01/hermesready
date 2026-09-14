import { DOCX } from "./drive";

/**
 * Turns a downloaded file's bytes into clean plain text.
 *
 * Anything this can't read is reported as unsupported rather than indexed as
 * garbage — a chunk of binary noise in the knowledge bank is worse than a
 * missing file, because it can still win a retrieval.
 */

export class UnsupportedFile extends Error {}

const TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
]);

/** Collapses the whitespace soup that PDF extraction produces. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    // de-hyphenate words split across a line break
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fromPdf(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

async function fromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

export async function extractTextFrom(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  let raw: string;

  if (mimeType === "application/pdf") {
    raw = await fromPdf(buffer);
  } else if (mimeType === DOCX) {
    raw = await fromDocx(buffer);
  } else if (TEXT_MIMES.has(mimeType) || mimeType.startsWith("text/")) {
    raw = buffer.toString("utf8");
  } else {
    throw new UnsupportedFile(
      `${fileName}: ${mimeType} can't be read as text. Convert it to PDF, DOCX or a Google Doc.`,
    );
  }

  const text = cleanText(raw);

  if (text.length < 120) {
    throw new UnsupportedFile(
      `${fileName}: almost no text found (${text.length} characters). If it's a scanned PDF it needs OCR before indexing.`,
    );
  }
  return text;
}
