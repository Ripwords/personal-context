import type { H3Event } from "h3";
import { getHeaders } from "h3";
import { auth } from "../auth";

export async function getAuthSession(event: H3Event) {
  // Better Auth resolves a session from request headers via auth.api.getSession.
  // Verified against https://www.better-auth.com/docs/concepts/session-management:
  // the server-side call signature is getSession({ headers: Headers }).
  return auth.api.getSession({ headers: new Headers(getHeaders(event) as Record<string, string>) });
}
