import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createProject } from "./projects";
import { getAnalytics } from "./analytics";
import { dumps, todos, events } from "../schema";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

// deterministic "now" = 2026-06-29T12:00:00Z (today in UTC)
const NOW = new Date("2026-06-29T12:00:00Z");
const TODAY_STR = "2026-06-29";
const YESTERDAY_STR = "2026-06-28";

test("todos: counts open/done/dropped and completionRate", async () => {
  const projA = await createProject(db, { name: "Project A", color: "#ff0000", kind: "work" });

  // open x2, done x2, dropped x1 → total 5
  await db.insert(todos).values([
    { title: "open-1", status: "open", projectId: projA.id },
    { title: "open-2", status: "open", projectId: projA.id },
    { title: "done-1", status: "done", projectId: projA.id },
    { title: "done-2", status: "done", projectId: projA.id },
    { title: "dropped-1", status: "dropped", projectId: projA.id },
  ]);

  const analytics = await getAnalytics(db, NOW);

  expect(analytics.todos.open).toBe(2);
  expect(analytics.todos.done).toBe(2);
  expect(analytics.todos.dropped).toBe(1);
  // completionRate = 2 / (2 + 2 + 1) = 0.4
  expect(analytics.todos.completionRate).toBe(0.4);
});

test("todos: completionRate is 0 when no todos", async () => {
  const analytics = await getAnalytics(db, NOW);
  expect(analytics.todos.completionRate).toBe(0);
  expect(analytics.todos.open).toBe(0);
  expect(analytics.todos.done).toBe(0);
  expect(analytics.todos.dropped).toBe(0);
});

test("scheduling: counts scheduled vs unscheduled open todos", async () => {
  // scheduled open
  await db.insert(todos).values({
    title: "sched",
    status: "open",
    scheduledStart: new Date("2026-07-01T09:00:00Z"),
    scheduledEnd: new Date("2026-07-01T10:00:00Z"),
  });
  // unscheduled open x2
  await db.insert(todos).values([
    { title: "unsched-1", status: "open" },
    { title: "unsched-2", status: "open" },
  ]);
  // done (should NOT count in scheduling)
  await db.insert(todos).values({ title: "done-1", status: "done" });

  const analytics = await getAnalytics(db, NOW);

  expect(analytics.scheduling.scheduled).toBe(1);
  expect(analytics.scheduling.unscheduled).toBe(2);
});

test("byProject: includes project name, color, todo and event counts", async () => {
  const projA = await createProject(db, { name: "Alpha", color: "#aabbcc", kind: "work" });
  const projB = await createProject(db, { name: "Beta", color: "#112233", kind: "personal" });

  // Project A: 3 todos, 2 events
  await db.insert(todos).values([
    { title: "a1", projectId: projA.id },
    { title: "a2", projectId: projA.id },
    { title: "a3", projectId: projA.id },
  ]);
  await db.insert(events).values([
    { title: "ea1", projectId: projA.id, startsAt: new Date("2026-06-29T09:00:00Z"), endsAt: new Date("2026-06-29T10:00:00Z") },
    { title: "ea2", projectId: projA.id, startsAt: new Date("2026-06-29T11:00:00Z"), endsAt: new Date("2026-06-29T12:00:00Z") },
  ]);

  // Project B: 1 todo, 1 event
  await db.insert(todos).values({ title: "b1", projectId: projB.id });
  await db.insert(events).values({
    title: "eb1",
    projectId: projB.id,
    startsAt: new Date("2026-06-29T14:00:00Z"),
    endsAt: new Date("2026-06-29T15:00:00Z"),
  });

  const analytics = await getAnalytics(db, NOW);

  const a = analytics.byProject.find((p) => p.project === "Alpha");
  const b = analytics.byProject.find((p) => p.project === "Beta");

  expect(a).toBeDefined();
  expect(a!.color).toBe("#aabbcc");
  expect(a!.todos).toBe(3);
  expect(a!.events).toBe(2);

  expect(b).toBeDefined();
  expect(b!.color).toBe("#112233");
  expect(b!.todos).toBe(1);
  expect(b!.events).toBe(1);
});

