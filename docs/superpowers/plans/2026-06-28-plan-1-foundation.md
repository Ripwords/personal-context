# Braindump Plan 1 — Foundation & Data Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Nuxt 4 + Bun project and a fully-tested Postgres data layer (schema, migrations, seeded projects, query helpers) that later plans build on.

**Architecture:** A Nuxt 4 app (Nitro server routes) with a `db/` module owning a Drizzle schema over Neon Postgres. Domain tables (`project`, `dump`, `todo`, `event`, `activity`) and typed query helpers are unit-tested against a real test Postgres. Auth tables and `userId` ownership are deliberately deferred to Plan 2 (single-user MVP), so these tables carry no `userId` yet.

**Tech Stack:** Nuxt 4, Nuxt UI v4, Tailwind (via Nuxt UI), Drizzle ORM, `@neondatabase/serverless` (neon-http driver), Zod, Bun (package manager + `bun test`), drizzle-kit.

## Global Constraints

- Package manager + test runner: **Bun** (`bun install`, `bun test`, `bunx`). Never `npm`/`npx`/`pnpm`.
- TypeScript: never use `any`; prefer correct types; `as unknown as X` only when strictly necessary.
- Conventional Commits (`feat:`, `chore:`, `test:`, `docs:`…). End commit messages with the Co-Authored-By trailer used in this repo.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Default projects (seed): **Work, Part-time, Freelance, Hackathon, Personal**.
- SQL: avoid reserved words as column names — event time columns are `starts_at` / `ends_at` (not `start`/`end`).
- Timestamps are `timestamptz` (`{ withTimezone: true }`).

---

### Task 1: Project scaffold (Nuxt 4 + Bun + Nuxt UI + folder structure)

**Files:**
- Modify: `package.json`
- Create: `nuxt.config.ts`
- Create: `app/app.vue`
- Create: `app/assets/css/main.css`
- Create: `tsconfig.json` (Nuxt-managed; ensure `.nuxt/tsconfig` extended)
- Delete: `index.ts` (the bun-init stub)
- Create: `.env.example`

**Interfaces:**
- Produces: a booting Nuxt app and an installed dependency set used by all later tasks. No code exports.

- [ ] **Step 1: Remove the bun-init stub**

```bash
rm -f index.ts
```

- [ ] **Step 2: Install runtime + dev dependencies**

```bash
bun add nuxt @nuxt/ui
bun add drizzle-orm @neondatabase/serverless zod
bun add -d drizzle-kit @types/bun vue-tsc
```

- [ ] **Step 3: Write `nuxt.config.ts`**

```ts
export default defineNuxtConfig({
  modules: ["@nuxt/ui"],
  css: ["~/assets/css/main.css"],
  future: { compatibilityVersion: 4 },
  runtimeConfig: {
    databaseUrl: "", // set via NUXT_DATABASE_URL
  },
  devtools: { enabled: true },
});
```

- [ ] **Step 4: Write `app/assets/css/main.css`**

```css
@import "tailwindcss";
@import "@nuxt/ui";
```

- [ ] **Step 5: Write `app/app.vue`**

```vue
<template>
  <UApp>
    <div class="min-h-dvh flex items-center justify-center">
      <h1 class="text-2xl font-semibold">Braindump</h1>
    </div>
  </UApp>
</template>
```

- [ ] **Step 6: Write `.env.example`**

```bash
# Neon Postgres connection string (pooled, HTTP)
NUXT_DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
# Separate database/branch used only by `bun test`
NUXT_TEST_DATABASE_URL="postgresql://user:pass@host/db_test?sslmode=require"
```

- [ ] **Step 7: Add scripts to `package.json`**

Ensure the `scripts` block contains:

```json
{
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "typecheck": "nuxt typecheck",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "test": "bun test"
  }
}
```

- [ ] **Step 8: Verify the app boots and typechecks**

Run: `bunx nuxi typecheck`
Expected: completes with no type errors (Nuxt may run a one-time `nuxi prepare` first).

