import { test, expect } from "bun:test";
import { packColumns, visibleDayRange, centerDayIndex } from "./calendarLayout";

function ev(startH: number, endH: number) {
  const d = "2026-06-29T";
  const pad = (h: number) => String(h).padStart(2, "0");
  return { _start: new Date(`${d}${pad(startH)}:00:00`), _end: new Date(`${d}${pad(endH)}:00:00`) };
}

test("packColumns places non-overlapping events in a single column", () => {
  const out = packColumns([ev(9, 10), ev(11, 12)]);
  for (const o of out) {
    expect(o._ncols).toBe(1);
    expect(o._col).toBe(0);
  }
});

test("packColumns splits two overlapping events into two columns", () => {
  const out = packColumns([ev(9, 11), ev(10, 12)]);
  expect(out.every((o) => o._ncols === 2)).toBe(true);
  expect(new Set(out.map((o) => o._col))).toEqual(new Set([0, 1]));
});

test("packColumns reuses a freed column after an event ends", () => {
  // A 9–10 and C 10–11 don't overlap → C reuses column 0; B 9–11 overlaps both.
  const out = packColumns([ev(9, 10), ev(9, 11), ev(10, 11)]);
  const ncols = Math.max(...out.map((o) => o._ncols));
  expect(ncols).toBe(2);
});

test("visibleDayRange returns the padded, clamped index window", () => {
  // viewport 700px wide, 100px/day → 7 days visible from index 5
  const { start, end } = visibleDayRange(500, 700, 100, 371, 2);
  expect(start).toBe(3); // floor(500/100) - 2
  expect(end).toBe(14); // ceil(1200/100) + 2
});

test("visibleDayRange clamps to the canvas bounds", () => {
  expect(visibleDayRange(-200, 700, 100, 371, 2).start).toBe(0);
  const far = visibleDayRange(40_000, 700, 100, 371, 2);
  expect(far.end).toBe(370);
});

test("visibleDayRange tolerates a zero day width", () => {
  expect(visibleDayRange(0, 700, 0, 371, 2)).toEqual({ start: 0, end: 0 });
});

test("centerDayIndex returns the column at the viewport centre", () => {
  // scrollLeft 500, viewport 700 → centre at 850px → index 8 (round 8.5)
  expect(centerDayIndex(500, 700, 100, 371)).toBe(9);
  expect(centerDayIndex(0, 700, 100, 371)).toBe(4); // round(350/100)
});

test("centerDayIndex clamps to the canvas bounds", () => {
  expect(centerDayIndex(-9999, 700, 100, 371)).toBe(0);
  expect(centerDayIndex(9_999_999, 700, 100, 371)).toBe(370);
});
