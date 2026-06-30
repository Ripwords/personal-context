// server/calendar-sync/sync-events.ts
import { and, eq, gte, isNotNull, lt, notInArray } from "drizzle-orm";
import { type Db, type DbOrTx } from "../db/client";
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

/**
 * Reflect Google-side deletions locally: remove previously-synced rows in this
 * calendar+window whose Google copy is no longer present. Scoped tightly so we
 * never touch local-only events (syncStatus 'local', no googleEventId) or events
 * outside the queried window — an empty `presentIds` means Google returned
 * nothing for the window, so every synced row in it should go.
 */
async function reconcileDeletions(
  tx: DbOrTx,
  accountId: string,
  calendarId: string,
  from: Date,
  to: Date,
  presentIds: string[],
): Promise<void> {
  const conditions = [
    eq(events.googleAccountId, accountId),
    eq(events.calendarId, calendarId),
    eq(events.syncStatus, "synced"),
    isNotNull(events.googleEventId),
    gte(events.startsAt, from),
    lt(events.startsAt, to),
  ];
  if (presentIds.length > 0) conditions.push(notInArray(events.googleEventId, presentIds));
  await tx.delete(events).where(and(...conditions));
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
  // Every id Google returned for the window — the deletion reconciler keeps these.
  const presentIds = raw.map((e) => e.id);
  const rows = raw
    .map((e) => normalizeEvent(e, conn.accountId, calendarId))
    .filter((r): r is NewEventRow => r !== null);

  // node-postgres supports interactive transactions — reconcile deletions and
  // upsert together so a sync either fully lands or rolls back. Reconciliation
  // runs even when Google returns nothing, so a fully-cleared window clears here.
  await db.transaction(async (tx) => {
    await reconcileDeletions(tx, conn.accountId, calendarId, from, to, presentIds);
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
    // The Braindump calendar's content is write-only from the app's side — its
    // AI items already live locally, so reading them back would double them up.
    // We still reconcile *deletions* (deletion-only, no insert) so removing an AI
    // event in another client removes it here too.
    if (conn.braindumpCalendarId && cal.id === conn.braindumpCalendarId) {
      const raw = await eventsApi.list({
        accessToken,
        calendarId: cal.id,
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
      });
      await db.transaction((tx) =>
        reconcileDeletions(tx, conn.accountId, cal.id, from, to, raw.map((e) => e.id)),
      );
      continue;
    }
    total += await syncConnectionEvents(db, conn, accessToken, eventsApi, from, to, cal.id);
  }
  return total;
}
