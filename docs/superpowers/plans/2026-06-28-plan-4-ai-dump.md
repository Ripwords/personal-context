# Braindump Plan 4 — AI Dump Extraction + Chat + Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn a free-form dump into project-tagged todos/events via AI tool-calling (auto-then-undo), with an activity feed + undo, a minimal dump/chat UI, and a configurable LLM provider (DeepSeek default).

**Architecture:** A configurable `ai/` module (Vercel AI SDK) exposes a model factory and an `extractFromDump(model, text, projects)` that drives tool-calls (`create_todo`, `create_event`) with Zod-validated args. The model is injectable so extraction is unit-tested with a fake; live runs use DeepSeek. A `POST /api/dump` stores the raw dump, runs extraction, writes todos/events + an `activity` row per creation, and returns the results. `GET /api/activity` + `POST /api/undo` power the feed and one-tap undo. A minimal monochrome dump screen streams items as they appear.

**Tech Stack:** Vercel AI SDK (`ai`, `@ai-sdk/deepseek`, `@ai-sdk/anthropic`), Zod, Drizzle/node-postgres, Nuxt 4 + Nuxt UI, Bun.

## Global Constraints

- Bun only; never `any`. TDD. Conventional Commits + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- Reuse `getDb()` (shared pool), `getAuthSession`, Plan 1 query helpers, `listProjects`, `logActivity`/`listActivity`.
- AI provider **configurable via `LLM_PROVIDER` (default `deepseek`)**; extraction model must support tool-calling (`deepseek-chat`; or `claude-...` when provider=anthropic). The model is **injected** into `extractFromDump` so tests never hit the network.
- "Auto then undo": creations happen immediately + are logged to `activity` with enough payload to undo; nothing requires pre-confirmation. Low-confidence project tags are flagged (not blocked).
- node-postgres supports `db.transaction()` — wrap multi-row writes.
- Minimal monochrome UI (spec §7).

---

## Task 1: Model provider factory

**Files:** Create `server/ai/model.ts` + `server/ai/model.test.ts`.

**Interfaces:**
- Produces `resolveModelId(provider: string): { provider: "deepseek" | "anthropic"; modelId: string }` (pure; default deepseek `deepseek-chat`; anthropic → `claude-sonnet-4-6`; unknown → throws) and `makeModel(env?: Record<string,string|undefined>)` returning a Vercel AI SDK `LanguageModel` for the configured provider (reads `LLM_PROVIDER`, key from `DEEPSEEK_API_KEY`/`ANTHROPIC_API_KEY`).

- [ ] **Step 1: Install AI SDK**

```bash
bun add ai @ai-sdk/deepseek @ai-sdk/anthropic
```

- [ ] **Step 2: Failing test (pure resolver)**

```ts
// server/ai/model.test.ts
import { test, expect } from "bun:test";
import { resolveModelId } from "./model";

test("defaults to deepseek-chat", () => {
  expect(resolveModelId("deepseek")).toEqual({ provider: "deepseek", modelId: "deepseek-chat" });
});
test("anthropic maps to a sonnet model", () => {
  const r = resolveModelId("anthropic");
  expect(r.provider).toBe("anthropic");
  expect(r.modelId).toContain("claude");
});
test("unknown provider throws", () => {
  expect(() => resolveModelId("bogus")).toThrow(/provider/i);
});
```

- [ ] **Step 3: Run → fail.** `bun test server/ai/model.test.ts`.

