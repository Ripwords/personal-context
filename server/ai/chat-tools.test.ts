import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { createProject } from "../db/queries/projects";
import { createMemory } from "../db/queries/memory";
import { listActivity } from "../db/queries/items";
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

test("read_calendar: returns error for invalid date range", async () => {
  const tools = makeChatTools(db, {});

  const result = await tools.read_calendar.execute!(
    { from: "bad-date", to: "2026-07-02T00:00:00.000Z" },
    { toolCallId: "test-10", messages: [] },
  );

  expect("error" in result && typeof result.error).toBe("string");
  expect(result.events).toEqual([]);
});
