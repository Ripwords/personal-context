import { generateText, stepCountIs } from "ai";
import type { LanguageModel } from "ai";
import type { Db } from "../db/client";
import type { Project } from "../db/schema";
import { createDump, createTodo, createEvent, logActivity } from "../db/queries/items";
import { listProjects } from "../db/queries/projects";
import { extractionTools } from "./tools";
import type { TodoToolInput, EventToolInput } from "./tools";

// ── Types ──────────────────────────────────────────────────────────────────

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
};

export type CreatedItem = ExtractResult["created"][number];

type ToolCall =
  | { toolName: "create_todo"; input: TodoToolInput }
  | { toolName: "create_event"; input: EventToolInput };

// ── Shared single-item create helpers (used by both dump and chat flows) ───

/**
 * Create a single todo from tool input. Resolves project name → id, inserts
 * the todo row and logs an activity. The optional `dumpId` links the todo back
 * to a brain-dump; pass `null` for the chat flow.
 */
export async function createTodoFromInput(
  db: Db,
  inp: TodoToolInput,
  projects: ReadonlyArray<Project>,
  dumpId: string | null = null,
): Promise<CreatedItem> {
  const projectId = resolveProject(inp.project, projects);
  const lowConfidence = inp.confidence !== undefined && inp.confidence < 0.5;

  const todo = await createTodo(db, {
    title: inp.title,
    notes: inp.notes ?? null,
    projectId,
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
  db: Db,
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
): Promise<ExtractResult["created"]> {
  return db.transaction(async (tx) => {
    const created: ExtractResult["created"] = [];

    for (const call of calls) {
      if (call.toolName === "create_todo") {
        const inp = call.input as TodoToolInput;
        const item = await createTodoFromInput(tx as Db, inp, projects, dumpId);
        created.push(item);
      } else if (call.toolName === "create_event") {
        const inp = call.input as EventToolInput;
        const item = await createEventFromInput(tx as Db, inp, projects, dumpId);
        if (item !== null) {
          created.push(item);
        }
      }
    }

    return created;
  });
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function extractFromDump(
  db: Db,
  model: LanguageModel,
  text: string,
): Promise<ExtractResult> {
  const projects = await listProjects(db);
  const dump = await createDump(db, text);

  const projectNames =
    projects.length > 0
      ? projects.map((p) => p.name).join(", ")
      : "(none)";

  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const system = `You are a personal assistant helping to extract structured items from a brain dump.

The current datetime is ${now.toISOString()} (timezone ${timezone}). Resolve all relative dates and times (today, tomorrow, Friday, this weekend, 3pm) against it, and output absolute ISO 8601 datetimes.

Extract concrete, actionable todos and calendar events from the user's text.
For each item:
- Pick the best-matching project name from this list (case-insensitive): ${projectNames}
  If no project fits, omit the project field.
- For events, set realistic ISO 8601 start and end datetimes based on context clues (default to tomorrow if no time mentioned).
- Set confidence (0..1) reflecting how certain you are this is a genuine todo or event.

Only call the tools for items that are clearly actionable or scheduled. Do not invent items not implied by the text.`;

  const result = await generateText({
    model,
    tools: extractionTools,
    system,
    prompt: text,
    stopWhen: stepCountIs(8),
  });

  const created = await applyToolCalls(db, dump.id, result.toolCalls as ToolCall[], projects);

  return { dumpId: dump.id, created };
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
