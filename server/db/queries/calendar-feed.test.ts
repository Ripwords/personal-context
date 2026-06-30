import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createTodo, createEvent } from "./items";
import { getCalendarFeed } from "./calendar-feed";
import { googleCalendar, events as eventsTable } from "../schema";

const db = getTestDb();
beforeEach(async () => { await truncateAll(db); });

test("aggregates events, scheduled todo blocks, and unscheduled todos; reminders are NOT gridded", async () => {
  await createEvent(db, { title: "ev", startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T10:00:00Z") });
  // A scheduled todo block (scheduledStart) IS gridded alongside events.
  await createTodo(db, { title: "block", scheduledStart: new Date("2026-07-01T11:00:00Z"), scheduledEnd: new Date("2026-07-01T12:00:00Z") });
  // A reminder (remindAt) fires a notification — never gridded, never in the rail.
  await createTodo(db, { title: "reminder", remindAt: new Date("2026-07-01T13:00:00Z") });
  await createTodo(db, { title: "unsched" });
  await createEvent(db, { title: "next-week", startsAt: new Date("2026-07-09T09:00:00Z"), endsAt: new Date("2026-07-09T10:00:00Z") });

  const feed = await getCalendarFeed(db, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-02T00:00:00Z"));
  expect(feed.events.map((e) => e.title)).toEqual(["ev"]);
  expect(feed.scheduledTodos.map((t) => t.title)).toEqual(["block"]); // block grids; reminder does not
  expect(feed.unscheduledTodos.map((t) => t.title)).toEqual(["unsched"]); // reminder excluded from rail
});

test("includes events that overlap the window but start before it (spanning midnight / multi-day)", async () => {
  // Starts the previous night, ends inside the window — must appear.
  await createEvent(db, { title: "overnight", startsAt: new Date("2026-06-30T23:00:00Z"), endsAt: new Date("2026-07-01T01:00:00Z") });
  // Multi-day event spanning the entire window (starts before, ends after).
  await createEvent(db, { title: "multiday", startsAt: new Date("2026-06-29T00:00:00Z"), endsAt: new Date("2026-07-05T00:00:00Z") });
  // Ends exactly at `from` — does NOT overlap [from, to), must be excluded.
  await createEvent(db, { title: "ended-before", startsAt: new Date("2026-06-30T22:00:00Z"), endsAt: new Date("2026-07-01T00:00:00Z") });

  const feed = await getCalendarFeed(db, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-02T00:00:00Z"));
  const titles = feed.events.map((e) => e.title);
  expect(titles).toContain("overnight");
  expect(titles).toContain("multiday");
  expect(titles).not.toContain("ended-before");
});

test("splits all-day events, attaches calendar color, and hides deselected calendars", async () => {
  await db.insert(googleCalendar).values([
    { accountId: "acc1", calendarId: "primary", summary: "Me", backgroundColor: "#4986e7", selected: true },
    { accountId: "acc1", calendarId: "bdays", summary: "Birthdays", backgroundColor: "#16a765", selected: true },
    { accountId: "acc1", calendarId: "muted", summary: "Muted", backgroundColor: "#999999", selected: false },
  ]);
  await db.insert(eventsTable).values([
    { title: "timed", startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T10:00:00Z"),
      googleAccountId: "acc1", calendarId: "primary", googleEventId: "t1", allDay: false },
    { title: "bday", startsAt: new Date("2026-07-01T00:00:00Z"), endsAt: new Date("2026-07-02T00:00:00Z"),
      googleAccountId: "acc1", calendarId: "bdays", googleEventId: "b1", allDay: true },
    { title: "hidden", startsAt: new Date("2026-07-01T08:00:00Z"), endsAt: new Date("2026-07-01T09:00:00Z"),
      googleAccountId: "acc1", calendarId: "muted", googleEventId: "h1", allDay: false },
  ]);

  const feed = await getCalendarFeed(db, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-02T00:00:00Z"));
  expect(feed.events.map((e) => e.title)).toEqual(["timed"]); // 'hidden' filtered out
  expect(feed.events[0]!.color).toBe("#4986e7");
  expect(feed.allDayEvents.map((e) => e.title)).toEqual(["bday"]);
  expect(feed.allDayEvents[0]!.color).toBe("#16a765");
});

test("shows events whose calendar metadata has not synced yet (no google_calendar row)", async () => {
  // Event references a calendar that has no row in google_calendar (e.g. a
  // secondary Google calendar the calendarList sync hasn't captured).
  await db.insert(eventsTable).values({
    title: "orphan-cal-event",
    startsAt: new Date("2026-07-01T09:00:00Z"),
    endsAt: new Date("2026-07-01T10:00:00Z"),
    googleAccountId: "acc1",
    calendarId: "jflc45@group.calendar.google.com",
    googleEventId: "o1",
    allDay: false,
  });

  const feed = await getCalendarFeed(db, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-02T00:00:00Z"));
  expect(feed.events.map((e) => e.title)).toContain("orphan-cal-event");
  expect(feed.events.find((e) => e.title === "orphan-cal-event")!.color).toBeNull();
});
