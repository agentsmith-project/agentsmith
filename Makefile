.PHONY: help help-extended quick-help help-glossary bootstrap deps-up deps-ready deps-down deps-reset deps-smoke deps-logs deps-ps deps-init deps-init-postgres deps-init-keycloak \
	check-api-port api-dev api-dev-min web web-msw \
	demo-full-up demo-full-down \
	e2e e2e-local \
	e2e-int-minimal e2e-int-chat e2e-int-agent e2e-int-chat-real e2e-int-local \
	e2e-int-minimal-local-api e2e-int-chat-local-api e2e-int-agent-local-api e2e-int-chat-real-local-api \
	e2e-int-chat-auto e2e-int-agent-auto e2e-int-notebook-agent-auto e2e-int-chat-ux-auto \
	e2e-int-core-local-api e2e-int-core-auto governance-core-smoke \
	agent-test-runner agent-codex-runner notebook-agent-refresh-token notebook-agent-smoke-task notebook-agent-credential-sync-smoke \
	notebook-agent-file-read-mount-smoke notebook-agent-inputrefs-loop-smoke \
	notebook-agent-engineering-smoke notebook-agent-engineering-smoke-full governance-smoke governance-pages-real-backend-smoke governance-pages-real-backend-smoke-strict governance-pages-real-backend-smoke-tolerant governance-pages-real-backend-interaction-smoke governance-pages-real-backend-interaction-smoke-strict governance-pages-real-backend-interaction-smoke-tolerant governance-policy-effect-smoke \
	governance-policy-access-effect-smoke governance-policy-group-access-effect-smoke governance-policy-update-audit-smoke governance-config-audit-effect-smoke governance-policy-spending-effect-smoke governance-policy-requests-rate-effect-smoke governance-member-permission-effect-smoke governance-member-lifecycle-effect-smoke \
	build-reliability-smoke workspace-governance-smoke workspace-overview-smoke \
	notebook-agent-smoke-full notebook-agent-init-resources notebook-agent-runner \
	notebook-agent-demo-up notebook-agent-demo-down notebook-agent-demo-status notebook-agent-demo-check notebook-agent-demo-restart-runner \
	notebook-agent-no-sandbox-smoke notebook-agent-no-sandbox-assert \
	notebook-agent-monitor notebook-agent-load-test notebook-agent-load-matrix \
	notebook-agent-benchmark-baseline notebook-agent-benchmark-compare notebook-agent-traces-query-bench \
	notebook-agent-traces-query-sweep notebook-agent-traces-query-sweep-compare notebook-agent-benchmark-archive \
	model-request-stream-bench model-request-stream-bench-gate usage-report-runner-status usage-report-run-due \
	openapi-generate openapi-check-generated openapi-changelog contracts-check-openapi urls \
	dev-up dev-down smoke-main smoke-governance smoke-all verify-contracts verify-governance \
	mvp-freeze-check preprod-acceptance-check \
	preprod-ensure-pgvector preprod-capture-baseline \
	lane-mock-smoke lane-mock-chromium lane-mock-visual lane-mock-full \
	lane-real-smoke lane-real-governance lane-real-extended gate-l0 gate-l1 gate-l2 gate-l3 gate-pr gate-premerge gate-governance \
	sandbox-preflight sandbox-api-dev sandbox-joint-smoke

NPM ?= npm

# Load local non-committed developer overrides/secrets (e.g., GLM_API_KEY).
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
BUILTIN_SKILLS_DIR_DEFAULT ?= $(CURDIR)/packages/agent-codex-runner/builtin-skills

LOCALE ?= en-US
BASE_URL ?= http://localhost:$(PORT_WEB)

help:
	@echo "MBOS MVP Help"
	@echo ""
	@$(MAKE) quick-help
	@echo ""
	@echo "More commands:"
	@echo "  make help-extended  # full command catalog"
	@echo "  make help-glossary  # term definitions"

