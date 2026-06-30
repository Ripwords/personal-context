import { defineEventHandler, createError, getRouterParam, readBody } from "h3";
import { z } from "zod";
import { getDb } from "../../../db/client";
import { getAuthSession } from "../../../utils/session";
import { updateTodoSchedule } from "../../../db/queries/items";
import { mirrorEventsToBraindump } from "../../../calendar-sync/braindump-sync";

const bodySchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  timeZone: z.string().optional(),
});

const DEFAULT_DURATION_MS = 30 * 60_000;

/**
 * Schedule a todo as a calendar time-block (drag-to-schedule). Sets
 * scheduledStart/scheduledEnd and mirrors the block to the Braindump Google
 * calendar (best-effort). Defaults to a 30-minute block when no end is given.
 */
export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const parsed = bodySchema.safeParse(await readBody<unknown>(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "invalid body" });

  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = parsed.data.endsAt
    ? new Date(parsed.data.endsAt)
    : new Date(startsAt.getTime() + DEFAULT_DURATION_MS);
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw createError({ statusCode: 400, statusMessage: "endsAt must be after startsAt" });
  }

  const db = getDb();
  const row = await updateTodoSchedule(db, id, { scheduledStart: startsAt, scheduledEnd: endsAt });
  if (!row) throw createError({ statusCode: 404, statusMessage: "todo not found" });

  let writtenToGoogle = 0;
  let needsReauth = false;
  try {
    const res = await mirrorEventsToBraindump(
      db,
      [{ kind: "todo", id: row.id, title: row.title, startsAt, endsAt }],
      process.env,
      parsed.data.timeZone,
    );
    writtenToGoogle = res.written;
    needsReauth = res.needsReauth;
  } catch (err) {
    console.error("schedule Google sync failed (non-fatal):", err);
  }

  return { scheduled: true, writtenToGoogle, needsReauth };
});
