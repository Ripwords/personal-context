import { test, expect } from "bun:test";
import { makeGoogleTokenRefresher, makeGoogleEventsApi } from "./google-rest";

test("token refresher posts refresh_token and returns access token", async () => {
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=rt_1");
    return new Response(JSON.stringify({ access_token: "at_new", expires_in: 3600 }), { status: 200 });
  }) as unknown as typeof fetch;
  const refresh = makeGoogleTokenRefresher("cid", "secret", fakeFetch);
  const res = await refresh("rt_1");
  expect(res.accessToken).toBe("at_new");
  expect(res.expiresAt).toBeGreaterThan(0);
});

test("events api lists and returns raw items array", async () => {
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    expect(String(url)).toContain("/calendars/primary/events");
    expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer at_x");
    return new Response(JSON.stringify({ items: [{ id: "g1", summary: "X", start: { dateTime: "2026-07-01T09:00:00Z" }, end: { dateTime: "2026-07-01T10:00:00Z" } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const api = makeGoogleEventsApi(fakeFetch);
  const items = await api.list({ accessToken: "at_x", calendarId: "primary", timeMin: "2026-07-01T00:00:00Z", timeMax: "2026-07-02T00:00:00Z" });
  expect(items.length).toBe(1);
  expect(items[0]!.id).toBe("g1");
});

test("token refresher throws on non-ok response", async () => {
  const fakeFetch = (async (_url: string, _init?: RequestInit) => {
    return new Response("", { status: 400 });
  }) as unknown as typeof fetch;
  const refresh = makeGoogleTokenRefresher("cid", "secret", fakeFetch);
  await expect(refresh("rt")).rejects.toThrow();
});

test("events api returns [] when response JSON has no items", async () => {
  const fakeFetch = (async (_url: string, _init?: RequestInit) => {
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;
  const api = makeGoogleEventsApi(fakeFetch);
  const items = await api.list({ accessToken: "at_x", calendarId: "primary", timeMin: "2026-07-01T00:00:00Z", timeMax: "2026-07-02T00:00:00Z" });
  expect(items).toEqual([]);
});
