import { defineEventHandler, createError, getQuery } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { searchDocuments } from "../../db/queries/documents";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const raw = getQuery(event).q;
  const q = Array.isArray(raw) ? (raw[0] ?? "") : typeof raw === "string" ? raw : "";
  return searchDocuments(getDb(), q);
});
