import { and, gte, lt, isNull, eq, desc } from "drizzle-orm";
import { type Db, type DbOrTx } from "../client";
import {
  dumps,
  todos,
  events,
  activities,
  type Dump,
  type NewTodo,
  type Todo,
  type NewEventRow,
  type EventRow,
  type NewActivity,
  type Activity,
} from "../schema";

export async function createDump(db: Db, text: string): Promise<Dump> {
  const [row] = await db.insert(dumps).values({ text }).returning();
  return row!;
}

export async function createTodo(db: DbOrTx, input: NewTodo): Promise<Todo> {
  const [row] = await db.insert(todos).values(input).returning();
  return row!;
}

export async function listUnscheduledTodos(db: Db): Promise<Todo[]> {
  return db
    .select()
    .from(todos)
    .where(and(eq(todos.status, "open"), isNull(todos.scheduledStart)))
    .orderBy(desc(todos.createdAt));
}

export async function listScheduledTodosInRange(
  db: Db,
  from: Date,
  to: Date,
): Promise<Todo[]> {
  return db
    .select()
    .from(todos)
    .where(and(gte(todos.scheduledStart, from), lt(todos.scheduledStart, to)))
    .orderBy(todos.scheduledStart);
}

export async function createEvent(db: DbOrTx, input: NewEventRow): Promise<EventRow> {
  const [row] = await db.insert(events).values(input).returning();
  return row!;
}

export async function listEventsInRange(
  db: Db,
  from: Date,
  to: Date,
): Promise<EventRow[]> {
  return db
    .select()
    .from(events)
    .where(and(gte(events.startsAt, from), lt(events.startsAt, to)))
    .orderBy(events.startsAt);
}

export async function logActivity(db: DbOrTx, input: NewActivity): Promise<Activity> {
  const [row] = await db.insert(activities).values(input).returning();
  return row!;
}

export async function listActivity(db: Db, limit = 50): Promise<Activity[]> {
  return db
    .select()
    .from(activities)
    .orderBy(desc(activities.createdAt))
    .limit(limit);
}

export async function dropTodo(db: DbOrTx, id: string): Promise<Todo | null> {
  const [row] = await db
    .update(todos)
    .set({ status: "dropped" })
    .where(eq(todos.id, id))
    .returning();
  return row ?? null;
}

export async function dropAllUnscheduledTodos(db: DbOrTx): Promise<number> {
  const rows = await db
    .update(todos)
    .set({ status: "dropped" })
    .where(and(eq(todos.status, "open"), isNull(todos.scheduledStart)))
    .returning({ id: todos.id });
  return rows.length;
}
