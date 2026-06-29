import { defineEventHandler, createError } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { listCalendars } from "../../db/queries/calendars";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const db = getDb();
  const cals = await listCalendars(db);
  return cals.map((c) => ({
    id: c.id,
    accountId: c.accountId,
    summary: c.summary,
    color: c.backgroundColor,
    selected: c.selected,
    primary: c.primary,
  }));
});
