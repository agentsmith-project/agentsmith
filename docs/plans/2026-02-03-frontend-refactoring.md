# Frontend Architecture Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor MBOS frontend architecture to address technical debt: split god store, break god components, simplify routing, remove mock code from production.

**Architecture:**
- **State Management:** Auth store (Zustand) for user/token only, React Query for server data (workspaces, projects)
- **Component Architecture:** Compound components + custom hooks for logic separation, reusable UI primitives
- **Routing:** Flatten to 2-3 levels, remove unnecessary parallel routes, add loading/error states
- **Auth Persistence:** Dev: localStorage (Zustand persist), Prod: HttpOnly cookies (no client storage)

**Tech Stack:** Next.js 15 (App Router), TypeScript 5.0, Zustand 5, React Query 5, TailwindCSS, Radix UI

---

## Phase 1: State Management Refactoring

**Objective:** Split `authStore.ts` into pure auth store + React Query for server data.

---

### Task 1.1: Create Environment-Aware Auth Store

**Files:**
- Create: `src/lib/stores/authStore.new.ts`
- Modify: `src/lib/stores/authStore.ts` (backup then replace)

**Step 1: Create new auth store file**

```bash
# Create backup first
cp src/lib/stores/authStore.ts src/lib/stores/authStore.backup.ts
```

**Step 2: Write the new minimal auth store**

Create `src/lib/stores/authStore.new.ts`:

```typescript
/**
 * Authentication Store - Zustand
 *
 * Manages user authentication state only (user, token).
 * Server data (workspaces, projects) handled by React Query.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Locale } from '@/lib/i18n/config';

// ============================================================
// Types
// ============================================================

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  locale?: Locale;
}

interface AuthData {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

export interface AuthState extends AuthData {
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
}

// ============================================================
// Initial State
// ============================================================

const initialData: AuthData = {
  user: null,
  token: null,
  isAuthenticated: false,
};

// ============================================================
// Store Factory (environment-aware)
// ============================================================

const isDev = process.env.NEXT_PUBLIC_USE_MSW === 'true';

const createAuthStore = () =>
  create<AuthState>()(
    isDev
      ? persist(
          (set) => ({
            ...initialData,
            setAuth: (user: User, token: string) => {
              set({ user, token, isAuthenticated: true });
            },
            clearAuth: () => {
              set(initialData);
            },
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
          ...initialData,
          setAuth: (user: User, token: string) => {
            set({ user, token, isAuthenticated: true });
          },
          clearAuth: () => {
            set(initialData);
          },
        })
  );

export const useAuthStore = createAuthStore();

// ============================================================
// Hydration Hook
// ============================================================

import { useState, useEffect } from 'react';

export const useAuthStoreHydration = () => {
  const [hydrated, setHydrated] = useState(() => {
    const persistApi = (useAuthStore as unknown as {
      persist?: { hasHydrated?: () => boolean };
    }).persist;
    return persistApi?.hasHydrated
      ? persistApi.hasHydrated()
      : typeof window !== 'undefined';
  });

  useEffect(() => {
    const persistApi = (useAuthStore as unknown as {
      persist?: { onFinishHydration?: (fn: () => void) => () => void };
    }).persist;
    if (persistApi?.onFinishHydration) {
      const unsub = persistApi.onFinishHydration(() => setHydrated(true));
      return () => unsub?.();
    }
    setHydrated(true);
    return;
  }, []);

  return hydrated;
};

// ============================================================
// Selectors
// ============================================================

export const selectCurrentUser = (state: AuthState) => state.user;
export const selectIsAuthenticated = (state: AuthState) => state.isAuthenticated;
export const selectToken = (state: AuthState) => state.token;
```

**Step 3: Test TypeScript compilation**

Run: `npm run build -- --no-lint` or `npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/lib/stores/authStore.new.ts src/lib/stores/authStore.backup.ts
git commit -m "feat(stores): create new minimal auth store (dev only)

- Auth-only store: user, token, isAuthenticated
- Environment-aware: persist in dev (localStorage), no persist in prod
- Removed: workspace/project state, mock functions, permission selectors
- Backup: authStore.backup.ts for reference
"
```

---

### Task 1.2: Create React Query Hooks for Workspaces

**Files:**
- Create: `src/lib/hooks/use-workspaces.ts`
- Modify: `src/lib/api/endpoints/index.ts` (export WorkspaceAPI)

**Step 1: Create workspace query hook**

Create `src/lib/hooks/use-workspaces.ts`:

```typescript
/**
 * Workspace React Query Hooks
 *
 * Server state management for workspaces using React Query.
 */

import { useQuery } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api/client';
import { WorkspaceAPI } from '@/lib/api/endpoints/workspaces';

// Query keys factory
export const workspaceKeys = {
  all: ['workspaces'] as const,
  detail: (id: string) => ['workspaces', id] as const,
};

/**
 * Get all workspaces for current user
 */
export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.all,
    queryFn: async () => {
      const client = getApiClient();
      const api = new WorkspaceAPI(client);
      return api.list();
    },
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Get a single workspace by ID
 */
export function useWorkspace(id: string) {
  return useQuery({
    queryKey: workspaceKeys.detail(id),
    queryFn: async () => {
      const client = getApiClient();
      const api = new WorkspaceAPI(client);
      return api.get(id);
    },
    enabled: !!id,
    staleTime: 60_000,
  });
}
```

**Step 2: Verify WorkspaceAPI is exported**

Check `src/lib/api/endpoints/index.ts`:

```bash
grep -n "WorkspaceAPI" src/lib/api/endpoints/index.ts
```

