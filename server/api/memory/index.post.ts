import { defineEventHandler, createError, readBody } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { createMemory } from "../../db/queries/memory";

interface CreateMemoryBody {
  content?: string;
}

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const body = await readBody<CreateMemoryBody>(event);
  if (!body.content || typeof body.content !== "string" || body.content.trim() === "") {
    throw createError({ statusCode: 400, statusMessage: "content is required and must be non-empty" });
  }

  const db = getDb();
  return createMemory(db, { content: body.content.trim(), source: "manual" });
});
