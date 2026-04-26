.PHONY: help help-extended quick-help help-glossary bootstrap deps-up deps-ready deps-down deps-reset deps-smoke deps-logs deps-ps deps-init deps-init-postgres deps-init-keycloak \
	check-api-port api-dev api-dev-min web web-msw \
	e2e e2e-local \
	e2e-int-minimal e2e-int-chat e2e-int-agent e2e-int-chat-real e2e-int-local \
	e2e-int-minimal-local-api e2e-int-chat-local-api e2e-int-agent-local-api e2e-int-chat-real-local-api \
	e2e-int-chat-auto e2e-int-agent-auto e2e-int-notebook-agent-auto e2e-int-chat-ux-auto \
	e2e-int-core-local-api e2e-int-core-auto governance-core-smoke \
	agent-test-runner notebook-runner chat-runner notebook-agent-refresh-token notebook-agent-smoke-task notebook-agent-credential-sync-smoke \
	notebook-agent-engineering-smoke notebook-agent-engineering-smoke-full governance-smoke governance-pages-real-backend-smoke governance-pages-real-backend-smoke-strict governance-pages-real-backend-smoke-tolerant governance-pages-real-backend-interaction-smoke governance-pages-real-backend-interaction-smoke-strict governance-pages-real-backend-interaction-smoke-tolerant governance-policy-effect-smoke \
	substrate-up substrate-down substrate-reset substrate-reseed substrate-status \
	governance-policy-access-effect-smoke governance-policy-group-access-effect-smoke governance-policy-update-audit-smoke governance-config-audit-effect-smoke governance-policy-spending-effect-smoke governance-policy-requests-rate-effect-smoke governance-member-permission-effect-smoke governance-member-lifecycle-effect-smoke \
	build-reliability-smoke workspace-governance-smoke workspace-overview-smoke \
	notebook-agent-smoke-full notebook-agent-init-resources notebook-agent-runner \
	local-real-up local-real-down local-real-status local-real-reset \
	local-manual-up local-manual-down local-manual-status local-manual-reset local-manual-seed-notebook \
	local-manual-internal-up local-manual-internal-down local-manual-internal-status local-manual-internal-reset local-manual-internal-smoke \
	demo-rehearsal-up demo-rehearsal-down demo-rehearsal-status demo-rehearsal-reset demo-rehearsal-bootstrap demo-rehearsal-verify demo-rehearsal-report \
	cluster-rehearsal-up cluster-rehearsal-down cluster-rehearsal-status cluster-rehearsal-reset cluster-rehearsal-bootstrap cluster-rehearsal-verify cluster-rehearsal-report \
	notebook-agent-no-sandbox-smoke notebook-agent-no-sandbox-assert \
	notebook-agent-monitor notebook-agent-load-test notebook-agent-load-matrix \
	notebook-agent-benchmark-baseline notebook-agent-benchmark-compare notebook-agent-traces-query-bench \
	notebook-agent-traces-query-sweep notebook-agent-traces-query-sweep-compare notebook-agent-benchmark-archive \
	model-request-stream-bench model-request-stream-bench-gate usage-report-runner-status usage-report-run-due \
	openapi-generate openapi-check-generated openapi-changelog contracts-check-openapi urls \
	verify-contracts verify-governance \
	mvp-freeze-check preprod-acceptance-check \
	preprod-ensure-pgvector preprod-capture-baseline \
	sandbox-preflight sandbox-api-dev sandbox-joint-smoke \
	ensure-default-workspace real-stack-ready \
	manual-feishu-admin manual-feishu-user manual-feishu-check

NPM ?= npm

# Load local non-committed developer overrides/secrets.
# .env.local is already gitignored in standard setups.
-include .env.local

PORT_API ?= 20000
PORT_WEB ?= 3001

KEYCLOAK_BASE_URL ?= http://localhost:18080
KEYCLOAK_REALM ?= mbos
KEYCLOAK_URL ?= http://localhost:18080/realms
KEYCLOAK_CLIENT_ID ?= agentsmith
INTEGRATION_DEV_ADMIN_USERNAME ?= dev-admin
INTEGRATION_DEV_ADMIN_PASSWORD ?= dev-admin-123
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
BUILTIN_SKILLS_DIR_DEFAULT ?= $(CURDIR)/packages/notebook-codex-runner/builtin-skills
MBOS_UNIVERSAL_PROXY_BASE_URL ?= http://127.0.0.1:38080

LOCALE ?= en-US
BASE_URL ?= http://localhost:$(PORT_WEB)

help:
	@echo "MBOS MVP Help"
	@echo ""
	@$(MAKE) quick-help
	@echo ""
	@echo "More commands:"
	@echo "  make help-extended  # clean human command details"
	@echo "  make help-glossary  # term definitions"

# current-workflow:help-extended:start
help-extended:
	@echo "MBOS Current Engineering Commands"
	@echo ""
	@echo "Current path (lowest cognitive load):"
	@echo "  make quick-help     # show only the recommended day-to-day commands"
	@echo "  make help-glossary  # explain common testing/engineering terms in plain language"
	@echo "  note: gate/lane/backend-real/release:campaign scripts are internal adapters, not default human entrypoints"
	@echo ""
	@echo "Environment:"
	@echo "  npm run dev  # start the Next.js development server"
	@echo "  make local-real-up  # start the real local environment through the local-manual adapter"
	@echo "  make local-real-status  # show substrate and local-manual adapter status"
	@echo "  make local-real-down  # stop the real local environment through the local-manual adapter"
	@echo "  make local-real-reset  # reset the real local environment through the local-manual adapter"
	@echo ""
	@echo "Tests:"
	@echo "  npm run verify  # write a dry-run story acceptance report and print the recommended verification plan"
	@echo ""
	@echo "Release:"
	@echo "  npm run release:ready  # run the human-friendly release readiness wrapper"
	@echo "  npm run release:status  # read the latest release summary in read-only mode"
	@echo "  npm run rehearse:demo  # run the demo deployment rehearsal adapter"
	@echo "  npm run rehearse:cluster  # run the cluster deployment rehearsal adapter"
	@echo ""
	@echo "Internal adapters:"
	@echo "  package.json keeps gate/lane/backend-real/release:campaign scripts for CI, release:ready, and evidence owners."
	@echo "  They are intentionally omitted from help output as copyable human defaults."
	@echo ""
