import { and, gt, lt, isNull, or, eq } from "drizzle-orm";
import { type Db } from "../client";
import { events, googleCalendar, type Todo } from "../schema";
import { listUnscheduledTodos, listScheduledTodosInRange } from "./items";

export type FeedEvent = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  projectId: string | null;
  allDay: boolean;
  /** The source calendar's display color (hex), or null for local/AI events. */
  color: string | null;
};

export type CalendarFeed = {
  /** Timed events (rendered in the hour grid). */
  events: FeedEvent[];
  /** All-day events (rendered in the all-day row). */
  allDayEvents: FeedEvent[];
  scheduledTodos: Todo[];
  unscheduledTodos: Todo[];
};

/**
 * Events that OVERLAP [from, to) — i.e. start before `to` and end after `from`
 * — enriched with their Google calendar's color, excluding events whose calendar
 * the user has toggled off. Overlap (not start-within) so events that span
 * midnight or run multiple days still appear on every day they cover. Local/AI
 * events (no calendarId) are always included.
 */
export async function listFeedEventsInRange(db: Db, from: Date, to: Date): Promise<FeedEvent[]> {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      projectId: events.projectId,
      allDay: events.allDay,
      color: googleCalendar.backgroundColor,
    })
    .from(events)
    .leftJoin(
      googleCalendar,
      and(
        eq(googleCalendar.accountId, events.googleAccountId),
        eq(googleCalendar.calendarId, events.calendarId),
      ),
    )
    .where(
      and(
        lt(events.startsAt, to),
        gt(events.endsAt, from),
        // Show an event unless its calendar is EXPLICITLY toggled off. Local/AI
        // events (no calendarId) and events whose calendar metadata hasn't synced
        // yet both have a NULL selected → they stay visible.
        or(isNull(googleCalendar.selected), eq(googleCalendar.selected, true)),
      ),
    )
    .orderBy(events.startsAt);
  return rows;
}

export async function getCalendarFeed(db: Db, from: Date, to: Date): Promise<CalendarFeed> {
  const [feedEvents, scheduledTodos, unscheduledTodos] = await Promise.all([
    listFeedEventsInRange(db, from, to),
    listScheduledTodosInRange(db, from, to),
    listUnscheduledTodos(db),
  ]);
  return {
    events: feedEvents.filter((e) => !e.allDay),
    allDayEvents: feedEvents.filter((e) => e.allDay),
    // Scheduled todos are calendar time-blocks (scheduledStart set) — gridded
    // alongside events. Reminders (remindAt) are NOT here; they fire via
    // /api/reminders + the notifier, separate from the calendar grid.
    scheduledTodos,
    unscheduledTodos,
  };
}
