import { defineEventHandler, createError, readBody } from "h3";
import { z } from "zod";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { applyWindDownSchedule, blocksSchema } from "../../ai/winddown";

const applyBodySchema = z.object({ blocks: blocksSchema });

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const raw = await readBody<unknown>(event);
  const parsed = applyBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "invalid body" });
  }

  const scheduled = await applyWindDownSchedule(getDb(), parsed.data.blocks);
  return { scheduled };
});
