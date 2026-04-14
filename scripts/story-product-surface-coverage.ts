export type ProductSurfaceCoverage = {
  surfaceId: string;
  label: string;
  storyIds: readonly string[];
};

export const MAJOR_PRODUCT_SURFACE_COVERAGE: readonly ProductSurfaceCoverage[] = [
  {
    surfaceId: 'entry_and_identity',
    label: 'Entry and identity',
    storyIds: [
      'workspace-public-entry-and-login-truth',
      'desktop-auth-request-complete-and-work',
      'invite-to-first-effective-work',
      'workspace-identity-switch-truth',
    ],
  },
  {
    surfaceId: 'workspace_and_project_core',
    label: 'Workspace and project core',
    storyIds: [
      'workspace-entry-and-project-discovery',
      'project-surface-handoff-continuity',
      'workspace-publish-to-usable-access',
      'workspace-settings-save-and-effect',
    ],
  },
  {
    surfaceId: 'system_administration',
    label: 'System administration',
    storyIds: [
      'system-admin-entry',
      'system-admin-multi-workspace-handoff',
      'workspace-lifecycle-admin-operations',
    ],
  },
  {
    surfaceId: 'governance_and_membership',
    label: 'Governance and membership',
    storyIds: [
      'project-governance-onboarding',
      'project-governance-runtime-setup',
      'project-owner-daily-governance-review',
      'members-invite-and-chat-privacy',
      'membership-change-and-effective-access',
      'admin-switches-to-member-and-keeps-working',
      'governance-change-then-member-keeps-working',
      'resource-policy-change-to-observable-effect',
    ],
  },
  {
    surfaceId: 'chat_work',
    label: 'Chat work',
    storyIds: [
      'chat-conversation-continuity',
      'chat-day-two-thread-workflow',
    ],
  },
  {
    surfaceId: 'notebook_and_terminal_work',
    label: 'Notebook and terminal work',
    storyIds: [
      'notebook-first-success',
      'notebook-artifact-to-files-download',
      'notebook-terminal-workspace-multi-session',
      'notebook-terminal-reentry-recovery',
      'notebook-terminal-truth-unavailable-retry',
    ],
  },
  {
    surfaceId: 'files_and_context',
    label: 'Files and context continuity',
    storyIds: [
      'files-crud-and-sync',
      'files-library-access-and-recovery',
      'workspace-project-personal-context',
      'workspace-shared-context-continuity',
    ],
  },
  {
    surfaceId: 'connections_and_runtime_use',
    label: 'Connections and runtime use',
    storyIds: [
      'workspace-connections-to-project-use',
      'api-key-to-endpoint-consumption',
      'ai-runtime-failure-and-recovery',
      'use-guide-first-consumption',
    ],
  },
  {
    surfaceId: 'self_service_and_usage',
    label: 'Self service and usage',
    storyIds: [
      'personal-self-service-lifecycle',
      'usage-self-scope-review',
    ],
  },
] as const;
