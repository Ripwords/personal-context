# Clear Todos, Fix Blank Calendar, Settings Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the blank week calendar, let the user clear (soft-dismiss) todos individually or in bulk, and add a reachable settings page for managing connected Google accounts.

**Architecture:** The calendar is blank because `getGoogleConnections` INNER JOINs `account` → `google_connections`, and no `google_connections` row exists until a role is manually set — so a freshly signed-in account is invisible to both calendar sync and the connections list. Switching to a LEFT JOIN (default role `"personal"`) makes the `account` table the source of truth and fixes both. Todo clearing reuses the existing `todo_status` enum value `"dropped"` (soft-dismiss, no migration). The settings page folds in the already-built connections UI and gets a header nav link.

**Tech Stack:** Nuxt 4, Nuxt UI v4, Tailwind, Better Auth, Drizzle (`drizzle-orm/node-postgres`), Bun (package manager + `bun test`).

## Global Constraints

- Package manager / test runner: **Bun** (`bun test`, `bun run …`). Never `npm`/`node`/`jest`.
- Never use `any` to satisfy types; avoid `as unknown as X` unless strictly necessary.
- DB query tests require a local Postgres (`docker start braindump-test-pg`) on the test port and use `getTestDb()` + `truncateAll()` from `server/db/test-helpers`.
- Conventional Commits.
- UI is minimal monochrome (black & white, low-chrome); match existing `neutral-*` Tailwind classes — no hue-based accents.
- `todo_status` enum is exactly `["open", "done", "dropped"]`. "Clear" === set `status = "dropped"`. No schema migration in this plan.

---

### Task 1: Fix `getGoogleConnections` to source from `account` (LEFT JOIN)

This is the core bug fix — it unblocks both the calendar and the connections/settings list.

**Files:**
- Modify: `server/auth/google-credentials.ts`
- Test: `server/auth/google-credentials.test.ts`

**Interfaces:**
- Consumes: `account`, `googleConnections` tables from `server/db/schema`; `setConnectionRole` from `server/auth/connections`.
- Produces: `getGoogleConnections(db: Db): Promise<GoogleCreds[]>` — unchanged signature; now returns one entry per `account` where `providerId = "google"`, with `role` defaulting to `"personal"` and `braindumpCalendarId` to `null` when no `google_connections` row exists.

- [ ] **Step 1: Add a failing test for an account with no `google_connections` row**

Add to `server/auth/google-credentials.test.ts` (the existing `beforeEach` already inserts `user` `u1` and `account` `acc1`, then calls `setConnectionRole(db, "acc1", "work")`). Add a second account that is intentionally left without a role row:

```ts
test("getGoogleConnections includes google accounts with no connection row, defaulting role to personal", async () => {
  await db.execute(sql`INSERT INTO "account" (id, account_id, provider_id, user_id, access_token, refresh_token)
    VALUES ('acc2','g2','google','u1','at_2','rt_2')`);

  const conns = await getGoogleConnections(db);
  const byId = Object.fromEntries(conns.map((c) => [c.accountId, c]));

  expect(conns.length).toBe(2);
  expect(byId["acc2"]!.accessToken).toBe("at_2");
  expect(byId["acc2"]!.role).toBe("personal");
  expect(byId["acc2"]!.braindumpCalendarId).toBeNull();
  // The account that DID get a role still reports it.
  expect(byId["acc1"]!.role).toBe("work");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test server/auth/google-credentials.test.ts`
Expected: FAIL — `conns.length` is `1` (the inner join drops `acc2`).

- [ ] **Step 3: Switch the join to a LEFT JOIN with a default role**

Replace the body of `getGoogleConnections` in `server/auth/google-credentials.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { type Db } from "../db/client";
import { account, googleConnections } from "../db/schema";

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
    .leftJoin(googleConnections, eq(googleConnections.accountId, account.id))
    .where(eq(account.providerId, "google"));

  return rows.map((r) => ({
    accountId: r.accountId,
    role: r.role ?? "personal",
    accessToken: r.accessToken ?? "",
    refreshToken: r.refreshToken ?? null,
    braindumpCalendarId: r.braindumpCalendarId ?? null,
  }));
}
```

