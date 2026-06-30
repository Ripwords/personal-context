/**
 * Text embeddings via a self-hosted Ollama model (default nomic-embed-text, 768
 * dims). Feature-flagged: when EMBEDDINGS_ENABLED is off (the default, and in
 * tests) every call returns null and callers fall back to Postgres full-text
 * search. When on, memories and document chunks get a pgvector embedding and
 * recall becomes hybrid (semantic + FTS).
 *
 * The pgvector columns/extension are added by drizzle/optional/pgvector.sql,
 * applied manually when running the pgvector Postgres image — so the default
 * (non-pgvector) schema and the test suite are unaffected.
 */
export const EMBEDDING_DIM = 768; // nomic-embed-text

export function embeddingsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.EMBEDDINGS_ENABLED === "1" || env.EMBEDDINGS_ENABLED === "true";
}

/** Embed `text`, or null when embeddings are disabled or the model is unreachable. */
export async function embedText(
  text: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<number[] | null> {
  if (!embeddingsEnabled(env) || !text.trim()) return null;
  const base = env.OLLAMA_URL ?? "http://localhost:11434";
  const model = env.EMBEDDINGS_MODEL ?? "nomic-embed-text";
  try {
    const res = await fetchImpl(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { embedding?: number[] };
    return Array.isArray(json.embedding) && json.embedding.length > 0 ? json.embedding : null;
  } catch {
    // Ollama down / network error → degrade to FTS, never throw.
    return null;
  }
}

/** Format a number[] as a pgvector literal: "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
