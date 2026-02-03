# MBOS Frontend Architecture Refactoring Plan

**Date:** 2026-02-03
**Status:** Design Complete, Pending Implementation
**Author:** Architecture Review

---

## Executive Summary

This document outlines a comprehensive refactoring of the MBOS frontend architecture to address technical debt identified in [ARCHITECTURE_REVIEW_2026-02-03.md](./ARCHITECTURE_REVIEW_2026-02-03.md).

**Problem Statement:**
- God store (`authStore.ts`, 315 lines) handling 5+ concerns
- God components (300+ lines) with severe props drilling
- Over-nested routing (5-6 levels) with unnecessary complexity
- State duplication between Zustand and React Query
- Mock data mixed with production code

**Refactoring Goals:**
1. Separate client state (auth) from server state (workspaces, projects)
2. Break down god components using compound components + custom hooks
3. Simplify routing to 2-3 levels maximum
4. Remove all mock data from production code (use MSW exclusively)
5. Create reusable UI patterns (dialogs, table selection, forms)

**Non-Goals:**
- Token storage security changes (deferred - keeping localStorage for dev)
- Backward compatibility (MVP in development, clean slate)
- Feature changes (pure refactoring, no UX changes)

---

## Table of Contents

1. [State Management Redesign](#1-state-management-redesign)
2. [Component Architecture](#2-component-architecture)
3. [Routing Simplification](#3-routing-simplification)
4. [Auth Persistence Strategy](#4-auth-persistence-strategy)
5. [Implementation Phases](#5-implementation-phases)
6. [Testing Strategy](#6-testing-strategy)
7. [Migration Checklist](#7-migration-checklist)

---

## 1. State Management Redesign

### 1.1 Current State (Problems)

**`lib/stores/authStore.ts`** (315 lines) handles:
- User authentication (user, token, isAuthenticated)
- Workspaces list + current workspace selection
- Projects list + current project selection
- Permissions (derived from current project)
- Mock data and mock login/logout functions
- Persistence to localStorage

**Issues:**
- Violates single responsibility principle
- Workspaces/projects are server state, duplicated between Zustand and React Query
- Mock code mixed with production (200+ lines)
- Token stored in localStorage (XSS vulnerable - deferred)

### 1.2 Target State (Solution)

#### 1.2.1 Auth Store - Pure Authentication Only

```typescript
// lib/stores/authStore.ts (~50 lines)
interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;

  // Actions
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
}
```

Only user identity and token. Everything else removed.

#### 1.2.2 Workspace/Project State - React Query

```typescript
// lib/api/workspaces.ts
export const useWorkspaces = () => useQuery({
  queryKey: ['workspaces'],
  queryFn: apiClient.getWorkspaces,
  staleTime: 60_000, // 1 minute
});

// lib/api/projects.ts
export const useProjects = (workspaceId: string) => useQuery({
  queryKey: ['projects', workspaceId],
  queryFn: () => apiClient.getProjects(workspaceId),
  enabled: !!workspaceId, // Don't query if no workspace
  staleTime: 60_000,
});

// lib/api/current-project.ts
export const useCurrentProject = (projectId: string) => useQuery({
  queryKey: ['projects', projectId],
  queryFn: () => apiClient.getProject(projectId),
  enabled: !!projectId,
});
```

Server data lives in React Query cache. Single source of truth.

#### 1.2.3 URL as Source of Truth

```typescript
// lib/hooks/useSyncAuthFromUrl.ts (refactored)
export const useSyncAuthFromUrl = () => {
  const { workspace, project } = useParams();
  const router = useRouter();

  // Read workspace/project from URL
  // Query React Query cache for data
  // No writing to Zustand for selection

  // Fallback: if workspace/project not in cache, direct navigation
  // If workspace doesn't exist for user, redirect to workspace list
  // If project doesn't exist, redirect to project list
};
```

Selection state comes from URL, not stored state. Navigation updates URL.

#### 1.2.4 Mock Data - MSW Only

```typescript
// mocks/handlers/auth.ts
// mocks/handlers/workspaces.ts
// mocks/handlers/projects.ts
// All mock responses here, not in store
```

### 1.3 Migration Path

1. Create new `authStore.ts` (auth only, ~50 lines)
2. Create `useWorkspaces()`, `useProjects()`, `useCurrentProject()` queries
3. Update `useSyncAuthFromUrl` to read from URL + query React Query
4. Update components one-by-one to use React Query instead of Zustand
5. Delete old `authStore.ts` once all components migrated
6. Remove mock code from store (already handled by MSW)

---

## 2. Component Architecture

### 2.1 Current State (Problems)

**God Components:**
- `MembersPage.tsx` (364 lines) - Table, filters, invite dialog, permissions editor
- `SourcesPage.tsx` (359 lines) - File tree, upload, AI-ready toggle
- `PermissionsEditor.tsx` (228 lines) - Complex permission UI

**Issues:**
- Props drilling 11+ levels deep
- Business logic mixed with presentation
- No reusable patterns (dialog code duplicated 10+ times)
- Hard to test, hard to reuse

### 2.2 Target State (Solution)

#### 2.2.1 Pattern 1: Compound Components

```typescript
// Example: MembersPage refactored
<MembersPage>
  <MembersPage.Filters />
  <MembersPage.Table />
  <MembersPage.InviteDialog />
  <MembersPage.PermissionsDialog />
</MembersPage>

// Implementation
const MembersPage = ({ children }: { children: ReactNode }) => {
  const ctx = useMembersContext();
  return (
    <MembersContext.Provider value={ctx}>
      {children}
    </MembersContext.Provider>
  );
};

// Children access context
const MembersTable = () => {
  const { members, isLoading } = useMembersContext();
  // No props drilling
};
```

#### 2.2.2 Pattern 2: Custom Hooks for Logic

```typescript
// lib/hooks/useMembersList.ts
export const useMembersList = () => {
  const { projectId } = useProjectContext();
  const { data, isLoading, error } = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => apiClient.getMembers(projectId),
  });

  const [filters, setFilters] = useState({ role: 'all', search: '' });
  const filtered = useMemo(() => filterMembers(data, filters), [data, filters]);

  return { members: filtered, isLoading, error, filters, setFilters };
};

// Component becomes thin:
const MembersTable = () => {
  const { members, isLoading, filters, setFilters } = useMembersList();
  if (isLoading) return <LoadingSpinner />;
  return <Table data={members} filters={filters} onFilterChange={setFilters} />;
};
```

#### 2.2.3 Pattern 3: Reusable Dialog Primitives

```typescript
// components/ui/form-dialog.tsx
interface FormDialogProps<T> {
  title: string;
  trigger: ReactNode;
  onSubmit: (data: T) => Promise<void>;
  schema: z.ZodSchema<T>;
  defaultValues?: Partial<T>;
  children: ReactNode;
}

// Usage example:
<FormDialog
  title="Invite Member"
  trigger={<Button>Invite</Button>}
  onSubmit={async (data) => {
    await apiClient.inviteMember(data);
    queryClient.invalidateQueries(['members']);
  }}
  schema={inviteMemberSchema}
>
  <FormDialog.Input name="email" label="Email" />
  <FormDialog.Select name="role" label="Role" options={roleOptions} />
</FormDialog>
```

Handles: loading states, error display, success feedback, form reset automatically.

#### 2.2.4 Pattern 4: Table Selection Hook

```typescript
// components/ui/table-selection.tsx
export const useTableSelection = <T>(items: T[]) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(item => item.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const isSelected = (id: string) => selected.has(id);

  return {
    selected,
    selectedCount: selected.size,
    toggleAll,
    toggleOne,
    isSelected,
  };
};
```

### 2.3 File Structure After Refactor

```
components/
├── members/
│   ├── MembersPage.tsx           # Compound root (~30 lines)
│   ├── MembersTable.tsx          # Presentation (~80 lines)
│   ├── MembersFilters.tsx        # Presentation (~40 lines)
│   ├── InviteDialog.tsx          # Form dialog (~60 lines)
│   ├── PermissionsDialog.tsx     # Compound component
│   └── context.ts                # Context for children
├── sources/
│   ├── SourcesPage.tsx           # Compound root
│   ├── FileTree.tsx
│   ├── UploadDialog.tsx
│   └── AiReadyToggle.tsx
├── ui/
│   ├── dialog-primitives.tsx     # NEW: Reusable form dialog
│   └── table-selection.tsx       # NEW: Table selection hook
└── lib/
    └── hooks/
        ├── useMembersList.ts     # NEW: Business logic
        ├── useSourcesTree.ts
        └── usePermissionsForm.ts
```

### 2.4 Migration Path

1. Create `ui/form-dialog.tsx` and `ui/table-selection.tsx` (shared primitives)
2. Extract logic from `MembersPage` → `useMembersList` hook
3. Create `MembersPage` compound component with context
4. Move child components to separate files
5. Update imports, test functionality
6. Repeat for `SourcesPage`, then other god components
7. Delete old files once verified

---

## 3. Routing Simplification

### 3.1 Current State (Problems)

```
app/
├── layout.tsx                           // Level 1 - Root
├── [locale]/
│   ├── layout.tsx                       // Level 2 - Locale
│   └── workspaces/
│       └── [workspace]/
│           ├── layout.tsx               // Level 3 - Workspace
│           └── projects/
│               └── [project]/
│                   ├── layout.tsx       // Level 4 - Project
│                   └── (app)/           // Level 5 - Parallel routes
│                       ├── overview/
│                       ├── chat/
│                       └── ...
```

**Issues:**
- 5-6 levels of nesting creates confusing data flow
- `(app)` parallel route adds no value
- Layout props pass through multiple levels
- Missing loading.tsx and error.tsx boundaries

### 3.2 Target State (Solution)

```
app/
├── layout.tsx                           // Root: i18n provider, global styles
├── [locale]/
│   ├── layout.tsx                       // Locale: minimal
│   ├── login/
│   │   └── page.tsx
│   └── workspaces/
│       └── [workspace]/
│           ├── (shell)/
│           │   ├── layout.tsx           // Workspace shell: sidebar, topbar
│           │   ├── projects/
│           │   │   └── page.tsx         // Project list page
│           │   └── [project]/
│           │       ├── (shell)/
│           │       │   ├── layout.tsx   // App shell: app navigation
│           │       │   ├── overview/
│           │       │   │   ├── page.tsx
│           │       │   │   ├── loading.tsx  // NEW: Skeleton UI
│           │       │   │   └── error.tsx    // NEW: Error boundary
│           │       │   ├── chat/
│           │       │   ├── workbench/
│           │       │   └── ...
```

### 3.3 Layout Responsibilities

| Layout | Responsibility |
|--------|----------------|
| **Root** | i18n provider, global CSS, font loading |
| **Locale** | Minimal (can be merged with root) |
| **Workspace Shell** | Sidebar navigation, topbar, workspace context |
| **App Shell** | App-specific navigation, project context, breadcrumbs |

### 3.4 New Loading States

```typescript
// app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/loading.tsx
export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}
```

### 3.5 New Error Boundaries

```typescript
// app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/error.tsx
'use client';

export default function Error({ error, reset }: ErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8">
      <AlertCircle className="h-12 w-12 text-error" />
      <h2 className="mt-4 text-lg font-medium">Something went wrong</h2>
      <p className="text-sm text-text-tertiary">{error.message}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
```

### 3.6 Migration Path

1. Create new file structure with `(shell)` groups
2. Move layouts to new locations, preserve existing components
3. Add `loading.tsx` skeleton screens for key routes
4. Add `error.tsx` boundaries for key routes
5. Test navigation and deep links
6. Delete old `(app)` directory structure

---

## 4. Auth Persistence Strategy

### 4.1 Development (MSW Mode)

```typescript
// lib/stores/authStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const isDev = process.env.NEXT_PUBLIC_USE_MSW === 'true';

export const useAuthStore = create<AuthState>()(
  isDev
    ? persist(
        (set) => ({
          user: null,
          token: null,
          isAuthenticated: false,
          setAuth: (user, token) => set({ user, token, isAuthenticated: true }),
          clearAuth: () => set({ user: null, token: null, isAuthenticated: false }),
        }),
        {
          name: 'mbos-auth',
          storage: createJSONStorage(() => localStorage),
          partialize: (state) => ({
            user: state.user,
            token: state.token,
            isAuthenticated: state.isAuthenticated,
          }),
        }
      )
    : (set) => ({
        user: null,
        token: null,
        isAuthenticated: false,
        setAuth: (user, token) => set({ user, token, isAuthenticated: true }),
        clearAuth: () => set({ user: null, token: null, isAuthenticated: false }),
      })
);
```

**Behavior:** Auth state persisted to localStorage in development only.

### 4.2 Production (HttpOnly Cookies)

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                      Login Flow                             │
├─────────────────────────────────────────────────────────────┤
│  1. Frontend → mbos-edge: POST /auth/login                 │
│  2. Edge → Keycloak: Validate credentials                   │
│  3. Edge sets HttpOnly cookies:                             │
│     - access_token (15 min, HttpOnly, Secure, SameSite)     │
│     - refresh_token (7 days, HttpOnly, Secure, SameSite)    │
│  4. Frontend receives user info only (no tokens)            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Authenticated Requests                         │
├─────────────────────────────────────────────────────────────┤
│  1. Frontend → mbos-edge: API request (cookies auto-sent)   │
│  2. Edge validates access_token from cookie                │
│  3. If expired, Edge auto-refreshes using refresh_token    │
│  4. Edge → backend: Forward request with user context       │
└─────────────────────────────────────────────────────────────┘
```

**Frontend API Client:**

```typescript
// lib/api/adapters/fetch-adapter.ts
const fetchAdapter: ApiAdapter = {
  request: async (config) => {
    // Just fetch, browser handles cookies automatically
    return fetch(config.url, {
      ...config,
      credentials: 'include', // Send cookies
    });
  },
};
```

**Behavior:** Auth state is transient in production. Session persistence via HttpOnly cookies managed by mbos-edge. Frontend receives user info from `/auth/me` endpoint on load.

### 4.3 Key Differences

| Aspect | Development | Production |
|--------|-------------|------------|
| Token Storage | localStorage (mock) | HttpOnly cookies (edge) |
| Frontend Persistence | Zustand persist middleware | None (transient) |
| Token Management | Manual (mock login) | Automatic (browser cookies) |
| Security | XSS vulnerable (acceptable for dev) | XSS proof |

---

## 5. Implementation Phases

### Phase 1: State Management (Foundation)

**Goal:** Separate auth state from server data state.

**Tasks:**
1. [ ] Create new `authStore.ts` (auth only, ~50 lines)
2. [ ] Create `useWorkspaces()`, `useProjects()`, `useCurrentProject()` queries
3. [ ] Update `useSyncAuthFromUrl` to read from URL + query React Query
4. [ ] Add fallback handling for deep links (redirect if workspace/project not found)
5. [ ] Update components one-by-one:
    - [ ] `app-shell/` components
    - [ ] `members/` components
    - [ ] `sources/` components
    - [ ] `workbench/` components
    - [ ] Other components
6. [ ] Delete old `authStore.ts` once all components migrated
7. [ ] Test with MSW mocks
8. [ ] Test deep link navigation

**Validation:** All components use React Query for data, auth store only handles user/token.

---

### Phase 2: Component Architecture

**Goal:** Break down god components using compound components + hooks.

**Tasks:**
1. [ ] Create shared primitives:
    - [ ] `ui/form-dialog.tsx`
    - [ ] `ui/table-selection.tsx`
    - [ ] `ui/skeleton.tsx` (if not exists)
2. [ ] Refactor `MembersPage`:
    - [ ] Extract `useMembersList` hook
    - [ ] Create `MembersPage` compound component
    - [ ] Split into `MembersTable`, `MembersFilters`, `InviteDialog`, `PermissionsDialog`
    - [ ] Test functionality
3. [ ] Refactor `SourcesPage`:
    - [ ] Extract `useSourcesTree` hook
    - [ ] Create `SourcesPage` compound component
    - [ ] Split into child components
    - [ ] Test functionality
4. [ ] Refactor other large components (if any):
    - [ ] Identify candidates (>200 lines)
    - [ ] Apply same pattern
5. [ ] Delete old files once verified

**Validation:** No component >200 lines, no props drilling >3 levels.

---

### Phase 3: Routing Simplification

**Goal:** Flatten routing to 2-3 levels, add loading/error states.

**Tasks:**
1. [ ] Create new `(shell)` route structure
2. [ ] Migrate root layout
3. [ ] Migrate workspace shell layout
4. [ ] Migrate app shell layout
5. [ ] Add `loading.tsx` to key routes:
    - [ ] `overview/loading.tsx`
    - [ ] `chat/loading.tsx`
    - [ ] `workbench/loading.tsx`
6. [ ] Add `error.tsx` to key routes:
    - [ ] `overview/error.tsx`
    - [ ] `chat/error.tsx`
    - [ ] `workbench/error.tsx`
7. [ ] Update navigation links (if any hardcoded)
8. [ ] Test navigation and deep links
9. [ ] Remove old `(app)` directory structure

**Validation:** Maximum 3 nested levels, loading states work, error boundaries work.

---

### Phase 4: Mock Data Cleanup

**Goal:** Remove all mock code from production, use MSW exclusively.

**Tasks:**
1. [ ] Extend MSW handlers:
    - [ ] `/auth/login`
    - [ ] `/auth/me`
    - [ ] `/workspaces`
    - [ ] `/workspaces/{id}/projects`
    - [ ] `/projects/{id}`
    - [ ] `/projects/{id}/members`
2. [ ] Remove mock data from `authStore.ts` (if any remains)
3. [ ] Remove `mockLogin`, `mockLogout` functions
4. [ ] Test with MSW only
5. [ ] Verify no mock code in production path

**Validation:** `NEXT_PUBLIC_USE_MSW=false` works with real backend, no mock code in production build.

---

## 6. Testing Strategy

### 6.1 Unit Tests

**What to test:**
- Custom hooks (`useMembersList`, `useSourcesTree`)
- Permission selectors
- URL sync logic

**Tools:** React Testing Library, Jest

### 6.2 Integration Tests

**What to test:**
- Component interactions (compound components)
- Form submissions
- Navigation flows

**Tools:** Playwright (already set up)

### 6.3 E2E Tests

**What to test:**
- Complete user journeys:
  - Login → Select workspace → Select project → Navigate
  - Deep link to project → Auto-redirect if not found
  - Member invite → Permission edit

**Tools:** Playwright (existing test suite)

### 6.4 Manual Testing Checklist

- [ ] Login works (MSW and real backend)
- [ ] Workspace switching clears project, shows correct projects
- [ ] Project switching updates permissions
- [ ] Deep links work (direct URL navigation)
- [ ] Browser refresh preserves session (dev: localStorage, prod: cookies)
- [ ] Loading states display properly
- [ ] Error boundaries catch errors gracefully
- [ ] All existing features still work

---

## 7. Migration Checklist

### Pre-Migration

- [ ] Create git branch for refactoring
- [ ] Run existing tests to ensure baseline passing
- [ ] Backup current state (git commit)

### During Migration

- [ ] Complete Phase 1 (State Management)
- [ ] Run tests, fix issues
- [ ] Complete Phase 2 (Component Architecture)
- [ ] Run tests, fix issues
- [ ] Complete Phase 3 (Routing)
- [ ] Run tests, fix issues
- [ ] Complete Phase 4 (Mock Cleanup)
- [ ] Run tests, fix issues

### Post-Migration

- [ ] Full manual testing pass
- [ ] E2E test suite passes
- [ ] No console errors or warnings
- [ ] Performance check (no regressions)
- [ ] Update documentation (this file should reflect actual implementation)
- [ ] Create PR for review
- [ ] Merge after approval

---

## Appendix A: File Changes Summary

### Files to Create

| File | Purpose |
|------|---------|
| `lib/stores/authStore.ts` (new) | Auth-only store |
| `lib/api/workspaces.ts` | Workspace queries |
| `lib/api/projects.ts` | Project queries |
| `lib/hooks/useMembersList.ts` | Members business logic |
| `lib/hooks/useSourcesTree.ts` | Sources business logic |
| `components/ui/form-dialog.tsx` | Reusable form dialog |
| `components/ui/table-selection.tsx` | Table selection hook |
| `**/loading.tsx` (multiple) | Loading states |
| `**/error.tsx` (multiple) | Error boundaries |

### Files to Modify

| File | Changes |
|------|---------|
| `lib/hooks/useSyncAuthFromUrl.ts` | Read from URL + React Query |
| `components/members/MembersPage.tsx` | Refactor to compound |
| `components/sources/SourcesPage.tsx` | Refactor to compound |
| `app/**/*.tsx` | Restructure routing |

### Files to Delete

| File | Reason |
|------|--------|
| `lib/stores/authStore.ts` (old) | Replaced by smaller version |
| `app/[locale]/workspaces/[workspace]/projects/[project]/(app)/**` | Unnecessary parallel routes |

---

## Appendix B: Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing features | Incremental migration, test after each phase |
| State sync issues | React Query handles this, URL as source of truth |
| Lost deep links | URL structure preserved, semantic URLs maintained |
| Performance regression | Monitor bundle size, React Query is efficient |
| Developer confusion | Update documentation, provide examples |

---

**Document Status:** Design Complete
**Next Steps:** Await approval to begin implementation
