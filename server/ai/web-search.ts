export type WebResult = { title: string; url: string; snippet: string };

type WebSearchResult = {
  configured: boolean;
  results: WebResult[];
  note?: string;
};

// Provider-specific response shapes
interface TavilyResponse {
  results: Array<{ title: string; url: string; content: string }>;
}

interface BraveResponse {
  web: {
    results: Array<{ title: string; url: string; description: string }>;
  };
}

interface SearxngResponse {
  results: Array<{ title: string; url: string; content: string }>;
}

export function makeWebSearch(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): (query: string) => Promise<WebSearchResult> {
  return async (query: string): Promise<WebSearchResult> => {
    if (env.TAVILY_API_KEY) {
      try {
        const res = await fetchImpl("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, max_results: 5 }),
        });

        if (!res.ok) {
          return { configured: true, results: [], note: `web search failed: ${res.status}` };
        }

        const data = (await res.json()) as TavilyResponse;
        return {
          configured: true,
          results: data.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content })),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { configured: true, results: [], note: `web search failed: ${message}` };
      }
    }

    if (env.BRAVE_API_KEY) {
      try {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
        const res = await fetchImpl(url, {
          headers: { "X-Subscription-Token": env.BRAVE_API_KEY },
        });

        if (!res.ok) {
          return { configured: true, results: [], note: `web search failed: ${res.status}` };
        }

        const data = (await res.json()) as BraveResponse;
        return {
          configured: true,
          results: data.web.results.map((r) => ({ title: r.title, url: r.url, snippet: r.description })),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { configured: true, results: [], note: `web search failed: ${message}` };
      }
    }

    if (env.SEARXNG_URL) {
      try {
        const url = `${env.SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json`;
        const res = await fetchImpl(url);

        if (!res.ok) {
          return { configured: true, results: [], note: `web search failed: ${res.status}` };
        }

        const data = (await res.json()) as SearxngResponse;
        return {
          configured: true,
          results: data.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content })),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { configured: true, results: [], note: `web search failed: ${message}` };
      }
    }

    return {
      configured: false,
      results: [],
      note: "Web search is not configured. Set TAVILY_API_KEY, BRAVE_API_KEY, or SEARXNG_URL.",
    };
  };
}
