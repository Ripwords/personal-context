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

  // node-postgres supports interactive transactions — wrap the upserts so a
  // sync either fully lands or rolls back.
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .insert(events)
        .values(row)
        .onConflictDoUpdate({
          target: [events.googleAccountId, events.googleEventId],
          set: { title: row.title, startsAt: row.startsAt, endsAt: row.endsAt, syncStatus: "synced" },
        });
    }
  });
  return rows.length;
}
```

> Uses `db.transaction()` (available on `drizzle-orm/node-postgres`). No `any`, no casts. The composite-unique upsert target `(googleAccountId, googleEventId)` requires the unique index from Step 1.

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

## Phase 2 — UI shell + live data

**Decisions (made for the overnight build):**
- **Google Calendar access uses plain `fetch`** against the Calendar v3 REST API
  (`https://www.googleapis.com/calendar/v3/...`) with a `Bearer` token — no
  `googleapis` dependency (lighter, trivially testable behind the `EventsApi`/
  `CalendarApi` interfaces already defined).
- **Token refresh** posts the stored `refresh_token` to Google's token endpoint
  (`https://oauth2.googleapis.com/token`) with `client_id`/`client_secret` — a
  concrete `TokenRefresher`. (If Better Auth exposes `auth.api.getAccessToken`,
  that's an acceptable alternative; the direct endpoint is dependency-free and
  certain to work.)
- **Calendar UI is a custom lightweight week grid** (Tailwind), not a heavyweight
  calendar component — fits the minimal monochrome direction and avoids depending
  on a Nuxt UI calendar that may not exist in v4. Nuxt UI is used for buttons/
  inputs/toasts/layout primitives only.
