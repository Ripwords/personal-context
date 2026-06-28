# Braindump Plan A — Self-hosting & DB Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Drop Neon; run fully self-hosted Postgres via `drizzle-orm/node-postgres`, a programmatic migrator, a multi-stage `oven/bun` Dockerfile, and a Docker Compose stack (postgres + one-shot migrate + app) — modeled on `~/Documents/ai-trader`.

**Architecture:** One `node-postgres` `Pool` client for local + prod (no Neon HTTP). Connection via `DATABASE_URL` (tests use `TEST_DATABASE_URL`). Migrations applied by `server/db/migrate.ts` (`drizzle-orm/node-postgres/migrator`) — the compose `drizzle-migrate` service runs it once before the app starts. node-postgres supports interactive `db.transaction()`, resolving the prior transaction carry-forward.

**Tech Stack:** `drizzle-orm/node-postgres`, `pg`, Drizzle, Nuxt 4 (Nitro), `oven/bun` Docker images, Docker Compose, Bun.

## Global Constraints

- Bun only (`bun install`, `bun test`, `bunx`, `bun <file>`). Never npm/npx/pnpm.
- TypeScript: never `any`.
- TDD where there's logic; for pure config/infra (Dockerfile, compose) the deliverable is a passing validation command, not a unit test.
- Conventional Commits ending with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Env names: runtime/prod = `DATABASE_URL`; tests = `TEST_DATABASE_URL`. `DATABASE_URL` is composed in compose from `POSTGRES_USER/PASSWORD/DB`.
- Local dev/test Postgres stays the Docker container `braindump-test-pg` on `localhost:5434`.
- Match `ai-trader`'s shape: postgres:16-alpine + named volume + healthcheck; one-shot `drizzle-migrate` (`restart: "no"`, gated `postgres: service_healthy`); app gated `drizzle-migrate: service_completed_successfully`.

---

## Task 1: Refactor DB client to node-postgres + standardize env

**Files:**
- Modify: `server/db/client.ts`
- Modify: `server/utils/env.ts` + `server/utils/env.test.ts`
- Modify: `server/db/test-helpers.ts`
- Modify: `drizzle.config.ts`
- Modify: `nuxt.config.ts` (drop unused `runtimeConfig.databaseUrl`)
- Modify: `package.json` (deps)
- Modify: `.env` (local; gitignored — rename keys)

**Interfaces:**
- Produces: `makeDb(url: string): NodePgDatabase<typeof schema>` and `type Db = ReturnType<typeof makeDb>` (now node-postgres). `parseEnv` returns `{ databaseUrl }` from `DATABASE_URL`. `getTestDb()` reads `TEST_DATABASE_URL`.

- [ ] **Step 1: Swap dependencies**

```bash
bun add pg
bun add -d @types/pg
bun remove @neondatabase/serverless postgres
```

- [ ] **Step 2: Update the env-var name in the failing test first**

Edit `server/utils/env.test.ts` — replace every `NUXT_DATABASE_URL` with `DATABASE_URL` (3 existing cases + the extra-keys case). Run it to see it fail against the old impl:

Run: `bun test server/utils/env.test.ts`
Expected: FAIL (impl still validates `NUXT_DATABASE_URL`).

- [ ] **Step 3: Update `parseEnv` to validate `DATABASE_URL`**

```ts
// server/utils/env.ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

export function parseEnv(source: Record<string, string | undefined>): {
  databaseUrl: string;
} {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return { databaseUrl: parsed.data.DATABASE_URL };
}
```

Run: `bun test server/utils/env.test.ts`
Expected: PASS.

- [ ] **Step 4: Rewrite the client on node-postgres**

```ts
// server/db/client.ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function makeDb(url: string): NodePgDatabase<typeof schema> {
  // allowExitOnIdle lets `bun test` exit without hanging on idle pool sockets.
  const pool = new Pool({ connectionString: url, allowExitOnIdle: true });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof makeDb>;
```

- [ ] **Step 5: Point the test harness at `TEST_DATABASE_URL`**

