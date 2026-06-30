import { defineEventHandler, createError, getQuery } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { getAnalytics } from "../../db/queries/analytics";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  // Client passes its IANA zone (?tz=America/New_York) so day/hour buckets are
  // local. Validate against the runtime's zone list; fall back to UTC.
  const tzParam = getQuery(event).tz;
  let timeZone = "UTC";
  if (typeof tzParam === "string" && tzParam) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: tzParam });
      timeZone = tzParam;
    } catch {
      // invalid zone → keep UTC
    }
  }

  return getAnalytics(getDb(), new Date(), timeZone);
});