# current-workflow:help-extended:end

# current-workflow:quick-help:start
quick-help:
	@echo "MBOS Quick Human Commands"
	@echo ""
	@echo "  note: quick-help shows clean human entrypoints only; internal adapters stay behind release:ready, CI, or owner runbooks"
	@echo ""
	@echo "  npm run dev"
	@echo "    Start the Next.js development server."
	@echo ""
	@echo "  make local-real-up"
	@echo "    Start the real local environment through the local-manual adapter."
	@echo ""
	@echo "  make local-real-status"
	@echo "    Show substrate and local-manual adapter status."
	@echo ""
	@echo "  make local-real-down"
	@echo "    Stop the real local environment through the local-manual adapter."
	@echo ""
	@echo "  make local-real-reset"
	@echo "    Reset the real local environment through the local-manual adapter."
	@echo ""
	@echo "  npm run verify"
	@echo "    Write a dry-run story acceptance report and print the recommended verification plan."
	@echo ""
	@echo "  npm run release:ready"
	@echo "    Run the human-friendly release readiness wrapper."
	@echo ""
	@echo "  npm run release:status"
	@echo "    Read the latest release summary in read-only mode."
	@echo ""
	@echo "  npm run rehearse:demo"
	@echo "    Run the demo deployment rehearsal adapter."
	@echo ""
	@echo "  npm run rehearse:cluster"
	@echo "    Run the cluster deployment rehearsal adapter."
	@echo ""
# current-workflow:quick-help:end

help-glossary:
	@echo "MBOS Terms (Plain Language)"
	@echo ""
	@echo "  governance"
	@echo "    Rules that control who can access resources and how much they can use."
	@echo "    In this repo it mainly covers members + resource policy + audit + usage."
	@echo ""
	@echo "  verification channel"
	@echo "    A full verification path with its own source of truth, such as mock, visual, or real backend."
	@echo ""
	@echo "  contracts"
	@echo "    The agreed API/schema/rules between frontend and backend."
	@echo "    We validate them with OpenAPI checks to prevent accidental breaking changes."
	@echo ""
	@echo "  light verification"
	@echo "    A fast sanity check to prove a critical path still works."
	@echo ""
	@echo "  default e2e gate"
	@echo "    Default mock UI regression range: light verification + default e2e."
	@echo "    Visual is a separate verification channel."
	@echo ""
	@echo "  engineering gate"
	@echo "    The must-pass checks before saying a build is releasable."

build-reliability-smoke:
	./scripts/build-reliability-smoke.sh

workspace-governance-smoke:
	./scripts/workspace-governance-smoke.sh

workspace-overview-smoke:
	./scripts/workspace-overview-smoke.sh

verify-contracts:
	$(NPM) run ws:typecheck
	$(NPM) run contracts:check-doc-governance
	$(NPM) run openapi:check-generated
	$(NPM) run contracts:check-openapi

verify-governance:
	@set -e; \
	$(NPM) run gate:default

mvp-freeze-check:
	@set -e; \
	$(MAKE) verify-contracts; \
	$(MAKE) governance-core-smoke; \
	$(MAKE) local-manual-status

preprod-acceptance-check:
	./scripts/preprod-acceptance-check.sh

preprod-ensure-pgvector:
	./scripts/preprod-ensure-pgvector.sh

preprod-capture-baseline:
	./scripts/preprod-capture-baseline.sh

# Generate governance report (JSON + Markdown) after verify-governance
# Use REPORT_NAME=name to customize, REPORT_COMMIT_RANGE=range to specify commits
# Use REPORT_ARCHIVE=1 to create timestamped archive
# Use REPORT_CHECKS=check1,check2 to run a subset of engineering checks
# Use REPORT_EXECUTION_EVIDENCE=/abs/path/execution-review-evidence.json to reuse an existing execution evidence artifact
# Use REPORT_WORKSPACE_GOVERNANCE_EVIDENCE=/abs/path/workspace-governance-evidence.json to reuse an existing workspace governance evidence artifact
# Use REPORT_ORGANIZATION_GOVERNANCE_EVIDENCE=/abs/path/organization-governance-evidence.json to reuse an existing organization governance evidence artifact
governance-report:
	@set -e; \
	NAME=$${REPORT_NAME:-}; \
	RANGE=$${REPORT_COMMIT_RANGE:-}; \
	ARCHIVE=$${REPORT_ARCHIVE:-}; \
	CHECKS=$${REPORT_CHECKS:-}; \
	EXECUTION_EVIDENCE=$${REPORT_EXECUTION_EVIDENCE:-}; \
	WORKSPACE_GOVERNANCE_EVIDENCE=$${REPORT_WORKSPACE_GOVERNANCE_EVIDENCE:-}; \
	ORGANIZATION_GOVERNANCE_EVIDENCE=$${REPORT_ORGANIZATION_GOVERNANCE_EVIDENCE:-}; \
	EXTRA_ARGS=""; \
	[ -n "$$NAME" ] && EXTRA_ARGS="$$EXTRA_ARGS --name $$NAME"; \
	[ -n "$$RANGE" ] && EXTRA_ARGS="$$EXTRA_ARGS --commit-range $$RANGE"; \
	[ -n "$$CHECKS" ] && EXTRA_ARGS="$$EXTRA_ARGS --checks $$CHECKS"; \
	[ -n "$$EXECUTION_EVIDENCE" ] && EXTRA_ARGS="$$EXTRA_ARGS --execution-evidence $$EXECUTION_EVIDENCE"; \
	[ -n "$$WORKSPACE_GOVERNANCE_EVIDENCE" ] && EXTRA_ARGS="$$EXTRA_ARGS --workspace-governance-evidence $$WORKSPACE_GOVERNANCE_EVIDENCE"; \
	[ -n "$$ORGANIZATION_GOVERNANCE_EVIDENCE" ] && EXTRA_ARGS="$$EXTRA_ARGS --organization-governance-evidence $$ORGANIZATION_GOVERNANCE_EVIDENCE"; \
	[ "$$ARCHIVE" = "1" ] && EXTRA_ARGS="$$EXTRA_ARGS --archive"; \
	$(NPM) run governance:report -- $$EXTRA_ARGS

