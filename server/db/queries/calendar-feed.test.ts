import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createTodo, createEvent } from "./items";
import { getCalendarFeed } from "./calendar-feed";

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
