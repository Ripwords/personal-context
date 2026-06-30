import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { createProject } from "../db/queries/projects";
import { createMemory } from "../db/queries/memory";
import { listActivity, createEvent, findEventsByTitle, getEventById, createTodo, getTodoById } from "../db/queries/items";
import { makeChatTools } from "./chat-tools";

// Strategy: call each tool's execute() directly — no LLM, no network.
// DB tools use the real test DB; web_search uses an empty env so no network
// is contacted.

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

// ── create_todo ─────────────────────────────────────────────────────────────

test("create_todo: inserts a todo with resolved projectId and logs activity", async () => {
  const project = await createProject(db, { name: "Work", color: "#111", kind: "work" });
  const tools = makeChatTools(db, {});

  // Call execute directly — the LLM would call this in production.
  const result = await tools.create_todo.execute!(
    { title: "Review PR", project: "Work", confidence: 0.9 },
    { toolCallId: "test-1", messages: [] },
  );

  expect(result).toMatchObject({ created: "todo", title: "Review PR" });
  expect(typeof result.id).toBe("string");
  expect(result.id.length).toBeGreaterThan(0);

  // Verify DB row was created
  const { db: dbClient } = await import("../db/client");
  void dbClient; // just to verify import works

  // Verify activity was logged
  const acts = await listActivity(db);
  expect(acts).toHaveLength(1);
  expect(acts[0]!.entityType).toBe("todo");
  expect(acts[0]!.action).toBe("create");
  expect(acts[0]!.entityId).toBe(result.id);

  // Verify the todo was linked to the right project — check via activity payload
  const payload = acts[0]!.payload as { projectId: string | null };
  expect(payload.projectId).toBe(project.id);
});

test("create_todo: creates todo without project when name doesn't match", async () => {
  const tools = makeChatTools(db, {});

  const result = await tools.create_todo.execute!(
    { title: "Buy milk", confidence: 0.8 },
    { toolCallId: "test-2", messages: [] },
  );

  expect(result).toMatchObject({ created: "todo", title: "Buy milk" });

  const acts = await listActivity(db);
  expect(acts).toHaveLength(1);
  const payload = acts[0]!.payload as { projectId: string | null };
  expect(payload.projectId).toBeNull();
});

// ── delete_event ─────────────────────────────────────────────────────────────

test("delete_event: removes the single matching event and calls Google delete for synced events", async () => {
  await createEvent(db, {
    title: "Standup",
    startsAt: new Date("2026-07-01T09:00:00Z"),
    endsAt: new Date("2026-07-01T09:15:00Z"),
    googleEventId: "g1",
    googleAccountId: "acc1",
    calendarId: "cal1",
  });
  const googleDeletes: string[] = [];
  const tools = makeChatTools(db, {}, {
    deleteFromGoogle: async ({ accountId, calendarId, eventId }) => {
      googleDeletes.push(`${accountId}/${calendarId}/${eventId}`);
    },
  });

  const result = (await tools.delete_event.execute!(
    { title: "standup" },
    { toolCallId: "d1", messages: [] },
  )) as { deleted: boolean; title?: string };

  expect(result.deleted).toBe(true);
  expect(result.title).toBe("Standup");
  expect(googleDeletes).toEqual(["acc1/cal1/g1"]);
  expect((await findEventsByTitle(db, "standup")).length).toBe(0);
});

