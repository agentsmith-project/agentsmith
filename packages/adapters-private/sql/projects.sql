CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  join_policy TEXT NULL CHECK (join_policy IN ('approval_required', 'open')),
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_workspace_created_at
  ON projects (workspace_id, created_at DESC);