test("dumpsPerDay: returns last 14 days oldest→newest, zero-filled", async () => {
  // 2 dumps today, 1 dump yesterday
  await db.insert(dumps).values([
    { text: "today-1", createdAt: new Date("2026-06-29T09:00:00Z") },
    { text: "today-2", createdAt: new Date("2026-06-29T15:00:00Z") },
    { text: "yesterday-1", createdAt: new Date("2026-06-28T10:00:00Z") },
  ]);

  const analytics = await getAnalytics(db, NOW);

  expect(analytics.dumpsPerDay).toHaveLength(14);

  // oldest entry should be 2026-06-16 (now - 13 days)
  expect(analytics.dumpsPerDay[0]!.day).toBe("2026-06-16");
  // newest entry should be today
  expect(analytics.dumpsPerDay[13]!.day).toBe(TODAY_STR);

  // yesterday
  const yd = analytics.dumpsPerDay.find((d) => d.day === YESTERDAY_STR);
  expect(yd).toBeDefined();
  expect(yd!.count).toBe(1);

  // today
  const td = analytics.dumpsPerDay.find((d) => d.day === TODAY_STR);
  expect(td).toBeDefined();
  expect(td!.count).toBe(2);

  // some day before yesterday should be zero
  const olderDay = analytics.dumpsPerDay.find((d) => d.day === "2026-06-20");
  expect(olderDay).toBeDefined();
  expect(olderDay!.count).toBe(0);
});

test("captureByHour: returns 24 slots zero-filled with correct counts", async () => {
  await db.insert(dumps).values([
    { text: "morning", createdAt: new Date("2026-06-29T09:00:00Z") },  // hour 9
    { text: "afternoon", createdAt: new Date("2026-06-29T15:00:00Z") }, // hour 15
    { text: "yesterday-morning", createdAt: new Date("2026-06-28T09:30:00Z") }, // hour 9
  ]);

  const analytics = await getAnalytics(db, NOW);

  expect(analytics.captureByHour).toHaveLength(24);

  // hours 0-23 all present
  for (let h = 0; h < 24; h++) {
    expect(analytics.captureByHour[h]!.hour).toBe(h);
  }

  // hour 9 should have 2 (today + yesterday)
  expect(analytics.captureByHour[9]!.count).toBe(2);
  // hour 15 should have 1
  expect(analytics.captureByHour[15]!.count).toBe(1);
  // hour 3 should have 0
  expect(analytics.captureByHour[3]!.count).toBe(0);
});

test("buckets dumps by the requested timezone, not UTC", async () => {
  // 2026-06-30T02:00:00Z is June 29, 22:00 in America/New_York (EDT, UTC-4).
  await db.insert(dumps).values([
    { text: "late night", createdAt: new Date("2026-06-30T02:00:00Z") },
  ]);

  const utc = await getAnalytics(db, NOW, "UTC");
  expect(utc.captureByHour[2]!.count).toBe(1); // 02:00 UTC
  expect(utc.captureByHour[22]!.count).toBe(0);

  const ny = await getAnalytics(db, NOW, "America/New_York");
  expect(ny.captureByHour[22]!.count).toBe(1); // 22:00 local
  expect(ny.captureByHour[2]!.count).toBe(0);
  // Lands on the local day (June 29), not the UTC day (June 30).
  expect(ny.dumpsPerDay.find((d) => d.day === "2026-06-29")!.count).toBe(1);
  expect(ny.dumpsPerDay.find((d) => d.day === "2026-06-30")).toBeUndefined();
});

test("streakDays: consecutive days ending today", async () => {
  await db.insert(dumps).values([
    { text: "today-1", createdAt: new Date("2026-06-29T09:00:00Z") },
    { text: "today-2", createdAt: new Date("2026-06-29T18:00:00Z") },
    { text: "yesterday-1", createdAt: new Date("2026-06-28T10:00:00Z") },
    // gap: 2026-06-27 missing → streak stops at 2
  ]);

  const analytics = await getAnalytics(db, NOW);

  expect(analytics.streakDays).toBe(2);
});

