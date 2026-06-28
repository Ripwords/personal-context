# Braindump Plan 2 — Auth & Two Google Accounts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the single owner sign in with Google, link a second Google account (personal + work), store per-account Calendar tokens, and ensure a dedicated "Braindump" Google calendar exists in a chosen account.

**Architecture:** Better Auth owns identity + OAuth connections, persisted through its Drizzle adapter into the same Neon/local Postgres. Each linked Google account is an `account` row holding `accessToken`/`refreshToken`/`scope`; an app-level `connection` side table adds `role` (`personal`|`work`) and `braindumpCalendarId`. A small `auth/` module exposes the Better Auth instance + a typed helper to read a connection's (refreshed) Calendar credentials. The live Google handshake and `googleapis` calendar-creation are isolated behind interfaces so the surrounding logic is unit-testable with mocks; the live flow is verified manually once real OAuth credentials exist.

**Tech Stack:** Better Auth, Drizzle ORM, Neon/local Postgres, Nuxt 4 (Nitro server routes), `googleapis`, Zod, Bun (`bun test`).

## Global Constraints

- Package manager + runner: **Bun** only (`bun install`, `bun test`, `bunx`). Never npm/npx/pnpm.
- TypeScript: never `any`; `as unknown as X` only when strictly necessary.
- TDD: failing test first, watch it fail, implement minimally, watch it pass, commit.
- Conventional Commits ending with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- DB driver: `makeDb` (Plan 1) already branches local `postgres-js` vs Neon `neon-http`. Reuse it; do not add a second client.
- Secrets only in env (`.env` local, Vercel env in prod). Never commit secrets. `.env` is gitignored.
- Single user — do NOT add per-row `userId` to domain tables (projects/dumps/todos/events). Auth tables are Better Auth's own.
- Google roles use exactly the strings `personal` and `work`.

## Carry-forward from Plan 1 final review (address here)

- **Transactions:** `neon-http` has no interactive `db.transaction()`. Where this plan needs atomic multi-row writes, use `db.batch([...])` (works on both drivers) and note it. (Account-linking writes here are single-row, so this mostly bites Plan 4 — but use `batch` if a multi-write appears.)
- **Migrations in CI:** Plan 1 applied schema via `psql`. This plan adds a `db:migrate` script and applies migrations with `drizzle-kit migrate` so the committed SQL is the artifact actually run.

---

## Prerequisites — Google Cloud setup (USER-PERFORMED, can run in parallel)

These produce the `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` that Task 5's live verification needs. Tasks 1–4 do **not** need them.

