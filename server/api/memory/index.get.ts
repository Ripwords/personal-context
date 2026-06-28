import { defineEventHandler, createError, getQuery } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { listMemories, searchMemories } from "../../db/queries/memory";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const db = getDb();
  const q = getQuery(event).q as string | undefined;
  if (q) {
    return searchMemories(db, q);
  }
  return listMemories(db);
});
