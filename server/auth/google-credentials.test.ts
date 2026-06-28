// server/auth/google-credentials.test.ts
import { test, expect, beforeEach } from "bun:test";
import { sql } from "drizzle-orm";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { setConnectionRole } from "./connections";
import { getGoogleConnections } from "./google-credentials";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
  await db.execute(
    sql`INSERT INTO "user" (id, name, email, email_verified) VALUES ('u1','Test User','test@example.com', false)`,
  );
  await db.execute(sql`INSERT INTO "account" (id, account_id, provider_id, user_id, access_token, refresh_token)
    VALUES ('acc1','g1','google','u1','at_1','rt_1')`);
  await setConnectionRole(db, "acc1", "work");
});

test("getGoogleConnections returns tokens, role, and calendar id per google account", async () => {
  const conns = await getGoogleConnections(db);
  expect(conns.length).toBe(1);
  expect(conns[0]!.accessToken).toBe("at_1");
  expect(conns[0]!.refreshToken).toBe("rt_1");
  expect(conns[0]!.role).toBe("work");
  expect(conns[0]!.braindumpCalendarId).toBeNull();
});