# Run verify-governance and generate report in one command
verify-governance-with-report:
	@set -e; \
	echo "[make] Running verify-governance..."; \
	$(MAKE) verify-governance; \
	echo "[make] Generating governance report..."; \
	$(MAKE) governance-report REPORT_ARCHIVE=1

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

ensure-default-workspace:
	MONGO_URL=$(MONGO_URL) \
	MONGO_DB_NAME=$(MONGO_DB_NAME) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
	KEYCLOAK_CLIENT_ID=$(KEYCLOAK_CLIENT_ID) \
	npx tsx scripts/ensure-default-workspace.ts

real-stack-ready:
	API_BASE=http://localhost:$(PORT_API) \
	BASE_URL=http://localhost:$(PORT_WEB) \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	bash scripts/wait-real-stack-ready.sh

manual-feishu-admin:
	npm run manual:feishu:admin

manual-feishu-user:
	npm run manual:feishu:user

manual-feishu-check:
	npm run manual:feishu:check

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
	./scripts/with-local-env.sh env \
		PORT=$(PORT_API) \
		KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
		KEYCLOAK_REALM=$(KEYCLOAK_REALM) \
		KEYCLOAK_CLIENT_ID=$(KEYCLOAK_CLIENT_ID) \
		PUBLIC_KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
		INTERNAL_KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
		KEYCLOAK_ISSUER_URL=$(KEYCLOAK_BASE_URL)/realms/$(KEYCLOAK_REALM) \
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
		MBOS_UNIVERSAL_PROXY_BASE_URL=$(MBOS_UNIVERSAL_PROXY_BASE_URL) \
		$(NPM) run api:node:dev

api-dev-min: check-api-port
	./scripts/with-local-env.sh env \
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
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	PUBLIC_KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	INTERNAL_KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) \
	MONGO_URL=$(MONGO_URL) \
	MONGO_DB_NAME=$(MONGO_DB_NAME) \
	$(NPM) run dev:test -- --port $(PORT_WEB)

web-msw:
	NEXT_PUBLIC_USE_MSW=true \
	$(NPM) run dev:test -- --port $(PORT_WEB)

e2e:
	$(NPM) run test:e2e

e2e-local:
	BASE_URL=$(BASE_URL) \
	$(NPM) run test:e2e

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

e2e-int-core-local-api:
	@set -e; \
	echo "[make] running integration-minimal..."; \
	BASE_URL=http://localhost:$(PORT_WEB) INTEGRATION_API_BASE=http://localhost:$(PORT_API) \
	npx playwright test --config playwright.config.integration.ts e2e/integration-minimal.spec.ts --project=chromium --workers=1; \
	echo "[make] running integration-chat-protocols..."; \
	BASE_URL=http://localhost:$(PORT_WEB) INTEGRATION_API_BASE=http://localhost:$(PORT_API) \
	npx playwright test --config playwright.config.integration.ts e2e/integration-chat-protocols.spec.ts --project=chromium --workers=1; \
	echo "[make] running integration-chat stream-error recovery set..."; \
	BASE_URL=http://localhost:$(PORT_WEB) INTEGRATION_API_BASE=http://localhost:$(PORT_API) \
	npx playwright test --config playwright.config.integration.ts e2e/integration-chat.spec.ts --project=chromium --workers=1 \
	--grep "chat surfaces upstream 429 message and can recover|chat surfaces upstream 401 message and can recover|chat surfaces upstream 403 message and can recover"

