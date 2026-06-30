import { generateText, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import type { Db, DbOrTx } from "../db/client";
import type { Project } from "../db/schema";
import {
  createDump,
  createTodo,
  createEvent,
  logActivity,
  findCalendarItemsByTitle,
  resolveCalendarItemById,
  type CalendarItemKind,
  type CalendarItemTarget,
} from "../db/queries/items";
import { listProjects } from "../db/queries/projects";
import { classifyProjectByKeywords } from "./classify-project";
import { extractionTools } from "./tools";
import type { TodoToolInput, EventToolInput, DeleteEventToolInput, UpdateEventToolInput } from "./tools";
import {
  deleteCalendarItem,
  updateCalendarItem,
  type CalendarMutationDeps,
} from "../calendar-sync/mutations";

// ── Types ──────────────────────────────────────────────────────────────────

/** An event affected by a delete/update, carrying its Google identity so the
 * dump endpoint can mirror the change to Google. */
export type AffectedEvent = {
  kind: "event" | "todo";
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
    needsReview: boolean;
  }>;
  deleted: AffectedEvent[];
  updated: AffectedEvent[];
};

export type CreatedItem = ExtractResult["created"][number];

function toAffected(e: { kind: "event" | "todo"; id: string; title: string; startsAt?: Date; endsAt?: Date; scheduledStart?: Date | null; scheduledEnd?: Date | null; createdAt: Date; googleEventId: string | null; googleAccountId: string | null; calendarId: string | null }): AffectedEvent {
  const startsAt = e.kind === "event" ? e.startsAt! : (e.scheduledStart ?? e.createdAt);
  const endsAt = e.kind === "event" ? e.endsAt! : (e.scheduledEnd ?? new Date(startsAt.getTime() + 30 * 60_000));
  return {
    kind: e.kind,
    id: e.id,
    title: e.title,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
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
  const { projectId, needsReview: tagNeedsReview } = resolveProject(
    inp.project, projects, `${inp.title} ${inp.notes ?? ""}`,
  );
  const lowConfidence = inp.confidence !== undefined && inp.confidence < 0.5;
  const needsReview = lowConfidence || tagNeedsReview;

  // A reminder carries a notify-at time in `remindAt` (a reminder is a point in
  // time, so there is no end). It fires a browser notification and is never
  // gridded or mirrored to Google. Plain todos have no time.
  let remindAt: Date | undefined;
  if (inp.remindAt) {
    const s = new Date(inp.remindAt);
    if (!Number.isNaN(s.getTime())) remindAt = s;
  }

  const todo = await createTodo(db, {
    title: inp.title,
    notes: inp.notes ?? null,
    projectId,
    remindAt,
    source: "ai",
    confidence: inp.confidence ?? null,
    needsReview,
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
    needsReview,
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
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime()) {
    return null;
  }

  const { projectId, needsReview: tagNeedsReview } = resolveProject(
    inp.project, projects, `${inp.title} ${inp.notes ?? ""}`,
  );
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
    // Events don't persist needsReview (they're explicit calendar items), but we
    // surface a tag hint in the response so the dump UI can flag a bad guess.
    needsReview: lowConfidence || tagNeedsReview,
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
  mutationDeps: CalendarMutationDeps = {},
): Promise<Pick<ExtractResult, "created" | "deleted" | "updated">> {
  return db.transaction(async (tx) => {
    const created: ExtractResult["created"] = [];
    const deleted: AffectedEvent[] = [];
    const updated: AffectedEvent[] = [];

    async function resolveTargets(input: {
      id?: string;
      kind?: CalendarItemKind;
      title?: string;
      from?: string;
      to?: string;
    }): Promise<CalendarItemTarget[]> {
      if (input.id && input.kind) {
        const target = await resolveCalendarItemById(tx, input.kind, input.id);
        return target ? [target] : [];
      }
      if (!input.title?.trim()) return [];
      return findCalendarItemsByTitle(
        tx,
        input.title,
        input.from ? new Date(input.from) : undefined,
        input.to ? new Date(input.to) : undefined,
      );
    }

    // Guardrail: models occasionally emit the same create_* tool call twice in
    // one response (e.g. "lunch at 1pm" → two identical Lunch events). Collapse
    // duplicate create calls that target the same title + time slot so a single
    // request can't silently fan out into multiple rows.
    const seenCreateKeys = new Set<string>();

    for (const call of calls) {
      if (call.toolName === "create_todo") {
        const inp = call.input as TodoToolInput;
        const key = createKey("todo", inp.title, inp.remindAt);
        if (seenCreateKeys.has(key)) continue;
        created.push(await createTodoFromInput(tx, inp, projects, dumpId));
        seenCreateKeys.add(key);
      } else if (call.toolName === "create_event") {
        const inp = call.input as EventToolInput;
        const key = createKey("event", inp.title, inp.startsAt);
        if (seenCreateKeys.has(key)) continue;
        const item = await createEventFromInput(tx, inp, projects, dumpId);
        if (item !== null) {
          created.push(item);
          seenCreateKeys.add(key);
        }
      } else if (call.toolName === "delete_event") {
        const inp = call.input as DeleteEventToolInput;
        const matches = await resolveTargets(inp);
        // Destructive one-shot dump actions must be unambiguous. If multiple
        // items match the title/date, do nothing and let the assistant ask a
        // clarification in chat-style flows.
        if (matches.length === 1) {
          const removed = await deleteCalendarItem(tx, matches[0]!, mutationDeps);
          if (removed.ok) {
            deleted.push(toAffected(removed.item));
            await logActivity(tx, {
              action: "delete",
              entityType: removed.item.kind,
              entityId: removed.item.id,
              payload: { title: removed.item.title, googleSync: removed.googleSync },
            });
          }
        }
      } else if (call.toolName === "update_event") {
        const inp = call.input as UpdateEventToolInput;
        const matches = await resolveTargets(inp);
        // Only update an unambiguous single match — avoid mass-editing.
        if (matches.length === 1) {
          const next = await updateCalendarItem(tx, matches[0]!, {
            title: inp.newTitle,
            startsAt: inp.newStartsAt ? new Date(inp.newStartsAt) : undefined,
            endsAt: inp.newEndsAt ? new Date(inp.newEndsAt) : undefined,
          }, mutationDeps);
          if (next.ok) {
            updated.push(toAffected(next.item));
            await logActivity(tx, {
              action: "update",
              entityType: next.item.kind,
              entityId: next.item.id,
              payload: { title: next.item.title, googleSync: next.googleSync },
            });
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
  mutationDeps: CalendarMutationDeps = {},
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

Interpret the user's intent and call the right tool. Three kinds of item:
- EVENT (create_event): a calendar block — meeting, appointment, call, or anything with other people, a place, or a span of time. Goes on the calendar.
- REMINDER (create_todo with remindAt): a personal nudge to be notified about at a specific time ("remind me to take meds at 8", "ping me at 2"). Fires a notification; NOT on the calendar.
- PLAIN TODO (create_todo, no remindAt): a task with no specific time. A casually-mentioned rough day/time goes in notes, not remindAt.
- This is a one-shot extraction (you cannot ask questions). When unsure event-vs-reminder, pick the most likely and set a lower confidence so it is flagged for review.
- "remove", "cancel", "delete", "drop" an existing calendar item → delete_event (match by title, plus from/to if a date is named). NEVER create an event to represent a removal.
- "move", "reschedule", "rename", "change" an existing calendar item → update_event (find by title, set newTitle and/or newStartsAt/newEndsAt). Never create a duplicate to represent an edit.

For each created item:
- Pick the best-matching project name from this list (case-insensitive): ${projectNames}
  If no project fits, omit the project field.
- For events, require a clear date and start time (or enough context to infer both confidently). If date/time is missing or ambiguous, do not create an event.
- Event endsAt must be after startsAt. Use a normal duration (30-60 minutes) when the end time is not stated.
- Set confidence (0..1) reflecting how certain you are this is a genuine todo or event.

Only call tools for things clearly implied by the text. Do not invent items.
Create each item exactly once. Never emit two create_event/create_todo calls for the same item — one mention of "lunch at 1pm" is ONE event, not two.`;

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
    mutationDeps,
  );

  return { dumpId: dump.id, created, deleted, updated };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Dedup key for a create_* call: kind + normalized title + time slot. Two calls
 * that target the same title and the same start instant are treated as the same
 * item, regardless of casing/whitespace or a differing end time. An undefined
 * time (anytime todo) folds into a single "none" slot per title.
 */
export function createKey(
  kind: "todo" | "event",
  title: string,
  start: string | undefined,
): string {
  const normTitle = title.trim().toLowerCase().replace(/\s+/g, " ");
  const slot = start ? new Date(start).getTime() : "none";
  return `${kind} ${normTitle} ${slot}`;
}

/**
 * Resolve a project for an item. First trust an exact name the model returned;
 * otherwise fall back to the deterministic keyword classifier over the item's
 * text (title + notes). `needsReview` is set when the tag is uncertain — the
 * model named a project we don't have, or we only got a weak keyword guess — so
 * the UI can flag it for one-tap correction.
 */
export function resolveProject(
  name: string | undefined,
  projects: ReadonlyArray<Project>,
  text = "",
): { projectId: string | null; needsReview: boolean } {
  if (name) {
    const lower = name.toLowerCase();
    const exact = projects.find((p) => p.name.toLowerCase() === lower);
    if (exact) return { projectId: exact.id, needsReview: false };
    // The model named a project that doesn't exist — try to recover via keywords,
    // but flag for review either way since the model's tag was off.
    const guess = classifyProjectByKeywords(`${name} ${text}`, projects);
    return { projectId: guess.projectId, needsReview: true };
  }
  // No model tag: keyword-classify the text. A single weak hit is review-worthy.
  const guess = classifyProjectByKeywords(text, projects);
  return { projectId: guess.projectId, needsReview: guess.projectId !== null && guess.score < 2 };
}
