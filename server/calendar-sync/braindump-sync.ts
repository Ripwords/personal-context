import { type Db } from "../db/client";
import { getGoogleConnections } from "../auth/google-credentials";
import { getFreshAccessToken } from "./access-token";
import {
  makeGoogleTokenRefresher,
  makeGoogleCalendarApi,
  makeGoogleEventWriteApi,
} from "./google-rest";
import { writeBraindumpItems, type WritebackItem, type WritebackResult } from "./writeback";

/**
 * Mirror created events to the user's "Braindump" Google calendar (the personal
 * account, else the first connection). Encapsulates connection resolution +
 * token refresh so callers (dump, wind-down, …) don't each re-wire it.
 *
 * Best-effort and self-contained: returns `{ written, needsReauth }` and no-ops
 * (written: 0) when there are no items or no Google connection.
 */
export async function mirrorEventsToBraindump(
  db: Db,
  items: WritebackItem[],
  env: Record<string, string | undefined>,
  timeZone?: string,
): Promise<WritebackResult> {
  if (items.length === 0) return { written: 0, needsReauth: false };

  const conns = await getGoogleConnections(db);
  const target = conns.find((c) => c.role === "personal") ?? conns[0];
  if (!target) return { written: 0, needsReauth: false };

  const refresh = makeGoogleTokenRefresher(
    env.GOOGLE_CLIENT_ID ?? "",
    env.GOOGLE_CLIENT_SECRET ?? "",
  );
  const accessToken = await getFreshAccessToken(target, Date.now(), refresh);

  return writeBraindumpItems(
    db,
    target,
    makeGoogleCalendarApi(accessToken),
    makeGoogleEventWriteApi(accessToken),
    items,
    timeZone,
  );
}
