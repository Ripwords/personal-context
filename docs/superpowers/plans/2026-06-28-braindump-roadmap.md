# Braindump — Plan Roadmap

The spec (`docs/superpowers/specs/2026-06-28-braindump-design.md`) is delivered as
a sequence of plans. Each plan produces working, testable software on its own and
is expanded to full bite-sized TDD detail when we reach it.

| # | Plan | Deliverable (testable) | Status |
|---|------|------------------------|--------|
| 1 | **Foundation & Data Layer** | Nuxt 4 + Bun scaffold, env validation, Drizzle schema + migrations, seeded projects, fully-tested query helpers | **Written** → `2026-06-28-plan-1-foundation.md` |
| 2 | Auth & Two Google Accounts | Better Auth login, link 2nd Google account, store per-account tokens, create dedicated "Braindump" Google calendar | **Written** → `2026-06-28-plan-2-auth-google.md` |
| 3 | Calendar Read & UI Shell | Read events from both accounts → three-pane app shell, week/day/month views, project color-coding, unscheduled rail | Outlined |
| 4 | AI Live Extraction | Dump chat → configurable provider (DeepSeek default) tool-calls → todos/events, activity feed + undo | Outlined |
| 5 | Smart Project Tagging | Keyword-biased classifier, confidence flagging, one-tap correction UI | Outlined |
| 6 | Drag-to-Schedule & Write-back | Drag unscheduled todos onto timeline, two-way Google sync, conflict handling | Outlined |
| 7 | End-of-Day Wind-down | `summarize_day` → deduped todo list + proposed tomorrow schedule → approve-to-calendar | Outlined |
| 8 | Visual Polish & A11y | UI-direction pass, motion, reduced-motion, contrast/focus checklist, responsive | Outlined |

## Decisions carried from the spec (locked)
- Single user; hosted on Vercel.
- Stack: Nuxt 4, Nuxt UI v4, Tailwind, Better Auth, Neon Postgres, Drizzle, Vercel AI SDK.
- AI provider **configurable, `deepseek-chat` default**; extraction uses a tool-calling-capable chat model only.
- Default projects: **Work, Part-time, Freelance, Hackathon, Personal**.
- Calendar default view: **week**. AI events auto-write to a dedicated **"Braindump"** Google calendar.
- "Auto then undo" everywhere: nothing irreversible; activity feed + undo.
- TDD; Bun as package manager + test runner.

## Outline detail for Plans 2–8

Each will be written in full TDD detail at execution time. Scope notes:

- **Plan 2** — Better Auth Drizzle tables (generated via Better Auth CLI), Google
  provider with `access_type=offline`+`prompt=consent`, account-linking flow for
  the work account, `account.role` (`personal`/`work`), one-time "Braindump"
  calendar creation + stored calendar id. Adds `userId` FK to Plan 1 tables.
  *Includes explicit doc-verification steps for the current Better Auth API.*
- **Plan 3** — `calendar-sync/` read path (`googleapis`, per account, token
  refresh), normalize Google events → `event` rows; Nuxt UI v4 calendar shell +
  views + project rail. *Doc-verify Nuxt UI v4 components.*
- **Plan 4** — `ai/` module: Vercel AI SDK provider factory (DeepSeek default,
  Anthropic swap), `create_todo`/`create_event` tools with Zod schemas, streaming
  into Nuxt UI chat, validation → DB insert → activity; undo. *Doc-verify AI SDK +
  `@ai-sdk/deepseek`.*
- **Plan 5** — `projects/` classifier (pure, keyword/name → `{projectId,
  confidence}`), threshold flagging, correction UI + activity.
- **Plan 6** — drag-to-schedule interaction, set `scheduledStart/End`, write-back
  to the Braindump Google calendar, conflict (last-write-wins) + error surfacing.
- **Plan 7** — end-of-day `summarize_day` (adaptive thinking when on Claude),
  dedupe/group, propose tomorrow blocks, approve → schedule + sync.
- **Plan 8** — visual polish against the UI direction; a11y + responsive pass.
