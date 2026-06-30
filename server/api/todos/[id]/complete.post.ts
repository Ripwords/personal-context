import { defineEventHandler, createError, getRouterParam, readBody } from "h3";
import { getDb } from "../../../db/client";
import { getAuthSession } from "../../../utils/session";
import { completeTodo, reopenTodo, logActivity } from "../../../db/queries/items";

/**
 * Toggle a todo's completion. POST with `{ done: false }` reopens it; default
 * (or `{ done: true }`) marks it complete. Logs an activity row so completion is
 * visible in the feed and reversible.
 */
export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const body = await readBody<{ done?: boolean }>(event).catch(() => ({}) as { done?: boolean });
  const done = body?.done !== false; // default: complete

  const db = getDb();
  const row = done ? await completeTodo(db, id) : await reopenTodo(db, id);
  if (!row) throw createError({ statusCode: 404, statusMessage: "todo not found" });

  await logActivity(db, {
    action: done ? "complete" : "reopen",
    entityType: "todo",
    entityId: id,
  });

  return { status: row.status };
});
