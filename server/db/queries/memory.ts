import { desc, eq, sql } from "drizzle-orm";
import { type Db } from "../client";
import { memory, type Memory, type NewMemory } from "../schema";

export async function createMemory(
  db: Db,
  input: Pick<NewMemory, "content" | "source">,
): Promise<Memory> {
  const [row] = await db.insert(memory).values(input).returning();
  return row!;
}

export async function listMemories(db: Db, limit = 100): Promise<Memory[]> {
  return db.select().from(memory).orderBy(desc(memory.createdAt)).limit(limit);
}

export async function updateMemory(db: Db, id: string, content: string): Promise<Memory> {
  const [row] = await db
    .update(memory)
    .set({ content })
    .where(eq(memory.id, id))
    .returning();
  if (!row) {
    throw new Error(`Memory not found: ${id}`);
  }
  return row;
}

export async function deleteMemory(db: Db, id: string): Promise<void> {
  await db.delete(memory).where(eq(memory.id, id));
}

export async function searchMemories(db: Db, query: string, limit = 20): Promise<Memory[]> {
  if (!query.trim()) {
    return listMemories(db, limit);
  }

  return db
    .select({
      id: memory.id,
      content: memory.content,
      source: memory.source,
      createdAt: memory.createdAt,
    })
    .from(memory)
    .where(sql`search @@ websearch_to_tsquery('english', ${query})`)
    .orderBy(sql`ts_rank(search, websearch_to_tsquery('english', ${query})) desc`)
    .limit(limit);
}
