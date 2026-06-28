import { describe, test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import {
  createMemory,
  listMemories,
  updateMemory,
  deleteMemory,
  searchMemories,
} from "./memory";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

describe("createMemory + listMemories", () => {
  test("creates a memory and lists it", async () => {
    const m = await createMemory(db, { content: "I prefer dark mode", source: "manual" });
    expect(m.id).toBeString();
    expect(m.content).toBe("I prefer dark mode");
    expect(m.source).toBe("manual");
    expect(m.createdAt).toBeInstanceOf(Date);

    const list = await listMemories(db);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(m.id);
  });

  test("lists memories newest-first", async () => {
    const a = await createMemory(db, { content: "first memory", source: "dump" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createMemory(db, { content: "second memory", source: "chat" });

    const list = await listMemories(db);
    expect(list[0]!.id).toBe(b.id);
    expect(list[1]!.id).toBe(a.id);
  });

  test("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await createMemory(db, { content: `memory ${i}`, source: "manual" });
    }
    const list = await listMemories(db, 3);
    expect(list).toHaveLength(3);
  });
});

describe("updateMemory", () => {
  test("updates content and returns updated row", async () => {
    const m = await createMemory(db, { content: "old content", source: "manual" });
    const updated = await updateMemory(db, m.id, "new content");
    expect(updated.id).toBe(m.id);
    expect(updated.content).toBe("new content");
  });

  test("throws if id not found", async () => {
    await expect(
      updateMemory(db, "00000000-0000-0000-0000-000000000000", "x")
    ).rejects.toThrow();
  });
});

describe("deleteMemory", () => {
  test("removes the memory", async () => {
    const m = await createMemory(db, { content: "to be deleted", source: "manual" });
    await deleteMemory(db, m.id);
    const list = await listMemories(db);
    expect(list).toHaveLength(0);
  });
});

describe("searchMemories", () => {
  test("finds memory by keyword in content", async () => {
    await createMemory(db, { content: "I always drink coffee in the morning", source: "manual" });
    await createMemory(db, { content: "I hate meetings after 4pm", source: "dump" });

    const results = await searchMemories(db, "coffee");
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain("coffee");
  });

  test("empty query returns recents", async () => {
    await createMemory(db, { content: "memory alpha", source: "manual" });
    await createMemory(db, { content: "memory beta", source: "manual" });

    const results = await searchMemories(db, "");
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test("whitespace query returns recents", async () => {
    await createMemory(db, { content: "memory gamma", source: "manual" });

    const results = await searchMemories(db, "   ");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
