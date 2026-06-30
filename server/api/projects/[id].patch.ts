import { defineEventHandler, createError, getRouterParam, readBody } from "h3";
import { z } from "zod";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { updateProject } from "../../db/queries/projects";

const bodySchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  keywords: z.array(z.string()).optional(),
});

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });

  const parsed = bodySchema.safeParse(await readBody<unknown>(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "invalid body" });

  const keywords = parsed.data.keywords?.map((k) => k.trim().toLowerCase()).filter(Boolean);
  const row = await updateProject(getDb(), id, { ...parsed.data, keywords });
  if (!row) throw createError({ statusCode: 404, statusMessage: "project not found" });
  return row;
});
