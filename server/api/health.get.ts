import { defineEventHandler } from "h3";

// Lightweight liveness probe for container orchestration / load balancers.
// Intentionally does NOT touch the database or auth so it stays cheap and
// returns 200 as soon as the Nitro server is accepting connections.
export default defineEventHandler(() => {
  return { status: "ok", uptime: process.uptime() };
});
