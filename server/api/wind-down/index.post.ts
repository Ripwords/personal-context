import { defineEventHandler, createError } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { makeModel } from "../../ai/model";
import { summarizeDay } from "../../ai/winddown";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  try {
    return await summarizeDay(getDb(), makeModel(), new Date());
  } catch (error) {
    console.error("[wind-down] model error:", error);
    throw createError({ statusCode: 502, statusMessage: "wind-down failed" });
  }
});