test("streakDays: 0 when no dump today", async () => {
  // dump only yesterday, not today
  await db.insert(dumps).values({
    text: "yesterday-only",
    createdAt: new Date("2026-06-28T10:00:00Z"),
  });

  const analytics = await getAnalytics(db, NOW);

  expect(analytics.streakDays).toBe(0);
});

test("full integration: seeded data produces correct Analytics shape", async () => {
  const projA = await createProject(db, { name: "Work", color: "#ff0000", kind: "work" });
  const projB = await createProject(db, { name: "Side", color: "#0000ff", kind: "personal" });

  // todos: open(1 sched, 1 unsched in A), open(1 unsched in B), done(1 in A), dropped(1 in B)
  await db.insert(todos).values([
    { title: "a-open-sched", status: "open", projectId: projA.id, scheduledStart: new Date("2026-07-01T09:00:00Z"), scheduledEnd: new Date("2026-07-01T10:00:00Z") },
    { title: "a-open-unsched", status: "open", projectId: projA.id },
    { title: "b-open-unsched", status: "open", projectId: projB.id },
    { title: "a-done", status: "done", projectId: projA.id },
    { title: "b-dropped", status: "dropped", projectId: projB.id },
  ]);

  // events
  await db.insert(events).values([
    { title: "ev-a1", projectId: projA.id, startsAt: new Date("2026-06-29T08:00:00Z"), endsAt: new Date("2026-06-29T09:00:00Z") },
    { title: "ev-a2", projectId: projA.id, startsAt: new Date("2026-06-29T10:00:00Z"), endsAt: new Date("2026-06-29T11:00:00Z") },
    { title: "ev-b1", projectId: projB.id, startsAt: new Date("2026-06-29T14:00:00Z"), endsAt: new Date("2026-06-29T15:00:00Z") },
  ]);

  // dumps: 2 today, 1 yesterday
  await db.insert(dumps).values([
    { text: "dump-today-1", createdAt: new Date("2026-06-29T09:00:00Z") },
    { text: "dump-today-2", createdAt: new Date("2026-06-29T14:00:00Z") },
    { text: "dump-yesterday", createdAt: new Date("2026-06-28T11:00:00Z") },
  ]);

  const analytics = await getAnalytics(db, NOW);

  // todos: open=3, done=1, dropped=1 → total=5, rate=1/5=0.2
  expect(analytics.todos.open).toBe(3);
  expect(analytics.todos.done).toBe(1);
  expect(analytics.todos.dropped).toBe(1);
  expect(analytics.todos.completionRate).toBe(0.2);

  // scheduling
  expect(analytics.scheduling.scheduled).toBe(1);
  expect(analytics.scheduling.unscheduled).toBe(2);

  // byProject
  const wa = analytics.byProject.find((p) => p.project === "Work");
  const sb = analytics.byProject.find((p) => p.project === "Side");
  expect(wa!.todos).toBe(3);
  expect(wa!.events).toBe(2);
  expect(sb!.todos).toBe(2);
  expect(sb!.events).toBe(1);

  // dumpsPerDay
  expect(analytics.dumpsPerDay).toHaveLength(14);
  const tdSlot = analytics.dumpsPerDay.find((d) => d.day === TODAY_STR);
  const ydSlot = analytics.dumpsPerDay.find((d) => d.day === YESTERDAY_STR);
  expect(tdSlot!.count).toBe(2);
  expect(ydSlot!.count).toBe(1);

  // captureByHour
  expect(analytics.captureByHour).toHaveLength(24);

  // streakDays ≥ 1 (today has dumps; yesterday too)
  expect(analytics.streakDays).toBeGreaterThanOrEqual(1);
  expect(analytics.streakDays).toBe(2);
});