If not found, add export:

```typescript
export { WorkspaceAPI } from './workspaces';
```

**Step 3: Test TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/lib/hooks/use-workspaces.ts src/lib/api/endpoints/index.ts
git commit -m "feat(hooks): add useWorkspaces React Query hook

- Server state for workspaces using React Query
- useWorkspaces(): list all workspaces
- useWorkspace(id): get single workspace
- Query keys factory for cache management
"
```

---

### Task 1.3: Create React Query Hooks for Projects

**Files:**
- Create: `src/lib/hooks/use-projects-queries.ts` (new file, avoid conflict with existing)

**Step 1: Create project query hooks**

Create `src/lib/hooks/use-projects-queries.ts`:

```typescript
/**
 * Project React Query Hooks
 *
 * Server state management for projects using React Query.
 */

import { useQuery } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api/client';
import { ProjectAPI } from '@/lib/api/endpoints/projects';

// Query keys factory
export const projectKeys = {
  all: (workspaceId: string) => ['workspaces', workspaceId, 'projects'] as const,
  detail: (workspaceId: string, projectId: string) =>
    ['workspaces', workspaceId, 'projects', projectId] as const,
};

/**
 * Get all projects in a workspace
 */
export function useProjects(workspaceId: string) {
  return useQuery({
    queryKey: projectKeys.all(workspaceId),
    queryFn: async () => {
      const client = getApiClient();
      const api = new ProjectAPI(client);
      const response = await api.list(workspaceId);
      return response.items;
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

/**
 * Get a single project by ID
 */
export function useProject(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(workspaceId, projectId),
    queryFn: async () => {
      const client = getApiClient();
      const api = new ProjectAPI(client);
      return api.get(workspaceId, projectId);
    },
    enabled: !!workspaceId && !!projectId,
    staleTime: 60_000,
  });
}
```

**Step 2: Test TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/lib/hooks/use-projects-queries.ts
git commit -m "feat(hooks): add useProjects React Query hooks

- Server state for projects using React Query
- useProjects(workspaceId): list projects in workspace
- useProject(workspaceId, projectId): get single project
- Workspace-dependent query keys
"
```

---

### Task 1.4: Refactor useSyncAuthFromUrl Hook

**Files:**
- Modify: `src/lib/hooks/use-sync-auth-from-url.ts`

**Step 1: Read current implementation**

```bash
cat src/lib/hooks/use-sync-auth-from-url.ts
```

**Step 2: Replace with new implementation**

Replace `src/lib/hooks/use-sync-auth-from-url.ts`:

```typescript
/**
 * Hook to sync auth state from URL parameters
 *
 * After refactoring:
 * - Reads workspace/project from URL params
 * - Queries React Query for data
 * - No writing to Zustand for selection
 * - Handles deep links and redirects
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useWorkspaces } from './use-workspaces';
import { useProjects } from './use-projects-queries';
import { useAuthStoreHydration } from '@/lib/stores/authStore.new';

export function useSyncAuthFromUrl() {
  const params = useParams();
  const router = useRouter();
  const hydrated = useAuthStoreHydration();

  const { data: workspaces, isLoading: workspacesLoading } = useWorkspaces();
  const workspaceId = params?.workspace as string | undefined;
  const projectId = params?.project as string | undefined;

  // Get projects for current workspace (if workspace selected)
  const { data: projects, isLoading: projectsLoading } = useProjects(workspaceId || '');

  // Validate workspace from URL
  useEffect(() => {
    if (!hydrated || workspacesLoading || !workspaceId) return;

    const workspaceExists = workspaces?.find((ws) => ws.id === workspaceId);

    if (!workspaceExists) {
      // Workspace not found for user, redirect to workspace list
      router.replace('/workspaces');
    }
  }, [hydrated, workspaceId, workspaces, workspacesLoading, router]);

  // Validate project from URL
  useEffect(() => {
    if (!hydrated || !workspaceId || projectsLoading) return;

    // If no project in URL, we're on project list page - nothing to validate
    if (!projectId) return;

    const projectExists = projects?.find((p) => p.id === projectId);

    if (!projectExists) {
      // Project not found or not in this workspace, redirect to project list
      router.replace(`/workspaces/${workspaceId}/projects`);
    }
  }, [hydrated, workspaceId, projectId, projects, projectsLoading, router]);

  return {
    workspaceId,
    projectId,
    isLoading: workspacesLoading || projectsLoading,
  };
}
```

**Step 3: Test TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No type errors (but will have import issues until Task 1.5)

**Step 4: Commit**

```bash
git add src/lib/hooks/use-sync-auth-from-url.ts
git commit -m "refactor(hooks): useSyncAuthFromUrl reads from URL + React Query

- Removed: Zustand writes for workspace/project selection
- Added: Deep link validation with redirects
- Added: React Query data fetching
- Behavior: Invalid workspace/project redirects to list pages
"
```

---

### Task 1.5: Update Component Imports and Usage

**Files:**
- Modify: All components using `useAuthStore` for workspace/project data

**Step 1: Find all usages**

```bash
grep -r "useAuthStore" src/components --include="*.tsx" -l
```

**Step 2: Update each component**

For each file found, replace:

```typescript
// OLD
import { useAuthStore } from '@/lib/stores/authStore';

// In component
const { currentWorkspace, currentProject, workspaces, projects } = useAuthStore();

// NEW
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { useProjects } from '@/lib/hooks/use-projects-queries';

// In component (add workspaceId, projectId from props or URL)
const { data: workspaces } = useWorkspaces();
const { data: projects } = useProjects(workspaceId);
```

**Step 3: Update components that pass workspace/project props**

Find components that receive `workspaceId`, `projectId`:

```bash
grep -r "workspaceId.*projectId" src/components --include="*.tsx" -A2
```

Ensure they get these from URL params instead of store:

```typescript
// OLD
const { currentWorkspace, currentProject } = useAuthStore();

// NEW
import { useParams } from 'next/navigation';
const { workspace, project } = useParams();
const workspaceId = workspace as string;
const projectId = project as string;
```

**Step 4: Test build**

Run: `npm run build`
Expected: Build succeeds (may have runtime errors until MSW handlers added)

**Step 5: Commit**

```bash
git add src/components
git commit -m "refactor(components): use React Query instead of Zustand for data

- Updated all components to use useWorkspaces/useProjects hooks
- Workspace/project IDs from URL params, not store
- Removed currentWorkspace/currentProject usage from components
"
```

---

### Task 1.6: Replace Old Auth Store

**Files:**
- Delete: `src/lib/stores/authStore.ts`
- Delete: `src/lib/stores/authStore.backup.ts`
- Rename: `src/lib/stores/authStore.new.ts` → `src/lib/stores/authStore.ts`

**Step 1: Replace the store**

```bash
# Delete old store
rm src/lib/stores/authStore.ts src/lib/stores/authStore.backup.ts

# Rename new store
mv src/lib/stores/authStore.new.ts src/lib/stores/authStore.ts
```

**Step 2: Update imports**

```bash
# Find any remaining imports of authStore.new
grep -r "authStore.new" src --include="*.ts" --include="*.tsx"

# Replace authStore.new with authStore
sed -i 's/authStore\.new/authStore/g' src/lib/hooks/use-sync-auth-from-url.ts
```

**Step 3: Test build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Test dev server**

Run: `npm run dev`
Expected: Dev server starts, no console errors

**Step 5: Commit**

```bash
git add src/lib/stores src/lib/hooks
git commit -m "refactor(stores): replace old auth store with minimal version

- Deleted: old 315-line god store
- Replaced with: 80-line auth-only store
- Workspace/project data now in React Query cache
- Mock functions removed (handled by MSW)
"
```

---

### Task 1.7: Update Permission Selectors

**Files:**
- Create: `src/lib/hooks/use-permissions.ts` (update existing)

**Step 1: Read existing permission hooks**

```bash
cat src/lib/hooks/use-permissions.ts
```

**Step 2: Update to use React Query data**

The permission hooks should get current project from React Query, not Zustand:

```typescript
/**
 * Permission Hooks
 *
 * Check user permissions for current project.
 * Project data comes from React Query, not Zustand.
 */

import { useMemo } from 'react';
import { useProject } from './use-projects-queries';
import { useParams } from 'next/navigation';

// Stable empty array reference
const EMPTY_PERMISSIONS: readonly string[] = Object.freeze([]) as unknown as string[];

/**
 * Get current project permissions
 */
export function useCurrentPermissions() {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;

  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    return currentProject?.permissions ?? EMPTY_PERMISSIONS;
  }, [currentProject]);
}

/**
 * Check if user has a specific permission
 */
export function useHasPermission(permission: string): boolean {
  const permissions = useCurrentPermissions();

  return useMemo(() => {
    if (permissions.length === 0) return false;
    if (permissions.includes('*')) return true;
    if (permissions.includes(permission)) return true;

    // Prefix wildcard: e.g. 'project:*' grants 'project:audit:read'
    const prefixMatch = permissions.find((p) => p.endsWith(':*'));
    if (prefixMatch) {
      const prefix = prefixMatch.slice(0, -1);
      if (permission.startsWith(prefix)) return true;
    }

    return false;
  }, [permissions, permission]);
}

/**
 * Check if user has any of the specified permissions
 */
export function useHasAnyPermission(permissions: string[]): boolean {
  const currentPermissions = useCurrentPermissions();

  return useMemo(() => {
    if (permissions.length === 0) return false;
    if (currentPermissions.length === 0) return false;
    if (currentPermissions.includes('*')) return true;
    return permissions.some((p) => currentPermissions.includes(p));
  }, [currentPermissions, permissions]);
}

/**
 * Check if user has all of the specified permissions
 */
export function useHasAllPermissions(permissions: string[]): boolean {
  const currentPermissions = useCurrentPermissions();

  return useMemo(() => {
    if (permissions.length === 0) return false;
    if (currentPermissions.length === 0) return false;
    if (currentPermissions.includes('*')) return true;
    return permissions.every((p) => currentPermissions.includes(p));
  }, [currentPermissions, permissions]);
}
```

**Step 3: Test TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/lib/hooks/use-permissions.ts
git commit -m "refactor(hooks): permissions use React Query for project data

- useCurrentPermissions(): gets permissions from current project (React Query)
- useHasPermission(), useHasAnyPermission(), useHasAllPermissions(): updated
- No longer depends on Zustand store for project data
"
```

---

### Task 1.8: Verify and Test Phase 1

**Files:**
- Test: All affected components

**Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 2: Run lint**

Run: `npm run lint`
Expected: No new lint errors (may have existing ones)

**Step 3: Test dev server with MSW**

Run: `npm run dev`
Expected:
- Dev server starts on port 3000
- No console errors
- Can navigate to `/workspaces`

**Step 4: Add MSW handlers for workspaces/projects**

If data not loading, check `src/mocks/handlers/`:

```bash
ls src/mocks/handlers/
cat src/mocks/handlers/*.ts
```

Ensure handlers exist for:
- `GET /api/workspaces`
- `GET /api/workspaces/{id}/projects`

**Step 5: Commit Phase 1 completion**

```bash
git add .
git commit -m "feat(phase1): complete state management refactoring

- Auth store: minimal (user, token, isAuthenticated)
- Server data: React Query (workspaces, projects)
- URL sync: reads from URL, validates with redirects
- Permissions: derived from React Query project data
- MSW handlers: workspace/project endpoints

Next: Phase 2 - Component Architecture
"
```

---

## Phase 2: Component Architecture Refactoring

**Objective:** Break down god components using compound components + custom hooks.

---

### Task 2.1: Create Reusable Form Dialog Primitive

**Files:**
- Create: `src/components/ui/form-dialog.tsx`
- Create: `src/components/ui/skeleton.tsx` (if not exists)

**Step 1: Check if skeleton exists**

```bash
ls src/components/ui/skeleton.tsx 2>/dev/null || echo "skeleton.tsx not found"
```

**Step 2: Create skeleton component (if missing)**

Create `src/components/ui/skeleton.tsx`:

```typescript
import { cn } from '@/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-high', className)}
      {...props}
    />
  );
}
```

**Step 3: Create form dialog primitive**

Create `src/components/ui/form-dialog.tsx`:

```typescript
/**
 * Form Dialog Primitive
 *
 * Reusable dialog component for form submissions with:
 * - Loading states
 * - Error handling
 * - Success feedback
 * - Form reset on close
 */

'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import type { z } from 'zod';

export interface FormDialogProps<T> {
  title: string;
  description?: string;
  trigger: React.ReactNode;
  onSubmit: (data: T) => Promise<void>;
  schema: z.ZodSchema<T>;
  defaultValues?: Partial<T>;
  submitLabel?: string;
  cancelLabel?: string;
  children: React.ReactNode;
}

export function FormDialog<T>({
  title,
  description,
  trigger,
  onSubmit,
  schema,
  defaultValues,
  submitLabel = 'Submit',
  cancelLabel = 'Cancel',
  children,
}: FormDialogProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (data: T) => {
    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit(data);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset form when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen || !isSubmitting) {
      setOpen(newOpen);
      setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}

        {/* Form content - child should use react-hook-form with schema */}
        {React.cloneElement(children as React.ReactElement, {
          onSubmit: handleSubmit,
          schema,
          defaultValues,
        })}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            form="dialog-form" // Child form must have this id
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: Test TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/components/ui/skeleton.tsx src/components/ui/form-dialog.tsx
git commit -m "feat(ui): add form dialog and skeleton primitives

- FormDialog: reusable form dialog with loading/error states
- Skeleton: loading placeholder component
- Reduces code duplication across app
"
```

---

### Task 2.2: Create Table Selection Hook

**Files:**
- Create: `src/lib/hooks/use-table-selection.ts`

**Step 1: Create table selection hook**

Create `src/lib/hooks/use-table-selection.ts`:

```typescript
/**
 * Table Selection Hook
 *
 * Manages row selection state for tables with:
 * - Single item selection toggle
 * - Select all / deselect all
 * - Selected count
 * - Selection state queries
 */

import { useState, useCallback, useMemo } from 'react';

export interface UseTableSelectionOptions<T> {
  items: T[];
  getId: (item: T) => string;
  initialSelected?: Set<string>;
}

export function useTableSelection<T>({
  items,
  getId,
  initialSelected = new Set(),
}: UseTableSelectionOptions<T>) {
  const [selected, setSelected] = useState<Set<string>>(initialSelected);

  const selectedCount = selected.size;
  const allSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0 && selected.size < items.length;

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === items.length) {
        // Deselect all
        return new Set();
      }
      // Select all
      return new Set(items.map(getId));
    });
  }, [items, getId]);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const isSelected = useCallback(
    (item: T) => selected.has(getId(item)),
    [selected, getId]
  );

  const getSelectedItems = useCallback(
    () => items.filter((item) => selected.has(getId(item))),
    [items, selected, getId]
  );

  return {
    selected,
    selectedCount,
    allSelected,
    someSelected,
    toggleOne,
    toggleAll,
    clear,
    isSelected,
    getSelectedItems,
  };
}
```

**Step 2: Test TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/lib/hooks/use-table-selection.ts
git commit -m "feat(hooks): add useTableSelection hook

- Manages table row selection state
- toggleOne: select/deselect single row
- toggleAll: select/deselect all rows
- isSelected, getSelectedItems: query selection state
- Reusable across all tables
"
```

