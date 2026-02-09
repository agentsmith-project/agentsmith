# Integration Dependencies

Docker Compose stack for integration testing:

- PostgreSQL + pgvector extension (`localhost:15432`)
- MongoDB (`localhost:17017`)
- Redis (`localhost:16379`)
- MinIO API (`localhost:19000`) and console (`localhost:19001`)
- Keycloak (`localhost:18080`)

Current minimal validation scope:

- Auth: Keycloak (real user login)
- Object storage: MinIO (source file binary storage)
- Metadata and cache in this phase: in-memory inside `@mbos/api-entry-node`

Current chat integration verification scope:

- OpenAI-compatible endpoint proxy path is working end-to-end:
  - create credential
  - create custom endpoint
  - send chat message via `/chat/sessions/{id}/messages/stream`
- Session continuity across route switch:
  - leave `/chat` and return
  - continue conversation in the same thread
- Endpoint switch routing:
  - two custom endpoints with different upstream base URLs
  - switch endpoint from chat header model selector
  - verify next chat turn is routed to the selected endpoint upstream
- Failure and recovery:
  - route one turn to a failing upstream (HTTP 5xx)
  - verify chat stream enters error state
  - switch to healthy endpoint and continue in same thread
- Stop and resume:
  - route one turn to a delayed upstream
  - click `Stop` during generation
  - switch to healthy endpoint and continue in same thread
- Session isolation:
  - create multiple chat threads in one project
  - bind different endpoints per thread
  - switch between threads and verify each turn routes to its thread-bound endpoint
- Thread lifecycle consistency:
  - rename thread and verify name persists after route switch
  - delete another thread and verify it is removed
  - continue chatting on the remaining thread successfully
- Attachment flow:
  - attach a file in chat composer
  - send message and verify request includes non-empty `attachments` ids
  - verify upstream reply is returned normally

Current AIReady API status:

- New library-scoped job APIs are available:
  - `POST /api/v1/workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/ai-ready-jobs`
  - `GET /api/v1/workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/ai-ready-jobs/{jobId}`
  - `POST /api/v1/workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/ai-ready-jobs/{jobId}:cancel`
- Legacy source-scoped APIs are still kept for compatibility during migration.
- Current worker behavior (Node entry):
  - job status transitions: `queued -> running -> succeeded|failed` (cancel path supported)
  - in-process queue + worker for minimal validation, without external MQ yet

## Quick start

```bash
npm run integration:deps:up
npm run integration:deps:init:postgres
npm run integration:deps:smoke
npm run integration:test:adapters
npm run test:e2e:integration:minimal
npm run test:e2e:integration:chat
npm run test:e2e:integration:minimal:with-api
npm run test:e2e:integration:chat:with-api
```

`*:with-api` scripts will start `@mbos/api-entry-node` from current workspace
on `INTEGRATION_API_PORT` (default `20010`) and stop it automatically after test run.

Recommended execution order:

```bash
npm run test:e2e:integration:minimal:with-api
npm run test:e2e:integration:chat:with-api
```

`integration:deps:init:postgres` now applies every SQL file under
`packages/adapters-private/sql/`, including `source_embeddings.sql`
(`CREATE EXTENSION vector` and vector table bootstrap).

Optional env overrides:

```bash
cp infra/integration/.env.example infra/integration/.env
docker compose --env-file infra/integration/.env -f infra/integration/docker-compose.yml up -d
```

## Stop

```bash
docker compose -f infra/integration/docker-compose.yml down
```

## Reset volumes

```bash
docker compose -f infra/integration/docker-compose.yml down -v
```

## Default credentials and endpoints

- PostgreSQL: `postgresql://mbos:mbos_dev_password@localhost:15432/mbos`
- MongoDB: `mongodb://mbos:mbos_dev_password@localhost:17017/admin`
- Redis: `redis://localhost:16379`
- MinIO API: `http://localhost:19000` (user `mbos`, password `mbos_dev_password`, bucket `mbos-dev`)
- MinIO Console: `http://localhost:19001`
- Keycloak: `http://localhost:18080` (admin `admin` / `admin`, realm `mbos`, client `mbos-frontend`)
  - integration user: `integration-user` / `integration-user-123`
  - dev admin user: `dev-admin` / `dev-admin-123`

## Run API with Postgres

```bash
npm run api:node:dev:pg
```

## Verify pgvector

```bash
docker compose -f infra/integration/docker-compose.yml exec -T postgres \
  psql -U mbos -d mbos -c "SELECT extname FROM pg_extension WHERE extname='vector';"
```

## Run API for minimal verification (Keycloak + MinIO only)

```bash
PORT=20000 \
KEYCLOAK_BASE_URL=http://localhost:18080 \
KEYCLOAK_REALM=mbos \
MINIO_ENDPOINT=localhost \
MINIO_PORT=19000 \
MINIO_USE_SSL=false \
MINIO_ACCESS_KEY=mbos \
MINIO_SECRET_KEY=mbos_dev_password \
MINIO_BUCKET=mbos-dev \
npm run api:node:dev
```

## Frontend API base note

- `NEXT_PUBLIC_API_BASE` can be configured as either:
  - `http://localhost:20000`
  - `http://localhost:20000/api/v1`
- Frontend now normalizes this value and appends `/api/v1` when missing.
