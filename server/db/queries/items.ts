import { and, gte, lt, lte, isNull, eq, ilike, desc } from "drizzle-orm";
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

/**
 * Find events whose title contains `title` (case-insensitive), optionally
 * constrained to a [from, to) window. Used to resolve "remove the X meeting".
 */
export async function findEventsByTitle(
  db: DbOrTx,
  title: string,
  from?: Date,
  to?: Date,
): Promise<EventRow[]> {
  const conds = [ilike(events.title, `%${title}%`)];
  if (from) conds.push(gte(events.startsAt, from));
  if (to) conds.push(lte(events.startsAt, to));
  return db
    .select()
    .from(events)
    .where(and(...conds))
    .orderBy(events.startsAt);
}

export async function deleteEvent(db: DbOrTx, id: string): Promise<EventRow | null> {
  const [row] = await db.delete(events).where(eq(events.id, id)).returning();
  return row ?? null;
}

export async function updateEvent(
  db: DbOrTx,
  id: string,
  fields: { title?: string; startsAt?: Date; endsAt?: Date },
): Promise<EventRow | null> {
  const set: Partial<NewEventRow> = {};
  if (fields.title !== undefined) set.title = fields.title;
  if (fields.startsAt !== undefined) set.startsAt = fields.startsAt;
  if (fields.endsAt !== undefined) set.endsAt = fields.endsAt;
  if (Object.keys(set).length === 0) {
    const [row] = await db.select().from(events).where(eq(events.id, id));
    return row ?? null;
  }
  const [row] = await db.update(events).set(set).where(eq(events.id, id)).returning();
  return row ?? null;
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
