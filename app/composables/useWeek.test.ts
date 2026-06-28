import { test, expect } from "bun:test";
import { startOfWeek, weekDays, addDays } from "./useWeek";

test("startOfWeek returns Monday 00:00 for a mid-week date", () => {
  const wed = new Date("2026-07-01T15:00:00Z"); // Wed
  const mon = startOfWeek(wed);
  expect(mon.getUTCDay()).toBe(1); // Monday
});

test("weekDays returns 7 consecutive days", () => {
  const days = weekDays(new Date("2026-07-01T00:00:00Z"));
  expect(days.length).toBe(7);
  expect(addDays(days[0]!, 6).getUTCDate()).toBe(days[6]!.getUTCDate());
});

test("startOfWeek returns Monday itself when given a Monday", () => {
  const mon = new Date("2026-06-29T08:00:00Z"); // Monday
  const result = startOfWeek(mon);
  expect(result.getUTCDay()).toBe(1);
  expect(result.getUTCHours()).toBe(0);
  expect(result.getUTCMinutes()).toBe(0);
});

test("startOfWeek returns previous Monday when given a Sunday", () => {
  const sun = new Date("2026-07-05T10:00:00Z"); // Sunday
  const result = startOfWeek(sun);
  expect(result.getUTCDay()).toBe(1); // Monday
  expect(result.getUTCDate()).toBe(29); // June 29
});

test("addDays adds positive days", () => {
  const d = new Date("2026-06-29T00:00:00Z");
  const result = addDays(d, 3);
  expect(result.getUTCDate()).toBe(2); // July 2
  expect(result.getUTCMonth()).toBe(6); // July (0-indexed)
});

test("addDays adds zero days returns same date", () => {
  const d = new Date("2026-06-29T00:00:00Z");
  const result = addDays(d, 0);
  expect(result.getUTCDate()).toBe(29);
});

test("weekDays starts on Monday and ends on Sunday", () => {
  const days = weekDays(new Date("2026-07-01T00:00:00Z")); // Wed
  expect(days[0]!.getUTCDay()).toBe(1); // Monday
  expect(days[6]!.getUTCDay()).toBe(0); // Sunday
});