---

### Task 2.3: Extract MembersPage Business Logic to Hook

**Files:**
- Create: `src/lib/hooks/use-members-list.ts`
- Modify: `src/components/members/MembersPage.tsx`

**Step 1: Create members list hook**

Create `src/lib/hooks/use-members-list.ts`:

```typescript
/**
 * Members List Hook
 *
 * Business logic for members page:
 * - Fetch members and related data
 * - Manage local state (selection, filters, dialogs)
 * - Handle member actions (remove, edit permissions)
 */

import { useState, useCallback, useMemo } from 'react';
import { useMembers, useMemberPermissions, useMemberQuotaOverrides } from './use-members';
import { useProject } from './use-projects-queries';
import { usePermissionTemplates, useQuotaTemplates } from './use-members';
import type { Member } from '@/lib/api/endpoints/members';

export interface UseMembersListOptions {
  workspaceId: string;
  projectId: string;
}

export function useMembersList({ workspaceId, projectId }: UseMembersListOptions) {
  // Data fetching
  const { data: project } = useProject(workspaceId, projectId);
  const { data: members, isLoading } = useMembers(workspaceId, projectId);

  // Local state
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  // Detail drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [quotaHistoryDrawerOpen, setQuotaHistoryDrawerOpen] = useState(false);

  // Dialogs
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [batchPermDialogOpen, setBatchPermDialogOpen] = useState(false);
  const [batchQuotaDialogOpen, setBatchQuotaDialogOpen] = useState(false);

  // Selected member data
  const { data: permissions } = useMemberPermissions(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );
  const { data: quotaOverrides } = useMemberQuotaOverrides(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );

  // Templates
  const { data: permissionTemplates = [] } = usePermissionTemplates(workspaceId, projectId);
  const { data: quotaTemplates = [] } = useQuotaTemplates(workspaceId, projectId);

  // Actions
  const handleEditPermissions = useCallback((member: Member) => {
    setSelectedMember(member);
    setDrawerOpen(true);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedMember(null);
  }, []);

  const handleToggleSelection = useCallback((memberId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  }, []);

  const handleToggleAll = useCallback(() => {
    if (!members) return;
    setSelectedMemberIds((prev) =>
      prev.length === members.length ? [] : members.map((m) => m.id)
    );
  }, [members]);

  const clearSelection = useCallback(() => {
    setSelectedMemberIds([]);
  }, []);

  return {
    // Data
    project,
    members,
    isLoading,

    // Selected member
    selectedMember,
    permissions,
    quotaOverrides,

    // Selection state
    selectedMemberIds,
    allSelected: members ? selectedMemberIds.length === members.length : false,
    someSelected: selectedMemberIds.length > 0 && !members?.length === selectedMemberIds.length,

    // Dialog states
    drawerOpen,
    historyDrawerOpen,
    quotaHistoryDrawerOpen,
    inviteDialogOpen,
    batchPermDialogOpen,
    batchQuotaDialogOpen,

    // Templates
    permissionTemplates,
    quotaTemplates,

    // Actions
    setSelectedMember,
    setDrawerOpen,
    setHistoryDrawerOpen,
    setQuotaHistoryDrawerOpen,
    setInviteDialogOpen,
    setBatchPermDialogOpen,
    setBatchQuotaDialogOpen,
    handleEditPermissions,
    handleCloseDrawer,
    handleToggleSelection,
    handleToggleAll,
    clearSelection,
  };
}
```

