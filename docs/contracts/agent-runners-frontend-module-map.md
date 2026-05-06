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
- Shows runner name, public `kind`/source, readiness, capabilities, diagnostics summary, connection state, and owner/metadata columns.
- Mutating controls require `project:agent_runner:manage`.
- Read-only users can inspect public rows/status and display-safe diagnostics only when permitted by backend affordance.
- Row actions render only from backend affordances such as `visible`, `allowed`, `reason_code`, `required_permissions`, and `danger_level`; `required_permissions` is diagnostic metadata, not frontend authorization truth.
- Clicking a runner row expands details inline; do not render a separate details card below the list.

3. Dialog components
- Create/edit dialogs configure Developer runners only.
- Dialogs must not expose Chat/Notebook type selectors, external/internal choices, docker/compose/k8s runtime choices, or developer mode as formal deployment product configuration.
- Public create creates Developer runners only and accepts name/description only. It must not send `is_default`, `default_endpoint_id`, managed kind/source, default-setting fields, or underlying managed configuration fields.
- Public UI cannot create, edit, delete, set default, issue keys for, or configure managed runners. Managed runner configuration is deployment/system-side and is read-only in frontend/project APIs.

4. Connection keys and diagnostics
- Connection keys are Agent Runner connection credentials and must be redacted after issuance.
- Display-safe diagnostics/view_diagnostics require `project:agent_runner:read` or `project:agent_runner:manage` plus backend `actions.view_diagnostics.allowed`.
- Diagnostics show audience-safe i18n copy from backend reason codes and redacted metadata only; they must not expose raw diagnostics, secrets, or internal paths.
- Key issue/revoke is allowed only for Developer runners when backend affordance allows it; managed runner key actions must be hidden/disabled and backend-rejected if called.
- Key issue/revoke, one-time secret, Test connection, and mutating connection actions require `project:agent_runner:manage` plus the matching backend action affordance.
- Diagnostics and Test connection responses must use display-safe redacted metadata only.
- Developer runners can appear only when development/local capability is enabled by backend affordance; they are not deploy/runtime choices, deployment default candidates, or release proof.

5. Developer runner inline expanded details
- Row click expands Developer runner details inline; do not use a separate sheet or bottom details card for the normal details flow.
- Inline details cover no active key, one-time key secret shown once, waiting for connection, connected/fresh, disconnected/stale, Test connection result, key revoked/expired/no active key, active test run, and delete blocked.
- Daily key UX shows one active key. If an active key exists, do not show another create-key action; offer rotate/revoke when backend affordance allows it.
- Runner WebSocket/connection address belongs in inline details or connection instructions, not inside the key creation confirmation area.
- `Run test task` appears only inside inline details, only when `project:agent_task:use`, `project:agent_runner:manage`, and `actions.run_test_task.allowed=true`.
- The test task uses a dedicated backend action/endpoint such as `POST /agent-runners/{runnerId}/test-task-runs`; final path/name is owned by the API contract.
- Test task creates standard task/run evidence marked as runner test, records `resolved_runner_id` and binding metadata, and must not become an ordinary task launcher.

## UX Contract

- Agent Runners is a develop/governance surface, not a user execution entrypoint.
- Fixed layout order: deployment default managed runner read-only status, Developer runners section.
- Top CTA whitelist: refresh/status and backend-allowed Create Developer runner. No managed config/default action and no Start task CTA are allowed.
- Managed runner status word priority is disabled/blocked, not configured by deployment, unavailable/error, stale/warning, ready.
- Ordinary Agent task users create work in Agent tasks; they do not select runners.
- Agent Runner rows may link to Audit/Usage evidence when available, but they must not become a second task launcher.
- UI audiences such as Runner maintainer and Diagnostics viewer are derived from backend affordances and safe response shape, not role names.

## Growth Guardrails

- Keep ordinary runner resolution failures typed and visible instead of adding a normal runner picker.
- Any expert runner selector must live in Agent task creation UI, bind the runner to the task, use backend binding options, and never use the full Agent Runner list as its data source.
- Keep route-level permission and parameter validation in the route page.
- Add new runner capability controls only after the backend contract and generated types expose the capability.
- Add negative tests for public managed create/edit/delete/default/endpoint fields, managed key issue/revoke, and secret-bearing diagnostics/Test connection metadata.
