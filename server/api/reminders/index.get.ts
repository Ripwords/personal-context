import { defineEventHandler, createError } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { listReminders } from "../../db/queries/items";

/** Open reminders (timed todos) for the rail + the foreground notifier. */
export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const db = getDb();
  const rows = await listReminders(db);
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    projectId: t.projectId,
    remindAt: t.remindAt!.toISOString(),
    notifiedAt: t.notifiedAt?.toISOString() ?? null,
  }));
});
