# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MBOS Frontend is the admin interface for the Microservices-Based Agent System. It provides workspace/project isolation, intelligent agent management, and multilingual support (English/Chinese).

**Tech Stack**: Next.js 15 (App Router), TypeScript 5.9, TailwindCSS, Radix UI, Zustand, React Query, next-intl

**Workspace**: `/home/percy/works/mbos-server-v1/mbos-frontend-v1`

## Common Commands

```bash
# Development
npm run dev              # Start dev server with Turbopack (port 3000)
npm run build            # Production build
npm run start            # Production server
npm run lint             # ESLint

# Unit Tests (Vitest)
npm run test             # Run unit tests
npm run test:ui          # Vitest with UI
npm run test:run         # Run tests without UI
npm run test:coverage    # Test coverage report

# E2E Tests (Playwright)
npm run test:e2e         # Playwright end-to-end tests
npm run test:e2e:ui      # Playwright with UI
npm run test:e2e:debug   # Playwright debug mode

# Integration Tests
npm run test:integration # Integration tests (bash script)

# Component Documentation
npm run storybook        # Start Storybook (port 6006)
npm run build-storybook  # Build Storybook static

# OpenAPI Types
npm run openapi:generate # Generate TypeScript types from OpenAPI spec
```

## Architecture

### Routing Structure

Next.js App Router with i18n via `next-intl`:

```
app/
├── [locale]/            # Locale segment (en-US, zh-CN)
│   ├── login/           # Authentication flow
│   └── workspaces/
│       └── [workspace]/
│           └── projects/
│               ├── [project]/
│               │   └── (shell)/    # App shell routes (overview, chat, studio, sources, agents, endpoints, members, audit, usage, settings)
│               └── page.tsx        # Project list
└── globals.css          # Design system tokens
```

**Key pattern**: Workspace/Project context is derived from URL params and synced to Zustand store via `useSyncAuthFromUrl` hook.

### State Management

- **Zustand** (`lib/stores/`) for client-side state
  - `authStore`: Auth state, workspace/project context, permissions
  - Persistent to localStorage
- **React Query** for server state with 1-minute stale time

### API Architecture

Dual-client pattern for easy mock/real switching:
- `lib/api/client.ts` - API client interface
- `lib/api/adapters/fetch-adapter.ts` - Real backend (NEXT_PUBLIC_API_BASE)
- `lib/api/adapters/msw-adapter.ts` - MSW mocks for development
- Environment switch: `NEXT_PUBLIC_USE_MSW=true`

### Workspace/Project Context Model

Hierarchical structure: User → Workspace → Project

**Critical flows**:
1. **Workspace change** → Automatically clears `currentProject`, filters projects by `workspace_id`, navigates to project list
2. **Project change** → Updates `currentProject`, navigates to `/overview`
3. **URL navigation** → `useSyncAuthFromUrl` syncs store from URL params (handles deep links, browser history)

### Architecture (Post-Refactoring 2026-02-03)

#### State Management
- **Auth**: `lib/stores/authStore.ts` (Zustand) - user, token, currentWorkspace, currentProject
- **Data**: React Query - workspaces, projects, members, sources, agents, endpoints, audit logs, usage stats
- **URL**: Source of truth for workspace/project selection
- **Sync**: `useSyncAuthFromUrl` hook keeps store in sync with URL params

#### Component Patterns
- **Compound components** with context (e.g., `MembersPage`, `SourcesPage`)
  - Parent manages state and data fetching
  - Child components receive data via context
  - Co-located for better maintainability
- **Custom hooks** for business logic
  - `useMembersList` - member CRUD operations
  - `useSourcesList` - source management
  - `useWorkspaceNavigation` - navigation logic
- **Reusable primitives**
  - `FormDialog` - modal forms
  - `Skeleton` - loading states
  - `useTableSelection` - table row selection

**Example compound component pattern:**
```tsx
// Parent Page component manages state/context
export function MembersPage() {
  const [members, setMembers] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());

  return (
    <MembersContext value={{ members, selectedIds, setSelectedIds }}>
      <MembersHeader />
      <MembersTable />
      <MembersBatchActions />
    </MembersContext>
  );
}

// Children consume context via custom hook
function MembersHeader() {
  const { members } = useMembersContext();
  // ...
}
```