> If `@nuxt/ui` v4's CSS import directive differs from Step 4 in the installed version, follow the snippet printed by `bunx nuxi module add @nuxt/ui` / the package README and adjust `main.css` accordingly. The rest of this plan does not depend on UI styling.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Nuxt 4 + Nuxt UI app with Bun

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Validated environment config

**Files:**
- Create: `server/utils/env.ts`
- Test: `server/utils/env.test.ts`

**Interfaces:**
- Produces:
  - `parseEnv(source: Record<string, string | undefined>): { databaseUrl: string }` — validates and returns config; throws `Error` with a readable message when `NUXT_DATABASE_URL` is missing/empty.

- [ ] **Step 1: Write the failing test**

```ts
// server/utils/env.test.ts
import { test, expect } from "bun:test";
import { parseEnv } from "./env";

test("parseEnv returns databaseUrl when present", () => {
  const cfg = parseEnv({ NUXT_DATABASE_URL: "postgresql://x/y" });
  expect(cfg.databaseUrl).toBe("postgresql://x/y");
});

test("parseEnv throws when NUXT_DATABASE_URL is missing", () => {
  expect(() => parseEnv({})).toThrow(/NUXT_DATABASE_URL/);
});

test("parseEnv throws when NUXT_DATABASE_URL is empty", () => {
  expect(() => parseEnv({ NUXT_DATABASE_URL: "" })).toThrow(/NUXT_DATABASE_URL/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/utils/env.test.ts`
Expected: FAIL — cannot find module `./env`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/utils/env.ts
import { z } from "zod";

const schema = z.object({
  NUXT_DATABASE_URL: z.string().min(1, "NUXT_DATABASE_URL is required"),
});

