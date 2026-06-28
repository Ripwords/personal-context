// server/db/client.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "./test-helpers";
import { projects } from "./schema";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

test("can insert and read a row against the test DB", async () => {
  await db.insert(projects).values({ name: "Tmp", color: "#000", kind: "other" });
  const rows = await db.select().from(projects);
  expect(rows.length).toBe(1);
  expect(rows[0]!.name).toBe("Tmp");
});

test("truncateAll empties tables", async () => {
  await db.insert(projects).values({ name: "Tmp", color: "#000", kind: "other" });
  await truncateAll(db);
  const rows = await db.select().from(projects);
  expect(rows.length).toBe(0);
});
