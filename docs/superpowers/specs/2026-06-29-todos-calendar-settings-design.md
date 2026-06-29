# Design: Clear todos, fix blank calendar, settings page

Date: 2026-06-29
Status: Approved

## Context

Three issues surfaced in real use of Braindump:

1. A todo created via the AI dump ("remind me to check the project at 2pm") cannot be
   cleared — there is no delete/dismiss control and no DELETE endpoint.
2. The week calendar is blank even though a Google account is connected.
3. The user needs to connect multiple Google accounts, which requires a reachable
   settings page.

## 1. Fix blank calendar + connections (core bug)

### Root cause

`getGoogleConnections()` (`server/auth/google-credentials.ts`) **INNER JOINs** the
`account` table to `googleConnections`. A `googleConnections` row is only created when a
role is set via `setConnectionRole` (the `/api/connections/role` endpoint, triggered by
the Personal/Work toggles). Nothing creates that row on sign-in, so after a fresh Google
sign-in the join yields no rows:

- `/api/calendar/events` loops over zero connections → never syncs Google → blank calendar.
- `/api/connections` returns an empty list → the connections page shows "No connected
  accounts yet", making it impossible to assign a role (chicken-and-egg).

OAuth scopes (`calendar.readonly`, `calendar.events`) are correctly configured, so the
join is the real culprit.

### Fix

Treat the `account` table (rows where `providerId = "google"`) as the source of truth for
connections. Switch `getGoogleConnections` to a **LEFT JOIN** on `googleConnections`:

- `role` defaults to `"personal"` when no metadata row exists.
- `braindumpCalendarId` defaults to `null`.

This makes both calendar sync and the connections listing work immediately after sign-in.
Role assignment continues to work: `setConnectionRole` already upserts the
`googleConnections` row on the first toggle. No schema change and no Better Auth database
hooks required.

## 2. Clear todos (soft-dismiss + bulk)

Soft-dismiss using the existing `todo_status` enum value `"dropped"` (enum is
`["open", "done", "dropped"]`). No migration needed. `listUnscheduledTodos` already filters
`status = "open"`, so dropped todos disappear from the UI automatically and remain in the
DB for analytics/history.

### Queries (`server/db/queries/items.ts`)

- `dropTodo(db, id)` — set `status = "dropped"` for one todo; returns the updated row (or
  null if not found).
- `dropAllUnscheduledTodos(db)` — set `status = "dropped"` for all todos where
  `status = "open"` and `scheduledStart IS NULL`; returns the count dropped.

### API

- `DELETE /api/todos/[id]` — session-gated; drops one todo.
- `POST /api/todos/clear-unscheduled` — session-gated; drops all open unscheduled todos.

### UI (`app/components/UnscheduledRail.vue`)

- Per-todo hover ✕ control that calls `DELETE /api/todos/[id]`.
- A "Clear all" button in the rail header that calls `POST /api/todos/clear-unscheduled`.
- After either action, refresh the calendar feed so the rail updates.

## 3. Settings page

- New `app/pages/settings.vue` that folds in the existing connections UI: lists connected
  Google accounts (now visible via the fix), a per-account Personal/Work role toggle, and
  "Add account" via Better Auth `authClient.linkSocial({ provider: "google" })`. Structured
  to host future settings sections.
- Add a **Settings** nav link in `app/pages/index.vue`'s header.
- Delete the orphaned `app/pages/connections.vue` (it was never linked from anywhere; no
  redirect needed).

## Testing (TDD)

- `server/db/queries/items.test.ts`: `dropTodo` and `dropAllUnscheduledTodos` flip status
  to `"dropped"` and are excluded from `listUnscheduledTodos`.
- `server/auth/google-credentials.test.ts`: `getGoogleConnections` returns a google
  `account` that has **no** `googleConnections` row, with `role` defaulting to
  `"personal"` and `braindumpCalendarId` null — the regression test for the blank-calendar
  bug.
- New route tests for the todo endpoints: session-gated (401 when unauthenticated) and
  correct status flips when authenticated.

## Out of scope

- Google Calendar write-back of AI events (Plan 6).
- The range-overlap query refinement (events starting before the window but overlapping it).
- Project-tagging refinement (Plan 5).
