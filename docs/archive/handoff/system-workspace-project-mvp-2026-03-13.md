# System / Workspace / Project MVP Handoff

> Historical handoff note. This file is archived context, not current implementation truth.

Date: 2026-03-13

## 1. Handoff Purpose

This handoff captures the current `system / workspace / project` MVP workstream so another development agent can continue without reconstructing context from chat history.

This stream has focused on three goals:

1. Define and enforce the MVP product boundary
2. Rebuild the `system -> workspace -> project` entry and control-plane flow
3. Move authorization truth toward `permission + scope`, while demoting `owner/admin/...` to relation/group concepts only

## 2. MVP Goal and Scope

### 2.1 Product Goal

The current target product shape is:

1. `System Admin`
2. `Workspace Business Entry`
3. `Project Entry`
4. `Usage`
5. `Audit`

`Runtime` is no longer a standalone product surface.

### 2.2 Identity and Authorization Truth

The currently accepted model is:

1. `Authn` is provided by the workspace-bound IdP
2. `Authz` is enforced by AgentSmith
3. `permission token + scope` is the runtime authorization truth
4. `WorkspaceAdmin`, `ProjectCreator`, `ProjectOwner`, `ProjectAdmin` are **not** first-class authz primitives

These labels are only:

1. default groups
2. resource relationship labels
3. management UI concepts

They may be used to derive permissions, but they must not become a second authz system beside permission checks.

### 2.3 System / Workspace Control-Plane Goal

System admin should be able to:

1. create workspace drafts
2. configure workspace basics
3. configure workspace IdP
4. assign workspace admin
5. save draft
6. publish workspace
7. wait for synchronous initialization to complete
8. inspect restrained system-level provisioning and connectivity status

The control plane must remain restrained:

1. no business KPIs
2. no performance dashboard
3. no pseudo-operational charts

## 3. Authoritative Documents

These documents are the current source of truth and should be read first:

1. [CURRENT_BASELINE.md](/home/percy/works/mbos-v1/agentsmith/docs/CURRENT_BASELINE.md)
2. [项目宪法.md](/home/percy/works/mbos-v1/agentsmith/docs/项目宪法.md)
3. [auth-permission-model.md](/home/percy/works/mbos-v1/agentsmith/docs/contracts/auth-permission-model.md)
4. [system-workspace-identity-entry-mvp-v1.md](/home/percy/works/mbos-v1/agentsmith/docs/UXUI/01-通用规范/system-workspace-identity-entry-mvp-v1.md)
5. [system-workspace-provisioning-mvp-analysis-v1.md](/home/percy/works/mbos-v1/agentsmith/docs/UXUI/01-通用规范/system-workspace-provisioning-mvp-analysis-v1.md)
6. [usage-audit-职责边界-v1.md](/home/percy/works/mbos-v1/agentsmith/docs/UXUI/01-通用规范/usage-audit-职责边界-v1.md)
7. [usage-audit-mvp-功能与uxui-v1.md](/home/percy/works/mbos-v1/agentsmith/docs/UXUI/01-通用规范/usage-audit-mvp-功能与uxui-v1.md)
8. [frontend-backend-gating-matrix.md](/home/percy/works/mbos-v1/agentsmith/docs/contracts/frontend-backend-gating-matrix.md)
9. [frontend-token-interaction-contract.md](/home/percy/works/mbos-v1/agentsmith/docs/contracts/frontend-token-interaction-contract.md)

## 4. Current Entry and Control Surfaces

### 4.1 System Admin

Current system-admin routes:

1. `/system/login`
2. `/system/workspaces`
3. `/system/info`

Current main files:

1. [src/app/[locale]/system/login/page.tsx](/home/percy/works/mbos-v1/agentsmith/src/app/[locale]/system/login/page.tsx)
2. [src/app/[locale]/system/workspaces/page.tsx](/home/percy/works/mbos-v1/agentsmith/src/app/[locale]/system/workspaces/page.tsx)
3. [src/app/[locale]/system/info/page.tsx](/home/percy/works/mbos-v1/agentsmith/src/app/[locale]/system/info/page.tsx)
4. [src/components/system/SystemWorkspacesPage.tsx](/home/percy/works/mbos-v1/agentsmith/src/components/system/SystemWorkspacesPage.tsx)
5. [src/components/system/SystemInfoPage.tsx](/home/percy/works/mbos-v1/agentsmith/src/components/system/SystemInfoPage.tsx)

### 4.2 Workspace Business Entry

Current workspace business entry routes:

1. `/login`
2. `/login/workspace`
3. `/workspaces/[workspace]/login`
4. `/workspaces/[workspace]`
5. `/workspaces/[workspace]/projects`
6. `/workspaces/[workspace]/settings`

Current main files:

