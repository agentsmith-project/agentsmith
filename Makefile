.PHONY: help bootstrap deps-up deps-ready deps-down deps-reset deps-smoke deps-logs deps-ps deps-init deps-init-postgres deps-init-keycloak \
	check-api-port api-dev api-dev-min web web-msw \
	e2e e2e-local \
	e2e-int-minimal e2e-int-chat e2e-int-agent e2e-int-chat-real e2e-int-local \
	e2e-int-minimal-local-api e2e-int-chat-local-api e2e-int-agent-local-api e2e-int-chat-real-local-api \
	e2e-int-chat-auto e2e-int-agent-auto e2e-int-notebook-agent-auto e2e-int-chat-ux-auto \
	agent-test-runner agent-codex-runner notebook-agent-refresh-token notebook-agent-smoke-task \
	notebook-agent-smoke-full notebook-agent-init-resources notebook-agent-runner \
	notebook-agent-demo-up notebook-agent-demo-down \
	notebook-agent-monitor notebook-agent-load-test notebook-agent-load-matrix \
	notebook-agent-benchmark-baseline notebook-agent-benchmark-compare notebook-agent-traces-query-bench \
	notebook-agent-traces-query-sweep notebook-agent-traces-query-sweep-compare notebook-agent-benchmark-archive \
	openapi-generate openapi-check-generated openapi-changelog contracts-check-openapi urls

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
	@echo "  make bootstrap    # deps-up → wait for ready → deps-init → deps-smoke (ordered)"
	@echo ""
	@echo "Dependencies:"
	@echo "  make deps-up       # start docker deps (postgres+pgvector/mongo/redis/minio/keycloak)"
	@echo "  make deps-ready    # wait for postgres/keycloak to accept connections (after deps-up)"
	@echo "  make deps-init    # apply postgres schemas + seed/reset keycloak users (requires deps-ready)"
	@echo "  make deps-smoke   # verify all deps healthy (requires deps-init for pgvector)"
	@echo "  make deps-init-postgres # apply postgres schemas (projects + pgvector tables)"
	@echo "  make deps-init-keycloak # ensure/reset keycloak integration users"
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
	@echo "  make e2e-int-notebook-agent-auto # auto start deps+api+web and run notebook external-agent integration spec"
	@echo "  make e2e-int-chat-ux-auto   # auto start deps+api+web and run targeted chat UX integration checks"
	@echo "  make agent-test-runner  # start standalone external agent test runner (requires AGENT_WS_URL + AGENT_KEY)"
	@echo "  make agent-codex-runner # start Codex-based external agent runner (requires AGENT_WS_URL + AGENT_KEY)"
	@echo "  make notebook-agent-refresh-token # refresh Keycloak JWT and write /tmp/agentsmith_user_token.txt"
	@echo "  make notebook-agent-init-resources # create project/endpoint/agent/key and write /tmp/agentsmith_*.txt"
	@echo "  make notebook-agent-runner         # start codex runner using /tmp/agentsmith_ws_url.txt + agent_key"
	@echo "  make notebook-agent-demo-up        # one-command demo bootstrap: start api/web, refresh token, init resources, start runner"
	@echo "  make notebook-agent-demo-down      # stop demo-up managed api/web/runner background processes"
	@echo "  make notebook-agent-smoke-task    # create notebook task, post prompt, poll final output"
	@echo "  make notebook-agent-smoke-full    # refresh token + start runner + run notebook smoke task"
	@echo "  make notebook-agent-monitor       # poll notebook runtime internal metrics (auth required)"
	@echo "  make notebook-agent-load-test     # concurrent notebook task load test + summary + metrics snapshot"
	@echo "  make notebook-agent-load-matrix   # run a load matrix and save CSV/JSONL summaries under /tmp"
	@echo "  make notebook-agent-benchmark-baseline # run the standard baseline matrix profile and print summary preview"
	@echo "  make notebook-agent-benchmark-compare  # compare two baseline dirs (BASELINE_A_DIR, BASELINE_B_DIR)"
	@echo "  make notebook-agent-benchmark-archive  # archive a benchmark output dir under artifacts/benchmarks"
	@echo "  make notebook-agent-traces-query-bench # benchmark /tasks/:id/traces?message_id=... query path"
	@echo "  make notebook-agent-traces-query-sweep # compare message-scoped traces query latency across page sizes"
	@echo "  make notebook-agent-traces-query-sweep-compare # compare two traces-query-sweep dirs by page_size"
	@echo "  make openapi-generate   # generate frontend API types from docs/contracts/specs/openapi.yaml"
	@echo "  make openapi-check-generated # verify generated API types are in sync"
	@echo "  make openapi-changelog  # generate OpenAPI diff changelog vs origin/main"
	@echo "  make contracts-check-openapi # run OpenAPI core coverage + route-kind coverage + breaking checks"
	@echo ""
	@echo "Utility:"
	@echo "  make urls          # print local URLs and test users"

