import { defineEventHandler, createError, getRouterParam } from "h3";
import { unlink } from "node:fs/promises";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { deleteDocument, listDocuments } from "../../db/queries/documents";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const db = getDb();

  // Find the document to get its storagePath before deleting
  const docs = await listDocuments(db);
  const doc = docs.find((d) => d.id === id);

  // Delete from DB (cascades to chunks)
  await deleteDocument(db, id);

  // Unlink the stored file — ignore ENOENT
  if (doc?.storagePath) {
    await unlink(doc.storagePath).catch((err: unknown) => {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    });
  }

  return { deleted: true };
});
