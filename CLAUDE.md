# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MBOS Frontend is the admin interface for the Microservices-Based Agent System. It provides workspace/project isolation, intelligent agent management, and multilingual support (English/Chinese).

**Tech Stack**: Next.js 15 (App Router), TypeScript 5.0, TailwindCSS, Radix UI, Zustand, React Query, next-intl

**Workspace**: `/home/percy/works/mygithub/mbos-server/mbos-frontend-v1`

## Common Commands

```bash
# Development
npm run dev              # Start dev server with Turbopack (port 3000)
npm run build            # Production build
npm run start            # Production server
npm run lint             # ESLint

# Testing
npm run test:e2e         # Playwright end-to-end tests
npm run test:e2e:ui      # Playwright with UI
npm run test:e2e:debug   # Playwright debug mode
npm run test:integration # Integration tests

# Component Documentation
npm run storybook        # Start Storybook (port 6006)
npm run build-storybook  # Build Storybook static
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
│               │   └── (app)/      # App shell routes (overview, chat, workbench, sources, agents, endpoints, members, audit, usage, settings)
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

See `docs/workspace-project-state-management.md` for complete state logic.

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
│   ├── workbench/         # Workbench/Recipe components
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

See `DESIGN_SYSTEM.md` for reference. The authoritative design doc is at:
`/home/percy/works/mygithub/mbos-server/文档/UXUI/2026-01-31-视觉设计系统-v1.md`

## Internationalization (i18n)

- **Library**: `next-intl`
- **Languages**: `en-US` (English), `zh-CN` (Simplified Chinese)
- **Message files**: `src/messages/en-US.json`, `src/messages/zh-CN.json`
- **Usage**: `const t = useTranslations('namespace');` then `{t('key')}`

**Rules** (from `docs/I18N_INTERN_GUIDE.md`):
- Keys use `snake_case`
- One key per meaning (reuse across project)
- Common strings in `common` namespace
- User-visible strings only (not variables, comments, console.log)
- Namespace structure: `common`, `nav`, `auth`, `workspace`, `project`, `sources`, `members`, `workbench`, `chat`, `audit`, `usage`, `overview`, `agents`, `endpoints`, `settings`, `errors`

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
- `docs/workspace-project-state-management.md` - Workspace/project state logic
- `docs/I18N_INTERN_GUIDE.md` - i18n implementation guide
- `docs/components.md` - Component documentation

## Development Notes

- Turbopack for fast dev server startup
- MSW for API mocking in development (quick login for testing)
- Permission system: String-based (e.g., `'project:*'`, `'project:read'`)
- Storybook for component development and documentation
- Always prefer editing existing files over creating new ones
