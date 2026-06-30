import { defineEventHandler, createError, getRouterParam } from "h3";
import { getDb } from "../../../db/client";
import { getAuthSession } from "../../../utils/session";
import { markReminderNotified } from "../../../db/queries/items";

/** Mark a reminder's notification as fired so it never double-fires. */
export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const db = getDb();
  const row = await markReminderNotified(db, id, new Date());
  if (!row) throw createError({ statusCode: 404, statusMessage: "reminder not found" });
  return { notified: true };
});
