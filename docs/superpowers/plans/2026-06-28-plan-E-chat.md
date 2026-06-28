# Braindump Plan E — Conversational Chat with Tools + Web Search

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A conversational AI chat that can act — create todos/events, search the user's memories and documents (RAG), search the web, and read the calendar — with relevant memories recalled into context.

**Decision (overnight reliability):** Web search is **provider-configurable** (Tavily if `TAVILY_API_KEY`, Brave if `BRAVE_API_KEY`, else a graceful "web search isn't configured" result). No key is set today, so web_search returns the not-configured message live; the plumbing + tool work the moment a key is added (or a self-hosted SearXNG URL via `SEARXNG_URL`). The other five tools are fully live (DeepSeek + local data).

**Architecture:** `server/ai/chat-tools.ts` defines AI SDK v7 tools whose `execute` calls existing backends (`applyToolCalls`-style create, `searchMemories`, `searchDocuments`, `getCalendarFeed`, `webSearch`). `/api/chat` runs `streamText({ model, tools, system, messages })` with a system prompt that includes recalled memories (FTS over the latest user message) and the current datetime; it streams back. A chat page renders the conversation.

**Tech Stack:** AI SDK v7 (`streamText`, `tool`), Vue AI SDK / Nuxt UI chat, Drizzle, Bun.

## Global Constraints
- Bun only; never `any`. TDD the tool handlers + webSearch (network-free with injected fetch/model). Conventional Commits + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Reuse: `getDb`, `getAuthSession`, `makeModel`, `applyToolCalls`/extraction helpers, `searchMemories`, `searchDocuments`, `getCalendarFeed`, `listProjects`. Minimal monochrome UI.

---

## Task 1: `webSearch` provider (configurable)

**Files:** `server/ai/web-search.ts` + test.

**Interfaces:**
- `type WebResult = { title: string; url: string; snippet: string }`
- `makeWebSearch(env?, fetchImpl?): (query: string) => Promise<{ configured: boolean; results: WebResult[]; note?: string }>` — if `TAVILY_API_KEY` set → POST Tavily; else if `BRAVE_API_KEY` → GET Brave; else if `SEARXNG_URL` → GET that SearXNG JSON; else `{ configured: false, results: [], note: "Web search is not configured." }`. Normalize each provider's response to `WebResult[]`. Never `any`.

- [ ] TDD with an injected fake `fetch` + env: Tavily path parses results; Brave path parses results; no-key path returns `configured:false` + note. Implement. Full suite green; typecheck 0. Commit `feat: configurable web search provider`.

---

## Task 2: chat tools

**Files:** `server/ai/chat-tools.ts` + test.

**Interfaces:**
- `makeChatTools(db, model, env?): ToolSet` — AI SDK v7 `tool({ description, inputSchema, execute })` for:
  - `create_todo` / `create_event` — execute inserts (reuse the Plan 4 mapping; resolve project by name; log activity) and returns a confirmation. (Factor the shared insert logic so chat + dump use one path.)
  - `search_memory` — `searchMemories(db, query)` → returns the memory contents.
  - `search_documents` — `searchDocuments(db, query)` → returns chunk snippets + filenames.
  - `web_search` — `makeWebSearch(env)(query)` → returns results or the not-configured note.
  - `read_calendar` — `getCalendarFeed(db, from, to)` for a parsed range → returns events + todos.
- Each `execute` is pure-ish over `db` and returns JSON-serializable data; never `any`.

- [ ] TDD the tool `execute` handlers directly (call them with args, assert DB effect / returned data) — network-free (web_search uses the no-key path or an injected fake). Implement. Full suite green; typecheck 0. Commit `feat: chat tool set (todo/event/memory/docs/web/calendar)`.

---

## Task 3: `/api/chat` streaming endpoint

**Files:** `server/api/chat.post.ts`.

- [ ] 401-gate. Read `{ messages }` (UI message array). Recall: take the latest user message text, `searchMemories(getDb(), text, 5)`, and inject the contents into the system prompt ("Relevant things you remember about the user: ..."). System prompt also includes the current datetime + the project list + tool guidance ("use create_todo/create_event to capture tasks; search_memory/search_documents before answering from memory; web_search for current info"). `streamText({ model: makeModel(), system, messages, tools: makeChatTools(getDb(), makeModel()), stopWhen: stepCountIs(8) })`; return the AI SDK streaming response (doc-verify v7: `result.toUIMessageStreamResponse()` or `toDataStreamResponse()` — use what the installed `ai` + the Vue `useChat` expect). Typecheck 0; full suite green (no new unit test — tools already tested; covered live in Task 5). Commit.

---

## Task 4: chat UI

**Files:** `app/pages/chat.vue`; link from `index.vue`; (the dump screen stays as quick-capture).

- [ ] A conversational page. Prefer the Vercel AI SDK Vue `useChat` (`@ai-sdk/vue`) pointed at `/api/chat`, OR Nuxt UI v4 chat components if they integrate cleanly (doc-verify both: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat and Nuxt UI chat). Render the message list (user/assistant), a textarea + send, streaming tokens, and surface tool activity subtly (e.g. "created todo: …"). Minimal monochrome B&W, a11y. `bun add @ai-sdk/vue` if needed. Typecheck 0; full suite green. Commit.

---

## Task 5: live smoke (DeepSeek)
- [ ] `scripts/smoke-chat.ts`: build `makeChatTools(db, makeModel())`; run a `generateText({ model, tools, stopWhen: stepCountIs(6), prompt: "Add a todo to email Sam about the deck, and what do you remember about my meeting preferences?" })` after seeding a memory ("Hates meetings after 4pm") + projects; assert a todo row was created by the tool and the memory was surfaced. Run `bun scripts/smoke-chat.ts`; record. (This exercises the tool-calling loop end-to-end without the UI.)

---

## Self-Review
- Conversational chat that acts via tools (spec §6 chat tools) → Tasks 2-3. ✓
- RAG + memory in chat (search_documents/search_memory tools + memory recall into context) → Tasks 2-3. ✓
- Web search (configurable; live once a key/SearXNG is set) → Task 1-2. ✓
- read_calendar / create_todo / create_event tools → Task 2. ✓
- Minimal chat UI → Task 4. ✓ Live tool-loop verified → Task 5. ✓
- Shared create path between dump + chat (DRY) → Task 2 factoring.
