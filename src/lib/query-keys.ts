/**
 * Query Keys Factory
 *
 * Centralizes all React Query keys for type safety, autocomplete,
 * and easier cache management.
 *
 * Each group has a `_def` property that returns the base key for that group,
 * which can be used for broad invalidation (e.g., invalidate all project queries).
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

/**
 * All query keys organized by resource hierarchy.
 *
 * Each method returns a readonly tuple used directly as a React Query `queryKey`.
 */
export const queryKeys = {
  /** Current user queries (no workspace/project scope) */
  me: {
    _def: ['me'] as const,
    profile: () => ['me', 'profile'] as const,
    notifications: () => ['me', 'notifications'] as const,
    unreadCount: () => ['me', 'notifications', 'unread-count'] as const,
  },

  /** Workspace-scoped queries */
  workspaces: {
    _def: ['workspaces'] as const,
    all: () => ['workspaces'] as const,
    detail: (workspaceId: string) => ['workspaces', workspaceId] as const,
    settings: (workspaceId: string) => ['workspaces', workspaceId, 'settings'] as const,
  },

  /** Project-scoped queries */
  projects: {
    _def: ['projects'] as const,
    list: (workspaceId: string) => ['projects', workspaceId] as const,
    detail: (workspaceId: string, projectId: string) =>
      ['project', workspaceId, projectId] as const,
  },

  /** Members and permissions */
  members: {
    _def: ['members'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['members', workspaceId, projectId] as const,
    permissions: (workspaceId: string, projectId: string, memberId: string) =>
      ['member-permissions', workspaceId, projectId, memberId] as const,
    quotaOverrides: (workspaceId: string, projectId: string, memberId: string) =>
      ['member-quota-overrides', workspaceId, projectId, memberId] as const,
    quotaOverridesHistory: (
      workspaceId: string,
      projectId: string,
      memberId: string,
      page: number,
      pageSize: number,
    ) =>
      ['member-quota-overrides-history', workspaceId, projectId, memberId, page, pageSize] as const,
    changeHistory: (workspaceId: string, projectId: string, memberId: string) =>
      ['member-change-history', workspaceId, projectId, memberId] as const,
  },

  /** Join requests for project membership */
  joinRequests: {
    _def: ['join-requests'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['join-requests', workspaceId, projectId] as const,
  },

  /** Permission templates */
  permissionTemplates: {
    _def: ['permission-templates'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['permission-templates', workspaceId, projectId] as const,
  },

  /** Quota templates */
  quotaTemplates: {
    _def: ['quota-templates'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['quota-templates', workspaceId, projectId] as const,
    detail: (workspaceId: string, projectId: string, templateId: string) =>
      ['quota-templates', workspaceId, projectId, templateId] as const,
  },

  /** Project groups */
  projectGroups: {
    _def: ['project-groups'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['project-groups', workspaceId, projectId] as const,
  },

  /** Resource policy (access + rate/quota) */
  resourcePolicy: {
    _def: ['resource-policy'] as const,
    detail: (workspaceId: string, projectId: string, resourceType: string, resourceId: string) =>
      ['resource-policy', workspaceId, projectId, resourceType, resourceId] as const,
  },

  /** Project governance defaults */
  governanceDefaults: {
    _def: ['governance-defaults'] as const,
    detail: (workspaceId: string, projectId: string) =>
      ['governance-defaults', workspaceId, projectId] as const,
  },

  /** Sources (files) */
  sources: {
    _def: ['sources'] as const,
    list: (workspaceId: string, projectId: string, params?: object) =>
      ['sources', workspaceId, projectId, params] as const,
    detail: (workspaceId: string, projectId: string, fileId: string) =>
      ['source', workspaceId, projectId, fileId] as const,
  },

  /** Source libraries */
  sourceLibraries: {
    _def: ['source-libraries'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['source-libraries', workspaceId, projectId] as const,
  },

  /** Recipes (workbench) */
  recipes: {
    _def: ['recipes'] as const,
    list: (workspaceId: string, projectId: string, params?: object) =>
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
    _def: ['agents'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['agents', workspaceId, projectId] as const,
    keys: (workspaceId: string, projectId: string, agentId: string) =>
      ['agents', workspaceId, projectId, agentId, 'keys'] as const,
    diagnostics: (workspaceId: string, projectId: string, agentId: string) =>
      ['agents', workspaceId, projectId, agentId, 'diagnostics'] as const,
  },

  /** Endpoints */
  endpoints: {
    _def: ['endpoints'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['endpoints', workspaceId, projectId] as const,
  },

  /** Credentials */
  credentials: {
    _def: ['credentials'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['credentials', workspaceId, projectId] as const,
  },

  /** Audit logs */
  audit: {
    _def: ['audit'] as const,
    list: (workspaceId: string, projectId: string, params?: object) =>
      ['audit', workspaceId, projectId, params] as const,
  },

  /** Usage stats */
  usage: {
    _def: ['usage'] as const,
    kpi: (
      workspaceId: string,
      projectId: string,
      startTime: string,
      endTime: string,
      endUserId?: string,
    ) => ['usage-kpi', workspaceId, projectId, startTime, endTime, endUserId] as const,
    list: (workspaceId: string, projectId: string, params?: object) =>
      ['usage', workspaceId, projectId, params] as const,
  },

  /** User data */
  userdata: {
    _def: ['userdata'] as const,
    keys: () => ['user', 'keys'] as const,
    summary: (workspaceId: string, projectId: string) =>
      ['userdata', workspaceId, projectId, 'summary'] as const,
    endUsers: (workspaceId: string, projectId: string) =>
      ['userdata', workspaceId, projectId, 'end-users'] as const,
  },

  /** Chat sessions and messages */
  chat: {
    _def: ['chat'] as const,
    sessions: (workspaceId: string, projectId: string) =>
      ['chat', 'sessions', workspaceId, projectId] as const,
    messages: (workspaceId: string, projectId: string, sessionId: string) =>
      ['chat', 'messages', workspaceId, projectId, sessionId] as const,
    attachments: (workspaceId: string, projectId: string, sessionId: string) =>
      ['chat', 'attachments', workspaceId, projectId, sessionId] as const,
  },

  /** Quota */
  quota: {
    _def: ['quota'] as const,
    detail: (workspaceId: string, projectId: string) =>
      ['quota', workspaceId, projectId] as const,
  },
} as const;
