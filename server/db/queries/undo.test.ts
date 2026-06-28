import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createTodo, logActivity } from "./items";
import { undoLastActivity } from "./undo";
import { eq } from "drizzle-orm";
import { todos, activities } from "../schema";

const db = getTestDb();
beforeEach(async () => {
  await truncateAll(db);
});

test("undoLastActivity removes the todo and logs an undo activity", async () => {
  const todo = await createTodo(db, { title: "buy milk" });
  await logActivity(db, { action: "create", entityType: "todo", entityId: todo.id });

  const result = await undoLastActivity(db);

  expect(result.undone).toBe(true);
  expect(result.entityType).toBe("todo");

  // todo row should be gone
  const remaining = await db.select().from(todos).where(eq(todos.id, todo.id));
  expect(remaining).toHaveLength(0);

  // an undo activity row should exist
  const undoRows = await db
    .select()
    .from(activities)
    .where(eq(activities.action, "undo"));
  expect(undoRows).toHaveLength(1);
  expect(undoRows[0]!.entityId).toBe(todo.id);
  expect(undoRows[0]!.entityType).toBe("todo");
});

test("undoLastActivity returns {undone:false} when nothing is undoable", async () => {
  const todo = await createTodo(db, { title: "already undone" });
  await logActivity(db, { action: "create", entityType: "todo", entityId: todo.id });

  // first undo
  await undoLastActivity(db);

  // second undo — nothing left
  const result = await undoLastActivity(db);
  expect(result.undone).toBe(false);
  expect(result.action).toBeUndefined();
});

test("undoLastActivity removes the latest (B), leaving the earlier (A)", async () => {
  const todoA = await createTodo(db, { title: "todo A" });
  await logActivity(db, { action: "create", entityType: "todo", entityId: todoA.id });

  const todoB = await createTodo(db, { title: "todo B" });
  await logActivity(db, { action: "create", entityType: "todo", entityId: todoB.id });

  const result = await undoLastActivity(db);
  expect(result.undone).toBe(true);

  // B should be gone
  const bRows = await db.select().from(todos).where(eq(todos.id, todoB.id));
  expect(bRows).toHaveLength(0);

  // A should still exist
  const aRows = await db.select().from(todos).where(eq(todos.id, todoA.id));
  expect(aRows).toHaveLength(1);
});
