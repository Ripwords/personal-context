import { type Db } from "../client";
import { type EventRow, type Todo } from "../schema";
import { listEventsInRange, listScheduledTodosInRange, listUnscheduledTodos } from "./items";

export type CalendarFeed = {
  events: EventRow[];
  scheduledTodos: Todo[];
  unscheduledTodos: Todo[];
};

export async function getCalendarFeed(db: Db, from: Date, to: Date): Promise<CalendarFeed> {
  const [events, scheduledTodos, unscheduledTodos] = await Promise.all([
    listEventsInRange(db, from, to),
    listScheduledTodosInRange(db, from, to),
    listUnscheduledTodos(db),
  ]);
  return { events, scheduledTodos, unscheduledTodos };
}