#### Routing Structure
- **Max depth**: 2-3 levels
- **Route groups**: `(shell)` for shared layouts
- **Loading states**: `loading.tsx` with skeletons
- **Error handling**: `error.tsx` boundaries

Example routing structure:
```
[locale]/workspaces/[workspace]/projects/[project]/(app)/[page]/
├── layout.tsx          # Shell layout (Sidebar + Topbar)
├── loading.tsx         # Loading skeleton
├── error.tsx           # Error boundary
└── page.tsx            # Page content
```

### Component Organization

```
src/
├── components/
│   ├── ui/                 # Design system (Radix primitives + custom)
│   ├── app-shell/         # Layout (Topbar, Sidebar, navigation)
│   ├── chat/              # Chat components
│   ├── studio/            # AI Studio/Task components
│   ├── sources/           # File/source management
│   ├── members/           # Member management
│   └── audit-usage/       # Audit & usage reports
├── lib/
│   ├── api/               # API client with adapter pattern
│   ├── hooks/             # Custom React hooks
│   ├── stores/            # Zustand stores
│   ├── i18n/              # i18n configuration (DO NOT MODIFY)
│   └── utils/             # Utilities
├── messages/              # i18n message files (en-US.json, zh-CN.json)
└── mocks/                 # MSW mock handlers
```

## Design System

**Tokens**: Defined in `app/globals.css` as RGB triplets (supports alpha)

Key tokens (use these, not arbitrary colors):
- Backgrounds: `--bg-base`, `--bg-sidebar`, `--bg-surface`, `--bg-surface-high`, `--bg-hover`
- Text: `--text-strong`, `--text-primary`, `--text-tertiary`, `--icon-default`
- Accent: `--accent` (blue), `--success`, `--error`
- Border: `--border`, `--border-subtle`

**Style constraints**:
- No high-saturation buttons (blue only for links/icons/highlights)
- AI gradient only for AI identification (Logo, Avatar)
- Shadows only on floating layers (Dropdown, Dialog, Toast)
- Spacing base: 4px (use 8/12/16/24/32)
- Sidebar: 260px fixed, item height 40px

Tailwind classes map to tokens via `tailwind.config.js`.

See `DESIGN_SYSTEM.md` and `docs/UXUI/00-设计系统/视觉设计系统-v1.md` for reference.

## Internationalization (i18n)

- **Library**: `next-intl`
- **Languages**: `en-US` (English), `zh-CN` (Simplified Chinese)
- **Message files**: `src/messages/en-US.json`, `src/messages/zh-CN.json`
- **Usage**: `const t = useTranslations('namespace');` then `{t('key')}`

**Rules** (from `docs/UXUI/01-通用规范/2026-02-03-i18n-内部指南-v1.md`):
- Keys use `snake_case`
- One key per meaning (reuse across project)
- Common strings in `common` namespace
- User-visible strings only (not variables, comments, console.log)
- Namespace structure: `common`, `nav`, `auth`, `workspace`, `project`, `sources`, `members`, `studio`, `chat`, `audit`, `usage`, `overview`, `agents`, `endpoints`, `settings`, `errors`

**DO NOT modify**: `src/i18n/request.ts`, `next.config.ts`, middleware, routing config

## Environment Configuration

```bash
# For local development with backend
NEXT_PUBLIC_API_BASE=http://localhost:20000
NEXT_PUBLIC_USE_MSW=true

# For Keycloak auth (production)
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms
NEXT_PUBLIC_KEYCLOAK_REALM=mbos
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=mbos-frontend
```

## Important Files

- `DEVELOPMENT.md` - Development setup and troubleshooting
- `DESIGN_SYSTEM.md` - Design tokens and style guardrails
- `docs/UXUI/2026-02-05-前端-testid-规范.md` - Test ID conventions
- `docs/UXUI/01-通用规范/2026-02-03-i18n-内部指南-v1.md` - i18n implementation guide
- `docs/UXUI/00-设计系统/视觉设计系统-v1.md` - Authoritative design system reference
- `scripts/openapi/` - OpenAPI type generation utilities
- `scripts/capture-screenshots.ts` - Screenshot capture script for documentation

## Testing

