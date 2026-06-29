import { defineEventHandler, createError, readBody } from "h3";
import { getDb } from "../db/client";
import { getAuthSession } from "../utils/session";
import { makeModel } from "../ai/model";
import { extractFromDump } from "../ai/extract";
import { extractMemories } from "../ai/memory-extract";
import { getGoogleConnections } from "../auth/google-credentials";
import { getFreshAccessToken } from "../calendar-sync/access-token";
import {
  makeGoogleTokenRefresher,
  makeGoogleCalendarApi,
  makeGoogleEventWriteApi,
  makeGoogleEventDeleteApi,
  makeGoogleEventPatchApi,
} from "../calendar-sync/google-rest";
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

  // Mirror changes to Google so the user's other calendar apps stay in sync:
  // new items → Braindump calendar; deletes/edits → the event's own calendar.
  // Best-effort: never fail the dump if Google is unreachable. `needsReauth`
  // prompts a re-sign-in when the calendar scope is missing.
  let writtenToGoogle = 0;
  let needsReauth = false;
  const removedCount = extractResult.deleted.length;
  const updatedCount = extractResult.updated.length;
  try {
    const db = getDb();
    const writebackItems = await resolveWritebackItems(db, extractResult.created);
    const hasGoogleWork =
      writebackItems.length > 0 ||
      extractResult.deleted.some((e) => e.googleEventId) ||
      extractResult.updated.some((e) => e.googleEventId);

    if (hasGoogleWork) {
      const conns = await getGoogleConnections(db);
      const refresh = makeGoogleTokenRefresher(
        process.env.GOOGLE_CLIENT_ID ?? "",
        process.env.GOOGLE_CLIENT_SECRET ?? "",
      );
      const tokenCache = new Map<string, Promise<string>>();
      const tokenFor = (accountId: string) => {
        let p = tokenCache.get(accountId);
        if (!p) {
          const conn = conns.find((c) => c.accountId === accountId);
          p = conn ? getFreshAccessToken(conn, Date.now(), refresh) : Promise.reject(new Error("no connection"));
          tokenCache.set(accountId, p);
        }
        return p;
      };

      // New items → dedicated Braindump calendar (personal account).
      if (writebackItems.length > 0) {
        const target = conns.find((c) => c.role === "personal") ?? conns[0];
        if (target) {
          const at = await tokenFor(target.accountId);
          const res = await writeBraindumpItems(
            db,
            target,
            makeGoogleCalendarApi(at),
            makeGoogleEventWriteApi(at),
            writebackItems,
            body.timeZone,
          );
          writtenToGoogle = res.written;
          needsReauth = res.needsReauth;
        }
      }

      // Removed events → delete from the calendar/account they live in.
      for (const ev of extractResult.deleted) {
        if (!ev.googleEventId || !ev.googleAccountId || !ev.calendarId) continue;
        try {
          const at = await tokenFor(ev.googleAccountId);
          await makeGoogleEventDeleteApi(at).remove({ calendarId: ev.calendarId, eventId: ev.googleEventId });
        } catch (err) {
          console.error(`dump: Google delete failed for ${ev.id}:`, err);
        }
      }

      // Edited events → patch the calendar/account they live in.
      for (const ev of extractResult.updated) {
        if (!ev.googleEventId || !ev.googleAccountId || !ev.calendarId) continue;
        try {
          const at = await tokenFor(ev.googleAccountId);
          await makeGoogleEventPatchApi(at).patch({
            calendarId: ev.calendarId,
            eventId: ev.googleEventId,
            summary: ev.title,
            startsAt: new Date(ev.startsAt),
            endsAt: new Date(ev.endsAt),
            timeZone: body.timeZone,
          });
        } catch (err) {
          console.error(`dump: Google patch failed for ${ev.id}:`, err);
        }
      }
    }
  } catch (error) {
    console.error("braindump Google sync failed (non-fatal):", error);
  }

  return { ...extractResult, memoriesSaved, writtenToGoogle, needsReauth, removedCount, updatedCount };
});
