import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { Db } from "../db/client";
import { listProjects } from "../db/queries/projects";
import { searchMemories } from "../db/queries/memory";
import { searchDocuments } from "../db/queries/documents";
import { getCalendarFeed } from "../db/queries/calendar-feed";
import { makeWebSearch } from "./web-search";
import { createTodoFromInput, createEventFromInput, createKey } from "./extract";
import { findCalendarItemsByTitle, resolveCalendarItemById, type CalendarItemKind, type CalendarItemTarget } from "../db/queries/items";
import { todoToolSchema, eventToolSchema, updateEventToolSchema } from "./tools";
import type { WritebackItem } from "../calendar-sync/writeback";
import { isAuthError } from "../calendar-sync/google-rest";
import {
  calendarItemSummary,
  deleteCalendarItem,
  updateCalendarItem,
  type CalendarMutationDeps,
  type DeleteFromGoogleFn,
  type GoogleSync,
  type UpdateInGoogleFn,
} from "../calendar-sync/mutations";

/** Mirror an AI-created item to the user's Braindump Google calendar (best-effort). */
export type MirrorFn = (item: WritebackItem) => Promise<void>;

export interface ChatToolDeps {
  mirror?: MirrorFn;
  deleteFromGoogle?: DeleteFromGoogleFn;
  updateInGoogle?: UpdateInGoogleFn;
}

/**
 * Build the AI SDK v7 tool set for the chat flow.
 * Tools are called BY the LLM — their `execute` functions run server-side DB
 * queries/writes and return JSON-serializable data.
 *
 * No model or LLM call is needed here; `makeChatTools` only needs a DB
 * connection and the process env (for web-search key detection).
 */