1. [src/app/[locale]/login/workspace/page.tsx](/home/percy/works/mbos-v1/agentsmith/src/app/[locale]/login/workspace/page.tsx)
2. [src/app/[locale]/workspaces/overview/page.tsx](/home/percy/works/mbos-v1/agentsmith/src/app/[locale]/workspaces/overview/page.tsx)
3. [src/app/[locale]/workspaces/[workspace]/login/page.tsx](/home/percy/works/mbos-v1/agentsmith/src/app/[locale]/workspaces/[workspace]/login/page.tsx)
4. [src/app/[locale]/workspaces/[workspace]/page.tsx](/home/percy/works/mbos-v1/agentsmith/src/app/[locale]/workspaces/[workspace]/page.tsx)
5. [src/app/[locale]/workspaces/[workspace]/projects/page.tsx](/home/percy/works/mbos-v1/agentsmith/src/app/[locale]/workspaces/[workspace]/projects/page.tsx)
6. [src/app/[locale]/workspaces/[workspace]/settings/page.tsx](/home/percy/works/mbos-v1/agentsmith/src/app/[locale]/workspaces/[workspace]/settings/page.tsx)

### 4.3 Project Entry

Current project entry route:

1. `/workspaces/[workspace]/projects/[project]/overview`

Current main file:

1. [src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/page.tsx](/home/percy/works/mbos-v1/agentsmith/src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/page.tsx)

## 5. What Has Been Completed

### 5.1 System / Workspace / Project Entry Rebuild

Completed:

1. system admin entry separated from workspace business entry
2. workspace business entry unified through workspace login
3. system workspace cards route to workspace login, not directly into business pages
4. workspace overview cards route to workspace login
5. workspace login routes to workspace home
6. workspace home routes to projects and workspace settings
7. project hub simplified into a restrained entry page

### 5.2 Workspace Admin and Project Creator Flow

Completed:

1. workspace admin can create projects
2. workspace admin can assign project admins
3. workspace admin can manage project creators
4. project creator can create projects
5. project creator does not gain workspace admin access
6. project creator becomes project owner on create
7. project creator / workspace admin / member entry differences are covered by tests and visual baselines

### 5.3 Project Owner vs Project Admin

Completed:

1. owner transfer is implemented
2. after owner transfer, previous owner is automatically retained as project admin
3. project owner lifecycle controls and project admin governance controls are separated
4. member governance writes were constrained and then re-aligned around permission truth
5. project settings page was split into governance vs ownership/lifecycle sections

### 5.4 Fine-Grained Permission Model

Completed:

1. `project:audit:read`
2. `project:governance:update`
3. `project:membership:update`
4. `project:admins:update`
5. `project:lifecycle:update`
6. `project:files:update`
7. `project:agent:manage`
8. `project:agent:public`

Mainline surfaces migrated away from coarse `project:manage` include:

1. `Audit`
2. `Alerts`
3. `Endpoints`
4. `Agents`
5. `Files`
6. major `Project Settings` entry and explainability chains

`project:manage` remains only as a legacy compatibility token and migration note, not as authz truth.

### 5.5 Audit / Usage Stability

Completed:

1. `Usage` and `Audit` MVP surfaces were previously stabilized
2. E2E and visual baselines are green for those main surfaces
3. `Audit` now captures key workspace/project governance events in readable form

This handoff is not about rebuilding `Usage/Audit`, but those surfaces remain stable and relevant context.

### 5.6 Workspace Provisioning Control-Plane Skeleton

Completed:

1. workspace registry supports:
   - `draft`
   - `provisioning`
   - `ready`
   - `failed`
   - `disabled`
2. system workspace save resets modified config back to `draft`
3. only `ready` workspace exposes business login
4. provisioning state locks edit actions
5. disabled workspaces can be republished
6. restrained system info summary shows workspace provisioning counts

Main files:

1. [src/lib/system-admin/workspace-registry.ts](/home/percy/works/mbos-v1/agentsmith/src/lib/system-admin/workspace-registry.ts)
2. [src/lib/system-admin/system-info.ts](/home/percy/works/mbos-v1/agentsmith/src/lib/system-admin/system-info.ts)

## 6. Current In-Flight Technical Direction

### 6.1 Data-Plane Isolation Work Has Started

The current active engineering direction is:

**move tenant configuration from control-plane preview into actual backend data partitioning**

The first slice of this work is completed:

1. backend workspace registry now parses tenant config
2. model-config storage now uses tenant-prefixed collections for workspace-scoped collections

Completed commit:

1. `1c547c3a` `feat: apply workspace tenant prefixes to model config storage`

Key files:

1. [packages/api-entry-node/src/workspace-registry.ts](/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node/src/workspace-registry.ts)
2. [packages/api-entry-node/src/workspace-tenant-collections.ts](/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node/src/workspace-tenant-collections.ts)
3. [packages/api-entry-node/src/model-config-store.ts](/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node/src/model-config-store.ts)
4. [packages/api-entry-node/src/model-config-store.test.ts](/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node/src/model-config-store.test.ts)

