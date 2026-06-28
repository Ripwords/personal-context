/**
 * Pure date helpers — no Vue imports so `bun test` can run them directly.
 * All calculations are UTC-based to match the test assertions.
 */

/** Return a new Date that is `n` days after `d` (fractional days are truncated). */
export function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() + n);
  return result;
}

/**
 * Return the Monday of `d`'s ISO week at 00:00 UTC.
 * getUTCDay() returns 0=Sun, 1=Mon … 6=Sat.
 * ISO weeks start on Monday, so we shift Sunday (0) to 7.
 */
export function startOfWeek(d: Date): Date {
  const day = d.getUTCDay(); // 0 (Sun) … 6 (Sat)
  const diff = day === 0 ? -6 : 1 - day; // distance to Monday
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() + diff);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * Return the 7 dates (Mon → Sun) of the ISO week containing `d`,
 * each at 00:00 UTC.
 */
export function weekDays(d: Date): [Date, Date, Date, Date, Date, Date, Date] {
  const mon = startOfWeek(d);
  return [
    mon,
    addDays(mon, 1),
    addDays(mon, 2),
    addDays(mon, 3),
    addDays(mon, 4),
    addDays(mon, 5),
    addDays(mon, 6),
  ];
}
