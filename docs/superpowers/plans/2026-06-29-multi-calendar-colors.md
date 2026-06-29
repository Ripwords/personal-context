# Multi-calendar sync + per-calendar colors + all-day events — Plan

**Goal:** Show all of the user's Google calendars (not just `primary`) including all-day events, color-coded per calendar with real Google colors, with a Notion-style toggle to show/hide each calendar.

**Why:** Today `sync-events.ts` only reads each account's `primary` calendar, so events in separate calendars (Birthdays, Holidays, etc.) — many of them all-day — never appear. `CalendarWeek` also has no all-day row and colors only by `projectId`.

## Phases

### Phase 1 — Schema + migration
- New table `google_calendar`: `(id uuid pk, accountId text, calendarId text, summary text, backgroundColor text, foregroundColor text, selected boolean default true, primary boolean default false, createdAt)`, unique `(accountId, calendarId)`.
- `events` additions: `calendarId text` (source Google calendar), `allDay boolean not null default false`.
- `bun run db:generate` then `bun run db:migrate`.

### Phase 2 — Google REST + sync
- `google-rest.ts`: add `makeGoogleCalendarListApi()` → `GET /users/me/calendarList` returning `{ id, summary, backgroundColor, foregroundColor, selected, primary }[]`.
- `sync-events.ts`: `normalizeEvent` sets `allDay` (true when `start.date` and no `start.dateTime`) and `calendarId`.
- New `syncAllCalendars(db, conn, accessToken, calListApi, eventsApi, from, to)`: upsert calendar metadata into `google_calendar`; for each `selected` calendar, list+upsert events tagged with `calendarId` + `allDay`.

### Phase 3 — Feed + API
- `getCalendarFeed`: join `events` → `google_calendar` on `(googleAccountId, calendarId)` to attach `color`; only include events whose calendar is `selected`; split returned events into `timedEvents` and `allDayEvents`; include `color` + `allDay`.
- `events.get.ts`: call `syncAllCalendars` per connection.
- New `server/api/calendars/index.get.ts` (list calendars: id, summary, color, selected, accountId) and `server/api/calendars/[id].patch.ts` (toggle `selected`).

### Phase 4 — Render (CalendarWeek)
- Add an **all-day row** under the day header: render `allDayEvents` as horizontal bars per day, colored by calendar color.
- Color timed-event blocks by their calendar `color` (fallback to existing neutral border).

### Phase 5 — Toggle UI
- Left rail: list calendars grouped by account, each with a color dot + checkbox; toggling calls the PATCH and refreshes the feed. Persisted via `google_calendar.selected`.

Each phase ends green (typecheck 0, relevant tests) and is committed.
