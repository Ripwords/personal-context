import { defineEventHandler, createError, readBody, getRouterParam } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { updateMemory } from "../../db/queries/memory";

interface UpdateMemoryBody {
  content?: string;
}

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const body = await readBody<UpdateMemoryBody>(event);
  if (!body.content || typeof body.content !== "string" || body.content.trim() === "") {
    throw createError({ statusCode: 400, statusMessage: "content is required and must be non-empty" });
  }

  const db = getDb();
  try {
    return await updateMemory(db, id, body.content.trim());
  } catch {
    throw createError({ statusCode: 404, statusMessage: "memory not found" });
  }
});