- **UI verification** is typecheck + a live dev-server smoke (route returns JSON;
  page renders 200), plus TDD on extracted pure date/layout helpers. (DOM unit
  tests aren't run under `bun test`.)

### Task 4: Live TokenRefresher + EventsApi (fetch) + `/api/calendar/events`

**Files:**
- Create: `server/calendar-sync/google-rest.ts` (fetch-based `TokenRefresher` + `EventsApi`)
- Create: `server/calendar-sync/google-rest.test.ts`
- Create: `server/api/calendar/events.get.ts`
- Create: `server/utils/session.ts` (resolve the Better Auth session in a Nitro handler)

**Interfaces:**
- Consumes: `getGoogleConnections` (Plan 2), `getFreshAccessToken`/`TokenRefresher` (P3 Task 1), `syncConnectionEvents`/`EventsApi` (P3 Task 2), `getCalendarFeed` (P3 Task 3), `auth` (Plan 2).
- Produces:
  - `makeGoogleTokenRefresher(clientId: string, clientSecret: string, fetchImpl?: typeof fetch): TokenRefresher`
  - `makeGoogleEventsApi(fetchImpl?: typeof fetch): EventsApi`
  - `GET /api/calendar/events?from=ISO&to=ISO` → `CalendarFeed` JSON (401 if no session).

- [ ] **Step 1: Failing test for the fetch-based refresher + events api (injected fake `fetch`)**

```ts
// server/calendar-sync/google-rest.test.ts
import { test, expect } from "bun:test";
import { makeGoogleTokenRefresher, makeGoogleEventsApi } from "./google-rest";

test("token refresher posts refresh_token and returns access token", async () => {
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=rt_1");
    return new Response(JSON.stringify({ access_token: "at_new", expires_in: 3600 }), { status: 200 });
  }) as unknown as typeof fetch;
  const refresh = makeGoogleTokenRefresher("cid", "secret", fakeFetch);
  const res = await refresh("rt_1");
  expect(res.accessToken).toBe("at_new");
  expect(res.expiresAt).toBeGreaterThan(0);
});

test("events api lists and returns raw items array", async () => {
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    expect(String(url)).toContain("/calendars/primary/events");
    expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer at_x");
    return new Response(JSON.stringify({ items: [{ id: "g1", summary: "X", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T10:00:00Z" } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const api = makeGoogleEventsApi(fakeFetch);
  const items = await api.list({ accessToken: "at_x", calendarId: "primary", timeMin: "2026-07-01T00:00:00Z", timeMax: "2026-07-02T00:00:00Z" });
  expect(items.length).toBe(1);
  expect(items[0]!.id).toBe("g1");
});
```

- [ ] **Step 2: Run → fail.** `bun test server/calendar-sync/google-rest.test.ts` → cannot find module.

- [ ] **Step 3: Implement `google-rest.ts`**

```ts
// server/calendar-sync/google-rest.ts
import type { TokenRefresher } from "./access-token";
import type { EventsApi, RawGoogleEvent } from "./sync-events";

export function makeGoogleTokenRefresher(
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = fetch,
): TokenRefresher {
  return async (refreshToken: string) => {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    return { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  };
}

export function makeGoogleEventsApi(fetchImpl: typeof fetch = fetch): EventsApi {
  return {
    async list({ accessToken, calendarId, timeMin, timeMax }) {
      const params = new URLSearchParams({
        timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250",
      });
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error(`calendar list failed: ${res.status}`);
      const json = (await res.json()) as { items?: RawGoogleEvent[] };
      return json.items ?? [];
    },
  };
}
```

- [ ] **Step 4: Run → pass.** `bun test server/calendar-sync/google-rest.test.ts` → 2 pass.

- [ ] **Step 5: Session helper** (doc-verify Better Auth's server session call against <https://www.better-auth.com/docs/concepts/session-management>; the shape below is the common one):

```ts
// server/utils/session.ts
import type { H3Event } from "h3";
import { getHeaders } from "h3";
import { auth } from "../auth";

export async function getSession(event: H3Event) {
  // Better Auth resolves a session from request headers. Confirm method name in docs.
  return auth.api.getSession({ headers: new Headers(getHeaders(event) as Record<string, string>) });
}
```

- [ ] **Step 6: The route** `server/api/calendar/events.get.ts`

```ts
import { defineEventHandler, getQuery, createError } from "h3";
import { makeDb } from "../../db/client";
import { parseEnv } from "../../utils/env";
import { getSession } from "../../utils/session";
import { getGoogleConnections } from "../../auth/google-credentials";
import { getFreshAccessToken } from "../../calendar-sync/access-token";
import { syncConnectionEvents } from "../../calendar-sync/sync-events";
import { makeGoogleTokenRefresher, makeGoogleEventsApi } from "../../calendar-sync/google-rest";
import { getCalendarFeed } from "../../db/queries/calendar-feed";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const q = getQuery(event);
  const from = new Date(String(q.from));
  const to = new Date(String(q.to));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw createError({ statusCode: 400, statusMessage: "invalid from/to" });
  }

  const db = makeDb(parseEnv(process.env).databaseUrl);
  const refresh = makeGoogleTokenRefresher(
    process.env.GOOGLE_CLIENT_ID ?? "",
    process.env.GOOGLE_CLIENT_SECRET ?? "",
  );
  const api = makeGoogleEventsApi();

  for (const conn of await getGoogleConnections(db)) {
    try {
      const accessToken = await getFreshAccessToken(conn, Date.now(), refresh);
      await syncConnectionEvents(db, conn, accessToken, api, from, to);
    } catch (err) {
      // One bad account shouldn't blank the whole calendar; log and continue.
      console.error(`sync failed for account ${conn.accountId}:`, err);
    }
  }
  return getCalendarFeed(db, from, to);
});
```

- [ ] **Step 7: Typecheck + full suite.** `bunx nuxi typecheck` → 0; `bun test` → all pass (32). Commit:

```bash
git add server/calendar-sync/google-rest.ts server/calendar-sync/google-rest.test.ts server/api/calendar/events.get.ts server/utils/session.ts
git commit -m "feat: google REST token refresh + events api + /api/calendar/events route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5: Auth UI (sign in + link work account + role) — Better Auth Vue client

**Files:**
- Create: `app/lib/auth-client.ts`
- Create: `app/pages/login.vue`
- Create: `app/pages/connections.vue`
- Create: `server/api/connections/role.post.ts` (wraps `setConnectionRole`)
- Create: `server/api/connections/index.get.ts` (lists connections for the UI)

**Interfaces:** Produces a Better Auth Vue client (`authClient` with `signIn.social`, `linkSocial`, `useSession`), a login page, a connections page (link work account + set personal/work role), and the two routes.

- [ ] **Step 1: Doc-verify + create the auth client.** Confirm `better-auth/vue` `createAuthClient` API at <https://www.better-auth.com/docs/integrations/nuxt> and <https://www.better-auth.com/docs/concepts/client>. Baseline:

```ts
// app/lib/auth-client.ts
import { createAuthClient } from "better-auth/vue";
export const authClient = createAuthClient();
export const { signIn, signOut, useSession } = authClient;
```

- [ ] **Step 2: `login.vue`** — minimal B&W; a single "Continue with Google" button calling `authClient.signIn.social({ provider: "google", callbackURL: "/" })`. Use a Nuxt UI `UButton`. Monochrome styling per spec §7.

```vue
<script setup lang="ts">
import { authClient } from "~/lib/auth-client";
async function signin() {
  await authClient.signIn.social({ provider: "google", callbackURL: "/" });
}
</script>
<template>
  <main class="min-h-dvh flex flex-col items-center justify-center gap-6 bg-neutral-50 text-neutral-900">
    <h1 class="text-3xl font-semibold tracking-tight">Braindump</h1>
    <p class="text-neutral-500 text-sm">Dump everything. Wake up to a plan.</p>
    <UButton color="neutral" size="lg" @click="signin">Continue with Google</UButton>
  </main>
</template>
```

- [ ] **Step 3: `connections.vue`** — lists linked Google accounts, a "Add work account" button calling `authClient.linkSocial({ provider: "google", callbackURL: "/connections" })` (doc-verify `linkSocial`), and a personal/work toggle per account that POSTs `/api/connections/role`. Minimal B&W list, hairline dividers.

- [ ] **Step 4: routes**

```ts
// server/api/connections/index.get.ts
import { defineEventHandler, createError } from "h3";
import { makeDb } from "../../db/client";
import { parseEnv } from "../../utils/env";
import { getSession } from "../../utils/session";
import { getGoogleConnections } from "../../auth/google-credentials";

export default defineEventHandler(async (event) => {
  if (!(await getSession(event))) throw createError({ statusCode: 401 });
  const db = makeDb(parseEnv(process.env).databaseUrl);
  return (await getGoogleConnections(db)).map((c) => ({
    accountId: c.accountId, role: c.role, braindumpCalendarId: c.braindumpCalendarId,
  }));
});
```

```ts
// server/api/connections/role.post.ts
import { defineEventHandler, readBody, createError } from "h3";
import { makeDb } from "../../db/client";
import { parseEnv } from "../../utils/env";
import { getSession } from "../../utils/session";
import { setConnectionRole } from "../../auth/connections";

export default defineEventHandler(async (event) => {
  if (!(await getSession(event))) throw createError({ statusCode: 401 });
  const body = await readBody<{ accountId: string; role: "personal" | "work" }>(event);
  if (!body?.accountId || (body.role !== "personal" && body.role !== "work")) {
    throw createError({ statusCode: 400, statusMessage: "accountId + role required" });
  }
  const db = makeDb(parseEnv(process.env).databaseUrl);
  return setConnectionRole(db, body.accountId, body.role);
});
```

- [ ] **Step 5: Typecheck + commit.** `bunx nuxi typecheck` → 0. (Routes have logic but live-session-dependent; verified at Task 7 live smoke.) Commit the auth UI.

### Task 6: Three-pane minimal calendar shell

**Files:**
- Create: `app/composables/useWeek.ts` (pure date helpers — TDD)
- Create: `app/composables/useWeek.test.ts`
- Create: `app/pages/index.vue` (three-pane shell)
- Create: `app/components/CalendarWeek.vue`, `app/components/UnscheduledRail.vue`, `app/components/ProjectRail.vue`

**Interfaces:** Produces pure helpers `startOfWeek(d)`, `weekDays(d)` (7 Dates), `addDays(d,n)`; and the calendar page consuming `/api/calendar/events`.

- [ ] **Step 1: TDD the pure date helpers** (`useWeek.test.ts` → fail → implement → pass):

```ts
// app/composables/useWeek.test.ts
import { test, expect } from "bun:test";
import { startOfWeek, weekDays, addDays } from "./useWeek";
test("startOfWeek returns Monday 00:00 for a mid-week date", () => {
  const wed = new Date("2026-07-01T15:00:00Z"); // Wed
  const mon = startOfWeek(wed);
  expect(mon.getUTCDay()).toBe(1); // Monday
});
test("weekDays returns 7 consecutive days", () => {
  const days = weekDays(new Date("2026-07-01T00:00:00Z"));
  expect(days.length).toBe(7);
  expect(addDays(days[0]!, 6).getUTCDate()).toBe(days[6]!.getUTCDate());
});
```

Implement `useWeek.ts` with `addDays`, `startOfWeek` (Monday-based), `weekDays`. Keep pure (no Vue) so `bun test` covers them.

- [ ] **Step 2: Build the shell** `app/pages/index.vue` — three panes (left `ProjectRail`, center `CalendarWeek`, right `UnscheduledRail`), a header with week nav (‹ Today ›) and day/week/month toggle (week default; day/month can be simple stubs that still render). Fetch `/api/calendar/events?from&to` with TanStack Query (`@tanstack/vue-query`) per the user's CLAUDE.md (no `fetch`+`useEffect`/`onMounted`); if not installed, `bun add @tanstack/vue-query` and register the plugin. Minimal monochrome: `bg-neutral-50`, `text-neutral-900`, hairline `border-neutral-200` dividers, generous whitespace, no shadows. Projects shown as text labels + a thin left-border tick using the project color token.

- [ ] **Step 3: `CalendarWeek.vue`** — a 7-column grid (Mon–Sun) with hour rows; render events + scheduled todos as blocks positioned by start/end; grayscale, project label + left-tick. `UnscheduledRail.vue` — a vertical list of unscheduled todos (drag wiring is Plan 6). `ProjectRail.vue` — project filter list (checkboxes/toggles).

- [ ] **Step 4: Typecheck + full suite.** `bunx nuxi typecheck` → 0; `bun test` → all pass (date helpers included). Commit the shell.

### Task 7: Live end-to-end smoke (interactive — needs the user's Google login)

> The one step that needs the human. Do as much programmatically as possible; document the rest for the user.

- [ ] **Step 1:** `bun run dev`. Confirm `/login` renders (200) and `/api/calendar/events?from=...&to=...` returns **401** when logged out (proves the auth gate). Record both.
- [ ] **Step 2 (USER):** open `/login`, sign in with the personal Google account; then `/connections`, "Add work account" (sign in with the work account); set one `personal`, one `work`. Verify two `account` rows + two `google_connections` rows via psql.
- [ ] **Step 3 (USER/auto):** with a session cookie, GET `/api/calendar/events?from&to` → 200 with real events from both calendars; confirm `events` rows were upserted. Provision the Braindump calendar via `ensureBraindumpCalendar` + a real `CalendarApi` (fetch `POST /calendar/v3/calendars`).
- [ ] **Step 4:** confirm the week view renders the real events. Record results in the report.

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
