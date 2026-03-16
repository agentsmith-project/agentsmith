# MBOS Workspace Packages

This directory contains shared backend architecture packages for dual deployment:

- Cloudflare deployment path (`@mbos/api-entry-cf`, `@mbos/adapters-cf`)
- Private deployment path (`@mbos/api-entry-node`, `@mbos/adapters-private`)
- Shared core (`@mbos/contracts`, `@mbos/domain`, `@mbos/ports`, `@mbos/application`)

Current status:

- Minimal `project list/create` flow is implemented in shared layers.
- Node API entry serves `GET/POST /api/v1/workspaces/:ws/projects` and `GET/PATCH/DELETE /api/v1/workspaces/:ws/projects/:id`.
- Node API entry serves:
  `GET/POST /api/v1/workspaces/:ws/projects/:prj/sources`,
  `GET /api/v1/workspaces/:ws/projects/:prj/sources/limits`,
  `GET/DELETE /api/v1/workspaces/:ws/projects/:prj/sources/:sourceId`,
  `GET /api/v1/workspaces/:ws/projects/:prj/sources/:sourceId/download`.
- Node API entry serves library-scoped AIReady job endpoints:
  `POST /api/v1/workspaces/:ws/projects/:prj/source-libraries/:libraryId/ai-ready-jobs`,
  `GET /api/v1/workspaces/:ws/projects/:prj/source-libraries/:libraryId/ai-ready-jobs/:jobId`,
  `POST /api/v1/workspaces/:ws/projects/:prj/source-libraries/:libraryId/ai-ready-jobs/:jobId:cancel`.
  - Node entry now runs an in-process worker that drains queued `document_ingest` jobs and updates status to `running/succeeded/failed`.
  - In local development, worker execution also runs opportunistically when querying job status endpoint.
- Files mainline now runs on JuiceFS-backed project `file-libraries`.
- Legacy `source-libraries` routes are retained only for old source-processing and AI-ready
  endpoints that have not yet been migrated; they are not the current Files product path.
- Node API entry serves endpoint/credential and proxy APIs:
  - `GET/POST /api/v1/workspaces/:ws/projects/:prj/credentials`
  - `POST /api/v1/workspaces/:ws/projects/:prj/credentials/:credentialId/rotate`
  - `DELETE /api/v1/workspaces/:ws/projects/:prj/credentials/:credentialId`
  - `GET/POST /api/v1/workspaces/:ws/projects/:prj/endpoints`
  - `GET/PUT/DELETE /api/v1/workspaces/:ws/projects/:prj/endpoints/:endpointId`
  - `POST /api/v1/workspaces/:ws/projects/:prj/endpoints/import-openai-compatible`
  - `POST /api/v1/workspaces/:ws/projects/:prj/endpoints/:endpointId/proxy/{openai_path}`
    (example: `chat/completions`, `embeddings`)
  - `POST /api/v1/workspaces/:ws/projects/:prj/llm-gateway/{path}`
    (single-base-url gateway, supports `chat/completions`, `responses`, `messages`, `messages/count_tokens`)
- Node API entry now serves chat execution endpoints on real project data store:
  - `GET/POST /api/v1/workspaces/:ws/projects/:prj/chat/sessions`
  - `GET/PATCH/DELETE /api/v1/workspaces/:ws/projects/:prj/chat/sessions/:sessionId`
  - `GET/POST /api/v1/workspaces/:ws/projects/:prj/chat/sessions/:sessionId/messages`
  - `PATCH /api/v1/workspaces/:ws/projects/:prj/chat/sessions/:sessionId/messages/:messageId`
  - `POST /api/v1/workspaces/:ws/projects/:prj/chat/sessions/:sessionId/messages/stream`
  - `GET /api/v1/workspaces/:ws/projects/:prj/chat/sessions/:sessionId/attachments`
  - `POST /api/v1/workspaces/:ws/projects/:prj/chat/sessions/:sessionId/attachments/init`
  - `POST /api/v1/workspaces/:ws/projects/:prj/chat/sessions/:sessionId/attachments/:attachmentId/complete`
  - `DELETE /api/v1/workspaces/:ws/projects/:prj/chat/sessions/:sessionId/attachments/:attachmentId`
  - `POST /api/v1/workspaces/:ws/projects/:prj/chat/sessions/:sessionId/attachments/:attachmentId/retry`
  - Stream path behavior:
    - reads project endpoint + credential binding
    - forwards to upstream OpenAI-compatible `/chat/completions`
    - emits SSE (`meta`, `delta`, `done`) and persists assistant message
    - supports branch semantics:
      - user edit returns a new revision message (`logical_id`, `revision_of`, `revision_index`)
      - assistant regenerate appends variant in same group (`variant_group_id`, `variant_index`)
      - when `branch_leaf_message_id` already points to the same user input, stream reuses it (no duplicate user message)
- `@mbos/adapters-private` contains `InMemoryProjectRepo` and `PostgresProjectRepo`.
- `@mbos/adapters-private` contains Redis/Mongo/MinIO adapters and integration tests.
- `@mbos/adapters-private` contains `PgVectorStore` (`pgvector`) and `NoopVectorStore`.
- Postgres table bootstrap SQL: `packages/adapters-private/sql/projects.sql`
- Pgvector bootstrap SQL: `packages/adapters-private/sql/source_embeddings.sql`
- Cloudflare entry is still a stub and should be wired next.

Quick start:

- Run Node API entry: `npm run api:node:dev`
- Default port: `3010` (`PORT=3020 npm run api:node:dev` to override)
- Use Postgres repo: `DATABASE_URL=postgresql://mbos:mbos_dev_password@localhost:15432/mbos npm run api:node:dev`
- Use full private stack:
  `DATABASE_URL=postgresql://mbos:mbos_dev_password@localhost:15432/mbos REDIS_URL=redis://localhost:16379 MONGO_URL=mongodb://mbos:mbos_dev_password@localhost:17017/admin MONGO_DB_NAME=mbos MINIO_ENDPOINT=localhost MINIO_PORT=19000 MINIO_ACCESS_KEY=mbos MINIO_SECRET_KEY=mbos_dev_password MINIO_BUCKET=mbos-dev npm run api:node:dev`

AIReady execution tuning:

- `AIREADY_CHUNK_SIZE` (default `1000`)
- `AIREADY_CHUNK_OVERLAP` (default `100`)
- `AIREADY_EMBEDDING_DIMENSIONS` (default `1536`)
