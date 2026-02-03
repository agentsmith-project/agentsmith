/**
 * Authentication Store - Zustand
 *
 * Manages user authentication state, tokens, and workspace/project context.
 * This is the single source of truth for auth state across the application.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useEffect, useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';

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

export interface Workspace {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  visibility: 'public' | 'private';
  role: 'owner' | 'admin' | 'developer' | 'user';
  permissions: string[];
  status: 'active' | 'disabled';
}

// ============================================================
// Constants
// ============================================================

// Stable empty array reference to avoid creating new arrays on each selector call
const EMPTY_PERMISSIONS: string[] = Object.freeze([]) as unknown as string[];

// ============================================================
// Data-only state (without actions)
// ============================================================

interface AuthData {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  currentWorkspace: Workspace | null;
  currentProject: Project | null;
  workspaces: Workspace[];
  projects: Project[];
}

export interface AuthState extends AuthData {
  // Actions
  setAuth: (user: User, token: string) => void;
  setWorkspace: (workspace: Workspace) => void;
  setProject: (project: Project | null) => void;
  setProjects: (projects: Project[]) => void; // Update projects list for current workspace
  clearProject: () => void;
  clearAuth: () => void;

  // Mock actions (development only)
  mockLogin: (workspaceId: string, userEmail: string, userName?: string) => void;
  mockLogout: () => void;
}

// ============================================================
// Initial State
// ============================================================

const initialData: AuthData = {
  user: null,
  token: null,
  isAuthenticated: false,
  currentWorkspace: null,
  currentProject: null,
  workspaces: [],
  projects: [],
};

// ============================================================
// Mock Data
// ============================================================

const mockWorkspaces: Workspace[] = [
  {
    id: 'ws_default',
    name: 'Default Workspace',
    role: 'owner',
  },
  {
    id: 'ws_test',
    name: 'Test Workspace',
    role: 'admin',
  },
];

const mockProjects: Project[] = [
  {
    id: 'proj_001',
    workspace_id: 'ws_default',
    name: 'AI Assistant Project',
    visibility: 'public',
    role: 'owner',
    permissions: [...ROLE_TEMPLATES.owner],
    status: 'active',
  },
  {
    id: 'proj_002',
    workspace_id: 'ws_default',
    name: 'Research Project',
    visibility: 'private',
    role: 'admin',
    permissions: [...ROLE_TEMPLATES.admin],
    status: 'active',
  },
];

// ============================================================
// Store
// ============================================================

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...initialData,
      isAuthenticated: false,

      // Actions
      setAuth: (user: User, token: string) => {
        set({
          user,
          token,
          isAuthenticated: true,
        });
      },

      setWorkspace: (workspace: Workspace) => {
        set({
          currentWorkspace: workspace,
          currentProject: null, // Reset project when changing workspace
        });
      },

      setProject: (project: Project | null) => {
        set({
          currentProject: project,
        });
      },

      clearProject: () => {
        set({ currentProject: null });
      },

      setProjects: (projects: Project[]) => {
        set({
          projects,
        });
      },

      clearAuth: () => {
        set(initialData);
      },

      // Mock actions
      mockLogin: (workspaceId: string, userEmail: string, userName?: string) => {
        const workspace = mockWorkspaces.find((ws) => ws.id === workspaceId);
        if (!workspace) {
          console.error(`Workspace ${workspaceId} not found`);
          return;
        }

        const user: User = {
          id: 'user_' + Math.random().toString(36).substring(2, 10),
          email: userEmail,
          name: userName || userEmail.split('@')[0],
          locale: 'en-US',
        };

        // Generate mock token (in real app, this comes from Keycloak)
        const token = `mock_jwt_${user.id}_${Date.now()}`;

        set({
          user,
          token,
          isAuthenticated: true,
          currentWorkspace: null, // Will be set on workspace selection page
          currentProject: null, // Will be set on projects page
          workspaces: mockWorkspaces,
          projects: mockProjects, // Store ALL projects, components will filter by workspace
        });
      },

      mockLogout: () => {
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
        currentWorkspace: state.currentWorkspace,
        currentProject: state.currentProject,
        workspaces: state.workspaces,
        projects: state.projects,
      }),
    }
  )
);

// ============================================================
// Hydration Hook
// ============================================================

export const useAuthStoreHydration = () => {
  const [hydrated, setHydrated] = useState(() => {
    const persistApi = (useAuthStore as unknown as { persist?: { hasHydrated?: () => boolean } }).persist;
    return persistApi?.hasHydrated ? persistApi.hasHydrated() : typeof window !== 'undefined';
  });

  useEffect(() => {
    const persistApi = (useAuthStore as unknown as { persist?: { onFinishHydration?: (fn: () => void) => () => void } }).persist;
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
// Selectors - Stable references for permission checking
// ============================================================

/**
 * Get current user permissions with stable empty array reference
 * This selector ensures we always return the same empty array reference
 * when there are no permissions, preventing unnecessary re-renders.
 */
export const selectCurrentPermissions = (state: AuthState): readonly string[] => {
  return state.currentProject?.permissions ?? EMPTY_PERMISSIONS;
};

/**
 * Check if user has a specific permission
 * This is a selector factory that returns a stable selector function.
 * Supports: exact match, literal '*', and prefix wildcards like 'project:*'.
 */
export const selectHasPermission = (permission: string) => {
  return (state: AuthState): boolean => {
    const permissions = selectCurrentPermissions(state);
    if (permissions.length === 0) return false;
    if (permissions.includes('*')) return true;
    if (permissions.includes(permission)) return true;
    // Prefix wildcard: e.g. 'project:*' grants 'project:audit:read', 'project:usage:read', etc.
    const prefixMatch = permissions.find((p) => p.endsWith(':*'));
    if (prefixMatch) {
      const prefix = prefixMatch.slice(0, -1); // 'project:' 
      if (permission.startsWith(prefix)) return true;
    }
    return false;
  };
};

/**
 * Check if user has any of the specified permissions
 * This is a selector factory that returns a stable selector function.
 */
export const selectHasAnyPermission = (permissions: readonly string[]) => {
  // Return a stable selector function
  return (state: AuthState): boolean => {
    if (permissions.length === 0) return false;
    const userPermissions = selectCurrentPermissions(state);
    if (userPermissions.length === 0) return false;
    if (userPermissions.includes('*')) return true;
    return permissions.some((p) => userPermissions.includes(p));
  };
};

/**
 * Check if user has all of the specified permissions
 * This is a selector factory that returns a stable selector function.
 */
export const selectHasAllPermissions = (permissions: readonly string[]) => {
  // Return a stable selector function
  return (state: AuthState): boolean => {
    if (permissions.length === 0) return false;
    const userPermissions = selectCurrentPermissions(state);
    if (userPermissions.length === 0) return false;
    if (userPermissions.includes('*')) return true;
    return permissions.every((p) => userPermissions.includes(p));
  };
};

// Legacy selectors for backward compatibility
export const selectCurrentUser = (state: AuthState) => state.user;
export const selectCurrentWorkspace = (state: AuthState) => state.currentWorkspace;
export const selectCurrentProject = (state: AuthState) => state.currentProject;
