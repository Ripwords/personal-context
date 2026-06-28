// server/calendar-sync/sync-events.ts
import { type Db } from "../db/client";
import { events, type NewEventRow } from "../db/schema";
import type { GoogleCreds } from "../auth/google-credentials";

export type RawGoogleEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export type EventsApi = {
  list(input: {
    accessToken: string;
    calendarId: string;
    timeMin: string;
    timeMax: string;
  }): Promise<RawGoogleEvent[]>;
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
): NewEventRow | null {
  const startsAt = pickTime(raw.start);
  const endsAt = pickTime(raw.end);
  if (!startsAt || !endsAt) return null;
  return {
    title: raw.summary ?? "(no title)",
    startsAt,
    endsAt,
    googleEventId: raw.id,
    googleAccountId,
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
): Promise<number> {
  const raw = await api.list({
    accessToken,
    calendarId: "primary",
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
  });
  const rows = raw
    .map((e) => normalizeEvent(e, conn.accountId))
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
          set: { title: row.title, startsAt: row.startsAt, endsAt: row.endsAt, syncStatus: "synced" },
        });
    }
  });
  return rows.length;
}
