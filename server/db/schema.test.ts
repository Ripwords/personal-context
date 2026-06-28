// server/db/schema.test.ts
import { test, expect } from "bun:test";
import {
  projects,
  dumps,
  todos,
  events,
  activities,
  projectKind,
} from "./schema";

test("tables are exported", () => {
  for (const t of [projects, dumps, todos, events, activities]) {
    expect(t).toBeDefined();
  }
});

test("projectKind enum has the seeded kinds", () => {
  expect(projectKind.enumValues).toEqual([
    "work",
    "part_time",
    "freelance",
    "hackathon",
    "personal",
    "other",
  ]);
});

test("event time columns are starts_at / ends_at", () => {
  expect(events.startsAt).toBeDefined();
  expect(events.endsAt).toBeDefined();
});
