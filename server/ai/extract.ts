import { generateText, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import type { Db, DbOrTx } from "../db/client";
import type { Project, EventRow } from "../db/schema";
import {
  createDump,
  createTodo,
  createEvent,
  logActivity,
  findEventsByTitle,
  deleteEvent,
  updateEvent,
} from "../db/queries/items";
import { listProjects } from "../db/queries/projects";
import { extractionTools } from "./tools";
import type { TodoToolInput, EventToolInput, DeleteEventToolInput, UpdateEventToolInput } from "./tools";

// ── Types ──────────────────────────────────────────────────────────────────

/** An event affected by a delete/update, carrying its Google identity so the
 * dump endpoint can mirror the change to Google. */
export type AffectedEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  googleEventId: string | null;
  googleAccountId: string | null;
  calendarId: string | null;
};

export type ExtractResult = {
  dumpId: string;
  created: Array<{
    kind: "todo" | "event";
    id: string;
    title: string;
    projectId: string | null;
    confidence: number | null;
    lowConfidence: boolean;
  }>;
  deleted: AffectedEvent[];
  updated: AffectedEvent[];
};

export type CreatedItem = ExtractResult["created"][number];

function toAffected(e: EventRow): AffectedEvent {
  return {
    id: e.id,
    title: e.title,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    googleEventId: e.googleEventId,
    googleAccountId: e.googleAccountId,
    calendarId: e.calendarId,
  };
}

type ToolCall =
  | { toolName: "create_todo"; input: TodoToolInput }
  | { toolName: "create_event"; input: EventToolInput }
  | { toolName: "delete_event"; input: DeleteEventToolInput }
  | { toolName: "update_event"; input: UpdateEventToolInput };

// ── Shared single-item create helpers (used by both dump and chat flows) ───

/**
 * Create a single todo from tool input. Resolves project name → id, inserts
 * the todo row and logs an activity. The optional `dumpId` links the todo back
 * to a brain-dump; pass `null` for the chat flow.
 */
export async function createTodoFromInput(
  db: DbOrTx,
  inp: TodoToolInput,
  projects: ReadonlyArray<Project>,
  dumpId: string | null = null,
): Promise<CreatedItem> {
  const projectId = resolveProject(inp.project, projects);
  const lowConfidence = inp.confidence !== undefined && inp.confidence < 0.5;

  // A todo with a specific time (e.g. "remind me at 2pm") gets scheduled so it
  // lands on the calendar grid (and can be mirrored to Google).
  let scheduledStart: Date | undefined;
  let scheduledEnd: Date | undefined;
  if (inp.scheduledStart) {
    const s = new Date(inp.scheduledStart);
    if (!Number.isNaN(s.getTime())) {
      scheduledStart = s;
      const e = inp.scheduledEnd ? new Date(inp.scheduledEnd) : null;
      scheduledEnd = e && !Number.isNaN(e.getTime()) ? e : new Date(s.getTime() + 30 * 60_000);
    }
  }

  const todo = await createTodo(db, {
    title: inp.title,
    notes: inp.notes ?? null,
    projectId,
    scheduledStart,
    scheduledEnd,
    source: "ai",
    confidence: inp.confidence ?? null,
    dumpId: dumpId ?? undefined,
  });

  await logActivity(db, {
    action: "create",
    entityType: "todo",
    entityId: todo.id,
    payload: { title: todo.title, projectId, confidence: inp.confidence ?? null },
  });

  return {
    kind: "todo",
    id: todo.id,
    title: todo.title,
    projectId,
    confidence: inp.confidence ?? null,
    lowConfidence,
  };
}

/**
 * Create a single event from tool input. Returns `null` and skips the insert
 * if either date is invalid (mirrors the dump-flow behaviour in applyToolCalls).
 */
export async function createEventFromInput(
  db: DbOrTx,
  inp: EventToolInput,
  projects: ReadonlyArray<Project>,
  dumpId: string | null = null,
): Promise<CreatedItem | null> {
  const startsAt = new Date(inp.startsAt);
  const endsAt = new Date(inp.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return null;
  }

  const projectId = resolveProject(inp.project, projects);
  const lowConfidence = inp.confidence !== undefined && inp.confidence < 0.5;

  const event = await createEvent(db, {
    title: inp.title,
    startsAt,
    endsAt,
    projectId,
    dumpId: dumpId ?? undefined,
  });

  await logActivity(db, {
    action: "create",
    entityType: "event",
    entityId: event.id,
    payload: { title: event.title, projectId, confidence: inp.confidence ?? null },
  });

  return {
    kind: "event",
    id: event.id,
    title: event.title,
    projectId,
    confidence: inp.confidence ?? null,
    lowConfidence,
  };
}

// ── Pure mapper ────────────────────────────────────────────────────────────

