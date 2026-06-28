// Dev smoke: document text-extract → chunk → store → FTS retrieve, against the test DB.
// Usage: bun scripts/smoke-rag.ts
import { makeDb } from "../server/db/client";
import { truncateAll } from "../server/db/test-helpers";
import { extractText } from "../server/rag/extract-text";
import { chunkText } from "../server/rag/chunk";
import { createDocumentWithChunks, searchDocuments } from "../server/db/queries/documents";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL not set");
const db = makeDb(url);
await truncateAll(db);

const body =
  "Braindump architecture notes.\n\n" +
  "The calendar syncs events from two Google accounts via OAuth.\n\n" +
  "Memories are extracted with DeepSeek and recalled via Postgres full-text search.\n\n" +
  "Documents are chunked and indexed for retrieval-augmented generation.";

const bytes = new TextEncoder().encode(body);
const text = await extractText("notes.md", "text/markdown", bytes);
const chunks = chunkText(text);
console.log(`extracted ${text.length} chars → ${chunks.length} chunks`);

const { documentId, chunks: n } = await createDocumentWithChunks(
  db,
  { filename: "notes.md", mimeType: "text/markdown", sizeBytes: bytes.length, storagePath: "/tmp/notes.md" },
  chunks,
);
console.log(`stored document ${documentId} with ${n} chunks`);

console.log('\nsearch "full-text search":');
for (const r of await searchDocuments(db, "full-text search"))
  console.log(`  [${r.filename}#${r.chunkIndex}] ${r.content}`);

const hits = await searchDocuments(db, "google oauth");
console.log('\nsearch "google oauth":');
for (const r of hits) console.log(`  [${r.filename}#${r.chunkIndex}] ${r.content}`);

if (hits.length === 0) {
  console.error("SMOKE FAIL: no chunk matched");
  process.exit(1);
}
console.log("\nSMOKE OK");
process.exit(0);
