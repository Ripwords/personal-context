import { desc, eq, sql } from "drizzle-orm";
import { type Db } from "../client";
import { memory, type Memory, type NewMemory } from "../schema";
import { embedText, toVectorLiteral } from "../../ai/embeddings";

/**
 * Best-effort: when embeddings are enabled, store a pgvector embedding for the
 * row. Swallows errors (Ollama down, or the optional pgvector column/extension
 * not applied) so memory writes never fail on the embedding path.
 */
async function storeMemoryEmbedding(
  db: Db,
  id: string,
  content: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const vec = await embedText(content, env);
  if (!vec) return;
  try {
    await db.execute(sql`UPDATE memory SET embedding = ${toVectorLiteral(vec)}::vector WHERE id = ${id}`);
  } catch {
    // pgvector not provisioned — recall falls back to FTS.
  }
}

export async function createMemory(
  db: Db,
  input: Pick<NewMemory, "content" | "source">,
  env: Record<string, string | undefined> = process.env,
): Promise<Memory> {
  const [row] = await db.insert(memory).values(input).returning();
  await storeMemoryEmbedding(db, row!.id, row!.content, env);
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

function ftsMemories(db: Db, query: string, limit: number) {
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

/**
 * Recall memories for `query`. With embeddings enabled, runs hybrid recall:
 * semantic (pgvector cosine KNN) results first, then any FTS matches not already
 * included — so conversational queries surface semantically-related memories that
 * keyword search misses. Falls back to pure FTS when embeddings are off or the
 * vector column isn't provisioned.
 */
export async function searchMemories(
  db: Db,
  query: string,
  limit = 20,
  env: Record<string, string | undefined> = process.env,
): Promise<Memory[]> {
  if (!query.trim()) {
    return listMemories(db, limit);
  }

  const qvec = await embedText(query, env);
  if (!qvec) return ftsMemories(db, query, limit);

  try {
    const lit = toVectorLiteral(qvec);
    const res = await db.execute(
      sql`SELECT id, content, source, created_at AS "createdAt"
          FROM memory
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${lit}::vector
          LIMIT ${limit}`,
    );
    const vec = res.rows as unknown as Memory[];
    const fts = await ftsMemories(db, query, limit);
    const seen = new Set(vec.map((r) => r.id));
    return [...vec, ...fts.filter((r) => !seen.has(r.id))].slice(0, limit);
  } catch {
    return ftsMemories(db, query, limit);
  }
}
