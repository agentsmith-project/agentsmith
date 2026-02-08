# MBOS Workspace Packages

This directory contains shared backend architecture packages for dual deployment:

- Cloudflare runtime path (`@mbos/api-entry-cf`, `@mbos/adapters-cf`)
- Private deployment path (`@mbos/api-entry-node`, `@mbos/adapters-private`)
- Shared core (`@mbos/contracts`, `@mbos/domain`, `@mbos/ports`, `@mbos/application`)

Current status:

- Minimal `project list/create` flow is implemented in shared layers.
- Node API entry serves `GET/POST /api/v1/workspaces/:ws/projects` and `GET/PATCH/DELETE /api/v1/workspaces/:ws/projects/:id`.
- Node API entry serves:
  `GET/POST /api/v1/workspaces/:ws/projects/:prj/sources`,
  `GET /api/v1/workspaces/:ws/projects/:prj/sources/quota`,
  `GET/DELETE /api/v1/workspaces/:ws/projects/:prj/sources/:sourceId`,
  `GET /api/v1/workspaces/:ws/projects/:prj/sources/:sourceId/download`.
- `@mbos/adapters-private` contains `InMemoryProjectRepo` and `PostgresProjectRepo`.
- `@mbos/adapters-private` contains Redis/Mongo/MinIO adapters and integration tests.
- Postgres table bootstrap SQL: `packages/adapters-private/sql/projects.sql`
- Cloudflare entry is still a stub and should be wired next.

Quick start:

- Run Node API entry: `npm run api:node:dev`
- Default port: `3010` (`PORT=3020 npm run api:node:dev` to override)
- Use Postgres repo: `DATABASE_URL=postgresql://mbos:mbos_dev_password@localhost:15432/mbos npm run api:node:dev`
- Use full private stack:
  `DATABASE_URL=postgresql://mbos:mbos_dev_password@localhost:15432/mbos REDIS_URL=redis://localhost:16379 MONGO_URL=mongodb://mbos:mbos_dev_password@localhost:17017/admin MONGO_DB_NAME=mbos MINIO_ENDPOINT=localhost MINIO_PORT=19000 MINIO_ACCESS_KEY=mbos MINIO_SECRET_KEY=mbos_dev_password MINIO_BUCKET=mbos-dev npm run api:node:dev`
