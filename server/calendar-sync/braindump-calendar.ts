// server/calendar-sync/braindump-calendar.ts
import { type Db } from "../db/client";
import { setBraindumpCalendarId } from "../auth/connections";
import { type GoogleCreds } from "../auth/google-credentials";

export type CalendarApi = {
  insert(input: { summary: string }): Promise<{ id: string }>;
};

export async function ensureBraindumpCalendar(
  db: Db,
  conn: GoogleCreds,
  api: CalendarApi,
): Promise<string> {
  if (conn.braindumpCalendarId) return conn.braindumpCalendarId;
  const created = await api.insert({ summary: "Braindump" });
  await setBraindumpCalendarId(db, conn.accountId, created.id);
  return created.id;
}