deps-up:
	$(NPM) run integration:deps:up

# Wait for integration services to accept connections (Postgres is fast; Keycloak often needs 20–30s).
# Override with DEPS_READY_SLEEP=30 if keycloak init still fails.
DEPS_READY_SLEEP ?= 25
deps-ready: deps-up
	@echo "[make] waiting $(DEPS_READY_SLEEP)s for integration services..."
	@sleep $(DEPS_READY_SLEEP)

# Order: deps-smoke runs last (verifies pgvector, which is created by deps-init).
deps-init: deps-ready
	$(NPM) run integration:deps:init:postgres
	$(NPM) run integration:deps:init:keycloak

deps-smoke: deps-init
	$(NPM) run integration:deps:smoke

bootstrap: deps-smoke

deps-down:
	$(NPM) run integration:deps:down

deps-reset:
	$(NPM) run integration:deps:down:volumes

deps-logs:
	$(NPM) run integration:deps:logs

deps-ps:
	$(NPM) run integration:deps:ps

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

e2e-int-notebook-agent-auto:
	INTEGRATION_API_PORT=$(PORT_API) \
	INTEGRATION_WEB_PORT=$(PORT_WEB) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	KEYCLOAK_URL=$(KEYCLOAK_URL) \
	KEYCLOAK_CLIENT_ID=$(KEYCLOAK_CLIENT_ID) \
	./scripts/run-integration-e2e-full.sh e2e/integration-notebook-external.spec.ts

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

agent-codex-runner:
	@if [ -z "$(AGENT_WS_URL)" ] || [ -z "$(AGENT_KEY)" ]; then \
		echo "[make] Missing AGENT_WS_URL or AGENT_KEY."; \
		echo "[make] Example:"; \
		echo "  make agent-codex-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-runtime/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx'"; \
		exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	MBOS_AGENT_WS_URL="$(AGENT_WS_URL)" \
	MBOS_AGENT_KEY="$(AGENT_KEY)" \
	$(NPM) run agent:codex-runner

notebook-agent-refresh-token:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	node ./scripts/notebook-agent-refresh-token.js

notebook-agent-init-resources:
	@if [ -z "$(GLM_API_KEY)" ]; then \
		echo "[make] Missing GLM_API_KEY."; \
		echo "[make] Example:"; \
		echo "  GLM_API_KEY='***' make notebook-agent-init-resources"; \
		exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	GLM_API_KEY="$(GLM_API_KEY)" \
	./scripts/notebook-agent-init-resources.sh

notebook-agent-runner:
	@set -e; \
	WS_URL="$${AGENT_WS_URL:-$$(cat /tmp/agentsmith_ws_url.txt 2>/dev/null || true)}"; \
	AGENT_KEY_VALUE="$${AGENT_KEY:-$$(cat /tmp/agentsmith_agent_key.txt 2>/dev/null || true)}"; \
	if [ -z "$$WS_URL" ] || [ -z "$$AGENT_KEY_VALUE" ]; then \
		echo "[make] Missing AGENT_WS_URL/AGENT_KEY and no /tmp/agentsmith_ws_url.txt or /tmp/agentsmith_agent_key.txt found."; \
		exit 1; \
	fi; \
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	MBOS_AGENT_WS_URL="$$WS_URL" \
	MBOS_AGENT_KEY="$$AGENT_KEY_VALUE" \
	MBOS_AGENT_RUNNER_DEBUG="$${MBOS_AGENT_RUNNER_DEBUG:-1}" \
	MBOS_AGENT_TASK_TIMEOUT_SEC="$${MBOS_AGENT_TASK_TIMEOUT_SEC:-120}" \
	MBOS_AGENT_CODEX_YOLO="$${MBOS_AGENT_CODEX_YOLO:-1}" \
	$(NPM) run agent:codex-runner

notebook-agent-demo-up:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-demo-up.sh

notebook-agent-demo-down:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-demo-down.sh

notebook-agent-smoke-task:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-smoke-task.sh

