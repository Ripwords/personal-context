// server/calendar-sync/braindump-calendar.test.ts
import { test, expect, beforeEach } from "bun:test";
import { sql } from "drizzle-orm";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { setConnectionRole } from "../auth/connections";
import { getGoogleConnections } from "../auth/google-credentials";
import { ensureBraindumpCalendar } from "./braindump-calendar";

const db = getTestDb();

beforeEach(async () => {
  await truncateAll(db);
  await db.execute(
    sql`INSERT INTO "user" (id, name, email, email_verified) VALUES ('u1','Test User','test@example.com', false)`,
  );
  await db.execute(sql`INSERT INTO "account" (id, account_id, provider_id, user_id, access_token, refresh_token)
    VALUES ('acc1','g1','google','u1','at_1','rt_1')`);
  await setConnectionRole(db, "acc1", "personal");
});

test("reuses an existing 'Braindump' calendar (by name) instead of creating a duplicate", async () => {
  let inserts = 0;
  const api = {
    insert: async ({ summary }: { summary: string }) => { inserts++; return { id: "cal_new" }; },
    list: async () => [
      { id: "primary", summary: "Me" },
      { id: "cal_existing", summary: "Braindump" },
    ],
  };

  const [conn] = await getGoogleConnections(db); // no stored braindumpCalendarId yet
  const id = await ensureBraindumpCalendar(db, conn!, api);
  expect(id).toBe("cal_existing"); // found the existing one
  expect(inserts).toBe(0); // did NOT create a duplicate

  const [conn2] = await getGoogleConnections(db); // id is now persisted
  expect(conn2!.braindumpCalendarId).toBe("cal_existing");
});

test("creates the calendar once, then reuses the stored id", async () => {
  let inserts = 0;
  const api = { insert: async ({ summary }: { summary: string }) => { inserts++; return { id: "cal_new" }; } };

  const [conn] = await getGoogleConnections(db);
  const id1 = await ensureBraindumpCalendar(db, conn!, api);
  expect(id1).toBe("cal_new");
  expect(inserts).toBe(1);

  const [conn2] = await getGoogleConnections(db); // now has braindumpCalendarId
  const id2 = await ensureBraindumpCalendar(db, conn2!, api);
  expect(id2).toBe("cal_new");
  expect(inserts).toBe(1); // not created again
});
