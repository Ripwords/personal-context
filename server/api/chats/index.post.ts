import { defineEventHandler, createError } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { createChatSession } from "../../db/queries/chats";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });
  const sess = await createChatSession(getDb());
  return { id: sess.id };
});