**Step 2: Test TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: May have errors until we update MembersPage

**Step 3: Commit**

```bash
git add src/lib/hooks/use-members-list.ts
git commit -m "feat(hooks): add useMembersList business logic hook

- Extracts all state and logic from MembersPage
- Manages member selection, dialog states
- Fetches member-related data (permissions, quotas, templates)
- Prepares for compound component refactoring
"
```

---

### Task 2.4: Refactor MembersPage to Compound Component

**Files:**
- Modify: `src/components/members/MembersPage.tsx`
- Create: `src/components/members/MembersContext.tsx`

**Step 1: Create members context**

Create `src/components/members/MembersContext.tsx`:

```typescript
/**
 * Members Page Context
 *
 * Shared context for MembersPage compound components.
 */

'use client';

import * as React from 'react';
import type { Member } from '@/lib/api/endpoints/members';
import type { PermissionTemplate, QuotaTemplate } from '@/lib/api/endpoints/members';

export interface MembersContextValue {
  workspaceId: string;
  projectId: string;
  project: any; // Project type
  members: Member[] | undefined;
  isLoading: boolean;

  selectedMember: Member | null;
  selectedMemberIds: string[];
  allSelected: boolean;
  someSelected: boolean;

  permissions: any[] | undefined;
  quotaOverrides: any[] | undefined;

  drawerOpen: boolean;
  historyDrawerOpen: boolean;
  quotaHistoryDrawerOpen: boolean;
  inviteDialogOpen: boolean;
  batchPermDialogOpen: boolean;
  batchQuotaDialogOpen: boolean;

  permissionTemplates: PermissionTemplate[];
  quotaTemplates: QuotaTemplate[];

  setSelectedMember: (member: Member | null) => void;
  setDrawerOpen: (open: boolean) => void;
  setHistoryDrawerOpen: (open: boolean) => void;
  setQuotaHistoryDrawerOpen: (open: boolean) => void;
  setInviteDialogOpen: (open: boolean) => void;
  setBatchPermDialogOpen: (open: boolean) => void;
  setBatchQuotaDialogOpen: (open: boolean) => void;

  handleEditPermissions: (member: Member) => void;
  handleCloseDrawer: () => void;
  handleToggleSelection: (memberId: string) => void;
  handleToggleAll: () => void;
  clearSelection: () => void;
}

const MembersContext = React.createContext<MembersContextValue | null>(null);

export interface MembersProviderProps {
  children: React.ReactNode;
  value: MembersContextValue;
}

export function MembersProvider({ children, value }: MembersProviderProps) {
  return (
    <MembersContext.Provider value={value}>
      {children}
    </MembersContext.Provider>
  );
}

export function useMembersContext() {
  const context = React.useContext(MembersContext);
  if (!context) {
    throw new Error('useMembersContext must be used within MembersProvider');
  }
  return context;
}
```

