import { test, expect } from "bun:test";
import { resolveModelId } from "./model";

test("defaults to deepseek-chat", () => {
  expect(resolveModelId("deepseek")).toEqual({ provider: "deepseek", modelId: "deepseek-chat" });
});
test("anthropic maps to a sonnet model", () => {
  const r = resolveModelId("anthropic");
  expect(r.provider).toBe("anthropic");
  expect(r.modelId).toContain("claude");
});
test("unknown provider throws", () => {
  expect(() => resolveModelId("bogus")).toThrow(/provider/i);
});
