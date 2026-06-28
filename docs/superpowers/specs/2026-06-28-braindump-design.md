# Braindump — Design Spec

**Date:** 2026-06-28
**Status:** Approved (pre-implementation)
**Owner:** JJ (single user)

## 1. Problem & Goal

A chaos-friendly personal productivity app for someone who struggles with todo
lists and dislikes fixed schedules. The user wants to **dump everything freely**
throughout the day and have AI turn that mess into a simplified todo list and a
proposed schedule, synced to their Google calendars. A Notion-style calendar
shows events, scheduled todos, and unscheduled "things to do" in one place.

**Success criteria:**
- Dumping a paragraph of mixed thoughts produces correctly-typed, project-tagged
  todos/events with no manual structuring.
- Nothing the AI does is irreversible — every auto action is visible and undoable.
- The calendar shows both Google accounts + todos, color-coded by project.
- End-of-day produces a clean, deduped todo list and a tomorrow schedule.

## 2. Scope

### In (MVP)
- AI **brain-dump chat** for free-form capture.
- **Live extraction**: each dump auto-creates todos/events (undoable) via AI
  tool-calling, each auto-tagged to a project.
- **Smart project tagging**: classify items into projects (Work, Part-time,
  Freelance, Hackathon, Personal — editable). Low-confidence tags flagged for
  one-tap correction.
- **End-of-day wind-down**: dedupe/group the day into a simplified todo list +
  proposed schedule for tomorrow.
- **Notion-style calendar**: week (default) / day / month, color-coded by
  project, scheduled todos as time blocks, **unscheduled side rail** with
  drag-to-schedule.
- **Two Google accounts** (personal + work) via OAuth, two-way sync; read events
  from both, write AI events to a dedicated "Braindump" Google calendar.
- **Activity feed + undo**.
- **Analytics dashboard** — a simple usage-stats view (e.g. dumps/day, todos
  created vs. completed, completion rate, scheduled vs. unscheduled ratio,
  per-project breakdown, time-of-day capture patterns, streaks). Computed from
  existing tables (`dump`, `todo`, `event`, `activity`); read-only.

### Out (explicitly deferred — YAGNI)
- Multi-user / sharing / auth beyond the single owner.
- Native mobile app (responsive web only).
- Recurring-task engine.
- Push notifications / reminders.
- AI auto-rescheduling of existing items.

## 3. Stack

- **Frontend/SSR:** Nuxt 4, Nuxt UI v4 (chat + UI components), Tailwind.
- **Hosting:** **Fully self-hosted via Docker Compose** (no Vercel, no Neon) —
  modeled on `~/Documents/ai-trader`: a `postgres:16-alpine` service (named
  volume + healthcheck), a one-shot `drizzle-migrate` migrator service, and the
  Nuxt app service (Nitro prod bundle) gated on
  `drizzle-migrate: service_completed_successfully`. Multi-stage Dockerfile
  (`deps → build → migrate → run`) using `oven/bun` images.
- **Auth:** Better Auth (Google social provider + account linking for the 2nd
  Google account).
- **DB:** **Self-hosted Postgres** via Drizzle ORM using the
  **`drizzle-orm/node-postgres`** driver (`pg.Pool`) — same connection path for
  local and production (no Neon HTTP driver). Migrations applied by a
  **programmatic migrator** (`drizzle-orm/node-postgres/migrator`), run as the
  compose `drizzle-migrate` service (`drizzle-kit migrate` hangs in non-TTY).
  Connection via `DATABASE_URL` (composed from `POSTGRES_USER/PASSWORD/DB` in
  compose). **node-postgres supports interactive `db.transaction()`** — so the
  Plan-1/Plan-2 carry-forward about neon-http lacking transactions is resolved;
  AI multi-entity writes (Plan "AI extraction") use real transactions.
- **AI:** Vercel AI SDK with a **configurable provider** (single config point in
  `ai/`). Default `deepseek-chat` (`@ai-sdk/deepseek`) for cost; swappable to
  Anthropic `claude-sonnet-4-6` / `claude-opus-4-8` per-task or globally via env.
  Live extraction is high-volume and cost-sensitive; the model is the one knob to
  turn if extraction/classification quality disappoints (more "needs review"
  items / mis-tags). `deepseek-reasoner` is avoided for live extraction (weak
  tool-calling + latency); only a tool-calling-capable chat model is used for
  extraction.