**Step 2: Refactor MembersPage to compound component**

Modify `src/components/members/MembersPage.tsx` (complete rewrite):

```typescript
/**
 * Members Page - Compound Component
 *
 * Root component that provides context to child components.
 */

'use client';

import * as React from 'react';
import { MembersProvider, useMembersContext } from './MembersContext';
import { useMembersList } from '@/lib/hooks/use-members-list';
import { MembersTable } from './MembersTable';
import { MemberDetailDrawer } from './MemberDetailDrawer';
import { InviteMemberDialog } from './InviteMemberDialog';
import { JoinRequestsTab } from './JoinRequestsTab';
import { TemplatesTab } from './TemplatesTab';
import { BatchApplyBar } from './BatchApplyBar';
import { BatchApplyPermissionDialog } from './BatchApplyPermissionDialog';
import { BatchApplyQuotaDialog } from './BatchApplyQuotaDialog';

export interface MembersPageProps {
  workspaceId: string;
  projectId: string;
}

function MembersPageContent({ workspaceId, projectId }: MembersPageProps) {
  const contextValue = useMembersList({ workspaceId, projectId });
  const [activeTab, setActiveTab] = React.useState<'members' | 'requests' | 'templates'>('members');

  return (
    <MembersProvider value={contextValue}>
      <div className="space-y-6">
        {contextValue.someSelected && (
          <BatchApplyBar />
        )}

        {activeTab === 'members' && <MembersTable />}
        {activeTab === 'requests' && <JoinRequestsTab />}
        {activeTab === 'templates' && <TemplatesTab />}

        <MemberDetailDrawer />
        <InviteMemberDialog />
        <BatchApplyPermissionDialog />
        <BatchApplyQuotaDialog />
      </div>
    </MembersProvider>
  );
}

export function MembersPage(props: MembersPageProps) {
  return <MembersPageContent {...props} />;
}
```

