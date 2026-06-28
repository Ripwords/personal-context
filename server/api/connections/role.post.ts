import { defineEventHandler, readBody, createError } from "h3";
import { getDb } from "../../db/client";
import { getAuthSession } from "../../utils/session";
import { setConnectionRole } from "../../auth/connections";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  if (!session) throw createError({ statusCode: 401, statusMessage: "not authenticated" });
  const body = await readBody<{ accountId: string; role: "personal" | "work" }>(event);
  if (!body?.accountId || (body.role !== "personal" && body.role !== "work")) {
    throw createError({ statusCode: 400, statusMessage: "accountId + role required" });
  }
  const db = getDb();
  return setConnectionRole(db, body.accountId, body.role);
});
