import { defineEventHandler, createError, readBody } from "h3";
import { getDb } from "../db/client";
import { getAuthSession } from "../utils/session";
import { makeModel } from "../ai/model";
import { extractFromDump } from "../ai/extract";
import { extractMemories } from "../ai/memory-extract";

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

  return { ...extractResult, memoriesSaved };
});
