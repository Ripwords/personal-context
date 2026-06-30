import { desc, eq, sql } from "drizzle-orm";
import { type Db } from "../client";
import {
  document,
  documentChunk,
  type Document,
  type NewDocument,
} from "../schema";
import { embedText, toVectorLiteral } from "../../ai/embeddings";

export async function createDocumentWithChunks(
  db: Db,
  doc: NewDocument,
  chunks: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<{ documentId: string; chunks: number }> {
  const { documentId } = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(document).values(doc).returning();
    const id = inserted!.id;

    if (chunks.length > 0) {
      await tx.insert(documentChunk).values(
        chunks.map((content, chunkIndex) => ({ documentId: id, chunkIndex, content })),
      );
    }
    return { documentId: id };
  });

  // Best-effort embeddings (post-commit so a failure never loses the upload).
  await embedDocumentChunks(db, documentId, chunks, env);
  return { documentId, chunks: chunks.length };
}

/** Embed each chunk and store its pgvector embedding. No-op when disabled / unprovisioned. */
async function embedDocumentChunks(
  db: Db,
  documentId: string,
  chunks: string[],
  env: Record<string, string | undefined>,
): Promise<void> {
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const vec = await embedText(chunks[chunkIndex]!, env);
    if (!vec) return; // disabled or model unreachable → stop (FTS still works)
    try {
      await db.execute(
        sql`UPDATE document_chunk SET embedding = ${toVectorLiteral(vec)}::vector
            WHERE document_id = ${documentId} AND chunk_index = ${chunkIndex}`,
      );
    } catch {
      return; // pgvector column not provisioned
    }
  }
}

export async function listDocuments(db: Db): Promise<Document[]> {
  return db.select().from(document).orderBy(desc(document.createdAt));
}

export async function getDocumentById(db: Db, id: string): Promise<Document | undefined> {
  const rows = await db.select().from(document).where(eq(document.id, id)).limit(1);
  return rows[0];
}

export async function deleteDocument(db: Db, id: string): Promise<void> {
  await db.delete(document).where(eq(document.id, id));
}

export interface DocumentSearchResult {
  documentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
}

function ftsDocuments(db: Db, query: string, limit: number) {
  return db
    .select({
      documentId: documentChunk.documentId,
      filename: document.filename,
      chunkIndex: documentChunk.chunkIndex,
      content: documentChunk.content,
    })
    .from(documentChunk)
    .innerJoin(document, eq(documentChunk.documentId, document.id))
    .where(sql`${documentChunk}.search @@ websearch_to_tsquery('english', ${query})`)
    .orderBy(sql`ts_rank(${documentChunk}.search, websearch_to_tsquery('english', ${query})) desc`)
    .limit(limit);
}

/**
 * RAG search over document chunks. Hybrid (semantic pgvector KNN + FTS) when
 * embeddings are enabled; pure FTS otherwise. Falls back to FTS if the vector
 * column isn't provisioned.
 */
export async function searchDocuments(
  db: Db,
  query: string,
  limit = 10,
  env: Record<string, string | undefined> = process.env,
): Promise<DocumentSearchResult[]> {
  if (!query.trim()) {
    // Empty/whitespace query → most recent chunks
    return db
      .select({
        documentId: documentChunk.documentId,
        filename: document.filename,
        chunkIndex: documentChunk.chunkIndex,
        content: documentChunk.content,
      })
      .from(documentChunk)
      .innerJoin(document, eq(documentChunk.documentId, document.id))
      .orderBy(desc(documentChunk.createdAt))
      .limit(limit);
  }

  const qvec = await embedText(query, env);
  if (!qvec) return ftsDocuments(db, query, limit);

  try {
    const lit = toVectorLiteral(qvec);
    const res = await db.execute(
      sql`SELECT dc.document_id AS "documentId", d.filename AS filename,
                 dc.chunk_index AS "chunkIndex", dc.content AS content
          FROM document_chunk dc
          JOIN document d ON d.id = dc.document_id
          WHERE dc.embedding IS NOT NULL
          ORDER BY dc.embedding <=> ${lit}::vector
          LIMIT ${limit}`,
    );
    const vec = res.rows as unknown as DocumentSearchResult[];
    const fts = await ftsDocuments(db, query, limit);
    const key = (r: DocumentSearchResult) => `${r.documentId}:${r.chunkIndex}`;
    const seen = new Set(vec.map(key));
    return [...vec, ...fts.filter((r) => !seen.has(key(r)))].slice(0, limit);
  } catch {
    return ftsDocuments(db, query, limit);
  }
}