(The `sql` import may be unused — remove it if so; keep `eq`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test server/auth/google-credentials.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add server/auth/google-credentials.ts server/auth/google-credentials.test.ts
git commit -m "fix: source google connections from account table (LEFT JOIN) so fresh sign-ins appear"
```

---

### Task 2: `dropTodo` and `dropAllUnscheduledTodos` queries

**Files:**
- Modify: `server/db/queries/items.ts`
- Test: `server/db/queries/items.test.ts`

**Interfaces:**
- Consumes: `todos` table, `Todo` type from `server/db/schema`; `Db`/`DbOrTx` from `server/db/client`.
- Produces:
  - `dropTodo(db: DbOrTx, id: string): Promise<Todo | null>` — sets `status = "dropped"`; returns the updated row or `null` if no row matched.
  - `dropAllUnscheduledTodos(db: DbOrTx): Promise<number>` — sets `status = "dropped"` for every todo with `status = "open"` AND `scheduledStart IS NULL`; returns the count updated.

- [ ] **Step 1: Write failing tests**

Add to `server/db/queries/items.test.ts` (import `dropTodo`, `dropAllUnscheduledTodos`, and `createTodo`, `listUnscheduledTodos` already imported):

```ts
test("dropTodo marks a todo dropped and removes it from the unscheduled list", async () => {
  const t = await createTodo(db, { title: "to-drop" });
  const updated = await dropTodo(db, t.id);
  expect(updated?.status).toBe("dropped");
  expect((await listUnscheduledTodos(db)).length).toBe(0);
});

test("dropTodo returns null when the id does not exist", async () => {
  const updated = await dropTodo(db, "00000000-0000-0000-0000-000000000000");
  expect(updated).toBeNull();
});

test("dropAllUnscheduledTodos drops only open unscheduled todos and reports the count", async () => {
  await createTodo(db, { title: "open-1" });
  await createTodo(db, { title: "open-2" });
  await createTodo(db, {
    title: "scheduled",
    scheduledStart: new Date("2026-07-01T09:00:00Z"),
    scheduledEnd: new Date("2026-07-01T10:00:00Z"),
  });
  const count = await dropAllUnscheduledTodos(db);
  expect(count).toBe(2);
  expect((await listUnscheduledTodos(db)).length).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test server/db/queries/items.test.ts`
Expected: FAIL — `dropTodo`/`dropAllUnscheduledTodos` are not exported.

- [ ] **Step 3: Implement the queries**

Add to `server/db/queries/items.ts` (the file already imports `and`, `gte`, `lt`, `isNull`, `eq`, `desc`, `todos`, `Todo`):

```ts
export async function dropTodo(db: DbOrTx, id: string): Promise<Todo | null> {
  const [row] = await db
    .update(todos)
    .set({ status: "dropped" })
    .where(eq(todos.id, id))
    .returning();
  return row ?? null;
}

export async function dropAllUnscheduledTodos(db: DbOrTx): Promise<number> {
  const rows = await db
    .update(todos)
    .set({ status: "dropped" })
    .where(and(eq(todos.status, "open"), isNull(todos.scheduledStart)))
    .returning({ id: todos.id });
  return rows.length;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test server/db/queries/items.test.ts`
Expected: PASS (all items tests).

- [ ] **Step 5: Commit**

```bash
git add server/db/queries/items.ts server/db/queries/items.test.ts
git commit -m "feat: dropTodo and dropAllUnscheduledTodos queries (soft-dismiss)"
```

---

### Task 3: Todo clear API routes

Matches the codebase route convention: a thin session-gated handler delegating to a query. Route tests assert the handler is exported and callable (mirrors `server/api/auth/auth-route.test.ts`); behavior is covered by Task 2's query tests.

**Files:**
- Create: `server/api/todos/[id].delete.ts`
- Create: `server/api/todos/clear-unscheduled.post.ts`
- Test: `server/api/todos/todos-route.test.ts`

**Interfaces:**
- Consumes: `getAuthSession` from `server/utils/session`; `getDb` from `server/db/client`; `dropTodo`, `dropAllUnscheduledTodos` from `server/db/queries/items`.
- Produces: `DELETE /api/todos/:id` → `{ dropped: true }`; `POST /api/todos/clear-unscheduled` → `{ dropped: <count> }`. Both return 401 when unauthenticated.

- [ ] **Step 1: Write a failing handler-export test**

Create `server/api/todos/todos-route.test.ts`:

```ts
import { test, expect } from "bun:test";
import dropOne from "./[id].delete";
import clearUnscheduled from "./clear-unscheduled.post";

test("todo routes export handlers", () => {
  expect(typeof dropOne).toBe("function");
  expect(typeof clearUnscheduled).toBe("function");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test server/api/todos/todos-route.test.ts`
Expected: FAIL — module files do not exist.

- [ ] **Step 3: Create the DELETE-one handler**

Create `server/api/todos/[id].delete.ts`:

```ts
import { defineEventHandler, createError, getRouterParam } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { dropTodo } from "../../db/queries/items";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const db = getDb();
  const row = await dropTodo(db, id);
  if (!row) throw createError({ statusCode: 404, statusMessage: "todo not found" });
  return { dropped: true };
});
```

- [ ] **Step 4: Create the clear-unscheduled handler**

Create `server/api/todos/clear-unscheduled.post.ts`:

```ts
import { defineEventHandler, createError } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { dropAllUnscheduledTodos } from "../../db/queries/items";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const db = getDb();
  const dropped = await dropAllUnscheduledTodos(db);
  return { dropped };
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test server/api/todos/todos-route.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add server/api/todos
git commit -m "feat: DELETE /api/todos/:id and POST /api/todos/clear-unscheduled"
```

---

### Task 4: Clear controls in the unscheduled rail

Adds a per-todo ✕ and a "Clear all" button, wired to the new endpoints, refreshing the calendar feed after each action.

**Files:**
- Modify: `app/components/UnscheduledRail.vue`
- Modify: `app/pages/index.vue`

**Interfaces:**
- Consumes: `DELETE /api/todos/:id`, `POST /api/todos/clear-unscheduled`; the `refresh` function from the `useFetch` calendar feed in `index.vue`.
- Produces: `UnscheduledRail` emits `drop` (payload: todo id `string`) and `clear-all` (no payload); `index.vue` handles both by calling the endpoints via `$fetch` and then `await refresh()`.

- [ ] **Step 1: Add emits and controls to `UnscheduledRail.vue`**

Replace the contents of `app/components/UnscheduledRail.vue` with:

```vue
<script setup lang="ts">
export interface UnscheduledTodo {
  id: string;
  title: string;
  notes: string | null;
  projectId: string | null;
}

defineProps<{
  todos: UnscheduledTodo[];
  projectColorMap: Record<string, string>;
}>();

const emit = defineEmits<{
  drop: [id: string];
  "clear-all": [];
}>();
</script>

<template>
  <aside class="flex flex-col gap-1 px-3 py-4 overflow-y-auto" aria-label="Unscheduled tasks">
    <div class="flex items-center justify-between px-2 mb-2">
      <p class="text-[10px] font-semibold tracking-widest uppercase text-neutral-400">
        Inbox
      </p>
      <button
        v-if="todos.length > 0"
        type="button"
        class="text-[10px] font-medium text-neutral-400 hover:text-neutral-700
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 rounded
               motion-safe:transition-colors"
        @click="emit('clear-all')"
      >
        Clear all
      </button>
    </div>

    <ul class="flex flex-col gap-1">
      <li
        v-for="todo in todos"
        :key="todo.id"
        class="group flex items-start gap-2 rounded border border-neutral-200 px-3 py-2 bg-white
               text-sm text-neutral-800 cursor-default select-none"
      >
        <!-- project colour tick -->
        <span
          v-if="todo.projectId && projectColorMap[todo.projectId]"
          class="mt-0.5 shrink-0 w-0.5 h-4 rounded-full"
          :style="{ backgroundColor: projectColorMap[todo.projectId] }"
          aria-hidden="true"
        />
        <span class="leading-snug break-words flex-1">{{ todo.title }}</span>
        <button
          type="button"
          class="shrink-0 text-neutral-300 opacity-0 group-hover:opacity-100
                 hover:text-neutral-700 focus-visible:opacity-100 focus-visible:outline-none
                 focus-visible:ring-2 focus-visible:ring-neutral-900 rounded
                 motion-safe:transition-opacity"
          :aria-label="`Clear ${todo.title}`"
          @click="emit('drop', todo.id)"
        >
          ✕
        </button>
      </li>
    </ul>

    <p v-if="todos.length === 0" class="px-2 text-xs text-neutral-400">
      All tasks scheduled.
    </p>
  </aside>
</template>
```

- [ ] **Step 2: Capture `refresh` and add handlers in `index.vue`**

In `app/pages/index.vue`, the calendar feed is loaded with `useFetch`. Add `refresh` to its destructure (around line 62-68):

```ts
const {
  data: feed,
  status,
  error,
  refresh,
} = await useFetch<CalendarFeed>("/api/calendar/events", {
  query: computed(() => ({ from: fromISO.value, to: toISO.value })),
});
```

Then add handler functions near the other handlers (e.g. just below `unscheduledTodos`, around line 117):

```ts
async function dropTodo(id: string): Promise<void> {
  await $fetch(`/api/todos/${id}`, { method: "DELETE" });
  await refresh();
}

async function clearUnscheduled(): Promise<void> {
  await $fetch("/api/todos/clear-unscheduled", { method: "POST" });
  await refresh();
}
```

- [ ] **Step 3: Wire the events on the `<UnscheduledRail>` element**

In the template (around line 312-316), update the component usage:

```vue
<UnscheduledRail
  :todos="unscheduledTodos"
  :project-color-map="projectColorMap"
  @drop="dropTodo"
  @clear-all="clearUnscheduled"
/>
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Manual verification**

Run: `bun run dev` → open `http://localhost:3000`. Create an unscheduled todo via `/dump` (or confirm an existing one in the Inbox rail). Hover a todo → ✕ appears → click it → the todo disappears. Click "Clear all" → the Inbox empties. Reload to confirm the changes persisted.

- [ ] **Step 6: Commit**

```bash
git add app/components/UnscheduledRail.vue app/pages/index.vue
git commit -m "feat: clear unscheduled todos (per-todo and clear-all) from the inbox rail"
```

---

### Task 5: Settings page + nav link

Creates `/settings` housing the connected-accounts UI (moved from the orphaned `/connections` page), adds a header nav link, and removes the old page.

**Files:**
- Create: `app/pages/settings.vue`
- Modify: `app/pages/index.vue`
- Delete: `app/pages/connections.vue`

**Interfaces:**
- Consumes: `GET /api/connections` (now populated via Task 1); `authClient.linkSocial`; `POST /api/connections/role`.
- Produces: a `/settings` route reachable from the main header.

- [ ] **Step 1: Create the settings page**

Create `app/pages/settings.vue` (port of `connections.vue`, retitled, `callbackURL` pointed at `/settings`):

```vue
<script setup lang="ts">
import { authClient } from "~/lib/auth-client";

type ConnectionRole = "personal" | "work";

interface Connection {
  accountId: string;
  role: ConnectionRole;
  braindumpCalendarId: string | null;
}

const { data: connections, refresh } = await useFetch<Connection[]>("/api/connections");

async function addAccount() {
  await authClient.linkSocial({ provider: "google", callbackURL: "/settings" });
}

async function setRole(accountId: string, role: ConnectionRole) {
  await $fetch("/api/connections/role", {
    method: "POST",
    body: { accountId, role },
  });
  await refresh();
}
</script>

<template>
  <main class="min-h-dvh bg-neutral-50 text-neutral-900">
    <div class="mx-auto max-w-xl px-6 py-16 flex flex-col gap-10">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
        <NuxtLink
          to="/"
          class="px-3 py-1 text-xs font-medium rounded border border-neutral-200 bg-white
                 text-neutral-600 hover:bg-neutral-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
                 motion-safe:transition-colors"
        >
          Back to calendar
        </NuxtLink>
      </div>

      <section class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold tracking-tight text-neutral-700">Connected Google accounts</h2>
          <UButton color="neutral" variant="outline" size="sm" @click="addAccount">
            Add account
          </UButton>
        </div>

        <ul v-if="connections && connections.length > 0" class="divide-y divide-neutral-200 border border-neutral-200 rounded-lg overflow-hidden">
          <li
            v-for="conn in connections"
            :key="conn.accountId"
            class="flex items-center justify-between px-4 py-3 bg-white"
          >
            <span class="text-sm font-mono text-neutral-600 truncate max-w-xs">{{ conn.accountId }}</span>
            <div class="flex items-center gap-2 ml-4 shrink-0">
              <UButton
                size="xs"
                color="neutral"
                :variant="conn.role === 'personal' ? 'solid' : 'outline'"
                @click="setRole(conn.accountId, 'personal')"
              >
                Personal
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                :variant="conn.role === 'work' ? 'solid' : 'outline'"
                @click="setRole(conn.accountId, 'work')"
              >
                Work
              </UButton>
            </div>
          </li>
        </ul>

        <p v-else class="text-sm text-neutral-400">No connected accounts yet.</p>
      </section>
    </div>
  </main>
</template>
```

- [ ] **Step 2: Add a Settings nav link in `index.vue`**

In `app/pages/index.vue`, add a link inside the "Nav affordances" `<div>` (alongside Dump/Wind down/etc., before the Sign out button, around line 233):

```vue
<NuxtLink
  to="/settings"
  class="px-3 py-1 text-xs font-medium rounded border border-neutral-200 bg-white
         text-neutral-600 hover:bg-neutral-50
         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900
         motion-safe:transition-colors"
>
  Settings
</NuxtLink>
```

- [ ] **Step 3: Delete the orphaned connections page**

```bash
git rm app/pages/connections.vue
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Manual verification**

Run: `bun run dev` → from the calendar header click **Settings** → `/settings` lists your connected Google account(s) with Personal/Work toggles. Toggle a role and confirm it sticks after reload. "Add account" launches the Google link flow and returns to `/settings`.

- [ ] **Step 6: Commit**

```bash
git add app/pages/settings.vue app/pages/index.vue
git commit -m "feat: settings page for connected Google accounts + header nav link"
```

---

### Task 6: Full regression run

- [ ] **Step 1: Run the whole suite**

Run: `bun test`
Expected: all tests pass (the prior 122 plus the new query/route tests).

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: End-to-end smoke**

Run: `bun run dev`. Sign in with Google. Confirm: (a) the week calendar now renders your Google `primary` events (the bug fix), (b) the Inbox rail shows the "check the project at 2pm" todo and it can be cleared individually and via Clear all, (c) `/settings` lists the account and role toggles persist.

---

## Notes / out of scope

- Google Calendar **write-back** of AI-created events (Plan 6) is not included; the calendar fix is read-only sync of each account's `primary` calendar.
- The range-overlap query refinement (events that start before the window but overlap it) remains a separate carry-forward.
- Route handlers are tested at the export level (matching the existing `auth-route.test.ts` convention); session-gating and status flips are guaranteed by the shared `getAuthSession` guard pattern and covered behaviorally by the Task 2 query tests.
