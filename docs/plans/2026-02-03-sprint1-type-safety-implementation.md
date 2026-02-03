# Sprint 1: Type Safety & Test Infrastructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix P0 permission type safety issues, establish testing infrastructure, and implement Audit/Usage permission gates.

**Architecture:**
- Add Zod runtime validation to replace `as unknown as` type assertions
- Introduce Membership API with Mock First strategy (define contract, mock implementation)
- Set up Vitest for unit testing with >80% coverage on critical paths
- Add permission-based UI gating for Audit/Usage pages

**Tech Stack:**
- Zod for runtime validation
- Vitest for unit testing
- Testing Library for React component testing
- Existing MSW for API mocking

---

## Task 1: Install Testing Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install Vitest and dependencies**

Run: `npm install -D vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom`

Expected: Dependencies added to package.json, node_modules updated

**Step 2: Add test scripts to package.json**

Edit `package.json` scripts section, add:

```json
"scripts": {
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:run": "vitest run",
  "test:coverage": "vitest run --coverage"
}
```

**Step 3: Install Zod for runtime validation**

Run: `npm install zod`

Expected: zod added to dependencies

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "test(sprint1): add vitest and zod dependencies"
```

---

## Task 2: Configure Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `tsconfig.json`

**Step 1: Create vitest.config.ts**

Create file with:

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mocks/**',
        '**/stories/**',
        'e2e/',
      ],
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 50,
        lines: 50,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Step 2: Create test setup file**

Create: `src/test/setup.ts` with:

```typescript
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    pathname: '/',
    query: {},
  }),
  useSearchParams: () => ({
    get: vi.fn(),
  }),
  useParams: () => ({
    workspace: 'ws_default',
    project: 'proj_001',
  }),
  usePathname: () => '/',
}));

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en-US',
}));
```

**Step 3: Update tsconfig.json for vitest**

Add to `tsconfig.json` compilerOptions:

```json
"types": ["vitest/globals", "@testing-library/jest-dom"]
```

**Step 4: Verify configuration**

Run: `npm run test:run`

Expected: Vitest runs with 0 tests (no test files yet)

**Step 5: Commit**

```bash
git add vitest.config.ts src/test/setup.ts tsconfig.json
git commit -m "test(sprint1): configure vitest with jsdom environment"
```

---

## Task 3: Add Zod Validation Helper

**Files:**
- Create: `src/lib/utils/validation.ts`

**Step 1: Write the failing test**

Create: `src/lib/utils/__tests__/validation.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { validateProjectWithMembership, type ProjectWithMembership } from '../validation';

