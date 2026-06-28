# Braindump Plan D — Background Memory + Manager

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Quietly capture durable facts from dumps via an AI pass (claude-mem style), store them, recall the relevant ones, and give a CRUD memory-manager page — with a minimal "saved to memory" cue.

**Decision (overnight reliability):** Recall uses **Postgres full-text search** (`websearch_to_tsquery` over a `tsvector`), not vector embeddings. This is fully self-hosted, needs no Ollama/model download, and is reliable to build+verify unattended. The AI *extraction* of memories uses the existing DeepSeek provider. **Upgrade path (documented, not built):** add `pgvector` + an Ollama embedding column for semantic recall — `searchMemories` becomes a vector query; everything else stays.

**Architecture:** A `memory` table with a generated `tsvector`. `extractMemories(db, model, text)` asks the model (generateObject) for durable, reusable facts and inserts them. `searchMemories(db, query)` does FTS ranking. CRUD queries + routes back a manager page. Extraction is fired (fire-and-forget) after a dump; the dump UI shows a subtle "N saved to memory" cue.

**Tech Stack:** AI SDK v7 (`generateObject`), Drizzle/node-postgres (+ FTS), Nuxt 4 + Nuxt UI, Bun.

## Global Constraints
- Bun only; never `any`. TDD. Conventional Commits + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Reuse `getDb`/`getAuthSession`/`makeModel`/`logActivity`. Model injected into `extractMemories` for tests.
- Minimal monochrome UI; the capture cue must be subtle (no modal).

---

## Task 1: `memory` table + CRUD + FTS search

**Files:** `server/db/schema.ts` (+migration), `server/db/queries/memory.ts` + test.

**Interfaces:**
- `memory` table: `id uuid pk`, `content text notNull`, `source` enum `memory_source` (`dump`|`chat`|`manual`), `createdAt timestamptz default now()`, and a Postgres generated column `search tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED` with a GIN index. (Add the generated column + index via a hand-edited line in the generated migration if drizzle can't express it — note it; the table itself is drizzle.)
- `createMemory(db, input: { content: string; source: "dump"|"chat"|"manual" }): Promise<Memory>`
- `listMemories(db, limit?): Promise<Memory[]>` (newest first)
- `updateMemory(db, id, content): Promise<Memory>` (throws if missing)
- `deleteMemory(db, id): Promise<void>`
- `searchMemories(db, query: string, limit?): Promise<Memory[]>` — `websearch_to_tsquery('english', query)` ranked by `ts_rank`; empty/whitespace query → returns the most recent N.

- [ ] TDD (real DB): create memories; list newest-first; update changes content; delete removes; **search** returns the row matching a keyword and ranks it, and an empty query returns recents. Implement table + migration (generated tsvector column + GIN index) + queries. Full suite green; typecheck 0. Commit `feat: memory table + CRUD + full-text search`.

---

## Task 2: `extractMemories` + hook into the dump flow

**Files:** `server/ai/memory-extract.ts` + test; modify `server/api/dump.post.ts`.

**Interfaces:**
- `extractMemories(db, model, text): Promise<number>` — `generateObject` with a schema `{ memories: string[] }`; system prompt: "Extract only durable, reusable facts about the user worth remembering across days (preferences, recurring people/projects, constraints, habits). Ignore one-off task items and ephemeral details. Return [] if nothing is durable." Insert each as a `memory` row (`source: "dump"`); return the count. Model injected.
- Dump route: after a successful `extractFromDump`, fire `extractMemories(getDb(), makeModel(), text)` **without blocking the response on failure** (await it but wrap in try/catch; include `memoriesSaved` in the response). The dump UI shows a subtle "🧠 N saved to memory" line when `memoriesSaved > 0`.

- [ ] TDD the insert/count path with a fake model (or a pure `saveMemories(db, facts)` helper tested directly, mirroring Plan 4's applyToolCalls approach). Wire the dump route (return `memoriesSaved`). Full suite green; typecheck 0. Commit `feat: AI memory extraction wired into dumps`.

---

## Task 3: Memory manager page + CRUD routes + capture cue

**Files:** `server/api/memory/index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`; `app/pages/memories.vue`; small edit to `app/pages/dump.vue` (cue) + `index.vue` (link).

- [ ] Routes (all 401-gate via `getAuthSession`, `getDb()`, never `any`): GET list, POST create (`source:"manual"`), PATCH update content, DELETE remove. `memories.vue`: monochrome list of memories with inline edit + delete + an "Add memory" box; `useFetch`/`$fetch`. Add the subtle "N saved to memory" cue to `dump.vue` (shows after capture when `memoriesSaved>0`, auto-fades). Add a "Memory" link to `index.vue`. Typecheck 0; full suite green. Commit `feat: memory manager page + CRUD routes + capture cue`.

---

## Task 4: Live smoke (DeepSeek)
- [ ] `scripts/smoke-memory.ts`: call `extractMemories(db, makeModel(), "I always do deep work in the mornings and I hate meetings after 4pm. My manager is Sam.")` → expect ≥1 durable memory inserted; then `searchMemories(db, "meetings")` returns the relevant one. Run `bun scripts/smoke-memory.ts`; record output.

---

## Self-Review
- Background capture of durable facts (spec: background memory) → Task 2. ✓
- Recall (search) → `searchMemories` (FTS) Task 1; semantic upgrade documented. ✓
- Memory manager CRUD page (spec) → Task 3. ✓
- Minimal "saved" cue, no modal → Task 3. ✓
- Live-verified with DeepSeek → Task 4. ✓
- pgvector+Ollama semantic recall is a documented upgrade, not built (reliability). The `search_memory` chat tool + recall-into-chat-context land with the conversational-chat work (Plan E).
