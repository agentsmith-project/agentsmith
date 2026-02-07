# Token-Only Permission Model + Studio Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove role-name-based gating from frontend runtime decisions, enforce token-only authorization, seed sensible default permission template groups, and fully align naming to `studio` (not `workbench`) for MVP clarity.

**Architecture:** Keep frontend authorization as a single token-evaluation path (`useHasPermission` + token-derived capability hooks). Role/template names remain only as convenience presets in members UI and mock/dev seed data, not runtime gate conditions. Replace all gate checks that currently combine role/admin/wheel predicates with token capability checks, then align docs/contracts and tests.

**Tech Stack:** Next.js App Router, TypeScript, React Query, Zustand, Vitest, Playwright, next-intl.

---

### Task 1: Freeze Token Taxonomy and Default Template Sets

**Files:**
- Modify: `src/lib/constants/permissions.ts`
- Modify: `docs/contracts/auth-permission-model.md`
- Modify: `docs/contracts/frontend-token-interaction-contract.md`
- Modify: `docs/contracts/frontend-backend-gating-matrix.md`

**Step 1: Write the failing test**

```ts
// src/lib/constants/__tests__/permissions-taxonomy.test.ts
import { ALL_PLATFORM_PERMISSIONS, ROLE_TEMPLATES } from '@/lib/constants/permissions';

it('contains simplified MVP tokens only', () => {
  expect(ALL_PLATFORM_PERMISSIONS).toEqual(expect.arrayContaining([
    'project:source:use','project:source:manage',
    'project:endpoint:use','project:endpoint:manage',
    'project:agent:use','project:agent:manage',
    'project:resource_policy:manage','project:credential:manage','project:settings:manage',
    'project:member:view','project:member:manage',
    'project:audit:view','project:usage:view',
    'project:chat:access','project:studio:access',
  ]));
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/constants/__tests__/permissions-taxonomy.test.ts`
Expected: FAIL because old token names still exist.

**Step 3: Write minimal implementation**

