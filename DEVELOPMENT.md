# MBOS Frontend - Development Guide

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run Storybook
npm run storybook

# Build for production
npm run build
npm start
```

## Environment Setup

Copy `.env.local.example` to `.env.local` and configure:

```bash
# For local development with backend
NEXT_PUBLIC_API_BASE=http://localhost:20000
NEXT_PUBLIC_USE_MSW=true
NEXT_PUBLIC_BYPASS_AUTH=false

# For local development with Keycloak
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms
NEXT_PUBLIC_KEYCLOAK_REALM=mbos
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=mbos-frontend
```

## Project Structure

```
src/
├── app/                 # Next.js App Router pages
│   ├── [locale]/        # i18n routed pages
│   ├── app-shell/      # App shell preview
│   └── login/          # Login page (not routed)
├── components/          # React components
│   ├── app-shell/      # App shell components (Topbar, Sidebar)
│   ├── ui/              # shadcn/ui components
│   └── ...
├── lib/                 # Utilities and libraries
│   ├── api/             # API client with adapter pattern
│   ├── hooks/           # Custom React hooks
│   ├── stores/          # Zustand state
│   ├── i18n/            # i18n configuration
│   └── utils/           # Utility functions
├── messages/            # i18n message files
├── mocks/               # MSW mock handlers
└── stories/             # Storybook stories
```

## Design System Reference

See `DESIGN_SYSTEM.md` for the complete design system reference.

**Important**: All UI designs must strictly follow the visual design system document:
`/home/percy/works/mygithub/mbos-server/文档/UXUI/2026-01-31-视觉设计系统-v1.md`

## API Architecture

The frontend uses an adapter pattern for easy switching between MSW mocks and real backend:

- `lib/api/client.ts` - API client interface
- `lib/api/adapters/fetch-adapter.ts` - Real API implementation
- `lib/api/adapters/msw-adapter.ts` - MSW mock implementation

Switch via `NEXT_PUBLIC_USE_MSW` environment variable.

## Authentication Flow

### Development (Current)
1. User enters email on login page
2. Quick Login generates mock token and sets auth state
3. User can access protected routes

### Production (Future)
1. User clicks "Login with Keycloak"
2. Redirect to Keycloak
3. Keycloak redirects back with JWT
4. JWT is stored and used for API calls

## State Management

- **Zustand** for global state
- **Auth Store** (`lib/stores/authStore.ts`) - Authentication state, workspace/project context
- LocalStorage persistence for auth state

## Component Development

1. Create component in `src/components/`
2. Add corresponding story in `src/stories/`
3. Review in Storybook (`npm run storybook`)
4. Update this guide with component details

## Route Gate Check (Required)

Before merging any new or changed route files, run:

```bash
npm run contracts:check
```

This check enforces route guard quality gates:

1. valid permission names only
2. route param validation presence
3. `__tests__/page.test.tsx` existence
4. invalid-param test coverage
5. forbidden/permission-denied test coverage for permission-gated routes

Current scope:

1. `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/**/page.tsx`
2. `src/app/[locale]/workspaces/[workspace]/projects/page.tsx`

CI runs the same command and fails the pipeline on missing coverage.

## Playwright E2E Runbook (Recommended)

Use this runbook when E2E is unstable or intermittently timing out.

### 1) Start dev server in a persistent terminal

```bash
npm run dev:test -- --port 3001
```

### 2) Run Playwright with explicit base URL

```bash
BASE_URL=http://localhost:3001 npm run test:e2e -- --project=smoke
```

This bypasses Playwright-managed `webServer` startup ambiguity and is more stable in long sessions.

### 3) Use route-targeted smoke for fast triage

```bash
BASE_URL=http://localhost:3001 npx playwright test --project=smoke e2e/smoke.spec.ts \
  --grep "loads /zh-CN/workspaces/ws_default/projects/proj_001/agents$" \
  --workers=1 --max-failures=1
