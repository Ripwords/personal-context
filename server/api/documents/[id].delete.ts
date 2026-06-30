import { defineEventHandler, createError, getRouterParam } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { deleteDocument, getDocumentById } from "../../db/queries/documents";
import { getObjectStore } from "../../storage/object-store";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const db = getDb();

  // Direct lookup — 404 if not found
  const doc = await getDocumentById(db, id);
  if (!doc) throw createError({ statusCode: 404, statusMessage: "document not found" });

  // Delete from DB (cascades to chunks)
  await deleteDocument(db, id);

  // Remove the stored original — best-effort (the store ignores missing keys).
  await getObjectStore().delete(doc.storagePath).catch(() => {});

  return { deleted: true };
});
