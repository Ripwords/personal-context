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

/** The local calendar date (YYYY-MM-DD) of an instant in the given IANA zone. */
function localDateStr(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Step a YYYY-MM-DD calendar date by whole days. Anchored at UTC midnight and
 * only ever sliced back to a date, so DST never shifts the result.
 */
function stepDays(dateStr: string, deltaDays: number): string {
  const anchor = new Date(`${dateStr}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
  return anchor.toISOString().slice(0, 10);
}

/**
 * Aggregate analytics. Day/hour buckets are computed in `timeZone` (an IANA zone
 * like "America/New_York") so a dump near local midnight lands on the right local
 * day/hour. Defaults to UTC.
 */
export async function getAnalytics(db: Db, now: Date, timeZone = "UTC"): Promise<Analytics> {
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
  // "scheduled" = todos placed on the calendar as time-blocks (scheduledStart).
  // "unscheduled" = backlog: neither a block nor a reminder (matches the rail).
  const [scheduledRow] = await db
    .select({ n: count() })
    .from(todos)
    .where(and(eq(todos.status, "open"), isNotNull(todos.scheduledStart)));

  const [unscheduledRow] = await db
    .select({ n: count() })
    .from(todos)
    .where(and(eq(todos.status, "open"), isNull(todos.scheduledStart), isNull(todos.remindAt)));

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

  const todayStr = localDateStr(now, timeZone);

  // ── 4. dumpsPerDay — last 14 LOCAL days, zero-filled in TS ────────────────
  // Over-inclusive UTC filter (start of today-14 in UTC ≤ local start of
  // today-13 for any real zone); rows outside the window just miss the map.
  const windowStart = new Date(`${stepDays(todayStr, -14)}T00:00:00Z`);

  const dumpsPerDayRaw = await db
    .select({
      day: sql<string>`to_char(created_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`,
      n: count(),
    })
    .from(dumps)
    .where(sql`created_at >= ${windowStart}`)
    // GROUP BY ordinal: a parameterised AT TIME ZONE expression repeated in the
    // GROUP BY is treated as a different param ($1 vs $3) and rejected, so group
    // by the first output column instead.
    .groupBy(sql`1`);

  const dumpsPerDayMap = new Map<string, number>(
    dumpsPerDayRaw.map((r) => [r.day, r.n]),
  );

  // Build array oldest → newest
  const dumpsPerDay: Array<{ day: string; count: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const dayStr = stepDays(todayStr, -i);
    dumpsPerDay.push({ day: dayStr, count: dumpsPerDayMap.get(dayStr) ?? 0 });
  }

  // ── 5. captureByHour — all dumps, 0..23 LOCAL, zero-filled in TS ──────────
  const captureByHourRaw = await db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM created_at AT TIME ZONE ${timeZone})::int`,
      n: count(),
    })
    .from(dumps)
    .groupBy(sql`1`);

  const captureByHourMap = new Map<number, number>(
    captureByHourRaw.map((r) => [r.hour, r.n]),
  );

  const captureByHour: Array<{ hour: number; count: number }> = Array.from(
    { length: 24 },
    (_, h) => ({ hour: h, count: captureByHourMap.get(h) ?? 0 }),
  );

  // ── 6. streakDays — walk back from today (local) counting consecutive days ─
  const dumpDatesRaw = await db
    .select({
      day: sql<string>`to_char(created_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`,
    })
    .from(dumps)
    .groupBy(sql`1`);

  const dumpDatesSet = new Set<string>(dumpDatesRaw.map((r) => r.day));

  let streakDays = 0;
  let cursor = todayStr;
  while (dumpDatesSet.has(cursor)) {
    streakDays++;
    cursor = stepDays(cursor, -1);
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
