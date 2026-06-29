// server/calendar-sync/sync-events.ts
import { eq } from "drizzle-orm";
import { type Db } from "../db/client";
import { events, googleCalendar, type NewEventRow } from "../db/schema";
import type { GoogleCreds } from "../auth/google-credentials";

export type RawGoogleEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export type RawGoogleCalendar = {
  id: string;
  summary?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  selected?: boolean;
  primary?: boolean;
};

export type EventsApi = {
  list(input: {
    accessToken: string;
    calendarId: string;
    timeMin: string;
    timeMax: string;
  }): Promise<RawGoogleEvent[]>;
};

export type CalendarListApi = {
  list(input: { accessToken: string }): Promise<RawGoogleCalendar[]>;
};

function pickTime(slot?: { dateTime?: string; date?: string }): Date | null {
  if (!slot) return null;
  const iso = slot.dateTime ?? slot.date;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normalizeEvent(
  raw: RawGoogleEvent,
  googleAccountId: string,
  calendarId = "primary",
): NewEventRow | null {
  const startsAt = pickTime(raw.start);
  const endsAt = pickTime(raw.end);
  if (!startsAt || !endsAt) return null;
  // Google all-day events carry `start.date` (no `start.dateTime`).
  const allDay = !raw.start?.dateTime && !!raw.start?.date;
  return {
    title: raw.summary ?? "(no title)",
    startsAt,
    endsAt,
    googleEventId: raw.id,
    googleAccountId,
    calendarId,
    allDay,
    syncStatus: "synced",
  };
}

export async function syncConnectionEvents(
  db: Db,
  conn: GoogleCreds,
  accessToken: string,
  api: EventsApi,
  from: Date,
  to: Date,
  calendarId = "primary",
): Promise<number> {
  const raw = await api.list({
    accessToken,
    calendarId,
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
  });
  const rows = raw
    .map((e) => normalizeEvent(e, conn.accountId, calendarId))
    .filter((r): r is NewEventRow => r !== null);
  if (rows.length === 0) return 0;

  // node-postgres supports interactive transactions — wrap the upserts so a
  // sync either fully lands or rolls back.
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .insert(events)
        .values(row)
        .onConflictDoUpdate({
          target: [events.googleAccountId, events.googleEventId],
          set: {
            title: row.title,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            calendarId: row.calendarId,
            allDay: row.allDay,
            syncStatus: "synced",
          },
        });
    }
  });
  return rows.length;
}

/**
 * Discover all of an account's calendars (storing each calendar's color and the
 * user's show/hide preference), then sync events from every `selected` calendar.
 * Returns the total number of events synced across calendars.
 */
export async function syncAllCalendars(
  db: Db,
  conn: GoogleCreds,
  accessToken: string,
  calListApi: CalendarListApi,
  eventsApi: EventsApi,
  from: Date,
  to: Date,
): Promise<number> {
  const calendars = await calListApi.list({ accessToken });

  for (const cal of calendars) {
    // Upsert calendar metadata. Preserve the user's `selected` toggle on
    // conflict (only seed it from Google on first insert).
    await db
      .insert(googleCalendar)
      .values({
        accountId: conn.accountId,
        calendarId: cal.id,
        summary: cal.summary ?? cal.id,
        backgroundColor: cal.backgroundColor ?? null,
        foregroundColor: cal.foregroundColor ?? null,
        selected: cal.selected ?? true,
        primary: cal.primary ?? false,
      })
      .onConflictDoUpdate({
        target: [googleCalendar.accountId, googleCalendar.calendarId],
        set: {
          summary: cal.summary ?? cal.id,
          backgroundColor: cal.backgroundColor ?? null,
          foregroundColor: cal.foregroundColor ?? null,
          primary: cal.primary ?? false,
        },
      });
  }

  // Only sync events from calendars the user keeps visible.
  const visible = await db
    .select()
    .from(googleCalendar)
    .where(eq(googleCalendar.accountId, conn.accountId));
  const visibleIds = new Set(visible.filter((c) => c.selected).map((c) => c.calendarId));

  let total = 0;
  for (const cal of calendars) {
    if (!visibleIds.has(cal.id)) continue;
    total += await syncConnectionEvents(db, conn, accessToken, eventsApi, from, to, cal.id);
  }
  return total;
}
