import { defineEventHandler, getQuery, createError } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { getGoogleConnections } from "../../auth/google-credentials";
import { getFreshAccessToken } from "../../calendar-sync/access-token";
import { syncAllCalendars } from "../../calendar-sync/sync-events";
import { makeGoogleTokenRefresher, makeGoogleEventsApi, makeGoogleCalendarListApi } from "../../calendar-sync/google-rest";
import { getCalendarFeed } from "../../db/queries/calendar-feed";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const q = getQuery(event);
  const from = new Date(String(q.from));
  const to = new Date(String(q.to));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw createError({ statusCode: 400, statusMessage: "invalid from/to" });
  }

  const db = getDb();
  const refresh = makeGoogleTokenRefresher(
    process.env.GOOGLE_CLIENT_ID ?? "",
    process.env.GOOGLE_CLIENT_SECRET ?? "",
  );
  const api = makeGoogleEventsApi();
  const calListApi = makeGoogleCalendarListApi();

  for (const conn of await getGoogleConnections(db)) {
    try {
      const accessToken = await getFreshAccessToken(conn, Date.now(), refresh);
      await syncAllCalendars(db, conn, accessToken, calListApi, api, from, to);
    } catch (err) {
      // One bad account shouldn't blank the whole calendar; log and continue.
      console.error(`sync failed for account ${conn.accountId}:`, err);
    }
  }
  return getCalendarFeed(db, from, to);
});
