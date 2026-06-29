import { defineEventHandler, createError, getRouterParam } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { getChatMessages } from "../../db/queries/chats";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });
  return getChatMessages(getDb(), id);
});
