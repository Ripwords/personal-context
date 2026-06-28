# Braindump Plan 3 — Calendar Read & UI Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read events from both linked Google accounts into the DB and expose one aggregated feed (events + scheduled todos + unscheduled todos) for the calendar UI; then render the Notion-style three-pane shell.

**Architecture:** A `calendar-sync/` module fetches events per connection through a refresh-aware token helper (Google access tokens expire ~1h — always refresh via Better Auth before calling Google), normalizes them, and upserts into the `events` table keyed by `(googleAccountId, googleEventId)`. A read API aggregates a date range into one payload the UI consumes. `googleapis` stays behind a small injectable interface so all sync logic is unit-tested with fakes; the live fetch is verified once against real accounts. The UI (Phase 2) is a three-pane Nuxt UI shell expanded after the live login.

**Tech Stack:** Better Auth (token refresh), `googleapis`, Drizzle, Neon/local Postgres, Nuxt 4 (Nitro routes + Nuxt UI v4), Zod, Bun (`bun test`).

## Global Constraints

- Bun only (`bun install`, `bun test`, `bunx`). Never npm/npx/pnpm.
- TypeScript: never `any`; `as unknown as X` only when strictly necessary.
- TDD: failing test first → fail → minimal impl → pass → commit.
- Conventional Commits ending with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Reuse the Plan 1 `makeDb`/`Db`, `getTestDb`/`truncateAll`; reuse Plan 2 `getGoogleConnections`/`GoogleCreds`. Do not duplicate clients.
- **Never call the Google API with `GoogleCreds.accessToken` raw** (carry-forward from Plan 2): refresh first via Better Auth using the stored refresh token.
- `neon-http` has no interactive `db.transaction()`; for multi-row atomic writes use `db.batch([...])`.
- Event identity: an external Google event maps to one `events` row via `(google_account_id, google_event_id)`.

## Carry-forward addressed here
- Token refresh before Google calls (Plan 2 review item) → Task 1.

---

## Task 1: Refresh-aware Google access token

**Files:**
- Create: `server/calendar-sync/access-token.ts`
- Test: `server/calendar-sync/access-token.test.ts`

**Interfaces:**
- Consumes: `GoogleCreds` (Plan 2 `server/auth/google-credentials.ts`).
- Produces:
  - `type TokenRefresher = (refreshToken: string) => Promise<{ accessToken: string; expiresAt: number }>` — injectable boundary over the OAuth refresh call.
  - `getFreshAccessToken(conn: GoogleCreds, now: number, refresh: TokenRefresher): Promise<string>` — returns `conn.accessToken` if `conn` carries a still-valid token (caller passes expiry via a wrapper; for this unit, treat a `null`/missing refreshToken as an error and always refresh when asked). Concretely: if `conn.refreshToken` is null → throw `Error("no refresh token for account <id>")`; else call `refresh(conn.refreshToken)` and return its `accessToken`.

> Rationale: Better Auth stores the refresh token; the live wrapper (Task 6) will implement `TokenRefresher` via Better Auth's `auth.api.getAccessToken` (or a direct Google token endpoint POST) — verified against docs at that point. Keeping `refresh` injectable makes this unit fully testable now.

- [ ] **Step 1: Write the failing test**

```ts
// server/calendar-sync/access-token.test.ts
import { test, expect } from "bun:test";
import { getFreshAccessToken } from "./access-token";
import type { GoogleCreds } from "../auth/google-credentials";

const base: GoogleCreds = {
  accountId: "acc1", role: "personal", accessToken: "stale",
  refreshToken: "rt_1", braindumpCalendarId: null,
};

test("refreshes and returns a new access token", async () => {
  const fresh = await getFreshAccessToken(base, 1000, async (rt) => {
    expect(rt).toBe("rt_1");
    return { accessToken: "new_at", expiresAt: 5000 };
  });
  expect(fresh).toBe("new_at");
});

test("throws when there is no refresh token", async () => {
  const noRt = { ...base, refreshToken: null };
  await expect(
    getFreshAccessToken(noRt, 1000, async () => ({ accessToken: "x", expiresAt: 1 })),
  ).rejects.toThrow(/no refresh token/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/calendar-sync/access-token.test.ts`
Expected: FAIL — cannot find module `./access-token`.

- [ ] **Step 3: Write the implementation**

