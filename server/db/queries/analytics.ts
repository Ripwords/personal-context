import { count, eq, isNull, isNotNull, and, sql } from "drizzle-orm";
import { type Db } from "../client";
import { dumps, todos, events, projects } from "../schema";

export type Analytics = {
  todos: { open: number; done: number; dropped: number; completionRate: number };
  scheduling: { scheduled: number; unscheduled: number };
  byProject: Array<{ project: string; color: string; todos: number; events: number }>;
  dumpsPerDay: Array<{ day: string; count: number }>;
  captureByHour: Array<{ hour: number; count: number }>;
  streakDays: number;
};

function toUtcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getAnalytics(db: Db, now: Date): Promise<Analytics> {
  // ── 1. Todos by status ─────────────────────────────────────────────────────
  const todosByStatus = await db
    .select({ status: todos.status, n: count() })
    .from(todos)
    .groupBy(todos.status);

  const openCount = todosByStatus.find((r) => r.status === "open")?.n ?? 0;
  const doneCount = todosByStatus.find((r) => r.status === "done")?.n ?? 0;
  const droppedCount = todosByStatus.find((r) => r.status === "dropped")?.n ?? 0;
  const total = openCount + doneCount + droppedCount;
  const completionRate =
    total === 0 ? 0 : Math.round((doneCount / total) * 100) / 100;

  // ── 2. Scheduling split (open todos only) ──────────────────────────────────
  const [scheduledRow] = await db
    .select({ n: count() })
    .from(todos)
    .where(and(eq(todos.status, "open"), isNotNull(todos.scheduledStart)));

  const [unscheduledRow] = await db
    .select({ n: count() })
    .from(todos)
    .where(and(eq(todos.status, "open"), isNull(todos.scheduledStart)));

  // ── 3. byProject ──────────────────────────────────────────────────────────
  const projectList = await db.select().from(projects);

  const todosByProject = await db
    .select({ projectId: todos.projectId, n: count() })
    .from(todos)
    .groupBy(todos.projectId);

  const eventsByProject = await db
    .select({ projectId: events.projectId, n: count() })
    .from(events)
    .groupBy(events.projectId);

  const byProject = projectList.map((p) => ({
    project: p.name,
    color: p.color,
    todos: todosByProject.find((r) => r.projectId === p.id)?.n ?? 0,
    events: eventsByProject.find((r) => r.projectId === p.id)?.n ?? 0,
  }));

  // ── 4. dumpsPerDay — last 14 days, zero-filled in TS ──────────────────────
  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - 13);
  windowStart.setUTCHours(0, 0, 0, 0);

  const dumpsPerDayRaw = await db
    .select({
      day: sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      n: count(),
    })
    .from(dumps)
    .where(sql`created_at >= ${windowStart}`)
    .groupBy(sql`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);

  const dumpsPerDayMap = new Map<string, number>(
    dumpsPerDayRaw.map((r) => [r.day, r.n]),
  );

  // Build array oldest → newest
  const dumpsPerDay: Array<{ day: string; count: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const dayStr = toUtcDateString(d);
    dumpsPerDay.push({ day: dayStr, count: dumpsPerDayMap.get(dayStr) ?? 0 });
  }

  // ── 5. captureByHour — all dumps, 0..23, zero-filled in TS ───────────────
  const captureByHourRaw = await db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')::int`,
      n: count(),
    })
    .from(dumps)
    .groupBy(sql`EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')`);

  const captureByHourMap = new Map<number, number>(
    captureByHourRaw.map((r) => [r.hour, r.n]),
  );

  const captureByHour: Array<{ hour: number; count: number }> = Array.from(
    { length: 24 },
    (_, h) => ({ hour: h, count: captureByHourMap.get(h) ?? 0 }),
  );

  // ── 6. streakDays — walk back from today counting consecutive days ─────────
  const dumpDatesRaw = await db
    .select({
      day: sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
    })
    .from(dumps)
    .groupBy(sql`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);

  const dumpDatesSet = new Set<string>(dumpDatesRaw.map((r) => r.day));

  let streakDays = 0;
  const cursor = new Date(now);
  cursor.setUTCHours(0, 0, 0, 0);
  while (dumpDatesSet.has(toUtcDateString(cursor))) {
    streakDays++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  // ── Result ─────────────────────────────────────────────────────────────────
  return {
    todos: { open: openCount, done: doneCount, dropped: droppedCount, completionRate },
    scheduling: {
      scheduled: scheduledRow?.n ?? 0,
      unscheduled: unscheduledRow?.n ?? 0,
    },
    byProject,
    dumpsPerDay,
    captureByHour,
    streakDays,
  };
}
