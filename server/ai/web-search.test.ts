import { test, expect } from "bun:test";
import { makeWebSearch } from "./web-search";

// --- Tavily path ---
test("Tavily: returns mapped WebResults when TAVILY_API_KEY is set", async () => {
  const calledWith: { url: string; init?: RequestInit }[] = [];

  const fakeFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calledWith.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        results: [
          { title: "Result 1", url: "https://example.com/1", content: "Snippet one" },
          { title: "Result 2", url: "https://example.com/2", content: "Snippet two" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const search = makeWebSearch(
    { TAVILY_API_KEY: "test-tavily-key" },
    fakeFetch as unknown as typeof fetch,
  );
  const result = await search("test query");

  expect(result.configured).toBe(true);
  expect(result.results).toHaveLength(2);
  expect(result.results[0]).toEqual({ title: "Result 1", url: "https://example.com/1", snippet: "Snippet one" });
  expect(result.results[1]).toEqual({ title: "Result 2", url: "https://example.com/2", snippet: "Snippet two" });

  expect(calledWith).toHaveLength(1);
  expect(calledWith[0].url).toBe("https://api.tavily.com/search");
  const body = JSON.parse(calledWith[0].init?.body as string);
  expect(body.api_key).toBe("test-tavily-key");
  expect(body.query).toBe("test query");
  expect(body.max_results).toBe(5);
});

// --- Brave path ---
test("Brave: returns mapped WebResults and sends X-Subscription-Token header", async () => {
  const capturedHeaders: Record<string, string>[] = [];

  const fakeFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    capturedHeaders.push(headers);
    return new Response(
      JSON.stringify({
        web: {
          results: [
            { title: "Brave Result", url: "https://brave.com/1", description: "Brave snippet" },
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const search = makeWebSearch(
    { BRAVE_API_KEY: "test-brave-key" },
    fakeFetch as unknown as typeof fetch,
  );
  const result = await search("brave query");

  expect(result.configured).toBe(true);
  expect(result.results).toHaveLength(1);
  expect(result.results[0]).toEqual({ title: "Brave Result", url: "https://brave.com/1", snippet: "Brave snippet" });
  expect(capturedHeaders[0]["X-Subscription-Token"]).toBe("test-brave-key");
});

// --- no-key path ---
test("No-key: returns configured:false and does not call fetch", async () => {
  let fetchCalled = false;
  const fakeFetch = async (): Promise<Response> => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };

  const search = makeWebSearch({}, fakeFetch as unknown as typeof fetch);
  const result = await search("no key query");

  expect(result.configured).toBe(false);
  expect(result.results).toHaveLength(0);
  expect(result.note).toBe(
    "Web search is not configured. Set TAVILY_API_KEY, BRAVE_API_KEY, or SEARXNG_URL.",
  );
  expect(fetchCalled).toBe(false);
});

// --- SearXNG path ---
test("SearXNG: returns mapped WebResults when SEARXNG_URL is set", async () => {
  const calledWith: string[] = [];

  const fakeFetch = async (url: string | URL | Request): Promise<Response> => {
    calledWith.push(String(url));
    return new Response(
      JSON.stringify({
        results: [
          { title: "SearXNG Result", url: "https://searxng.example/1", content: "SearXNG snippet" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const search = makeWebSearch(
    { SEARXNG_URL: "https://searxng.example" },
    fakeFetch as unknown as typeof fetch,
  );
  const result = await search("searxng query");

  expect(result.configured).toBe(true);
  expect(result.results).toHaveLength(1);
  expect(result.results[0]).toEqual({
    title: "SearXNG Result",
    url: "https://searxng.example/1",
    snippet: "SearXNG snippet",
  });
  expect(calledWith[0]).toContain("/search?q=");
  expect(calledWith[0]).toContain("format=json");
});

// --- non-ok HTTP response degrades gracefully ---
test("Tavily: non-ok HTTP response returns configured:true with empty results and note", async () => {
  const fakeFetch = async (): Promise<Response> => {
    return new Response("Unauthorized", { status: 401 });
  };

  const search = makeWebSearch(
    { TAVILY_API_KEY: "bad-key" },
    fakeFetch as unknown as typeof fetch,
  );
  const result = await search("fail query");

  expect(result.configured).toBe(true);
  expect(result.results).toHaveLength(0);
  expect(result.note).toBe("web search failed: 401");
});