```ts
// server/calendar-sync/access-token.ts
import type { GoogleCreds } from "../auth/google-credentials";

export type TokenRefresher = (
  refreshToken: string,
) => Promise<{ accessToken: string; expiresAt: number }>;

export async function getFreshAccessToken(
  conn: GoogleCreds,
  now: number,
  refresh: TokenRefresher,
): Promise<string> {
  if (!conn.refreshToken) {
    throw new Error(`no refresh token for account ${conn.accountId}`);
  }
  const { accessToken } = await refresh(conn.refreshToken);
  return accessToken;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/calendar-sync/access-token.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/calendar-sync/access-token.ts server/calendar-sync/access-token.test.ts
git commit -m "feat: add refresh-aware Google access token helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fetch + normalize + upsert Google events

**Files:**
- Create: `server/calendar-sync/sync-events.ts`
- Test: `server/calendar-sync/sync-events.test.ts`

**Interfaces:**
- Consumes: `Db` (Plan 1), `events` table + `NewEventRow` (Plan 1), `GoogleCreds` (Plan 2).
- Produces:
  - `type RawGoogleEvent = { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }`
  - `type EventsApi = { list(input: { accessToken: string; calendarId: string; timeMin: string; timeMax: string }): Promise<RawGoogleEvent[]> }` (injectable `googleapis` boundary).
  - `normalizeEvent(raw: RawGoogleEvent, googleAccountId: string): NewEventRow | null` — maps a raw event to a row (`title` from `summary` ?? "(no title)"; `startsAt`/`endsAt` from `dateTime` or all-day `date`; `googleEventId`/`googleAccountId` set; `syncStatus: "synced"`). Returns `null` if it has no usable start/end (skip).
  - `syncConnectionEvents(db: Db, conn: GoogleCreds, accessToken: string, api: EventsApi, from: Date, to: Date): Promise<number>` — lists events for `conn` (calendar `"primary"`), normalizes, upserts into `events` keyed by `(googleAccountId, googleEventId)`, returns the count upserted.

- [ ] **Step 1: Add a unique index for upsert identity (schema + migration)**

In `server/db/schema.ts`, add a unique constraint on `(googleAccountId, googleEventId)` to `events` (needed for `onConflictDoUpdate`). Append to the `events` table definition a composite unique index:

```ts
// add this import if missing:
import { uniqueIndex } from "drizzle-orm/pg-core";

// change the events pgTable call to add the second (table) argument:
export const events = pgTable("events", {
  // ...existing columns unchanged...
}, (t) => ({
  googleIdentity: uniqueIndex("events_google_identity").on(t.googleAccountId, t.googleEventId),
}));
```

Generate + apply (disposable test DB):
```bash
bun run db:generate
docker exec braindump-test-pg psql -U postgres -d braindump_test -c "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"
bun run db:migrate
```
Expected: a migration adds `events_google_identity` unique index; clean apply.

> Note: rows with `googleEventId = NULL` (locally-created events, Plan 6) don't collide — Postgres treats NULLs as distinct in unique indexes. Good.

- [ ] **Step 2: Write the failing test**

```ts
// server/calendar-sync/sync-events.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { normalizeEvent, syncConnectionEvents, type EventsApi } from "./sync-events";
import type { GoogleCreds } from "../auth/google-credentials";

const db = getTestDb();
const conn: GoogleCreds = {
  accountId: "acc1", role: "work", accessToken: "at", refreshToken: "rt", braindumpCalendarId: null,
};

beforeEach(async () => { await truncateAll(db); });

