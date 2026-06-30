import type { Db } from "../db/client";
import { getGoogleConnections } from "../auth/google-credentials";
import { getFreshAccessToken } from "./access-token";
import { syncAllCalendars } from "./sync-events";
import {
  makeGoogleTokenRefresher,
  makeGoogleEventsApi,
  makeGoogleCalendarListApi,
} from "./google-rest";

/**
 * Sync every connected Google account's calendars into the local DB for the
 * [from, to) window. Best-effort per account — one bad account is logged and
 * skipped so it never blanks the whole calendar. Decoupled from the feed read so
 * scrolling paints instantly from the DB while this runs in the background.
 */
export async function syncConnectionsInRange(
  db: Db,
  env: Record<string, string | undefined>,
  from: Date,
  to: Date,
): Promise<void> {
  const refresh = makeGoogleTokenRefresher(
    env.GOOGLE_CLIENT_ID ?? "",
    env.GOOGLE_CLIENT_SECRET ?? "",
  );
  const api = makeGoogleEventsApi();
  const calListApi = makeGoogleCalendarListApi();

  for (const conn of await getGoogleConnections(db)) {
    try {
      const accessToken = await getFreshAccessToken(conn, Date.now(), refresh);
      await syncAllCalendars(db, conn, accessToken, calListApi, api, from, to);
    } catch (err) {
      console.error(`sync failed for account ${conn.accountId}:`, err);
    }
  }
}