### 6.2 What That First Isolation Slice Actually Covers

Tenant-prefixed collections are now used for workspace-scoped model config data:

1. `provider_connections`
2. `project_model_entries`
3. `project_pricing_maps`

Global catalog collections intentionally remain global.

## 7. What Is Not Done Yet

### 7.1 Workspace Provisioning Is Not a Full Backend Bootstrap Yet

This is the most important gap.

Current reality:

1. `publishSystemWorkspace()` calls `initializeWorkspaceResources()`
2. `initializeWorkspaceResources()` currently validates config and writes a provisioning artifact JSON
3. It does **not** yet fully bootstrap downstream workspace-specific backend resources

This means:

1. control plane provisioning semantics are in place
2. data-plane bootstrap semantics are still incomplete

### 7.2 Data-Plane Isolation Is Only Partially Applied

Only model-config storage has been moved to tenant-prefixed collections so far.

Still needs review and likely migration:

1. endpoint config storage
2. credentials and credential metadata
3. project metadata / governance storage
4. project-scoped audit / usage stores where appropriate
5. any other workspace-private JSON doc collections

### 7.3 IdP Config Validation Is Still Minimal

Current state:

1. system admin can save Keycloak config
2. publishing validates presence of required values

Still missing:

1. minimal connectivity check
2. callback readiness check
3. explicit status feedback for IdP availability

### 7.4 Secret Handling Is MVP-Level Only

Current registry stores IdP client secret in registry-backed config.

This is acceptable for current MVP development, but not a final security posture.

## 8. Recommended Next Development Plan

This is the recommended plan for the next development agent.

### Phase 1. Continue Data-Plane Tenant Isolation

Highest priority.

1. inventory all workspace-private backend stores
2. move them to use tenant-prefixed collections
3. keep global/system collections global
4. add focused tests for each migrated store

Suggested order:

1. endpoint/resource config storage
2. credentials-related storage
3. project metadata / governance storage
4. other workspace-private collections

### Phase 2. Make Publish Actually Provision Backend Foundations

Second priority.

Upgrade `initializeWorkspaceResources()` from validation-only behavior into actual provisioning behavior.

Minimum goal:

1. materialize tenant-specific data namespaces/collections/prefixes as needed
2. persist explicit initialization result
3. update provisioning status accurately

Target statuses:

1. `draft`
2. `provisioning`
3. `ready`
4. `failed`
5. `disabled`

### Phase 3. Expose Restrained Provisioning Health

System admin pages should remain restrained.

Add or improve:

1. last initialization timestamp
2. last initialization result
3. last initialization error summary
4. minimal IdP validity/connectivity status
5. minimal data-service availability status

Do **not** add:

1. business KPIs
2. performance charts
3. operational dashboards

### Phase 4. Tighten Workspace Lifecycle Semantics

Clarify and enforce:

1. what delete means
2. whether delete is registry-only, disable-first, or soft-retire
3. what disabled workspaces may still retain

Recommended MVP posture:

1. `disable` is the primary non-destructive operation
2. `delete` should remain tightly constrained

### Phase 5. Re-Run Validation Matrix

After each meaningful provisioning/data-plane slice:

1. unit tests
2. targeted API route tests
3. focused chromium E2E
4. focused visual for `system workspaces` and `system info`
5. typecheck

## 9. Suggested Validation Commands

Useful commands for the next agent:

1. `npx tsc --noEmit`
2. `npm run test -- packages/api-entry-node/src/model-config-store.test.ts`
3. `npm run test -- packages/api-entry-node/src/model-config-route-handler.test.ts`
4. `npm run test -- packages/api-entry-node/src/model-request-execution.test.ts`
5. `npm run test -- src/components/system/__tests__/SystemWorkspacesPage.test.tsx src/components/system/__tests__/SystemInfoPage.test.tsx`
6. `./scripts/run-mock-lane-playwright.sh e2e/system-admin.spec.ts --project=chromium --workers=1`
7. `./scripts/run-mock-lane-playwright.sh e2e/visual.spec.ts --project=visual --workers=1 --grep \"system|workspace home|workspace login|project overview\"`

## 10. Important Guardrails for the Next Agent

1. Do not reintroduce runtime/release-ops style expansion
2. Do not turn `System Info` into an ops dashboard
3. Do not make `owner/admin/...` authz first-class citizens again
4. Keep `permission + scope` as the runtime authz truth
5. Keep workspace provisioning restrained and system-focused
6. Prefer automated tenant naming and provisioning over manual low-level configuration

## 11. Current Repository State at Handoff

At handoff time:

1. working tree was clean after the last committed change
2. latest completed data-plane isolation slice commit:
   - `1c547c3a` `feat: apply workspace tenant prefixes to model config storage`
3. system/workspace/project control-plane skeleton is stable
4. provisioning semantics are real in the control plane, but still partial in the backend data plane
