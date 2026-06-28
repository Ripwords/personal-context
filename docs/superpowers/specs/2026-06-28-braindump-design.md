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

### Out (explicitly deferred — YAGNI)
- Multi-user / sharing / auth beyond the single owner.
- Native mobile app (responsive web only).
- Recurring-task engine.
- Push notifications / reminders.
- AI auto-rescheduling of existing items.

## 3. Stack

- **Frontend/SSR:** Nuxt 4, Nuxt UI v4 (chat + UI components), Tailwind.
- **Hosting:** Vercel (Nitro server routes for the API).
- **Auth:** Better Auth (Google social provider + account linking for the 2nd
  Google account).
- **DB:** Neon Postgres via Drizzle ORM.
- **AI:** Vercel AI SDK + Anthropic provider. Model `claude-sonnet-4-6` (default),
  overridable to `claude-opus-4-8`. Adaptive thinking on for end-of-day summary,
  off for fast live extraction.
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
- `claude-sonnet-4-6` default (cost/quality balance for frequent extraction);
  `claude-opus-4-8` override available.
- Called through the Vercel AI SDK Anthropic provider so Nuxt UI chat components
  bind directly.

## 7. UI / Visual Direction

Derived from `/ui-ux-pro-max` (calm teal focus + warm background,
micro-interactions, full light/dark), **adapted** away from the default
spa/serif single-column output (wrong for a data-dense calendar):

- **App shell (three panes):** left project filter rail · center calendar (week
  default; day/month toggle) · right unscheduled-todo rail. A docked **dump
  button** opens the chat as a slide-over.
- **Palette:** warm paper background, calm ink foreground, teal app primary;
  **each project carries its own accent** via Nuxt UI color tokens so the
  calendar reads at a glance. Destructive red reserved for real deletes — no
  ambient urgency.
- **Type:** clean sans for dense UI (Inter/Geist); one characterful display face
  for headers + the dump screen. (Not Lora body — too wellness-heavy for data.)
- **Motion & a11y:** drag-to-schedule with spring motion; 150–300ms transitions;
  skeleton loaders; `prefers-reduced-motion` respected; undo via toast;
  focus-visible rings; contrast ≥ 4.5:1; responsive at 375 / 768 / 1024 / 1440.

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
