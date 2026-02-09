CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS source_embeddings (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, project_id, library_id, source_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_source_embeddings_scope
  ON source_embeddings (workspace_id, project_id, library_id, source_id);