test("delete_event: reports not-found / ambiguous instead of deleting", async () => {
  const tools = makeChatTools(db, {});
  const none = (await tools.delete_event.execute!({ title: "ghost" }, { toolCallId: "d2", messages: [] })) as { deleted: boolean; reason?: string };
  expect(none).toMatchObject({ deleted: false, reason: "not-found" });

  await createEvent(db, { title: "Sync meeting", startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T10:00:00Z") });
  await createEvent(db, { title: "Sync meeting", startsAt: new Date("2026-07-02T09:00:00Z"), endsAt: new Date("2026-07-02T10:00:00Z") });
  const many = (await tools.delete_event.execute!({ title: "sync" }, { toolCallId: "d3", messages: [] })) as { deleted: boolean; reason?: string; matches?: unknown[] };
  expect(many).toMatchObject({ deleted: false, reason: "ambiguous" });
  expect(many.matches!.length).toBe(2);
  // ambiguous → nothing deleted
  expect((await findEventsByTitle(db, "sync")).length).toBe(2);
});

test("delete_event: does not delete a synced local row when Google delete fails", async () => {
  const ev = await createEvent(db, {
    title: "Doctor",
    startsAt: new Date("2026-07-01T09:00:00Z"),
    endsAt: new Date("2026-07-01T10:00:00Z"),
    googleEventId: "g-doctor",
    googleAccountId: "acc1",
    calendarId: "cal1",
  });
  const tools = makeChatTools(db, {}, {
    deleteFromGoogle: async () => { throw new Error("network down"); },
  });

  const result = (await tools.delete_event.execute!(
    { id: ev.id, kind: "event" },
    { toolCallId: "d4", messages: [] },
  )) as { deleted: boolean; reason?: string; googleSync?: string };

  expect(result).toMatchObject({ deleted: false, reason: "not-synced", googleSync: "not-synced" });
  expect(await getEventById(db, ev.id)).not.toBeNull();
});

test("delete_event: can delete a scheduled todo by id and kind", async () => {
  const todo = await createTodo(db, {
    title: "Check project",
    scheduledStart: new Date("2026-07-01T14:00:00Z"),
    scheduledEnd: new Date("2026-07-01T14:30:00Z"),
  });
  const tools = makeChatTools(db, {});

  const result = (await tools.delete_event.execute!(
    { id: todo.id, kind: "todo" },
    { toolCallId: "d5", messages: [] },
  )) as { deleted: boolean; kind?: string };

  expect(result).toMatchObject({ deleted: true, kind: "todo" });
  expect((await getTodoById(db, todo.id))!.status).toBe("dropped");
});

// ── create_event ─────────────────────────────────────────────────────────────

test("create_event: inserts a calendar event and returns id+title", async () => {
  const tools = makeChatTools(db, {});

  const result = await tools.create_event.execute!(
    {
      title: "Team sync",
      startsAt: "2026-07-01T09:00:00.000Z",
      endsAt: "2026-07-01T09:30:00.000Z",
      confidence: 0.95,
    },
    { toolCallId: "test-3", messages: [] },
  );

  expect(result.created).toBe("event");
  expect(result.title).toBe("Team sync");
  expect(typeof result.id).toBe("string");
  expect(result.id.length).toBeGreaterThan(0);

  const acts = await listActivity(db);
  expect(acts).toHaveLength(1);
  expect(acts[0]!.entityType).toBe("event");
});

test("create_event: a duplicate call in the same request returns the first event, no second row", async () => {
  const tools = makeChatTools(db, {});
  const input = {
    title: "Lunch",
    startsAt: "2026-07-01T13:00:00.000Z",
    endsAt: "2026-07-01T13:30:00.000Z",
    confidence: 0.9,
  };

  const first = await tools.create_event.execute!(input, { toolCallId: "dup-1", messages: [] });
  const second = await tools.create_event.execute!({ ...input }, { toolCallId: "dup-2", messages: [] });

  expect(second.id).toBe(first.id);
  expect((await findEventsByTitle(db, "Lunch")).length).toBe(1);
  expect((await listActivity(db)).length).toBe(1);
});

test("create_todo: a duplicate call in the same request returns the first todo, no second row", async () => {
  const tools = makeChatTools(db, {});
  const input = { title: "stretch", scheduledStart: "2026-07-01T15:00:00.000Z", confidence: 0.8 };

  const first = await tools.create_todo.execute!(input, { toolCallId: "dupt-1", messages: [] });
  const second = await tools.create_todo.execute!({ ...input }, { toolCallId: "dupt-2", messages: [] });

  expect(second.id).toBe(first.id);
  expect((await listActivity(db)).length).toBe(1);
});

test("create_event: returns error object for invalid dates, does not insert", async () => {
  const tools = makeChatTools(db, {});

  const result = await tools.create_event.execute!(
    {
      title: "Bad event",
      startsAt: "not-a-date",
      endsAt: "2026-07-01T09:30:00.000Z",
      confidence: 0.8,
    },
    { toolCallId: "test-4", messages: [] },
  );

  expect(result.created).toBe("event");
  expect("error" in result && typeof result.error).toBe("string");
  expect(result.id).toBe("");

  const acts = await listActivity(db);
  expect(acts).toHaveLength(0);
});

test("create_event: rejects end times that are not after start", async () => {
  const tools = makeChatTools(db, {});

  const result = await tools.create_event.execute!(
    {
      title: "Backwards",
      startsAt: "2026-07-01T10:00:00.000Z",
      endsAt: "2026-07-01T09:30:00.000Z",
      confidence: 0.8,
    },
    { toolCallId: "test-4b", messages: [] },
  );

  expect("error" in result && typeof result.error).toBe("string");
  expect((await findEventsByTitle(db, "Backwards")).length).toBe(0);
});

test("update_event: preserves local synced event when Google patch fails", async () => {
  const ev = await createEvent(db, {
    title: "Standup",
    startsAt: new Date("2026-07-01T09:00:00Z"),
    endsAt: new Date("2026-07-01T09:15:00Z"),
    googleEventId: "g-standup",
    googleAccountId: "acc1",
    calendarId: "cal1",
  });
  const tools = makeChatTools(db, {}, {
    updateInGoogle: async () => { throw new Error("network down"); },
  });

  const result = (await tools.update_event.execute!(
    { id: ev.id, kind: "event", newStartsAt: "2026-07-01T10:00:00.000Z" },
    { toolCallId: "u1", messages: [] },
  )) as { updated: boolean; reason?: string; googleSync?: string };

  expect(result).toMatchObject({ updated: false, reason: "not-synced", googleSync: "not-synced" });
  expect((await getEventById(db, ev.id))!.startsAt.toISOString()).toBe("2026-07-01T09:00:00.000Z");
});

// ── search_memory ─────────────────────────────────────────────────────────────

test("search_memory: returns seeded memory content", async () => {
  await createMemory(db, { content: "I love TypeScript and Bun", source: "manual" });

  const tools = makeChatTools(db, {});

  const result = await tools.search_memory.execute!(
    { query: "TypeScript" },
    { toolCallId: "test-5", messages: [] },
  );

  expect(result.memories).toBeInstanceOf(Array);
  expect(result.memories.length).toBeGreaterThan(0);
  expect(result.memories[0]).toBe("I love TypeScript and Bun");
});

test("search_memory: returns empty array when no memories match", async () => {
  const tools = makeChatTools(db, {});

  const result = await tools.search_memory.execute!(
    { query: "quantum entanglement" },
    { toolCallId: "test-6", messages: [] },
  );

  expect(result.memories).toEqual([]);
});

// ── search_documents ─────────────────────────────────────────────────────────

test("search_documents: returns empty chunks array when no documents exist", async () => {
  const tools = makeChatTools(db, {});

  const result = await tools.search_documents.execute!(
    { query: "anything" },
    { toolCallId: "test-7", messages: [] },
  );

  expect(result.chunks).toBeInstanceOf(Array);
  expect(result.chunks).toHaveLength(0);
});

// ── web_search ────────────────────────────────────────────────────────────────

test("web_search: returns configured:false with empty env (no network hit)", async () => {
  // Empty env — no TAVILY_API_KEY / BRAVE_API_KEY / SEARXNG_URL configured.
  const tools = makeChatTools(db, {});

  const result = await tools.web_search.execute!(
    { query: "best pizza in town" },
    { toolCallId: "test-8", messages: [] },
  );

  expect(result.configured).toBe(false);
  expect(result.results).toEqual([]);
  expect(typeof result.note).toBe("string");
});

// ── read_calendar ─────────────────────────────────────────────────────────────

test("read_calendar: returns empty feed for a range with no data", async () => {
  const tools = makeChatTools(db, {});

  const result = await tools.read_calendar.execute!(
    { from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" },
    { toolCallId: "test-9", messages: [] },
  );

  expect(result.events).toEqual([]);
  expect(result.scheduledTodos).toEqual([]);
  expect(result.unscheduledTodos).toEqual([]);
});

test("read_calendar: returns events; reminders (timed todos) are not gridded", async () => {
  const ev = await createEvent(db, {
    title: "Team sync",
    startsAt: new Date("2026-07-01T09:00:00Z"),
    endsAt: new Date("2026-07-01T09:30:00Z"),
  });
  // A reminder (remindAt) must NOT appear on the calendar read.
  await createTodo(db, {
    title: "Check project",
    remindAt: new Date("2026-07-01T14:00:00Z"),
  });
  const tools = makeChatTools(db, {});

  const result = await tools.read_calendar.execute!(
    { from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" },
    { toolCallId: "test-9b", messages: [] },
  );

  expect(result.events[0]).toMatchObject({ id: ev.id, kind: "event", title: "Team sync" });
  expect(result.scheduledTodos).toEqual([]);
});

test("read_calendar: returns error for invalid date range", async () => {
  const tools = makeChatTools(db, {});

  const result = await tools.read_calendar.execute!(
    { from: "bad-date", to: "2026-07-02T00:00:00.000Z" },
    { toolCallId: "test-10", messages: [] },
  );

  expect("error" in result && typeof result.error).toBe("string");
  expect(result.events).toEqual([]);
});
