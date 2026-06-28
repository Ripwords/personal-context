import { defineEventHandler, createError } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { listProjects } from "../../db/queries/projects";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const db = getDb();
  return listProjects(db);
});