**Step 3: Update child components to use context**

For each child component (MembersTable, etc.), replace prop drilling with context:

```typescript
// In MembersTable.tsx
import { useMembersContext } from './MembersContext';

export function MembersTable() {
  const {
    members,
    isLoading,
    selectedMemberIds,
    handleToggleSelection,
    handleToggleAll,
    handleEditPermissions,
  } = useMembersContext();

  // Component logic...
}
```

**Step 4: Test TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/components/members/
git commit -m "refactor(members): MembersPage as compound component

- Created MembersContext for shared state
- MembersPage now a thin wrapper (~40 lines)
- Child components use context instead of props
- Removed props drilling across component tree
"
```

---

### Task 2.5: Refactor SourcesPage (Repeat Pattern)

**Files:**
- Create: `src/lib/hooks/use-sources-list.ts`
- Modify: `src/components/sources/SourcesPage.tsx`
- Create: `src/components/sources/SourcesContext.tsx`

**Step 1: Follow same pattern as MembersPage**

1. Create `useSourcesList` hook
2. Create `SourcesContext`
3. Refactor `SourcesPage` to compound component
4. Update child components to use context

**Step 2: Commit**

```bash
git add src/components/sources/ src/lib/hooks/use-sources-list.ts
git commit -m "refactor(sources): SourcesPage as compound component

- Created SourcesContext for shared state
- Extracted useSourcesList hook for business logic
- Child components use context instead of props
- Consistent with MembersPage refactoring pattern
"
```

---

### Task 2.6: Verify and Test Phase 2

**Files:**
- Test: All refactored components

**Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Test dev server**

Run: `npm run dev`
Expected:
- Can navigate to Members page
- Can open/close dialogs
- Can select table rows

**Step 4: Run E2E tests**

Run: `npm run test:e2e`
Expected: Existing tests pass

**Step 5: Commit Phase 2 completion**

```bash
git add .
git commit -m "feat(phase2): complete component architecture refactoring

- Created: FormDialog, Skeleton, useTableSelection primitives
- MembersPage: compound component with context (~40 lines, was 364)
- SourcesPage: compound component with context
- Child components use context, no props drilling
- Business logic extracted to custom hooks

Next: Phase 3 - Routing Simplification
"
```

---

## Phase 3: Routing Simplification

**Objective:** Flatten routing to 2-3 levels, add loading/error states.

---

### Task 3.1: Create New Route Structure with (shell) Groups

**Files:**
- Create: `app/[locale]/workspaces/[workspace]/(shell)/layout.tsx`
- Create: `app/[locale]/workspaces/[workspace]/(shell)/projects/page.tsx`
- Create: `app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/layout.tsx`

**Step 1: Create workspace shell layout**

Create `app/[locale]/workspaces/[workspace]/(shell)/layout.tsx`:

```typescript
/**
 * Workspace Shell Layout
 *
 * Provides sidebar, topbar, and workspace context for all workspace pages.
 */

import { Sidebar } from '@/components/app-shell/sidebar';
import { Topbar } from '@/components/app-shell/topbar';

