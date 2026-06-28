# Braindump Plan B — Analytics Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A read-only usage-stats dashboard computed from existing tables, rendered in the minimal monochrome language (no chart library — inline CSS/SVG bars).

**Architecture:** A pure `getAnalytics(db, now)` runs Drizzle aggregations over `dumps`/`todos`/`events`/`activities` and returns a typed stats object; `GET /api/analytics` exposes it (401-gated); `/analytics` renders it with tiny B&W bar/sparkline visuals.

**Tech Stack:** Drizzle/node-postgres (SQL aggregation), Nuxt 4 + Nuxt UI, Bun.

## Global Constraints
- Bun only; never `any`. TDD the query. Conventional Commits + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Reuse `getDb`/`getAuthSession`. Read-only — no writes.
- Minimal monochrome UI; no chart dependency (inline `<div>`/SVG bars, grayscale, labels over legends, tabular figures).

---

## Task 1: `getAnalytics` + `/api/analytics`

**Files:** `server/db/queries/analytics.ts` + `analytics.test.ts`; `server/api/analytics/index.get.ts`.

**Interfaces:**
- `type Analytics = {`
  - `todos: { open: number; done: number; dropped: number; completionRate: number };`
  - `scheduling: { scheduled: number; unscheduled: number };`
  - `byProject: Array<{ project: string; color: string; todos: number; events: number }>;`
  - `dumpsPerDay: Array<{ day: string; count: number }>;  // last 14 days, oldest→newest, zero-filled`
  - `captureByHour: Array<{ hour: number; count: number }>; // 0..23, zero-filled`
  - `streakDays: number; // consecutive days up to today with >=1 dump`
  - `}`
- `getAnalytics(db: Db, now: Date): Promise<Analytics>`.

- [ ] **Step 1: Failing test** (`analytics.test.ts`, real DB): seed projects + a mix of todos (open/done/dropped, scheduled/unscheduled, across projects) + events + dumps (a couple today, one yesterday). Assert: `todos.done`/`open` counts; `completionRate` = done/(open+done+dropped) rounded; `scheduling.scheduled/unscheduled`; `byProject` includes the seeded projects with correct todo/event counts; `dumpsPerDay` has length 14 with the right counts on the right days; `captureByHour` length 24; `streakDays` ≥ 1. Use deterministic `now`.

- [ ] **Step 2-4:** Run → fail; implement `getAnalytics` (Drizzle `count()`/`groupBy`/`sql` date_trunc + hour extraction; zero-fill the 14-day and 24-hour series in TS; streak = walk back from today counting days with ≥1 dump); Run → pass. Implement `/api/analytics/index.get.ts` (401-gate, `getDb()`, return `getAnalytics(getDb(), new Date())`).

- [ ] **Step 5:** Full `bun test`; typecheck 0. Commit `feat: analytics query + /api/analytics`.

---

## Task 2: Analytics dashboard UI

**Files:** `app/pages/analytics.vue`; a link from `index.vue`.

- [ ] A monochrome dashboard consuming `/api/analytics` (`useFetch`):
  - Headline stats (tabular figures): completion rate, open/done counts, scheduled vs unscheduled, current streak.
  - `dumpsPerDay`: a 14-bar sparkline (CSS height bars, neutral fill).
  - `captureByHour`: a 24-bar mini histogram.
  - `byProject`: a small table (project label + thin color tick + todo/event counts).
  - Minimal B&W (hairline borders, generous whitespace, no shadows/gradients), a11y (labels, contrast, reduced-motion). Empty-state text when no data.
- [ ] Typecheck 0; full suite green. Commit `feat: minimal monochrome analytics dashboard`.

---

## Self-Review
- Usage stats from existing tables (spec §2 analytics) → Task 1. ✓
- Minimal monochrome rendering, no chart lib (spec §7) → Task 2. ✓
- Read-only, 401-gated. ✓ TDD on the aggregation. ✓
