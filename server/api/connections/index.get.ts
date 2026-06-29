import { defineEventHandler, createError } from "h3";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { getGoogleConnections } from "../../auth/google-credentials";
import { googleCalendar } from "../../db/schema";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });
  const db = getDb();
  const conns = await getGoogleConnections(db);

  // A Google account's primary calendar id IS its email address — use it as a
  // human-readable label (populated once the calendar has synced once).
  const primaries = await db
    .select({ accountId: googleCalendar.accountId, email: googleCalendar.calendarId })
    .from(googleCalendar)
    .where(eq(googleCalendar.primary, true));
  const emailByAccount = new Map(primaries.map((p) => [p.accountId, p.email]));

  return conns.map((c) => ({
    accountId: c.accountId,
    email: emailByAccount.get(c.accountId) ?? null,
    role: c.role,
    braindumpCalendarId: c.braindumpCalendarId,
  }));
});