test("normalizeEvent maps a timed event", () => {
  const row = normalizeEvent(
    { id: "g1", summary: "Standup", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T09:15:00Z" } },
    "acc1",
  );
  expect(row).not.toBeNull();
  expect(row!.title).toBe("Standup");
  expect(row!.googleEventId).toBe("g1");
  expect(row!.googleAccountId).toBe("acc1");
  expect(row!.syncStatus).toBe("synced");
});

test("normalizeEvent skips events with no start/end", () => {
  expect(normalizeEvent({ id: "g2" }, "acc1")).toBeNull();
});

test("syncConnectionEvents upserts and is idempotent on (account,event) identity", async () => {
  const events = [
    { id: "g1", summary: "Standup", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T09:15:00Z" } },
  ];
  const api: EventsApi = { list: async () => events };
  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-02T00:00:00Z");

  const n1 = await syncConnectionEvents(db, conn, "at", api, from, to);
  expect(n1).toBe(1);
  const n2 = await syncConnectionEvents(db, conn, "at", api, from, to); // same event again
  expect(n2).toBe(1);

  const rows = await db.query.events.findMany();
  expect(rows.length).toBe(1); // upsert, not duplicate
  expect(rows[0]!.title).toBe("Standup");
});
```

> If `db.query.events.findMany()` isn't available (relational query API not configured), use `db.select().from(events)` from `../db/schema` instead — adjust the import and assertion accordingly.

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test server/calendar-sync/sync-events.test.ts`
Expected: FAIL — cannot find module `./sync-events`.

- [ ] **Step 4: Write the implementation**

```ts
// server/calendar-sync/sync-events.ts
import { type Db } from "../db/client";
import { events, type NewEventRow } from "../db/schema";
import type { GoogleCreds } from "../auth/google-credentials";

export type RawGoogleEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export type EventsApi = {
  list(input: {
    accessToken: string;
    calendarId: string;
    timeMin: string;
    timeMax: string;
  }): Promise<RawGoogleEvent[]>;
};

function pickTime(slot?: { dateTime?: string; date?: string }): Date | null {
  if (!slot) return null;
  const iso = slot.dateTime ?? slot.date;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normalizeEvent(
  raw: RawGoogleEvent,
  googleAccountId: string,
): NewEventRow | null {
  const startsAt = pickTime(raw.start);
  const endsAt = pickTime(raw.end);
  if (!startsAt || !endsAt) return null;
  return {
    title: raw.summary ?? "(no title)",
    startsAt,
    endsAt,
    googleEventId: raw.id,
    googleAccountId,
    syncStatus: "synced",
  };
}

export async function syncConnectionEvents(
  db: Db,
  conn: GoogleCreds,
  accessToken: string,
  api: EventsApi,
  from: Date,
  to: Date,
): Promise<number> {
  const raw = await api.list({
    accessToken,
    calendarId: "primary",
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
  });
  const rows = raw
    .map((e) => normalizeEvent(e, conn.accountId))
    .filter((r): r is NewEventRow => r !== null);
  if (rows.length === 0) return 0;

  await db.batch(
    rows.map((row) =>
      db
        .insert(events)
        .values(row)
        .onConflictDoUpdate({
          target: [events.googleAccountId, events.googleEventId],
          set: { title: row.title, startsAt: row.startsAt, endsAt: row.endsAt, syncStatus: "synced" },
        }),
    ) as unknown as Parameters<typeof db.batch>[0],
  );
  return rows.length;
}
```

> The `db.batch(...)` array typing across the `neon-http | postgres-js` union can be awkward; if the `as unknown as` cast is needed to satisfy the union, keep it minimal and comment it. If `db.batch` is unavailable on the local `postgres-js` driver in your version, fall back to a sequential `for (const row of rows) await db.insert(...).onConflictDoUpdate(...)` loop (single-row writes are safe without a transaction) and note it.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test server/calendar-sync/sync-events.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/db/schema.ts drizzle/ server/calendar-sync/sync-events.ts server/calendar-sync/sync-events.test.ts
git commit -m "feat: fetch, normalize, and upsert Google events by (account,event) identity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Aggregated calendar feed query

**Files:**
- Create: `server/db/queries/calendar-feed.ts`
- Test: `server/db/queries/calendar-feed.test.ts`

**Interfaces:**
- Consumes: `Db`, `listEventsInRange` + `listScheduledTodosInRange` + `listUnscheduledTodos` (Plan 1 `server/db/queries/items.ts`).
- Produces:
  - `type CalendarFeed = { events: EventRow[]; scheduledTodos: Todo[]; unscheduledTodos: Todo[] }`
  - `getCalendarFeed(db: Db, from: Date, to: Date): Promise<CalendarFeed>` — returns events + scheduled todos in `[from,to)` plus all open unscheduled todos (for the side rail).

- [ ] **Step 1: Write the failing test**

```ts
// server/db/queries/calendar-feed.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createTodo, createEvent } from "./items";
import { getCalendarFeed } from "./calendar-feed";

const db = getTestDb();
beforeEach(async () => { await truncateAll(db); });

test("aggregates events, scheduled todos in range, and unscheduled todos", async () => {
  await createEvent(db, { title: "ev", startsAt: new Date("2026-07-01T09:00:00Z"), endsAt: new Date("2026-07-01T10:00:00Z") });
  await createTodo(db, { title: "sched", scheduledStart: new Date("2026-07-01T11:00:00Z"), scheduledEnd: new Date("2026-07-01T12:00:00Z") });
  await createTodo(db, { title: "unsched" });
  await createEvent(db, { title: "next-week", startsAt: new Date("2026-07-09T09:00:00Z"), endsAt: new Date("2026-07-09T10:00:00Z") });

  const feed = await getCalendarFeed(db, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-02T00:00:00Z"));
  expect(feed.events.map((e) => e.title)).toEqual(["ev"]);
  expect(feed.scheduledTodos.map((t) => t.title)).toEqual(["sched"]);
  expect(feed.unscheduledTodos.map((t) => t.title)).toEqual(["unsched"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/db/queries/calendar-feed.test.ts`
Expected: FAIL — cannot find module `./calendar-feed`.

- [ ] **Step 3: Write the implementation**

```ts
// server/db/queries/calendar-feed.ts
import { type Db } from "../client";
import { type EventRow, type Todo } from "../schema";
import { listEventsInRange, listScheduledTodosInRange, listUnscheduledTodos } from "./items";

export type CalendarFeed = {
  events: EventRow[];
  scheduledTodos: Todo[];
  unscheduledTodos: Todo[];
};

export async function getCalendarFeed(db: Db, from: Date, to: Date): Promise<CalendarFeed> {
  const [events, scheduledTodos, unscheduledTodos] = await Promise.all([
    listEventsInRange(db, from, to),
    listScheduledTodosInRange(db, from, to),
    listUnscheduledTodos(db),
  ]);
  return { events, scheduledTodos, unscheduledTodos };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/db/queries/calendar-feed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/db/queries/calendar-feed.ts server/db/queries/calendar-feed.test.ts
git commit -m "feat: aggregate calendar feed (events + scheduled + unscheduled todos)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — UI shell + live data (expand after the interactive Google login)

These are outlined; each will be written to full TDD/bite-sized detail once the live session exists (the UI is far better verified against real data, and the live login is the natural seam). Doc-verification for Nuxt UI v4 + Better Auth Vue client happens in those tasks.

- **Task 4 — Live token refresher + sync wrapper + `/api/calendar/events`:** implement `TokenRefresher` via Better Auth (`auth.api.getAccessToken`) or the Google token endpoint (doc-verify); a `googleapis`-backed `EventsApi`; a `GET /api/calendar/events?from&to` route that, for each `getGoogleConnections` entry, refreshes the token, `syncConnectionEvents`, then returns `getCalendarFeed`. Manual verification with both real accounts.
- **Task 5 — Sign-in / link-account UI:** a minimal page using the Better Auth Vue client (`signIn.social`, `linkSocial`) for "Sign in with Google" + "Add work account", plus a role picker that calls a route wrapping `setConnectionRole`. Doc-verify the Better Auth Vue/Nuxt client.
- **Task 6 — Three-pane calendar shell:** Nuxt UI v4 layout — left project filter rail, center calendar (week default; day/month toggle), right unscheduled-todo rail; events color-coded by project; consumes `/api/calendar/events`. Doc-verify Nuxt UI v4 calendar/components; respect the visual direction (warm paper, teal primary, per-project accents) + a11y (contrast, focus, reduced-motion).
- **Task 7 — Live end-to-end verification:** sign in (personal) → link (work) → set roles → create Braindump calendar (Plan 2 `ensureBraindumpCalendar` with the real `googleapis` client) → confirm real events from both accounts render color-coded in the week view.

---

## Self-Review (Phase 1)

**Spec coverage (read side of spec §3, §4 calendar-sync, §5):**
- Read events from both Google accounts → Task 2 `syncConnectionEvents` (per-connection; the route in Task 4 loops both). ✓
- Refresh tokens before Google calls (Plan 2 carry-forward) → Task 1. ✓
- Event identity / no duplicates on re-sync → Task 2 unique index + upsert. ✓
- Unified feed (events + scheduled todos + unscheduled rail) → Task 3. ✓
- UI shell, color-coding, views → Phase 2 (Tasks 4–7), outlined. 

**Placeholder scan:** Phase 1 tasks contain complete code + tests. The `db.batch` cast / fallback and the `db.query` vs `db.select` note are explicit, bounded alternatives, not vague placeholders. Phase 2 is intentionally an outline (expanded at execution), consistent with the roadmap's "expand at execution time" model. ✓

**Type consistency:** `GoogleCreds` (Plan 2) consumed by Tasks 1–2; `NewEventRow`/`EventRow`/`Todo` (Plan 1) used consistently; `EventsApi`/`TokenRefresher` are the injectable boundaries reused by the Task 4 live wrapper. ✓
