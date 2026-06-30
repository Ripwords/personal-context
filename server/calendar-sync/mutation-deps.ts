import type { Db } from "../db/client";
import { getGoogleConnections } from "../auth/google-credentials";
import { getFreshAccessToken } from "./access-token";
import {
  makeGoogleTokenRefresher,
  makeGoogleEventDeleteApi,
  makeGoogleEventPatchApi,
} from "./google-rest";
import type { DeleteFromGoogleFn, UpdateInGoogleFn } from "./mutations";

export interface GoogleMutationDeps {
  /** Resolve a fresh access token for an account, memoised per call-site. */
  tokenFor: (accountId: string) => Promise<string>;
  deleteFromGoogle: DeleteFromGoogleFn;
  updateInGoogle: UpdateInGoogleFn;
}

/**
 * Build the Google calendar mutation closures (delete/patch) plus a memoised
 * per-account token resolver. Shared by the chat, dump and undo routes so the
 * connection + token-refresh plumbing lives in exactly one place.
 */
export function makeGoogleMutationDeps(
  db: Db,
  env: Record<string, string | undefined> = process.env,
  timeZone?: string,
): GoogleMutationDeps {
  const refresh = makeGoogleTokenRefresher(
    env.GOOGLE_CLIENT_ID ?? "",
    env.GOOGLE_CLIENT_SECRET ?? "",
  );
  let connsPromise: ReturnType<typeof getGoogleConnections> | null = null;
  const conns = () => (connsPromise ??= getGoogleConnections(db));
  const tokenCache = new Map<string, Promise<string>>();
  const tokenFor = (accountId: string) => {
    let p = tokenCache.get(accountId);
    if (!p) {
      p = (async () => {
        const all = await conns();
        const conn = all.find((c) => c.accountId === accountId);
        if (!conn) throw new Error(`no connection for ${accountId}`);
        return getFreshAccessToken(conn, Date.now(), refresh);
      })();
      tokenCache.set(accountId, p);
    }
    return p;
  };
  const deleteFromGoogle: DeleteFromGoogleFn = async (input) => {
    const at = await tokenFor(input.accountId);
    await makeGoogleEventDeleteApi(at).remove({ calendarId: input.calendarId, eventId: input.eventId });
  };
  const updateInGoogle: UpdateInGoogleFn = async (input) => {
    const at = await tokenFor(input.accountId);
    await makeGoogleEventPatchApi(at).patch({
      calendarId: input.calendarId,
      eventId: input.eventId,
      summary: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timeZone,
    });
  };
  return { tokenFor, deleteFromGoogle, updateInGoogle };
}
