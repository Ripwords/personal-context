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
