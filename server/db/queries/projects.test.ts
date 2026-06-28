// server/db/queries/projects.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createProject, listProjects } from "./projects";
import { seedDefaultProjects } from "../seed";

const db = getTestDb();
beforeEach(async () => {
  await truncateAll(db);
});

test("createProject inserts and returns the row", async () => {
  const p = await createProject(db, { name: "Work", color: "#0D9488", kind: "work" });
  expect(p.id).toBeTruthy();
  expect(p.name).toBe("Work");
  expect(p.keywords).toEqual([]);
});

test("listProjects returns inserted projects", async () => {
  await createProject(db, { name: "Work", color: "#0D9488", kind: "work" });
  await createProject(db, { name: "Personal", color: "#EA580C", kind: "personal" });
  const all = await listProjects(db);
  expect(all.length).toBe(2);
});

test("seedDefaultProjects seeds the five defaults exactly once", async () => {
  const first = await seedDefaultProjects(db);
  expect(first.map((p) => p.name).sort()).toEqual(
    ["Freelance", "Hackathon", "Part-time", "Personal", "Work"],
  );
  const second = await seedDefaultProjects(db);
  expect(second.length).toBe(5); // no duplicates on re-run
});
