import { test, expect } from "bun:test";
import { partitionReminders, msUntil, type Reminder } from "./reminders";

const NOW = Date.parse("2026-06-30T12:00:00Z");
function r(over: Partial<Reminder>): Reminder {
  return { id: "1", title: "x", remindAt: "2026-06-30T12:00:00Z", notifiedAt: null, ...over };
}

test("a reminder just past due (not notified) is due", () => {
  const { due, upcoming } = partitionReminders([r({ remindAt: "2026-06-30T11:30:00Z" })], NOW);
  expect(due.length).toBe(1);
  expect(upcoming.length).toBe(0);
});

test("a reminder within the horizon is upcoming, not due", () => {
  const { due, upcoming } = partitionReminders([r({ remindAt: "2026-06-30T14:00:00Z" })], NOW);
  expect(due.length).toBe(0);
  expect(upcoming.map((u) => u.id)).toEqual(["1"]);
});

test("already-notified reminders are ignored", () => {
  const { due, upcoming } = partitionReminders(
    [r({ remindAt: "2026-06-30T11:30:00Z", notifiedAt: "2026-06-30T11:30:05Z" })],
    NOW,
  );
  expect(due.length).toBe(0);
  expect(upcoming.length).toBe(0);
});

test("a long-missed reminder beyond the catch-up window does not fire", () => {
  const { due } = partitionReminders([r({ remindAt: "2026-06-29T12:00:00Z" })], NOW); // 24h ago
  expect(due.length).toBe(0);
});

test("a reminder beyond the horizon is neither due nor upcoming", () => {
  const { due, upcoming } = partitionReminders([r({ remindAt: "2026-06-30T23:00:00Z" })], NOW); // 11h ahead
  expect(due.length + upcoming.length).toBe(0);
});

test("invalid remindAt is skipped", () => {
  const { due, upcoming } = partitionReminders([r({ remindAt: "not-a-date" })], NOW);
  expect(due.length + upcoming.length).toBe(0);
});

test("windows are configurable", () => {
  const { upcoming } = partitionReminders([r({ remindAt: "2026-06-30T20:00:00Z" })], NOW, { horizonMs: 9 * 3600_000 });
  expect(upcoming.length).toBe(1);
});

test("msUntil is zero for past reminders and positive for future", () => {
  expect(msUntil(r({ remindAt: "2026-06-30T11:00:00Z" }), NOW)).toBe(0);
  expect(msUntil(r({ remindAt: "2026-06-30T13:00:00Z" }), NOW)).toBe(3600_000);
});
