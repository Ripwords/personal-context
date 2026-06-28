// server/db/client.ts
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import * as schema from "./schema";

export function makeDb(url: string) {
  const host = new URL(url).hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    const client = postgres(url);
    return drizzlePg(client, { schema });
  }
  const sql = neon(url);
  return drizzleNeon(sql, { schema });
}

export type Db = ReturnType<typeof makeDb>;
