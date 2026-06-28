import { generateObject } from "ai";
import { z } from "zod";
import { eq, gte } from "drizzle-orm";
import type { LanguageModel } from "ai";
import type { Db } from "../db/client";
import { dumps, todos } from "../db/schema";
import {
  listUnscheduledTodos,
  listScheduledTodosInRange,
  logActivity,
} from "../db/queries/items";

// ── Types ──────────────────────────────────────────────────────────────────

export type WindDownProposal = {
  groups: Array<{
    project: string | null;
    items: Array<{ todoId: string; title: string }>;
  }>;
  schedule: Array<{
    todoId: string;
    title: string;
    startsAt: string;
    endsAt: string;
  }>;
};

// ── Zod schema for generateObject ─────────────────────────────────────────

const windDownSchema = z.object({
  groups: z.array(
    z.object({
      project: z.string().nullable().describe("Project name, or null if no project"),
      items: z.array(
        z.object({
          todoId: z.string().describe("The todo id from the provided list"),
          title: z.string().describe("The todo title"),
        }),
      ),
    }),
  ).describe("Open todos grouped by project"),
  schedule: z.array(
    z.object({
      todoId: z.string().describe("The todo id to schedule"),
      title: z.string().describe("The todo title"),
      startsAt: z.string().describe("ISO 8601 absolute datetime for block start"),
      endsAt: z.string().describe("ISO 8601 absolute datetime for block end"),
    }),
  ).describe("Proposed time blocks for tomorrow — no overlaps, realistic working hours"),
});

// ── summarizeDay ───────────────────────────────────────────────────────────

/**
 * Gathers today's context (dumps + open todos) and asks the model to produce
 * a wind-down proposal: todos grouped by project + a tomorrow schedule.
 */
export async function summarizeDay(
  db: Db,
  model: LanguageModel,
  now: Date,
): Promise<WindDownProposal> {
  // Start of today in local wall clock
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  // Fetch today's dumps
  const todayDumps = await db
    .select()
    .from(dumps)
    .where(gte(dumps.createdAt, startOfDay));

  // Fetch open todos: unscheduled + scheduled today
  const [unscheduled, scheduledToday] = await Promise.all([
    listUnscheduledTodos(db),
    listScheduledTodosInRange(db, startOfDay, endOfDay),
  ]);

  // Dedupe: scheduledToday may overlap with unscheduled if status changed
  const seenIds = new Set<string>();
  const openTodos = [...unscheduled, ...scheduledToday].filter((t) => {
    if (seenIds.has(t.id)) return false;
    seenIds.add(t.id);
    return true;
  });

  const dumpSummary =
    todayDumps.length > 0
      ? todayDumps.map((d) => `- ${d.text}`).join("\n")
      : "(no dumps today)";

  const todoList =
    openTodos.length > 0
      ? openTodos.map((t) => `${t.id}: ${t.title}`).join("\n")
      : "(no open todos)";

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const system = `You are a personal productivity assistant helping the user wind down their day.

The current datetime is ${now.toISOString()} (timezone: ${timezone}).

Today's brain dumps:
${dumpSummary}

Open todos (id: title):
${todoList}

Instructions:
- Deduplicate and group the OPEN todos listed above by project. If a todo has no project, use null.
- Propose realistic time blocks for TOMORROW (working hours, no overlaps) for the most important items.
- Reference ONLY the todo ids provided above — do not invent new ids.
- All datetimes must be absolute ISO 8601 strings (not relative).`;

  const { object } = await generateObject({
    model,
    schema: windDownSchema,
    system,
    prompt: "Please summarize today and propose tomorrow's schedule based on the open todos above.",
  });

  return object;
}

// ── applyWindDownSchedule ──────────────────────────────────────────────────

/**
 * Applies a wind-down schedule to the database.
 * For each block, parses the datetimes and UPDATEs the corresponding todo.
 * Skips blocks with invalid dates. Returns the count of todos actually scheduled.
 */
export async function applyWindDownSchedule(
  db: Db,
  blocks: Array<{ todoId: string; startsAt: string; endsAt: string }>,
): Promise<number> {
  return db.transaction(async (tx) => {
    let count = 0;

    for (const block of blocks) {
      const startsAt = new Date(block.startsAt);
      const endsAt = new Date(block.endsAt);

      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
        continue;
      }

      await (tx as Db)
        .update(todos)
        .set({ scheduledStart: startsAt, scheduledEnd: endsAt })
        .where(eq(todos.id, block.todoId));

      await logActivity(tx as Db, {
        action: "schedule",
        entityType: "todo",
        entityId: block.todoId,
        payload: { startsAt: block.startsAt, endsAt: block.endsAt },
      });

      count += 1;
    }

    return count;
  });
}
