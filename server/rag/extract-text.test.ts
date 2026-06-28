import { describe, test, expect } from "bun:test";
import { extractText } from "./extract-text";

describe("extractText", () => {
  test("decodes .txt bytes to string", async () => {
    const content = "Hello, world!\nThis is a text file.";
    const bytes = new TextEncoder().encode(content);
    const result = await extractText("file.txt", "text/plain", bytes);
    expect(result).toBe(content);
  });

  test("decodes .md bytes to string", async () => {
    const content = "# Heading\n\nSome markdown content.";
    const bytes = new TextEncoder().encode(content);
    const result = await extractText("notes.md", "text/markdown", bytes);
    expect(result).toBe(content);
  });

  test("decodes text/* MIME with any extension", async () => {
    const content = "plain text content";
    const bytes = new TextEncoder().encode(content);
    const result = await extractText("data.csv", "text/csv", bytes);
    expect(result).toBe(content);
  });

  test("throws 'unsupported file type' for unknown extension and MIME", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(
      extractText("file.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes),
    ).rejects.toThrow("unsupported file type");
  });

  test("throws 'unsupported file type' for image MIME", async () => {
    const bytes = new Uint8Array([255, 216, 255]); // JPEG magic bytes
    await expect(
      extractText("photo.jpg", "image/jpeg", bytes),
    ).rejects.toThrow("unsupported file type");
  });

  test("does NOT throw 'unsupported file type' for application/pdf (routes to unpdf)", async () => {
    // Minimal valid PDF — we just assert the error is NOT "unsupported file type".
    // A corrupt PDF will throw a PDF-parsing error from unpdf, not our guard.
    const fakePdfBytes = new TextEncoder().encode("%PDF-1.4 fake");
    const rejection = extractText("doc.pdf", "application/pdf", fakePdfBytes).catch(
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    const msg = await rejection;
    expect(msg).not.toBe("unsupported file type");
  });
});