help-extended:
	@echo "MBOS Dev Commands"
	@echo ""
	@echo "Recommended (Low Cognitive Load):"
	@echo "  make quick-help     # show only the recommended day-to-day commands"
	@echo "  make help-glossary  # explain common testing/engineering terms in plain language"
	@echo "  make dev-up         # start/recover demo API+Web+Runner and refresh/init if needed"
	@echo "  make dev-down       # stop demo API+Web+Runner"
	@echo "  make demo-full-up   # kill leftovers + start deps + init deps + recover full demo(API/Web/Runner/resources)"
	@echo "  make demo-full-down # stop demo(API/Web/Runner) and integration deps"
	@echo "  make smoke-main     # mainline engineering smoke (auto demo-check + token fallback)"
	@echo "  make smoke-governance # optional governance smoke (extended)"
	@echo "  make smoke-all      # run mainline + governance smokes (extended)"
	@echo "  make verify-governance # engineering gate (L0 + L2 + L3 mainline)"
	@echo "  make mvp-freeze-check # freeze-oriented MVP check bundle (contracts + core smoke + demo readiness)"
	@echo "  make gate-pr       # L0+L1 (fast PR gate: lint/type/contracts + mock smoke)"
	@echo "  make gate-premerge # L0+L2 (pre-merge gate: lint/type/contracts + mock functional matrix)"
	@echo "  make gate-governance  # L0+L2+L3 (default MVP engineering gate: mock functional matrix + mainline real smoke)"
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
	@echo "  make e2e           # run default e2e gate (smoke+chromium, MSW)"
	@echo "  make e2e-local     # run default e2e gate against a manually started web server (BASE_URL)"
	@echo "  make lane-mock-visual # run visual lane only (manual baseline workflow)"
	@echo "  make e2e-int-minimal   # run minimal integration e2e (real backend)"
	@echo "  make e2e-int-chat      # run chat integration e2e (real backend)"
	@echo "  make e2e-int-agent     # run external-agent integration e2e (real backend)"
	@echo "  make e2e-int-chat-real # run real GLM-5 (Anthropic-compatible) chat integration e2e (real upstream)"
	@echo "  make e2e-int-local     # run integration e2e against a manually started web server (BASE_URL)"
	@echo "  make e2e-int-minimal-local-api  # run minimal integration e2e with current node api (requires frontend already running)"
	@echo "  make e2e-int-chat-local-api     # run chat integration e2e with current node api (requires frontend already running)"
	@echo "  make e2e-int-agent-local-api    # run external-agent integration e2e with current node api (requires frontend already running)"
	@echo "  make e2e-int-chat-real-local-api # run real GLM-5 (Anthropic-compatible) chat e2e with current node api (requires frontend already running)"
	@echo "  make e2e-int-chat-auto      # auto start deps+api+web and run integration-chat spec"
	@echo "  make e2e-int-agent-auto     # auto start deps+api+web and run integration-agent spec"
	@echo "  make e2e-int-notebook-agent-auto # auto start deps+api+web and run notebook external-agent integration spec"
	@echo "  make e2e-int-chat-ux-auto   # auto start deps+api+web and run targeted chat UX integration checks"
	@echo "  make e2e-int-core-local-api # run MVP real-backend core smoke against already-running API/Web"
	@echo "  make e2e-int-core-auto      # auto start deps+api+web and run MVP real-backend core smoke"
	@echo "  make governance-core-smoke     # MVP engineering baseline: core real-lane smoke + endpoint rate/spending policy smoke + governance report"
	@echo "  make agent-test-runner  # start standalone external agent test runner (requires AGENT_WS_URL + AGENT_KEY)"
	@echo "  make agent-codex-runner # start Codex-based external agent runner (requires AGENT_WS_URL + AGENT_KEY; auto mounts builtin skills)"
	@echo "  make notebook-agent-refresh-token # refresh Keycloak JWT and write /tmp/agentsmith_user_token.txt"
	@echo "  make notebook-agent-init-resources # create project/endpoint/agent/key and write /tmp/agentsmith_*.txt"
	@echo "  make notebook-agent-runner         # start codex runner using /tmp/agentsmith_ws_url.txt + agent_key (auto mounts builtin skills)"
	@echo "  make notebook-agent-demo-up        # one-command demo bootstrap: start api/web, refresh token, init resources, start runner"
	@echo "  make notebook-agent-demo-down      # stop demo-up managed api/web/runner background processes"
	@echo "  make notebook-agent-demo-status    # show demo managed process/health/token/agent status"
	@echo "  make notebook-agent-demo-check     # non-destructive demo readiness checks (status + metadata + proxy reachability)"
	@echo "  make notebook-agent-no-sandbox-smoke # verify AgentSmith works without sandbox deployment (mainline + fail-fast internal paths)"
	@echo "  make notebook-agent-demo-restart-runner # restart only the managed demo runner"
	@echo "  make notebook-agent-smoke-task    # create notebook task, post prompt, poll final output"
	@echo "  make notebook-agent-credential-sync-smoke # verify execution_context credential files are written under .codex/credential/"
	@echo "  make notebook-agent-file-read-mount-smoke # verify file-read skill mounted under task workspace (.codex/skills/file-read)"
	@echo "  make notebook-agent-inputrefs-loop-smoke # notebook url input -> artifact -> artifact input loop smoke"
	@echo "  make notebook-agent-engineering-smoke # run engineering smoke set (basic + inputrefs loop; optional matplotlib)"
	@echo "  make notebook-agent-engineering-smoke-full # refresh token (if needed) + demo-check + engineering-smoke"
	@echo "  make governance-smoke # run governance real-backend page open + interaction smoke set"
	@echo "  make governance-pages-real-backend-smoke # default tolerant mode for governance page-open smoke"
	@echo "  make governance-pages-real-backend-smoke-strict # strict gate: governance page-open smoke fails on product error states"
	@echo "  make governance-pages-real-backend-smoke-tolerant # tolerant triage mode for governance page-open smoke"
	@echo "  make governance-pages-real-backend-interaction-smoke # default tolerant mode for governance interaction smoke"
	@echo "  make governance-pages-real-backend-interaction-smoke-strict # strict gate: governance interaction smoke fails on product error states"
	@echo "  make governance-pages-real-backend-interaction-smoke-tolerant # tolerant triage mode for governance interaction smoke"
	@echo "  make governance-policy-effect-smoke # real-backend endpoint policy effect smoke (rate limit -> audit/usage evidence)"
	@echo "  make governance-policy-access-effect-smoke # real-backend endpoint policy allow-list effect smoke (deny->allow + audit/usage evidence)"
	@echo "  make governance-policy-group-access-effect-smoke # real-backend endpoint policy group allow-list effect smoke (deny->group-allow)"
	@echo "  make governance-policy-update-audit-smoke # real-backend endpoint policy update -> audit event smoke"
	@echo "  make governance-config-audit-effect-smoke # real-backend endpoint/credential config change -> audit event smoke"
	@echo "  make governance-policy-spending-effect-smoke # real-backend endpoint policy spending-limit effect smoke (block -> audit/usage evidence)"
	@echo "  make governance-policy-requests-rate-effect-smoke # real-backend endpoint policy requests/day rate effect smoke (block -> audit/usage evidence)"
	@echo "  make governance-member-permission-effect-smoke # optional smoke (not part of default MVP engineering gate)"
	@echo "  make governance-member-lifecycle-effect-smoke # real-backend member lifecycle smoke (active->suspended->removed->restore)"
	@echo "  make governance-sse-ticket-effect-smoke # real-backend SSE ticket hardening smoke (opaque ticket + no query fallback)"
	@echo "  make build-reliability-smoke # build reliability smoke (chat recovery + notebook task execution + contract suite)"
	@echo "  make workspace-governance-smoke # workspace governance smoke (overview + member admin + cross-project actions + explainability)"
	@echo "  make workspace-overview-smoke # workspace entry smoke (overview + project entry path)"
	@echo "  make notebook-agent-smoke-full    # refresh token + start runner + run notebook smoke task"
	@echo "  make notebook-agent-monitor       # poll notebook task execution internal metrics (auth required)"
	@echo "  make notebook-agent-load-test     # concurrent notebook task load test + summary + metrics snapshot"
	@echo "  make notebook-agent-load-matrix   # run a load matrix and save CSV/JSONL summaries under /tmp"
	@echo "  make notebook-agent-benchmark-baseline # run the standard baseline matrix profile and print summary preview"
	@echo "  make notebook-agent-benchmark-compare  # compare two baseline dirs (BASELINE_A_DIR, BASELINE_B_DIR)"
	@echo "  make notebook-agent-benchmark-archive  # archive a benchmark output dir under artifacts/benchmarks"
	@echo "  make notebook-agent-traces-query-bench # benchmark /tasks/:id/traces?message_id=... query path"
	@echo "  make notebook-agent-traces-query-sweep # compare message-scoped traces query latency across page sizes"
	@echo "  make notebook-agent-traces-query-sweep-compare # compare two traces-query-sweep dirs by page_size"
	@echo "  make model-request-stream-bench # benchmark unified /llm/chat/completions stream path"
	@echo "  make model-request-stream-bench-gate # run stream benchmark with p95/error-rate thresholds"
	@echo "  make openapi-generate   # generate frontend API types from docs/contracts/specs/openapi.yaml"
	@echo "  make openapi-check-generated # verify generated API types are in sync"
	@echo "  make openapi-changelog  # generate OpenAPI diff changelog vs origin/main"
	@echo "  make contracts-check-openapi # run OpenAPI core coverage + route-kind coverage + breaking checks"
	@echo ""
	@echo "Utility:"
	@echo "  make urls          # print local URLs and test users"

