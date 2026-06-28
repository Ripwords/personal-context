import { test, expect } from "bun:test";
import { parseEnv } from "./env";

test("parseEnv returns databaseUrl when present", () => {
  const cfg = parseEnv({ NUXT_DATABASE_URL: "postgresql://x/y" });
  expect(cfg.databaseUrl).toBe("postgresql://x/y");
});

test("parseEnv throws when NUXT_DATABASE_URL is missing", () => {
  expect(() => parseEnv({})).toThrow(/NUXT_DATABASE_URL/);
});

test("parseEnv throws when NUXT_DATABASE_URL is empty", () => {
  expect(() => parseEnv({ NUXT_DATABASE_URL: "" })).toThrow(/NUXT_DATABASE_URL/);
});
