# MVP Business Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove P0/P1 business-logic risks in frontend so the repo meets MVP readiness under the current token-first permission model.

**Architecture:** We will harden the permission path first (project entry and route gating), then eliminate role-based drift in critical pages, then align mocks and docs with current token contracts. All work follows strict TDD: write failing tests first, implement minimal fix, verify, commit. We keep changes surgical and avoid introducing new compatibility branches.

**Tech Stack:** Next.js 15 App Router, TypeScript, Zustand, React Query, MSW, Vitest, Playwright.

---

## Preconditions
- Work in a dedicated worktree created with `@superpowers:using-git-worktrees`.
- Execute with `@superpowers:executing-plans`.
- Use TDD discipline from `@superpowers:test-driven-development`.

### Task 1: Fix Projects Page Runtime Loop (P0)

**Files:**
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/page.tsx`
- Test: `e2e/console-errors.spec.ts`
- Test: `src/app/[locale]/workspaces/[workspace]/projects/__tests__/page.test.tsx`

**Step 1: Write the failing E2E assertion focused on projects page console stability**
```ts
// add/adjust test case to isolate projects page
await page.goto('/zh-CN/workspaces/ws_default/projects');
expect(consoleErrorsOnPage).toEqual([]);
```

**Step 2: Run test to verify it fails**
Run: `npm run test:e2e -- --project=chromium e2e/console-errors.spec.ts --workers=2`
Expected: FAIL with `Maximum update depth exceeded` on `/projects`.

**Step 3: Write failing unit guard for param-resolution behavior**
```ts
// in projects page test, assert no repeated state churn after initial render
expect(mockSetStateCallCount).toBe(1);
```

**Step 4: Run unit test to verify it fails**
Run: `npm run test:run -- src/app/[locale]/workspaces/[workspace]/projects/__tests__/page.test.tsx`
Expected: FAIL due to repeated updates.

**Step 5: Implement minimal fix in projects page**
- Remove Promise-to-state effect that can retrigger endlessly.
- Read route params from `useParams()` (validated) directly in client page.
- Keep page behavior unchanged otherwise.

**Step 6: Run tests to verify pass**
Run: `npm run test:run -- src/app/[locale]/workspaces/[workspace]/projects/__tests__/page.test.tsx`
Expected: PASS.

Run: `npm run test:e2e -- --project=chromium e2e/console-errors.spec.ts --workers=2`
Expected: PASS for console error checks.

**Step 7: Commit**
```bash
git add src/app/[locale]/workspaces/[workspace]/projects/page.tsx e2e/console-errors.spec.ts src/app/[locale]/workspaces/[workspace]/projects/__tests__/page.test.tsx
git commit -m "fix: remove projects page render loop and stabilize console"
```

### Task 2: Correct Project List Permission Gate Dimension (P0)

**Files:**
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/page.tsx`
- Test: `src/app/[locale]/workspaces/[workspace]/projects/__tests__/page.test.tsx`

**Step 1: Write failing test for access condition**
```ts
// user has workspace:read + project:read in project membership, but no workspace-level project:read
expect(screen.queryByTestId('page-state__error')).not.toBeInTheDocument();
```

**Step 2: Run test to verify it fails**
Run: `npm run test:run -- src/app/[locale]/workspaces/[workspace]/projects/__tests__/page.test.tsx -t "project read via project membership"`
Expected: FAIL with permission denied view.

**Step 3: Implement minimal permission logic correction**
- Remove `useHasWorkspacePermission('project:read')` from project list gate.
- Gate project list by workspace scope tokens only (`workspace:read`) and project membership fetch result.
- Keep create/delete controls bound to workspace governance tokens.