export default function WorkspaceShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { workspace: string; locale: string };
}) {
  return (
    <div className="flex h-screen">
      <Sidebar workspaceId={params.workspace} />
      <div className="flex-1 flex flex-col">
        <Topbar workspaceId={params.workspace} />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
```

**Step 2: Move projects list page**

Move existing projects page to new location:

```bash
# Find existing projects page
find app -name "page.tsx" -path "*/projects/*" | grep -v node_modules

# Copy to new location (keep old for now)
cp app/[locale]/workspaces/[workspace]/projects/page.tsx \
   app/[locale]/workspaces/[workspace]/(shell)/projects/page.tsx
```

**Step 3: Create app shell layout**

Create `app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/layout.tsx`:

```typescript
/**
 * App Shell Layout
 *
 * Provides app navigation, project context for all app pages.
 */

import { AppNav } from '@/components/app-shell/app-nav';
import { Breadcrumbs } from '@/components/app-shell/breadcrumbs';

export default function AppShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { workspace: string; project: string; locale: string };
}) {
  return (
    <div className="flex h-full">
      <AppNav projectId={params.project} />
      <div className="flex-1 flex flex-col">
        <Breadcrumbs
          workspaceId={params.workspace}
          projectId={params.project}
        />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
```

**Step 4: Test TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: May have errors until we move all child routes

**Step 5: Commit**

```bash
git add app/[locale]/workspaces
git commit -m "feat(routing): create (shell) route groups

- Workspace shell: sidebar + topbar layout
- App shell: app nav + breadcrumbs layout
- Route groups (shell) for organization without affecting URL
"
```

---

### Task 3.2: Move App Routes to New Structure

**Files:**
- Move: All app routes from `(app)` to `(shell)`

**Step 1: Move overview route**

```bash
# Create directory structure
mkdir -p "app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview"

# Copy existing page
cp "app/[locale]/workspaces/[workspace]/projects/[project]/(app)/overview/page.tsx" \
   "app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/page.tsx"
```

**Step 2: Move other app routes**

Repeat for: chat, workbench, sources, agents, endpoints, members, audit, usage, settings

**Step 3: Test routes still work**

Run: `npm run dev`
Expected: All routes navigate correctly

**Step 4: Commit**

```bash
git add app/[locale]/workspaces
git commit -m "feat(routing): move app routes to (shell) structure

- Moved overview, chat, workbench, sources, agents, endpoints
- Moved members, audit, usage, settings
- All routes now under (shell) group
- Old (app) directory still exists (cleanup pending)
"
```

---

### Task 3.3: Add Loading States

**Files:**
- Create: `app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/loading.tsx`
- Create: Similar for other routes

**Step 1: Create overview loading state**

Create `app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/loading.tsx`:

```typescript
import { Skeleton } from '@/components/ui/skeleton';

export default function OverviewLoading() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
```

**Step 2: Create loading states for other routes**

Repeat for chat, workbench, etc.

**Step 3: Test loading states**

Run: `npm run dev`
Expected: Loading skeletons show during navigation

**Step 4: Commit**

```bash
git add app/[locale]/workspaces
git commit -m "feat(routing): add loading.tsx skeleton screens

- Overview loading: stats cards + chart skeleton
- Chat, workbench loading states
- Improves perceived performance
"
```

---

### Task 3.4: Add Error Boundaries

**Files:**
- Create: `app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/error.tsx`
- Create: Similar for other routes

**Step 1: Create overview error boundary**

Create `app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/error.tsx`:

```typescript
'use client';

import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function OverviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-8">
      <AlertCircle className="h-12 w-12 text-error" />
      <h2 className="mt-4 text-lg font-medium">Something went wrong</h2>
      <p className="text-sm text-text-tertiary">{error.message}</p>
      <Button onClick={reset} className="mt-4">
        Try again
      </Button>
    </div>
  );
}
```

**Step 2: Create error boundaries for other routes**

Repeat for chat, workbench, etc.

**Step 3: Test error boundaries**

To test, add temporary throw in component:
```typescript
throw new Error('Test error boundary');
```

**Step 4: Commit**

```bash
git add app/[locale]/workspaces
git commit -m "feat(routing): add error.tsx boundaries

- Overview error: user-friendly error display
- Chat, workbench error boundaries
- Graceful failure handling
"
```

---

### Task 3.5: Remove Old (app) Directory

**Files:**
- Delete: `app/[locale]/workspaces/[workspace]/projects/[project]/(app)`

**Step 1: Verify all routes work**

Run: `npm run dev`
Navigate to all routes, verify they work.

**Step 2: Delete old directory**

```bash
rm -rf "app/[locale]/workspaces/[workspace]/projects/[project]/(app)"
```

**Step 3: Test again**

Run: `npm run dev` and `npm run build`
Expected: Everything works

**Step 4: Commit**

```bash
git add app
git commit -m "refactor(routing): remove old (app) parallel route

- Deleted unnecessary parallel route structure
- All routes now use (shell) groups
- Simpler, more maintainable routing
"
```

---

### Task 3.6: Verify and Test Phase 3

**Files:**
- Test: All routes

**Step 1: Test navigation**

```bash
npm run dev
```

Navigate to:
- `/workspaces/{workspace}/projects`
- `/workspaces/{workspace}/projects/{project}/overview`
- `/workspaces/{workspace}/projects/{project}/chat`
- etc.

**Step 2: Test deep links**

Direct URL navigation should work:
- Click back/forward in browser
- Refresh page
- Paste URL in new tab

**Step 3: Run E2E tests**

Run: `npm run test:e2e`
Expected: All tests pass

**Step 4: Commit Phase 3 completion**

```bash
git add .
git commit -m "feat(phase3): complete routing simplification

- Flattened to 2-3 levels of nesting
- Removed (app) parallel route
- Added loading.tsx skeleton screens
- Added error.tsx boundaries
- All routes, deep links, browser history work

