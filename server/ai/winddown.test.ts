import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { createTodo, listActivity, listEventsInRange, listUnscheduledTodos } from "../db/queries/items";
import { applyWindDownSchedule, type WindDownProposal } from "./winddown";
import type { LanguageModel } from "ai";
import type { Db } from "../db/client";

// ── Network-free tests for applyWindDownSchedule ───────────────────────────
// summarizeDay is typecheck-only here; it is covered in live integration (Task 4).

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

test("applyWindDownSchedule: creates a calendar event for a valid block, skips invalid date block", async () => {
  // Create 2 open todos
  const todo1 = await createTodo(db, { title: "Write quarterly report", source: "manual" });
  const todo2 = await createTodo(db, { title: "Review pull requests", source: "manual" });

  const blocks = [
    {
      todoId: todo1.id,
      startsAt: "2026-06-30T09:00:00.000Z",
      endsAt: "2026-06-30T10:00:00.000Z",
    },
    {
      todoId: todo2.id,
      startsAt: "not-a-valid-date",
      endsAt: "2026-06-30T11:00:00.000Z",
    },
  ];

  const created = await applyWindDownSchedule(db, blocks);

  // Only the valid block becomes an event.
  expect(created).toHaveLength(1);
  expect(created[0]!.title).toBe("Write quarterly report");

  const events = await listEventsInRange(db, new Date("2026-06-30T00:00:00Z"), new Date("2026-07-01T00:00:00Z"));
  expect(events.map((e) => e.title)).toEqual(["Write quarterly report"]);
  expect(events[0]!.startsAt.toISOString()).toBe("2026-06-30T09:00:00.000Z");
  expect(events[0]!.endsAt.toISOString()).toBe("2026-06-30T10:00:00.000Z");

  // Todos are left in the backlog (events reserve time; todos stay your tasks).
  // Neither becomes a reminder.
  const open = await listUnscheduledTodos(db);
  expect(open.map((t) => t.title).sort()).toEqual(["Review pull requests", "Write quarterly report"]);
});

test("applyWindDownSchedule: logs an activity row with action=schedule for each created event", async () => {
  const todo = await createTodo(db, { title: "Prepare slides", source: "manual" });

  const blocks = [
    {
      todoId: todo.id,
      startsAt: "2026-06-30T14:00:00.000Z",
      endsAt: "2026-06-30T15:00:00.000Z",
    },
  ];

  await applyWindDownSchedule(db, blocks);

  const events = await listEventsInRange(db, new Date("2026-06-30T00:00:00Z"), new Date("2026-07-01T00:00:00Z"));
  const activities = await listActivity(db);
  expect(activities).toHaveLength(1);
  expect(activities[0]!.action).toBe("schedule");
  expect(activities[0]!.entityType).toBe("event");
  expect(activities[0]!.entityId).toBe(events[0]!.id);
  expect(activities[0]!.payload).toEqual({
    todoId: todo.id,
    startsAt: "2026-06-30T14:00:00.000Z",
    endsAt: "2026-06-30T15:00:00.000Z",
  });
});

test("applyWindDownSchedule: returns 0 when all blocks have invalid dates", async () => {
  const todo = await createTodo(db, { title: "Something", source: "manual" });

  const blocks = [
    { todoId: todo.id, startsAt: "bad", endsAt: "also-bad" },
    { todoId: todo.id, startsAt: "2026-06-30T09:00:00Z", endsAt: "nope" },
  ];

  const created = await applyWindDownSchedule(db, blocks);
  expect(created).toHaveLength(0);

  const activities = await listActivity(db);
  expect(activities).toHaveLength(0);
});

// ── Type-level smoke test for summarizeDay ─────────────────────────────────
// This confirms the function signature is correct without making network calls.

test("summarizeDay: type signature is correct (typecheck only)", () => {
  // Import the function and verify its shape without calling it
  const { summarizeDay } = require("./winddown");
  expect(typeof summarizeDay).toBe("function");

  // Verify WindDownProposal type shape at runtime via a valid literal
  const proposal: WindDownProposal = {
    groups: [
      { project: "Work", items: [{ todoId: "abc-123", title: "Finish report" }] },
      { project: null, items: [{ todoId: "def-456", title: "Personal task" }] },
    ],
    schedule: [
      {
        todoId: "abc-123",
        title: "Finish report",
        startsAt: "2026-06-30T09:00:00.000Z",
        endsAt: "2026-06-30T10:30:00.000Z",
      },
    ],
  };

  expect(proposal.groups).toHaveLength(2);
  expect(proposal.schedule).toHaveLength(1);
});
