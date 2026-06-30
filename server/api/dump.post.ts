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

  const db = getDb();
  const refresh = makeGoogleTokenRefresher(
    process.env.GOOGLE_CLIENT_ID ?? "",
    process.env.GOOGLE_CLIENT_SECRET ?? "",
  );
  let connsPromise: ReturnType<typeof getGoogleConnections> | null = null;
  const connsForMutation = () => (connsPromise ??= getGoogleConnections(db));
  const tokenCache = new Map<string, Promise<string>>();
  const tokenFor = (accountId: string) => {
    let p = tokenCache.get(accountId);
    if (!p) {
      p = (async () => {
        const conns = await connsForMutation();
        const conn = conns.find((c) => c.accountId === accountId);
        if (!conn) throw new Error(`no connection for ${accountId}`);
        return getFreshAccessToken(conn, Date.now(), refresh);
      })();
      tokenCache.set(accountId, p);
    }
    return p;
  };
  const deleteFromGoogle = async (input: { accountId: string; calendarId: string; eventId: string }) => {
    const at = await tokenFor(input.accountId);
    await makeGoogleEventDeleteApi(at).remove({ calendarId: input.calendarId, eventId: input.eventId });
  };
  const updateInGoogle = async (input: {
    accountId: string; calendarId: string; eventId: string; title?: string; startsAt?: Date; endsAt?: Date;
  }) => {
    const at = await tokenFor(input.accountId);
    await makeGoogleEventPatchApi(at).patch({
      calendarId: input.calendarId,
      eventId: input.eventId,
      summary: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timeZone: body.timeZone,
    });
  };

  let extractResult: Awaited<ReturnType<typeof extractFromDump>>;
  try {
    extractResult = await extractFromDump(db, makeModel(), body.text, body.timeZone, {
      deleteFromGoogle,
      updateInGoogle,
    });
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
    const writebackItems = await resolveWritebackItems(db, extractResult.created);
    const hasGoogleWork = writebackItems.length > 0;

    if (hasGoogleWork) {
      const conns = await connsForMutation();

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
    }
  } catch (error) {
    console.error("braindump Google sync failed (non-fatal):", error);
  }

  return { ...extractResult, memoriesSaved, writtenToGoogle, needsReauth, removedCount, updatedCount };
});
