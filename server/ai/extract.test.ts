import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { createProject } from "../db/queries/projects";
import { listActivity, createEvent, createDump, findEventsByTitle } from "../db/queries/items";
import { applyToolCalls } from "./extract";

// Strategy: test applyToolCalls directly with hand-built tool-call objects.
// This gives network-free, deterministic tests that cover all the DB mapping
// logic. extractFromDump itself is just thin glue (createDump + generateText +
// applyToolCalls) and doesn't need a separate network test.

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

test("applyToolCalls: creates a todo with resolved projectId and logs activity", async () => {
  const project = await createProject(db, { name: "Work", color: "#111", kind: "work" });

  // Simulate a dump row id
  const { createDump } = await import("../db/queries/items");
  const dump = await createDump(db, "remember to email Sam about work");

  const calls = [
    {
      toolName: "create_todo",
      input: {
        title: "email Sam",
        project: "Work",
        confidence: 0.9,
      },
    },
  ];

  const { created } = await applyToolCalls(db, dump.id, calls, [project]);

  expect(created).toHaveLength(1);
  expect(created[0]!.kind).toBe("todo");
  expect(created[0]!.title).toBe("email Sam");
  expect(created[0]!.projectId).toBe(project.id);
  expect(created[0]!.confidence).toBe(0.9);
  expect(created[0]!.lowConfidence).toBe(false);

  const acts = await listActivity(db);
  expect(acts).toHaveLength(1);
  expect(acts[0]!.action).toBe("create");
  expect(acts[0]!.entityType).toBe("todo");
  expect(acts[0]!.entityId).toBe(created[0]!.id);
});

test("applyToolCalls: keyword classifier resolves project when the model omits it", async () => {
  const work = await createProject(db, { name: "Work", color: "#111", kind: "work", keywords: ["deploy"] });
  const dump = await createDump(db, "ship the deploy tonight");

  const calls = [
    { toolName: "create_todo", input: { title: "ship the deploy tonight", confidence: 0.9 } },
  ];
  const { created } = await applyToolCalls(db, dump.id, calls, [work]);

  expect(created[0]!.projectId).toBe(work.id); // resolved via keyword "deploy"
});

test("applyToolCalls: an unmatched model project name flags needsReview and persists it", async () => {
  const work = await createProject(db, { name: "Work", color: "#111", kind: "work" });
  const dump = await createDump(db, "do the thing");

  const calls = [
    { toolName: "create_todo", input: { title: "do the thing", project: "Nonexistent Project", confidence: 0.9 } },
  ];
  const { created } = await applyToolCalls(db, dump.id, calls, [work]);

  expect(created[0]!.needsReview).toBe(true);
  const { getTodoById } = await import("../db/queries/items");
  expect((await getTodoById(db, created[0]!.id))!.needsReview).toBe(true);
});

test("applyToolCalls: low confidence todo is flagged", async () => {
  const project = await createProject(db, { name: "Personal", color: "#222", kind: "personal" });
  const { createDump } = await import("../db/queries/items");
  const dump = await createDump(db, "maybe buy groceries");

  const calls = [
    {
      toolName: "create_todo",
      input: {
        title: "buy groceries",
        project: "Personal",
        confidence: 0.3,
      },
    },
  ];

  const { created } = await applyToolCalls(db, dump.id, calls, [project]);

  expect(created[0]!.lowConfidence).toBe(true);
  expect(created[0]!.confidence).toBe(0.3);
});

test("applyToolCalls: todo with no matching project gets null projectId", async () => {
  const project = await createProject(db, { name: "Work", color: "#333", kind: "work" });
  const { createDump } = await import("../db/queries/items");
  const dump = await createDump(db, "call dentist");

  const calls = [
    {
      toolName: "create_todo",
      input: {
        title: "call dentist",
        project: "Health",  // not in project list
        confidence: 0.8,
      },
    },
  ];

  const { created } = await applyToolCalls(db, dump.id, calls, [project]);

  expect(created[0]!.projectId).toBeNull();
});

