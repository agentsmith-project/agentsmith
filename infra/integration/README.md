# Integration Dependencies

Docker Compose stack for integration testing:

- PostgreSQL (`localhost:15432`)
- MongoDB (`localhost:17017`)
- Redis (`localhost:16379`)
- MinIO API (`localhost:19000`) and console (`localhost:19001`)
- Keycloak (`localhost:18080`)

Current minimal validation scope:

- Auth: Keycloak (real user login)
- Object storage: MinIO (source file binary storage)
- Metadata and cache in this phase: in-memory inside `@mbos/api-entry-node`

## Quick start

```bash
npm run integration:deps:up
npm run integration:deps:init:postgres
npm run integration:deps:smoke
npm run integration:test:adapters
```

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
