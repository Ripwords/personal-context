import { z } from "zod";
import { tool } from "ai";

// ── Zod schemas ────────────────────────────────────────────────────────────

export const todoToolSchema = z.object({
  title: z.string().describe("Short, actionable title for the todo item"),
  notes: z.string().optional().describe("Optional extra details or context"),
  project: z.string().optional().describe("Project name (exact match preferred) or omit if none fits"),
  remindAt: z
    .string()
    .datetime()
    .optional()
    .describe("ISO 8601 REMINDER time. Set this ONLY for a reminder — a personal nudge the user wants to be notified about at a specific time (e.g. 'remind me to take meds at 8pm', 'ping me at 2'). A reminder fires a browser notification; it is NOT a calendar event and is never put on the calendar. Omit for plain checklist todos; a casually-mentioned day/time goes in notes, not here. If the user means a meeting/appointment/time-block, use create_event instead."),
  confidence: z.number().min(0).max(1).describe("Confidence 0..1 that this is a real actionable todo"),
});

export const eventToolSchema = z.object({
  title: z.string().describe("Short title for the calendar event"),
  notes: z.string().optional().describe("Optional extra details or context"),
  project: z.string().optional().describe("Project name (exact match preferred) or omit if none fits"),
  startsAt: z.string().datetime().describe("ISO 8601 start datetime for the event"),
  endsAt: z.string().datetime().describe("ISO 8601 end datetime for the event"),
  confidence: z.number().min(0).max(1).describe("Confidence 0..1 that this is a real calendar event"),
});

export const deleteEventToolSchema = z.object({
  id: z.string().optional().describe("Stable id from read_calendar for the item to remove. Prefer this over title."),
  kind: z.enum(["event", "todo"]).optional().describe("Item kind from read_calendar when id is provided"),
  title: z.string().optional().describe("Words from the title of the EXISTING calendar item to remove (case-insensitive substring), only if id is not known"),
  from: z.string().datetime().optional().describe("ISO 8601 start of the day/range to search, if a date was given"),
  to: z.string().datetime().optional().describe("ISO 8601 end of the day/range to search"),
});

export const updateEventToolSchema = z.object({
  id: z.string().optional().describe("Stable id from read_calendar for the item to modify. Prefer this over title."),
  kind: z.enum(["event", "todo"]).optional().describe("Item kind from read_calendar when id is provided"),
  title: z.string().optional().describe("Words from the title of the EXISTING calendar item to modify (case-insensitive substring), only if id is not known"),
  from: z.string().datetime().optional().describe("ISO 8601 start of the day/range to find the event"),
  to: z.string().datetime().optional().describe("ISO 8601 end of the day/range to find the event"),
  newTitle: z.string().optional().describe("New title, if renaming"),
  newStartsAt: z.string().datetime().optional().describe("New ISO 8601 start, if rescheduling"),
  newEndsAt: z.string().datetime().optional().describe("New ISO 8601 end, if rescheduling"),
});

export type TodoToolInput = z.infer<typeof todoToolSchema>;
export type EventToolInput = z.infer<typeof eventToolSchema>;
export type DeleteEventToolInput = z.infer<typeof deleteEventToolSchema>;
export type UpdateEventToolInput = z.infer<typeof updateEventToolSchema>;

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

export const deleteEventTool = tool({
  description:
    "Remove/cancel/delete an EXISTING calendar item the user asks to get rid of. Prefer id+kind from read_calendar; otherwise match by title/date. Use this for 'remove', 'cancel', 'delete', 'drop' — never create an event for a removal request.",
  inputSchema: deleteEventToolSchema,
});

export const updateEventTool = tool({
  description:
    "Modify an EXISTING calendar item — rename it or reschedule it. Prefer id+kind from read_calendar; otherwise find by title, then set the new title and/or new start/end.",
  inputSchema: updateEventToolSchema,
});

export const extractionTools = {
  create_todo: createTodoTool,
  create_event: createEventTool,
  delete_event: deleteEventTool,
  update_event: updateEventTool,
} as const;
