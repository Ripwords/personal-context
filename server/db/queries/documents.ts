import { desc, eq, sql } from "drizzle-orm";
import { type Db } from "../client";
import {
  document,
  documentChunk,
  type Document,
  type NewDocument,
} from "../schema";

export async function createDocumentWithChunks(
  db: Db,
  doc: NewDocument,
  chunks: string[],
): Promise<{ documentId: string; chunks: number }> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(document).values(doc).returning();
    const documentId = inserted!.id;

    if (chunks.length > 0) {
      await tx.insert(documentChunk).values(
        chunks.map((content, chunkIndex) => ({
          documentId,
          chunkIndex,
          content,
        })),
      );
    }

    return { documentId, chunks: chunks.length };
  });
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

export async function searchDocuments(
  db: Db,
  query: string,
  limit = 10,
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

  return db
    .select({
      documentId: documentChunk.documentId,
      filename: document.filename,
      chunkIndex: documentChunk.chunkIndex,
      content: documentChunk.content,
    })
    .from(documentChunk)
    .innerJoin(document, eq(documentChunk.documentId, document.id))
    .where(
      sql`${documentChunk}.search @@ websearch_to_tsquery('english', ${query})`,
    )
    .orderBy(
      sql`ts_rank(${documentChunk}.search, websearch_to_tsquery('english', ${query})) desc`,
    )
    .limit(limit);
}