e2e-int-core-auto:
	@set -e; \
	API_PORT_1=$(PORT_API); WEB_PORT_1=$(PORT_WEB); \
	API_PORT_2=$$(( $(PORT_API) + 10 )); WEB_PORT_2=$$(( $(PORT_WEB) + 10 )); \
	API_PORT_3=$$(( $(PORT_API) + 20 )); WEB_PORT_3=$$(( $(PORT_WEB) + 20 )); \
	echo "[make] auto smoke: integration-minimal"; \
	INTEGRATION_API_PORT=$$API_PORT_1 INTEGRATION_WEB_PORT=$$WEB_PORT_1 \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) KEYCLOAK_REALM=$(KEYCLOAK_REALM) KEYCLOAK_URL=$(KEYCLOAK_URL) KEYCLOAK_CLIENT_ID=$(KEYCLOAK_CLIENT_ID) \
	./scripts/run-integration-e2e-full.sh e2e/integration-minimal.spec.ts; \
	echo "[make] auto smoke: integration-chat-protocols"; \
	INTEGRATION_BOOTSTRAP_DEPS=false INTEGRATION_INIT_DEPS=false \
	INTEGRATION_API_PORT=$$API_PORT_2 INTEGRATION_WEB_PORT=$$WEB_PORT_2 \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) KEYCLOAK_REALM=$(KEYCLOAK_REALM) KEYCLOAK_URL=$(KEYCLOAK_URL) KEYCLOAK_CLIENT_ID=$(KEYCLOAK_CLIENT_ID) \
	./scripts/run-integration-e2e-full.sh e2e/integration-chat-protocols.spec.ts; \
	echo "[make] auto smoke: integration-chat stream-error recovery"; \
	INTEGRATION_BOOTSTRAP_DEPS=false INTEGRATION_INIT_DEPS=false \
	INTEGRATION_API_PORT=$$API_PORT_3 INTEGRATION_WEB_PORT=$$WEB_PORT_3 \
	KEYCLOAK_BASE_URL=$(KEYCLOAK_BASE_URL) KEYCLOAK_REALM=$(KEYCLOAK_REALM) KEYCLOAK_URL=$(KEYCLOAK_URL) KEYCLOAK_CLIENT_ID=$(KEYCLOAK_CLIENT_ID) \
	./scripts/run-integration-e2e-full.sh e2e/integration-chat.spec.ts \
	--grep "chat surfaces upstream 429 message and can recover|chat surfaces upstream 401 message and can recover|chat surfaces upstream 403 message and can recover"