quick-help:
	@echo "MBOS Recommended Commands"
	@echo ""
	@echo "  make dev-up"
	@echo "    Start/recover demo environment (API/Web/Runner + token/resource init)."
	@echo ""
	@echo "  make smoke-main"
	@echo "    Run notebook mainline engineering smoke."
	@echo ""
	@echo "  make notebook-agent-no-sandbox-smoke"
	@echo "    Validate no-sandbox deployment baseline (services + endpoint proxy + internal fail-fast)."
	@echo ""
	@echo "  make smoke-governance"
	@echo "    Run governance smoke with strict page checks."
	@echo ""
	@echo "  make smoke-all"
	@echo "    Run mainline + governance smokes."
	@echo ""
	@echo "  make e2e-int-core-local-api"
	@echo "    Run MVP core real-backend smoke against existing API/Web."
	@echo ""
	@echo "  make governance-core-smoke"
	@echo "    Run MVP engineering baseline (core real-lane + endpoint rate/spending policy + archived report)."
	@echo ""
	@echo "  make verify-contracts"
	@echo "    Run typecheck + OpenAPI generated check + OpenAPI contract checks."
	@echo ""
	@echo "  make verify-governance"
	@echo "    Run gate-governance (L0 + mock functional matrix + real smoke)."
	@echo ""
	@echo "  make lane-mock-visual"
	@echo "    Run visual lane only (manual baseline workflow, non-blocking)."
	@echo ""
	@echo "  make mvp-freeze-check"
	@echo "    Run verify-contracts + governance-core-smoke + notebook-agent-demo-check."
	@echo ""
	@echo "  make preprod-acceptance-check"
	@echo "    Run minimal preprod readiness checks (openapi/web-login/cancel-route)."
	@echo ""
	@echo "  make preprod-ensure-pgvector"
	@echo "    Ensure pgvector extension is installed/enabled on preprod Postgres container."
	@echo ""
	@echo "  make preprod-capture-baseline"
	@echo "    Capture current preprod rollback baseline and generate rollback script on server."
	@echo ""
	@echo "  make gate-pr"
	@echo "    L0 + L1 gate. Recommended pull request baseline."
	@echo ""
	@echo "  make gate-premerge"
	@echo "    L0 + L2 gate. Recommended merge-to-main baseline."
	@echo ""
	@echo "  make gate-governance"
	@echo "    L0 + L2 + L3 gate. Recommended governance baseline."
	@echo ""
	@echo "  make governance-report"
	@echo "    Generate governance verification report (JSON + Markdown)."
	@echo ""
	@echo "  make verify-governance-with-report"
	@echo "    Run verify-governance and generate report with archive."
	@echo ""
	@echo ""
	@echo ""
	@echo "  make dev-down"
	@echo "    Stop managed demo processes."

