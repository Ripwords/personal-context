import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createTodo, createEvent } from "./items";
import { getCalendarFeed } from "./calendar-feed";
import { googleCalendar, events as eventsTable } from "../schema";

const db = getTestDb();
beforeEach(async () => { await truncateAll(db); });

test("aggregates events, scheduled todos in range, and unscheduled todos", async () => {
  await createEvent(db, { title: "ev", startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T10:00:00Z") });
  await createTodo(db, { title: "sched", scheduledStart: new Date("2026-07-01T11:00:00Z"), scheduledEnd: new Date("2026-07-01T12:00:00Z") });
  await createTodo(db, { title: "unsched" });
  await createEvent(db, { title: "next-week", startsAt: new Date("2026-07-09T09:00:00Z"), endsAt: new Date("2026-07-09T10:00:00Z") });

  const feed = await getCalendarFeed(db, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-02T00:00:00Z"));
  expect(feed.events.map((e) => e.title)).toEqual(["ev"]);
  expect(feed.scheduledTodos.map((t) => t.title)).toEqual(["sched"]);
  expect(feed.unscheduledTodos.map((t) => t.title)).toEqual(["unsched"]);
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
