// server/auth/connections.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { sql } from "drizzle-orm";
import { setConnectionRole, setBraindumpCalendarId, listConnections } from "./connections";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
  // seed a fake user row so the account FK is satisfiable
  await db.execute(sql`INSERT INTO "user" (id, name, email, email_verified) VALUES ('u1','Test User','test@example.com',false)`);
  // seed a fake account row so the google_connections FK is satisfiable
  await db.execute(sql`INSERT INTO "account" (id, account_id, provider_id, user_id) VALUES ('acc1','g1','google','u1')`);
});

test("setConnectionRole upserts the role for an account", async () => {
  const c = await setConnectionRole(db, "acc1", "personal");
  expect(c.role).toBe("personal");
  const again = await setConnectionRole(db, "acc1", "work");
  expect(again.role).toBe("work");
  expect((await listConnections(db)).length).toBe(1); // upsert, not duplicate
});

test("setBraindumpCalendarId stores the calendar id", async () => {
  await setConnectionRole(db, "acc1", "personal");
  const c = await setBraindumpCalendarId(db, "acc1", "cal_123");
  expect(c.braindumpCalendarId).toBe("cal_123");
});

test("setBraindumpCalendarId throws when no connection exists", async () => {
  await expect(setBraindumpCalendarId(db, "missing", "cal")).rejects.toThrow(/no google_connections row/i);
});
