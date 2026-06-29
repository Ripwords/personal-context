// server/calendar-sync/sync-events.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import {
  normalizeEvent,
  syncConnectionEvents,
  syncAllCalendars,
  type EventsApi,
  type CalendarListApi,
} from "./sync-events";
import { googleCalendar, events as eventsTable } from "../db/schema";
import { eq } from "drizzle-orm";
import type { GoogleCreds } from "../auth/google-credentials";

const db = getTestDb();
const conn: GoogleCreds = {
  accountId: "acc1", role: "work", accessToken: "at", refreshToken: "rt", braindumpCalendarId: null,
};

beforeEach(async () => { await truncateAll(db); });

test("normalizeEvent maps a timed event", () => {
  const row = normalizeEvent(
    { id: "g1", summary: "Standup", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T09:15:00Z" } },
    "acc1",
  );
  expect(row).not.toBeNull();
  expect(row!.title).toBe("Standup");
  expect(row!.googleEventId).toBe("g1");
  expect(row!.googleAccountId).toBe("acc1");
  expect(row!.syncStatus).toBe("synced");
});

test("normalizeEvent skips events with no start/end", () => {
  expect(normalizeEvent({ id: "g2" }, "acc1")).toBeNull();
});

test("normalizeEvent flags all-day events (start.date, no dateTime) and tags calendarId", () => {
  const timed = normalizeEvent(
    { id: "g1", summary: "Standup", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T09:15:00Z" } },
    "acc1",
    "primary",
  );
  expect(timed!.allDay).toBe(false);
  expect(timed!.calendarId).toBe("primary");

  const allDay = normalizeEvent(
    { id: "g2", summary: "Birthday", start: { date: "2026-07-07" }, end: { date: "2026-07-08" } },
    "acc1",
    "birthdays@group.calendar.google.com",
  );
  expect(allDay!.allDay).toBe(true);
  expect(allDay!.calendarId).toBe("birthdays@group.calendar.google.com");
});

test("syncAllCalendars stores calendar metadata and syncs only selected calendars", async () => {
  const calListApi: CalendarListApi = {
    list: async () => [
      { id: "primary", summary: "Me", backgroundColor: "#4986e7", selected: true, primary: true },
      { id: "birthdays", summary: "Birthdays", backgroundColor: "#16a765", selected: true },
      { id: "hidden", summary: "Hidden", backgroundColor: "#cccccc", selected: false },
    ],
  };
  const eventsApi: EventsApi = {
    list: async ({ calendarId }) =>
      calendarId === "hidden"
        ? [{ id: "hx", summary: "should not sync", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T10:00:00Z" } }]
        : [{ id: `${calendarId}-e1`, summary: `${calendarId} ev`, start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T10:00:00Z" } }],
  };
  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-02T00:00:00Z");

  const n = await syncAllCalendars(db, conn, "at", calListApi, eventsApi, from, to);
  expect(n).toBe(2); // primary + birthdays, not hidden

  const cals = await db.select().from(googleCalendar).where(eq(googleCalendar.accountId, "acc1"));
  expect(cals.length).toBe(3);
  expect(cals.find((c) => c.calendarId === "primary")!.backgroundColor).toBe("#4986e7");
  expect(cals.find((c) => c.calendarId === "hidden")!.selected).toBe(false);

  const synced = await db.select().from(eventsTable);
  expect(synced.map((e) => e.calendarId).sort()).toEqual(["birthdays", "primary"]);
});

test("syncConnectionEvents upserts and is idempotent on (account,event) identity", async () => {
  const events = [
    { id: "g1", summary: "Standup", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T09:15:00Z" } },
  ];
  const api: EventsApi = { list: async () => events };
  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-02T00:00:00Z");

  const n1 = await syncConnectionEvents(db, conn, "at", api, from, to);
  expect(n1).toBe(1);
  const n2 = await syncConnectionEvents(db, conn, "at", api, from, to); // same event again
  expect(n2).toBe(1);

  const rows = await db.select().from((await import("../db/schema")).events);
  expect(rows.length).toBe(1); // upsert, not duplicate
  expect(rows[0]!.title).toBe("Standup");
});
