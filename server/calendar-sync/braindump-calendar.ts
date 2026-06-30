// server/calendar-sync/braindump-calendar.ts
import { type Db } from "../db/client";
import { setBraindumpCalendarId } from "../auth/connections";
import { type GoogleCreds } from "../auth/google-credentials";

export const BRAINDUMP_CALENDAR_NAME = "Braindump";

export type CalendarApi = {
  insert(input: { summary: string }): Promise<{ id: string }>;
  /**
   * List existing calendars on the account. Optional: when present we reuse a
   * pre-existing "Braindump" calendar instead of creating a duplicate (e.g. when
   * the stored braindumpCalendarId was lost, or the user made one by hand).
   */
  list?(): Promise<{ id: string; summary: string }[]>;
};

export async function ensureBraindumpCalendar(
  db: Db,
  conn: GoogleCreds,
  api: CalendarApi,
): Promise<string> {
  if (conn.braindumpCalendarId) return conn.braindumpCalendarId;

  // Reuse an existing "Braindump" calendar before creating a new one, so a lost
  // DB row (or a hand-made calendar) doesn't spawn duplicates on Google.
  if (api.list) {
    const existing = (await api.list()).find((c) => c.summary === BRAINDUMP_CALENDAR_NAME);
    if (existing) {
      await setBraindumpCalendarId(db, conn.accountId, existing.id);
      return existing.id;
    }
  }

  const created = await api.insert({ summary: BRAINDUMP_CALENDAR_NAME });
  await setBraindumpCalendarId(db, conn.accountId, created.id);
  return created.id;
}
