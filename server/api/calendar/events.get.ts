import { defineEventHandler, getQuery, createError } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { getCalendarFeed } from "../../db/queries/calendar-feed";

/**
 * Read-only calendar feed for [from, to). Returns the cached DB feed instantly —
 * it does NOT call Google, so scrolling the timeline never blocks on the network.
 * Google sync is a separate POST /api/calendar/sync the client fires in the
 * background (stale-while-revalidate).
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

  return getCalendarFeed(getDb(), from, to);
});
