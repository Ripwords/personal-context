import { and, gte, lt, lte, isNull, isNotNull, eq, desc, sql } from "drizzle-orm";
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

export type CalendarItemKind = "event" | "todo";

export type CalendarItemTarget =
  | ({ kind: "event" } & EventRow)
  | ({ kind: "todo" } & Todo);

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function createDump(db: Db, text: string): Promise<Dump> {
  const [row] = await db.insert(dumps).values({ text }).returning();
  return row!;
}

export async function createTodo(db: DbOrTx, input: NewTodo): Promise<Todo> {
  const [row] = await db.insert(todos).values(input).returning();
  return row!;
}

/**
 * Backlog: open todos that are neither scheduled as a calendar block
 * (`scheduledStart`) nor a reminder (`remindAt`). These populate the unscheduled
 * rail and are the drag-to-schedule source.
 */
export async function listUnscheduledTodos(db: Db): Promise<Todo[]> {
  return db
    .select()
    .from(todos)
    .where(and(eq(todos.status, "open"), isNull(todos.scheduledStart), isNull(todos.remindAt)))
    .orderBy(desc(todos.createdAt));
}

/**
 * Open reminders (todos with a notify-at time), soonest first. Powers the
 * reminders rail and the foreground notifier. `remindAt` is the reminder time;
 * `notifiedAt` lets the client skip ones already shown.
 */
export async function listReminders(db: Db): Promise<Todo[]> {
  return db
    .select()
    .from(todos)
    .where(and(eq(todos.status, "open"), isNotNull(todos.remindAt)))
    .orderBy(todos.remindAt);
}

/** Mark a reminder's notification as fired so it never double-fires. */
export async function markReminderNotified(db: DbOrTx, id: string, at: Date): Promise<Todo | null> {
  const [row] = await db.update(todos).set({ notifiedAt: at }).where(eq(todos.id, id)).returning();
  return row ?? null;
}

export async function listScheduledTodosInRange(
  db: Db,
  from: Date,
  to: Date,
): Promise<Todo[]> {
  return db
    .select()
    .from(todos)
    .where(
      and(
        eq(todos.status, "open"),
        gte(todos.scheduledStart, from),
        lt(todos.scheduledStart, to),
      ),
    )
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
  const conds = [sql`${events.title} ILIKE ${`%${escapeLikePattern(title)}%`} ESCAPE '\\'`];
  if (from) conds.push(gte(events.startsAt, from));
  if (to) conds.push(lte(events.startsAt, to));
  return db
    .select()
    .from(events)
    .where(and(...conds))
    .orderBy(events.startsAt);
}

export async function findScheduledTodosByTitle(
  db: DbOrTx,
  title: string,
  from?: Date,
  to?: Date,
): Promise<Todo[]> {
  const conds = [
    eq(todos.status, "open"),
    sql`${todos.title} ILIKE ${`%${escapeLikePattern(title)}%`} ESCAPE '\\'`,
  ];
  if (from) conds.push(gte(todos.scheduledStart, from));
  if (to) conds.push(lte(todos.scheduledStart, to));
  return db
    .select()
    .from(todos)
    .where(and(...conds))
    .orderBy(todos.scheduledStart);
}

export async function getEventById(db: DbOrTx, id: string): Promise<EventRow | null> {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  return row ?? null;
}

export async function getTodoById(db: DbOrTx, id: string): Promise<Todo | null> {
  const [row] = await db.select().from(todos).where(eq(todos.id, id));
  return row ?? null;
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

export async function updateTodoSchedule(
  db: DbOrTx,
  id: string,
  fields: {
    title?: string;
    scheduledStart?: Date | null;
    scheduledEnd?: Date | null;
    remindAt?: Date | null;
    googleEventId?: string | null;
    googleAccountId?: string | null;
    calendarId?: string | null;
    syncStatus?: "local" | "synced" | "error";
  },
): Promise<Todo | null> {
  const set: Partial<NewTodo> = {};
  if (fields.title !== undefined) set.title = fields.title;
  // `scheduledStart`/`scheduledEnd` are calendar-block scheduling now (not the
  // reminder time), so changing them does not touch `notifiedAt`.
  if (fields.scheduledStart !== undefined) set.scheduledStart = fields.scheduledStart;
  if (fields.scheduledEnd !== undefined) set.scheduledEnd = fields.scheduledEnd;
  if (fields.remindAt !== undefined) {
    set.remindAt = fields.remindAt;
    // Rescheduling a reminder must let it fire again at its new time.
    set.notifiedAt = null;
  }
  if (fields.googleEventId !== undefined) set.googleEventId = fields.googleEventId;
  if (fields.googleAccountId !== undefined) set.googleAccountId = fields.googleAccountId;
  if (fields.calendarId !== undefined) set.calendarId = fields.calendarId;
  if (fields.syncStatus !== undefined) set.syncStatus = fields.syncStatus;
  if (Object.keys(set).length === 0) {
    const [row] = await db.select().from(todos).where(eq(todos.id, id));
    return row ?? null;
  }
  const [row] = await db.update(todos).set(set).where(eq(todos.id, id)).returning();
  return row ?? null;
}

export async function resolveCalendarItemById(
  db: DbOrTx,
  kind: CalendarItemKind,
  id: string,
): Promise<CalendarItemTarget | null> {
  if (kind === "event") {
    const row = await getEventById(db, id);
    return row ? { ...row, kind } : null;
  }
  const row = await getTodoById(db, id);
  return row ? { ...row, kind } : null;
}

export async function findCalendarItemsByTitle(
  db: DbOrTx,
  title: string,
  from?: Date,
  to?: Date,
): Promise<CalendarItemTarget[]> {
  const eventRows = await findEventsByTitle(db, title, from, to);
  const todoRows = await findScheduledTodosByTitle(db, title, from, to);
  const out: CalendarItemTarget[] = [
    ...eventRows.map((row) => ({ ...row, kind: "event" as const })),
    ...todoRows.map((row) => ({ ...row, kind: "todo" as const })),
  ];
  return out.sort((a, b) => {
    const aStart = a.kind === "event" ? a.startsAt : (a.scheduledStart ?? a.createdAt);
    const bStart = b.kind === "event" ? b.startsAt : (b.scheduledStart ?? b.createdAt);
    return aStart.getTime() - bStart.getTime();
  });
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
    .where(and(eq(todos.status, "open"), isNull(todos.scheduledStart), isNull(todos.remindAt)))
    .returning({ id: todos.id });
  return rows.length;
}