test("applyToolCalls: creates a calendar event with correct dates", async () => {
  const project = await createProject(db, { name: "Work", color: "#444", kind: "work" });
  const { createDump } = await import("../db/queries/items");
  const dump = await createDump(db, "team standup tomorrow at 9am");

  const startsAt = "2026-06-30T09:00:00.000Z";
  const endsAt = "2026-06-30T09:30:00.000Z";

  const calls = [
    {
      toolName: "create_event",
      input: {
        title: "team standup",
        project: "work",  // case-insensitive match
        startsAt,
        endsAt,
        confidence: 0.95,
      },
    },
  ];

  const { created } = await applyToolCalls(db, dump.id, calls, [project]);

  expect(created).toHaveLength(1);
  expect(created[0]!.kind).toBe("event");
  expect(created[0]!.title).toBe("team standup");
  expect(created[0]!.projectId).toBe(project.id);
  expect(created[0]!.lowConfidence).toBe(false);

  const acts = await listActivity(db);
  expect(acts).toHaveLength(1);
  expect(acts[0]!.entityType).toBe("event");
});

test("applyToolCalls: event with invalid startsAt is skipped, valid todo in same batch still inserts", async () => {
  const { createDump } = await import("../db/queries/items");
  const dump = await createDump(db, "dentist tomorrow; finish report");

  const calls = [
    {
      toolName: "create_event",
      input: {
        title: "dentist",
        startsAt: "not-a-date",
        endsAt: "2026-07-01T10:00:00.000Z",
        confidence: 0.9,
      },
    },
    {
      toolName: "create_todo",
      input: { title: "finish report", confidence: 0.85 },
    },
  ];

  const { created } = await applyToolCalls(db, dump.id, calls, []);

  // Only the todo should be created; the bad event is skipped
  expect(created).toHaveLength(1);
  expect(created[0]!.kind).toBe("todo");
  expect(created[0]!.title).toBe("finish report");

  // Only 1 activity row (for the todo), not 2
  const acts = await listActivity(db);
  expect(acts).toHaveLength(1);
  expect(acts[0]!.entityType).toBe("todo");
});

test("applyToolCalls: collapses duplicate create_event calls for the same slot", async () => {
  const { createDump } = await import("../db/queries/items");
  const dump = await createDump(db, "lunch at 1pm tomorrow");

  // The model sometimes emits the same create_event twice in one response.
  const event = {
    title: "Lunch",
    startsAt: "2026-06-30T13:00:00.000Z",
    endsAt: "2026-06-30T13:30:00.000Z",
    confidence: 0.9,
  };
  const calls = [
    { toolName: "create_event", input: event },
    { toolName: "create_event", input: { ...event } },
  ];

  const { created } = await applyToolCalls(db, dump.id, calls, []);

  expect(created).toHaveLength(1);
  expect(created[0]!.title).toBe("Lunch");

  // Only one row + one activity, not two.
  expect((await findEventsByTitle(db, "Lunch")).length).toBe(1);
  expect((await listActivity(db)).length).toBe(1);
});

test("applyToolCalls: dedup ignores title casing/whitespace but keeps distinct times", async () => {
  const { createDump } = await import("../db/queries/items");
  const dump = await createDump(db, "lunch tomorrow, dinner tomorrow");

  const calls = [
    { toolName: "create_event", input: { title: "Lunch", startsAt: "2026-06-30T13:00:00.000Z", endsAt: "2026-06-30T13:30:00.000Z", confidence: 0.9 } },
    { toolName: "create_event", input: { title: "  lunch ", startsAt: "2026-06-30T13:00:00.000Z", endsAt: "2026-06-30T14:00:00.000Z", confidence: 0.9 } },
    { toolName: "create_event", input: { title: "Lunch", startsAt: "2026-06-30T19:00:00.000Z", endsAt: "2026-06-30T19:30:00.000Z", confidence: 0.9 } },
  ];

  const { created } = await applyToolCalls(db, dump.id, calls, []);

  // First two collapse (same title + same start); third is a distinct slot.
  expect(created).toHaveLength(2);
});

test("applyToolCalls: collapses duplicate create_todo calls for the same slot", async () => {
  const { createDump } = await import("../db/queries/items");
  const dump = await createDump(db, "remind me to stretch at 3pm");

  const todo = { title: "stretch", scheduledStart: "2026-06-30T15:00:00.000Z", confidence: 0.8 };
  const calls = [
    { toolName: "create_todo", input: todo },
    { toolName: "create_todo", input: { ...todo } },
  ];

  const { created } = await applyToolCalls(db, dump.id, calls, []);

  expect(created).toHaveLength(1);
});

