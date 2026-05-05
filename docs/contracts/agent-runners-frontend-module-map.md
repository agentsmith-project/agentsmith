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
- Shows runner name, readiness, default endpoint binding, capabilities, diagnostics, and owner/metadata columns.
- Mutating controls require `project:agent_runner:manage`.
- Read-only users can inspect configuration and diagnostics permitted by the backend.

3. Dialog components
- Create/edit dialogs configure task execution capability only.
- Dialogs must not expose Chat/Notebook type selectors, external/internal choices, docker/compose/k8s runtime choices, or developer mode as product configuration.
- Backend remains authoritative for default uniqueness and endpoint/model validity.

4. Connection keys and diagnostics
- Connection keys are Agent Runner connection credentials and must be redacted after issuance.
- Diagnostics may mention managed runner readiness and backend error codes.
- Developer mode can appear only in local debugging documentation or diagnostics, not as a deploy/runtime choice.

## UX Contract

- Agent Runners is a develop/governance surface, not a user execution entrypoint.
- Ordinary Agent task users create work in Agent tasks; they do not select runners.
- Agent Runner rows may link to Audit/Usage evidence when available, but they must not become a second task launcher.

## Growth Guardrails

- Keep runner resolution failures typed and visible instead of adding a UI runner picker.
- Keep route-level permission and parameter validation in the route page.
- Add new runner capability controls only after the backend contract and generated types expose the capability.