governance-core-smoke:
	@set -e; \
	$(MAKE) e2e-int-core-local-api; \
	BASE_URL=$${BASE_URL:-http://localhost:3001} $(MAKE) notebook-agent-refresh-token; \
	$(MAKE) governance-policy-requests-rate-effect-smoke; \
	$(MAKE) governance-report REPORT_ARCHIVE=1 REPORT_CHECKS=typecheck,openapi-check,contracts-check

agent-test-runner:
	@if [ -z "$(AGENT_WS_URL)" ] || [ -z "$(AGENT_KEY)" ]; then \
		echo "[make] Missing AGENT_WS_URL or AGENT_KEY."; \
		echo "[make] Example:"; \
		echo "  make agent-test-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx'"; \
		exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	MBOS_RUNNER_MODE="$${MBOS_RUNNER_MODE:-host_external}" \
	MBOS_AGENT_WS_URL="$(AGENT_WS_URL)" \
	MBOS_AGENT_KEY="$(AGENT_KEY)" \
	MBOS_AGENT_MODE="$(AGENT_MODE)" \
	$(NPM) run agent:test-runner

notebook-runner:
	@if [ -z "$(AGENT_WS_URL)" ] || [ -z "$(AGENT_KEY)" ]; then \
		echo "[make] Missing AGENT_WS_URL or AGENT_KEY."; \
		echo "[make] Example:"; \
		echo "  make notebook-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx'"; \
		exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	MBOS_RUNNER_MODE="$${MBOS_RUNNER_MODE:-host_external}" \
	MBOS_AGENT_WS_URL="$(AGENT_WS_URL)" \
	MBOS_AGENT_KEY="$(AGENT_KEY)" \
	MBOS_AGENT_BUILTIN_SKILLS_DIR="$${MBOS_AGENT_BUILTIN_SKILLS_DIR:-$(BUILTIN_SKILLS_DIR_DEFAULT)}" \
	MBOS_AGENT_BUILTIN_SKILLS="$${MBOS_AGENT_BUILTIN_SKILLS:-feishu-docs,jira-ops}" \
	MBOS_AGENT_BUILTIN_SKILLS_REQUIRED="$${MBOS_AGENT_BUILTIN_SKILLS_REQUIRED:-1}" \
	$(NPM) run agent:notebook-runner

chat-runner:
	@if [ -z "$(AGENT_WS_URL)" ] || [ -z "$(AGENT_KEY)" ]; then \
		echo "[make] Missing AGENT_WS_URL or AGENT_KEY."; \
		echo "[make] Example:"; \
		echo "  make chat-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx'"; \
		exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	MBOS_RUNNER_MODE="$${MBOS_RUNNER_MODE:-host_external}" \
	MBOS_AGENT_WS_URL="$(AGENT_WS_URL)" \
	MBOS_AGENT_KEY="$(AGENT_KEY)" \
	$(NPM) run agent:chat-runner

notebook-agent-refresh-token:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	MBOS_DEV_USERNAME="$(INTEGRATION_DEV_ADMIN_USERNAME)" \
	MBOS_DEV_PASSWORD="$(INTEGRATION_DEV_ADMIN_PASSWORD)" \
	KEYCLOAK_CLIENT_ID="$(KEYCLOAK_CLIENT_ID)" \
	KEYCLOAK_REALM="$(KEYCLOAK_REALM)" \
	KEYCLOAK_BASE_URL="$(KEYCLOAK_BASE_URL)" \
	REFRESH_TOKEN_FORCE_PASSWORD_GRANT=1 \
	REFRESH_TOKEN_READ_APP_SESSION=0 \
	node ./scripts/notebook-agent-refresh-token.js

notebook-agent-init-resources:
	@if [ -z "$(PRESET_ENDPOINT_API_KEY)" ]; then \
		echo "[make] Missing PRESET_ENDPOINT_API_KEY."; \
		echo "[make] Example:"; \
		echo "  PRESET_ENDPOINT_API_KEY='***' PRESET_ANTHROPIC_ENDPOINT_BASE_URL='<YOUR_ANTHROPIC_BASE_URL>' PRESET_ENDPOINT_MODEL='<YOUR_MODEL_ID>' PRESET_ANTHROPIC_ENDPOINT_PROTOCOL='anthropic_messages' make notebook-agent-init-resources"; \
		exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	PRESET_ENDPOINT_API_KEY="$(PRESET_ENDPOINT_API_KEY)" \
	PRESET_ENDPOINT_MODEL="$(PRESET_ENDPOINT_MODEL)" \
	PRESET_ANTHROPIC_ENDPOINT_BASE_URL="$(PRESET_ANTHROPIC_ENDPOINT_BASE_URL)" \
	PRESET_ANTHROPIC_ENDPOINT_PROTOCOL="$(PRESET_ANTHROPIC_ENDPOINT_PROTOCOL)" \
	PRESET_ENDPOINT_MAX_CONTEXT_TOKENS="$(PRESET_ENDPOINT_MAX_CONTEXT_TOKENS)" \
	PRESET_ENDPOINT_MAX_OUTPUT_TOKENS="$(PRESET_ENDPOINT_MAX_OUTPUT_TOKENS)" \
	./scripts/notebook-agent-init-resources.sh

notebook-agent-runner:
	@set -e; \
	STATE_FILE="$${BACKEND_REAL_STATE_FILE:-$(CURDIR)/artifacts/backend-real/current/state.json}"; \
	WS_URL="$${AGENT_WS_URL:-$$(node -e 'const fs=require("node:fs"); const f=process.argv[1]; if(fs.existsSync(f)){const j=JSON.parse(fs.readFileSync(f,"utf8")); process.stdout.write(j?.agent?.ws_url||"")}' "$$STATE_FILE" 2>/dev/null || true)}"; \
	AGENT_KEY_VALUE="$${AGENT_KEY:-$$(node -e 'const fs=require("node:fs"); const f=process.argv[1]; if(fs.existsSync(f)){const j=JSON.parse(fs.readFileSync(f,"utf8")); process.stdout.write(j?.agent?.key||"")}' "$$STATE_FILE" 2>/dev/null || true)}"; \
	if [ -z "$$WS_URL" ] || [ -z "$$AGENT_KEY_VALUE" ]; then \
		echo "[make] Missing AGENT_WS_URL/AGENT_KEY and no backend-real state agent metadata found."; \
		exit 1; \
	fi; \
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	MBOS_RUNNER_MODE="$${MBOS_RUNNER_MODE:-host_external}" \
	MBOS_AGENT_WS_URL="$$WS_URL" \
	MBOS_AGENT_KEY="$$AGENT_KEY_VALUE" \
	MBOS_AGENT_BUILTIN_SKILLS_DIR="$${MBOS_AGENT_BUILTIN_SKILLS_DIR:-$(BUILTIN_SKILLS_DIR_DEFAULT)}" \
	MBOS_AGENT_BUILTIN_SKILLS="$${MBOS_AGENT_BUILTIN_SKILLS:-feishu-docs,jira-ops}" \
	MBOS_AGENT_BUILTIN_SKILLS_REQUIRED="$${MBOS_AGENT_BUILTIN_SKILLS_REQUIRED:-1}" \
	MBOS_AGENT_RUNNER_DEBUG="$${MBOS_AGENT_RUNNER_DEBUG:-1}" \
	MBOS_AGENT_TASK_TIMEOUT_SEC="$${MBOS_AGENT_TASK_TIMEOUT_SEC:-120}" \
	MBOS_AGENT_CODEX_YOLO="$${MBOS_AGENT_CODEX_YOLO:-1}" \
	AGENT_WS_URL="$$WS_URL" \
	AGENT_KEY="$$AGENT_KEY_VALUE" \
	$(MAKE) notebook-runner

substrate-up:
	SUBSTRATE="$${SUBSTRATE:-local-dev}" \
	bash ./scripts/substrate/up.sh

substrate-down:
	SUBSTRATE="$${SUBSTRATE:-local-dev}" \
	bash ./scripts/substrate/down.sh

substrate-reset:
	SUBSTRATE="$${SUBSTRATE:-local-dev}" \
	bash ./scripts/substrate/reset.sh

substrate-reseed:
	SUBSTRATE="$${SUBSTRATE:-local-dev}" \
	bash ./scripts/substrate/reseed.sh

substrate-status:
	SUBSTRATE="$${SUBSTRATE:-local-dev}" \
	bash ./scripts/substrate/status.sh


demo-rehearsal-up:
	./scripts/demo-rehearsal-up.sh

demo-rehearsal-down:
	./scripts/demo-rehearsal-down.sh

demo-rehearsal-status:
	./scripts/demo-rehearsal-status.sh

demo-rehearsal-reset:
	./scripts/demo-rehearsal-reset.sh

demo-rehearsal-bootstrap:
	./scripts/demo-rehearsal-bootstrap.sh

demo-rehearsal-verify:
	./scripts/demo-rehearsal-verify.sh

demo-rehearsal-report:
	./scripts/demo-rehearsal-report.sh

cluster-rehearsal-up:
	./scripts/cluster-rehearsal-up.sh

cluster-rehearsal-down:
	./scripts/cluster-rehearsal-down.sh

cluster-rehearsal-status:
	./scripts/cluster-rehearsal-status.sh

cluster-rehearsal-reset:
	./scripts/cluster-rehearsal-reset.sh

cluster-rehearsal-bootstrap:
	./scripts/cluster-rehearsal-bootstrap.sh

cluster-rehearsal-verify:
	./scripts/cluster-rehearsal-verify.sh

cluster-rehearsal-report:
	./scripts/cluster-rehearsal-report.sh

local-manual-up:
	./scripts/local-manual-up.sh

local-manual-seed-notebook:
	./scripts/local-manual/seed-notebook-demo.sh

local-manual-down:
	./scripts/local-manual-down.sh

local-manual-status:
	./scripts/local-manual-status.sh

local-manual-reset:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/local-manual-down.sh && $(MAKE) substrate-reset SUBSTRATE=local-dev && $(MAKE) local-manual-up && $(MAKE) local-manual-seed-notebook

local-real-up:
	$(MAKE) substrate-up
	$(MAKE) substrate-reseed
	$(MAKE) local-manual-up

local-real-status:
	$(MAKE) substrate-status
	$(MAKE) local-manual-status

local-real-down:
	$(MAKE) local-manual-down

local-real-reset:
	$(MAKE) local-manual-reset

local-manual-internal-up:
	./scripts/local-manual-internal-up.sh

local-manual-internal-down:
	./scripts/local-manual-internal-down.sh

local-manual-internal-status:
	./scripts/local-manual-internal-status.sh

local-manual-internal-reset:
	./scripts/local-manual-internal-reset.sh

local-manual-internal-smoke:
	./scripts/local-manual-internal-smoke.sh

notebook-agent-no-sandbox-smoke:
	@set -e; \
	echo "[make] no-sandbox smoke: real dev stack readiness check"; \
	$(MAKE) local-manual-status; \
	echo "[make] no-sandbox smoke: internal path must fail fast when sandbox is absent"; \
	$(MAKE) notebook-agent-no-sandbox-assert

notebook-agent-no-sandbox-assert:
	$(NPM) -s run test -- packages/api-entry-node/src/index.test.ts -t "AGENT_SANDBOX_NOT_CONFIGURED for internal agent"

notebook-agent-smoke-task:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-smoke-task.sh

notebook-agent-credential-sync-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-credential-sync-smoke.sh

notebook-agent-engineering-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-engineering-smoke.sh

notebook-agent-engineering-smoke-full:
	@set -e; \
	echo "[make] checking real dev stack status..."; \
	$(MAKE) local-manual-status; \
	echo "[make] running engineering smoke bundle..."; \
	$(MAKE) notebook-agent-engineering-smoke

governance-pages-real-backend-smoke:
	$(MAKE) governance-pages-real-backend-smoke-tolerant

governance-pages-real-backend-smoke-strict:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	GOVERNANCE_SMOKE_MODE=strict \
	node ./scripts/governance-pages-real-backend-smoke.js

governance-pages-real-backend-smoke-tolerant:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	GOVERNANCE_SMOKE_MODE=tolerant \
	node ./scripts/governance-pages-real-backend-smoke.js

governance-pages-real-backend-interaction-smoke:
	$(MAKE) governance-pages-real-backend-interaction-smoke-tolerant

governance-pages-real-backend-interaction-smoke-strict:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	GOVERNANCE_SMOKE_MODE=strict \
	node ./scripts/governance-pages-real-backend-interaction-smoke.js

governance-pages-real-backend-interaction-smoke-tolerant:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	GOVERNANCE_SMOKE_MODE=tolerant \
	node ./scripts/governance-pages-real-backend-interaction-smoke.js

governance-audit-real-backend-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	GOVERNANCE_SMOKE_MODE=strict GOV_PAGE_FILTER=audit \
	node ./scripts/governance-pages-real-backend-interaction-smoke.js

governance-usage-real-backend-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	GOVERNANCE_SMOKE_MODE=strict GOV_PAGE_FILTER=usage \
	node ./scripts/governance-pages-real-backend-interaction-smoke.js

governance-policy-effect-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/governance-policy-effect-smoke.sh

governance-policy-access-effect-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/governance-policy-access-effect-smoke.sh

governance-policy-group-access-effect-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/governance-policy-group-access-effect-smoke.sh

governance-policy-update-audit-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/governance-policy-update-audit-smoke.sh

governance-config-audit-effect-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/governance-config-audit-effect-smoke.sh

governance-policy-spending-effect-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/governance-policy-spending-effect-smoke.sh

governance-policy-requests-rate-effect-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/governance-policy-requests-rate-effect-smoke.sh

governance-member-permission-effect-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/governance-member-permission-effect-smoke.sh

governance-member-lifecycle-effect-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/governance-member-lifecycle-effect-smoke.sh

governance-sse-ticket-effect-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/governance-sse-ticket-effect-smoke.sh

governance-smoke:
	@set -e; \
	echo "[make] governance smoke preflight: require real dev platform to be up"; \
	$(MAKE) local-manual-status; \
	run_with_token_retry() { \
		STEP_NAME="$$1"; \
		if ! $(MAKE) "$$STEP_NAME"; then \
			echo "[make] $$STEP_NAME failed; attempting token refresh and retry once"; \
			if ! BASE_URL="$${BASE_URL:-http://localhost:3001}" REFRESH_TOKEN_READ_APP_SESSION=0 $(MAKE) notebook-agent-refresh-token; then \
				echo "[make] token refresh failed while retrying $$STEP_NAME"; \
				exit 1; \
			fi; \
			$(MAKE) "$$STEP_NAME"; \
		fi; \
	}; \
	$(MAKE) governance-pages-real-backend-smoke-strict; \
	$(MAKE) governance-pages-real-backend-interaction-smoke-strict; \
	$(MAKE) workspace-overview-smoke; \
	run_with_token_retry governance-policy-access-effect-smoke; \
	run_with_token_retry governance-policy-group-access-effect-smoke; \
	run_with_token_retry governance-policy-update-audit-smoke; \
	run_with_token_retry governance-config-audit-effect-smoke; \
	run_with_token_retry governance-policy-effect-smoke; \
	run_with_token_retry governance-policy-spending-effect-smoke; \
	run_with_token_retry governance-policy-requests-rate-effect-smoke; \
	run_with_token_retry governance-member-lifecycle-effect-smoke; \
	run_with_token_retry governance-sse-ticket-effect-smoke; \
	if [ -n "$${GOVERNANCE_EVIDENCE_PATH:-}" ]; then \
		node ./scripts/write-governance-evidence.js "$${GOVERNANCE_EVIDENCE_PATH}"; \
	fi

notebook-agent-smoke-full:
	@set -e; \
	STATE_FILE="$${BACKEND_REAL_STATE_FILE:-$(CURDIR)/artifacts/backend-real/current/state.json}"; \
	RUNNER_LOG="$${RUNNER_LOG:-$(CURDIR)/artifacts/backend-real/current/runner-smoke.log}"; \
	WS_URL="$${AGENT_WS_URL:-$$(node -e 'const fs=require("node:fs"); const f=process.argv[1]; if(fs.existsSync(f)){const j=JSON.parse(fs.readFileSync(f,"utf8")); process.stdout.write(j?.agent?.ws_url||"")}' "$$STATE_FILE" 2>/dev/null || true)}"; \
	AGENT_KEY_VALUE="$${AGENT_KEY:-$$(node -e 'const fs=require("node:fs"); const f=process.argv[1]; if(fs.existsSync(f)){const j=JSON.parse(fs.readFileSync(f,"utf8")); process.stdout.write(j?.agent?.key||"")}' "$$STATE_FILE" 2>/dev/null || true)}"; \
	if [ -z "$$WS_URL" ] || [ -z "$$AGENT_KEY_VALUE" ]; then \
		echo "[make] Missing AGENT_WS_URL/AGENT_KEY and no backend-real state agent metadata found."; \
		exit 1; \
	fi; \
	echo "[make] refreshing token..."; \
	$(MAKE) notebook-agent-refresh-token; \
	echo "[make] starting notebook-runner in background..."; \
	( env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
		MBOS_RUNNER_MODE="$${MBOS_RUNNER_MODE:-host_external}" \
		MBOS_AGENT_WS_URL="$$WS_URL" \
		MBOS_AGENT_KEY="$$AGENT_KEY_VALUE" \
		MBOS_AGENT_BUILTIN_SKILLS_DIR="$${MBOS_AGENT_BUILTIN_SKILLS_DIR:-$(BUILTIN_SKILLS_DIR_DEFAULT)}" \
		MBOS_AGENT_BUILTIN_SKILLS="$${MBOS_AGENT_BUILTIN_SKILLS:-feishu-docs,jira-ops}" \
		MBOS_AGENT_BUILTIN_SKILLS_REQUIRED="$${MBOS_AGENT_BUILTIN_SKILLS_REQUIRED:-1}" \
		MBOS_AGENT_RUNNER_DEBUG="$${MBOS_AGENT_RUNNER_DEBUG:-1}" \
		MBOS_AGENT_TASK_TIMEOUT_SEC="$${MBOS_AGENT_TASK_TIMEOUT_SEC:-120}" \
		MBOS_AGENT_CODEX_YOLO="$${MBOS_AGENT_CODEX_YOLO:-1}" \
		$(NPM) run agent:notebook-runner ) > "$$RUNNER_LOG" 2>&1 & \
	RUNNER_PID=$$!; \
	trap 'kill $$RUNNER_PID >/dev/null 2>&1 || true' EXIT INT TERM; \
	sleep 3; \
	if ! kill -0 $$RUNNER_PID >/dev/null 2>&1; then \
		echo "[make] runner exited early. tail $$RUNNER_LOG:"; \
		tail -n 80 "$$RUNNER_LOG" || true; \
		exit 1; \
	fi; \
	echo "[make] waiting for agent runner websocket to be ready..."; \
	for i in 1 2 3 4 5 6 7 8 9 10; do \
		if rg -q "\\[notebook-codex-runner\\] connected|websocket open" "$$RUNNER_LOG" 2>/dev/null; then \
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
	tail -n 40 "$$RUNNER_LOG" || true

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

model-request-stream-bench:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	BASE_URL=http://localhost:$(PORT_API) \
	./scripts/model-request-streaming-benchmark.sh

model-request-stream-bench-gate:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	BASE_URL=http://localhost:$(PORT_API) \
	STRICT_GATE=1 \
	./scripts/model-request-streaming-benchmark.sh

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

# ---------------------------------------------------------------------------
# Internal Agent Sandbox — Joint Integration
# ---------------------------------------------------------------------------

SANDBOX_MANAGER_URL ?=
SANDBOX_SERVICE_KEY ?=
INTERNAL_AGENT_WS_HOST ?= ws://localhost:$(PORT_API)
AGENT_EXECUTION_WS_BASE_URL ?= $(INTERNAL_AGENT_WS_HOST)
INTERNAL_AGENT_IMAGE ?=
INTERNAL_AGENT_K8S_NAMESPACE ?= agentsmith-sandbox
INTERNAL_AGENT_JUICEFS_CSI_DRIVER ?= csi.juicefs.com
INTERNAL_AGENT_WORKSPACE_CAPACITY ?= 1Pi
INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME ?=
INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS ?= writeback_cache
INTERNAL_AGENT_JUICEFS_SUBDIR ?=
INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT ?=
INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE ?=
INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE ?=
JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT ?=

sandbox-preflight:
	@echo "==> Internal Agent Sandbox Preflight Check"
	@echo ""
	@PASS=0; FAIL=0; \
	echo "--- 1. Environment variables ---"; \
	if [ -z "$(SANDBOX_MANAGER_URL)" ]; then \
		echo "  [FAIL] SANDBOX_MANAGER_URL not set"; FAIL=$$((FAIL+1)); \
	else \
		echo "  [OK]   SANDBOX_MANAGER_URL=$(SANDBOX_MANAGER_URL)"; PASS=$$((PASS+1)); \
	fi; \
	if [ -z "$(SANDBOX_SERVICE_KEY)" ]; then \
		echo "  [FAIL] SANDBOX_SERVICE_KEY not set"; FAIL=$$((FAIL+1)); \
	else \
		echo "  [OK]   SANDBOX_SERVICE_KEY=<set>"; PASS=$$((PASS+1)); \
	fi; \
	if [ -z "$(INTERNAL_AGENT_IMAGE)" ]; then \
		echo "  [FAIL] INTERNAL_AGENT_IMAGE not set"; FAIL=$$((FAIL+1)); \
	else \
		echo "  [OK]   INTERNAL_AGENT_IMAGE=$(INTERNAL_AGENT_IMAGE)"; PASS=$$((PASS+1)); \
	fi; \
	echo ""; \
	echo "--- 2. Sandbox Manager health ---"; \
	if [ -n "$(SANDBOX_MANAGER_URL)" ]; then \
		if curl -sf -o /dev/null -w "" --max-time 5 "$(SANDBOX_MANAGER_URL)/healthz" 2>/dev/null; then \
			echo "  [OK]   $(SANDBOX_MANAGER_URL)/healthz → 200"; PASS=$$((PASS+1)); \
		else \
			echo "  [FAIL] $(SANDBOX_MANAGER_URL)/healthz not reachable"; FAIL=$$((FAIL+1)); \
		fi; \
		if curl -sf -o /dev/null -w "" --max-time 5 "$(SANDBOX_MANAGER_URL)/readyz" 2>/dev/null; then \
			echo "  [OK]   $(SANDBOX_MANAGER_URL)/readyz → 200"; PASS=$$((PASS+1)); \
		else \
			echo "  [FAIL] $(SANDBOX_MANAGER_URL)/readyz not reachable"; FAIL=$$((FAIL+1)); \
		fi; \
	else \
		echo "  [SKIP] SANDBOX_MANAGER_URL not set"; \
	fi; \
	echo ""; \
	echo "--- 3. Keycloak ---"; \
	if curl -sf -o /dev/null -w "" --max-time 5 "$(KEYCLOAK_BASE_URL)/$(KEYCLOAK_REALM)" 2>/dev/null; then \
		echo "  [OK]   Keycloak reachable"; PASS=$$((PASS+1)); \
	else \
		echo "  [FAIL] Keycloak not reachable at $(KEYCLOAK_BASE_URL)/$(KEYCLOAK_REALM)"; FAIL=$$((FAIL+1)); \
	fi; \
	echo ""; \
	echo "--- 4. AgentSmith API ---"; \
	if curl -sf -o /dev/null -w "" --max-time 5 "http://localhost:$(PORT_API)/docs" 2>/dev/null; then \
		echo "  [OK]   API at :$(PORT_API)"; PASS=$$((PASS+1)); \
	else \
		echo "  [FAIL] API not reachable at :$(PORT_API)"; FAIL=$$((FAIL+1)); \
	fi; \
	echo ""; \
	echo "--- 5. AgentSmith Web ---"; \
	if curl -sf -o /dev/null -w "" --max-time 5 "http://localhost:$(PORT_WEB)/" 2>/dev/null; then \
		echo "  [OK]   Web at :$(PORT_WEB)"; PASS=$$((PASS+1)); \
	else \
		echo "  [WARN] Web not reachable at :$(PORT_WEB) (optional for backend-only testing)"; \
	fi; \
	echo ""; \
	echo "==> Preflight: $$PASS passed, $$FAIL failed"; \
	if [ $$FAIL -gt 0 ]; then echo "==> BLOCKED — fix failures above before proceeding"; exit 1; fi; \
	echo "==> READY for joint integration"

sandbox-api-dev: check-api-port
	@if [ -z "$(SANDBOX_MANAGER_URL)" ] || [ -z "$(SANDBOX_SERVICE_KEY)" ]; then \
		echo "[FAIL] Set SANDBOX_MANAGER_URL and SANDBOX_SERVICE_KEY first."; \
		echo "  Example: make sandbox-api-dev SANDBOX_MANAGER_URL=http://sandbox-manager:8080 SANDBOX_SERVICE_KEY=sk_xxx"; \
		exit 1; \
	fi
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
	SANDBOX_MANAGER_URL=$(SANDBOX_MANAGER_URL) \
	SANDBOX_SERVICE_KEY=$(SANDBOX_SERVICE_KEY) \
	INTERNAL_AGENT_K8S_NAMESPACE=$(INTERNAL_AGENT_K8S_NAMESPACE) \
	INTERNAL_AGENT_JUICEFS_CSI_DRIVER=$(INTERNAL_AGENT_JUICEFS_CSI_DRIVER) \
	INTERNAL_AGENT_WORKSPACE_CAPACITY=$(INTERNAL_AGENT_WORKSPACE_CAPACITY) \
	INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME=$(INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME) \
	INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS=$(INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS) \
	INTERNAL_AGENT_JUICEFS_SUBDIR=$(INTERNAL_AGENT_JUICEFS_SUBDIR) \
	INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT=$(INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT) \
	INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE=$(INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE) \
	INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=$(INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE) \
	JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT=$(JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT) \
	AGENT_EXECUTION_WS_BASE_URL=$(AGENT_EXECUTION_WS_BASE_URL) \
	$(NPM) run api:node:dev

sandbox-joint-smoke:
	@if [ -z "$(SANDBOX_MANAGER_URL)" ] || [ -z "$(SANDBOX_SERVICE_KEY)" ]; then \
		echo "[FAIL] Set SANDBOX_MANAGER_URL and SANDBOX_SERVICE_KEY."; exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	API_BASE=http://localhost:$(PORT_API) \
	SANDBOX_MANAGER_URL=$(SANDBOX_MANAGER_URL) \
	SANDBOX_SERVICE_KEY=$(SANDBOX_SERVICE_KEY) \
	bash ./scripts/sandbox-joint-integration-smoke.sh
