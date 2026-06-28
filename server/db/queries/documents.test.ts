import { describe, test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import {
  createDocumentWithChunks,
  listDocuments,
  deleteDocument,
  getDocumentById,
  searchDocuments,
} from "./documents";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

const sampleDoc = {
  filename: "test.txt",
  mimeType: "text/plain",
  sizeBytes: 1234,
  storagePath: "/uploads/test.txt",
};

describe("createDocumentWithChunks + listDocuments", () => {
  test("creates a document and returns documentId and chunk count", async () => {
    const result = await createDocumentWithChunks(db, sampleDoc, [
      "chunk one",
      "chunk two",
      "chunk three",
    ]);
    expect(result.documentId).toBeString();
    expect(result.chunks).toBe(3);
  });

  test("listDocuments returns the created document", async () => {
    await createDocumentWithChunks(db, sampleDoc, ["hello world"]);
    const docs = await listDocuments(db);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.filename).toBe("test.txt");
    expect(docs[0]!.mimeType).toBe("text/plain");
    expect(docs[0]!.sizeBytes).toBe(1234);
  });

  test("listDocuments returns newest first", async () => {
    await createDocumentWithChunks(db, { ...sampleDoc, filename: "a.txt" }, ["alpha"]);
    await new Promise((r) => setTimeout(r, 5));
    await createDocumentWithChunks(db, { ...sampleDoc, filename: "b.txt" }, ["beta"]);
    const docs = await listDocuments(db);
    expect(docs[0]!.filename).toBe("b.txt");
    expect(docs[1]!.filename).toBe("a.txt");
  });

  test("creates chunks with correct chunkIndex values", async () => {
    const { documentId } = await createDocumentWithChunks(db, sampleDoc, [
      "first",
      "second",
      "third",
    ]);
    // Search for all chunks and verify indices via searchDocuments fallback
    const results = await searchDocuments(db, "", 10);
    const myChunks = results
      .filter((r) => r.documentId === documentId)
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
    expect(myChunks[0]!.chunkIndex).toBe(0);
    expect(myChunks[1]!.chunkIndex).toBe(1);
    expect(myChunks[2]!.chunkIndex).toBe(2);
  });
});

describe("searchDocuments", () => {
  test("finds chunk by keyword and returns filename", async () => {
    await createDocumentWithChunks(
      db,
      { ...sampleDoc, filename: "notes.txt" },
      ["The quick brown fox jumps over the lazy dog", "Unrelated content here"],
    );

    const results = await searchDocuments(db, "fox");
    expect(results.length).toBeGreaterThanOrEqual(1);
    const hit = results.find((r) => r.content.includes("fox"));
    expect(hit).toBeDefined();
    expect(hit!.filename).toBe("notes.txt");
    expect(hit!.chunkIndex).toBe(0);
  });

  test("empty query returns most recent chunks", async () => {
    await createDocumentWithChunks(db, sampleDoc, ["alpha chunk", "beta chunk"]);
    const results = await searchDocuments(db, "");
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test("whitespace query returns recent chunks", async () => {
    await createDocumentWithChunks(db, sampleDoc, ["gamma delta"]);
    const results = await searchDocuments(db, "   ");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("search result includes documentId, filename, chunkIndex, content", async () => {
    const { documentId } = await createDocumentWithChunks(
      db,
      { ...sampleDoc, filename: "readme.md" },
      ["important information about elephants"],
    );
    const results = await searchDocuments(db, "elephant");
    expect(results).toHaveLength(1);
    expect(results[0]!.documentId).toBe(documentId);
    expect(results[0]!.filename).toBe("readme.md");
    expect(results[0]!.chunkIndex).toBe(0);
    expect(results[0]!.content).toContain("elephant");
  });
});

describe("getDocumentById", () => {
  test("returns the document when it exists", async () => {
    const { documentId } = await createDocumentWithChunks(db, sampleDoc, ["hello"]);
    const doc = await getDocumentById(db, documentId);
    expect(doc).toBeDefined();
    expect(doc!.id).toBe(documentId);
    expect(doc!.filename).toBe("test.txt");
  });

  test("returns undefined when document does not exist", async () => {
    const doc = await getDocumentById(db, "00000000-0000-0000-0000-000000000000");
    expect(doc).toBeUndefined();
  });
});

describe("deleteDocument", () => {
  test("deletes document and cascades to chunks", async () => {
    const { documentId } = await createDocumentWithChunks(db, sampleDoc, [
      "chunk a",
      "chunk b",
    ]);

    await deleteDocument(db, documentId);

    const docs = await listDocuments(db);
    expect(docs).toHaveLength(0);

    // Chunks should be gone too (via cascade)
    const chunks = await searchDocuments(db, "");
    expect(chunks.filter((c) => c.documentId === documentId)).toHaveLength(0);
  });

  test("delete is idempotent (no error if not found)", async () => {
    await expect(
      deleteDocument(db, "00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeUndefined();
  });
});
