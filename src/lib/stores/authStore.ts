/**
 * Authentication Store - Zustand
 *
 * Manages user authentication state, tokens, and workspace/project context.
 * This is the single source of truth for auth state across the application.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect, useState } from 'react';
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

// Data-only state (without actions)
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
  setProject: (project: Project) => void;
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
    permissions: ['project:*'],
    status: 'active',
  },
  {
    id: 'proj_002',
    workspace_id: 'ws_default',
    name: 'Research Project',
    visibility: 'private',
    role: 'admin',
    permissions: ['project:read', 'project:agent:create'],
    status: 'active',
  },
];

// ============================================================
// Store
// ============================================================

const isServer = typeof window === 'undefined';

// Custom storage that handles SSR
const customStorage = {
  getItem: (name: string) => {
    if (!isServer) {
      const item = localStorage.getItem(name);
      if (item) {
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      }
    }
    return null;
  },
  setItem: (name: string, value: unknown) => {
    if (!isServer) {
      localStorage.setItem(name, JSON.stringify(value));
    }
  },
  removeItem: (name: string) => {
    if (!isServer) {
      localStorage.removeItem(name);
    }
  },
};

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

      setProject: (project: Project) => {
        set({
          currentProject: project,
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

        // Get projects for this workspace
        const workspaceProjects = mockProjects.filter(
          (p) => p.workspace_id === workspaceId
        );

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
          currentWorkspace: workspace,
          currentProject: workspaceProjects[0] || null,
          workspaces: mockWorkspaces,
          projects: workspaceProjects,
        });
      },

      mockLogout: () => {
        set(initialData);
      },
    }),
    {
      name: 'mbos-auth',
      storage: customStorage,
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
  const [hydrated, setHydrated] = useState(!isServer);

  useEffect(() => {
    if (!isServer) {
      setHydrated(true);
    }
  }, []);

  return hydrated;
};

// ============================================================
// Selectors
// ============================================================

export const selectCurrentUser = (state: AuthState) => state.user;

export const selectCurrentWorkspace = (state: AuthState) => state.currentWorkspace;

export const selectCurrentProject = (state: AuthState) => state.currentProject;

export const selectCurrentPermissions = (state: AuthState) => {
  return state.currentProject?.permissions || [];
};

export const selectHasPermission = (permission: string) => (state: AuthState) => {
  const permissions = selectCurrentPermissions(state);
  return permissions.includes('*') || permissions.includes(permission);
};

export const selectHasAnyPermission = (permissions: string[]) => (state: AuthState) => {
  const userPermissions = selectCurrentPermissions(state);
  return permissions.some((p) => userPermissions.includes(p));
};
