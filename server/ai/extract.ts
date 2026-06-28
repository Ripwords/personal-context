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

type ToolCall =
  | { toolName: "create_todo"; input: TodoToolInput }
  | { toolName: "create_event"; input: EventToolInput };

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
        const projectId = resolveProject(inp.project, projects);
        const lowConfidence = inp.confidence !== undefined && inp.confidence < 0.5;

        const todo = await createTodo(tx as Db, {
          title: inp.title,
          notes: inp.notes ?? null,
          projectId,
          source: "ai",
          confidence: inp.confidence ?? null,
          dumpId,
        });

        await logActivity(tx as Db, {
          action: "create",
          entityType: "todo",
          entityId: todo.id,
          payload: { title: todo.title, projectId, confidence: inp.confidence ?? null },
        });

        created.push({
          kind: "todo",
          id: todo.id,
          title: todo.title,
          projectId,
          confidence: inp.confidence ?? null,
          lowConfidence,
        });
      } else if (call.toolName === "create_event") {
        const inp = call.input as EventToolInput;
        const projectId = resolveProject(inp.project, projects);
        const lowConfidence = inp.confidence !== undefined && inp.confidence < 0.5;

        const event = await createEvent(tx as Db, {
          title: inp.title,
          startsAt: new Date(inp.startsAt),
          endsAt: new Date(inp.endsAt),
          projectId,
          dumpId,
        });

        await logActivity(tx as Db, {
          action: "create",
          entityType: "event",
          entityId: event.id,
          payload: { title: event.title, projectId, confidence: inp.confidence ?? null },
        });

        created.push({
          kind: "event",
          id: event.id,
          title: event.title,
          projectId,
          confidence: inp.confidence ?? null,
          lowConfidence,
        });
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

  const system = `You are a personal assistant helping to extract structured items from a brain dump.

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
