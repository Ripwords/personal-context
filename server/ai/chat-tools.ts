import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { Db } from "../db/client";
import { listProjects } from "../db/queries/projects";
import { searchMemories } from "../db/queries/memory";
import { searchDocuments } from "../db/queries/documents";
import { getCalendarFeed } from "../db/queries/calendar-feed";
import { makeWebSearch } from "./web-search";
import { createTodoFromInput, createEventFromInput } from "./extract";
import { todoToolSchema, eventToolSchema } from "./tools";
import type { WritebackItem } from "../calendar-sync/writeback";

/** Mirror an AI-created item to the user's Braindump Google calendar (best-effort). */
export type MirrorFn = (item: WritebackItem) => Promise<void>;

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
  mirror?: MirrorFn,
): ToolSet {
  // Mirror to Google without ever failing the tool call.
  async function safeMirror(item: WritebackItem): Promise<void> {
    if (!mirror) return;
    try {
      await mirror(item);
    } catch (err) {
      console.error(`chat writeback failed for ${item.kind} ${item.id}:`, err);
    }
  }

  return {
    create_todo: tool({
      description:
        "Create a concrete actionable todo item. Resolve the project name if provided.",
      inputSchema: todoToolSchema,
      execute: async (inp) => {
        const projects = await listProjects(db);
        const item = await createTodoFromInput(db, inp, projects, null);
        // A timed reminder is mirrored to Google so it appears on every calendar.
        if (inp.scheduledStart) {
          const start = new Date(inp.scheduledStart);
          if (!Number.isNaN(start.getTime())) {
            const end = inp.scheduledEnd ? new Date(inp.scheduledEnd) : new Date(start.getTime() + 30 * 60_000);
            await safeMirror({ kind: "todo", id: item.id, title: item.title, startsAt: start, endsAt: end });
          }
        }
        return { created: "todo" as const, id: item.id, title: item.title };
      },
    }),

    create_event: tool({
      description:
        "Create a calendar event. Provide ISO 8601 start and end datetimes.",
      inputSchema: eventToolSchema,
      execute: async (inp) => {
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
        await safeMirror({
          kind: "event",
          id: item.id,
          title: item.title,
          startsAt: new Date(inp.startsAt),
          endsAt: new Date(inp.endsAt),
        });
        return { created: "event" as const, id: item.id, title: item.title };
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
            title: e.title,
            startsAt: e.startsAt.toISOString(),
            endsAt: e.endsAt.toISOString(),
          })),
          scheduledTodos: feed.scheduledTodos.map((t) => ({ title: t.title })),
          unscheduledTodos: feed.unscheduledTodos.map((t) => ({ title: t.title })),
        };
      },
    }),
  };
}
