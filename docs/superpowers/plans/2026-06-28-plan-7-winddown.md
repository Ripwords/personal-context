# Braindump Plan 7 — End-of-Day Wind-Down

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** At day's end, summarize the day's dumps + open todos into a deduped, project-grouped simplified list and a proposed time-block schedule for tomorrow; let the user apply the schedule with one tap.

**Architecture:** A `summarizeDay(db, model, now)` reads today's `dumps` + open `todos`, calls the configurable model via `generateObject` (Zod-typed proposal: grouped todos + tomorrow blocks referencing existing todoIds), and returns the proposal (no writes). A pure `applyWindDownSchedule(db, blocks)` sets `scheduledStart/End` on the referenced todos and logs activity (transaction). Endpoints expose both; a minimal monochrome wind-down screen shows the proposal and an "Apply schedule" button. Model injected for tests; live-smokeable with DeepSeek.

**Tech Stack:** AI SDK v7 (`generateObject`), Zod, Drizzle/node-postgres, Nuxt 4 + Nuxt UI, Bun.

## Global Constraints
- Bun only; never `any`. TDD. Conventional Commits + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Reuse `getDb`/`getAuthSession`/`makeModel`/Plan-1 queries/`logActivity`. Model injected into `summarizeDay`.
- Reads today's dumps + open todos; proposal references EXISTING `todoId`s so apply just schedules them (no duplicate todos). Apply is transactional + logged (undoable via existing undo? undo handles `create`; scheduling is `update` — log `action:"schedule"` with prior values in payload so a future undo could revert; not required to wire undo here).
- Minimal monochrome UI (spec §7).

---

## Task 1: `summarizeDay` + `applyWindDownSchedule`

**Files:** `server/ai/winddown.ts`, `server/ai/winddown.test.ts`.

**Interfaces:**
- `type WindDownProposal = { groups: Array<{ project: string | null; items: Array<{ todoId: string; title: string }> }>; schedule: Array<{ todoId: string; title: string; startsAt: string; endsAt: string }> }`
- `summarizeDay(db: Db, model: LanguageModel, now: Date): Promise<WindDownProposal>` — gather today's dumps (createdAt >= start of `now`'s day) + open todos (`listUnscheduledTodos` + scheduled-today); build a context string listing open todos **with their ids**; `generateObject({ model, schema, prompt, system })` where the system prompt gives the current datetime and instructs: dedupe/group the open todos by project, and propose tomorrow time blocks (realistic hours, no overlaps) for the most important items, **referencing the given todo ids only**. Return the validated object.
- `applyWindDownSchedule(db: Db, blocks: Array<{ todoId: string; startsAt: string; endsAt: string }>): Promise<number>` — in a transaction, for each block set the todo's `scheduledStart`/`scheduledEnd` (parse ISO; skip invalid), `logActivity({action:"schedule", entityType:"todo", entityId, payload})`; return count scheduled. **TDD this directly** (network-free): create open todos, call with hand-built blocks, assert `scheduledStart` set + activity logged + invalid block skipped.

- [ ] Write `winddown.test.ts` for `applyWindDownSchedule` (RED) → implement `winddown.ts` (schema + both fns) → GREEN. `summarizeDay` itself is typecheck-only (covered live in Task 4). Full `bun test` green; typecheck 0. Commit `feat: end-of-day summarizeDay + applyWindDownSchedule`.

---

## Task 2: Endpoints

**Files:** `server/api/wind-down/index.post.ts` (→ proposal), `server/api/wind-down/apply.post.ts` (→ applies blocks).

- [ ] Both 401-gate via `getAuthSession`, use `getDb()`. `index.post` = `summarizeDay(getDb(), makeModel(), new Date())` (502 on model error). `apply.post` reads `{ blocks }`, validates with the Zod block schema, returns `{ scheduled: await applyWindDownSchedule(...) }`. Typecheck 0; full suite green. Commit.

---

## Task 3: Wind-down UI

**Files:** `app/pages/wind-down.vue`; a link from `index.vue`.

- [ ] A monochrome screen: a "Summarize my day" button → `$fetch('/api/wind-down', {method:'POST'})`; render the grouped simplified list (by project, with the per-project tick) and the proposed schedule blocks (time + title, tabular figures); an "Apply schedule" button → `$fetch('/api/wind-down/apply', {method:'POST', body:{blocks}})` then a success toast; loading states (the model takes a few seconds). `useFetch`/`$fetch`, never `any`, B&W, a11y. Typecheck 0; suite green. Commit.

---

## Task 4: Live smoke (DeepSeek)
- [ ] A throwaway `scripts/smoke-winddown.ts`: seed projects, create a few open todos + a dump, call `summarizeDay(db, makeModel(), new Date())`, print the groups + schedule (assert ≥1 group and schedule blocks reference real todo ids in the current/next day). Run `bun scripts/smoke-winddown.ts`; record output. Then `applyWindDownSchedule` with the proposed blocks → confirm todos got `scheduledStart`. Keep or delete the script.

---

## Self-Review
- End-of-day dedupe/group + tomorrow schedule (spec §6 wind-down) → Tasks 1-2. ✓
- Approve-to-schedule (sets scheduledStart/End on existing todos; appears on the calendar via the existing `listScheduledTodosInRange`) → `applyWindDownSchedule` + Task 3. ✓
- Live-verified with DeepSeek → Task 4. ✓
- Model injected; apply TDD'd network-free; `generateObject` current-date anchored (carries Plan 4's lesson). ✓
- Google write-back of scheduled blocks to the Braindump calendar is deferred to Plan 6 (needs live OAuth) — scheduling is local here and shows on the in-app calendar.
