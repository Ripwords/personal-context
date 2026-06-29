// server/calendar-sync/writeback.ts
import { eq, inArray } from "drizzle-orm";
import { type Db } from "../db/client";
import { events, todos } from "../db/schema";
import { type GoogleCreds } from "../auth/google-credentials";
import { ensureBraindumpCalendar, type CalendarApi } from "./braindump-calendar";
import { type EventWriteApi } from "./google-rest";

export type WritebackItem = {
  kind: "event" | "todo";
  id: string; // local row id
  title: string;
  startsAt: Date;
  endsAt: Date;
};

/**
 * Resolve which AI-created items should be mirrored to Google: every created
 * event, plus every created todo that has a scheduled time. Reads the times
 * back from the DB by id (the extraction result only carries id + title).
 */
export async function resolveWritebackItems(
  db: Db,
  createdIds: { kind: "todo" | "event"; id: string }[],
): Promise<WritebackItem[]> {
  const eventIds = createdIds.filter((c) => c.kind === "event").map((c) => c.id);
  const todoIds = createdIds.filter((c) => c.kind === "todo").map((c) => c.id);
  const out: WritebackItem[] = [];

  if (eventIds.length > 0) {
    const rows = await db.select().from(events).where(inArray(events.id, eventIds));
    for (const r of rows) {
      out.push({ kind: "event", id: r.id, title: r.title, startsAt: r.startsAt, endsAt: r.endsAt });
    }
  }
  if (todoIds.length > 0) {
    const rows = await db.select().from(todos).where(inArray(todos.id, todoIds));
    for (const r of rows) {
      if (r.scheduledStart) {
        out.push({
          kind: "todo",
          id: r.id,
          title: r.title,
          startsAt: r.scheduledStart,
          endsAt: r.scheduledEnd ?? new Date(r.scheduledStart.getTime() + 30 * 60_000),
        });
      }
    }
  }
  return out;
}

/**
 * Build a single-item mirror bound to one account. The "Braindump" calendar is
 * provisioned lazily and memoized, so calling the returned function many times
 * (e.g. once per chat tool call) creates the calendar at most once. Stores the
 * Google event id back on created event rows.
 */
export function makeBraindumpMirror(
  db: Db,
  conn: GoogleCreds,
  calApi: CalendarApi,
  eventWriteApi: EventWriteApi,
  timeZone?: string,
): (item: WritebackItem) => Promise<void> {
  let calIdPromise: Promise<string> | null = null;
  const calendarId = () => (calIdPromise ??= ensureBraindumpCalendar(db, conn, calApi));

  return async (item) => {
    const cal = await calendarId();
    const { id: gid } = await eventWriteApi.insert({
      calendarId: cal,
      summary: item.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      timeZone,
    });
    if (item.kind === "event") {
      await db
        .update(events)
        .set({ googleEventId: gid, googleAccountId: conn.accountId, calendarId: cal, syncStatus: "synced" })
        .where(eq(events.id, item.id));
    }
  };
}

/**
 * Mirror a batch of items to the account's "Braindump" Google calendar.
 * Best-effort per item — one failure won't abort the rest. Returns the count
 * successfully written.
 */
export async function writeBraindumpItems(
  db: Db,
  conn: GoogleCreds,
  calApi: CalendarApi,
  eventWriteApi: EventWriteApi,
  items: WritebackItem[],
  timeZone?: string,
): Promise<number> {
  if (items.length === 0) return 0;
  const mirror = makeBraindumpMirror(db, conn, calApi, eventWriteApi, timeZone);
  let written = 0;
  for (const item of items) {
    try {
      await mirror(item);
      written++;
    } catch (err) {
      console.error(`braindump writeback failed for ${item.kind} ${item.id}:`, err);
    }
  }
  return written;
}
