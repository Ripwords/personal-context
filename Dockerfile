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