**Step 4: Run tests to verify pass**
Run: `npm run test:run -- src/app/[locale]/workspaces/[workspace]/projects/__tests__/page.test.tsx`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/app/[locale]/workspaces/[workspace]/projects/page.tsx src/app/[locale]/workspaces/[workspace]/projects/__tests__/page.test.tsx
git commit -m "fix: correct project list read gate to membership-aware token check"
```

### Task 3: Remove Remaining Role-Based Behavior in Audit/Usage Entry Logic (P1)

**Files:**
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/audit/page.tsx`
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/usage/page.tsx`
- Test: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/audit/__tests__/page.test.tsx`
- Test: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/usage/__tests__/page.test.tsx`

**Step 1: Write failing tests for token-driven default scoping**
```ts
// replace role==='user' condition expectations with token-based conditions
expect(defaultEndUserId).toBeUndefined(); // when user has project:usage:view but not self-restricted token
```

**Step 2: Run tests to verify they fail**
Run: `npm run test:run -- src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/audit/__tests__/page.test.tsx src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/usage/__tests__/page.test.tsx`
Expected: FAIL under old role logic.

**Step 3: Implement minimal token-only logic**
- Remove role checks for end-user default filter behavior.
- Derive behavior from explicit permission tokens (or remove forced default scoping entirely for MVP if not required by current contract).

**Step 4: Run tests to verify pass**
Run: same test command as step 2.
Expected: PASS.

**Step 5: Commit**
```bash
git add src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/audit/page.tsx src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/usage/page.tsx src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/audit/__tests__/page.test.tsx src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/usage/__tests__/page.test.tsx
git commit -m "refactor: remove role-based branching from audit and usage entry pages"
```

### Task 4: Normalize Members UI Filters and Data Semantics to Token-First MVP (P1)

**Files:**
- Modify: `src/components/members/PeopleTab.tsx`
- Modify: `src/components/members/MembersTable.tsx`
- Modify: `src/messages/en-US.json`
- Modify: `src/messages/zh-CN.json`
- Test: `e2e/members.spec.ts`
- Test: `src/components/members/__tests__/MembersPage.test.tsx`

**Step 1: Write failing tests for supported filter values**
```ts
// expect statuses only from supported domain values
expect(statusOptions).toEqual(['all', 'active', 'removed']);
// role filter labels should reflect template semantics used in MVP
```

**Step 2: Run tests to verify fail**
Run: `npm run test:run -- src/components/members/__tests__/MembersPage.test.tsx`
Expected: FAIL on filter options/text mismatch.

**Step 3: Implement minimal UI/domain alignment**
- Keep only domain-real filters.
- Remove stale wording that implies unsupported member states/mechanisms.
- Ensure i18n keys in both locales are synchronized.

**Step 4: Run tests to verify pass**
Run: `npm run test:run -- src/components/members/__tests__/MembersPage.test.tsx`
Expected: PASS.

Run: `npm run test:e2e -- --project=chromium e2e/members.spec.ts --workers=2`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/components/members/PeopleTab.tsx src/components/members/MembersTable.tsx src/messages/en-US.json src/messages/zh-CN.json e2e/members.spec.ts src/components/members/__tests__/MembersPage.test.tsx
git commit -m "refactor: align members filters and copy with token-first MVP model"
```

### Task 5: Clean MSW Fixtures/Handlers to Match Current Token Contract (P1)

**Files:**
- Modify: `src/mocks/handlers/projects.ts`
- Modify: `src/mocks/handlers/members.ts`
- Modify: `src/mocks/fixtures/members.ts`
- Modify: `src/mocks/fixtures/projects.ts`
- Test: `e2e/smoke.spec.ts`
- Test: `e2e/projects.spec.ts`
- Test: `e2e/controls-matrix.spec.ts`

**Step 1: Write failing tests for wildcard-free token expectations**
```ts
expect(member.permissions).not.toContain('project:*');
expect(new Set(member.permissions).size).toBe(member.permissions.length);
```

**Step 2: Run tests to verify fail**
Run: `npm run test:e2e -- --project=chromium e2e/projects.spec.ts e2e/controls-matrix.spec.ts --workers=2`
Expected: FAIL due to current wildcard/duplicate fixtures.

