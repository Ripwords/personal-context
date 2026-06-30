// Pure logic for foreground reminder notifications: given the current time and
// the user's reminders, decide which should fire NOW (due, incl. ones missed
// while the tab was closed) and which to schedule a timer for (upcoming).
// Framework-free so it's unit-testable; the composable handles timers + the
// Notification API.

export interface Reminder {
  id: string;
  title: string;
  /** ISO 8601 notify-at time. */
  remindAt: string;
  /** ISO 8601 when its notification already fired, or null. */
  notifiedAt: string | null;
}

export interface PartitionedReminders {
  /** Fire immediately: time has passed (within the catch-up window) and not yet notified. */
  due: Reminder[];
  /** Schedule a timer: time is within the look-ahead horizon and not yet notified. */
  upcoming: Reminder[];
}

export interface PartitionOptions {
  /** How far ahead to schedule timers for (default 6h). */
  horizonMs?: number;
  /** How far back a missed reminder may be and still fire on open (default 12h). */
  catchUpMs?: number;
}

const HOUR = 60 * 60 * 1000;

/**
 * Split reminders into `due` (fire now) and `upcoming` (schedule a timer).
 * Already-notified reminders and ones outside the windows are ignored.
 */
export function partitionReminders(
  reminders: ReadonlyArray<Reminder>,
  nowMs: number,
  opts: PartitionOptions = {},
): PartitionedReminders {
  const horizonMs = opts.horizonMs ?? 6 * HOUR;
  const catchUpMs = opts.catchUpMs ?? 12 * HOUR;

  const due: Reminder[] = [];
  const upcoming: Reminder[] = [];

  for (const r of reminders) {
    if (r.notifiedAt) continue;
    const at = new Date(r.remindAt).getTime();
    if (Number.isNaN(at)) continue;

    if (at <= nowMs) {
      // Missed/just-due — only fire if recent enough to still be relevant.
      if (at >= nowMs - catchUpMs) due.push(r);
    } else if (at <= nowMs + horizonMs) {
      upcoming.push(r);
    }
  }
  return { due, upcoming };
}

/** Milliseconds from now until a reminder fires (never negative). */
export function msUntil(reminder: Reminder, nowMs: number): number {
  return Math.max(0, new Date(reminder.remindAt).getTime() - nowMs);
}
