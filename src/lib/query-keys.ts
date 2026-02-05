/**
 * Query Keys Factory
 *
 * Centralizes all React Query keys for type safety, autocomplete,
 * and easier cache management.
 *
 * @example
 * ```tsx
 * // Data fetching
 * useQuery({
 *   queryKey: queryKeys.projects.detail(workspaceId, projectId),
 *   queryFn: () => api.getProject(workspaceId, projectId),
 * });
 *
 * // Invalidation
 * queryClient.invalidateQueries({
 *   queryKey: queryKeys.projects.list(workspaceId),
 * });
 *
 * // Partial invalidation (invalidate all project queries for a workspace)
 * queryClient.invalidateQueries({
 *   queryKey: queryKeys.projects._def,
 * });
 * ```
 */

import { createQueryKeys } from '@lukemorales/query-key-factory';

/**
 * All query keys organized by resource hierarchy
 */
export const queryKeys = createQueryKeys('mbos', {
  /** Current user queries (no workspace/project scope) */
  me: {
    _def: null as unknown as string[],
    profile: () => ['me', 'profile'] as const,
    notifications: () => ['me', 'notifications'] as const,
    unreadCount: () => ['me', 'notifications', 'unread-count'] as const,
  },

  /** Workspace-scoped queries */
  workspaces: {
    _def: null as unknown as string[],
    all: () => ['workspaces'] as const,
    detail: (workspaceId: string) => ['workspaces', workspaceId] as const,
    settings: (workspaceId: string) => ['workspaces', workspaceId, 'settings'] as const,
  },

  /** Project-scoped queries */
  projects: {
    _def: null as unknown as string[],
    list: (workspaceId: string) => ['projects', workspaceId] as const,
    detail: (workspaceId: string, projectId: string) => ['project', workspaceId, projectId] as const,
  },

  /** Members and permissions */
  members: {
    _def: null as unknown as string[],
    list: (workspaceId: string, projectId: string) => ['members', workspaceId, projectId] as const,
    permissions: (workspaceId: string, projectId: string, memberId: string) =>
      ['member-permissions', workspaceId, projectId, memberId] as const,
    quotaOverrides: (workspaceId: string, projectId: string, memberId: string) =>
      ['member-quota-overrides', workspaceId, projectId, memberId] as const,
    quotaOverridesHistory: (
      workspaceId: string,
      projectId: string,
      memberId: string,
      page: number,
      pageSize: number
    ) => ['member-quota-overrides-history', workspaceId, projectId, memberId, page, pageSize] as const,
    changeHistory: (workspaceId: string, projectId: string, memberId: string) =>
      ['member-change-history', workspaceId, projectId, memberId] as const,
  },

  /** Join requests for project membership */
  joinRequests: {
    _def: null as unknown as string[],
    list: (workspaceId: string, projectId: string) => ['join-requests', workspaceId, projectId] as const,
  },

  /** Permission templates */
  permissionTemplates: {
    _def: null as unknown as string[],
    list: (workspaceId: string, projectId: string) =>
      ['permission-templates', workspaceId, projectId] as const,
  },

  /** Quota templates */
  quotaTemplates: {
    _def: null as unknown as string[],
    list: (workspaceId: string, projectId: string) => ['quota-templates', workspaceId, projectId] as const,
    detail: (workspaceId: string, projectId: string, templateId: string) =>
      ['quota-templates', workspaceId, projectId, templateId] as const,
  },

  /** Resource ACL (access control lists) */
  resourceAcl: {
    _def: null as unknown as string[],
    detail: (workspaceId: string, projectId: string, resourceType: string, resourceId: string) =>
      ['resource-acl', workspaceId, projectId, resourceType, resourceId] as const,
  },

  /** Sources (files) */
  sources: {
    _def: null as unknown as string[],
    list: (workspaceId: string, projectId: string, params?: Record<string, unknown>) =>
      ['sources', workspaceId, projectId, params] as const,
    detail: (workspaceId: string, projectId: string, fileId: string) =>
      ['source', workspaceId, projectId, fileId] as const,
  },

  /** Recipes (workbench) */
  recipes: {
    _def: null as unknown as string[],
    list: (workspaceId: string, projectId: string, params?: Record<string, unknown>) =>
      ['recipes', workspaceId, projectId, params] as const,
    detail: (workspaceId: string, projectId: string, recipeId: string) =>
      ['recipe', workspaceId, projectId, recipeId] as const,
    messages: (workspaceId: string, projectId: string, recipeId: string) =>
      ['recipe-messages', workspaceId, projectId, recipeId] as const,
    artifacts: (workspaceId: string, projectId: string, recipeId: string) =>
      ['recipe-artifacts', workspaceId, projectId, recipeId] as const,
  },

  /** Agents */
  agents: {
    _def: null as unknown as string[],
    list: (workspaceId: string, projectId: string) => ['agents', workspaceId, projectId] as const,
    keys: (workspaceId: string, projectId: string, agentId: string) =>
      ['agents', workspaceId, projectId, agentId, 'keys'] as const,
    diagnostics: (workspaceId: string, projectId: string, agentId: string) =>
      ['agents', workspaceId, projectId, agentId, 'diagnostics'] as const,
  },

  /** Endpoints */
  endpoints: {
    _def: null as unknown as string[],
    list: (workspaceId: string, projectId: string) => ['endpoints', workspaceId, projectId] as const,
  },

  /** Credentials */
  credentials: {
    _def: null as unknown as string[],
    list: (workspaceId: string, projectId: string) => ['credentials', workspaceId, projectId] as const,
  },

  /** Audit logs */
  audit: {
    _def: null as unknown as string[],
    list: (workspaceId: string, projectId: string, params?: Record<string, unknown>) =>
      ['audit', workspaceId, projectId, params] as const,
  },

  /** Usage stats */
  usage: {
    _def: null as unknown as string[],
    kpi: (workspaceId: string, projectId: string, startTime: string, endTime: string, endUserId?: string) =>
      ['usage-kpi', workspaceId, projectId, startTime, endTime, endUserId] as const,
    list: (workspaceId: string, projectId: string, params?: Record<string, unknown>) =>
      ['usage', workspaceId, projectId, params] as const,
  },

  /** User data */
  userdata: {
    _def: null as unknown as string[],
    keys: () => ['user', 'keys'] as const,
    summary: (workspaceId: string, projectId: string) =>
      ['userdata', workspaceId, projectId, 'summary'] as const,
    endUsers: (workspaceId: string, projectId: string) =>
      ['userdata', workspaceId, projectId, 'end-users'] as const,
  },

  /** Chat sessions and messages */
  chat: {
    _def: null as unknown as string[],
    sessions: (workspaceId: string, projectId: string) =>
      ['chat', 'sessions', workspaceId, projectId] as const,
    messages: (workspaceId: string, projectId: string, sessionId: string) =>
      ['chat', 'messages', workspaceId, projectId, sessionId] as const,
    attachments: (workspaceId: string, projectId: string, sessionId: string) =>
      ['chat', 'attachments', workspaceId, projectId, sessionId] as const,
  },

  /** Quota */
  quota: {
    _def: null as unknown as string[],
    detail: (workspaceId: string, projectId: string) =>
      ['quota', workspaceId, projectId] as const,
  },
});

/**
 * Type helpers for extracting query key types
 */
export type QueryKey = ReturnType<typeof queryKeys[keyof typeof queryKeys]>;
export type InferQueryKey<T extends (...args: unknown[]) => readonly unknown[]> = ReturnType<T>;
