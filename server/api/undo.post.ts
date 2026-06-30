import { defineEventHandler, createError } from "h3";
import { getDb } from "../db/client";
import { getAuthSession } from "../utils/session";
import { undoLastActivity } from "../db/queries/undo";
import { makeGoogleMutationDeps } from "../calendar-sync/mutation-deps";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const db = getDb();
  // Best-effort: if the undone item was mirrored to Google, delete it there too.
  const { deleteFromGoogle } = makeGoogleMutationDeps(db, process.env);
  return undoLastActivity(db, { deleteFromGoogle });
});