**Step 3: Implement minimal fixture/handler cleanup**
- Replace wildcard permissions with explicit token sets.
- Remove duplicated permissions.
- Ensure project creation grants creator the correct explicit admin token bundle.

**Step 4: Run tests to verify pass**
Run: `npm run test:e2e -- --project=chromium e2e/projects.spec.ts e2e/controls-matrix.spec.ts --workers=2`
Expected: PASS.

Run: `npm run test:e2e -- --project=smoke --workers=8`
Expected: PASS.

**Step 5: Commit**
```bash
git add src/mocks/handlers/projects.ts src/mocks/handlers/members.ts src/mocks/fixtures/members.ts src/mocks/fixtures/projects.ts e2e/projects.spec.ts e2e/controls-matrix.spec.ts
git commit -m "test: align mock permissions with explicit token contract"
```

### Task 6: Documentation Consolidation (No New Versioned Doc, Integrate into Existing) (P1)

**Files:**
- Modify: `DEVELOPMENT.md`
- Modify: `DESIGN_SYSTEM.md`
- Modify: `docs/UXUI/00-设计系统/视觉设计系统-v1.md`
- Modify: `docs/UXUI/01-通用规范/2026-02-03-i18n-内部指南-v1.md`
- Modify: permission/contract docs already used by team (update-in-place; do not create `v1.1` files)

**Step 1: Write failing docs-check checklist in plan PR description**
- Checklist items:
  - no stale `project:delete` in active token docs
  - no stale `coming soon` for already-implemented modules
  - token-first rules reflected consistently

**Step 2: Run grep to verify current drift (expected findings)**
Run: `rg -n "project:delete|coming soon|role-based|project:\*" docs src/messages`
Expected: non-zero matches before update.

**Step 3: Implement doc consolidation**
- Update existing docs only.
- Remove stale terminology.
- Align with current Chat/Studio simplification and resource policy scope.

**Step 4: Re-run drift scan**
Run: same `rg` command.
Expected: only intentional references remain (e.g., historical review docs if explicitly retained).

**Step 5: Commit**
```bash
git add DEVELOPMENT.md DESIGN_SYSTEM.md docs/UXUI/00-设计系统/视觉设计系统-v1.md docs/UXUI/01-通用规范/2026-02-03-i18n-内部指南-v1.md src/messages/en-US.json src/messages/zh-CN.json
git commit -m "docs: consolidate MVP token model and remove stale contract terminology"
```

### Task 7: Final Regression and Release-Readiness Check

**Files:**
- Modify (if needed): targeted fixes discovered during verification

**Step 1: Run lint and type-quality checks**
Run: `npm run lint`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

**Step 2: Run unit test suite**
Run: `npm run test:run`
Expected: PASS.

**Step 3: Run E2E smoke + critical chromium subset**
Run: `npm run test:e2e -- --project=smoke --workers=8`
Expected: PASS.

Run: `npm run test:e2e -- --project=chromium e2e/console-errors.spec.ts e2e/projects.spec.ts e2e/members.spec.ts e2e/resource-policy.spec.ts --workers=4`
Expected: PASS.

**Step 4: Generate MVP readiness note in repo (integrated doc section)**
- Add a short “MVP readiness status” section into existing dev doc (not a new version file), listing:
  - fixed P0 items
  - remaining known non-blockers
  - exact verification command set

**Step 5: Final commit**
```bash
git add -A
git commit -m "chore: complete MVP business hardening and verification"
```

---

## Acceptance Criteria
- No `Maximum update depth exceeded` on `/workspaces/:workspace/projects`.
- Project list access no longer incorrectly denied due to workspace/project token dimension mismatch.
- Audit/Usage no longer use role-based branching for core behavior.
- Mock data uses explicit token sets (no `project:*`, no duplicate tokens).
- Documentation is updated in-place and consistent with token-first MVP model.
- Verification command suite passes.

## Out of Scope
- Backend or edge gateway changes.
- New feature expansion beyond current MVP resource model.
- Broad UI redesign unrelated to business-logic hardening.