```ts
// server/db/test-helpers.ts
import { sql } from "drizzle-orm";
import { makeDb, type Db } from "./client";

export function getTestDb(): Db {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. See Plan A Task 1 / .env.");
  }
  return makeDb(url);
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE google_connections, activities, events, todos, dumps, projects, account, session, verification, "user" RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] **Step 6: Update `drizzle.config.ts` and `nuxt.config.ts`**

`drizzle.config.ts` — change credentials to `DATABASE_URL`:
```ts
dbCredentials: { url: process.env.DATABASE_URL! },
```
`nuxt.config.ts` — remove the now-unused `runtimeConfig.databaseUrl` line (DB access reads `process.env.DATABASE_URL` directly server-side). Leave the rest of the config unchanged.

- [ ] **Step 7: Rename keys in local `.env`**

Edit `.env` (gitignored) so it has BOTH (same local container):
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/braindump_test"
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5434/braindump_test"
```
Keep the existing `GOOGLE_*` / `BETTER_AUTH_*` lines. Remove the old `NUXT_DATABASE_URL` / `NUXT_TEST_DATABASE_URL` lines.

- [ ] **Step 8: Run the full suite against node-postgres**

Ensure the container is up: `docker start braindump-test-pg` (idempotent).
Run: `bun test`
Expected: all 26 tests pass on the node-postgres driver (tables already exist locally; no migration needed for this step).

- [ ] **Step 9: Typecheck + commit**