help-glossary:
	@echo "MBOS Terms (Plain Language)"
	@echo ""
	@echo "  governance"
	@echo "    Rules that control who can access resources and how much they can use."
	@echo "    In this repo it mainly covers members + resource policy + audit + usage."
	@echo ""
	@echo "  contracts"
	@echo "    The agreed API/schema/rules between frontend and backend."
	@echo "    We validate them with OpenAPI checks to prevent accidental breaking changes."
	@echo ""
	@echo "  smoke test"
	@echo "    A fast end-to-end sanity check to prove the main path still works."
	@echo ""
	@echo "  default e2e gate"
	@echo "    Functional lane only: smoke + chromium."
	@echo "    Visual is a separate manual baseline workflow."
	@echo ""
	@echo "  strict vs tolerant smoke"
	@echo "    strict: fail on product error states (engineering gate)."
	@echo "    tolerant: allow temporary error states for troubleshooting only."
	@echo ""
	@echo "  demo-check"
	@echo "    Non-destructive readiness check: process status, token validity, endpoint reachability."
	@echo ""
	@echo "  mainline"
	@echo "    Core notebook/agent/files/inputrefs business path."
	@echo ""
	@echo "  engineering gate"
	@echo "    The must-pass checks before saying a build is releasable."

dev-up:
	$(MAKE) notebook-agent-demo-up

