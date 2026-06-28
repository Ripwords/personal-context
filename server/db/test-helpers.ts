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
    sql`TRUNCATE TABLE memory, google_connections, activities, events, todos, dumps, projects, account, session, verification, "user" RESTART IDENTITY CASCADE`,
  );
}
