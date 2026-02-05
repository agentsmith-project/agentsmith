# Frontend E2E Coverage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure Playwright covers every page route in the frontend (admin, `en-US`) with stable, maintainable E2E tests.

**Architecture:** Centralize authenticated-page setup via a shared Playwright fixture that injects the zustand mock auth before app boot. Add a route inventory and “route coverage” smoke suite that navigates every page and asserts a stable, visible heading/marker per route. Refactor existing specs to reuse shared helpers and remove duplicated auth setup.

**Tech Stack:** Next.js App Router, Playwright, MSW mock data, zustand auth store.


### Task 1: Build Route Inventory for All Pages

**Files:**
- Create: `e2e/fixtures/routes.ts`
- Modify: `e2e/navigation.spec.ts`

**Step 1: Write the failing test**

Add a new route list that includes all `page.tsx` routes found in `src/app`. Then update `navigation.spec.ts` to include missing routes so it fails before coverage is complete.

```ts
// e2e/fixtures/routes.ts
export const ROUTES = {
  public: [
    { path: '/', title: /MBOS|Login|Sign in/i },
    { path: '/en-US', title: /MBOS|Login|Sign in/i },
    { path: '/en-US/login', title: /Login|Sign in/i },
    { path: '/en-US/login/workspace', title: /Workspace|Select/i },
    { path: '/en-US/join', title: /Join|Workspace/i },
  ],
  user: [
    { path: '/en-US/user/profile', title: /Profile|Account/i },
    { path: '/en-US/user/api-keys', title: /API Keys|Keys/i },
  ],
  workspace: [
    { path: '/en-US/workspaces/ws_default/projects', title: /Projects/i },
    { path: '/en-US/workspaces/ws_default/settings', title: /Workspace Settings|Settings/i },
  ],
  project: [
    { path: '/en-US/workspaces/ws_default/projects/proj_001/overview', title: /Overview/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/chat', title: /Chat|New Chat/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/workbench', title: /Workbench/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/workbench/recipes/recipe_001', title: /Recipe|Workbench/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/agents', title: /Agents/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/endpoints', title: /Endpoints/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/members', title: /Members/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/audit', title: /Audit/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/usage', title: /Usage/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/userdata', title: /User Data|Userdata/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/sources', title: /Sources/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/credentials', title: /Credentials|Keys/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/settings', title: /Settings|Project/i },
  ],
};
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/navigation.spec.ts`
Expected: FAIL when any route doesn’t match the expected title/heading.

**Step 3: Write minimal implementation**

Update `e2e/navigation.spec.ts` to import and use the shared `ROUTES.project` list so it fails until we implement missing page fixtures/tests.

```ts
import { ROUTES } from './fixtures/routes';

const pages = ROUTES.project.map(route => ({ path: route.path, title: route.title }));
```

**Step 4: Run test to verify it passes**

Run: `npx playwright test e2e/navigation.spec.ts`
Expected: PASS after remaining tasks are completed.

**Step 5: Commit**

```bash
git add e2e/fixtures/routes.ts e2e/navigation.spec.ts
git commit -m "test: add route inventory for e2e coverage"
```


### Task 2: Add Shared Authenticated Fixture + Navigation Helpers

**Files:**
- Create: `e2e/fixtures/authenticated.ts`
- Create: `e2e/utils/navigation.ts`
- Modify: `e2e/*.spec.ts` (use shared fixture)

**Step 1: Write the failing test**

Create a tiny spec to exercise the shared fixture before refactor:

```ts
// e2e/auth-fixture.spec.ts
import { test, expect } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';

test('auth fixture seeds login', async ({ page }) => {
  await withAuth(page);
  await page.goto('/en-US/workspaces/ws_default/projects');
  await expect(page.getByRole('heading', { name: /Projects/i })).toBeVisible();
});
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/auth-fixture.spec.ts`
Expected: FAIL because `withAuth` doesn’t exist.

**Step 3: Write minimal implementation**