describe('validateProjectWithMembership', () => {
  it('should validate a valid project with membership', () => {
    const validProject = {
      id: 'proj_001',
      workspace_id: 'ws_default',
      name: 'Test Project',
      owner_id: 'user_001',
      status: 'active',
      visibility: 'public',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      role: 'owner',
      permissions: ['project:read', 'project:update'],
    };

    const result = validateProjectWithMembership(validProject);
    expect(result).not.toBeNull();
    expect(result?.role).toBe('owner');
    expect(result?.permissions).toEqual(['project:read', 'project:update']);
  });

  it('should return null for invalid project', () => {
    const invalidProject = {
      id: 'proj_001',
      // Missing required fields
    };

    const result = validateProjectWithMembership(invalidProject);
    expect(result).toBeNull();
  });

  it('should return null for invalid role', () => {
    const projectWithInvalidRole = {
      id: 'proj_001',
      workspace_id: 'ws_default',
      name: 'Test Project',
      owner_id: 'user_001',
      status: 'active',
      visibility: 'public',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      role: 'invalid_role',
      permissions: [],
    };

    const result = validateProjectWithMembership(projectWithInvalidRole);
    expect(result).toBeNull();
  });

  it('should return null for non-array permissions', () => {
    const projectWithInvalidPermissions = {
      id: 'proj_001',
      workspace_id: 'ws_default',
      name: 'Test Project',
      owner_id: 'user_001',
      status: 'active',
      visibility: 'public',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      role: 'owner',
      permissions: 'not-an-array',
    };

    const result = validateProjectWithMembership(projectWithInvalidPermissions);
    expect(result).toBeNull();
  });

  it('should allow optional role and permissions', () => {
    const projectWithoutMembership = {
      id: 'proj_001',
      workspace_id: 'ws_default',
      name: 'Test Project',
      owner_id: 'user_001',
      status: 'active',
      visibility: 'public',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const result = validateProjectWithMembership(projectWithoutMembership);
    expect(result).not.toBeNull();
    expect(result?.role).toBeUndefined();
    expect(result?.permissions).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- validation.test.ts`

Expected: FAIL with "validateProjectWithMembership is not defined"

**Step 3: Implement validation module**

Create: `src/lib/utils/validation.ts` with:

```typescript
import { z } from 'zod';
import type { Project } from '@/lib/api/types';

/**
 * Zod schema for ProjectWithMembership validation
 *
 * Validates that:
 * - All Project fields are present and valid
 * - role is one of: owner, admin, developer, user (optional)
 * - permissions is an array of strings (optional)
 */
export const ProjectWithMembershipSchema = z.object({
  // Base Project fields
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  visibility: z.enum(['public', 'private']),
  join_policy: z.enum(['approval_required', 'open']).optional(),
  owner_id: z.string(),
  status: z.enum(['active', 'archived', 'deleted']),
  governance_json: z.record(z.unknown()).optional(),
  runtime_preferences_json: z.record(z.unknown()).optional(),
  limits_json: z.record(z.unknown()).optional(),
  created_at: z.string(),
  updated_at: z.string(),

  // Optional membership fields
  role: z.enum(['owner', 'admin', 'developer', 'user']).optional(),
  permissions: z.array(z.string()).optional(),
});

/**
 * Type for validated ProjectWithMembership
 */
export type ProjectWithMembership = z.infer<typeof ProjectWithMembershipSchema>;

/**
 * Validate and cast unknown data to ProjectWithMembership
 *
 * This function performs runtime validation using Zod schema.
 * Returns null if validation fails, preventing type assertions.
 *
 * @param data - Unknown data to validate
 * @returns Validated ProjectWithMembership or null if invalid
 */
export function validateProjectWithMembership(data: unknown): ProjectWithMembership | null {
  const result = ProjectWithMembershipSchema.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Check if data is a valid ProjectWithMembership
 *
 * @param data - Data to check
 * @returns true if valid, false otherwise
 */
export function isValidProjectWithMembership(data: unknown): data is ProjectWithMembership {
  return ProjectWithMembershipSchema.safeParse(data).success;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- validation.test.ts`

Expected: PASS (all 5 tests pass)

**Step 5: Commit**

```bash
git add src/lib/utils/validation.ts src/lib/utils/__tests__/validation.test.ts
git commit -m "feat(sprint1): add zod runtime validation for ProjectWithMembership"
```

---

## Task 4: Update use-permissions.ts with Runtime Validation

**Files:**
- Modify: `src/lib/hooks/use-permissions.ts`

**Step 1: Write the failing test**

Create: `src/lib/hooks/__tests__/use-permissions.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHasPermission, useHasAllPermissions, useCurrentPermissions, useIsOwnerOrAdmin, useIsOwner } from '../use-permissions';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
vi.mock('../use-projects-queries', () => ({
  useProject: vi.fn(),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: vi.fn(),
}));

import { useProject } from '../use-projects-queries';
import { useAuthStore } from '@/lib/stores/authStore';

const mockUseProject = useProject as vi.MockedFunction<typeof useProject>;
const mockUseAuthStore = useAuthStore as unknown as { mockReturnValue: (value: unknown) => void };

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('use-permissions hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthStore.mockReturnValue({ isAuthenticated: true });
  });

  describe('useCurrentPermissions', () => {
    it('should return permissions from validated project', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        role: 'owner' as const,
        permissions: ['project:read', 'project:update'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCurrentPermissions(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual(['project:read', 'project:update']);
    });

    it('should return empty permissions for project without membership', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useCurrentPermissions(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual([]);
    });

    it('should return empty permissions when project is undefined', () => {
      mockUseProject.mockReturnValue({ data: undefined, isLoading: false });

      const { result } = renderHook(() => useCurrentPermissions(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual([]);
    });
  });

  describe('useHasPermission', () => {
    it('should return true when user has exact permission', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:read', 'project:update'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:read'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return true when user has wildcard permission', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['*'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:any:thing'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return true when user has prefix wildcard permission', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:*'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:read'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false when user does not have permission', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        permissions: ['project:read'],
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useHasPermission('project:delete'), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });
  });

  describe('useIsOwnerOrAdmin', () => {
    it('should return true for owner role', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        role: 'owner' as const,
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return true for admin role', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        role: 'admin' as const,
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false for developer role', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        role: 'developer' as const,
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });

    it('should return false when project is undefined', () => {
      mockUseProject.mockReturnValue({ data: undefined, isLoading: false });

      const { result } = renderHook(() => useIsOwnerOrAdmin(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });
  });

  describe('useIsOwner', () => {
    it('should return true only for owner role', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        role: 'owner' as const,
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwner(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(true);
    });

    it('should return false for admin role', () => {
      const mockProject = {
        id: 'proj_001',
        workspace_id: 'ws_default',
        name: 'Test Project',
        owner_id: 'user_001',
        status: 'active' as const,
        visibility: 'public' as const,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        role: 'admin' as const,
      };

      mockUseProject.mockReturnValue({ data: mockProject, isLoading: false });

      const { result } = renderHook(() => useIsOwner(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- use-permissions.test.ts`

Expected: FAIL (tests will fail because old implementation uses `as unknown as`)

**Step 3: Update use-permissions.ts with runtime validation**

Edit `src/lib/hooks/use-permissions.ts` line 9-23:

Replace:
```typescript
import { useMemo } from 'react';
import { useProject } from './use-projects-queries';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import type { Project } from '@/lib/api/types';

// Stable empty array reference
const EMPTY_PERMISSIONS: readonly string[] = Object.freeze([]) as unknown as string[];

// Project extended with role/permissions from membership
// TODO: This should come from a membership API endpoint
export interface ProjectWithMembership extends Project {
  role?: 'owner' | 'admin' | 'developer' | 'user';
  permissions?: string[];
}
```

With:
```typescript
import { useMemo } from 'react';
import { useProject } from './use-projects-queries';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { validateProjectWithMembership, type ProjectWithMembership } from '@/lib/utils/validation';

// Stable empty array reference - now properly typed
const EMPTY_PERMISSIONS: readonly string[] = Object.freeze([]);
```

Edit `src/lib/hooks/use-permissions.ts` line 35-47 (useCurrentPermissions function):

Replace:
```typescript
export function useCurrentPermissions() {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;

  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    // Cast to extended type - will be resolved when membership API is integrated
    const projectWithMembership = currentProject as unknown as ProjectWithMembership | undefined;
    return projectWithMembership?.permissions ?? EMPTY_PERMISSIONS;
  }, [currentProject]);
}
```

With:
```typescript
export function useCurrentPermissions() {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;

  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    // Runtime validation: ensure project data matches expected schema
    const validated = currentProject ? validateProjectWithMembership(currentProject) : null;
    return validated?.permissions ?? EMPTY_PERMISSIONS;
  }, [currentProject]);
}
```

Edit `src/lib/hooks/use-permissions.ts` line 102-118 (useIsOwnerOrAdmin function):

Replace:
```typescript
export function useIsOwnerOrAdmin(): boolean {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;
  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    if (!currentProject) {
      return false;
    }

    // Cast to extended type - will be resolved when membership API is integrated
    const projectWithMembership = currentProject as unknown as ProjectWithMembership | undefined;
    const role = projectWithMembership?.role || 'user';
    return role === 'owner' || role === 'admin';
  }, [currentProject]);
}
```

With:
```typescript
export function useIsOwnerOrAdmin(): boolean {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;
  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    if (!currentProject) {
      return false;
    }

    // Runtime validation: ensure project data matches expected schema
    const validated = validateProjectWithMembership(currentProject);
    const role = validated?.role || 'user';
    return role === 'owner' || role === 'admin';
  }, [currentProject]);
}
```

Edit `src/lib/hooks/use-permissions.ts` line 123-139 (useIsOwner function):

Replace:
```typescript
export function useIsOwner(): boolean {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;
  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    if (!currentProject) {
      return false;
    }

    // Cast to extended type - will be resolved when membership API is integrated
    const projectWithMembership = currentProject as unknown as ProjectWithMembership | undefined;
    const role = projectWithMembership?.role || 'user';
    return role === 'owner';
  }, [currentProject]);
}
```

With:
```typescript
export function useIsOwner(): boolean {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;
  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    if (!currentProject) {
      return false;
    }

    // Runtime validation: ensure project data matches expected schema
    const validated = validateProjectWithMembership(currentProject);
    const role = validated?.role || 'user';
    return role === 'owner';
  }, [currentProject]);
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- use-permissions.test.ts`

Expected: PASS (all tests pass)

**Step 5: Commit**

```bash
git add src/lib/hooks/use-permissions.ts src/lib/hooks/__tests__/use-permissions.test.ts
git commit -m "refactor(sprint1): use runtime validation instead of type assertions in use-permissions"
```

---

## Task 5: Add Membership API Endpoint

**Files:**
- Modify: `src/lib/api/endpoints/members.ts`

**Step 1: Write the failing test**

Create: `src/lib/api/endpoints/__tests__/members.test.ts` with:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemberAPI } from '../members';

describe('MemberAPI', () => {
  let api: MemberAPI;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    api = new MemberAPI(mockClient);
  });

  describe('getMembership', () => {
    it('should fetch membership for current user in a project', async () => {
      const mockMembership = {
        project_id: 'proj_001',
        user_id: 'user_001',
        role: 'owner',
        permissions: ['project:read', 'project:update'],
        status: 'active',
        joined_at: '2026-01-15T10:00:00Z',
      };

      mockClient.get.mockResolvedValue(mockMembership);

      const result = await api.getMembership('ws_default', 'proj_001', 'user_001');

      expect(result).toEqual(mockMembership);
      expect(mockClient.get).toHaveBeenCalledWith(
        '/workspaces/ws_default/projects/proj_001/memberships/user_001'
      );
    });

    it('should return null if membership not found', async () => {
      mockClient.get.mockRejectedValue({
        error_code: 'NOT_FOUND',
        message: 'Membership not found',
      });

      await expect(
        api.getMembership('ws_default', 'proj_001', 'user_999')
      ).rejects.toThrow();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- members.test.ts`

Expected: FAIL with "api.getMembership is not a function"

**Step 3: Implement getMembership method**

Edit `src/lib/api/endpoints/members.ts`, add after line 27 (after CreateInviteResponse):

```typescript
export interface Membership {
  project_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'developer' | 'user';
  permissions: string[];
  status: 'active' | 'blocked' | 'removed';
  joined_at: string;
}
```

Then add the method to MemberAPI class (after line 411, before the closing brace of the class):

```typescript
  /**
   * Get membership for a specific user in a project
   *
   * This endpoint returns the current user's role and permissions
   * for the specified project. Used for permission checks.
   */
  async getMembership(
    workspaceId: string,
    projectId: string,
    userId: string
  ): Promise<Membership> {
    return this.client.get<Membership>(
      `/workspaces/${workspaceId}/projects/${projectId}/memberships/${userId}`
    );
  }
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- members.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/api/endpoints/members.ts src/lib/api/endpoints/__tests__/members.test.ts
git commit -m "feat(sprint1): add getMembership API endpoint"
```

---

## Task 6: Add Mock Handler for Membership API

**Files:**
- Modify: `src/mocks/handlers.ts`
- Modify: `src/mocks/fixtures/members.ts`

**Step 1: Add membership fixture**

Edit `src/mocks/fixtures/members.ts`, add export at end of file:

```typescript
// Re-export ProjectMembership as Membership for API use
export type { ProjectMembership as Membership } from '@/lib/api/types';
```

**Step 2: Add mock handler**

Edit `src/mocks/handlers.ts`, find the Members section (around line 700+), add after the existing member handlers:

```typescript
  http.get('/api/workspaces/:ws/projects/:prj/memberships/:userId', ({ params }) => {
    const userId = getId(params, 'userId');
    const projectId = getId(params, 'prj');

    const membership = projectMembershipFixtures.find(
      (m) => m.project_id === projectId && m.user_id === userId
    );

    if (!membership) {
      return HttpResponse.json(
        { error_code: 'NOT_FOUND', message: 'Membership not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json(membership);
  }),
```

**Step 3: Verify mock is registered**

Run: `npm run dev`

Expected: Dev server starts without errors

**Step 4: Commit**

```bash
git add src/mocks/handlers.ts src/mocks/fixtures/members.ts
git commit -m "test(sprint1): add mock handler for membership API"
```

---

## Task 7: Add Audit/Usage Permission Gates

**Files:**
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/audit/page.tsx`
- Modify: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/usage/page.tsx`

**Step 1: Check if Audit page exists**

Run: `ls -la src/app/\[locale\]/workspaces/\[workspace\]/projects/\[project\]/\(app\)/audit/`

Expected: Either directory exists or needs to be created

**Step 2: If Audit page exists, update it**

If `audit/page.tsx` exists, read it first to understand current implementation.

Then update to add permission gate:

```typescript
// At top of file, add:
import { useHasPermission } from '@/lib/hooks/use-permissions';

// In the component, add permission check:
export default function AuditPage() {
  const hasPermission = useHasPermission('project:audit:read');

  if (!hasPermission) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <h2 className="text-lg font-semibold">Access Denied</h2>
          <p className="text-sm text-text-tertiary">
            You don't have permission to view audit logs.
          </p>
        </div>
      </div>
    );
  }

  // Rest of existing component...
```

**Step 3: If Audit page doesn't exist, create it**

Create: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(app)/audit/page.tsx` with:

```typescript
'use client';

import { useHasPermission } from '@/lib/hooks/use-permissions';

export default function AuditPage() {
  const hasPermission = useHasPermission('project:audit:read');

  if (!hasPermission) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <h2 className="text-lg font-semibold">Access Denied</h2>
          <p className="text-sm text-text-tertiary">
            You don't have permission to view audit logs.
          </p>
        </div>
      </div>
    );
  }

  // TODO: Implement audit log table
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Audit Logs</h1>
      <p>Audit log table to be implemented.</p>
    </div>
  );
}
```

**Step 4: Update Usage page similarly**

If `usage/page.tsx` exists, add permission gate for `project:usage:read`.

**Step 5: Commit**

```bash
git add src/app/\[locale\]/workspaces/\[workspace\]/projects/\[project\]/\(app\)/audit/page.tsx
git add src/app/\[locale\]/workspaces/\[workspace\]/projects/\[project\]/\(app\)/usage/page.tsx
git commit -m "feat(sprint1): add permission gates to Audit/Usage pages"
```

---

## Task 8: Update Sidebar for Permission-Based Navigation

**Files:**
- Modify: `src/components/app-shell/Sidebar.tsx` or equivalent

**Step 1: Locate Sidebar component**

Run: `find src/components -name "*[Ss]idebar*" -o -name "*[Nn]av*"`

Expected: Find sidebar/navigation component

**Step 2: Add permission checks to sidebar items**

For Audit link: Wrap with `useHasPermission('project:audit:read')`

For Usage link: Wrap with `useHasPermission('project:usage:read')`

Example:
```typescript
const showAudit = useHasPermission('project:audit:read');
const showUsage = useHasPermission('project:usage:read');

