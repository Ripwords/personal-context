import { test, expect } from "bun:test";
import { embeddingsEnabled, embedText, toVectorLiteral, EMBEDDING_DIM } from "./embeddings";

const ON = { EMBEDDINGS_ENABLED: "1" };

test("embeddingsEnabled reflects the flag", () => {
  expect(embeddingsEnabled({})).toBe(false);
  expect(embeddingsEnabled({ EMBEDDINGS_ENABLED: "1" })).toBe(true);
  expect(embeddingsEnabled({ EMBEDDINGS_ENABLED: "true" })).toBe(true);
  expect(embeddingsEnabled({ EMBEDDINGS_ENABLED: "0" })).toBe(false);
});

test("embedText returns null when disabled (no network call)", async () => {
  let called = false;
  const fetchImpl = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  expect(await embedText("hello", {}, fetchImpl)).toBeNull();
  expect(called).toBe(false);
});

test("embedText posts to Ollama and returns the embedding when enabled", async () => {
  const vec = Array.from({ length: EMBEDDING_DIM }, (_, i) => i / 1000);
  let url = "";
  const fetchImpl = (async (u: string) => {
    url = u;
    return new Response(JSON.stringify({ embedding: vec }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const out = await embedText("hello world", { ...ON, OLLAMA_URL: "http://ollama:11434" }, fetchImpl);
  expect(out).toEqual(vec);
  expect(url).toBe("http://ollama:11434/api/embeddings");
});

test("embedText returns null on a non-ok response or network error", async () => {
  const bad = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  expect(await embedText("x", ON, bad)).toBeNull();

  const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  expect(await embedText("x", ON, boom)).toBeNull();
});

test("toVectorLiteral formats a pgvector literal", () => {
  expect(toVectorLiteral([0.1, 0.2, -0.3])).toBe("[0.1,0.2,-0.3]");
});