1. Go to <https://console.cloud.google.com/> → create a project (e.g. "Braindump").
2. **APIs & Services → Library →** enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen:** User type **External**; fill app name + your email; under **Test users** add BOTH your personal Gmail and your work Google address (keeps you out of unverified-app blocking while in "Testing").
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
     - (later, prod) `https://<your-vercel-domain>/api/auth/callback/google`
   - (Better Auth's Google callback path is `/api/auth/callback/google` by default — Task 2 confirms this against current docs; adjust the URI if it differs.)
5. Copy the **Client ID** and **Client secret** into `.env`:
   ```bash
   GOOGLE_CLIENT_ID="...apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="..."
   BETTER_AUTH_SECRET="<run: openssl rand -base64 32>"
   BETTER_AUTH_URL="http://localhost:3000"
   ```
6. Tell the implementer when these are in `.env` so Task 5's live verification can run.

> The OAuth scopes requested are configured in code (Task 2): `openid email profile`, plus `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.readonly`, with offline access so a refresh token is issued.

---

## Task 1: Better Auth instance + Drizzle adapter + auth schema

**Files:**
- Create: `server/auth/index.ts` (the Better Auth instance)
- Create/extend: `server/db/schema.ts` (append Better Auth tables — generated, then committed)
- Create: `drizzle/` migration for the auth tables
- Modify: `package.json` (add `db:migrate` script)
- Test: `server/auth/index.test.ts`

**Interfaces:**
- Produces: `auth` (the Better Auth server instance) from `server/auth/index.ts`; the `user`, `session`, `account`, `verification` Drizzle tables in `server/db/schema.ts`.

- [ ] **Step 1: Install Better Auth**

```bash
bun add better-auth
```

- [ ] **Step 2: Verify the current Better Auth API before writing config**

Better Auth's API moves; confirm these exact names/shapes against the official docs before implementing (WebFetch each):
- Instance factory and import path — expected `import { betterAuth } from "better-auth"`. Docs: <https://www.better-auth.com/docs/installation>
- Drizzle adapter — expected `import { drizzleAdapter } from "better-auth/adapters/drizzle"` with `drizzleAdapter(db, { provider: "pg", schema })`. Docs: <https://www.better-auth.com/docs/adapters/drizzle>
- Schema generation CLI — expected `bunx @better-auth/cli generate` (and whether it writes Drizzle schema or SQL). Docs: <https://www.better-auth.com/docs/concepts/cli>
- Google social provider + scopes + offline access + **account linking** config shape. Docs: <https://www.better-auth.com/docs/authentication/google> and <https://www.better-auth.com/docs/concepts/users-accounts#account-linking>

Record in your report any field/name that differs from the baseline code below, and use the verified names.

- [ ] **Step 3: Write the failing test**

```ts
// server/auth/index.test.ts
import { test, expect } from "bun:test";
import { auth } from "./index";

test("auth instance is constructed with a handler", () => {
  expect(auth).toBeDefined();
  // Better Auth exposes a request handler; confirm the property name in Step 2
  // (commonly `auth.handler`). Assert whatever the verified API names it.
  expect(typeof auth.handler).toBe("function");
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test server/auth/index.test.ts`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 5: Write the Better Auth instance (baseline — reconcile with Step 2)**

```ts
// server/auth/index.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { makeDb } from "../db/client";
import * as schema from "../db/schema";

const db = makeDb(process.env.NUXT_DATABASE_URL ?? "");

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
      ],
      accessType: "offline",
      prompt: "consent",
    },
  },
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
});
```

- [ ] **Step 5b: Add placeholder auth env vars to `.env`** (so construction + schema-gen work without real Google creds)

Append to `.env` (gitignored) if absent:
```bash
BETTER_AUTH_SECRET="dev-placeholder-secret-change-me"
BETTER_AUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```
(Real Google values arrive in the Prerequisites; empty strings are fine for Tasks 1–5.)

- [ ] **Step 6: Generate and commit the auth schema**

Run Better Auth's schema generator (verified name from Step 2, e.g. `bunx @better-auth/cli generate`) so the `user`/`session`/`account`/`verification` tables are added to `server/db/schema.ts` (or the file it targets — reconcile so all Drizzle tables live in `server/db/schema.ts`).

Then generate the Drizzle migration:

Run: `bun run db:generate`
Expected: a new `drizzle/000X_*.sql` adding the four auth tables.

- [ ] **Step 7: Add `db:migrate` script and apply migrations from a clean baseline**

Add to `package.json` scripts:
```json
"db:migrate": "drizzle-kit migrate"
```

⚠️ Plan 1's `0000` migration was applied to the local DB via `psql` with **no drizzle journal**, so `drizzle-kit migrate` would try to re-create existing tables and fail. The local test DB is **disposable** — reset its schema and migrate from scratch so the journal is correct:

```bash
docker exec braindump-test-pg psql -U postgres -d braindump_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
bun run db:migrate
```
Expected: both `0000` (Plan 1 tables) and the new auth migration apply cleanly; `account` table now exists; a `__drizzle_migrations` journal table is present.

- [ ] **Step 8: Run the test to verify it passes**

Run: `bun test server/auth/index.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/auth/index.ts server/auth/index.test.ts server/db/schema.ts drizzle/ package.json
git commit -m "feat: add Better Auth instance, Drizzle adapter, and auth schema

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Mount the auth handler on a Nitro route

**Files:**
- Create: `server/api/auth/[...all].ts`
- Test: `server/api/auth/auth-route.test.ts`

**Interfaces:**
- Consumes: `auth` (Task 1).
- Produces: the catch-all route `/api/auth/**` delegating to `auth.handler`.

- [ ] **Step 1: Write the failing test**

```ts
// server/api/auth/auth-route.test.ts
import { test, expect } from "bun:test";
import handler from "./[...all]";

test("auth catch-all route exports a handler", () => {
  expect(handler).toBeDefined();
  expect(typeof handler).toBe("function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/api/auth/auth-route.test.ts`
Expected: FAIL — cannot find module `./[...all]`.

- [ ] **Step 3: Write the route (baseline — reconcile handler name with Task 1 Step 2)**

```ts
// server/api/auth/[...all].ts
import { defineEventHandler, toWebRequest } from "h3";
import { auth } from "../../auth";

export default defineEventHandler((event) => {
  return auth.handler(toWebRequest(event));
});
```

Import `defineEventHandler`/`toWebRequest` **explicitly from `h3`** (not the Nitro auto-import) so the file is importable under plain `bun test` (no Nuxt runtime in tests). `h3` is already present via Nuxt. If Better Auth ships a Nuxt/h3 helper, prefer it and note the change. Confirm the handler property name matches what Task 1 verified.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/api/auth/auth-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/api/auth/
git commit -m "feat: mount Better Auth handler on /api/auth catch-all route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Google connection metadata (`role` + Braindump calendar id)

**Files:**
- Modify: `server/db/schema.ts` (add `googleConnections` table)
- Create: `drizzle/` migration
- Create: `server/auth/connections.ts`
- Test: `server/auth/connections.test.ts`

**Interfaces:**
- Consumes: `Db` (Plan 1), `account` table (Task 1).
- Produces (Drizzle table `googleConnections` + helpers):
  - `googleConnections` columns: `id uuid pk`, `accountId text` (FK → `account.id`), `role` enum `connection_role` (`personal`|`work`), `braindumpCalendarId text` (nullable), `createdAt timestamptz`.
  - `setConnectionRole(db: Db, accountId: string, role: "personal" | "work"): Promise<GoogleConnection>` — upsert by `accountId`.
  - `setBraindumpCalendarId(db: Db, accountId: string, calendarId: string): Promise<GoogleConnection>`
  - `listConnections(db: Db): Promise<GoogleConnection[]>`
  - Types `GoogleConnection`, `NewGoogleConnection`.

- [ ] **Step 1: Write the failing test**

```ts
// server/auth/connections.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { sql } from "drizzle-orm";
import { setConnectionRole, setBraindumpCalendarId, listConnections } from "./connections";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
  // seed a fake account row so the FK is satisfiable
  await db.execute(sql`INSERT INTO "account" (id, account_id, provider_id, user_id) VALUES ('acc1','g1','google','u1')`);
});

test("setConnectionRole upserts the role for an account", async () => {
  const c = await setConnectionRole(db, "acc1", "personal");
  expect(c.role).toBe("personal");
  const again = await setConnectionRole(db, "acc1", "work");
  expect(again.role).toBe("work");
  expect((await listConnections(db)).length).toBe(1); // upsert, not duplicate
});

test("setBraindumpCalendarId stores the calendar id", async () => {
  await setConnectionRole(db, "acc1", "personal");
  const c = await setBraindumpCalendarId(db, "acc1", "cal_123");
  expect(c.braindumpCalendarId).toBe("cal_123");
});
```

> The `INSERT INTO "account"` column names (`account_id`, `provider_id`, `user_id`) come from Better Auth's generated schema (Task 1). Reconcile the column names in this seed with the actual generated `account` table; adjust if they differ.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/auth/connections.test.ts`
Expected: FAIL — cannot find module `./connections`.

- [ ] **Step 3: Add the table to `server/db/schema.ts`**

```ts
// append to server/db/schema.ts
export const connectionRole = pgEnum("connection_role", ["personal", "work"]);

export const googleConnections = pgTable("google_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull().unique(), // FK to account.id added in migration
  role: connectionRole("role").notNull(),
  braindumpCalendarId: text("braindump_calendar_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GoogleConnection = typeof googleConnections.$inferSelect;
export type NewGoogleConnection = typeof googleConnections.$inferInsert;
```

- [ ] **Step 4: Generate + apply migration**

Run: `bun run db:generate && bun run db:migrate`
Expected: `google_connections` table + `connection_role` enum created.

- [ ] **Step 4b: Extend `truncateAll` to clear the auth + connection tables**

`truncateAll` (Plan 1) only clears the five domain tables, but these tests seed `account` rows in `beforeEach`. Update `server/db/test-helpers.ts` so isolation also clears the new tables (CASCADE handles FK order; `user` is a reserved word — quote it):

```ts
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE google_connections, activities, events, todos, dumps, projects, account, session, verification, "user" RESTART IDENTITY CASCADE`,
  );
}
```
(Use the exact Better Auth table names generated in Task 1 — adjust if generation pluralized or renamed them.) Re-run the full Plan 1 suite once after this change to confirm nothing regressed: `bun test` → still green.

- [ ] **Step 5: Write the helpers**

```ts
// server/auth/connections.ts
import { eq } from "drizzle-orm";
import { type Db } from "../db/client";
import { googleConnections, type GoogleConnection } from "../db/schema";

export async function setConnectionRole(
  db: Db,
  accountId: string,
  role: "personal" | "work",
): Promise<GoogleConnection> {
  const [row] = await db
    .insert(googleConnections)
    .values({ accountId, role })
    .onConflictDoUpdate({ target: googleConnections.accountId, set: { role } })
    .returning();
  return row!;
}

export async function setBraindumpCalendarId(
  db: Db,
  accountId: string,
  calendarId: string,
): Promise<GoogleConnection> {
  const [row] = await db
    .update(googleConnections)
    .set({ braindumpCalendarId: calendarId })
    .where(eq(googleConnections.accountId, accountId))
    .returning();
  return row!;
}

export async function listConnections(db: Db): Promise<GoogleConnection[]> {
  return db.select().from(googleConnections);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test server/auth/connections.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add server/db/schema.ts drizzle/ server/auth/connections.ts server/auth/connections.test.ts
git commit -m "feat: add google_connections metadata (role + braindump calendar id)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Calendar credentials helper (token read, refresh interface)

**Files:**
- Create: `server/auth/google-credentials.ts`
- Test: `server/auth/google-credentials.test.ts`

**Interfaces:**
- Consumes: `Db`, `account` table (Task 1), `googleConnections` (Task 3).
- Produces:
  - `type GoogleCreds = { accountId: string; role: "personal" | "work"; accessToken: string; refreshToken: string | null; braindumpCalendarId: string | null }`
  - `getGoogleConnections(db: Db): Promise<GoogleCreds[]>` — joins `account` (provider `google`) with `google_connections`, returning tokens + role + calendar id for each linked account.

- [ ] **Step 1: Write the failing test**

```ts
// server/auth/google-credentials.test.ts
import { test, expect, beforeEach } from "bun:test";
import { sql } from "drizzle-orm";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { setConnectionRole } from "./connections";
import { getGoogleConnections } from "./google-credentials";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
  await db.execute(sql`INSERT INTO "account" (id, account_id, provider_id, user_id, access_token, refresh_token)
    VALUES ('acc1','g1','google','u1','at_1','rt_1')`);
  await setConnectionRole(db, "acc1", "work");
});

test("getGoogleConnections returns tokens, role, and calendar id per google account", async () => {
  const conns = await getGoogleConnections(db);
  expect(conns.length).toBe(1);
  expect(conns[0]!.accessToken).toBe("at_1");
  expect(conns[0]!.refreshToken).toBe("rt_1");
  expect(conns[0]!.role).toBe("work");
  expect(conns[0]!.braindumpCalendarId).toBeNull();
});
```

> Reconcile `account` column names (`access_token`, `refresh_token`, `provider_id`) with Better Auth's generated schema from Task 1.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/auth/google-credentials.test.ts`
Expected: FAIL — cannot find module `./google-credentials`.

- [ ] **Step 3: Write the helper**

```ts
// server/auth/google-credentials.ts
import { eq } from "drizzle-orm";
import { type Db } from "../db/client";
import { account } from "../db/schema"; // Better Auth-generated table export
import { googleConnections } from "../db/schema";

export type GoogleCreds = {
  accountId: string;
  role: "personal" | "work";
  accessToken: string;
  refreshToken: string | null;
  braindumpCalendarId: string | null;
};

export async function getGoogleConnections(db: Db): Promise<GoogleCreds[]> {
  const rows = await db
    .select({
      accountId: account.id,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      role: googleConnections.role,
      braindumpCalendarId: googleConnections.braindumpCalendarId,
    })
    .from(account)
    .innerJoin(googleConnections, eq(googleConnections.accountId, account.id))
    .where(eq(account.providerId, "google"));

  return rows.map((r) => ({
    accountId: r.accountId,
    role: r.role,
    accessToken: r.accessToken ?? "",
    refreshToken: r.refreshToken ?? null,
    braindumpCalendarId: r.braindumpCalendarId ?? null,
  }));
}
```

> The `account` table export name and its column accessors (`account.accessToken`, `account.refreshToken`, `account.providerId`, `account.id`) come from Better Auth's generated schema. Use the exact exported names; adjust if generation produced different identifiers.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test server/auth/google-credentials.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth/google-credentials.ts server/auth/google-credentials.test.ts
git commit -m "feat: add helper to read per-account Google Calendar credentials

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Braindump-calendar provisioning (mocked logic + live verification)

**Files:**
- Create: `server/calendar-sync/braindump-calendar.ts`
- Test: `server/calendar-sync/braindump-calendar.test.ts`

**Interfaces:**
- Consumes: `GoogleCreds` (Task 4), `setBraindumpCalendarId` (Task 3).
- Produces:
  - `type CalendarApi = { insert(input: { summary: string }): Promise<{ id: string }> }` (the minimal slice of the Google Calendar client used here — keeps `googleapis` behind an injectable interface).
  - `ensureBraindumpCalendar(db: Db, conn: GoogleCreds, api: CalendarApi): Promise<string>` — if `conn.braindumpCalendarId` is set, return it; else create a calendar named "Braindump" via `api.insert`, persist the id via `setBraindumpCalendarId`, and return it. Idempotent.

- [ ] **Step 1: Write the failing test**

```ts
// server/calendar-sync/braindump-calendar.test.ts
import { test, expect, beforeEach } from "bun:test";
import { sql } from "drizzle-orm";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { setConnectionRole } from "../auth/connections";
import { getGoogleConnections } from "../auth/google-credentials";
import { ensureBraindumpCalendar } from "./braindump-calendar";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
  await db.execute(sql`INSERT INTO "account" (id, account_id, provider_id, user_id, access_token, refresh_token)
    VALUES ('acc1','g1','google','u1','at_1','rt_1')`);
  await setConnectionRole(db, "acc1", "personal");
});

test("creates the calendar once, then reuses the stored id", async () => {
  let inserts = 0;
  const api = { insert: async ({ summary }: { summary: string }) => { inserts++; return { id: "cal_new" }; } };

  const [conn] = await getGoogleConnections(db);
  const id1 = await ensureBraindumpCalendar(db, conn!, api);
  expect(id1).toBe("cal_new");
  expect(inserts).toBe(1);

  const [conn2] = await getGoogleConnections(db); // now has braindumpCalendarId
  const id2 = await ensureBraindumpCalendar(db, conn2!, api);
  expect(id2).toBe("cal_new");
  expect(inserts).toBe(1); // not created again
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/calendar-sync/braindump-calendar.test.ts`
Expected: FAIL — cannot find module `./braindump-calendar`.

- [ ] **Step 3: Write the provisioning logic**

```ts
// server/calendar-sync/braindump-calendar.ts
import { type Db } from "../db/client";
import { setBraindumpCalendarId } from "../auth/connections";
import { type GoogleCreds } from "../auth/google-credentials";

export type CalendarApi = {
  insert(input: { summary: string }): Promise<{ id: string }>;
};

export async function ensureBraindumpCalendar(
  db: Db,
  conn: GoogleCreds,
  api: CalendarApi,
): Promise<string> {
  if (conn.braindumpCalendarId) return conn.braindumpCalendarId;
  const created = await api.insert({ summary: "Braindump" });
  await setBraindumpCalendarId(db, conn.accountId, created.id);
  return created.id;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test server/calendar-sync/braindump-calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/calendar-sync/braindump-calendar.ts server/calendar-sync/braindump-calendar.test.ts
git commit -m "feat: idempotent Braindump calendar provisioning (injectable api)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Live verification (USER-PERFORMED, needs Google credentials)

> Gated on the Prerequisites being in `.env`. No code; this confirms the wired flow end-to-end. Capture results in the report.

- [ ] **Step 1:** With `.env` populated (Prerequisites step 5), start the app: `bun run dev`.
- [ ] **Step 2:** Visit `http://localhost:3000` and trigger Google sign-in (Better Auth client `signIn.social({ provider: "google" })` from a temporary button or the `/api/auth` sign-in URL). Approve the consent screen with your **personal** account. Confirm an `account` row exists with non-null `access_token` and `refresh_token`:
  ```bash
  docker exec braindump-test-pg psql -U postgres -d braindump_test -c "SELECT provider_id, user_id, (access_token IS NOT NULL) AS has_at, (refresh_token IS NOT NULL) AS has_rt FROM \"account\";"
  ```
  Expected: `has_rt = t` (offline access issued a refresh token).
- [ ] **Step 3:** Trigger account linking for the **work** account (Better Auth `linkSocial({ provider: "google" })` while signed in). Confirm a second `google` `account` row appears for the same `user_id`.
- [ ] **Step 4:** Set roles: mark one connection `personal`, the other `work` (call `setConnectionRole` via a temporary script or admin route).
- [ ] **Step 5:** Provision the Braindump calendar against the chosen account using `ensureBraindumpCalendar` with a real `googleapis` calendar client (`calendar.calendars.insert({ requestBody: { summary: "Braindump" } })` adapted to the `CalendarApi` interface). Confirm the "Braindump" calendar appears in that Google account and `google_connections.braindump_calendar_id` is populated.
- [ ] **Step 6:** Record outcomes (token presence, both accounts linked, roles set, calendar created) in the report. No commit unless a temporary script is kept (prefer not to commit throwaway scripts).

---

## Self-Review

**Spec coverage (Plan 2 slice of spec §3, §8):**
- Google sign-in + offline refresh tokens → Task 1 (scopes/accessType) + Task 6 verification. ✓
- Two separate Google accounts via account-linking → Task 1 (`accountLinking`) + Task 6. ✓
- Per-account Calendar token storage → Better Auth `account` table (Task 1) + read helper (Task 4). ✓
- `role` personal/work → Task 3. ✓
- Dedicated "Braindump" calendar creation + stored id → Tasks 3 + 5 + 6. ✓
- Click-by-click Google OAuth setup (spec §8) → Prerequisites section. ✓
- Migrations actually applied (Plan 1 carry-forward) → `db:migrate` in Tasks 1/3. ✓

**Placeholder scan:** No TBD/TODO. The Better Auth API points are explicit verification steps with named symbols + doc URLs and a committed baseline — bounded, not vague. Tasks 4/3 flag the exact `account` column names to reconcile with generated output (named, specific). ✓

**Type consistency:** `GoogleCreds` (Task 4) consumed by Task 5; `GoogleConnection` (Task 3) returned by the connection helpers used in Tasks 4–5; `Db` from Plan 1 throughout; `role` is the `"personal" | "work"` union everywhere. ✓

**Known risk:** Better Auth's generated `account`/table identifiers and the handler property name are the main reconciliation points (Task 1 Step 2). Every dependent task names exactly what to adjust if generation differs.