/**
 * Maps an array of raw tool-call objects to DB inserts.
 * Pure in the sense that all side effects go through the injected `db` and
 * the project list is also injected — no model/network required.
 * All inserts happen inside a single transaction.
 */
export async function applyToolCalls(
  db: Db,
  dumpId: string,
  calls: ReadonlyArray<{ toolName: string; input: unknown }>,
  projects: ReadonlyArray<Project>,
): Promise<Pick<ExtractResult, "created" | "deleted" | "updated">> {
  return db.transaction(async (tx) => {
    const created: ExtractResult["created"] = [];
    const deleted: AffectedEvent[] = [];
    const updated: AffectedEvent[] = [];

    for (const call of calls) {
      if (call.toolName === "create_todo") {
        const inp = call.input as TodoToolInput;
        created.push(await createTodoFromInput(tx, inp, projects, dumpId));
      } else if (call.toolName === "create_event") {
        const inp = call.input as EventToolInput;
        const item = await createEventFromInput(tx, inp, projects, dumpId);
        if (item !== null) created.push(item);
      } else if (call.toolName === "delete_event") {
        const inp = call.input as DeleteEventToolInput;
        const matches = await findEventsByTitle(
          tx,
          inp.title,
          inp.from ? new Date(inp.from) : undefined,
          inp.to ? new Date(inp.to) : undefined,
        );
        // One-shot dump: remove every clear match (handles exact-title duplicates).
        for (const ev of matches) {
          const removed = await deleteEvent(tx, ev.id);
          if (removed) {
            deleted.push(toAffected(removed));
            await logActivity(tx, { action: "delete", entityType: "event", entityId: removed.id, payload: { title: removed.title } });
          }
        }
      } else if (call.toolName === "update_event") {
        const inp = call.input as UpdateEventToolInput;
        const matches = await findEventsByTitle(
          tx,
          inp.title,
          inp.from ? new Date(inp.from) : undefined,
          inp.to ? new Date(inp.to) : undefined,
        );
        // Only update an unambiguous single match — avoid mass-editing.
        if (matches.length === 1) {
          const target = matches[0]!;
          const next = await updateEvent(tx, target.id, {
            title: inp.newTitle,
            startsAt: inp.newStartsAt ? new Date(inp.newStartsAt) : undefined,
            endsAt: inp.newEndsAt ? new Date(inp.newEndsAt) : undefined,
          });
          if (next) {
            updated.push(toAffected(next));
            await logActivity(tx, { action: "update", entityType: "event", entityId: next.id, payload: { title: next.title } });
          }
        }
      }
    }

    return { created, deleted, updated };
  });
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function extractFromDump(
  db: Db,
  model: LanguageModel,
  text: string,
  timeZone?: string,
): Promise<ExtractResult> {
  const projects = await listProjects(db);
  const dump = await createDump(db, text);

  const projectNames =
    projects.length > 0
      ? projects.map((p) => p.name).join(", ")
      : "(none)";

  // Prefer the caller's timezone (the server runs in UTC) so "today"/"2pm"
  // resolve to the user's local day.
  const now = new Date();
  const timezone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const system = `You are a personal assistant helping to extract structured items from a brain dump.

The current local datetime is ${now.toLocaleString("en-US", { timeZone: timezone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} (timezone ${timezone}). Resolve all relative dates and times (today, tomorrow, Friday, this weekend, 3pm) against it, and output absolute ISO 8601 datetimes.

Interpret the user's intent and call the right tool:
- New tasks/events they mention → create_todo / create_event.
- "remove", "cancel", "delete", "drop" an existing event → delete_event (match by title, plus from/to if a date is named). NEVER create an event to represent a removal.
- "move", "reschedule", "rename", "change" an existing event → update_event (find by title, set newTitle and/or newStartsAt/newEndsAt).

For each created item:
- Pick the best-matching project name from this list (case-insensitive): ${projectNames}
  If no project fits, omit the project field.
- For events, set realistic ISO 8601 start and end datetimes based on context clues (default to tomorrow if no time mentioned).
- Set confidence (0..1) reflecting how certain you are this is a genuine todo or event.

Only call tools for things clearly implied by the text. Do not invent items.`;

  const result = await generateText({
    model,
    tools: extractionTools,
    system,
    prompt: text,
    stopWhen: stepCountIs(8),
  });

  const { created, deleted, updated } = await applyToolCalls(
    db,
    dump.id,
    result.toolCalls as ToolCall[],
    projects,
  );

  return { dumpId: dump.id, created, deleted, updated };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveProject(
  name: string | undefined,
  projects: ReadonlyArray<Project>,
): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  const match = projects.find((p) => p.name.toLowerCase() === lower);
  return match?.id ?? null;
}
