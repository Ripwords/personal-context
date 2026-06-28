// server/db/client.ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function makeDb(url: string): NodePgDatabase<typeof schema> {
  // allowExitOnIdle lets `bun test` exit without hanging on idle pool sockets.
  const pool = new Pool({ connectionString: url, allowExitOnIdle: true });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof makeDb>;
