/**
 * Split text into chunks of at most `maxChars` characters.
 *
 * Strategy:
 *   1. Split on blank lines (paragraph boundaries).
 *   2. Drop empty/whitespace-only paragraphs.
 *   3. Accumulate paragraphs (separated by "\n\n") into a current chunk
 *      as long as the chunk stays ≤ maxChars.
 *   4. When adding the next paragraph would exceed maxChars, flush the
 *      current chunk and start a new one.
 *   5. A single paragraph that already exceeds maxChars is emitted as
 *      its own chunk (no further splitting — avoids breaking words).
 */
export function chunkText(
  text: string,
  opts?: { maxChars?: number },
): string[] {
  const maxChars = opts?.maxChars ?? 2000;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current === "") {
      current = para;
    } else {
      const candidate = current + "\n\n" + para;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        chunks.push(current);
        current = para;
      }
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
