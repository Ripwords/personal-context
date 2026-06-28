import { describe, test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { listMemories } from "../db/queries/memory";
import { saveMemories } from "./memory-extract";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

describe("saveMemories", () => {
  test("inserts non-empty facts, skips empty/whitespace, returns count", async () => {
    const count = await saveMemories(db, [
      "I prefer working in the mornings",
      "  ",
      "I use Vim keybindings",
    ]);

    expect(count).toBe(2);

    const rows = await listMemories(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.content)).toContain("I prefer working in the mornings");
    expect(rows.map((r) => r.content)).toContain("I use Vim keybindings");
  });

  test("all facts have source 'dump'", async () => {
    await saveMemories(db, ["I drink tea, not coffee"]);
    const rows = await listMemories(db);
    expect(rows[0]!.source).toBe("dump");
  });

  test("returns 0 when all facts are empty or whitespace", async () => {
    const count = await saveMemories(db, ["", "   ", "\t"]);
    expect(count).toBe(0);
    const rows = await listMemories(db);
    expect(rows).toHaveLength(0);
  });

  test("returns 0 for empty array", async () => {
    const count = await saveMemories(db, []);
    expect(count).toBe(0);
  });
});
