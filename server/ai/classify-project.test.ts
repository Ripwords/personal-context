import { test, expect } from "bun:test";
import { classifyProjectByKeywords } from "./classify-project";
import type { Project } from "../db/schema";

function proj(id: string, name: string, keywords: string[]): Project {
  return {
    id, name, color: "#000", kind: "work", keywords,
    isDefault: false, createdAt: new Date(),
  } as Project;
}

const projects: Project[] = [
  proj("work", "Work", ["standup", "deploy", "ticket"]),
  proj("personal", "Personal", ["gym", "groceries", "family"]),
];

test("matches by keyword", () => {
  const m = classifyProjectByKeywords("push the deploy after standup", projects);
  expect(m.projectId).toBe("work");
  expect(m.score).toBe(2);
});

test("a project name mention outweighs a single keyword", () => {
  const m = classifyProjectByKeywords("quick personal note, also a ticket", projects);
  expect(m.projectId).toBe("personal"); // name(+2) beats 'ticket'(+1)
});

test("returns null when nothing matches", () => {
  expect(classifyProjectByKeywords("buy a kayak", projects).projectId).toBeNull();
});

test("word-boundary: 'gym' does not match 'gymnastics'", () => {
  expect(classifyProjectByKeywords("watch a gymnastics meet", projects).projectId).toBeNull();
});

test("case-insensitive", () => {
  expect(classifyProjectByKeywords("GROCERIES run", projects).projectId).toBe("personal");
});
