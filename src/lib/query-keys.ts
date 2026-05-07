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

  /** Project groups */
  projectGroups: {
    _def: ['project-groups'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['project-groups', workspaceId, projectId] as const,
  },

  /** Resource policy (access + rate/spending) */
  resourcePolicy: {
    _def: ['resource-policy'] as const,
    detail: (workspaceId: string, projectId: string, resourceType: string, resourceId: string) =>
      ['resource-policy', workspaceId, projectId, resourceType, resourceId] as const,
  },

  governanceExplainability: {
    _def: ['governance-explainability'] as const,
    effectiveAccess: (workspaceId: string, projectId: string, memberId: string) =>
      ['governance-explainability', 'effective-access', workspaceId, projectId, memberId] as const,
  },

  /** Project governance defaults */
  governanceDefaults: {
    _def: ['governance-defaults'] as const,
    detail: (workspaceId: string, projectId: string) =>
      ['governance-defaults', workspaceId, projectId] as const,
  },

  /** Files */
  files: {
    _def: ['files'] as const,
    scope: (workspaceId: string, projectId: string) =>
      ['files', workspaceId, projectId] as const,
    list: (workspaceId: string, projectId: string, params?: object) =>
      ['files', workspaceId, projectId, params] as const,
    detail: (workspaceId: string, projectId: string, fileId: string) =>
      ['file', workspaceId, projectId, fileId] as const,
  },

  /** File libraries */
  fileLibraries: {
    _def: ['file-libraries'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['file-libraries', workspaceId, projectId] as const,
  },

  /** File objects (MinIO-like browser) */
  fileObjects: {
    _def: ['file-objects'] as const,
    list: (workspaceId: string, projectId: string, libraryId: string, params?: object) =>
      ['file-objects', workspaceId, projectId, libraryId, params] as const,
    meta: (workspaceId: string, projectId: string, libraryId: string, key: string) =>
      ['file-object-meta', workspaceId, projectId, libraryId, key] as const,
  },

  /** Agent tasks */
  tasks: {
    _def: ['tasks'] as const,
    scope: (workspaceId: string, projectId: string) =>
      ['tasks', workspaceId, projectId] as const,
    list: (workspaceId: string, projectId: string, params?: object) =>
      ['tasks', workspaceId, projectId, params] as const,
    detail: (workspaceId: string, projectId: string, taskId: string) =>
      ['task', workspaceId, projectId, taskId] as const,
    activity: (workspaceId: string, projectId: string, taskId: string) =>
      ['task-activity', workspaceId, projectId, taskId] as const,
    attachedFiles: (workspaceId: string, projectId: string, taskId: string) =>
      ['task-attached-files', workspaceId, projectId, taskId] as const,
    traces: (workspaceId: string, projectId: string, taskId: string, params?: object) =>
      ['task-traces', workspaceId, projectId, taskId, params] as const,
    artifacts: (workspaceId: string, projectId: string, taskId: string) =>
      ['task-artifacts', workspaceId, projectId, taskId] as const,
    runnerBindingOptions: (
      workspaceId: string,
      projectId: string,
    ) => ['task-runner-binding-options', workspaceId, projectId] as const,
  },

  /** Agent runners */
  agentRunners: {
    _def: ['agent-runners'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['agent-runners', workspaceId, projectId] as const,
    keys: (workspaceId: string, projectId: string, runnerId: string) =>
      ['agent-runners', workspaceId, projectId, runnerId, 'keys'] as const,
    diagnostics: (workspaceId: string, projectId: string, runnerId: string) =>
      ['agent-runners', workspaceId, projectId, runnerId, 'diagnostics'] as const,
  },

  /** Endpoints */
  endpoints: {
    _def: ['endpoints'] as const,
    list: (workspaceId: string, projectId: string) =>
      ['endpoints', workspaceId, projectId] as const,
    agentTaskModelSetting: (workspaceId: string, projectId: string) =>
      ['endpoints', 'agent-task-model-setting', workspaceId, projectId] as const,
  },

  /** Project pricing */
  projectPricing: {
    _def: ['project-pricing'] as const,
    detail: (workspaceId: string, projectId: string) =>
      ['project-pricing', workspaceId, projectId] as const,
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
    scope: (workspaceId: string, projectId: string) =>
      ['audit', workspaceId, projectId] as const,
    list: (workspaceId: string, projectId: string, params?: object) =>
      ['audit', workspaceId, projectId, params] as const,
  },

  /** Usage stats */
  usage: {
    _def: ['usage'] as const,
    scope: (workspaceId: string, projectId: string) =>
      ['usage', workspaceId, projectId] as const,
    list: (workspaceId: string, projectId: string, params?: object) =>
      ['usage', workspaceId, projectId, params] as const,
    facts: (workspaceId: string, projectId: string, params?: object) =>
      ['usage-facts', workspaceId, projectId, params] as const,
    timeseries: (workspaceId: string, projectId: string, params?: object) =>
      ['usage-timeseries', workspaceId, projectId, params] as const,
    operationsSummary: (workspaceId: string, projectId: string, params?: object) =>
      ['usage-operations-summary', workspaceId, projectId, params] as const,
    limitsSummary: (workspaceId: string, projectId: string, params?: object) =>
      ['usage-limits-summary', workspaceId, projectId, params] as const,
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

  /** Limit summary */
  limits: {
    _def: ['limits'] as const,
    detail: (workspaceId: string, projectId: string, libraryId?: string) =>
      ['limits', workspaceId, projectId, libraryId ?? 'all'] as const,
  },
} as const;
