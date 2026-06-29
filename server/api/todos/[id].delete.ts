import { defineEventHandler, createError, getRouterParam } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { dropTodo } from "../../db/queries/items";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const db = getDb();
  const row = await dropTodo(db, id);
  if (!row) throw createError({ statusCode: 404, statusMessage: "todo not found" });
  return { dropped: true };
});