- [ ] **Step 4: Implement** (doc-verify `@ai-sdk/deepseek` / `@ai-sdk/anthropic` factory names at <https://ai-sdk.dev/providers/ai-sdk-providers/deepseek> and `/anthropic`; baseline below):

```ts
// server/ai/model.ts
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export function resolveModelId(provider: string): {
  provider: "deepseek" | "anthropic";
  modelId: string;
} {
  if (provider === "deepseek") return { provider: "deepseek", modelId: "deepseek-chat" };
  if (provider === "anthropic") return { provider: "anthropic", modelId: "claude-sonnet-4-6" };
  throw new Error(`unknown LLM provider: ${provider}`);
}

export function makeModel(env: Record<string, string | undefined> = process.env): LanguageModel {
  const { provider, modelId } = resolveModelId(env.LLM_PROVIDER ?? "deepseek");
  if (provider === "deepseek") {
    return createDeepSeek({ apiKey: env.DEEPSEEK_API_KEY ?? "" })(modelId);
  }
  return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY ?? "" })(modelId);
}
```

- [ ] **Step 5: Run → pass.** Full `bun test`. Commit `feat: configurable AI model factory (deepseek default)`.

---

## Task 2: Extraction tools + `extractFromDump`

**Files:** Create `server/ai/tools.ts`, `server/ai/extract.ts`, `server/ai/extract.test.ts`.

**Interfaces:**
- Produces:
  - Zod schemas `todoToolSchema` / `eventToolSchema` (fields incl. `title`, optional `notes`, `project` (string name), `confidence` (0..1); events also `startsAt`/`endsAt` ISO strings).
  - `type ExtractResult = { dumpId: string; created: Array<{ kind: "todo" | "event"; id: string; title: string; projectId: string | null; confidence: number | null; lowConfidence: boolean }> }`
  - `extractFromDump(db, model, text, opts?): Promise<ExtractResult>` — stores the dump, calls the model with the two tools (via the AI SDK `generateText` + `tools` + `maxSteps`), maps each tool call to a `todo`/`event` insert (resolving `project` name → projectId from `listProjects`; confidence < 0.5 → `lowConfidence: true`), logs an `activity` row per creation, all inside a transaction. The **model is injected** (tests pass a fake), so no network in tests.

- [ ] **Step 1: Failing test with a fake model**

Use the AI SDK test double (doc-verify `MockLanguageModelV2`/`MockLanguageModel` from `ai/test` at <https://ai-sdk.dev/docs/ai-sdk-core/testing>). The fake returns one `create_todo` tool call. Seed a "Work" project. Assert: a `todos` row created with the resolved projectId, an `activity` row logged, and `ExtractResult.created` has the item.

```ts
// server/ai/extract.test.ts  (shape — reconcile the mock with verified ai/test API)
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { createProject } from "../db/queries/projects";
import { extractFromDump } from "./extract";
// import { MockLanguageModelV2 } from "ai/test"; // verify exact name/version

beforeEach(async () => { await truncateAll(getTestDb()); });

test("extracts a todo, tags project, logs activity", async () => {
  const db = getTestDb();
  await createProject(db, { name: "Work", color: "#111", kind: "work" });
  const model = makeFakeModelEmittingTodo("email Sam", "Work", 0.9); // fake returns a create_todo call
  const res = await extractFromDump(db, model, "remember to email Sam about work");
  expect(res.created.length).toBe(1);
  expect(res.created[0]!.kind).toBe("todo");
  expect(res.created[0]!.projectId).not.toBeNull();
  const acts = await (await import("../db/queries/items")).listActivity(db);
  expect(acts.length).toBeGreaterThanOrEqual(1);
});
```

> The exact fake-model construction depends on the installed `ai` version's test utilities. Doc-verify and implement `makeFakeModelEmittingTodo` in the test using the SDK's mock (it returns a tool-call result). If the mock API is hard to pin, an acceptable alternative is to factor the tool-call→DB mapping into a pure `applyToolCalls(db, dumpId, calls, projects)` function and unit-test THAT directly with hand-built tool-call objects (no model at all), plus a thin `extractFromDump` that wires the model to it. Prefer whichever gives a reliable, network-free test; note the choice.

- [ ] **Step 2-4:** Run → fail; implement `tools.ts` (Zod schemas) + `extract.ts` (`applyToolCalls` pure mapper + `extractFromDump` wiring `generateText`); Run → pass. The system prompt instructs: extract concrete todos/events from the dump, assign each to the best-matching project from the provided list (or none), set realistic ISO times for events, and a 0..1 confidence. Use `generateText({ model, tools, maxSteps: 8, system, prompt: text })`.

- [ ] **Step 5:** Full `bun test`; commit `feat: AI dump extraction with create_todo/create_event tools + project tagging`.

---

## Task 3: Activity feed read + undo

**Files:** Create `server/db/queries/undo.ts` + test; `server/api/activity/index.get.ts`; `server/api/undo.post.ts`.

**Interfaces:**
- Produces `undoLastActivity(db): Promise<{ undone: boolean; action?: string }>` — reads the most recent **undoable** `activity` (action `create`), deletes the referenced entity (todo/event) by `entityId`, marks/removes the activity (insert a compensating `activity` row `action: "undo"`), in a transaction. `GET /api/activity` → recent activity; `POST /api/undo` → undo last.

- [ ] TDD `undoLastActivity` against the DB (create a todo + a `create` activity → undo → todo gone, an `undo` activity appended). Routes 401-gate via `getAuthSession`, use `getDb()`. Commit.

---

## Task 4: `POST /api/dump`

**Files:** Create `server/api/dump.post.ts`.

**Interfaces:** `POST /api/dump { text }` → 401-gated; `makeModel()` + `extractFromDump(getDb(), model, text)` → returns `ExtractResult`. Errors from the model surface as a 502 with a message (the dump is still stored so nothing is lost — store the dump before calling the model).

- [ ] Implement; manual/live smoke deferred to Task 6. Typecheck. Commit. (No unit test for the thin route beyond typecheck; `extractFromDump` is already tested.)

---

## Task 5: Minimal dump + activity UI

**Files:** Create `app/pages/dump.vue`, `app/components/ActivityFeed.vue`; a docked "Dump" affordance on `index.vue` linking to `/dump` (or a slide-over).

**Interfaces:** A monochrome dump screen: a large textarea + "Capture" button POSTing `/api/dump`; on success, shows the extracted items and an activity feed with an **Undo** button (POST `/api/undo`) and a subtle toast. Use Nuxt UI `UTextarea`/`UButton`/`UToast`. Data via `useFetch`/`$fetch` (not fetch+onMounted). Respect minimal B&W + a11y. Typecheck + full suite green. Commit.

---

## Task 6: Live smoke (DeepSeek)

> The DeepSeek key is in `.env`. This one CAN be run end-to-end without the user.

- [ ] Start `bun run dev`. `POST /api/dump` requires a session — for the smoke, either (a) call `extractFromDump` via a tiny `bun` script against the real `makeModel()` + test DB, or (b) temporarily exercise it through an authenticated session. Prefer (a): write a throwaway script `scripts/smoke-dump.ts` that seeds projects, calls `extractFromDump(getTestDb(), makeModel(), "Tomorrow 3pm dentist; email Sam about the Q3 deck; buy groceries")`, prints the created items, and asserts ≥1 todo and the dentist event got an `startsAt`. Run with `bun scripts/smoke-dump.ts`. Record output. Delete the script (or keep under `scripts/` if useful) — don't commit secrets.
- [ ] Confirm DeepSeek tool-calling actually produced todo(s)+event(s) with project tags. Note real-world quality (the spec accepts more "needs review" items on DeepSeek).

---

## Self-Review

- Extraction tool-calling + project tagging + auto-then-undo (spec §6) → Tasks 2-4. ✓
- Activity feed + undo (spec §5, §9) → Task 3. ✓
- Configurable provider, deepseek default, injectable model for tests (spec §3) → Task 1-2. ✓
- Minimal dump/chat UI (spec §7) → Task 5. ✓
- Live verification with the real provider → Task 6. ✓
- Chat *tools* beyond create_todo/create_event (web_search, search_memory/documents, read_calendar) are added in Plans E/C/D when those backends exist — noted, not built here.
- Placeholders: the AI-SDK mock + `generateText`/tool API are doc-verify points with a concrete pure-`applyToolCalls` fallback for reliable network-free tests. No vague steps.
- Types: `ExtractResult` (Task 2) consumed by the dump route (Task 4) + UI (Task 5); `getDb`/`getAuthSession`/Plan-1 queries reused throughout.
