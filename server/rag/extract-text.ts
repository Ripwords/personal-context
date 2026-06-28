import { extname } from "node:path";
import { extractText as unpdfExtractText, getDocumentProxy } from "unpdf";

/**
 * Extract plain text from uploaded file bytes.
 *
 * Supported:
 *   - `.txt` / `.md` or any `text/*` MIME → UTF-8 decode
 *   - `.pdf` / `application/pdf` → extracted via unpdf (PDF.js)
 *
 * Throws `Error("unsupported file type")` for anything else.
 */
export async function extractText(
  filename: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<string> {
  const ext = extname(filename).toLowerCase();

  // Plain text / markdown
  if (ext === ".txt" || ext === ".md" || mimeType.startsWith("text/")) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  // PDF
  if (ext === ".pdf" || mimeType === "application/pdf") {
    const proxy = await getDocumentProxy(bytes);
    const { text } = await unpdfExtractText(proxy, { mergePages: true });
    return text;
  }

  throw new Error("unsupported file type");
}
