# Agent Runners Frontend Module Map

This document defines the current module boundary for the Agent Runners page and its immediate growth constraints.

Terminology note:
- Product name: `Agent Runners`
- Object name: `Agent Runner`
- Canonical route: `/agent-runners`

## Scope

- Route: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-runners/page.tsx`
- Page-local components: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-runners/_components/*`
- Shared components: `src/components/agent-runners/*`
- Backend HTTP namespace is `/api/v1/workspaces/{workspaceId}/projects/{projectId}/agent-runners/*`; `/agents` is not a target alias.

## Current Structure

1. `agent-runners/page.tsx`
- Route param validation and permission gate (`project:agent_runner:read` or `project:agent_runner:manage`).
- Owns page-level data loading and mutation wiring.
- Uses shared project layout mode and does not define a page-local layout toggle.

2. `AgentRunnersTable.tsx`
- Shows runner name, public `kind`/source, readiness, default endpoint binding when applicable, capabilities, diagnostics summary, connection state, and owner/metadata columns.
- Mutating controls require `project:agent_runner:manage`.
- Read-only users can inspect public rows/status and display-safe diagnostics only when permitted by backend affordance.
- Row actions render only from backend affordances such as `visible`, `allowed`, `reason_code`, `required_permissions`, and `danger_level`; `required_permissions` is diagnostic metadata, not frontend authorization truth.

3. Dialog components
- Create/edit dialogs configure task execution capability only.
- Dialogs must not expose Chat/Notebook type selectors, external/internal choices, docker/compose/k8s runtime choices, or developer mode as formal deployment product configuration.
- Backend remains authoritative for default uniqueness and endpoint/model validity.
- Public create creates Developer runners only and accepts name/description only. It must not send `is_default`, `default_endpoint_id`, System managed kind/source, or underlying System managed configuration fields.
- Public UI cannot edit underlying System managed configuration. System managed public actions are limited to backend-allowed Project default status/setup actions.

4. Connection keys and diagnostics
- Connection keys are Agent Runner connection credentials and must be redacted after issuance.
- Display-safe diagnostics/view_diagnostics require `project:agent_runner:read` or `project:agent_runner:manage` plus backend `actions.view_diagnostics.allowed`.
- Diagnostics show audience-safe i18n copy from backend reason codes and redacted metadata only; they must not expose raw diagnostics, secrets, or internal paths.
- Key issue/revoke is allowed only for Developer runners when backend affordance allows it; System managed key actions must be hidden/disabled and backend-rejected if called.
- Key issue/revoke, one-time secret, Test connection, and mutating connection actions require `project:agent_runner:manage` plus the matching backend action affordance.
- Diagnostics and Test connection responses must use display-safe redacted metadata only.
- Developer runners can appear only when development/local capability is enabled by backend affordance; they are not deploy/runtime choices, Project default candidates, or release proof.

5. Developer runner sheet
- Sheet state machine covers created/no key, key issued/secret shown once, waiting for connection, connected/fresh, Test connection passed/warning/failed, key expired/revoked/no active key, stale, disconnected, disabled, active test run, and delete blocked.
- `Run test task` appears only inside this sheet, only when `project:agent_task:use`, `project:agent_runner:manage`, and `actions.run_test_task.allowed=true`.
- The test task uses a dedicated backend action/endpoint such as `POST /agent-runners/{runnerId}/test-task-runs`; final path/name is owned by the API contract.
- Test task creates standard task/run evidence marked as runner test, records `resolved_runner_id` and selection metadata, and must not become an ordinary task launcher.

## UX Contract

- Agent Runners is a develop/governance surface, not a user execution entrypoint.
- Fixed layout order: top Project default status, System managed read-only section, Developer runners section.
- Top CTA whitelist: refresh/status, backend-allowed Project default status/setup action, and backend-allowed Create Developer runner. No Start task CTA is allowed.
- Project default status word priority is disabled/blocked, not configured, unavailable/error, stale/warning, ready.
- Ordinary Agent task users create work in Agent tasks; they do not select runners.
- Agent Runner rows may link to Audit/Usage evidence when available, but they must not become a second task launcher.
- UI audiences such as Runner maintainer and Diagnostics viewer are derived from backend affordances and safe response shape, not role names.

## Growth Guardrails

- Keep ordinary runner resolution failures typed and visible instead of adding a normal runner picker.
- Any expert run-scoped `Execution environment` selector must live in Agent task run start UI, use the backend selection snapshot, and never use the full Agent Runner list as its data source.
- Keep route-level permission and parameter validation in the route page.
- Add new runner capability controls only after the backend contract and generated types expose the capability.
- Add negative tests for public System managed create/default/endpoint fields, System managed key issue/revoke, and secret-bearing diagnostics/Test connection metadata.
