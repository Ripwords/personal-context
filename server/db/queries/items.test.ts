import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createProject } from "./projects";
import {
  createDump,
  createTodo,
  listUnscheduledTodos,
  listScheduledTodosInRange,
  createEvent,
  listEventsInRange,
  logActivity,
  listActivity,
} from "./items";

const db = getTestDb();
beforeEach(async () => {
  await truncateAll(db);
});

test("createDump stores raw text", async () => {
  const d = await createDump(db, "buy milk and email Sam");
  expect(d.text).toBe("buy milk and email Sam");
});

test("listUnscheduledTodos returns only open, unscheduled todos", async () => {
  await createTodo(db, { title: "unscheduled-open" });
  await createTodo(db, {
    title: "scheduled",
    scheduledStart: new Date("2026-07-01T09:00:00Z"),
    scheduledEnd: new Date("2026-07-01T10:00:00Z"),
  });
  await createTodo(db, { title: "done-one", status: "done" });
  const rows = await listUnscheduledTodos(db);
  expect(rows.map((r) => r.title)).toEqual(["unscheduled-open"]);
});

test("listScheduledTodosInRange filters by scheduledStart window", async () => {
  await createTodo(db, {
    title: "in-range",
    scheduledStart: new Date("2026-07-01T09:00:00Z"),
    scheduledEnd: new Date("2026-07-01T10:00:00Z"),
  });
  await createTodo(db, {
    title: "out-of-range",
    scheduledStart: new Date("2026-07-05T09:00:00Z"),
    scheduledEnd: new Date("2026-07-05T10:00:00Z"),
  });
  const rows = await listScheduledTodosInRange(
    db,
    new Date("2026-07-01T00:00:00Z"),
    new Date("2026-07-02T00:00:00Z"),
  );
  expect(rows.map((r) => r.title)).toEqual(["in-range"]);
});

test("listEventsInRange filters by startsAt window", async () => {
  await createEvent(db, {
    title: "standup",
    startsAt: new Date("2026-07-01T09:00:00Z"),
    endsAt: new Date("2026-07-01T09:15:00Z"),
  });
  await createEvent(db, {
    title: "next-week",
    startsAt: new Date("2026-07-08T09:00:00Z"),
    endsAt: new Date("2026-07-08T09:15:00Z"),
  });
  const rows = await listEventsInRange(
    db,
    new Date("2026-07-01T00:00:00Z"),
    new Date("2026-07-02T00:00:00Z"),
  );
  expect(rows.map((r) => r.title)).toEqual(["standup"]);
});

test("activity log is returned newest first", async () => {
  const p = await createProject(db, { name: "Work", color: "#0D9488", kind: "work" });
  await logActivity(db, { action: "create", entityType: "project", entityId: p.id });
  await logActivity(db, { action: "update", entityType: "project", entityId: p.id });
  const rows = await listActivity(db);
  expect(rows[0]!.action).toBe("update");
  expect(rows.length).toBe(2);
});
