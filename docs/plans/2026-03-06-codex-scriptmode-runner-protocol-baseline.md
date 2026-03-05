# Codex Script Mode + Runner WS Protocol Baseline

Date: 2026-03-06  
Status: Baseline (research complete, before next implementation step)

## 1) Research Scope

This baseline captures:

1. Official/primary Codex CLI non-interactive (`codex exec`) behavior and flags.
2. Current AgentSmith runner control path for Codex CLI execution.
3. Current websocket protocol mapping between runner and backend (`agent-runtime-service`).
4. Gaps/risk notes before next UX/runtime change.

## 2) External Primary Sources (Web + upstream repository)

1. Codex non-interactive docs entry: `docs/exec.md` points to `https://developers.openai.com/codex/noninteractive`.
2. Codex Rust README (non-interactive description): `https://github.com/openai/codex/blob/main/codex-rs/README.md`.
3. Codex exec CLI flags source of truth: `https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs`.
4. Codex exec JSONL event types source: `https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs`.
5. TypeScript SDK event mirror: `https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts`.
6. Provider config schema (`model_providers`, `wire_api`, `experimental_bearer_token`): `https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json`.
7. `wire_api = "chat"` removed (Responses-only): `https://github.com/openai/codex/blob/main/codex-rs/core/src/model_provider_info.rs`.

## 3) Codex Script Mode Facts (validated)

From upstream CLI source:

1. `codex exec` is the non-interactive/programmatic entry.
2. Supports prompt arg or stdin prompt (`-` semantics).
3. Supports machine output via `--json` (JSONL events on stdout).
4. Supports `resume --last` in exec flow.
5. Supports `--skip-git-repo-check`, `--full-auto`, and dangerous bypass mode.
6. Supports `--output-last-message` output file.
7. Supports `--ephemeral` (do not persist session files).
8. Provider configuration is driven by `model_provider` + `model_providers.<id>.*` config keys.
9. Upstream currently enforces Responses wire protocol (`wire_api=responses`); `chat` is removed.

## 4) AgentSmith Runner Control Path (current)

Files:
- `packages/agent-codex-runner/src/codex-command-builder.ts`
- `packages/agent-codex-runner/src/index.ts`
- `packages/agent-codex-runner/src/workspace-runtime.ts`

Current behavior:

1. Runner receives static proxy base from `server.hello.payload.resource_proxy.base_url`.
2. Runner writes task-local `.codex/config.toml` with provider `proxy` and `wire_api="responses"`.
3. Runner executes Codex with:
   - `codex exec --json --skip-git-repo-check --full-auto` (or dangerous bypass)
   - provider overrides via `-c model_provider=...` and `model_providers.proxy.*`
   - per-request `experimental_bearer_token` for user-level auth forwarding
   - optional `resume --last` for notebook session continuity
4. Workspace cwd resolution:
   - prefer `WORKSPACE_PATH`
   - fallback `/tmp/<username>/<taskId>`
5. Notebook mode preps task assets and writes runtime context files (credentials, manifests) before spawn.

## 5) Runner -> Backend WS Event Mapping (current)

Protocol/handlers:
- Contract: `docs/contracts/agent-runtime-protocol.md`
- Parser: `packages/api-entry-node/src/agent-runtime-service.ts`
- Orchestration: `packages/api-entry-node/src/notebook-runtime-orchestrator.ts`

Transport envelopes:

1. Server -> runner:
   - `server.hello` (includes `resource_proxy.base_url`)
   - `server.request.start` (includes `runtime_context`)
   - `server.request.cancel`
2. Runner -> server:
   - `agent.response.delta`
   - `agent.response.event`
   - `agent.response.artifact`
   - `agent.response.done`
   - `agent.response.error`

Trace payload schema accepted by backend is strict:

- `sequence`, `at`, `category`, `phase?`, `status?`, `name`, `summary`, `details?`, `raw?`
- Invalid shape causes `AGENT_PROTOCOL_ERROR`.

## 6) Codex JSONL -> AgentSmith Trace Semantics (current)

Runner parses codex JSONL and emits structured trace events, including:

1. High-fidelity `codex.raw.*` debug events (for raw panel fidelity).
2. Normalized command/tool progress (`codex.command`, `codex.tool`).
3. Execution lifecycle (`codex.exec`) start/end/error.
4. New run-level normalized semantics (already added in codebase):
   - `run.lifecycle` with `details.run_phase`
   - `run.summary` with `details.final_status`, `duration_ms`, etc.

Backend stores/replays these as task trace events and synthesizes `runtime.terminal` if runtime emitted no trace events.

## 7) Security and Reliability Notes (baseline)

1. `experimental_bearer_token` is in-memory injected for per-user proxy access; must never be logged/persisted.
2. Trace `details/raw` should stay sanitized (no secret leakage).
3. Responses-only wire API is the stable path; chat wire API should not be reintroduced.
4. `--json` JSONL contract is foundational: stdout must stay parseable line/object-wise.

## 8) Decisions for Next Step

Before implementing richer run timeline behavior, we standardize on:

1. Frontend run status derives from `run.lifecycle/run.summary` first, legacy trace inference as fallback.
2. Runner remains `responses` wire only.
3. WS contract remains strict fail-fast for malformed runtime events.
4. Optional verbose execution details remain user-controlled (default hidden).
