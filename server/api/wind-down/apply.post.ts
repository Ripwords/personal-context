import { defineEventHandler, createError, readBody } from "h3";
import { z } from "zod";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { applyWindDownSchedule, blocksSchema } from "../../ai/winddown";
import { mirrorEventsToBraindump } from "../../calendar-sync/braindump-sync";

const applyBodySchema = z.object({ blocks: blocksSchema, timeZone: z.string().optional() });

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const raw = await readBody<unknown>(event);
  const parsed = applyBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "invalid body" });
  }

  const db = getDb();
  const events = await applyWindDownSchedule(db, parsed.data.blocks);

  // Mirror the new time blocks to the user's Braindump Google calendar so they
  // appear in their other calendar apps. Best-effort — never fail the apply.
  let writtenToGoogle = 0;
  let needsReauth = false;
  try {
    const items = events.map((e) => ({
      kind: "event" as const, id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt,
    }));
    const res = await mirrorEventsToBraindump(db, items, process.env, parsed.data.timeZone);
    writtenToGoogle = res.written;
    needsReauth = res.needsReauth;
  } catch (err) {
    console.error("wind-down Google sync failed (non-fatal):", err);
  }

  return { scheduled: events.length, writtenToGoogle, needsReauth };
});
