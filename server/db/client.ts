// server/db/client.ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { parseEnv } from "../utils/env";

export function makeDb(url: string): NodePgDatabase<typeof schema> {
  // allowExitOnIdle lets `bun test` exit without hanging on idle pool sockets.
  const pool = new Pool({ connectionString: url, allowExitOnIdle: true });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof makeDb>;

/** Union of the top-level Db and a drizzle transaction object — lets query
 *  helpers be called both at the top level and inside db.transaction() without
 *  a `tx as Db` cast. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

let _db: Db | undefined;
export function getDb(): Db {
  if (!_db) _db = makeDb(parseEnv(process.env).databaseUrl);
  return _db;
}
