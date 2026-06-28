// server/db/queries/projects.ts
import { type Db } from "../client";
import { projects, type NewProject, type Project } from "../schema";

export async function createProject(db: Db, input: NewProject): Promise<Project> {
  const [row] = await db.insert(projects).values(input).returning();
  return row!;
}

export async function listProjects(db: Db): Promise<Project[]> {
  return db.select().from(projects);
}
