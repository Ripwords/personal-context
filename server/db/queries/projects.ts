// server/db/queries/projects.ts
import { eq } from "drizzle-orm";
import { type Db, type DbOrTx } from "../client";
import { projects, todos, events, type NewProject, type Project } from "../schema";

export async function createProject(db: Db, input: NewProject): Promise<Project> {
  const [row] = await db.insert(projects).values(input).returning();
  return row!;
}

export async function listProjects(db: Db): Promise<Project[]> {
  return db.select().from(projects);
}

export async function updateProject(
  db: DbOrTx,
  id: string,
  fields: { name?: string; color?: string; keywords?: string[] },
): Promise<Project | null> {
  const set: Partial<NewProject> = {};
  if (fields.name !== undefined) set.name = fields.name;
  if (fields.color !== undefined) set.color = fields.color;
  if (fields.keywords !== undefined) set.keywords = fields.keywords;
  if (Object.keys(set).length === 0) {
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    return row ?? null;
  }
  const [row] = await db.update(projects).set(set).where(eq(projects.id, id)).returning();
  return row ?? null;
}

export async function deleteProject(db: Db, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Null out references first — the FK is NO ACTION, so a referenced project
    // can't be deleted otherwise. Todos/events become "no project".
    await tx.update(todos).set({ projectId: null }).where(eq(todos.projectId, id));
    await tx.update(events).set({ projectId: null }).where(eq(events.projectId, id));
    const rows = await tx.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
    return rows.length > 0;
  });
}

/** Append a keyword to a project (deduped, lower-cased) so corrections teach the classifier. */
export async function addProjectKeyword(db: DbOrTx, id: string, keyword: string): Promise<Project | null> {
  const kw = keyword.trim().toLowerCase();
  if (!kw) {
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    return row ?? null;
  }
  const [existing] = await db.select().from(projects).where(eq(projects.id, id));
  if (!existing) return null;
  if (existing.keywords.includes(kw)) return existing;
  const [row] = await db
    .update(projects)
    .set({ keywords: [...existing.keywords, kw] })
    .where(eq(projects.id, id))
    .returning();
  return row ?? null;
}