- **Google:** `googleapis` for Calendar read/write per linked account.
- **Package manager / test runner:** Bun (`bun install`, `bun test`).

> Note: this overrides the Bun-server defaults in the repo `CLAUDE.md`
> (`Bun.serve`, no Vite) — Nuxt is the explicit user choice. Bun remains the
> package manager / test runner.

## 4. Architecture

```
Nuxt 4 (Vercel) ── Nuxt UI v4 chat + calendar
   │  server routes (/server/api/**, Nitro)
   ├── auth/          Better Auth: identity + linked Google accounts (tokens per account)
   ├── ai/            Vercel AI SDK + Anthropic; extraction + summary (pure over dump → tool calls)
   ├── projects/      tagging + keyword-biased classifier
   ├── calendar-sync/ Google <-> DB mapping (isolated; AI never calls Google directly)
   └── db/            Drizzle schema + queries (Neon Postgres)
```

**Module boundaries** — each has one purpose, a typed interface, and is testable
in isolation:
- `ai/`: input = dump text + project context; output = validated tool calls.
  Depends on the Anthropic provider only; no DB or Google access.
- `projects/`: classify an item to a project given name/keywords; returns
  `{ projectId, confidence }`.
- `calendar-sync/`: translate DB events ↔ Google events for a given account;
  no AI dependency.
- `db/`: schema + query helpers; no business logic.
- `auth/`: session + linked-account token retrieval/refresh.

The AI module producing a write goes: `ai/` → validated payload → `db/` insert →
(for events) `calendar-sync/` push. The AI never touches Google or the DB
directly, keeping the destructive boundary in one place.

## 5. Data Model (Drizzle / Postgres)

- **`user`** — Better Auth user (the single owner).
- **`account`** — Better Auth linked accounts. Each Google connection stores
  `accessToken`, `refreshToken`, `scope`, `accountId`, and an app-level
  `role` (`personal` | `work`) + which is the "Braindump calendar" host.
- **`project`** — `id`, `name`, `color` (token), `kind` enum
  (`work|part_time|freelance|hackathon|personal|other`), `keywords text[]`
  (bias the classifier), `isDefault`.
- **`dump`** — `id`, `text`, `createdAt`. Raw source of truth, never mutated.
- **`todo`** — `id`, `title`, `notes`, `projectId`, `status`
  (`open|done|dropped`), `scheduledStart?`, `scheduledEnd?` (nullable → shows in
  unscheduled rail when null), `dumpId?`, `source` (`ai|manual`), `confidence?`.
- **`event`** — `id`, `title`, `start`, `end`, `projectId`, `googleEventId?`,
  `googleAccountId?`, `dumpId?`, `syncStatus` (`local|synced|error`).
- **`activity`** — `id`, `action`, `entityType`, `entityId`, `payload jsonb`
  (undo data), `createdAt`. Powers the feed and undo.

## 6. AI Engine

### Live extraction
On each dump submit:
1. Send dump text + project list (names + keywords) to Anthropic with
   **strict-schema tools**: `create_todo`, `create_event`. Each tool input
   includes a `project` field and the model's `confidence`.
2. Stream tool calls into the Nuxt UI chat so items appear as they're extracted.
3. Validate each tool call against the Zod/JSON schema. Valid → insert (auto).
   Invalid or low-confidence project → item enters the activity feed as
   **"needs review"**; nothing is written blindly.
4. Events: insert locally, then `calendar-sync/` writes to the dedicated
   "Braindump" Google calendar (auto, undoable).

### End-of-day wind-down
`summarize_day` runs over the day's `dump`s + open `todo`s and returns:
- a grouped, deduped simplified todo list, and
- suggested time blocks for tomorrow.
The user approves blocks into the calendar (approval applies the schedule and
syncs). Adaptive thinking enabled for this call.

### Model & provider
- **Configurable provider**, one config point in `ai/`. Default `deepseek-chat`
  (cheapest for high-volume live extraction); env-swappable to Anthropic
  `claude-sonnet-4-6` / `claude-opus-4-8` per-task or globally.
- Extraction requires a tool-calling-capable chat model (so `deepseek-reasoner`
  is excluded from the extraction path).
- Called through the Vercel AI SDK so Nuxt UI chat components bind directly
  regardless of provider.
- Tradeoff accepted: DeepSeek's structured tool-calling/classification quality is
  generally below Claude, so expect more items in the "needs review" lane — the
  review/undo flow absorbs this. Flip the env to Claude if it gets noisy.

## 7. UI / Visual Direction

