import { defineEventHandler, getQuery, createError } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { syncConnectionsInRange } from "../../calendar-sync/sync-range";

/**
 * Sync Google calendars into the local DB for [from, to). Called by the client
 * in the background after it has already painted the cached feed, so the network
 * round-trip never blocks rendering. Returns once the window is synced; the
 * client then re-reads the feed to pick up changes.
 */
export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const q = getQuery(event);
  const from = new Date(String(q.from));
  const to = new Date(String(q.to));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw createError({ statusCode: 400, statusMessage: "invalid from/to" });
  }

  await syncConnectionsInRange(getDb(), process.env, from, to);
  return { synced: true };
});
