import { and, gte, lt, isNull, eq, desc } from "drizzle-orm";
import { type Db } from "../client";
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

export async function createTodo(db: Db, input: NewTodo): Promise<Todo> {
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

export async function createEvent(db: Db, input: NewEventRow): Promise<EventRow> {
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

export async function logActivity(db: Db, input: NewActivity): Promise<Activity> {
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
