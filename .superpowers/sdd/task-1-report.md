# Task 1 Report — document + chunk tables, chunking, FTS document search

## Migration hand-edit
File: `drizzle/0007_broad_roulette.sql`
After the FK constraint, hand-added:
```sql
ALTER TABLE "document_chunk" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;
CREATE INDEX "document_chunk_search_idx" ON "document_chunk" USING gin ("search");
```
Same pattern as `0006_lazy_jasper_sitwell.sql` (memory table). `search` is NOT in the Drizzle schema object — it is DB-managed.

## truncateAll change
`server/db/test-helpers.ts`: prepended `document_chunk, document` before other tables in the TRUNCATE statement (child before parent; CASCADE handles the rest).

## TDD evidence
- **Red → Green**: wrote `chunk.test.ts` and `documents.test.ts` before implementations; confirmed both fail with "Cannot find module" errors.
- `chunk.test.ts`: 9 tests covering empty input, whitespace, single chunk, multiple chunks ≤ maxChars, drop empties, order, default 2000-char limit, oversized paragraph, accumulation boundary.
- `documents.test.ts`: 10 tests covering create+count, listDocuments, newest-first, chunkIndex assignment, keyword FTS+filename, empty query recents, whitespace recents, result shape, cascade delete, idempotent delete.
- All 19 new tests green after implementation.

## Full suite
98 pass, 0 fail (up from 79 baseline + 19 new).

## Typecheck exit
`bunx nuxi typecheck` → exit 0, 0 errors.

## Concerns
- None blocking. `search` column not in Drizzle schema means Drizzle's `$inferSelect` won't include it — intentional, per spec.
- Single paragraphs exceeding maxChars are emitted as-is (not sub-split), which is acceptable for document chunking.
