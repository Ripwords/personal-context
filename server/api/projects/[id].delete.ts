import { defineEventHandler, createError, getRouterParam } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { deleteProject } from "../../db/queries/projects";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  // Todos/events reference projects with ON DELETE no-action via a nullable FK;
  // null them out first so deleting a project doesn't orphan or fail.
  const ok = await deleteProject(getDb(), id);
  if (!ok) throw createError({ statusCode: 404, statusMessage: "project not found" });
  return { deleted: true };
});
