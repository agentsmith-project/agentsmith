# CI Integration Troubleshooting Cheat Sheet

## Scope
- Workflow: `.github/workflows/integration-e2e.yml`
- Jobs:
  - `integration-agent`
  - `integration-notebook-agent`

## Where to look first
1. Open job summary, read `Failure Tag`.
2. Download artifacts:
   - `/tmp/ci-e2e-int-*.log`
   - `/tmp/agentsmith-api-node-integration.log`
   - `/tmp/agentsmith-web-integration.log`
   - `test-results/**`
3. Reproduce locally with same make target and ports.

## Tag-based triage
### `INT-KEYCLOAK-REDIRECT`
- Symptom:
  - `redirect_uri` related login failure.
- Check:
  - `scripts/integration-keycloak-init.ts` ran successfully.
  - `INTEGRATION_WEB_PORT` passed into `run-integration-e2e-full.sh`.
  - Keycloak client `agentsmith` has matching `redirectUris` and `webOrigins`.
- Fix:
  - Re-run keycloak init:
    - `npm run integration:deps:init:keycloak`
  - Re-run suite with explicit ports:
    - `make e2e-int-agent-auto PORT_API=20030 PORT_WEB=3011`
    - `make e2e-int-notebook-agent-auto PORT_API=20031 PORT_WEB=3013`

### `INT-INFRA-BOOT`
- Symptom:
  - `ECONNREFUSED`, `did not become ready in time`, service startup timeout.
- Check:
  - Docker deps are healthy.
  - API/WEB target ports are free.
  - No proxy env leaked (`http_proxy`, `https_proxy`, etc.).
- Fix:
  - `npm run integration:deps:up`
  - `npm run integration:deps:init:postgres`
  - `npm run integration:deps:init:keycloak`
  - Retry with clean ports.

### `INT-AGENT-OFFLINE`
- Symptom:
  - Execution route reports `AGENT_OFFLINE`.
- Check:
  - External execution websocket agent actually connected.
  - Agent key is valid and belongs to target agent.
  - Agent status is enabled.
- Fix:
  - Recreate agent key.
  - Confirm connection-info WS URL points to current API base.
  - Restart the execution service and re-run.

### `INT-NOTEBOOK-EXECUTION`
- Symptom:
  - `TASK_STREAM_CONFLICT`, `AGENT_OFFLINE`, `AGENT_PROTOCOL_ERROR`, notebook stream failures.
- Check:
  - `execution_preferences.notebook.endpoint_id` exists.
  - Endpoint is active and reachable.
  - `server.hello.resource_proxy.base_url` matches current API host/port.
  - Runner emits valid frame schema (`delta` string, done/error shape).
- Fix:
  - Reconfigure notebook endpoint binding.
  - Validate endpoint credentials/base_url.
  - Re-run notebook integration:
    - `make e2e-int-notebook-agent-auto PORT_API=20031 PORT_WEB=3013`

## Fast local reproduce commands
```bash
# external agent chat integration
make e2e-int-agent-auto PORT_API=20030 PORT_WEB=3011

# notebook external-agent integration
make e2e-int-notebook-agent-auto PORT_API=20031 PORT_WEB=3013
```

## Escalation checklist
1. Attach failure tag and job URL.
2. Attach three logs (`ci-e2e`, `api`, `web`).
3. Include exact commit SHA and rerun number.
4. Include whether local reproduce succeeded with same ports.
