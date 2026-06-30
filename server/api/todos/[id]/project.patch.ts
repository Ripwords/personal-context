import { defineEventHandler, createError, getRouterParam, readBody } from "h3";
import { z } from "zod";
import { getDb } from "../../../db/client";
import { getAuthSession } from "../../../utils/session";
import { setTodoProject } from "../../../db/queries/items";
import { addProjectKeyword } from "../../../db/queries/projects";

const bodySchema = z.object({
  // null clears the project; a string sets/confirms it.
  projectId: z.string().uuid().nullable(),
  // Optional: teach the classifier by adding a keyword (e.g. the todo's
  // distinctive word) to the chosen project.
  learnKeyword: z.string().optional(),
});

/**
 * One-tap project correction. Sets (or confirms) a todo's project and clears its
 * needsReview flag. Optionally appends a keyword to the chosen project so future
 * tagging improves.
 */
export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const parsed = bodySchema.safeParse(await readBody<unknown>(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "invalid body" });

  const db = getDb();
  const row = await setTodoProject(db, id, parsed.data.projectId);
  if (!row) throw createError({ statusCode: 404, statusMessage: "todo not found" });

  if (parsed.data.learnKeyword && parsed.data.projectId) {
    await addProjectKeyword(db, parsed.data.projectId, parsed.data.learnKeyword);
  }

  return { projectId: row.projectId, needsReview: row.needsReview };
});