dev-down:
	$(MAKE) notebook-agent-demo-down

demo-full-up:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/demo-full-up.sh

demo-full-down:
	@set -e; \
	$(MAKE) notebook-agent-demo-down; \
	$(MAKE) deps-down

smoke-main:
	@set -e; \
	$(MAKE) notebook-agent-no-sandbox-assert; \
	$(MAKE) notebook-agent-engineering-smoke-full

smoke-governance:
	$(MAKE) governance-smoke

smoke-all:
	@set -e; \
	$(MAKE) smoke-main; \
	$(MAKE) smoke-governance

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
	$(MAKE) gate-governance

mvp-freeze-check:
	@set -e; \
	$(MAKE) verify-contracts; \
	$(MAKE) governance-core-smoke; \
	$(MAKE) notebook-agent-demo-check

preprod-acceptance-check:
	./scripts/preprod-acceptance-check.sh

preprod-ensure-pgvector:
	./scripts/preprod-ensure-pgvector.sh

preprod-capture-baseline:
	./scripts/preprod-capture-baseline.sh

# ---------------------------------------------------------------------------
# Lane / Gate Model (Best-practice baseline)
#
# L0: static quality gates (lint/type/contracts)
# L1: mock-lane smoke
# L2: mock-lane functional matrix (smoke + chromium)
# L3: real-lane key smoke (default MVP mainline path)
# ---------------------------------------------------------------------------

lane-mock-smoke:
	env -u BASE_URL -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/run-mock-lane-playwright.sh --project=smoke

lane-mock-chromium:
	env -u BASE_URL -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	PW_WORKERS=4 ./scripts/run-mock-lane-playwright.sh --project=chromium

lane-mock-visual:
	env -u BASE_URL -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	PW_WORKERS=1 ./scripts/run-mock-lane-playwright.sh --project=visual

lane-mock-full:
	@set -e; \
	$(MAKE) lane-mock-smoke; \
	$(MAKE) lane-mock-chromium

lane-real-smoke:
	$(MAKE) smoke-main

lane-real-governance:
	$(MAKE) smoke-governance

lane-real-extended:
	$(MAKE) smoke-all

gate-l0:
	@set -e; \
	$(NPM) run lint; \
	./scripts/ws-typecheck-safe.sh; \
	$(NPM) run contracts:check-doc-governance; \
	$(NPM) run openapi:check-generated; \
	$(NPM) run contracts:check-openapi

gate-l1:
	@set -e; \
	$(MAKE) gate-l0; \
	$(MAKE) lane-mock-smoke

gate-l2:
	@set -e; \
	$(MAKE) gate-l0; \
	$(MAKE) lane-mock-full

gate-l3:
	@set -e; \
	$(MAKE) gate-l0; \
	$(MAKE) lane-real-smoke

gate-pr:
	@set -e; \
	$(MAKE) gate-l1

gate-premerge:
	@set -e; \
	$(MAKE) gate-l2

gate-governance:
	@set -e; \
	$(MAKE) gate-l0; \
	$(MAKE) lane-mock-full; \
	$(MAKE) lane-real-smoke

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
	MBOS_AGENT_WS_URL="$(AGENT_WS_URL)" \
	MBOS_AGENT_KEY="$(AGENT_KEY)" \
	MBOS_AGENT_MODE="$(AGENT_MODE)" \
	$(NPM) run agent:test-runner

