import { defineEventHandler, createError } from "h3";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { getGoogleConnections } from "../../auth/google-credentials";
import { getFreshAccessToken } from "../../calendar-sync/access-token";
import { makeGoogleTokenRefresher, makeGoogleUserInfoApi } from "../../calendar-sync/google-rest";
import { googleCalendar } from "../../db/schema";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });
  const db = getDb();
  const conns = await getGoogleConnections(db);

  // Fast path: a Google account's primary calendar id IS its email — free if the
  // calendar has already synced.
  const primaries = await db
    .select({ accountId: googleCalendar.accountId, email: googleCalendar.calendarId })
    .from(googleCalendar)
    .where(eq(googleCalendar.primary, true));
  const emailByAccount = new Map(primaries.map((p) => [p.accountId, p.email]));

  // Fallback: ask Google directly (userinfo) for any account whose calendar
  // hasn't synced yet, so the email shows immediately after sign-in.
  const refresh = makeGoogleTokenRefresher(
    process.env.GOOGLE_CLIENT_ID ?? "",
    process.env.GOOGLE_CLIENT_SECRET ?? "",
  );
  const userInfo = makeGoogleUserInfoApi();
  await Promise.all(
    conns.map(async (c) => {
      if (emailByAccount.has(c.accountId)) return;
      try {
        const at = await getFreshAccessToken(c, Date.now(), refresh);
        const email = await userInfo.email({ accessToken: at });
        if (email) emailByAccount.set(c.accountId, email);
      } catch {
        // best-effort — fall back to the short id label in the UI
      }
    }),
  );

  return conns.map((c) => ({
    accountId: c.accountId,
    email: emailByAccount.get(c.accountId) ?? null,
    role: c.role,
    braindumpCalendarId: c.braindumpCalendarId,
  }));
});
