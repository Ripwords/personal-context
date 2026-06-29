import { defineEventHandler, createError, getRouterParam, readBody } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { setCalendarSelected } from "../../db/queries/calendars";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const body = (await readBody(event)) as { selected?: unknown };
  if (typeof body?.selected !== "boolean") {
    throw createError({ statusCode: 400, statusMessage: "selected (boolean) is required" });
  }

  const db = getDb();
  const row = await setCalendarSelected(db, id, body.selected);
  if (!row) throw createError({ statusCode: 404, statusMessage: "calendar not found" });
  return { id: row.id, selected: row.selected };
});