notebook-agent-smoke-full:
	@set -e; \
	WS_URL="$${AGENT_WS_URL:-$$(cat /tmp/agentsmith_ws_url.txt 2>/dev/null || true)}"; \
	AGENT_KEY_VALUE="$${AGENT_KEY:-$$(cat /tmp/agentsmith_agent_key.txt 2>/dev/null || true)}"; \
	if [ -z "$$WS_URL" ] || [ -z "$$AGENT_KEY_VALUE" ]; then \
		echo "[make] Missing AGENT_WS_URL/AGENT_KEY and no /tmp/agentsmith_ws_url.txt or /tmp/agentsmith_agent_key.txt found."; \
		exit 1; \
	fi; \
	echo "[make] refreshing token..."; \
	$(MAKE) notebook-agent-refresh-token; \
	echo "[make] starting agent-codex-runner in background..."; \
	( env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
		MBOS_AGENT_WS_URL="$$WS_URL" \
		MBOS_AGENT_KEY="$$AGENT_KEY_VALUE" \
		MBOS_AGENT_RUNNER_DEBUG="$${MBOS_AGENT_RUNNER_DEBUG:-1}" \
		MBOS_AGENT_TASK_TIMEOUT_SEC="$${MBOS_AGENT_TASK_TIMEOUT_SEC:-120}" \
		MBOS_AGENT_CODEX_YOLO="$${MBOS_AGENT_CODEX_YOLO:-1}" \
		$(NPM) run agent:codex-runner ) > /tmp/agentsmith_runner.log 2>&1 & \
	RUNNER_PID=$$!; \
	trap 'kill $$RUNNER_PID >/dev/null 2>&1 || true' EXIT INT TERM; \
	sleep 3; \
	if ! kill -0 $$RUNNER_PID >/dev/null 2>&1; then \
		echo "[make] runner exited early. tail /tmp/agentsmith_runner.log:"; \
		tail -n 80 /tmp/agentsmith_runner.log || true; \
		exit 1; \
	fi; \
	echo "[make] waiting for agent runner websocket to be ready..."; \
	for i in 1 2 3 4 5 6 7 8 9 10; do \
		if rg -q "\\[agent-codex-runner\\] connected|websocket open" /tmp/agentsmith_runner.log 2>/dev/null; then \
			break; \
		fi; \
		sleep 1; \
	done; \
	echo "[make] running notebook smoke task..."; \
	set +e; \
	$(MAKE) notebook-agent-smoke-task; \
	SMOKE_RC=$$?; \
	set -e; \
	if [ "$$SMOKE_RC" -eq 42 ]; then \
		echo "[make] smoke failed due to expired token; refreshing and retrying once..."; \
		$(MAKE) notebook-agent-refresh-token; \
		$(MAKE) notebook-agent-smoke-task; \
	elif [ "$$SMOKE_RC" -ne 0 ]; then \
		exit "$$SMOKE_RC"; \
	fi; \
	echo "[make] smoke done. recent runner log:"; \
	tail -n 40 /tmp/agentsmith_runner.log || true

notebook-agent-monitor:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-monitor.sh

notebook-agent-load-test:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-load-test.sh

notebook-agent-load-matrix:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-load-matrix.sh

notebook-agent-benchmark-baseline:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-benchmark-baseline.sh

notebook-agent-benchmark-compare:
	@if [ -z "$$BASELINE_A_DIR" ] || [ -z "$$BASELINE_B_DIR" ]; then \
		echo "[make] Usage: BASELINE_A_DIR=/tmp/... BASELINE_B_DIR=/tmp/... make notebook-agent-benchmark-compare"; \
		exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	node ./scripts/notebook-agent-benchmark-compare.js

notebook-agent-benchmark-archive:
	@if [ -z "$$SOURCE_DIR" ]; then \
		echo "[make] Usage: SOURCE_DIR=/tmp/... make notebook-agent-benchmark-archive"; \
		exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	node ./scripts/notebook-agent-benchmark-archive.js

notebook-agent-traces-query-bench:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-traces-query-bench.sh

notebook-agent-traces-query-sweep:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-traces-query-sweep.sh

notebook-agent-traces-query-sweep-compare:
	@if [ -z "$$SWEEP_A_DIR" ] || [ -z "$$SWEEP_B_DIR" ]; then \
		echo "[make] Usage: SWEEP_A_DIR=/tmp/... SWEEP_B_DIR=/tmp/... make notebook-agent-traces-query-sweep-compare"; \
		exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	node ./scripts/notebook-agent-traces-query-sweep-compare.js

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