test("applyToolCalls: delete_event does not mass-delete ambiguous title matches", async () => {
  const dump = { id: "00000000-0000-0000-0000-000000000000" };
  await createEvent(db, {
    title: "2pm meeting", startsAt: new Date("2026-07-01T06:00:00Z"), endsAt: new Date("2026-07-01T06:30:00Z"),
    googleEventId: "g1", googleAccountId: "acc1", calendarId: "cal1",
  });
  await createEvent(db, {
    title: "2pm meeting", startsAt: new Date("2026-07-01T06:00:00Z"), endsAt: new Date("2026-07-01T06:30:00Z"),
  });

  const { deleted } = await applyToolCalls(db, dump.id, [
    { toolName: "delete_event", input: { title: "2pm meeting" } },
  ], []);

  expect(deleted.length).toBe(0);
  expect((await findEventsByTitle(db, "2pm meeting")).length).toBe(2);
});

test("applyToolCalls: delete_event removes one synced match only after Google succeeds", async () => {
  await createEvent(db, {
    title: "Dentist", startsAt: new Date("2026-07-01T06:00:00Z"), endsAt: new Date("2026-07-01T06:30:00Z"),
    googleEventId: "g1", googleAccountId: "acc1", calendarId: "cal1",
  });
  const googleDeletes: string[] = [];

  const { deleted } = await applyToolCalls(db, "00000000-0000-0000-0000-000000000000", [
    { toolName: "delete_event", input: { title: "Dentist" } },
  ], [], {
    deleteFromGoogle: async ({ accountId, calendarId, eventId }) => {
      googleDeletes.push(`${accountId}/${calendarId}/${eventId}`);
    },
  });

  expect(deleted.length).toBe(1);
  expect(deleted[0]!.googleEventId).toBe("g1");
  expect(googleDeletes).toEqual(["acc1/cal1/g1"]);
  expect((await findEventsByTitle(db, "Dentist")).length).toBe(0);
});

test("applyToolCalls: update_event reschedules a single match and reports it", async () => {
  await createEvent(db, {
    title: "Standup", startsAt: new Date("2026-07-01T01:00:00Z"), endsAt: new Date("2026-07-01T01:15:00Z"),
    googleEventId: "g9", googleAccountId: "acc1", calendarId: "cal1",
  });

  const { updated } = await applyToolCalls(db, "00000000-0000-0000-0000-000000000000", [
    { toolName: "update_event", input: { title: "Standup", newStartsAt: "2026-07-01T02:00:00Z", newEndsAt: "2026-07-01T02:15:00Z" } },
  ], [], {
    updateInGoogle: async () => undefined,
  });

  expect(updated.length).toBe(1);
  expect(updated[0]!.startsAt).toBe("2026-07-01T02:00:00.000Z");
  expect(updated[0]!.googleEventId).toBe("g9");
  const [row] = await findEventsByTitle(db, "Standup");
  expect(row!.startsAt.toISOString()).toBe("2026-07-01T02:00:00.000Z");
});

test("applyToolCalls: mixed calls produce multiple items and activity rows", async () => {
  const { createDump } = await import("../db/queries/items");
  const dump = await createDump(db, "finish report and meet with client friday");

  const calls = [
    {
      toolName: "create_todo",
      input: { title: "finish report", confidence: 0.85 },
    },
    {
      toolName: "create_event",
      input: {
        title: "meet with client",
        startsAt: "2026-07-03T14:00:00.000Z",
        endsAt: "2026-07-03T15:00:00.000Z",
        confidence: 0.9,
      },
    },
  ];

  const { created } = await applyToolCalls(db, dump.id, calls, []);

  expect(created).toHaveLength(2);
  expect(created[0]!.kind).toBe("todo");
  expect(created[1]!.kind).toBe("event");
  expect(created[0]!.projectId).toBeNull();
  expect(created[1]!.projectId).toBeNull();

  const acts = await listActivity(db);
  expect(acts).toHaveLength(2);
});
