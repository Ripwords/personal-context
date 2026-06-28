import { test, expect } from "bun:test";
import { auth } from "./index";

test("auth instance is constructed with a handler", () => {
  expect(auth).toBeDefined();
  // Better Auth exposes a request handler via auth.handler (confirmed from docs)
  expect(typeof auth.handler).toBe("function");
});
