/**
 * Pure layout helpers shared by the calendar grid — no Vue imports so they can
 * be unit-tested directly with `bun test`. Covers per-day event placement
 * (vertical/horizontal packing) and the horizontal day-strip scroll math used
 * by the virtualized timeline.
 */

export const HOUR_HEIGHT_PX = 48; // px per hour
export const GRID_HEIGHT_PX = HOUR_HEIGHT_PX * 24;
export const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const DEFAULT_EVENT_COLOR = "#6b7280"; // neutral for events with no calendar color

/** Translucent fill from a hex color — readable as a colored block on the dark grid. */
export function tint(hex: string | null | undefined): string {
  return `${hex ?? DEFAULT_EVENT_COLOR}33`;
}
export function solid(hex: string | null | undefined): string {
  return hex ?? DEFAULT_EVENT_COLOR;
}

export function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

// `day` columns are UTC-midnight markers for a calendar date.
export function dayMarkerKey(day: Date): string {
  return `${day.getUTCFullYear()}-${day.getUTCMonth()}-${day.getUTCDate()}`;
}
// Timed events / todos / "today" are absolute instants — bucket them by the
// viewer's LOCAL calendar date so a 9 AM event lands on the 9 AM row of its day.
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
// All-day events are floating dates stored at UTC midnight — match by UTC date
// so they don't shift a day in either direction.
export function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

export function minutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes(); // local time-of-day
}

/**
 * Vertical placement (top/height) + horizontal placement (left/width) for an
 * event that shares its time slot with `ncols` columns, sitting in column `col`.
 */
export function blockStyle(start: Date, end: Date, col = 0, ncols = 1): Record<string, string> {
  const top = (minutesFromMidnight(start) / 60) * HOUR_HEIGHT_PX;
  const height = Math.max(
    ((end.getTime() - start.getTime()) / 3_600_000) * HOUR_HEIGHT_PX,
    18, // minimum 18px so 0-minute events are visible
  );
  const gap = 2; // px between side-by-side events
  const widthPct = 100 / ncols;
  return {
    top: `${top}px`,
    height: `${height}px`,
    left: `calc(${col * widthPct}% + ${col === 0 ? 2 : gap / 2}px)`,
    width: `calc(${widthPct}% - ${ncols === 1 ? 4 : gap}px)`,
  };
}

/**
 * Assign overlapping events to side-by-side columns (Google-Calendar style):
 * build clusters of transitively-overlapping events, then place each in the
 * first free column; every event in a cluster shares the cluster's column count.
 */
export type Positioned<T> = T & { _col: number; _ncols: number };
export function packColumns<T extends { _start: Date; _end: Date }>(evs: T[]): Positioned<T>[] {
  const items = [...evs].sort(
    (a, b) => a._start.getTime() - b._start.getTime() || a._end.getTime() - b._end.getTime(),
  );
  const out: Positioned<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const colEnds: number[] = []; // end time of the last event placed in each column
    const colOf = new Map<T, number>();
    for (const it of cluster) {
      let placed = false;
      for (let i = 0; i < colEnds.length; i++) {
        if (it._start.getTime() >= colEnds[i]!) {
          colOf.set(it, i);
          colEnds[i] = it._end.getTime();
          placed = true;
          break;
        }
      }
      if (!placed) {
        colOf.set(it, colEnds.length);
        colEnds.push(it._end.getTime());
      }
    }
    const ncols = colEnds.length;
    for (const it of cluster) out.push({ ...it, _col: colOf.get(it)!, _ncols: ncols });
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const it of items) {
    if (cluster.length && it._start.getTime() >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it._end.getTime());
  }
  if (cluster.length) flush();
  return out;
}

// ── Horizontal timeline scroll math ──────────────────────────────────────────

/**
 * Range of day indices visible for a given horizontal scroll offset, padded by
 * `buffer` columns on each side and clamped to [0, totalDays-1]. The timeline
 * renders only these columns; everything else is empty canvas.
 */
export function visibleDayRange(
  scrollLeft: number,
  viewportWidth: number,
  dayWidth: number,
  totalDays: number,
  buffer: number,
): { start: number; end: number } {
  if (dayWidth <= 0 || totalDays <= 0) return { start: 0, end: 0 };
  const last = totalDays - 1;
  const start = Math.min(last, Math.max(0, Math.floor(scrollLeft / dayWidth) - buffer));
  const end = Math.max(start, Math.min(last, Math.ceil((scrollLeft + viewportWidth) / dayWidth) + buffer));
  return { start, end };
}

/** Day index at the horizontal centre of the viewport (drives the month title). */
export function centerDayIndex(
  scrollLeft: number,
  viewportWidth: number,
  dayWidth: number,
  totalDays: number,
): number {
  if (dayWidth <= 0 || totalDays <= 0) return 0;
  const idx = Math.round((scrollLeft + viewportWidth / 2) / dayWidth);
  return Math.max(0, Math.min(totalDays - 1, idx));
}
