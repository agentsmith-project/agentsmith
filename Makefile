.PHONY: help bootstrap deps-up deps-down deps-reset deps-smoke deps-logs deps-ps deps-init deps-init-postgres deps-init-keycloak \
	check-api-port api-dev api-dev-min web web-msw \
	e2e e2e-local \
	e2e-int-minimal e2e-int-chat e2e-int-agent e2e-int-chat-real e2e-int-local \
	e2e-int-minimal-local-api e2e-int-chat-local-api e2e-int-agent-local-api e2e-int-chat-real-local-api \
	e2e-int-chat-auto e2e-int-agent-auto e2e-int-chat-ux-auto \
	agent-test-runner openapi-generate openapi-check-generated openapi-changelog contracts-check-openapi urls

NPM ?= npm

PORT_API ?= 20000
PORT_WEB ?= 3001

KEYCLOAK_BASE_URL ?= http://localhost:18080
KEYCLOAK_REALM ?= mbos
KEYCLOAK_URL ?= http://localhost:18080/realms
KEYCLOAK_CLIENT_ID ?= agentsmith
AGENT_WS_URL ?=
AGENT_KEY ?=
AGENT_MODE ?= echo

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
	@echo "  make deps-init     # apply postgres schemas + seed/reset keycloak users"
	@echo "  make deps-init-postgres # apply postgres schemas (projects + pgvector tables)"
	@echo "  make deps-init-keycloak # ensure/reset keycloak integration users"
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
	@echo "  make e2e           # run mock e2e (MSW)"
	@echo "  make e2e-local     # run mock e2e against a manually started web server (BASE_URL)"
	@echo "  make e2e-int-minimal   # run minimal integration e2e (real backend)"
	@echo "  make e2e-int-chat      # run chat integration e2e (real backend)"
	@echo "  make e2e-int-agent     # run external-agent integration e2e (real backend)"
	@echo "  make e2e-int-chat-real # run real deepseek chat integration e2e (real upstream)"
	@echo "  make e2e-int-local     # run integration e2e against a manually started web server (BASE_URL)"
	@echo "  make e2e-int-minimal-local-api  # run minimal integration e2e with current node api"
	@echo "  make e2e-int-chat-local-api     # run chat integration e2e with current node api"
	@echo "  make e2e-int-agent-local-api    # run external-agent integration e2e with current node api"
	@echo "  make e2e-int-chat-real-local-api # run real deepseek chat e2e with current node api"
	@echo "  make e2e-int-chat-auto      # auto start deps+api+web and run integration-chat spec"
	@echo "  make e2e-int-agent-auto     # auto start deps+api+web and run integration-agent spec"
	@echo "  make e2e-int-chat-ux-auto   # auto start deps+api+web and run targeted chat UX integration checks"
	@echo "  make agent-test-runner  # start standalone external agent test runner (requires AGENT_WS_URL + AGENT_KEY)"
	@echo "  make openapi-generate   # generate frontend API types from docs/contracts/specs/openapi.yaml"
	@echo "  make openapi-check-generated # verify generated API types are in sync"
	@echo "  make openapi-changelog  # generate OpenAPI diff changelog vs origin/main"
	@echo "  make contracts-check-openapi # run OpenAPI core coverage + route-kind coverage + breaking checks"
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
	$(NPM) run integration:deps:init:keycloak

deps-init-postgres:
	$(NPM) run integration:deps:init:postgres

deps-init-keycloak:
	$(NPM) run integration:deps:init:keycloak

check-api-port:
	@PORT="$(PORT_API)"; \
	if command -v lsof >/dev/null 2>&1; then \
		if lsof -iTCP:$${PORT} -sTCP:LISTEN -Pn >/dev/null 2>&1; then \
			echo "[make] API port $${PORT} is already in use."; \
			echo "[make] Listening process:"; \
			lsof -iTCP:$${PORT} -sTCP:LISTEN -Pn; \
			echo "[make] Use another port, e.g. 'make api-dev-min PORT_API=20010'."; \
			exit 1; \
		fi; \
	elif command -v ss >/dev/null 2>&1; then \
		if ss -ltn "( sport = :$${PORT} )" | grep -q ":$${PORT}"; then \
			echo "[make] API port $${PORT} is already in use."; \
			echo "[make] Use another port, e.g. 'make api-dev-min PORT_API=20010'."; \
			exit 1; \
		fi; \
	fi