Run: `bunx nuxi typecheck` → exit 0.
```bash
git add -A
git commit -m "refactor: switch DB client to node-postgres, standardize DATABASE_URL/TEST_DATABASE_URL

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Programmatic migrator

**Files:**
- Create: `server/db/migrate.ts`
- Modify: `package.json` (`db:migrate` → run the programmatic migrator)

**Interfaces:**
- Produces: `server/db/migrate.ts` — applies `./drizzle` migrations via `drizzle-orm/node-postgres/migrator` using `DATABASE_URL`, exits non-zero on failure.

- [ ] **Step 1: Write the migrator**

```ts
// server/db/migrate.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
} catch (err) {
  console.error("migration failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
```

- [ ] **Step 2: Switch the `db:migrate` script**

In `package.json` change:
```json
"db:migrate": "bun server/db/migrate.ts"
```
(`db:generate` stays `drizzle-kit generate`.)

- [ ] **Step 3: Verify a clean migrate from scratch (disposable DB)**

```bash
docker exec braindump-test-pg psql -U postgres -d braindump_test -c "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/braindump_test" bun run db:migrate
```
Expected: prints `migrations applied`; exit 0. Verify the tables exist:
```bash
docker exec braindump-test-pg psql -U postgres -d braindump_test -tc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
```
Expected: 10 (5 Plan 1 + 4 auth + google_connections).

- [ ] **Step 4: Re-run the suite (schema freshly migrated)**

Run: `bun test`
Expected: 26 pass (the freshly-migrated schema matches what the tests expect).

- [ ] **Step 5: Commit**

```bash
git add server/db/migrate.ts package.json
git commit -m "feat: programmatic node-postgres migrator; db:migrate runs it

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Multi-stage Dockerfile (oven/bun)

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Produces: a Dockerfile with stages `deps`, `build`, `migrate` (CMD runs the migrator), `run` (CMD serves the Nitro bundle).

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
.nuxt
.output
.git
.env
.env.*
.superpowers
docs
*.log
```

- [ ] **Step 2: Write the Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# One-shot migrator image (compose `drizzle-migrate` service targets this).
FROM oven/bun:1-alpine AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock drizzle.config.ts ./
COPY drizzle ./drizzle
COPY server/db ./server/db
CMD ["bun", "server/db/migrate.ts"]

# Production runtime: the Nitro server bundle.
FROM oven/bun:1-alpine AS run
WORKDIR /app
COPY --from=build /app/.output ./.output
EXPOSE 3000
ENV HOST=0.0.0.0 PORT=3000
CMD ["bun", ".output/server/index.mjs"]
```

> The `migrate` stage copies only what the migrator needs (`drizzle/` migrations, `server/db/`, config). The migrator reads `DATABASE_URL` from the environment (compose supplies it).

- [ ] **Step 3: Validate the build target compiles the migrator image**

Run: `docker build --target migrate -t braindump-migrate:test .`
Expected: builds successfully (exit 0). (Full `run`-stage build is exercised by compose in Task 4 verification; building the small `migrate` target here keeps this task fast.)

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: multi-stage oven/bun Dockerfile (deps/build/migrate/run)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Docker Compose stack + .env.example

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

**Interfaces:**
- Produces: a compose stack (`postgres`, `drizzle-migrate`, `app`) and a committed `.env.example` documenting every required variable.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
name: braindump

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10

  drizzle-migrate:
    build:
      context: .
      target: migrate
    image: braindump-migrate:latest
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"

  app:
    build:
      context: .
      target: run
    image: braindump-app:latest
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      LLM_PROVIDER: ${LLM_PROVIDER:-deepseek}
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
    ports:
      - "${APP_PORT:-3000}:3000"
    depends_on:
      postgres:
        condition: service_healthy
      drizzle-migrate:
        condition: service_completed_successfully

volumes:
  pgdata:
```

- [ ] **Step 2: Write `.env.example`**

```bash
# === Postgres (compose composes DATABASE_URL from these) ===
POSTGRES_USER=braindump
POSTGRES_PASSWORD=change-me
POSTGRES_DB=braindump
POSTGRES_PORT=5432
APP_PORT=3000

# Local (non-Docker) dev/test point at the local container; compose overrides
# DATABASE_URL internally to the `postgres` service host.
DATABASE_URL=postgresql://braindump:change-me@localhost:5432/braindump
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/braindump_test

# === Better Auth ===
BETTER_AUTH_SECRET=run-openssl-rand-base64-32
BETTER_AUTH_URL=http://localhost:3000

# === Google OAuth (Calendar) ===
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# === AI provider (configurable; deepseek default) ===
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
ANTHROPIC_API_KEY=
```

- [ ] **Step 3: Validate compose config parses**

Run: `docker compose --env-file .env.example config >/dev/null && echo "compose OK"`
Expected: prints `compose OK` (interpolation + schema valid). (A full `docker compose up` is the deploy-time check — see Task 5.)

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat: docker-compose stack (postgres + drizzle-migrate + app) and .env.example

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full-stack compose verification (heavier — may be deferred)

> Builds the full app image and brings the stack up. Slower (Nuxt build in Docker); run when validating deploy.

- [ ] **Step 1:** `docker compose --env-file .env.example build` → all three images build (exit 0).
- [ ] **Step 2:** `docker compose --env-file .env.example up -d` → `postgres` healthy, `drizzle-migrate` exits 0 (`migrations applied`), `app` starts.
- [ ] **Step 3:** `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` → `200`. Then `docker compose down`.
- [ ] **Step 4:** Record results in the report. (No commit unless a fix was needed.)

---

## Self-Review

**Spec coverage (spec §3 self-hosting):** node-postgres client (Task 1), programmatic migrator (Task 2), multi-stage oven/bun Dockerfile (Task 3), compose stack postgres+migrate+app gated correctly (Task 4), end-to-end verification (Task 5). Resolves the transaction carry-forward (node-postgres). ✓

**Placeholder scan:** All tasks carry concrete code/config + exact commands. Task 5 is explicitly heavier/deferrable, not a placeholder. ✓

**Type consistency:** `Db = ReturnType<typeof makeDb>` is now `NodePgDatabase<typeof schema>`; all existing query helpers (`db: Db`) keep working (select/insert/onConflictDoUpdate/execute/transaction all supported). `parseEnv` → `DATABASE_URL`; `getTestDb` → `TEST_DATABASE_URL`. No code used `db.batch` yet, so the node-postgres switch (no `.batch()`) breaks nothing; future event-sync uses `db.transaction()`. ✓