// In navigation:
{showAudit && <NavItem href="audit">Audit</NavItem>}
{showUsage && <NavItem href="usage">Usage</NavItem>}
```

**Step 3: Commit**

```bash
git add src/components/app-shell/Sidebar.tsx
git commit -m "feat(sprint1): hide Audit/Usage sidebar links based on permissions"
```

---

## Task 9: Run Full Test Suite and Coverage

**Step 1: Run all tests**

Run: `npm run test:run`

Expected: All tests pass

**Step 2: Generate coverage report**

Run: `npm run test:coverage`

Expected: Coverage report generated, check that:
- `use-permissions.ts` >80%
- `validation.ts` >90%

**Step 3: Fix any coverage gaps**

If coverage is below threshold, add more tests to critical paths.

**Step 4: Commit**

```bash
git add .
git commit -m "test(sprint1): achieve >80% coverage on permission hooks"
```

---

## Task 10: Final Verification

**Step 1: Build check**

Run: `npm run build`

Expected: Build succeeds without TypeScript errors

**Step 2: Lint check**

Run: `npm run lint`

Expected: No lint errors

**Step 3: E2E smoke test**

Run: `npm run test:e2e -- tests/e2e/smoke.spec.ts`

Expected: Smoke tests pass

**Step 4: Final commit**

```bash
git add .
git commit -m "chore(sprint1): final verification - all tests passing, build successful"
```

---

## Verification Checklist

Before considering Sprint 1 complete:

- [ ] All `as unknown as` type assertions removed from permission hooks
- [ ] Runtime validation using Zod implemented
- [ ] Membership API endpoint defined with mock handler
- [ ] Unit tests for use-permissions.ts >80% coverage
- [ ] Unit tests for validation.ts >90% coverage
- [ ] Audit page permission gated with `project:audit:read`
- [ ] Usage page permission gated with `project:usage:read`
- [ ] Sidebar hides links based on permissions
- [ ] All tests pass (`npm run test:run`)
- [ ] Build succeeds (`npm run build`)
- [ ] No TypeScript errors

---

## Next Steps

After Sprint 1 completion:

1. **Review code** with team
2. **Merge to main** using squash merge
3. **Create PR** with summary of changes
4. **Start Sprint 2** - Member Management & Invite Features

---

**Reference Documents:**
- `docs/plans/2026-02-03-improvement-roadmap.md` - Overall roadmap
- `docs/ARCHITECTURE_REVIEW_2026-02-03.md` - Architecture review
- `文档/开发要求/2026-02-02-Usage-Audit-Members-Invite-实施计划-v1.md` - Phase 3 details