export function parseEnv(source: Record<string, string | undefined>): {
  databaseUrl: string;
} {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return { databaseUrl: parsed.data.NUXT_DATABASE_URL };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/utils/env.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/utils/env.ts server/utils/env.test.ts
git commit -m "feat: add validated environment config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Drizzle enums, schema, config, and migration

**Files:**
- Create: `server/db/schema.ts`
- Create: `drizzle.config.ts`
- Create: `drizzle/` (generated migration output)
- Test: `server/db/schema.test.ts`

**Interfaces:**
- Produces (Drizzle table objects + inferred types consumed by all later query tasks):
  - Enums: `projectKind`, `todoStatus`, `eventSyncStatus`, `itemSource`.
  - Tables: `projects`, `dumps`, `todos`, `events`, `activities`.
  - Inferred types: `Project`, `NewProject`, `Dump`, `NewDump`, `Todo`, `NewTodo`, `EventRow`, `NewEventRow`, `Activity`, `NewActivity`.

- [ ] **Step 1: Write the failing test**

This test asserts the schema modules export the expected tables and enum values (cheap structural guard, no DB needed).

```ts
// server/db/schema.test.ts
import { test, expect } from "bun:test";
import {
  projects,
  dumps,
  todos,
  events,
  activities,
  projectKind,
} from "./schema";

test("tables are exported", () => {
  for (const t of [projects, dumps, todos, events, activities]) {
    expect(t).toBeDefined();
  }
});

test("projectKind enum has the seeded kinds", () => {
  expect(projectKind.enumValues).toEqual([
    "work",
    "part_time",
    "freelance",
    "hackathon",
    "personal",
    "other",
  ]);
});

test("event time columns are starts_at / ends_at", () => {
  expect(events.startsAt).toBeDefined();
  expect(events.endsAt).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/db/schema.test.ts`
Expected: FAIL — cannot find module `./schema`.

- [ ] **Step 3: Write the schema**

```ts
// server/db/schema.ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  real,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const projectKind = pgEnum("project_kind", [
  "work",
  "part_time",
  "freelance",
  "hackathon",
  "personal",
  "other",
]);
export const todoStatus = pgEnum("todo_status", ["open", "done", "dropped"]);
export const eventSyncStatus = pgEnum("event_sync_status", [
  "local",
  "synced",
  "error",
]);
export const itemSource = pgEnum("item_source", ["ai", "manual"]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  kind: projectKind("kind").notNull(),
  keywords: text("keywords").array().notNull().default([]),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dumps = pgTable("dumps", {
  id: uuid("id").primaryKey().defaultRandom(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const todos = pgTable("todos", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  notes: text("notes"),
  projectId: uuid("project_id").references(() => projects.id),
  status: todoStatus("status").notNull().default("open"),
  scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
  dumpId: uuid("dump_id").references(() => dumps.id),
  source: itemSource("source").notNull().default("manual"),
  confidence: real("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  projectId: uuid("project_id").references(() => projects.id),
  googleEventId: text("google_event_id"),
  googleAccountId: text("google_account_id"),
  dumpId: uuid("dump_id").references(() => dumps.id),
  syncStatus: eventSyncStatus("sync_status").notNull().default("local"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Dump = typeof dumps.$inferSelect;
export type NewDump = typeof dumps.$inferInsert;
export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/db/schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write `drizzle.config.ts`**

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.NUXT_DATABASE_URL!,
  },
});
```

- [ ] **Step 6: Generate the migration**

Run: `bun run db:generate`
Expected: a SQL migration file is created under `drizzle/` (e.g. `drizzle/0000_*.sql`) containing `CREATE TYPE` for the enums and `CREATE TABLE` for all five tables.

- [ ] **Step 7: Commit**

```bash
git add server/db/schema.ts server/db/schema.test.ts drizzle.config.ts drizzle/
git commit -m "feat: add Drizzle schema, enums, and initial migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: DB client + test harness (real Postgres)

**Files:**
- Create: `server/db/client.ts`
- Create: `server/db/test-helpers.ts`
- Test: `server/db/client.test.ts`

**Prerequisite for DB-backed tests:** a reachable test Postgres. Use a dedicated
Neon branch (recommended) or a local container:

```bash
# Local option:
docker run --name braindump-test-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=braindump_test -p 5433:5432 -d postgres:16
# Then in .env: NUXT_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/braindump_test"
```

Apply the schema to the test DB before running DB tests:

```bash
NUXT_DATABASE_URL="$NUXT_TEST_DATABASE_URL" bun run db:push
```

> Neon's `neon-http` driver works against Neon over HTTP. For a **local** Postgres
> container, install `postgres` (`bun add postgres`) and have `makeDb` branch on
> the URL host: use `drizzle-orm/postgres-js` for `localhost`, `drizzle-orm/neon-http`
> otherwise. Both expose the same Drizzle query API, so query-helper code is identical.

**Interfaces:**
- Produces:
  - `makeDb(url: string): NodePgDatabase | NeonHttpDatabase` — typed Drizzle instance bound to `*` schema. (Return type is the Drizzle DB; later tasks accept `type Db = ReturnType<typeof makeDb>`.)
  - `getTestDb(): Db` — builds a `Db` from `NUXT_TEST_DATABASE_URL`, throwing a clear error if unset.
  - `truncateAll(db: Db): Promise<void>` — empties all five tables (test isolation).

- [ ] **Step 1: Write the failing test**

```ts
// server/db/client.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "./test-helpers";
import { projects } from "./schema";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

test("can insert and read a row against the test DB", async () => {
  await db.insert(projects).values({ name: "Tmp", color: "#000", kind: "other" });
  const rows = await db.select().from(projects);
  expect(rows.length).toBe(1);
  expect(rows[0]!.name).toBe("Tmp");
});

test("truncateAll empties tables", async () => {
  await db.insert(projects).values({ name: "Tmp", color: "#000", kind: "other" });
  await truncateAll(db);
  const rows = await db.select().from(projects);
  expect(rows.length).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/db/client.test.ts`
Expected: FAIL — cannot find module `./test-helpers`.

- [ ] **Step 3: Write the client**

```ts
// server/db/client.ts
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

export function makeDb(url: string) {
  const sql = neon(url);
  return drizzleNeon(sql, { schema });
}

export type Db = ReturnType<typeof makeDb>;
```

- [ ] **Step 4: Write the test helpers**

```ts
// server/db/test-helpers.ts
import { sql } from "drizzle-orm";
import { makeDb, type Db } from "./client";

export function getTestDb(): Db {
  const url = process.env.NUXT_TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "NUXT_TEST_DATABASE_URL is not set. See Plan 1 Task 4 prerequisites.",
    );
  }
  return makeDb(url);
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE activities, events, todos, dumps, projects RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test server/db/client.test.ts`
Expected: PASS (2 tests). (Ensure the test DB schema was pushed per the prerequisite.)

- [ ] **Step 6: Commit**

```bash
git add server/db/client.ts server/db/test-helpers.ts server/db/client.test.ts
git commit -m "feat: add Drizzle client and DB test harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Project queries + seed

**Files:**
- Create: `server/db/queries/projects.ts`
- Create: `server/db/seed.ts`
- Test: `server/db/queries/projects.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 4), `projects`, `NewProject`, `Project` (Task 3).
- Produces:
  - `createProject(db: Db, input: NewProject): Promise<Project>`
  - `listProjects(db: Db): Promise<Project[]>`
  - `seedDefaultProjects(db: Db): Promise<Project[]>` — inserts the five default projects **only if none exist**; returns all projects.

- [ ] **Step 1: Write the failing test**

```ts
// server/db/queries/projects.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createProject, listProjects } from "./projects";
import { seedDefaultProjects } from "../seed";

const db = getTestDb();
beforeEach(async () => {
  await truncateAll(db);
});

test("createProject inserts and returns the row", async () => {
  const p = await createProject(db, { name: "Work", color: "#0D9488", kind: "work" });
  expect(p.id).toBeTruthy();
  expect(p.name).toBe("Work");
  expect(p.keywords).toEqual([]);
});

test("listProjects returns inserted projects", async () => {
  await createProject(db, { name: "Work", color: "#0D9488", kind: "work" });
  await createProject(db, { name: "Personal", color: "#EA580C", kind: "personal" });
  const all = await listProjects(db);
  expect(all.length).toBe(2);
});

test("seedDefaultProjects seeds the five defaults exactly once", async () => {
  const first = await seedDefaultProjects(db);
  expect(first.map((p) => p.name).sort()).toEqual(
    ["Freelance", "Hackathon", "Part-time", "Personal", "Work"],
  );
  const second = await seedDefaultProjects(db);
  expect(second.length).toBe(5); // no duplicates on re-run
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/db/queries/projects.test.ts`
Expected: FAIL — cannot find module `./projects`.

- [ ] **Step 3: Write the queries**

```ts
// server/db/queries/projects.ts
import { type Db } from "../client";
import { projects, type NewProject, type Project } from "../schema";

export async function createProject(db: Db, input: NewProject): Promise<Project> {
  const [row] = await db.insert(projects).values(input).returning();
  return row!;
}

export async function listProjects(db: Db): Promise<Project[]> {
  return db.select().from(projects);
}
```

- [ ] **Step 4: Write the seed**

```ts
// server/db/seed.ts
import { type Db } from "./client";
import { type NewProject, type Project } from "./schema";
import { createProject, listProjects } from "./queries/projects";

const DEFAULT_PROJECTS: NewProject[] = [
  { name: "Work", color: "#0D9488", kind: "work", isDefault: true,
    keywords: ["meeting", "standup", "deploy", "ticket", "manager"] },
  { name: "Part-time", color: "#2563EB", kind: "part_time", isDefault: true,
    keywords: ["shift", "client", "invoice"] },
  { name: "Freelance", color: "#7C3AED", kind: "freelance", isDefault: true,
    keywords: ["proposal", "contract", "scope", "deliverable"] },
  { name: "Hackathon", color: "#DB2777", kind: "hackathon", isDefault: true,
    keywords: ["demo", "prototype", "submit", "pitch", "team"] },
  { name: "Personal", color: "#EA580C", kind: "personal", isDefault: true,
    keywords: ["gym", "groceries", "family", "appointment", "errand"] },
];

export async function seedDefaultProjects(db: Db): Promise<Project[]> {
  const existing = await listProjects(db);
  if (existing.length > 0) return existing;
  for (const p of DEFAULT_PROJECTS) {
    await createProject(db, p);
  }
  return listProjects(db);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test server/db/queries/projects.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/db/queries/projects.ts server/db/seed.ts server/db/queries/projects.test.ts
git commit -m "feat: add project queries and default seed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Dump / Todo / Event / Activity queries (incl. scheduled vs unscheduled)

**Files:**
- Create: `server/db/queries/items.ts`
- Test: `server/db/queries/items.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 4); `dumps`, `todos`, `events`, `activities` and their `New*`/select types (Task 3); `createProject` (Task 5).
- Produces:
  - `createDump(db: Db, text: string): Promise<Dump>`
  - `createTodo(db: Db, input: NewTodo): Promise<Todo>`
  - `listUnscheduledTodos(db: Db): Promise<Todo[]>` — `status='open'` AND `scheduledStart IS NULL`, newest first.
  - `listScheduledTodosInRange(db: Db, from: Date, to: Date): Promise<Todo[]>` — `scheduledStart` within `[from, to)`.
  - `createEvent(db: Db, input: NewEventRow): Promise<EventRow>`
  - `listEventsInRange(db: Db, from: Date, to: Date): Promise<EventRow[]>` — `startsAt` within `[from, to)`.
  - `logActivity(db: Db, input: NewActivity): Promise<Activity>`
  - `listActivity(db: Db, limit?: number): Promise<Activity[]>` — newest first.

- [ ] **Step 1: Write the failing test**

```ts
// server/db/queries/items.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../test-helpers";
import { createProject } from "./projects";
import {
  createDump,
  createTodo,
  listUnscheduledTodos,
  listScheduledTodosInRange,
  createEvent,
  listEventsInRange,
  logActivity,
  listActivity,
} from "./items";

const db = getTestDb();
beforeEach(async () => {
  await truncateAll(db);
});

test("createDump stores raw text", async () => {
  const d = await createDump(db, "buy milk and email Sam");
  expect(d.text).toBe("buy milk and email Sam");
});

test("listUnscheduledTodos returns only open, unscheduled todos", async () => {
  await createTodo(db, { title: "unscheduled-open" });
  await createTodo(db, {
    title: "scheduled",
    scheduledStart: new Date("2026-07-01T09:00:00Z"),
    scheduledEnd: new Date("2026-07-01T10:00:00Z"),
  });
  await createTodo(db, { title: "done-one", status: "done" });
  const rows = await listUnscheduledTodos(db);
  expect(rows.map((r) => r.title)).toEqual(["unscheduled-open"]);
});

test("listScheduledTodosInRange filters by scheduledStart window", async () => {
  await createTodo(db, {
    title: "in-range",
    scheduledStart: new Date("2026-07-01T09:00:00Z"),
    scheduledEnd: new Date("2026-07-01T10:00:00Z"),
  });
  await createTodo(db, {
    title: "out-of-range",
    scheduledStart: new Date("2026-07-05T09:00:00Z"),
    scheduledEnd: new Date("2026-07-05T10:00:00Z"),
  });
  const rows = await listScheduledTodosInRange(
    db,
    new Date("2026-07-01T00:00:00Z"),
    new Date("2026-07-02T00:00:00Z"),
  );
  expect(rows.map((r) => r.title)).toEqual(["in-range"]);
});

test("listEventsInRange filters by startsAt window", async () => {
  await createEvent(db, {
    title: "standup",
    startsAt: new Date("2026-07-01T09:00:00Z"),
    endsAt: new Date("2026-07-01T09:15:00Z"),
  });
  await createEvent(db, {
    title: "next-week",
    startsAt: new Date("2026-07-08T09:00:00Z"),
    endsAt: new Date("2026-07-08T09:15:00Z"),
  });
  const rows = await listEventsInRange(
    db,
    new Date("2026-07-01T00:00:00Z"),
    new Date("2026-07-02T00:00:00Z"),
  );
  expect(rows.map((r) => r.title)).toEqual(["standup"]);
});

test("activity log is returned newest first", async () => {
  const p = await createProject(db, { name: "Work", color: "#0D9488", kind: "work" });
  await logActivity(db, { action: "create", entityType: "project", entityId: p.id });
  await logActivity(db, { action: "update", entityType: "project", entityId: p.id });
  const rows = await listActivity(db);
  expect(rows[0]!.action).toBe("update");
  expect(rows.length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/db/queries/items.test.ts`
Expected: FAIL — cannot find module `./items`.

- [ ] **Step 3: Write the queries**

```ts
// server/db/queries/items.ts
import { and, gte, lt, isNull, eq, desc } from "drizzle-orm";
import { type Db } from "../client";
import {
  dumps,
  todos,
  events,
  activities,
  type Dump,
  type NewTodo,
  type Todo,
  type NewEventRow,
  type EventRow,
  type NewActivity,
  type Activity,
} from "../schema";

export async function createDump(db: Db, text: string): Promise<Dump> {
  const [row] = await db.insert(dumps).values({ text }).returning();
  return row!;
}

export async function createTodo(db: Db, input: NewTodo): Promise<Todo> {
  const [row] = await db.insert(todos).values(input).returning();
  return row!;
}

export async function listUnscheduledTodos(db: Db): Promise<Todo[]> {
  return db
    .select()
    .from(todos)
    .where(and(eq(todos.status, "open"), isNull(todos.scheduledStart)))
    .orderBy(desc(todos.createdAt));
}

export async function listScheduledTodosInRange(
  db: Db,
  from: Date,
  to: Date,
): Promise<Todo[]> {
  return db
    .select()
    .from(todos)
    .where(and(gte(todos.scheduledStart, from), lt(todos.scheduledStart, to)))
    .orderBy(todos.scheduledStart);
}

export async function createEvent(db: Db, input: NewEventRow): Promise<EventRow> {
  const [row] = await db.insert(events).values(input).returning();
  return row!;
}

export async function listEventsInRange(
  db: Db,
  from: Date,
  to: Date,
): Promise<EventRow[]> {
  return db
    .select()
    .from(events)
    .where(and(gte(events.startsAt, from), lt(events.startsAt, to)))
    .orderBy(events.startsAt);
}

export async function logActivity(db: Db, input: NewActivity): Promise<Activity> {
  const [row] = await db.insert(activities).values(input).returning();
  return row!;
}

export async function listActivity(db: Db, limit = 50): Promise<Activity[]> {
  return db
    .select()
    .from(activities)
    .orderBy(desc(activities.createdAt))
    .limit(limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/db/queries/items.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the whole suite**

Run: `bun test`
Expected: all tests from Tasks 2–6 PASS.

- [ ] **Step 6: Commit**

```bash
git add server/db/queries/items.ts server/db/queries/items.test.ts
git commit -m "feat: add dump/todo/event/activity queries with range filters

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Plan 1's slice):**
- Data model (spec §5) → Tasks 3, 5, 6 implement every table (`project`, `dump`,
  `todo`, `event`, `activity`) and their columns. `userId`/auth deferred to Plan 2
  per the roadmap (documented, not a gap). ✓
- Scheduled-vs-unscheduled todo distinction (spec §3, §5, calendar rail) →
  `listUnscheduledTodos` / `listScheduledTodosInRange`. ✓
- Default projects seed (spec §2, §10) → `seedDefaultProjects`. ✓
- Activity/undo substrate (spec §5, §9) → `activities` + `logActivity`/`listActivity`. ✓
- Stack scaffold + Bun + Nuxt UI (spec §3) → Task 1. ✓
- AI / calendar-sync / auth modules → out of Plan 1 scope (Plans 2–4). ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code; no
"handle edge cases" hand-waving. The two doc-verification notes (Nuxt UI CSS
import in Task 1; local-vs-Neon driver in Task 4) are explicit, bounded
fallbacks with concrete instructions, not placeholders. ✓

**Type consistency:** `Db` (Task 4) is the single DB type used by Tasks 5–6.
`EventRow`/`NewEventRow` named consistently (avoids clashing with the DOM `Event`).
Query names in the test files match the `Interfaces` blocks and implementations
(`listUnscheduledTodos`, `listScheduledTodosInRange`, `listEventsInRange`,
`logActivity`, `listActivity`). ✓