api-dev: check-api-port
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

api-dev-min: check-api-port
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

e2e:
	$(NPM) run test:e2e -- --project=chromium

e2e-local:
	BASE_URL=$(BASE_URL) \
	$(NPM) run test:e2e -- --project=chromium

e2e-int-minimal:
	$(NPM) run test:e2e:integration:minimal

e2e-int-chat:
	$(NPM) run test:e2e:integration:chat

e2e-int-agent:
	$(NPM) run test:e2e:integration:agents

e2e-int-chat-real:
	$(NPM) run test:e2e:integration:chat:real

e2e-int-local:
	BASE_URL=$(BASE_URL) \
	$(NPM) run test:e2e:integration:minimal

e2e-int-minimal-local-api:
	INTEGRATION_API_PORT=$(PORT_API) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	$(NPM) run test:e2e:integration:minimal:with-api

e2e-int-chat-local-api:
	INTEGRATION_API_PORT=$(PORT_API) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	$(NPM) run test:e2e:integration:chat:with-api

e2e-int-agent-local-api:
	INTEGRATION_API_PORT=$(PORT_API) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	$(NPM) run test:e2e:integration:agents:with-api

e2e-int-chat-real-local-api:
	INTEGRATION_API_PORT=$(PORT_API) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	$(NPM) run test:e2e:integration:chat:real:with-api

e2e-int-chat-auto:
	INTEGRATION_API_PORT=$(PORT_API) \
	INTEGRATION_WEB_PORT=$(PORT_WEB) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	KEYCLOAK_URL=$(KEYCLOAK_URL) \
	KEYCLOAK_CLIENT_ID=$(KEYCLOAK_CLIENT_ID) \
	./scripts/run-integration-e2e-full.sh e2e/integration-chat.spec.ts

e2e-int-agent-auto:
	INTEGRATION_API_PORT=$(PORT_API) \
	INTEGRATION_WEB_PORT=$(PORT_WEB) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	KEYCLOAK_URL=$(KEYCLOAK_URL) \
	KEYCLOAK_CLIENT_ID=$(KEYCLOAK_CLIENT_ID) \
	./scripts/run-integration-e2e-full.sh e2e/integration-agents-external.spec.ts

e2e-int-chat-ux-auto:
	INTEGRATION_API_PORT=$(PORT_API) \
	INTEGRATION_WEB_PORT=$(PORT_WEB) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	KEYCLOAK_URL=$(KEYCLOAK_URL) \
	KEYCLOAK_CLIENT_ID=$(KEYCLOAK_CLIENT_ID) \
	./scripts/run-integration-e2e-full.sh e2e/integration-chat.spec.ts --grep "deleting the only thread shows clear empty-state actions and disabled composer|text-only endpoint hides attachment actions in composer"

agent-test-runner:
	@if [ -z "$(AGENT_WS_URL)" ] || [ -z "$(AGENT_KEY)" ]; then \
		echo "[make] Missing AGENT_WS_URL or AGENT_KEY."; \
		echo "[make] Example:"; \
		echo "  make agent-test-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-runtime/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx'"; \
		exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	MBOS_AGENT_WS_URL="$(AGENT_WS_URL)" \
	MBOS_AGENT_KEY="$(AGENT_KEY)" \
	MBOS_AGENT_MODE="$(AGENT_MODE)" \
	$(NPM) run agent:test-runner

openapi-generate:
	$(NPM) run openapi:generate

openapi-check-generated:
	$(NPM) run openapi:check-generated

openapi-changelog:
	$(NPM) run openapi:changelog

contracts-check-openapi:
	$(NPM) run contracts:check-openapi

urls:
	@echo "Frontend:         http://localhost:$(PORT_WEB)/$(LOCALE)/login"
	@echo "API base:         http://localhost:$(PORT_API)/api/v1"
	@echo "API docs:         http://localhost:$(PORT_API)/docs"
	@echo "AsyncAPI viewer:  http://localhost:$(PORT_API)/docs/asyncapi"
	@echo "Keycloak admin:   http://localhost:18080  (admin/admin)"
	@echo "MinIO console:    http://localhost:19001  (mbos/mbos_dev_password)"
	@echo "Test user 1:      dev-admin / dev-admin-123"
	@echo "Test user 2:      integration-user / integration-user-123"
