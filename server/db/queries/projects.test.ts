// server/db/queries/projects.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createProject, listProjects, updateProject, deleteProject, addProjectKeyword } from "./projects";
import { createTodo, getTodoById } from "./items";
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

test("updateProject changes name/color/keywords", async () => {
  const p = await createProject(db, { name: "Work", color: "#000", kind: "work" });
  const updated = await updateProject(db, p.id, { name: "Day Job", keywords: ["standup"] });
  expect(updated!.name).toBe("Day Job");
  expect(updated!.keywords).toEqual(["standup"]);
  expect(updated!.color).toBe("#000"); // untouched
});

test("addProjectKeyword appends deduped, lower-cased keywords", async () => {
  const p = await createProject(db, { name: "Work", color: "#000", kind: "work", keywords: ["deploy"] });
  await addProjectKeyword(db, p.id, "Standup");
  const again = await addProjectKeyword(db, p.id, "standup"); // dup → no-op
  expect(again!.keywords).toEqual(["deploy", "standup"]);
});

test("deleteProject nulls referencing todos then removes the project", async () => {
  const p = await createProject(db, { name: "Work", color: "#000", kind: "work" });
  const t = await createTodo(db, { title: "task", projectId: p.id });
  expect(await deleteProject(db, p.id)).toBe(true);
  expect((await getTodoById(db, t.id))!.projectId).toBeNull();
  expect((await listProjects(db)).length).toBe(0);
});

test("seedDefaultProjects seeds the five defaults exactly once", async () => {
  const first = await seedDefaultProjects(db);
  expect(first.map((p) => p.name).sort()).toEqual(
    ["Freelance", "Hackathon", "Part-time", "Personal", "Work"],
  );
  const second = await seedDefaultProjects(db);
  expect(second.length).toBe(5); // no duplicates on re-run
});
