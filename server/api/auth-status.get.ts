import { defineEventHandler } from "h3";
import { getAuthSession } from "../utils/session";

export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  return { authenticated: session !== null && session !== undefined };
});