### Unit Tests (Vitest)
- **Framework**: Vitest with jsdom environment
- **Location**: `**/__tests__/**/*.{test,spec}.{js,ts,tsx}` and `**/*.{test,spec}.{js,ts,tsx}`
- **Coverage thresholds**: 40% statements, 35% branches, 40% functions, 45% lines
- **Globals**: Enabled (describe, it, expect available globally)
- **Path alias**: `@/*` maps to `./src/*`

### E2E Tests (Playwright)
- **Location**: `e2e/` directory
- **Projects**:
  - `smoke` - Smoke tests for all routes in both locales (26 tests)
  - `chromium` - Full E2E tests for all pages and features (146 tests)
  - `visual` - Visual regression tests with `toHaveScreenshot()` (29 tests)
- **Timeouts**: 15s test timeout, 10s action/navigation timeouts
- **Shared fixtures**: `e2e/fixtures/test-base.ts` provides `authedPage` fixture and `goToProject()` helper
- **Mock data**: All tests use MSW with `src/mocks/fixtures/p0.json` as the single source of truth
- **Visual baselines**: `e2e/__screenshots__/visual.spec.ts/` (update with `--update-snapshots`)
- **data-testid spec**: `docs/UXUI/2026-02-05-前端-testid-规范.md`
- **Test selector convention**: Use `data-testid` attributes (see below)

### Playwright Execution Notes (2026-02)
- Prefer explicit server reuse in unstable environments:
  - Start dev server in a persistent terminal session: `npm run dev:test -- --port 3001`
  - Run Playwright with `BASE_URL=http://localhost:3001` to bypass managed `webServer` startup ambiguity.
- Mandatory local test rule:
  - Do **not** let Playwright manage frontend/backend service startup for integration testing.
  - Always start backend/frontend manually first, then run Playwright against existing services via `BASE_URL` / `INTEGRATION_API_BASE`.
  - Before starting any service or test command, clear proxy environment variables (`http_proxy`, `https_proxy`, `all_proxy`, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `no_proxy`, `NO_PROXY`).
- For fast triage, run targeted smoke first:
  - `npx playwright test --project=smoke e2e/smoke.spec.ts --grep "<route-pattern>" --max-failures=1 --workers=1`
- If route navigation hangs, separate infra vs app failure:
  - Verify server responsiveness with `curl http://localhost:3001/...`
  - If server is unresponsive/high CPU, restart dev server before debugging test assertions.
- Keep navigation robust in shared helpers:
  - Use `domcontentloaded` + retry-on-`ERR_ABORTED` helper (`gotoAndWait`) instead of raw `page.goto`.
- Debug order for route failures:
  1. Confirm `page.goto` reaches response.
  2. Check `page-state__success|error|page-layout` readiness markers.
  3. Inspect `test-results/**/error-context.md` before changing selectors.
- Avoid React Hook short-circuit patterns in route guards:
  - Do not write `useHasPermission('a') || useHasPermission('b')`.
  - Call hooks separately, then combine booleans. This prevents hook-order crashes that appear only in E2E runtime.

### Test ID Convention

Use `data-testid` attributes for stable test selectors. Format: `scope__element__state`

Examples:
- `login__submit`, `projects__create-button`, `agents__row`
- `page-state__error`, `studio__task-header`

Rules:
- Must be stable (not depend on text/styles)
- Must be unique per page
- Apply to: key buttons, table rows, panels, dialogs, page states
- Use double underscores (`__`) as separators (single underscores for multi-word element names)

See: `docs/UXUI/2026-02-05-前端-testid-规范.md`

### ESLint Configuration

Important rules enforced:
- `@typescript-eslint/no-explicit-any: error` - No `any` types in production code
- `@typescript-eslint/no-unused-vars: error` - Prefix unused with underscore (`_`)
- Exception: Test files allow `any` at `warn` level for flexibility
- Test files: `**/*.test.ts`, `**/*.test.tsx`, `**/__tests__/**`, `**/mocks/**`

## Security Guidelines

### Type Safety
- **Zero `any` types**: Production code must not use `any` types
- Use proper type guards for validation: `validateWorkspaceParam()`, `validateProjectParam()`
- ESLint rule `@typescript-eslint/no-explicit-any` is enforced

