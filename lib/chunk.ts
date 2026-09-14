/**
 * Splits document text into overlapping chunks on sentence and paragraph
 * boundaries, so a chunk rarely stops mid-clause.
 *
 * Sizes are in characters. gte-small truncates at 512 tokens (roughly 2000
 * characters), so chunkSize above ~1800 silently loses the tail of every chunk;
 * clampChunkSize keeps callers out of that trap.
 */

export const MAX_EMBEDDABLE_CHARS = 1800;

export function clampChunkSize(size: number): number {
  if (!Number.isFinite(size)) return 1000;
  return Math.min(Math.max(Math.round(size), 200), MAX_EMBEDDABLE_CHARS);
}

/** Paragraph first, then sentence, then hard break — in that order. */
function splitPoints(text: string): number[] {
  const points: number[] = [];
  const re = /\n\n+|(?<=[.!?।])\s+|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) points.push(m.index + m[0].length);
  return points;
}

export function chunkText(
  text: string,
  chunkSize: number,
  overlap: number,
): string[] {
  const size = clampChunkSize(chunkSize);
  const lap = Math.min(Math.max(Math.round(overlap) || 0, 0), Math.floor(size * 0.5));

  if (text.length <= size) return text.trim() ? [text.trim()] : [];

  const breaks = splitPoints(text);
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const hardEnd = Math.min(start + size, text.length);

    // Prefer the last natural break inside the window, but only if it keeps the
    // chunk at least 40% full — otherwise a run of short lines would produce
    // dozens of tiny chunks.
    let end = hardEnd;
    if (hardEnd < text.length) {
      const floor = start + Math.floor(size * 0.4);
      for (let i = breaks.length - 1; i >= 0; i--) {
        const b = breaks[i];
        if (b <= hardEnd && b > floor) {
          end = b;
          break;
        }
      }
    }

    const piece = text.slice(start, end).trim();
    if (piece.length >= 40) chunks.push(piece);

    if (end >= text.length) break;
    start = Math.max(end - lap, start + 1);
  }

  return chunks;
}
