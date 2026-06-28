// server/calendar-sync/sync-events.test.ts
import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { normalizeEvent, syncConnectionEvents, type EventsApi } from "./sync-events";
import type { GoogleCreds } from "../auth/google-credentials";

const db = getTestDb();
const conn: GoogleCreds = {
  accountId: "acc1", role: "work", accessToken: "at", refreshToken: "rt", braindumpCalendarId: null,
};

beforeEach(async () => { await truncateAll(db); });

test("normalizeEvent maps a timed event", () => {
  const row = normalizeEvent(
    { id: "g1", summary: "Standup", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T09:15:00Z" } },
    "acc1",
  );
  expect(row).not.toBeNull();
  expect(row!.title).toBe("Standup");
  expect(row!.googleEventId).toBe("g1");
  expect(row!.googleAccountId).toBe("acc1");
  expect(row!.syncStatus).toBe("synced");
});

test("normalizeEvent skips events with no start/end", () => {
  expect(normalizeEvent({ id: "g2" }, "acc1")).toBeNull();
});

test("syncConnectionEvents upserts and is idempotent on (account,event) identity", async () => {
  const events = [
    { id: "g1", summary: "Standup", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T09:15:00Z" } },
  ];
  const api: EventsApi = { list: async () => events };
  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-02T00:00:00Z");

  const n1 = await syncConnectionEvents(db, conn, "at", api, from, to);
  expect(n1).toBe(1);
  const n2 = await syncConnectionEvents(db, conn, "at", api, from, to); // same event again
  expect(n2).toBe(1);

  const rows = await db.select().from((await import("../db/schema")).events);
  expect(rows.length).toBe(1); // upsert, not duplicate
  expect(rows[0]!.title).toBe("Standup");
});
