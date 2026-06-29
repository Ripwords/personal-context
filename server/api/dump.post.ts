import { defineEventHandler, createError, readBody } from "h3";
import { getDb } from "../db/client";
import { getAuthSession } from "../utils/session";
import { makeModel } from "../ai/model";
import { extractFromDump } from "../ai/extract";
import { extractMemories } from "../ai/memory-extract";
import { getGoogleConnections } from "../auth/google-credentials";
import { getFreshAccessToken } from "../calendar-sync/access-token";
import { makeGoogleTokenRefresher, makeGoogleCalendarApi, makeGoogleEventWriteApi } from "../calendar-sync/google-rest";
import { resolveWritebackItems, writeBraindumpItems } from "../calendar-sync/writeback";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  interface DumpRequest {
    text?: string;
    timeZone?: string;
  }

  const body = await readBody<DumpRequest>(event);

  if (!body.text || typeof body.text !== "string" || body.text.trim() === "") {
    throw createError({ statusCode: 400, statusMessage: "text is required and must be non-empty" });
  }

  let extractResult: Awaited<ReturnType<typeof extractFromDump>>;
  try {
    extractResult = await extractFromDump(getDb(), makeModel(), body.text, body.timeZone);
  } catch (error) {
    console.error("extraction failed:", error);
    throw createError({ statusCode: 502, statusMessage: "extraction failed" });
  }

  let memoriesSaved = 0;
  try {
    memoriesSaved = await extractMemories(getDb(), makeModel(), body.text);
  } catch (error) {
    console.error("memory extraction failed (non-fatal):", error);
  }

  // Mirror AI-created events + scheduled todos to the user's dedicated "Braindump"
  // Google calendar so they appear in Google/other clients. Best-effort: never
  // fail the dump if Google is unreachable. `needsReauth` lets the UI prompt a
  // re-sign-in when the calendar scope is missing.
  let writtenToGoogle = 0;
  let needsReauth = false;
  try {
    const db = getDb();
    const items = await resolveWritebackItems(db, extractResult.created);
    if (items.length > 0) {
      const conns = await getGoogleConnections(db);
      // Braindump items are personal — prefer the personal-role account.
      const target = conns.find((c) => c.role === "personal") ?? conns[0];
      if (target) {
        const refresh = makeGoogleTokenRefresher(
          process.env.GOOGLE_CLIENT_ID ?? "",
          process.env.GOOGLE_CLIENT_SECRET ?? "",
        );
        const accessToken = await getFreshAccessToken(target, Date.now(), refresh);
        const res = await writeBraindumpItems(
          db,
          target,
          makeGoogleCalendarApi(accessToken),
          makeGoogleEventWriteApi(accessToken),
          items,
          body.timeZone,
        );
        writtenToGoogle = res.written;
        needsReauth = res.needsReauth;
      }
    }
  } catch (error) {
    console.error("braindump Google write-back failed (non-fatal):", error);
  }

  return { ...extractResult, memoriesSaved, writtenToGoogle, needsReauth };
});