export function makeChatTools(
  db: Db,
  env: Record<string, string | undefined> = process.env,
  deps: ChatToolDeps = {},
): ToolSet {
  const { mirror, deleteFromGoogle, updateInGoogle } = deps;
  const mutationDeps: CalendarMutationDeps = { deleteFromGoogle, updateInGoogle };

  // Guardrail: within a single chat request, a model may call create_event /
  // create_todo more than once for the same item (same title + time slot).
  // Remember the first successful result per slot and replay it instead of
  // inserting a duplicate row + re-mirroring to Google.
  const createdBySlot = new Map<string, { id: string; title: string; googleSync: GoogleSync }>();

  // Mirror to Google without ever failing the tool call; report the outcome.
  async function safeMirror(item: WritebackItem): Promise<GoogleSync> {
    if (!mirror) return "off";
    try {
      await mirror(item);
      return "synced";
    } catch (err) {
      console.error(`chat writeback failed for ${item.kind} ${item.id}:`, err);
      return isAuthError(err) ? "needs-reauth" : "not-synced";
    }
  }

  function validDate(value: string | undefined): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  async function resolveTarget(input: {
    id?: string;
    kind?: CalendarItemKind;
    title?: string;
    from?: string;
    to?: string;
  }): Promise<
    | { ok: true; target: CalendarItemTarget }
    | { ok: false; reason: "not-found" | "ambiguous" | "missing-target"; query?: string; matches?: ReturnType<typeof calendarItemSummary>[] }
  > {
    if (input.id) {
      if (!input.kind) return { ok: false, reason: "missing-target", query: input.id };
      const target = await resolveCalendarItemById(db, input.kind, input.id);
      return target ? { ok: true, target } : { ok: false, reason: "not-found", query: input.id };
    }
    if (!input.title?.trim()) return { ok: false, reason: "missing-target" };
    const matches = await findCalendarItemsByTitle(
      db,
      input.title,
      validDate(input.from),
      validDate(input.to),
    );
    if (matches.length === 0) return { ok: false, reason: "not-found", query: input.title };
    if (matches.length > 1) {
      return {
        ok: false,
        reason: "ambiguous",
        matches: matches.map(calendarItemSummary),
      };
    }
    return { ok: true, target: matches[0]! };
  }

  return {
    create_todo: tool({
      description:
        "Create a concrete actionable todo item. Resolve the project name if provided.",
      inputSchema: todoToolSchema,
      execute: async (inp) => {
        const slot = createKey("todo", inp.title, inp.remindAt);
        const prior = createdBySlot.get(slot);
        if (prior) return { created: "todo" as const, ...prior, duplicate: true };

        const projects = await listProjects(db);
        const item = await createTodoFromInput(db, inp, projects, null);
        // A reminder fires a local browser notification — it is NOT mirrored to
        // Google (reminders own notifications; events own the calendar).
        const result = { id: item.id, title: item.title, googleSync: "off" as const };
        createdBySlot.set(slot, result);
        return { created: "todo" as const, ...result, remindAt: inp.remindAt ?? null };
      },
    }),

    create_event: tool({
      description:
        "Create a calendar event. Provide ISO 8601 start and end datetimes.",
      inputSchema: eventToolSchema,
      execute: async (inp) => {
        const slot = createKey("event", inp.title, inp.startsAt);
        const prior = createdBySlot.get(slot);
        if (prior) return { created: "event" as const, ...prior, duplicate: true };

        const projects = await listProjects(db);
        const item = await createEventFromInput(db, inp, projects, null);
        if (item === null) {
          return {
            created: "event" as const,
            id: "",
            title: inp.title,
            error: "Invalid startsAt or endsAt date — event was not created.",
          };
        }
        const googleSync = await safeMirror({
          kind: "event",
          id: item.id,
          title: item.title,
          startsAt: new Date(inp.startsAt),
          endsAt: new Date(inp.endsAt),
        });
        createdBySlot.set(slot, { id: item.id, title: item.title, googleSync });
        return { created: "event" as const, id: item.id, title: item.title, googleSync };
      },
    }),

    delete_event: tool({
      description:
        "Remove/cancel/delete an existing calendar item the user no longer wants. " +
        "Prefer id+kind from read_calendar; otherwise match by title and optional date range. " +
        "Use this for any 'remove', 'cancel', 'delete', or 'drop' request — never create an event to represent a removal.",
      inputSchema: z.object({
        id: z.string().optional().describe("Stable id from read_calendar. Prefer this."),
        kind: z.enum(["event", "todo"]).optional().describe("Item kind from read_calendar when id is provided"),
        title: z.string().optional().describe("Words from the item's title to match (case-insensitive substring), only if id is not known"),
        from: z.string().optional().describe("ISO 8601 start of the day/range to search, if the user named a date"),
        to: z.string().optional().describe("ISO 8601 end of the day/range to search"),
      }),
      execute: async ({ id, kind, title, from, to }) => {
        const resolved = await resolveTarget({ id, kind: kind as CalendarItemKind | undefined, title, from, to });
        if (!resolved.ok) {
          return {
            deleted: false as const,
            reason: resolved.reason,
            query: resolved.query ?? title,
            matches: resolved.matches,
          };
        }
        const result = await deleteCalendarItem(db, resolved.target, mutationDeps);
        if (!result.ok) {
          return {
            deleted: false as const,
            reason: result.reason,
            googleSync: result.googleSync,
            query: title ?? id,
          };
        }
        return { deleted: true as const, ...calendarItemSummary(result.item), googleSync: result.googleSync };
      },
    }),

    update_event: tool({
      description:
        "Modify an existing calendar item — rename and/or reschedule it. Use for 'move', " +
        "'reschedule', 'rename', 'change' requests. Prefer id+kind from read_calendar; otherwise find by title/date.",
      inputSchema: updateEventToolSchema,
      execute: async ({ id, kind, title, from, to, newTitle, newStartsAt, newEndsAt }) => {
        const resolved = await resolveTarget({ id, kind: kind as CalendarItemKind | undefined, title, from, to });
        if (!resolved.ok) {
          return {
            updated: false as const,
            reason: resolved.reason,
            query: resolved.query ?? title,
            matches: resolved.matches,
          };
        }
        const result = await updateCalendarItem(db, resolved.target, {
          title: newTitle,
          startsAt: validDate(newStartsAt),
          endsAt: validDate(newEndsAt),
        }, mutationDeps);
        if (!result.ok) {
          return {
            updated: false as const,
            reason: result.reason,
            googleSync: result.googleSync,
            query: title ?? id,
          };
        }
        return { updated: true as const, ...calendarItemSummary(result.item), googleSync: result.googleSync };
      },
    }),

    search_memory: tool({
      description: "Search the user's personal memory store for relevant context.",
      inputSchema: z.object({
        query: z.string().describe("Free-text search query"),
      }),
      execute: async ({ query }) => {
        const results = await searchMemories(db, query);
        return { memories: results.map((m) => m.content) };
      },
    }),

    search_documents: tool({
      description: "Search uploaded documents for relevant chunks.",
      inputSchema: z.object({
        query: z.string().describe("Free-text search query"),
      }),
      execute: async ({ query }) => {
        const results = await searchDocuments(db, query);
        return {
          chunks: results.map((r) => ({ filename: r.filename, content: r.content })),
        };
      },
    }),

    web_search: tool({
      description: "Search the web for up-to-date information.",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
      }),
      execute: async ({ query }) => {
        return makeWebSearch(env)(query);
      },
    }),

    read_calendar: tool({
      description:
        "Read the user's calendar for a date range. Returns events and todos.",
      inputSchema: z.object({
        from: z.string().describe("ISO 8601 start of range (inclusive)"),
        to: z.string().describe("ISO 8601 end of range (exclusive)"),
      }),
      execute: async ({ from, to }) => {
        const fromDate = new Date(from);
        const toDate = new Date(to);
        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
          return {
            events: [] as Array<{ title: string; startsAt: string; endsAt: string }>,
            scheduledTodos: [] as Array<{ title: string }>,
            unscheduledTodos: [] as Array<{ title: string }>,
            error: "Invalid from or to date.",
          };
        }
        const feed = await getCalendarFeed(db, fromDate, toDate);
        return {
          events: feed.events.map((e) => ({
            id: e.id,
            kind: "event" as const,
            title: e.title,
            startsAt: e.startsAt.toISOString(),
            endsAt: e.endsAt.toISOString(),
          })),
          scheduledTodos: feed.scheduledTodos.map((t) => ({
            id: t.id,
            kind: "todo" as const,
            title: t.title,
            startsAt: t.scheduledStart?.toISOString() ?? "",
            endsAt: (t.scheduledEnd ?? (t.scheduledStart ? new Date(t.scheduledStart.getTime() + 30 * 60_000) : null))?.toISOString() ?? "",
          })),
          unscheduledTodos: feed.unscheduledTodos.map((t) => ({ id: t.id, kind: "todo" as const, title: t.title })),
        };
      },
    }),
  };
}
