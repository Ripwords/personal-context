import { defineEventHandler, createError, readMultipartFormData } from "h3";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { createDocumentWithChunks } from "../../db/queries/documents";
import { extractText } from "../../rag/extract-text";
import { chunkText } from "../../rag/chunk";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const UPLOADS_DIR = "./uploads";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const parts = await readMultipartFormData(event);
  if (!parts || parts.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "no file uploaded" });
  }

  // Find the first part that has a filename (the file field)
  const filePart = parts.find((p) => p.filename !== undefined && p.filename !== "");
  if (!filePart) {
    throw createError({ statusCode: 400, statusMessage: "no file part found in upload" });
  }

  const bytes = filePart.data;
  if (bytes.length > MAX_SIZE_BYTES) {
    throw createError({ statusCode: 400, statusMessage: "file exceeds 10 MB limit" });
  }

  // Derive a safe filename (strip path separators)
  const rawName = filePart.filename!;
  const safeName = rawName.replace(/[/\\]/g, "_");
  const mimeType = filePart.type ?? "application/octet-stream";

  // Extract text — 400 on unsupported type
  let text: string;
  try {
    text = await extractText(safeName, mimeType, new Uint8Array(bytes));
  } catch (err) {
    if (err instanceof Error && err.message === "unsupported file type") {
      throw createError({ statusCode: 400, statusMessage: "unsupported file type" });
    }
    throw err;
  }

  // Write to ./uploads/<uuid>-<safeName>
  await mkdir(UPLOADS_DIR, { recursive: true });
  const storageFilename = `${crypto.randomUUID()}-${safeName}`;
  const storagePath = join(UPLOADS_DIR, storageFilename);

  await Bun.write(storagePath, bytes);

  // Chunk and store — unlink the file if the DB call fails to avoid orphans
  const chunks = chunkText(text);
  let result: { documentId: string; chunks: number };
  try {
    result = await createDocumentWithChunks(
      getDb(),
      {
        filename: safeName,
        mimeType,
        sizeBytes: bytes.length,
        storagePath,
      },
      chunks,
    );
  } catch (err) {
    await unlink(storagePath).catch(() => {});
    throw err;
  }

  return {
    documentId: result.documentId,
    filename: safeName,
    chunks: result.chunks,
  };
});
