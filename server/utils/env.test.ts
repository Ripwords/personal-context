import { test, expect } from "bun:test";
import { parseEnv } from "./env";

test("parseEnv returns databaseUrl when present", () => {
  const cfg = parseEnv({ DATABASE_URL: "postgresql://x/y" });
  expect(cfg.databaseUrl).toBe("postgresql://x/y");
});

test("parseEnv throws when DATABASE_URL is missing", () => {
  expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
});

test("parseEnv throws when DATABASE_URL is empty", () => {
  expect(() => parseEnv({ DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
});

test("parseEnv ignores unrelated env keys (e.g. process.env extras)", () => {
  const cfg = parseEnv({ DATABASE_URL: "postgresql://x/y", PATH: "/usr/bin", HOME: "/root" });
  expect(cfg.databaseUrl).toBe("postgresql://x/y");
});
