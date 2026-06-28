import { z } from "zod";
import { tool } from "ai";

// ── Zod schemas ────────────────────────────────────────────────────────────

export const todoToolSchema = z.object({
  title: z.string().describe("Short, actionable title for the todo item"),
  notes: z.string().optional().describe("Optional extra details or context"),
  project: z.string().optional().describe("Project name (exact match preferred) or omit if none fits"),
  confidence: z.number().min(0).max(1).describe("Confidence 0..1 that this is a real actionable todo"),
});

export const eventToolSchema = z.object({
  title: z.string().describe("Short title for the calendar event"),
  notes: z.string().optional().describe("Optional extra details or context"),
  project: z.string().optional().describe("Project name (exact match preferred) or omit if none fits"),
  startsAt: z.string().describe("ISO 8601 start datetime for the event"),
  endsAt: z.string().describe("ISO 8601 end datetime for the event"),
  confidence: z.number().min(0).max(1).describe("Confidence 0..1 that this is a real calendar event"),
});

export type TodoToolInput = z.infer<typeof todoToolSchema>;
export type EventToolInput = z.infer<typeof eventToolSchema>;

// ── Tool definitions (no execute — we read tool calls and do DB writes ourselves) ──

export const createTodoTool = tool({
  description:
    "Create a concrete actionable todo item extracted from the user's brain dump.",
  inputSchema: todoToolSchema,
});

export const createEventTool = tool({
  description:
    "Create a calendar event extracted from the user's brain dump. Set realistic ISO start/end datetimes.",
  inputSchema: eventToolSchema,
});

export const extractionTools = {
  create_todo: createTodoTool,
  create_event: createEventTool,
} as const;