**Minimal, monochrome, low-chrome** — the owner is already managing chaos, so the
interface must feel calm and quiet, not decorated. Black-and-white / grayscale
base; near-zero ornament. (This supersedes the earlier warm-paper/teal direction.)

- **App shell (three panes):** left project filter rail · center calendar (week
  default; day/month toggle) · right unscheduled-todo rail. A docked **dump
  button** opens the chat as a slide-over. Thin hairline dividers, generous
  whitespace, no heavy cards/shadows/gradients.
- **Palette:** grayscale — near-black ink (`#111`) on near-white (`#fafafa`) in
  light, inverted in dark; borders/dividers in low-contrast gray. **At most one
  restrained accent**, used sparingly (focus ring, primary action).
- **Project distinction without color-coding:** since the palette is monochrome,
  projects are distinguished primarily by a **text label/initial** and **tonal
  layering** (grayscale shade + a thin left-border tick), not by hue. The `color`
  token still exists on `project`, but the UI renders it as a single muted accent
  tick at most — never the dominant signal. (If the owner later wants more color,
  it's a one-token change.)
- **Type:** one clean sans (e.g. Inter/Geist) at a tight, consistent scale;
  weight (not color) carries hierarchy. Tabular figures for any stats/times.
- **Motion & a11y:** subtle, fast (150–300ms), no flourish; drag-to-schedule with
  minimal feedback; `prefers-reduced-motion` respected; undo via toast;
  focus-visible rings; contrast ≥ 4.5:1; responsive at 375 / 768 / 1024 / 1440.
- **Analytics dashboard** follows the same minimal language: small multiples /
  sparkline-style charts, grayscale, labels over legends, lots of whitespace.

## 8. Google OAuth Setup (two accounts)

The implementation plan / README will include click-by-click steps:
1. Create a Google Cloud project.
2. Enable the **Google Calendar API**.
3. Configure the **OAuth consent screen** (External; add your own Google
   addresses as **test users** so unverified-app limits don't block you).
4. Create an **OAuth client (Web application)** with authorized redirect URIs for
   both `http://localhost:3000/...` and the Vercel production URL.
5. Request scopes `https://www.googleapis.com/auth/calendar.events` and
   `.../auth/calendar.readonly`; request `access_type=offline` +
   `prompt=consent` to obtain refresh tokens.
6. Put client ID/secret in env (`.env` locally; Vercel project env in prod).
7. Wire Better Auth Google provider for the first (personal) login, then an
   **"Add work account"** flow that links the second Google account
   (account-linking, storing a second `account` row with its own tokens) —
   **not** a second app login.
8. On first connect, create the dedicated **"Braindump"** Google calendar in the
   chosen account and store its calendar ID.

## 9. Error Handling

- **Token refresh failure** → persistent "reconnect <account>" banner; sync
  paused for that account; never fails silently.
- **AI tool-call validation failure** → item to activity feed as "needs review";
  no DB/Google write.
- **Low-confidence project tag** → item written but flagged for one-tap
  correction.
- **Google write/sync error** → `event.syncStatus = error`, surfaced in feed
  with retry; local copy retained.
- **Sync conflict** (edited in both places) → last-write-wins on the Braindump
  side, logged to `activity`.

## 10. Testing (TDD)

Tests written before implementation (`bun test`):
- `ai/` extraction: given dump text + projects, asserts on mocked Anthropic tool
  calls (correct types, fields, project tagging).
- `projects/` classifier: keyword/name → project + confidence behavior.
- `calendar-sync/` mapping: DB event ↔ Google event round-trip; refresh-failure
  path.
- `db/` queries: scheduled vs unscheduled todo filtering, activity/undo.
- Component tests for drag-to-schedule and the unscheduled rail.

## 11. Build Sequence (high level)

1. Project scaffold (Nuxt 4 + Nuxt UI v4 + Tailwind + Drizzle + Neon + Better
   Auth), env wiring.
2. Data model + migrations + seed default projects.
3. Auth + two-account Google linking + "Braindump" calendar creation.
4. `calendar-sync/` read (both accounts → calendar view).
5. AI live extraction (chat → tool calls → todos/events) + activity feed + undo.
6. Project tagging + correction UI.
7. Calendar UI (week/day/month, project colors, unscheduled rail,
   drag-to-schedule) + write-back sync.
8. End-of-day wind-down summary + approve-to-schedule.
9. Visual polish pass against the UI direction + a11y checklist.
