# Internal Agent Sandbox Joint-Dev Checklist

## Preconditions

1. Sandbox manager endpoint reachable from AgentSmith.
2. Environment configured:
   - `SANDBOX_MANAGER_URL`
   - `SANDBOX_SERVICE_KEY`
3. Agent image available and pullable by sandbox runtime.
4. Keycloak/API/Web baseline healthy.

## Joint Integration Steps

1. Create an internal agent with:
   - valid `config.image`
   - valid notebook `endpoint_id`
2. Create notebook task bound to internal agent.
3. Send first prompt and verify:
   - `sandbox_starting` trace appears
   - agent connects and receives `server.hello.resource_proxy.base_url`
   - stream returns `delta` and terminal `done`
4. Continue multi-turn in same task and verify warm path latency improves.
5. Leave idle until sandbox timeout, then send again and verify auto-recovery.
6. Archive task and verify pod release path executes.
7. Reopen with persisted workspace/session expectations and validate resume behavior.

## Required Assertions

1. No direct upstream LLM call from runner; traffic goes through endpoint proxy.
2. User bearer token is applied per request and does not leak to logs.
3. Internal keepalive runs during long chat/notebook streams and is cleaned up after completion.
4. Presence/state transitions are coherent in UI and API (`managed`/`online`/`offline`).
5. Failures are user-visible with actionable error codes (no silent hangs).

## Exit Criteria

1. Notebook internal path: pass.
2. Chat internal path: pass.
3. Pod lifecycle: create/keepalive/release pass.
4. Resume semantics pass.
5. Smoke + release checks archived with evidence links.
