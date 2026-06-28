import { test, expect } from "bun:test";
import handler from "./[...all]";

test("auth catch-all route exports a handler", () => {
  expect(handler).toBeDefined();
  expect(typeof handler).toBe("function");
});