agent-codex-runner:
	@if [ -z "$(AGENT_WS_URL)" ] || [ -z "$(AGENT_KEY)" ]; then \
		echo "[make] Missing AGENT_WS_URL or AGENT_KEY."; \
		echo "[make] Example:"; \
		echo "  make agent-codex-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx'"; \
		exit 1; \
	fi
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	MBOS_AGENT_WS_URL="$(AGENT_WS_URL)" \
	MBOS_AGENT_KEY="$(AGENT_KEY)" \
	MBOS_AGENT_BUILTIN_SKILLS_DIR="$${MBOS_AGENT_BUILTIN_SKILLS_DIR:-$(BUILTIN_SKILLS_DIR_DEFAULT)}" \
	MBOS_AGENT_BUILTIN_SKILLS="$${MBOS_AGENT_BUILTIN_SKILLS:-.system,feishu-docs,jira-ops,file-read}" \
	MBOS_AGENT_BUILTIN_SKILLS_REQUIRED="$${MBOS_AGENT_BUILTIN_SKILLS_REQUIRED:-1}" \
	$(NPM) run agent:codex-runner

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
	MBOS_AGENT_BUILTIN_SKILLS_DIR="$${MBOS_AGENT_BUILTIN_SKILLS_DIR:-$(BUILTIN_SKILLS_DIR_DEFAULT)}" \
	MBOS_AGENT_BUILTIN_SKILLS="$${MBOS_AGENT_BUILTIN_SKILLS:-.system,feishu-docs,jira-ops,file-read}" \
	MBOS_AGENT_BUILTIN_SKILLS_REQUIRED="$${MBOS_AGENT_BUILTIN_SKILLS_REQUIRED:-1}" \
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

notebook-agent-demo-status:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-demo-status.sh

notebook-agent-demo-check:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-demo-check.sh

notebook-agent-no-sandbox-smoke:
	@set -e; \
	echo "[make] no-sandbox smoke: demo readiness check"; \
	$(MAKE) notebook-agent-demo-check; \
	echo "[make] no-sandbox smoke: internal path must fail fast when sandbox is absent"; \
	$(MAKE) notebook-agent-no-sandbox-assert

notebook-agent-no-sandbox-assert:
	$(NPM) -s run test -- packages/api-entry-node/src/index.test.ts -t "AGENT_SANDBOX_NOT_CONFIGURED for internal agent"

notebook-agent-demo-restart-runner:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	DEMO_START_API=0 DEMO_START_WEB=0 DEMO_REFRESH_TOKEN=0 DEMO_INIT_RESOURCES=0 DEMO_START_RUNNER=1 \
	./scripts/notebook-agent-demo-up.sh

notebook-agent-smoke-task:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-smoke-task.sh

notebook-agent-credential-sync-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-credential-sync-smoke.sh

notebook-agent-file-read-mount-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-file-read-mount-smoke.sh

notebook-agent-inputrefs-loop-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	node ./scripts/notebook-agent-inputrefs-loop-smoke.js

notebook-agent-engineering-smoke:
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
	./scripts/notebook-agent-engineering-smoke.sh