Next: Phase 4 - Mock Data Cleanup
"
```

---

## Phase 4: Mock Data Cleanup

**Objective:** Remove all mock code from production, use MSW exclusively.

---

### Task 4.1: Verify MSW Handlers Cover All Auth/Workspace/Project APIs

**Files:**
- Check: `src/mocks/handlers/*.ts`

**Step 1: List required handlers**

Required endpoints:
- `POST /auth/login`
- `GET /auth/me`
- `GET /workspaces`
- `GET /workspaces/{id}`
- `GET /workspaces/{id}/projects`
- `GET /workspaces/{id}/projects/{id}`

**Step 2: Check existing handlers**

```bash
ls src/mocks/handlers/
grep -r "workspaces\|projects\|auth" src/mocks/handlers/
```

**Step 3: Create missing handlers**

If any missing, create them in `src/mocks/handlers/`:

```typescript
// Example: src/mocks/handlers/workspaces.ts
import { http, HttpResponse } from 'msw';

export const workspacesHandlers = [
  http.get('/api/workspaces', () => {
    return HttpResponse.json({
      items: [
        { id: 'ws_default', name: 'Default Workspace', role: 'owner' },
        { id: 'ws_test', name: 'Test Workspace', role: 'admin' },
      ],
      total: 2,
    });
  }),

  http.get('/api/workspaces/:id', ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      name: 'Test Workspace',
      role: 'owner',
    });
  }),
];
```

**Step 4: Commit**

```bash
git add src/mocks/handlers/
git commit -m "feat(mocks): add workspace/project auth handlers

- MSW handlers for login, me, workspaces, projects
- Complete coverage for state management refactoring
"
```

---

### Task 4.2: Remove Mock Functions from Components

**Files:**
- Modify: Any components using `mockLogin` or `mockLogout`

**Step 1: Find mock function usage**

```bash
grep -r "mockLogin\|mockLogout" src --include="*.ts" --include="*.tsx"
```

**Step 2: Replace with MSW**

Any component calling `mockLogin` should instead:
1. Call real `/auth/login` endpoint (handled by MSW in dev)
2. Let API client set token in store

**Step 3: Commit**

```bash
git add src
git commit -m "refactor(mocks): remove mockLogin/mockLogout usage

- Components use real API endpoints (MSW handles them in dev)
- Removed mock function calls from components
"
```

---

### Task 4.3: Verify Production Build Has No Mock Code

**Files:**
- Test: Production build

**Step 1: Build for production**

```bash
NEXT_PUBLIC_USE_MSW=false npm run build
```

**Step 2: Check bundle for mock references**

```bash
grep -r "mockLogin\|mockLogout\|mockWorkspaces\|mockProjects" .next --include="*.js"
```

Expected: No results (mock code tree-shaken out)

**Step 3: If found, remove**

Any mock code found needs to be:
- Behind `if (process.env.NEXT_PUBLIC_USE_MSW === 'true')` guards
- Or moved to separate files not imported in production

**Step 4: Commit**

```bash
git add .
git commit -m "refactor(mocks): ensure no mock code in production

- Verified production build has no mock references
- Mock code tree-shaken out when NEXT_PUBLIC_USE_MSW=false
"
```

---

### Task 4.4: Verify and Test Phase 4

**Files:**
- Test: Dev and production modes

**Step 1: Test dev mode (MSW)**

```bash
NEXT_PUBLIC_USE_MSW=true npm run dev
```

Expected:
- Login works
- Workspaces load
- Projects load

**Step 2: Test production mode (real backend)**

This requires a running backend. Skip if not available.

**Step 3: Final verification**

Run: `npm run build`
Expected: Clean build

**Step 4: Commit Phase 4 completion**

```bash
git add .
git commit -m "feat(phase4): complete mock data cleanup

- All mock code removed from production path
- MSW handles all mocking in development
- Production build clean, no mock references
- Components use real API endpoints

Refactoring complete!
"
```

---

## Final Verification

### Task F.1: Complete Testing Pass

**Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Lint**

Run: `npm run lint`
Expected: No new errors

**Step 3: Build**

Run: `npm run build`
Expected: Clean build

**Step 4: E2E tests**

Run: `npm run test:e2e`
Expected: All tests pass

**Step 5: Manual smoke test**

Run: `npm run dev`
Test:
- Login
- Workspace selection
- Project navigation
- Members page
- Sources page
- Browser back/forward
- Page refresh

### Task F.2: Update Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/REFACTORING_PLAN_2026-02-03.md` (mark complete)

**Step 1: Update CLAUDE.md**

Add section about new architecture:

```markdown
## Architecture (Post-Refactoring)

### State Management
- Auth: `lib/stores/authStore.ts` (Zustand) - user, token only
- Data: React Query - workspaces, projects, members, etc.
- URL: Source of truth for workspace/project selection

### Component Patterns
- Compound components with context (e.g., MembersPage)
- Custom hooks for business logic (e.g., useMembersList)
- Reusable primitives: FormDialog, useTableSelection

### Routing
- 2-3 levels max: `[locale]/[workspace]/(shell)/[project]/(shell)/[page]`
- Loading skeletons in `loading.tsx`
- Error boundaries in `error.tsx`
```

**Step 2: Mark refactoring plan complete**

Add to `docs/REFACTORING_PLAN_2026-02-03.md`:

```markdown
## Status: ✅ COMPLETE

Completed: 2026-02-03

All phases implemented successfully.
```

**Step 3: Final commit**

```bash
git add CLAUDE.md docs
git commit -m "docs: update architecture documentation post-refactoring

- Documented new state management approach
- Documented component patterns
- Documented routing structure
- Marked refactoring plan complete
"
```

---

## Appendix: Troubleshooting

### Issue: "useAuthStore has no property X"

**Cause:** Component trying to access removed property (workspaces, projects, etc.)

**Fix:** Use React Query hook instead:
- `useWorkspaces()` for workspaces list
- `useProjects(workspaceId)` for projects list
- `useProject(workspaceId, projectId)` for single project

### Issue: "Workspace/project not found on page load"

**Cause:** Deep link navigation without data in cache

**Fix:** `useSyncAuthFromUrl` handles this - should redirect to list page if not found

### Issue: "Permission checks returning false"

**Cause:** Permissions not loaded from project data

**Fix:** Ensure `useProject` query is enabled and data is loaded
