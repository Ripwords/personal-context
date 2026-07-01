# Braindump

Braindump is a chaos-friendly personal productivity app for someone who struggles with rigid todo lists and fixed schedules. You dump everything freely throughout the day — mixed thoughts, tasks, half-formed plans — and AI (DeepSeek by default, Anthropic-swappable) turns that mess into a structured todo list and proposed calendar events, synced to your Google calendars. An end-of-day wind-down pass dedupes and groups the day's output into a clean tomorrow schedule. Nothing the AI does is irreversible: every auto-action is logged, visible, and undoable.

**Features:**
- **AI brain-dump extraction** — free-form text → typed todos and events via tool-calling (DeepSeek default, Anthropic-swappable); auto-tagged to projects; auto-created then immediately undoable
- **Project tagging** — classifier assigns items to Work, Part-time, Freelance, Hackathon, or Personal; low-confidence items flagged for one-tap correction
- **Two Google Calendar accounts** — personal + work, linked via OAuth account-linking; read events from both; AI events written to a dedicated "Braindump" calendar
- **Activity feed + undo** — every AI action is logged; one-tap undo from the feed
- **End-of-day wind-down** — dedupes and groups the day into a simplified todo list + proposed tomorrow schedule; approve to push blocks to calendar
- **Analytics dashboard** — read-only usage stats: dumps/day, todos created vs. completed, completion rate, scheduled vs. unscheduled ratio, per-project breakdown, time-of-day capture patterns, streaks
- **Background memory + memory manager** — after each dump/chat turn, a background pass extracts durable facts into a `memory` table; relevant memories are recalled into future context; CRUD over memories in the Memory Manager page
- **Document RAG** — upload documents → chunk → embed → vector search → injected context in chat via the `search_documents` tool
- **Conversational chat with tools** — `create_todo`, `create_event`, `search_memory`, `search_documents`, `web_search`, `read_calendar` available in chat

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend / SSR | Nuxt 4 + Nuxt UI v4, Tailwind, Vercel AI SDK Vue bindings |
| Server | Nitro (Nuxt server routes under `server/api/`) |
| Auth | Better Auth — Google social provider + account-linking for the 2nd Google account |
| Database | Self-hosted Postgres 16 (Docker); Drizzle ORM via `drizzle-orm/node-postgres` (pg Pool); programmatic migrator (`server/db/migrate.ts`) |
| AI | Vercel AI SDK — configurable provider, `deepseek-chat` default; swappable to Anthropic `claude-sonnet-4-6` / `claude-opus-4-8` via `LLM_PROVIDER` env |
| Memory / RAG | Postgres full-text search (current); pgvector + Ollama planned (see Known Follow-ups) |
| UI direction | Minimal, monochrome, low-chrome — near-black on near-white; projects distinguished by label + tonal layering, not hue |

