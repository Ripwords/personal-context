// server/db/seed.ts
import { type Db } from "./client";
import { type NewProject, type Project } from "./schema";
import { createProject, listProjects } from "./queries/projects";

const DEFAULT_PROJECTS: NewProject[] = [
  { name: "Work", color: "#0D9488", kind: "work", isDefault: true,
    keywords: ["meeting", "standup", "deploy", "ticket", "manager"] },
  { name: "Part-time", color: "#2563EB", kind: "part_time", isDefault: true,
    keywords: ["shift", "client", "invoice"] },
  { name: "Freelance", color: "#7C3AED", kind: "freelance", isDefault: true,
    keywords: ["proposal", "contract", "scope", "deliverable"] },
  { name: "Hackathon", color: "#DB2777", kind: "hackathon", isDefault: true,
    keywords: ["demo", "prototype", "submit", "pitch", "team"] },
  { name: "Personal", color: "#EA580C", kind: "personal", isDefault: true,
    keywords: ["gym", "groceries", "family", "appointment", "errand"] },
];

export async function seedDefaultProjects(db: Db): Promise<Project[]> {
  const existing = await listProjects(db);
  if (existing.length > 0) return existing;
  for (const p of DEFAULT_PROJECTS) {
    await createProject(db, p);
  }
  return listProjects(db);
}
