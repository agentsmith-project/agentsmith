.PHONY: help bootstrap deps-up deps-down deps-reset deps-smoke deps-logs deps-ps deps-init \
	api-dev api-dev-min web web-msw e2e-minimal e2e-chat e2e-minimal-local-api e2e-chat-local-api urls

NPM ?= npm

PORT_API ?= 20000
PORT_WEB ?= 3001

KEYCLOAK_BASE_URL ?= http://localhost:18080
KEYCLOAK_REALM ?= mbos
KEYCLOAK_URL ?= http://localhost:18080/realms
KEYCLOAK_CLIENT_ID ?= mbos-frontend

MINIO_ENDPOINT ?= localhost
MINIO_PORT ?= 19000
MINIO_USE_SSL ?= false
MINIO_ACCESS_KEY ?= mbos
MINIO_SECRET_KEY ?= mbos_dev_password
MINIO_BUCKET ?= mbos-dev

DATABASE_URL ?= postgresql://mbos:mbos_dev_password@localhost:15432/mbos
REDIS_URL ?= redis://localhost:16379
MONGO_URL ?= mongodb://mbos:mbos_dev_password@localhost:17017/admin
MONGO_DB_NAME ?= mbos

LOCALE ?= en-US
BASE_URL ?= http://localhost:$(PORT_WEB)

help:
	@echo "MBOS Dev Commands"
	@echo ""
	@echo "Bootstrap:"
	@echo "  make bootstrap    # deps-up + deps-smoke + deps-init"
	@echo ""
	@echo "Dependencies:"
	@echo "  make deps-up       # start docker deps (postgres+pgvector/mongo/redis/minio/keycloak)"
	@echo "  make deps-init     # apply postgres schemas (projects + pgvector tables)"
	@echo "  make deps-smoke    # verify deps health"
	@echo "  make deps-down     # stop deps"
	@echo "  make deps-reset    # stop deps and remove volumes"
	@echo "  make deps-logs     # tail deps logs"
	@echo "  make deps-ps       # list deps status"
	@echo ""
	@echo "Services:"
	@echo "  make api-dev       # start node api (postgres+redis+mongo+minio+keycloak)"
	@echo "  make api-dev-min   # start node api (keycloak + minio minimal mode)"
	@echo "  make web           # start frontend (backend mode, msw off)"
	@echo "  make web-msw       # start frontend with msw"
	@echo ""
	@echo "Tests:"
	@echo "  make e2e-minimal   # run minimal integration e2e"
	@echo "  make e2e-chat      # run chat integration e2e"
	@echo "  make e2e-minimal-local-api  # run minimal integration e2e with current node api"
	@echo "  make e2e-chat-local-api     # run chat integration e2e with current node api"
	@echo ""
	@echo "Utility:"
	@echo "  make urls          # print local URLs and test users"

deps-up:
	$(NPM) run integration:deps:up

bootstrap: deps-up deps-smoke deps-init

deps-down:
	$(NPM) run integration:deps:down

deps-reset:
	$(NPM) run integration:deps:down:volumes

deps-smoke:
	$(NPM) run integration:deps:smoke

deps-logs:
	$(NPM) run integration:deps:logs

deps-ps:
	$(NPM) run integration:deps:ps

deps-init:
	$(NPM) run integration:deps:init:postgres

api-dev:
	PORT=$(PORT_API) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	DATABASE_URL=$(DATABASE_URL) \
	REDIS_URL=$(REDIS_URL) \
	MONGO_URL=$(MONGO_URL) \
	MONGO_DB_NAME=$(MONGO_DB_NAME) \
	MINIO_ENDPOINT=$(MINIO_ENDPOINT) \
	MINIO_PORT=$(MINIO_PORT) \
	MINIO_USE_SSL=$(MINIO_USE_SSL) \
	MINIO_ACCESS_KEY=$(MINIO_ACCESS_KEY) \
	MINIO_SECRET_KEY=$(MINIO_SECRET_KEY) \
	MINIO_BUCKET=$(MINIO_BUCKET) \
	$(NPM) run api:node:dev

api-dev-min:
	PORT=$(PORT_API) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	MINIO_ENDPOINT=$(MINIO_ENDPOINT) \
	MINIO_PORT=$(MINIO_PORT) \
	MINIO_USE_SSL=$(MINIO_USE_SSL) \
	MINIO_ACCESS_KEY=$(MINIO_ACCESS_KEY) \
	MINIO_SECRET_KEY=$(MINIO_SECRET_KEY) \
	MINIO_BUCKET=$(MINIO_BUCKET) \
	$(NPM) run api:node:dev

web:
	NEXT_PUBLIC_USE_MSW=false \
	NEXT_PUBLIC_API_BASE=http://localhost:$(PORT_API)/api/v1 \
	NEXT_PUBLIC_KEYCLOAK_URL=$(KEYCLOAK_URL) \
	NEXT_PUBLIC_KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=$(KEYCLOAK_CLIENT_ID) \
	$(NPM) run dev:test -- --port $(PORT_WEB)

web-msw:
	NEXT_PUBLIC_USE_MSW=true \
	$(NPM) run dev:test -- --port $(PORT_WEB)

e2e-minimal:
	BASE_URL=$(BASE_URL) \
	$(NPM) run test:e2e:integration:minimal

e2e-chat:
	BASE_URL=$(BASE_URL) \
	$(NPM) run test:e2e:integration:chat

e2e-minimal-local-api:
	INTEGRATION_API_PORT=$(PORT_API) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	$(NPM) run test:e2e:integration:minimal:with-api

e2e-chat-local-api:
	INTEGRATION_API_PORT=$(PORT_API) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	$(NPM) run test:e2e:integration:chat:with-api

urls:
	@echo "Frontend:         http://localhost:$(PORT_WEB)/$(LOCALE)/login"
	@echo "API base:         http://localhost:$(PORT_API)/api/v1"
	@echo "Keycloak admin:   http://localhost:18080  (admin/admin)"
	@echo "MinIO console:    http://localhost:19001  (mbos/mbos_dev_password)"
	@echo "Test user 1:      dev-admin / dev-admin-123"
	@echo "Test user 2:      integration-user / integration-user-123"
