-- Optional: pgvector semantic memory + RAG.
--
-- Apply this ONLY when running the pgvector Postgres image
-- (image: pgvector/pgvector:pg16) and EMBEDDINGS_ENABLED=1. It is intentionally
-- NOT in the Drizzle journal, so the default schema and the test suite (plain
-- postgres:16, no pgvector) are unaffected. Run it manually once:
--
--   psql "$DATABASE_URL" -f drizzle/optional/pgvector.sql
--
-- Dimension 768 matches nomic-embed-text (EMBEDDINGS_MODEL default). If you use a
-- different model, change the vector size to match its output dimension.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE memory ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE document_chunk ADD COLUMN IF NOT EXISTS embedding vector(768);

-- HNSW indexes for fast cosine KNN (<=> is cosine distance with vector_cosine_ops).
CREATE INDEX IF NOT EXISTS memory_embedding_hnsw
  ON memory USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS document_chunk_embedding_hnsw
  ON document_chunk USING hnsw (embedding vector_cosine_ops);
