import type { Db, DbOrTx } from "../db/client";
import type { EventRow, Todo } from "../db/schema";
import {
  deleteEvent,
  dropTodo,
  updateEvent,
  updateTodoSchedule,
  type CalendarItemTarget,
} from "../db/queries/items";
import { isAuthError } from "./google-rest";

export type DeleteFromGoogleFn = (input: {
  accountId: string;
  calendarId: string;
  eventId: string;
}) => Promise<void>;

export type UpdateInGoogleFn = (input: {
  accountId: string;
  calendarId: string;
  eventId: string;
  title?: string;
  startsAt?: Date;
  endsAt?: Date;
}) => Promise<void>;

export type GoogleSync = "synced" | "needs-reauth" | "not-synced" | "off";

export interface CalendarMutationDeps {
  deleteFromGoogle?: DeleteFromGoogleFn;
  updateInGoogle?: UpdateInGoogleFn;
}

export type CalendarMutationError =
  | "not-found"
  | "invalid-date"
  | "needs-reauth"
  | "not-synced";

export type CalendarDeleteResult =
  | { ok: true; item: CalendarItemTarget; googleSync: GoogleSync }
  | { ok: false; reason: CalendarMutationError; googleSync: GoogleSync };

export type CalendarUpdateResult =
  | { ok: true; item: CalendarItemTarget; googleSync: GoogleSync }
  | { ok: false; reason: CalendarMutationError; googleSync: GoogleSync };

function googleIdentity(item: CalendarItemTarget): {
  accountId: string;
  calendarId: string;
  eventId: string;
} | null {
  if (!item.googleEventId || !item.googleAccountId || !item.calendarId) return null;
  return {
    accountId: item.googleAccountId,
    calendarId: item.calendarId,
    eventId: item.googleEventId,
  };
}

function itemTitle(item: CalendarItemTarget): string {
  return item.title;
}

function itemStart(item: CalendarItemTarget): Date {
  return item.kind === "event" ? item.startsAt : (item.scheduledStart ?? item.createdAt);
}

function itemEnd(item: CalendarItemTarget): Date {
  if (item.kind === "event") return item.endsAt;
  return item.scheduledEnd ?? new Date(itemStart(item).getTime() + 30 * 60_000);
}

function normalizeOptionalDate(value: Date | undefined): Date | undefined | null {
  if (value === undefined) return undefined;
  return Number.isNaN(value.getTime()) ? null : value;
}

export function computeUpdatedWindow(
  item: CalendarItemTarget,
  newStartsAt?: Date,
  newEndsAt?: Date,
): { startsAt: Date; endsAt: Date } | null {
  const currentStart = itemStart(item);
  const currentEnd = itemEnd(item);
  const duration = Math.max(currentEnd.getTime() - currentStart.getTime(), 30 * 60_000);

  const startInput = normalizeOptionalDate(newStartsAt);
  const endInput = normalizeOptionalDate(newEndsAt);
  if (startInput === null || endInput === null) return null;

  const startsAt = startInput ?? currentStart;
  const endsAt = endInput ?? (startInput ? new Date(startsAt.getTime() + duration) : currentEnd);
  if (endsAt.getTime() <= startsAt.getTime()) return null;
  return { startsAt, endsAt };
}

export function calendarItemSummary(item: CalendarItemTarget): {
  kind: "event" | "todo";
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
} {
  return {
    kind: item.kind,
    id: item.id,
    title: itemTitle(item),
    startsAt: itemStart(item).toISOString(),
    endsAt: itemEnd(item).toISOString(),
  };
}

export async function deleteCalendarItem(
  db: DbOrTx,
  item: CalendarItemTarget,
  deps: CalendarMutationDeps = {},
): Promise<CalendarDeleteResult> {
  const ident = googleIdentity(item);
  let googleSync: GoogleSync = ident ? "not-synced" : "off";

  if (ident) {
    if (!deps.deleteFromGoogle) {
      return { ok: false, reason: "not-synced", googleSync };
    }
    try {
      await deps.deleteFromGoogle(ident);
      googleSync = "synced";
    } catch (err) {
      return {
        ok: false,
        reason: isAuthError(err) ? "needs-reauth" : "not-synced",
        googleSync: isAuthError(err) ? "needs-reauth" : "not-synced",
      };
    }
  }

  const removed =
    item.kind === "event"
      ? await deleteEvent(db, item.id)
      : await dropTodo(db, item.id);
  if (!removed) return { ok: false, reason: "not-found", googleSync };
  return {
    ok: true,
    item: { ...removed, kind: item.kind } as CalendarItemTarget,
    googleSync,
  };
}

export async function updateCalendarItem(
  db: DbOrTx,
  item: CalendarItemTarget,
  fields: { title?: string; startsAt?: Date; endsAt?: Date },
  deps: CalendarMutationDeps = {},
): Promise<CalendarUpdateResult> {
  const window = computeUpdatedWindow(item, fields.startsAt, fields.endsAt);
  if (!window) return { ok: false, reason: "invalid-date", googleSync: "off" };

  const title = fields.title ?? itemTitle(item);
  const ident = googleIdentity(item);
  let googleSync: GoogleSync = ident ? "not-synced" : "off";

  if (ident) {
    if (!deps.updateInGoogle) {
      return { ok: false, reason: "not-synced", googleSync };
    }
    try {
      await deps.updateInGoogle({
        ...ident,
        title,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      });
      googleSync = "synced";
    } catch (err) {
      return {
        ok: false,
        reason: isAuthError(err) ? "needs-reauth" : "not-synced",
        googleSync: isAuthError(err) ? "needs-reauth" : "not-synced",
      };
    }
  }

  const updated: EventRow | Todo | null =
    item.kind === "event"
      ? await updateEvent(db, item.id, {
          title,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
        })
      : await updateTodoSchedule(db, item.id, {
          title,
          scheduledStart: window.startsAt,
          scheduledEnd: window.endsAt,
        });
  if (!updated) return { ok: false, reason: "not-found", googleSync };
  return {
    ok: true,
    item: { ...updated, kind: item.kind } as CalendarItemTarget,
    googleSync,
  };
}
