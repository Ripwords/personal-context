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

test("last-write-wins: a newer Google edit overwrites the local row", async () => {
  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-02T00:00:00Z");
  await db.insert(eventsTable).values({
    title: "Old title", startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T10:00:00Z"),
    googleEventId: "g1", googleAccountId: "acc1", calendarId: "primary", syncStatus: "synced",
    updatedAt: new Date("2026-07-01T08:00:00Z"), googleUpdatedAt: new Date("2026-07-01T08:00:00Z"),
  });

  const api: EventsApi = { list: async () => [
    { id: "g1", summary: "New title", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T10:00:00Z" },
      updated: "2026-07-01T12:00:00Z" }, // newer than local updatedAt
  ] };
  await syncConnectionEvents(db, conn, "at", api, from, to, "primary");

  const [row] = await db.select().from(eventsTable).where(eq(eventsTable.googleEventId, "g1"));
  expect(row!.title).toBe("New title"); // Google's newer edit wins
});

test("last-write-wins: a stale Google copy does NOT clobber a fresher local edit", async () => {
  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-02T00:00:00Z");
  // Local row edited "just now" (well after Google's last-known update).
  await db.insert(eventsTable).values({
    title: "Local edit", startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T10:00:00Z"),
    googleEventId: "g1", googleAccountId: "acc1", calendarId: "primary", syncStatus: "synced",
    updatedAt: new Date("2026-07-01T18:00:00Z"), googleUpdatedAt: new Date("2026-07-01T08:00:00Z"),
  });

  const api: EventsApi = { list: async () => [
    { id: "g1", summary: "Stale title", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T10:00:00Z" },
      updated: "2026-07-01T08:00:00Z" }, // older than local updatedAt
  ] };
  await syncConnectionEvents(db, conn, "at", api, from, to, "primary");

  const [row] = await db.select().from(eventsTable).where(eq(eventsTable.googleEventId, "g1"));
  expect(row!.title).toBe("Local edit"); // local edit preserved
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

test("syncConnectionEvents removes a synced row deleted in Google within the window", async () => {
  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-02T00:00:00Z");

  const apiBoth: EventsApi = {
    list: async () => [
      { id: "g1", summary: "Keep", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T10:00:00Z" } },
      { id: "g2", summary: "DeleteMe", start: { dateTime: "2026-07-01T11:00:00Z" }, end: { dateTime: "2026-07-01T12:00:00Z" } },
    ],
  };
  await syncConnectionEvents(db, conn, "at", apiBoth, from, to);
  expect((await db.select().from(eventsTable)).length).toBe(2);

  // g2 deleted in another client → Google now only returns g1.
  const apiOne: EventsApi = {
    list: async () => [
      { id: "g1", summary: "Keep", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T10:00:00Z" } },
    ],
  };
  await syncConnectionEvents(db, conn, "at", apiOne, from, to);

  const rows = await db.select().from(eventsTable);
  expect(rows.map((r) => r.googleEventId)).toEqual(["g1"]);
});

test("syncConnectionEvents reconciles deletions even when Google returns an empty window", async () => {
  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-02T00:00:00Z");

  // A synced event in-window (its Google copy was removed).
  await db.insert(eventsTable).values({
    title: "Gone", startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T10:00:00Z"),
    googleEventId: "gGone", googleAccountId: "acc1", calendarId: "primary", syncStatus: "synced",
  });
  // A local-only event (never synced) in-window — must NOT be deleted.
  await db.insert(eventsTable).values({
    title: "Local only", startsAt: new Date("2026-07-01T11:00:00Z"), endsAt: new Date("2026-07-01T12:00:00Z"),
    googleAccountId: "acc1", calendarId: "primary", syncStatus: "local",
  });
  // A synced event OUTSIDE the window — must NOT be deleted.
  await db.insert(eventsTable).values({
    title: "Outside", startsAt: new Date("2026-07-05T09:00:00Z"), endsAt: new Date("2026-07-05T10:00:00Z"),
    googleEventId: "gOut", googleAccountId: "acc1", calendarId: "primary", syncStatus: "synced",
  });
  // A synced event that STARTS before the window but OVERLAPS it (spans midnight),
  // whose Google copy was removed — reconciliation must reach it via overlap.
  await db.insert(eventsTable).values({
    title: "Overnight", startsAt: new Date("2026-06-30T23:00:00Z"), endsAt: new Date("2026-07-01T01:00:00Z"),
    googleEventId: "gOver", googleAccountId: "acc1", calendarId: "primary", syncStatus: "synced",
  });

  const apiEmpty: EventsApi = { list: async () => [] };
  await syncConnectionEvents(db, conn, "at", apiEmpty, from, to, "primary");

  const titles = (await db.select().from(eventsTable)).map((r) => r.title).sort();
  expect(titles).toEqual(["Local only", "Outside"]); // "Gone" + "Overnight" removed; the other two preserved
});

test("syncAllCalendars reflects deletions from the Braindump calendar (deletion-only, no re-insert)", async () => {
  const connBd: GoogleCreds = { ...conn, braindumpCalendarId: "braindump" };
  // A local braindump-created event linked to the braindump calendar.
  await db.insert(eventsTable).values({
    title: "AI event", startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T10:00:00Z"),
    googleEventId: "bd1", googleAccountId: "acc1", calendarId: "braindump", syncStatus: "synced",
  });

  const calListApi: CalendarListApi = {
    list: async () => [
      { id: "primary", summary: "Me", selected: true, primary: true },
      { id: "braindump", summary: "Braindump", selected: true },
    ],
  };
  // primary empty; braindump returns a *different* event (must NOT be inserted),
  // and bd1 is absent (deleted in another client → must be removed locally).
  const eventsApi: EventsApi = {
    list: async ({ calendarId }) =>
      calendarId === "braindump"
        ? [{ id: "bd2", summary: "made in google", start: { dateTime: "2026-07-01T14:00:00Z" }, end: { dateTime: "2026-07-01T15:00:00Z" } }]
        : [],
  };

  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-02T00:00:00Z");
  await syncAllCalendars(db, connBd, "at", calListApi, eventsApi, from, to);

  const rows = await db.select().from(eventsTable);
  expect(rows.length).toBe(0); // bd1 removed; bd2 not re-inserted (braindump is deletion-only)
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
