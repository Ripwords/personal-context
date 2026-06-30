import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createProject } from "./projects";
import {
  createDump,
  createTodo,
  listUnscheduledTodos,
  listScheduledTodosInRange,
  listReminders,
  markReminderNotified,
  updateTodoSchedule,
  createEvent,
  listEventsInRange,
  findEventsByTitle,
  deleteEvent,
  logActivity,
  listActivity,
  dropTodo,
  dropAllUnscheduledTodos,
  completeTodo,
  reopenTodo,
} from "./items";

const db = getTestDb();
beforeEach(async () => {
  await truncateAll(db);
});

test("listReminders returns open timed todos soonest-first; markReminderNotified stamps them", async () => {
  const later = await createTodo(db, { title: "later", remindAt: new Date("2026-07-01T15:00:00Z") });
  await createTodo(db, { title: "sooner", remindAt: new Date("2026-07-01T09:00:00Z") });
  await createTodo(db, { title: "plain" }); // no time → not a reminder

  const reminders = await listReminders(db);
  expect(reminders.map((r) => r.title)).toEqual(["sooner", "later"]);
  expect(reminders.every((r) => r.notifiedAt === null)).toBe(true);

  const at = new Date("2026-07-01T15:00:05Z");
  await markReminderNotified(db, later.id, at);
  const after = await listReminders(db);
  expect(after.find((r) => r.id === later.id)!.notifiedAt!.toISOString()).toBe(at.toISOString());
});

test("rescheduling a reminder (remindAt) clears notifiedAt so it can fire again", async () => {
  const t = await createTodo(db, { title: "meds", remindAt: new Date("2026-07-01T08:00:00Z") });
  await markReminderNotified(db, t.id, new Date("2026-07-01T08:00:01Z"));

  const updated = await updateTodoSchedule(db, t.id, { remindAt: new Date("2026-07-02T08:00:00Z") });
  expect(updated!.notifiedAt).toBeNull();
});

test("scheduling a todo as a block (scheduledStart) does NOT touch a reminder's notifiedAt", async () => {
  const t = await createTodo(db, { title: "task", remindAt: new Date("2026-07-01T08:00:00Z") });
  const at = new Date("2026-07-01T08:00:01Z");
  await markReminderNotified(db, t.id, at);

  const updated = await updateTodoSchedule(db, t.id, { scheduledStart: new Date("2026-07-02T08:00:00Z") });
  expect(updated!.notifiedAt!.toISOString()).toBe(at.toISOString());
});

test("completeTodo marks a todo done; reopenTodo returns it to open", async () => {
  const t = await createTodo(db, { title: "ship it" });
  const done = await completeTodo(db, t.id);
  expect(done!.status).toBe("done");

  // A completed todo leaves the unscheduled rail.
  expect((await listUnscheduledTodos(db)).map((r) => r.title)).toEqual([]);

  const reopened = await reopenTodo(db, t.id);
  expect(reopened!.status).toBe("open");
  expect((await listUnscheduledTodos(db)).map((r) => r.title)).toEqual(["ship it"]);
});

test("completeTodo returns null for a missing todo", async () => {
  expect(await completeTodo(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
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
  await createTodo(db, {
    title: "dropped-scheduled",
    status: "dropped",
    scheduledStart: new Date("2026-07-01T11:00:00Z"),
    scheduledEnd: new Date("2026-07-01T12:00:00Z"),
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

test("findEventsByTitle matches case-insensitive substrings and optional range; deleteEvent removes a row", async () => {
  await createEvent(db, { title: "Standup with Team", startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T09:15:00Z") });
  await createEvent(db, { title: "Design review", startsAt: new Date("2026-07-01T14:00:00Z"), endsAt: new Date("2026-07-01T15:00:00Z") });
  await createEvent(db, { title: "Standup with Team", startsAt: new Date("2026-07-08T09:00:00Z"), endsAt: new Date("2026-07-08T09:15:00Z") });

  const all = await findEventsByTitle(db, "standup");
  expect(all.length).toBe(2);

  const thisWeek = await findEventsByTitle(db, "STANDUP", new Date("2026-07-01T00:00:00Z"), new Date("2026-07-02T00:00:00Z"));
  expect(thisWeek.length).toBe(1);

  const deleted = await deleteEvent(db, thisWeek[0]!.id);
  expect(deleted?.id).toBe(thisWeek[0]!.id);
  expect((await findEventsByTitle(db, "standup")).length).toBe(1);
  expect(await deleteEvent(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
});

test("findEventsByTitle treats SQL LIKE wildcards as literal title characters", async () => {
  await createEvent(db, { title: "100% planning", startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T10:00:00Z") });
  await createEvent(db, { title: "100x planning", startsAt: new Date("2026-07-01T11:00:00Z"), endsAt: new Date("2026-07-01T12:00:00Z") });
  await createEvent(db, { title: "a_b sync", startsAt: new Date("2026-07-01T13:00:00Z"), endsAt: new Date("2026-07-01T14:00:00Z") });
  await createEvent(db, { title: "axb sync", startsAt: new Date("2026-07-01T15:00:00Z"), endsAt: new Date("2026-07-01T16:00:00Z") });

  expect((await findEventsByTitle(db, "100%")).map((e) => e.title)).toEqual(["100% planning"]);
  expect((await findEventsByTitle(db, "a_b")).map((e) => e.title)).toEqual(["a_b sync"]);
});

test("activity log is returned newest first", async () => {
  const p = await createProject(db, { name: "Work", color: "#0D9488", kind: "work" });
  await logActivity(db, { action: "create", entityType: "project", entityId: p.id });
  await logActivity(db, { action: "update", entityType: "project", entityId: p.id });
  const rows = await listActivity(db);
  expect(rows[0]!.action).toBe("update");
  expect(rows.length).toBe(2);
});

test("dropTodo marks a todo dropped and removes it from the unscheduled list", async () => {
  const t = await createTodo(db, { title: "to-drop" });
  const updated = await dropTodo(db, t.id);
  expect(updated?.status).toBe("dropped");
  expect((await listUnscheduledTodos(db)).length).toBe(0);
});

test("dropTodo returns null when the id does not exist", async () => {
  const updated = await dropTodo(db, "00000000-0000-0000-0000-000000000000");
  expect(updated).toBeNull();
});

test("dropAllUnscheduledTodos drops only open unscheduled todos and reports the count", async () => {
  await createTodo(db, { title: "open-1" });
  await createTodo(db, { title: "open-2" });
  await createTodo(db, {
    title: "scheduled",
    scheduledStart: new Date("2026-07-01T09:00:00Z"),
    scheduledEnd: new Date("2026-07-01T10:00:00Z"),
  });
  const count = await dropAllUnscheduledTodos(db);
  expect(count).toBe(2);
  expect((await listUnscheduledTodos(db)).length).toBe(0);
});