The `ai/` module is the only place that touches the AI provider. It outputs validated tool-call payloads; `server/db/` inserts them; `calendar-sync/` handles Google writes. The AI never touches the database or Google APIs directly.

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Docker](https://docs.docker.com/get-docker/) (for Postgres)
- A Google Cloud project with the Calendar API enabled and an OAuth 2.0 Web client (see setup below)
- A DeepSeek API key — or an Anthropic API key if you set `LLM_PROVIDER=anthropic`

---

## Environment Variables

Copy the example file and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `POSTGRES_USER` | Postgres username (used by Docker Compose to create the DB) |
| `POSTGRES_PASSWORD` | Postgres password |
| `POSTGRES_DB` | Postgres database name |
| `POSTGRES_PORT` | Host port for the Postgres container (default `5432`) |
| `POSTGRES_BIND` | Host interface for Postgres in `docker-compose.prod.yml` (default `127.0.0.1`; keep private) |
| `APP_BIND` | Host interface for the app in `docker-compose.prod.yml` (`0.0.0.0` for direct public access, `127.0.0.1` behind a reverse proxy) |
| `APP_PORT` | Host port for the Nuxt app container (default `3000`) |
| `OLLAMA_BIND` / `OLLAMA_PORT` | Host interface/port for the optional Ollama embeddings profile (default `127.0.0.1:11434`) |
| `APP_OLLAMA_URL` | Ollama URL used inside `docker-compose.prod.yml` app container (default `http://ollama:11434`) |
| `COMPOSE_PROJECT_NAME` | Docker Compose project/volume prefix (default `braindump`) |
| `IMAGE_REGISTRY` / `IMAGE_TAG` | Optional image names for production builds/pushes (default `braindump/*:latest`) |
| `DATABASE_URL` | Full Postgres connection URL for the app and migrator |
| `TEST_DATABASE_URL` | Postgres connection URL for the test suite (points at the local test container on port 5434) |
| `BETTER_AUTH_SECRET` | Secret key for Better Auth sessions — generate with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Public base URL of the app (e.g. `http://localhost:3000` locally or `https://brain.example.com` in production) |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `LLM_PROVIDER` | AI provider: `deepseek` (default) or `anthropic` |
| `DEEPSEEK_API_KEY` | DeepSeek API key (required when `LLM_PROVIDER=deepseek`) |
| `ANTHROPIC_API_KEY` | Anthropic API key (required when `LLM_PROVIDER=anthropic`) |

---

## Google OAuth Setup

Both Google accounts (personal + work) connect through a single OAuth client. The second account is linked after sign-in using the Connections page — it is not a second app login.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project (or select an existing one).

2. **Enable the Google Calendar API:**
   - APIs & Services → Library → search "Google Calendar API" → Enable.

3. **Configure the OAuth consent screen:**
   - APIs & Services → OAuth consent screen → User Type: **External** → Create.
   - Fill in app name and your email for developer contact.
   - Scopes: add `https://www.googleapis.com/auth/calendar` (full Calendar access). The app needs this to **create** the dedicated "Braindump" calendar (used to write AI events back); the narrower `calendar.events` scope cannot create a calendar — Google returns a 403. If you previously consented with a narrower scope, you'll be prompted to re-consent.
   - **Test users:** add both your personal Gmail address and your work address. (While the app is in "Testing" mode, only listed test users can sign in.)

4. **Create an OAuth client:**
   - APIs & Services → Credentials → Create Credentials → OAuth client ID.
   - Application type: **Web application**.
   - Authorized redirect URIs: add `http://localhost:3000/api/auth/callback/google` (and your production URL if self-hosting remotely).
   - Copy the **Client ID** and **Client Secret** into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

5. **Generate the auth secret:**
   ```bash
   openssl rand -base64 32
   ```
   Paste the output into `.env` as `BETTER_AUTH_SECRET`.

6. **Link the work account:** after signing in with your personal Google account, go to the **Connections** page in the app and add your work account. From there you can assign each connection a `personal` or `work` role.

---

## Local Development

### 1. Start Postgres

The test suite uses a dedicated container on port 5434:

```bash
docker run -d \
  --name braindump-test-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=braindump_test \
  -p 5434:5432 \
  postgres:16-alpine
```

For the dev database (used by `bun run dev`), start a second container matching your `.env` values:

```bash
docker run -d \
  --name braindump-dev-pg \
  -e POSTGRES_USER=braindump \
  -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=braindump \
  -p 5432:5432 \
  postgres:16-alpine
```

### 2. Configure `.env`

Ensure `DATABASE_URL` points at the dev container and `TEST_DATABASE_URL` at the test container:

```
DATABASE_URL=postgresql://braindump:change-me@localhost:5432/braindump
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/braindump_test
```

### 3. Install, migrate, run

```bash
bun install
bun run db:migrate   # applies Drizzle migrations via server/db/migrate.ts
bun run dev          # starts Nuxt dev server at http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) and sign in with Google.

---

## Self-Hosted (Docker Compose)

The compose stack runs three services: `postgres` (Postgres 16), `drizzle-migrate` (one-shot migrator), and `app` (Nitro production bundle). The app waits for migrations to complete before starting.

### Local / simple self-hosting

```bash
cp .env.example .env
# edit .env — fill in POSTGRES_PASSWORD, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID,
# GOOGLE_CLIENT_SECRET, and at least one of DEEPSEEK_API_KEY / ANTHROPIC_API_KEY

docker compose up -d --build
```

The app is then available at `http://localhost:${APP_PORT}` (default 3000).

### Production self-hosting

Use `docker-compose.prod.yml` for a long-running host. It adds restart policies,
loopback-only Postgres/Ollama binds, app healthchecks, and log rotation.

```bash
cp .env.example .env
openssl rand -base64 32  # paste into BETTER_AUTH_SECRET
```

Edit `.env`:

```dotenv
# Required production values
POSTGRES_PASSWORD=<strong-db-password>
BETTER_AUTH_SECRET=<openssl-output>
BETTER_AUTH_URL=https://brain.example.com
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=<deepseek-key>

# Port/bind options
APP_PORT=3000
APP_BIND=127.0.0.1      # recommended behind nginx/Caddy/Traefik
POSTGRES_BIND=127.0.0.1 # keep private
POSTGRES_PORT=5432
```

Start the production stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

If you are not using a reverse proxy, expose the app directly instead:

```dotenv
APP_BIND=0.0.0.0
APP_PORT=3000
BETTER_AUTH_URL=http://YOUR_SERVER_IP:3000
```

For HTTPS, put a reverse proxy in front of the app and keep `APP_BIND=127.0.0.1`.
Your Google OAuth client must include this redirect URI:

```text
https://brain.example.com/api/auth/callback/google
```

Operations:

```bash
# View logs
docker compose -f docker-compose.prod.yml logs -f app

# Update after pulling new code
docker compose -f docker-compose.prod.yml up -d --build

# Stop while keeping data
docker compose -f docker-compose.prod.yml down

# Backup Postgres
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > braindump-backup.sql
```

Optional embeddings/RAG:

```bash
# In .env:
# EMBEDDINGS_ENABLED=1
# APP_OLLAMA_URL=http://ollama:11434

EMBEDDINGS_ENABLED=1 docker compose -f docker-compose.prod.yml --profile embeddings up -d --build
docker compose -f docker-compose.prod.yml exec ollama ollama pull nomic-embed-text
```

### Build locally, ship to a slow server

If the target server is slow (or has little RAM), don't build on it. Build the
images on your machine, save them to a tarball, transfer, and `docker load` on
the server — then bring the stack up with `--no-build`.

Two scripts package images for `linux/amd64` (Apple Silicon → x86 Ubuntu) and
print the exact transfer/load commands:

```bash
# app + migrator (use when DB migrations changed)
./scripts/build-images.sh

# app only (faster; use when only app code changed)
./scripts/build-app-image.sh
```

The output tarballs land in `dist/`. Override image names/arch to match the
server's `.env`:

```bash
IMAGE_REGISTRY=braindump IMAGE_TAG=latest PLATFORM=linux/amd64 ./scripts/build-images.sh
```

Implementation detail: the scripts run `bun run build` **natively** first, then
package the already-built `.output` bundle into a thin target-platform image via
`Dockerfile.ship`. This avoids running the Bun/Nuxt bundler under QEMU during
Apple-Silicon → amd64 cross-builds.

Then, following the printed instructions (replace `user@server`):

```bash
# transfer + load in one stream (no temp file on the server)
gunzip -c dist/braindump-images.tar.gz | ssh -t user@server 'sudo docker load'

# on the server — recreate WITHOUT building
ssh user@server
cd ~/personal-context && git pull --ff-only    # refresh compose + .env
sudo docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate
```

The server only ever pulls `postgres` (and optionally `ollama`); the app and
migrator images come from your tarball. `IMAGE_REGISTRY`/`IMAGE_TAG` in the
server's `.env` must match the tags you built with.

Postgres data persists in the `pgdata` named volume. To stop:

```bash
docker compose down           # keeps data
docker compose down -v        # also removes the pgdata volume
```

---

## Tests

Run the full test suite (requires `TEST_DATABASE_URL` pointing at a Postgres instance with migrations applied):

```bash
bun test
```

### Smoke scripts

The `scripts/` directory contains one-off smoke scripts for manual integration testing. Each requires `TEST_DATABASE_URL` and `DEEPSEEK_API_KEY` (or `ANTHROPIC_API_KEY` with `LLM_PROVIDER=anthropic`) in your environment.

```bash
bun scripts/smoke-dump.ts       # dump submission + AI extraction
bun scripts/smoke-winddown.ts   # end-of-day wind-down summary
bun scripts/smoke-memory.ts     # background memory extraction + recall
bun scripts/smoke-rag.ts        # document upload → chunk → embed → search
bun scripts/smoke-chat.ts       # chat with tools
```

---

## Google Calendar sync contract

Two-way sync is governed by an explicit per-path contract:

| Path | Local → Google | Google → Local |
| --- | --- | --- |
| **create** (chat/dump/wind-down) | Mirrored to the "Braindump" calendar; the Google id is stored back on the row. | — |
| **update** (chat/dump edit, drag) | Patched on Google; `updatedAt` is stamped locally. | Applied **only if** Google's `updated` is newer than the row's `updatedAt` (last-write-wins). |
| **delete** | Deleted on Google (best-effort). | Reconciled: synced rows no longer present in Google's window are removed. |
| **undo** | Best-effort delete of the Google copy; UI warns if it fails (`googleSync`). | — |
| **complete** | Todo-only; not a calendar concept, no Google call. | — |

**Conflict policy — last-write-wins by timestamp.** Each synced event carries
`updatedAt` (its last local-or-applied modification) and `googleUpdatedAt`
(Google's `updated` at last sync). A background sync overwrites a row only when
Google's change is strictly newer than `updatedAt`, so a just-made local edit is
never clobbered by a stale sync; a genuinely newer Google edit still wins. The
"Braindump" calendar is deletion-only on re-import (its events originate locally),
so it is never re-clobbered by sync.

## Known Follow-ups / Upgrade Paths

- **Semantic memory/RAG via pgvector + Ollama** — implemented as an opt-in path. Set `EMBEDDINGS_ENABLED=1`, run the `ollama` compose profile (`docker compose --profile embeddings up`, then `ollama pull nomic-embed-text`), and apply `drizzle/optional/pgvector.sql`. Memories and document chunks are then embedded and recall becomes hybrid (vector KNN + FTS). Left off, recall is pure Postgres full-text search (the zero-config default, also used in tests).
- **S3 object storage** — implemented. Set `S3_BUCKET` + `S3_ENDPOINT` + `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` to store document originals in any S3-compatible store (garage, MinIO, AWS). Without them, uploads fall back to the local `./uploads` dir (mounted as a Docker volume for durability).
- **Drag-to-schedule** — Plan 6 in the roadmap. Google Calendar write-back for AI-created/edited events is implemented (events created in chat or brain-dump mirror to the "Braindump" calendar, and deletes/edits propagate). The remaining gap is the drag-to-schedule interaction on the unscheduled-todo rail.
- **Project-tagging correction UI + keyword classifier** — Plan 5. Basic model-based tagging works, but the one-tap correction UI and keyword-biased classifier confidence flagging are not yet built.
- **Local-timezone display** — some views currently show times in UTC. Timezone-aware display is a known gap.
- **Web search** — the `web_search` chat tool is wired but requires one of `TAVILY_API_KEY`, `BRAVE_API_KEY`, or a self-hosted SearXNG instance (`SEARXNG_URL`) to return live results. Without one of these, web search calls return no results.
- **FTS recall quality** — the current Postgres full-text search for conversational memory recall is AND-based; multi-word queries match weakly. Upgrading to pgvector semantic search resolves this.