```ts
// e2e/fixtures/authenticated.ts
import { Page } from '@playwright/test';

export async function withAuth(page: Page, wsId = 'ws_default', userEmail = 'test@example.com') {
  await page.addInitScript(({ wsId, userEmail }) => {
    (window as any).__MBOS_AUTH_SETUP__ = true;
    const checkAuth = () => {
      const store = (window as any).__MBOS_AUTH_STORE__;
      if (store && store.getState) {
        const state = store.getState();
        if (!state.isAuthenticated || state.projects.length === 0) {
          store.getState().mockLogin(wsId, userEmail);
        }
        return true;
      }
      return false;
    };
    if (!checkAuth()) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (checkAuth() || attempts > 100) {
          clearInterval(interval);
        }
      }, 50);
    }
  }, { wsId, userEmail });
}
```

```ts
// e2e/utils/navigation.ts
import { Page } from '@playwright/test';

export async function gotoAndWait(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
}
```

Refactor existing specs to use these helpers (remove repeated `addInitScript` blocks and local helper functions).

**Step 4: Run test to verify it passes**

Run: `npx playwright test e2e/auth-fixture.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add e2e/fixtures/authenticated.ts e2e/utils/navigation.ts e2e/auth-fixture.spec.ts e2e/*.spec.ts
git commit -m "test: centralize auth fixture and navigation helper"
```


### Task 3: Add Page Coverage for Non-Project Routes

**Files:**
- Create: `e2e/account.spec.ts`
- Modify: `e2e/login.spec.ts`
- Modify: `e2e/homepage.spec.ts`

**Step 1: Write the failing test**

```ts
// e2e/account.spec.ts
import { test, expect } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

test.describe('Account pages', () => {
  test('profile page loads', async ({ page }) => {
    await withAuth(page);
    await gotoAndWait(page, '/en-US/user/profile');
    await expect(page.getByRole('heading', { name: /Profile|Account/i })).toBeVisible();
  });

  test('api keys page loads', async ({ page }) => {
    await withAuth(page);
    await gotoAndWait(page, '/en-US/user/api-keys');
    await expect(page.getByRole('heading', { name: /API Keys|Keys/i })).toBeVisible();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/account.spec.ts`
Expected: FAIL until selectors are aligned with UI.

**Step 3: Write minimal implementation**

Update `e2e/login.spec.ts` to assert the `/en-US/login/workspace` page heading after quick login. Update `e2e/homepage.spec.ts` to include `/en-US` route and use role selectors for headings.

**Step 4: Run test to verify it passes**

Run: `npx playwright test e2e/account.spec.ts e2e/login.spec.ts e2e/homepage.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add e2e/account.spec.ts e2e/login.spec.ts e2e/homepage.spec.ts
git commit -m "test: add account and public page coverage"
```


### Task 4: Add Coverage for Missing Project Pages

**Files:**
- Modify: `e2e/navigation.spec.ts`
- Create: `e2e/project-misc.spec.ts`

**Step 1: Write the failing test**

```ts
// e2e/project-misc.spec.ts
import { test, expect } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

const base = '/en-US/workspaces/ws_default/projects/proj_001';

test.describe('Project misc pages', () => {
  test('credentials page loads', async ({ page }) => {
    await withAuth(page);
    await gotoAndWait(page, `${base}/credentials`);
    await expect(page.getByRole('heading', { name: /Credentials|Keys/i })).toBeVisible();
  });

  test('userdata page loads', async ({ page }) => {
    await withAuth(page);
    await gotoAndWait(page, `${base}/userdata`);
    await expect(page.getByRole('heading', { name: /User Data|Userdata/i })).toBeVisible();
  });

  test('workbench recipe page loads', async ({ page }) => {
    await withAuth(page);
    await gotoAndWait(page, `${base}/workbench/recipes/recipe_001`);
    await expect(page.getByRole('heading', { name: /Recipe|Workbench/i })).toBeVisible();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/project-misc.spec.ts`