- Replace old granular CRUD/resource-policy token matrix with new MVP token set.
- Define default template groups (as token bundles): `project_admin_template`, `project_operator_template`, `project_member_template`, `project_viewer_template`.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/constants/__tests__/permissions-taxonomy.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/constants/permissions.ts src/lib/constants/__tests__/permissions-taxonomy.test.ts docs/contracts/auth-permission-model.md docs/contracts/frontend-token-interaction-contract.md docs/contracts/frontend-backend-gating-matrix.md
git commit -m "refactor(auth): define simplified token taxonomy and default templates"
```

---

### Task 2: Remove Runtime Role Fallback in Permission Resolution

**Files:**
- Modify: `src/lib/hooks/use-permissions.ts`
- Test: `src/lib/hooks/__tests__/use-permissions.test.tsx`

**Step 1: Write the failing test**

```ts
it('does not fallback to role templates when permissions array is empty', () => {
  mockUseProjectReturn({ role: 'owner', permissions: [] });
  const { result } = renderHook(() => useHasPermission('project:settings:manage'));
  expect(result.current).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/hooks/__tests__/use-permissions.test.tsx`
Expected: FAIL because fallback currently grants role-template permissions.

**Step 3: Write minimal implementation**

- In `useCurrentPermissions()` and `useCurrentWorkspacePermissions()`, return only explicit permission arrays.
- Remove `ROLE_TEMPLATES` fallback from runtime hooks.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/hooks/__tests__/use-permissions.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/hooks/use-permissions.ts src/lib/hooks/__tests__/use-permissions.test.tsx
git commit -m "refactor(auth): remove role-template fallback from runtime permission hooks"
```

---

### Task 3: Replace Role/Admin/Wheel Gate Hooks with Token-Only Capability Hooks

**Files:**
- Modify: `src/lib/hooks/use-permissions.ts`
- Modify: `src/lib/hooks/use-workspace-governance.ts`
- Test: `src/lib/hooks/__tests__/use-permissions.test.tsx`

**Step 1: Write the failing test**

```ts
it('useCanManageResourcePolicy depends only on token', () => {
  mockPermissions(['project:resource_policy:manage']);
  const { result } = renderHook(() => useCanManageResourcePolicy());
  expect(result.current).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/hooks/__tests__/use-permissions.test.tsx -t "depends only on token"`
Expected: FAIL because hook currently checks project admin role + update tokens.

**Step 3: Write minimal implementation**

- Add/adjust hooks to token-only semantics:
  - `useCanManageMembers` -> `project:member:manage`
  - `useCanViewMembers` -> `project:member:view`
  - `useCanManageCredentials` -> `project:credential:manage`
  - `useCanManageSettings` -> `project:settings:manage`
  - `useCanManageResourcePolicy` -> `project:resource_policy:manage`
  - `useCanManageSource/Endpoint/Agent` -> `*:manage`
  - `useCanUseSource/Endpoint/Agent` -> `*:use`
- Keep `useCanAccessChat` / `useCanAccessStudio` token-based.
- Keep workspace governance grouping UI, but ensure it does not grant runtime gate privileges.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/hooks/__tests__/use-permissions.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/hooks/use-permissions.ts src/lib/hooks/use-workspace-governance.ts src/lib/hooks/__tests__/use-permissions.test.tsx
git commit -m "refactor(auth): convert capability hooks to token-only checks"
```

---

### Task 4: Apply New Tokens Across Route Pages (No Role Gate)

**Files:**
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agents/page.tsx`
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/endpoints/page.tsx`
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/credentials/page.tsx`
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/page.tsx`
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/settings/page.tsx`
- Modify: `src/components/sources/SourcesPage.tsx`

**Step 1: Write the failing test**

```ts
// Example for credentials route
it('shows credentials page when project:credential:manage is granted even without wheel/admin role', async () => {
  mockPermissions(['project:credential:manage']);
  render(<CredentialsPage params={...} />);
  expect(await screen.findByTestId('credentials__table')).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/credentials/__tests__/page.test.tsx`
Expected: FAIL if role/wheel gate still blocks.

**Step 3: Write minimal implementation**

- Replace checks like `isProjectAdmin && token` or `wheel && token` with direct token gates from new hooks.
- Map legacy tokens used in pages to new names (`read/create/update/delete` -> `use/manage`).

**Step 4: Run test to verify it passes**

Run: `npm test -- src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/credentials/__tests__/page.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agents/page.tsx src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/endpoints/page.tsx src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/credentials/page.tsx src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/page.tsx src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/settings/page.tsx src/components/sources/SourcesPage.tsx
git commit -m "refactor(auth): apply token-only gates across project shell pages"
```

---

### Task 5: Sidebar and Navigation Visibility to Token-Only Rules

**Files:**
- Modify: `src/components/app-shell/AppShellSidebar.tsx`
- Modify: `src/components/dashboard/ProjectNavigation.tsx`
- Test: `src/components/app-shell/__tests__/AppShellSidebar.test.tsx` (create if missing)

**Step 1: Write the failing test**

```ts
it('shows Credentials nav when user has project:credential:manage regardless of governance group', () => {
  mockPermissions(['project:credential:manage']);
  render(<AppShellSidebar ... />);
  expect(screen.getByText('Credentials')).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/components/app-shell/__tests__/AppShellSidebar.test.tsx`
Expected: FAIL if wheel-governance visibility still required.

**Step 3: Write minimal implementation**

- Remove nav item `governance: 'wheel'` gates.
- Use only token checks for nav visibility.
- Keep UX behavior identical otherwise.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/components/app-shell/__tests__/AppShellSidebar.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/app-shell/AppShellSidebar.tsx src/components/dashboard/ProjectNavigation.tsx src/components/app-shell/__tests__/AppShellSidebar.test.tsx
git commit -m "refactor(nav): use token-only visibility rules for project modules"
```

---

### Task 6: Default Group Templates in Members Module (Token Bundles)

**Files:**
- Modify: `src/components/members/ProjectGroupsSection.tsx`
- Modify: `src/components/members/PermissionTemplatesTab.tsx`
- Modify: `src/components/members/BatchApplyPermissionDialog.tsx`
- Modify: `src/components/members/MemberDetailDrawer.tsx`
- Modify: `src/components/members/PermissionsEditor/TemplateMode.tsx`
- Modify: `src/components/members/PermissionsEditor/PermissionsEditor.tsx`
- Test: `src/components/members/__tests__/PermissionTemplatesTab.test.tsx`

**Step 1: Write the failing test**

```ts
it('renders default project templates with simplified token bundles', () => {
  render(<PermissionTemplatesTab ... />);
  expect(screen.getByText(/project_admin_template/i)).toBeInTheDocument();
  expect(screen.getByText(/project_member_template/i)).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/components/members/__tests__/PermissionTemplatesTab.test.tsx`
Expected: FAIL because defaults still owner/admin/developer/user.

**Step 3: Write minimal implementation**

- Replace default template ids/names and token payloads.
- Keep “template-first apply” workflow unchanged.
- Ensure editor only displays new token set.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/components/members/__tests__/PermissionTemplatesTab.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/members/ProjectGroupsSection.tsx src/components/members/PermissionTemplatesTab.tsx src/components/members/BatchApplyPermissionDialog.tsx src/components/members/MemberDetailDrawer.tsx src/components/members/PermissionsEditor/TemplateMode.tsx src/components/members/PermissionsEditor/PermissionsEditor.tsx src/components/members/__tests__/PermissionTemplatesTab.test.tsx
git commit -m "feat(members): seed default token templates for MVP governance"
```

---

### Task 7: Align Mock Fixtures/Handlers to Token-Only Model

**Files:**
- Modify: `src/mocks/fixtures/projects.ts`
- Modify: `src/mocks/fixtures/members.ts`
- Modify: `src/mocks/handlers/workspace.ts`
- Modify: `src/mocks/handlers/members.ts`
- Modify: `src/mocks/fixtures/p0.json`

**Step 1: Write the failing test**

```ts
it('mocked members and projects expose new token names', async () => {
  const data = await getMockProjects();
  expect(data[0].permissions).toContain('project:endpoint:manage');
  expect(data[0].permissions).not.toContain('project:endpoint:update');
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/mocks --run`
Expected: FAIL due to old token fixtures.

**Step 3: Write minimal implementation**

- Replace all fixture tokens to new model.
- Remove implicit role-template privilege assumptions in handlers.
- Keep API shape stable for current frontend.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/mocks --run`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/mocks/fixtures/projects.ts src/mocks/fixtures/members.ts src/mocks/handlers/workspace.ts src/mocks/handlers/members.ts src/mocks/fixtures/p0.json
git commit -m "test(mocks): align seed permissions with simplified token model"
```

---

### Task 8: Studio Naming Consistency (Keep namespace compatibility, update user-facing wording)

**Files:**
- Modify: `src/messages/en-US.json`
- Modify: `src/messages/zh-CN.json`
- Modify: `src/components/app-shell/AppShellSidebar.tsx`
- Modify: `docs/UXUI/01-通用规范/页面清单-模块与权限可见性-v1.md`
- Modify: `docs/contracts/frontend-mvp-role-governance-requirements.md`

**Step 1: Write the failing test**

```ts
it('navigation shows AI Studio label instead of Workbench', async () => {
  render(<AppShellSidebar ... />);
  expect(screen.queryByText(/Workbench/i)).not.toBeInTheDocument();
  expect(screen.getByText(/AI Studio/i)).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/components/app-shell --run`
Expected: FAIL where old visible labels remain.

**Step 3: Write minimal implementation**

- Keep technical route path compatibility if needed (`/workbench`), but all visible copy uses `Studio`/`AI Studio`.
- Contracts/docs replace normative references from workbench to studio.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/components/app-shell --run`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/messages/en-US.json src/messages/zh-CN.json src/components/app-shell/AppShellSidebar.tsx docs/UXUI/01-通用规范/页面清单-模块与权限可见性-v1.md docs/contracts/frontend-mvp-role-governance-requirements.md
git commit -m "docs(i18n): standardize user-facing naming to AI Studio"
```

---

### Task 9: Route and Module Gate E2E Coverage for New Tokens

**Files:**
- Modify: `e2e/navigation.spec.ts`
- Modify: `e2e/members.spec.ts`
- Modify: `e2e/resource-policy.spec.ts`
- Modify: `e2e/credentials.spec.ts`
- Modify: `e2e/fixtures/test-base.ts`

**Step 1: Write the failing test**

```ts
test('credentials module visible with project:credential:manage token only', async ({ authedPage }) => {
  await authedPage.goto(...);
  await expect(authedPage.getByTestId('nav__credentials')).toBeVisible();
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- e2e/navigation.spec.ts e2e/credentials.spec.ts --project=chromium --workers=4`
Expected: FAIL before gates are fully token-only.

**Step 3: Write minimal implementation**

- Update fixture permissions used in e2e helper users.
- Add explicit cases for `use/manage/view/access` tokens.

**Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- e2e/navigation.spec.ts e2e/credentials.spec.ts e2e/members.spec.ts e2e/resource-policy.spec.ts --project=chromium --workers=6`
Expected: PASS.

**Step 5: Commit**

```bash
git add e2e/navigation.spec.ts e2e/members.spec.ts e2e/resource-policy.spec.ts e2e/credentials.spec.ts e2e/fixtures/test-base.ts
git commit -m "test(e2e): cover token-only gates and template-based defaults"
```

---

### Task 10: Final Regression Sweep + Contract Consolidation

**Files:**
- Modify: `docs/contracts/README.md`
- Modify: `docs/contracts/route-gate-test-checklist.md`
- Modify: `docs/UXUI/01-通用规范/页面清单-模块与权限可见性-v1.md`

**Step 1: Write the failing check**

```bash
rg -n "wheel|owner|admin|developer|project:endpoint:update|project:source:library:update|workbench" docs/contracts docs/UXUI
```

**Step 2: Run check to verify it fails**

Expected: Finds outdated terminology/tokens.

**Step 3: Write minimal implementation**

- Consolidate docs to latest single-source token model and `studio` naming.
- Remove outdated role-as-gate language.

**Step 4: Run final verification**

Run:
- `npm run lint`
- `npm test`
- `npm run test:e2e -- --project=smoke --workers=8`
- `npm run test:e2e -- e2e/navigation.spec.ts e2e/members.spec.ts e2e/resource-policy.spec.ts e2e/credentials.spec.ts --project=chromium --workers=8`

Expected: All pass.

**Step 5: Commit**

```bash
git add docs/contracts/README.md docs/contracts/route-gate-test-checklist.md docs/UXUI/01-通用规范/页面清单-模块与权限可见性-v1.md
git commit -m "docs(contracts): finalize token-only MVP gating model"
```

---

## Notes for Implementer

- YAGNI: do not introduce dynamic per-resource token generation for MVP.
- Keep token namespace flat and explicit; resource-specific fine-grain stays in Resource Policy payload, not token names.
- No backward-compat shims for old token payloads (pre-release rule).
- If backend payload still sends legacy tokens in dev, update mocks immediately rather than adding fallback compatibility logic.
