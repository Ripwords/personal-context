import { test, expect } from "bun:test";
import { getFreshAccessToken } from "./access-token";
import type { GoogleCreds } from "../auth/google-credentials";

const base: GoogleCreds = {
  accountId: "acc1",
  role: "personal",
  accessToken: "stale",
  refreshToken: "rt_1",
  braindumpCalendarId: null,
};

test("refreshes and returns a new access token", async () => {
  const fresh = await getFreshAccessToken(base, 1000, async (rt) => {
    expect(rt).toBe("rt_1");
    return { accessToken: "new_at", expiresAt: 5000 };
  });
  expect(fresh).toBe("new_at");
});

test("throws when there is no refresh token", async () => {
  const noRt = { ...base, refreshToken: null };
  await expect(
    getFreshAccessToken(noRt, 1000, async () => ({
      accessToken: "x",
      expiresAt: 1,
    })),
  ).rejects.toThrow(/no refresh token/i);
});
