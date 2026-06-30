import { test, expect, beforeEach } from "bun:test";
import { getTestDb, truncateAll } from "../db/test-helpers";
import { mirrorEventsToBraindump } from "./braindump-sync";
import type { WritebackItem } from "./writeback";

const db = getTestDb();
beforeEach(async () => { await truncateAll(db); });

const item: WritebackItem = {
  kind: "event",
  id: "e1",
  title: "Block",
  startsAt: new Date("2026-07-01T09:00:00Z"),
  endsAt: new Date("2026-07-01T10:00:00Z"),
};

test("mirrorEventsToBraindump no-ops with no items (no Google call, no creds needed)", async () => {
  const res = await mirrorEventsToBraindump(db, [], {});
  expect(res).toEqual({ written: 0, needsReauth: false });
});

test("mirrorEventsToBraindump no-ops when there is no Google connection", async () => {
  // No rows in google_connections → nothing to mirror to.
  const res = await mirrorEventsToBraindump(db, [item], {});
  expect(res).toEqual({ written: 0, needsReauth: false });
});
