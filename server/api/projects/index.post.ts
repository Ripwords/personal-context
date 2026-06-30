import { defineEventHandler, createError, readBody } from "h3";
import { z } from "zod";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { createProject } from "../../db/queries/projects";

const bodySchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  kind: z.enum(["work", "part_time", "freelance", "hackathon", "personal", "other"]),
  keywords: z.array(z.string()).optional(),
});

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });

  const parsed = bodySchema.safeParse(await readBody<unknown>(event));
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "invalid body" });

  const { name, color, kind, keywords } = parsed.data;
  return createProject(getDb(), {
    name,
    color,
    kind,
    keywords: (keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean),
  });
});