```

### 4) Distinguish infra failure from app failure

If `page.goto` hangs, first check server health:

```bash
curl -I --max-time 15 http://localhost:3001/
curl -I --max-time 15 http://localhost:3001/zh-CN/workspaces/ws_default/projects
```

If curl times out, restart dev server before debugging selectors/assertions.

### 5) Inspect Playwright error context first

When tests fail, inspect:

- `test-results/**/error-context.md`
- `test-results/**/test-failed-1.png`

This is usually faster than changing selectors blindly.

## Permission Gate Hook Rule (Important)

Never short-circuit React hooks in permission guards.

Do not write:

```tsx
const canRead = useHasPermission('x') || useHasPermission('y');
```

Write:

```tsx
const canX = useHasPermission('x');
const canY = useHasPermission('y');
const canRead = canX || canY;
```

Reason: short-circuiting can change hook call order across renders and cause runtime crashes (`Rendered more hooks than during the previous render` / `Cannot read properties of undefined (reading 'length')`).

## Troubleshooting

### Project list click/permission anomalies in MSW mode

If project rows are visible but clicking into a project leads to immediate permission denial,
or project settings actions appear non-responsive, verify fixture identity consistency first:

1. `src/mocks/fixtures/p0.json` auth user id
2. `src/mocks/fixtures/projects.ts` `CURRENT_USER_ID`
3. project membership `user_id` values used by `src/mocks/handlers/projects.ts`

These ids must match, otherwise project membership permissions are resolved as empty arrays.

Permission gate model (MVP) is token-first:
- Project list visibility checks `workspace:read` and data membership presence.
- Do not require `project:read` as a workspace-level permission token.
- Project internal routes use project membership permission tokens.

Pinned project state is persisted in localStorage key:
`mbos:projects:pinned:<workspaceId>`.
If pin state does not survive refresh, inspect browser localStorage and workspace id resolution.

## Visual Baselines (Best Practice)

For reliable full-page screenshots, run visual tests against a production build
and keep dev indicators disabled in local dev. This avoids dev overlays and the
Next.js dev tools badge appearing in screenshots.

**Recommended (production visuals):**
```bash
npm run build
npm run start
BASE_URL=http://localhost:3000 npx playwright test --project=visual --update-snapshots
```

**Dev visuals (when you must run `next dev`):**
```bash
npm run dev
BASE_URL=http://localhost:3001 npx playwright test --project=visual --update-snapshots
```

If `next build` is blocked by existing lint warnings in test files, you can
temporarily disable lint during the visual build only:
```bash
NEXT_DISABLE_ESLINT=1 npm run build
npm run start
BASE_URL=http://localhost:3000 npx playwright test --project=visual --update-snapshots
```

**Restore default dev indicators:**
- In `next.config.ts`, remove `devIndicators: false` or set it to `true`.
- In `src/app/globals.css`, remove the `nextjs-portal { display: none; }` rule.
- Ensure `NEXT_DISABLE_ESLINT` is unset for normal production builds.

Visual tests will still work in `next dev`, but overlays may appear unless
dev indicators are disabled.

### Test Failures

#### "QueryClientProvider not found"
**Problem**: Tests fail with "QueryClientProvider not found"
**Solution**: Wrap test render with QueryClientProvider:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();
render(
  <QueryClientProvider client={queryClient}>
    <YourComponent />
  </QueryClientProvider>
);
```

#### "next/navigation mock not found"
**Problem**: Tests fail with navigation errors
**Solution**: Mock next/navigation in test setup:
```tsx
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
```

### SSE Connection Issues

#### EventSource fails to connect
**Problem**: SSE connection fails immediately
**Solution**:
1. Check `NEXT_PUBLIC_API_BASE` environment variable
2. Verify backend is running and accessible
3. Check browser network tab for CORS errors
4. See `src/lib/api/sse-client.ts` for documented security limitations

#### Token expires during SSE stream
**Problem**: SSE connection drops after some time
**Solution**: Token refresh is not automatic. Currently requires page refresh.
TODO: Implement auto-reconnection with token refresh (see Phase 2, Task 2.1)

### Build Issues

#### MSW appearing in production bundle
**Problem**: `grep -r "msw" .next/` finds MSW references
**Solution**: This is a known issue if MSW is statically imported.
The fix (Phase 2, Task 2.3) uses dynamic imports to exclude MSW from production.

#### Type errors after refactoring
**Problem**: TypeScript errors after changes
**Solution**:
1. Run `npx tsc --noEmit` to see all errors
2. Check for missing type imports
3. Ensure `any` types are avoided - use proper type guards

### Next.js Build Errors

```bash
# Clear Next.js cache
rm -rf .next

# Clear Node modules
rm -rf node_modules
npm install
```

### MSW Issues

```bash
# Ensure MSW is initialized
# Check src/mocks/browser.ts is imported in your app
```

### Type Errors

```bash
# Regenerate types
npx tsc --noEmit
```