notebook-agent-engineering-smoke-full:
	@set -e; \
	echo "[make] running demo readiness check..."; \
	set +e; \
	env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
		./scripts/notebook-agent-demo-check.sh; \
	CHECK_RC=$$?; \
	set -e; \
	if [ "$$CHECK_RC" -eq 75 ]; then \
		echo "[make] demo-check reported recoverable missing demo resources without GLM_API_KEY; skipping notebook engineering smoke."; \
		exit 0; \
	fi; \
	if [ "$$CHECK_RC" -ne 0 ]; then \
		echo "[make] demo-check failed; attempting full demo self-heal (start/recover api+web+runner+token/resources)..."; \
		if [ -n "$(GLM_API_KEY)" ]; then \
			$(MAKE) notebook-agent-demo-up; \
		else \
			DEMO_INIT_RESOURCES=0 $(MAKE) notebook-agent-demo-up; \
		fi; \
		set +e; \
		env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
			./scripts/notebook-agent-demo-check.sh; \
		CHECK_RC=$$?; \
		set -e; \
		if [ "$$CHECK_RC" -eq 75 ]; then \
			echo "[make] demo-check still reports recoverable missing demo resources without GLM_API_KEY; skipping notebook engineering smoke."; \
			exit 0; \
		fi; \
		if [ "$$CHECK_RC" -ne 0 ]; then \
			exit "$$CHECK_RC"; \
		fi; \
	fi; \
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
	echo "[make] governance smoke preflight: restart managed API/Web in real-backend mode (MSW off)..."; \
	$(MAKE) notebook-agent-demo-down >/dev/null 2>&1 || true; \
	for port in 20000 3001; do \
		if command -v lsof >/dev/null 2>&1; then \
			pids="$$(lsof -tiTCP:$$port -sTCP:LISTEN -Pn 2>/dev/null || true)"; \
			if [ -n "$$pids" ]; then \
				echo "[make] governance preflight: killing stale listener(s) on :$$port ($$pids)"; \
				kill $$pids >/dev/null 2>&1 || true; \
				sleep 1; \
				kill -9 $$pids >/dev/null 2>&1 || true; \
			fi; \
			fi; \
		done; \
	DEMO_CHECK_RC=0; \
	DEMO_ALLOW_MISSING_EXECUTION_METADATA=1 DEMO_INIT_RESOURCES=0 DEMO_START_RUNNER=0 $(MAKE) notebook-agent-demo-up; \
	if ! DEMO_REQUIRE_RUNNER=0 ./scripts/notebook-agent-demo-check.sh; then \
		DEMO_CHECK_RC=$$?; \
		if [ "$$DEMO_CHECK_RC" -eq 75 ]; then \
			echo "[make] governance smoke preflight: demo metadata is recoverably unavailable; governance demo checks will be skipped if needed"; \
		else \
			exit "$$DEMO_CHECK_RC"; \
		fi; \
	fi; \
	run_with_token_retry() { \
		STEP_NAME="$$1"; \
		if ! $(MAKE) "$$STEP_NAME"; then \
			echo "[make] $$STEP_NAME failed; attempting token refresh and retry once"; \
			if ! BASE_URL="$${BASE_URL:-http://localhost:3001}" REFRESH_TOKEN_READ_APP_SESSION=0 $(MAKE) notebook-agent-refresh-token; then \
				echo "[make] token refresh failed; attempting full demo self-heal before retry ($$STEP_NAME)"; \
				DEMO_INIT_RESOURCES=0 $(MAKE) notebook-agent-demo-up; \
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
	if [ "$$DEMO_CHECK_RC" -eq 75 ]; then \
		echo "[make] skipping governance-sse-ticket-effect-smoke because demo execution metadata is unavailable and GLM_API_KEY is not set"; \
	else \
		run_with_token_retry governance-sse-ticket-effect-smoke; \
	fi; \
	if [ -n "$${GOVERNANCE_EVIDENCE_PATH:-}" ]; then \
		node ./scripts/write-governance-evidence.js "$${GOVERNANCE_EVIDENCE_PATH}"; \
	fi

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
		MBOS_AGENT_BUILTIN_SKILLS_DIR="$${MBOS_AGENT_BUILTIN_SKILLS_DIR:-$(BUILTIN_SKILLS_DIR_DEFAULT)}" \
		MBOS_AGENT_BUILTIN_SKILLS="$${MBOS_AGENT_BUILTIN_SKILLS:-.system,feishu-docs,jira-ops,file-read}" \
		MBOS_AGENT_BUILTIN_SKILLS_REQUIRED="$${MBOS_AGENT_BUILTIN_SKILLS_REQUIRED:-1}" \
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
INTERNAL_AGENT_IMAGE ?=
INTERNAL_AGENT_K8S_NAMESPACE ?= agentsmith-sandbox
INTERNAL_AGENT_JUICEFS_CSI_DRIVER ?= csi.juicefs.com
INTERNAL_AGENT_WORKSPACE_CAPACITY ?= 1Pi
INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME ?=
INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS ?= writeback_cache
INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE ?=
INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE ?=

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
	INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=$(INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE) \
	INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE=$(INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE) \
	AGENT_EXECUTION_WS_BASE_URL=$(INTERNAL_AGENT_WS_HOST) \
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
