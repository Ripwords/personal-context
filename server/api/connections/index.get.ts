import { defineEventHandler, createError } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { getGoogleConnections } from "../../auth/google-credentials";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });
  const db = getDb();
  const conns = await getGoogleConnections(db);
  return conns.map((c) => ({
    accountId: c.accountId,
    role: c.role,
    braindumpCalendarId: c.braindumpCalendarId,
  }));
});
