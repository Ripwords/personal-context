# Braindump Plan 8 — Polish & Cohesion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Make the app cohesive and testable: an auth redirect flow, a sign-out control, a comprehensive README, the `DbOrTx` type cleanup, and a final full boot/verification.

## Global Constraints
- Bun only; never `any`. Conventional Commits + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Minimal monochrome. Don't regress the 122 passing tests.

---

## Task 1: Auth redirect flow + sign-out

**Files:** `app/middleware/auth.global.ts`; `server/api/auth-status.get.ts` (lightweight session check for middleware); small header edit on `index.vue` (sign-out button).

- [ ] **Global route middleware**: on navigation, if there is no session, redirect to `/login` (allow `/login` itself and `/api/**`). Determine auth state with a lightweight check that works in Nuxt middleware (SSR+client): e.g. a `GET /api/auth-status` returning `{ authenticated: boolean }` (uses `getAuthSession`), called via `$fetch` with the request headers forwarded on SSR (`useRequestFetch()`); or the Better Auth Vue client's `getSession`. Doc-verify the Better Auth session-in-middleware pattern. When authenticated and on `/login`, redirect to `/`.
- [ ] **Sign out**: a small "Sign out" control in the `index.vue` header calling the Better Auth client `signOut()` then redirecting to `/login`.
- [ ] Verify: `bunx nuxi typecheck` → 0; full `bun test` → 122 pass. Live: dev server up → `GET /` while logged out returns a redirect to `/login` (curl `-i` shows 302 or the login HTML); `/login` renders 200. Commit `feat: auth redirect middleware + sign-out`.

---

## Task 2: README

**Files:** `README.md`.

- [ ] Replace the bun-init stub README with a real guide:
  - **What it is** (one paragraph) + the feature list (calendar, AI dump→todos/events, wind-down, analytics, memory, documents/RAG, chat with tools + web search).
  - **Prerequisites**: Bun; Docker (for Postgres); a Google Cloud OAuth client; optionally DeepSeek/Anthropic + a web-search key.
  - **Env**: the full `.env` var list (`DATABASE_URL`, `TEST_DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID/SECRET`, `LLM_PROVIDER`, `DEEPSEEK_API_KEY`/`ANTHROPIC_API_KEY`, optional `TAVILY_API_KEY`/`BRAVE_API_KEY`/`SEARXNG_URL`) — point to `.env.example`.
  - **Local dev**: start Postgres (the `docker run postgres:16` one-liner on a chosen port), set `.env`, `bun install`, `bun run db:migrate`, `bun run dev`; then the Google OAuth setup steps (from the Plan 2 prerequisites) and how to sign in + link the work account + set roles.
  - **Self-hosted (Docker Compose)**: `cp .env.example .env`, fill secrets, `docker compose up -d --build` (postgres + drizzle-migrate runs migrations + app on `APP_PORT`).
  - **Tests**: `bun test` (needs `TEST_DATABASE_URL`); the dev smoke scripts (`bun scripts/smoke-dump.ts`, `smoke-winddown.ts`, `smoke-memory.ts`, `smoke-rag.ts`, `smoke-chat.ts`).
  - **Architecture** (brief): Nuxt 4 + Nitro, Better Auth, node-postgres + Drizzle, Vercel AI SDK (DeepSeek default), FTS for memory/RAG.
  - **Known follow-ups / upgrade paths**: pgvector+Ollama semantic recall; rustfs S3 storage; drag-to-schedule + Google write-back; project-tagging correction UI; local timezone for displayed times; web-search needs a key/SearXNG. (Pull the live list from `.superpowers/sdd/progress.md` carry-forwards.)
- [ ] Commit `docs: comprehensive README (run, deploy, test, architecture)`.

---

## Task 3: `DbOrTx` type cleanup

**Files:** `server/db/client.ts` (export a `DbOrTx` type), and the query helpers that receive a transaction (`logActivity`, `createTodo`, `createEvent`, and the extract.ts shared helpers) — widen their `db` param to `DbOrTx` and remove the `tx as Db` casts in `applyToolCalls`/`applyWindDownSchedule`.

- [ ] Define `export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0]` (the drizzle transaction type) in `client.ts`. Change the affected helpers' signatures from `db: Db` to `db: DbOrTx`. Remove the `tx as Db` casts at the call sites (pass `tx` directly). Never `any`.
- [ ] Verify: `bunx nuxi typecheck` → 0; full `bun test` → 122 pass. Commit `refactor: DbOrTx type removes tx-as-Db casts`.

---

## Task 4: Final verification (boot smoke)

- [ ] Start the dev server; curl each page (`/login` 200; `/`, `/dump`, `/wind-down`, `/analytics`, `/memories`, `/documents`, `/chat` either 200 or redirect-to-login when logged out) and each API unauthenticated → 401. Confirm `bun test` (122) + `bunx nuxi typecheck` (0). Record results. No commit unless a fix was needed.

---

## Self-Review
- Coherent auth flow (unauth → login; sign-out) → Task 1.
- The user can run + test it (README) → Task 2.
- Type purity (no `tx as Db`) per CLAUDE.md → Task 3.
- Whole-app boot verified → Task 4.