Expected: FAIL until headings/selectors align.

**Step 3: Write minimal implementation**

Update `e2e/navigation.spec.ts` to include `credentials`, `userdata`, and `workbench/recipes/recipe_001` in the route list (from `ROUTES.project`). If headings don’t exist, add minimal `data-testid` markers in the page components and target those.

**Step 4: Run test to verify it passes**

Run: `npx playwright test e2e/project-misc.spec.ts e2e/navigation.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add e2e/project-misc.spec.ts e2e/navigation.spec.ts
# plus any page components updated for testids
git commit -m "test: cover missing project routes"
```


### Task 5: Stabilize Selectors and Remove Flaky Patterns

**Files:**
- Modify: `e2e/*.spec.ts`
- Modify (if needed): `src/app/**/page.tsx`

**Step 1: Write the failing test**

Pick one flaky spec that relies on CSS layout classes and replace with semantic selectors, then run it to ensure it fails until selectors are updated.

**Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/chat.spec.ts`
Expected: FAIL if `.w-80`/`.w-72` selectors are removed.

**Step 3: Write minimal implementation**

Replace CSS-based selectors with role or `data-testid` selectors. If needed, add `data-testid` to the relevant layout containers (only where no semantic roles exist).

**Step 4: Run test to verify it passes**

Run: `npx playwright test e2e/chat.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add e2e/chat.spec.ts src/app/**/page.tsx
git commit -m "test: stabilize selectors for e2e"
```


### Task 6: Full Route Coverage Smoke Suite

**Files:**
- Create: `e2e/route-coverage.spec.ts`

**Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test';
import { ROUTES } from './fixtures/routes';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

test.describe('Route coverage', () => {
  test('public routes', async ({ page }) => {
    for (const route of ROUTES.public) {
      await gotoAndWait(page, route.path);
      await expect(page.getByRole('heading', { name: route.title }).first()).toBeVisible();
    }
  });

  test('authenticated routes', async ({ page }) => {
    await withAuth(page);
    const allAuthed = [...ROUTES.user, ...ROUTES.workspace, ...ROUTES.project];
    for (const route of allAuthed) {
      await gotoAndWait(page, route.path);
      await expect(page.getByRole('heading', { name: route.title }).first()).toBeVisible();
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/route-coverage.spec.ts`
Expected: FAIL until all pages have stable headings/testids.

**Step 3: Write minimal implementation**

Add missing headings or `data-testid` markers to target in tests.

**Step 4: Run test to verify it passes**

Run: `npx playwright test e2e/route-coverage.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add e2e/route-coverage.spec.ts src/app/**/page.tsx
git commit -m "test: add route coverage smoke suite"
```


### Task 7: E2E Review + Cleanup

**Files:**
- Modify: `e2e/full-app.spec.ts`
- Modify: `e2e/console-errors.spec.ts`

**Step 1: Write the failing test**

Create a single run that ensures the suite has no known console noise except the allowlist.

**Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/console-errors.spec.ts`
Expected: FAIL if new logs appear while expanding coverage.

**Step 3: Write minimal implementation**

Update `console-errors.spec.ts` allowlist patterns to align with current MSW mocks, and trim `full-app.spec.ts` to avoid duplicate route checks covered by `route-coverage.spec.ts`.

**Step 4: Run test to verify it passes**

Run: `npx playwright test e2e/console-errors.spec.ts e2e/full-app.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add e2e/console-errors.spec.ts e2e/full-app.spec.ts
git commit -m "test: refine e2e suite coverage and console guard"
```


### Task 8: Final Verification

**Files:**
- Modify: (none)

**Step 1: Run full e2e suite**

Run: `npx playwright test`
Expected: PASS

**Step 2: Run smoke build**

Run: `npm run build`
Expected: PASS (or existing ESLint issues noted)

**Step 3: Commit final doc update**

Update project docs as needed with coverage summary.

```bash
git add docs/
git commit -m "docs: record e2e coverage sweep"
```