### Secure Authentication
- **SSE Token Exposure**: JWT tokens in SSE URLs are a known security risk
  - Current implementation uses URL params (documented in `lib/api/sse-client.ts`)
  - TODO: Implement ticket-based auth system (`POST /api/v1/sse-ticket`)
  - See: Phase 2, Task 2.1

### Content Security
- **Markdown Images**: Only images from trusted domains are rendered
  - Configure via `NEXT_PUBLIC_TRUSTED_IMAGE_DOMAINS` env var
  - Default: NO images (safe default)
  - See: Phase 2, Task 2.2

### Bundle Security
- **MSW Excluded**: MSW adapter is excluded from production bundle via dynamic imports
  - Never use `NEXT_PUBLIC_USE_MSW=true` in production
  - See: Phase 2, Task 2.3

## Testing Requirements

### Coverage Targets
- Chat components: 80%+
- AI Studio components: 75%+
- Security components: 90%+

### Test ID Conventions
- Use `data-testid` attributes for stable test selectors
- Format: `scope__element__state`
- See: `docs/UXUI/2026-02-05-前端-testid-规范.md`

### Critical Features Tested
- Chat system: Message rendering, threading, markdown with security tests
- AI Studio: Task execution, SSE handling, progress updates
- Security: API keys, credentials, permission checks
- Sources: File upload, quota management, AI Ready operations

## Error Handling Patterns

### useApiError Hook
Use the standardized `useApiError` hook for consistent error handling:

```tsx
import { useApiError } from '@/lib/hooks/use-api-error';

function MyComponent() {
  const { handleError, error, clearError } = useApiError();

  const mutation = useMutation({
    onError: (err) => handleError(err, { context: 'Creating user' })
  });
}
```

### Error Boundaries
Wrap route layouts with `ErrorBoundary` for graceful error handling:

```tsx
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

<ErrorBoundary onError={(error) => console.error(error)}>
  <YourPageContent />
</ErrorBoundary>
```

## Development Workflow

### Before Submitting Code
1. Run tests: `npm test`
2. Run linter: `npm run lint`
3. Type check: `npx tsc --noEmit`
4. Check for `any` types: `grep -r ": any" src/ --exclude-dir=__tests__`

### Troubleshooting

#### SSE Connection Issues
- Check browser console for EventSource errors
- Verify token is valid (not expired)
- Check `NEXT_PUBLIC_API_BASE` is correct
- See: `src/lib/api/sse-client.ts` for documented limitations

#### Test Failures
- Check mock setup for React Query, next/navigation, next-intl
- Verify test IDs (`data-testid`) are present on elements
- Check for timing issues - use `waitFor` for async operations

## Development Notes

- Turbopack for fast dev server startup
- MSW for API mocking in development (quick login for testing)
- Permission system: String-based (e.g., `'project:*'`, `'project:read'`)
- Storybook for component development and documentation
- Path aliases: `@/*`, `@/components/*`, `@/lib/*`, `@/app/*`, `@/types/*`
- TypeScript strict mode enabled
- Always prefer editing existing files over creating new ones
- Pre-release rule: enforce strict current contract and remove obsolete payload paths immediately.

## Running Single Tests

```bash
# Unit tests - run specific test file
npm test -- src/components/chat/__tests__/MessageItem.test.tsx

# Unit tests - run by pattern
npm test -- chat

# E2E tests - run specific test file
npm run test:e2e -- e2e/smoke.spec.ts

# E2E tests - run specific project
npm run test:e2e -- --project=smoke

# E2E tests - run specific test by line number
npm run test:e2e -- e2e/smoke.spec.ts:15
```

## Important Architecture Patterns

### Auth Store Token Synchronization
The Zustand auth store automatically syncs its token to the API client singleton via a subscription (see `src/lib/stores/authStore.ts:128-155`). This guarantees the API client always has the latest auth state without manual syncing. When calling `setAuth()` or `clearAuth()`, or when persist rehydrates, the token is automatically synced.

### URL Parameter Validation
All workspace and project URL parameters MUST be validated using `validateWorkspaceParam()` and `validateProjectParam()` from `src/lib/utils/validate-url-params.ts`. Never use `as string` type assertions on URL params - this is a security risk (XSS/injection).

### Development vs Production Persistence
The auth store only persists to localStorage when `NEXT_PUBLIC_USE_MSW=true` (development). In production, auth state is NOT persisted and must be re-established on each session via proper authentication flow.
