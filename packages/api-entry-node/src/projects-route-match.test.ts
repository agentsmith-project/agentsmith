import { describe, expect, it } from 'vitest';
import { matchProjectsRoute } from './projects-route-match.js';

describe('matchProjectsRoute', () => {
  it('matches workspace and project collection routes', () => {
    expect(matchProjectsRoute('/api/v1/workspaces')).toEqual({ kind: 'workspacesCollection' });
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/directory/users?query=dev')).toEqual({
      kind: 'workspaceDirectoryUsers',
      workspaceId: 'ws_default',
    });
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/governable-projects')).toEqual({
      kind: 'workspaceGovernableProjects',
      workspaceId: 'ws_default',
    });
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects')).toEqual({
      kind: 'collection',
      workspaceId: 'ws_default',
    });
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1')).toEqual({
      kind: 'item',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/authorize')).toEqual({
      kind: 'projectAuthorize',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
  });

  it('matches chat stream and stop routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/s_1/messages/stream'),
    ).toEqual({
      kind: 'chatMessagesStream',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 's_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/s_1/messages/streams/st_1/stop'),
    ).toEqual({
      kind: 'chatMessagesStreamStop',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 's_1',
      streamId: 'st_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/s_1/messages/streams/st_1'),
    ).toEqual({
      kind: 'chatMessagesStreamAttach',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 's_1',
      streamId: 'st_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/s_1/stop'),
    ).toEqual({
      kind: 'chatSessionStop',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 's_1',
    });
  });

  it('matches endpoint proxy and import routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agent-task-model-setting'),
    ).toEqual({
      kind: 'agentTaskModelSetting',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/endpoints/import-bulk'),
    ).toEqual({
      kind: 'endpointImportBulk',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_1/proxy/openai/chat/completions'),
    ).toEqual({
      kind: 'endpointProxy',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_1',
      proxyPath: 'openai/chat/completions',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_1/rerank'),
    ).toEqual({
      kind: 'endpointRerank',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_1/images/generations'),
    ).toEqual({
      kind: 'endpointImageGeneration',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_1/videos/generations'),
    ).toEqual({
      kind: 'endpointVideoGenerationCreate',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_1/videos/generations/job_1'),
    ).toEqual({
      kind: 'endpointVideoGenerationPoll',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_1',
      jobId: 'job_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_1/videos/generations/job_1/cancel'),
    ).toEqual({
      kind: 'endpointVideoGenerationCancel',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_1',
      jobId: 'job_1',
    });
  });

  it('matches retained execution and model-config routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/llm/chat/completions'),
    ).toEqual({
      kind: 'llmUnifiedChat',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/anthropic/messages'),
    ).toEqual({
      kind: 'llmGatewayProxy',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      proxyPath: 'anthropic/messages',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/project-pricing'),
    ).toEqual({
      kind: 'projectPricing',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/model-catalog/providers'),
    ).toEqual({
      kind: 'modelCatalogProviders',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/model-catalog/models'),
    ).toEqual({
      kind: 'modelCatalogModels',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/model-catalog/sync'),
    ).toEqual({
      kind: 'modelCatalogSync',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
  });

  it('matches file-library save point, direct restore, and task file template routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/save-points'),
    ).toEqual({
      kind: 'fileLibrarySavePoints',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/restore'),
    ).toEqual({
      kind: 'fileLibraryRestore',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/operations/active'),
    ).toEqual({
      kind: 'fileLibraryActiveOperation',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_1',
    });

    expect(matchProjectsRoute(
      `/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/restore-${'preview'}`,
    )).toBeNull();
    expect(matchProjectsRoute(
      `/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/restore-${'run'}`,
    )).toBeNull();
    expect(matchProjectsRoute(
      `/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/restore-${'cancel'}`,
    )).toBeNull();

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-library-operations/op_repo_create'),
    ).toEqual({
      kind: 'fileLibraryOperation',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: 'op_repo_create',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/task-file-templates'),
    ).toEqual({
      kind: 'taskFileTemplates',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/task-file-templates/tftpl_1/publish'),
    ).toEqual({
      kind: 'taskFileTemplatePublish',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskFileTemplateId: 'tftpl_1',
    });
  });
  it('matches agent runner management and key routes only on the canonical public namespace', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agent-runners'),
    ).toEqual({
      kind: 'agents',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agent-runners/ag_1'),
    ).toEqual({
      kind: 'agentItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'ag_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agent-runners/ag_1/connection-info'),
    ).toEqual({
      kind: 'agentConnectionInfo',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'ag_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agent-runners/ag_1/keys/key_1'),
    ).toEqual({
      kind: 'agentKeyItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'ag_1',
      keyId: 'key_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agent-runners/ag_1/test-connection'),
    ).toEqual({
      kind: 'agentTestConnection',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'ag_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agent-runners/ag_1/test-task-runs'),
    ).toEqual({
      kind: 'agentTestTaskRuns',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'ag_1',
    });

    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agents')).toBeNull();
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agents/ag_1')).toBeNull();
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agents/ag_1/keys')).toBeNull();
  });

  it('matches file library control plane and browser routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries'),
    ).toEqual({
      kind: 'fileLibraries',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/lib_1'),
    ).toEqual({
      kind: 'fileLibraryItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/lib_1/entries'),
    ).toEqual({
      kind: 'fileLibraryEntries',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/lib_1/folders'),
    ).toEqual({
      kind: 'fileLibraryFolders',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/lib_1/delete'),
    ).toEqual({
      kind: 'fileLibraryDelete',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/lib_1/move'),
    ).toEqual({
      kind: 'fileLibraryMove',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/lib_1/upload'),
    ).toEqual({
      kind: 'fileLibraryUpload',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/lib_1/download'),
    ).toEqual({
      kind: 'fileLibraryDownload',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/lib_1/meta'),
    ).toEqual({
      kind: 'fileLibraryMeta',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
  });

  it('matches file library control plane routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries'),
    ).toEqual({
      kind: 'fileLibraries',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1'),
    ).toEqual({
      kind: 'fileLibraryItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/entries'),
    ).toEqual({
      kind: 'fileLibraryEntries',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/folders'),
    ).toEqual({
      kind: 'fileLibraryFolders',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/delete'),
    ).toEqual({
      kind: 'fileLibraryDelete',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/move'),
    ).toEqual({
      kind: 'fileLibraryMove',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/runtime-access/release'),
    ).toEqual({
      kind: 'fileLibraryRuntimeAccessRelease',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_1',
    });
  });

  it('does not match removed file library connector routes', () => {
    for (const path of [
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/lib_1/backend',
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/lib_1/storage-credential-exchange',
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/lib_1/desktop-mount-access',
    ]) {
      expect(matchProjectsRoute(path)).toBeNull();
    }
  });

  it('matches project members governance read routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/members'),
    ).toEqual({
      kind: 'projectMembers',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/join-requests'),
    ).toEqual({
      kind: 'projectJoinRequests',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/invites'),
    ).toEqual({
      kind: 'projectInvites',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/permission-templates'),
    ).toEqual({
      kind: 'projectPermissionTemplates',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/permission-templates/pt_1'),
    ).toEqual({
      kind: 'projectPermissionTemplateItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      templateId: 'pt_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/groups'),
    ).toEqual({
      kind: 'projectGroups',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/memberships/user_test'),
    ).toEqual({
      kind: 'projectMembershipItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      userId: 'user_test',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/members/user_test/permissions'),
    ).toEqual({
      kind: 'projectMemberPermissions',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      userId: 'user_test',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/members/user_test/change-history'),
    ).toEqual({
      kind: 'projectMemberChangeHistory',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      userId: 'user_test',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/ep_1/policy'),
    ).toEqual({
      kind: 'projectResourcePolicy',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      resourceType: 'endpoint',
      resourceId: 'ep_1',
    });
  });

  it('matches project members governance write routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/join-requests/jr_1/approve'),
    ).toEqual({
      kind: 'projectJoinRequestApprove',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      joinId: 'jr_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/join-requests/jr_1/reject'),
    ).toEqual({
      kind: 'projectJoinRequestReject',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      joinId: 'jr_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/groups/grp_1'),
    ).toEqual({
      kind: 'projectGroupItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      groupId: 'grp_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/groups/grp_1/apply-template'),
    ).toEqual({
      kind: 'projectGroupApplyTemplate',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      groupId: 'grp_1',
    });
  });

  it('matches audit and usage routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/audit'),
    ).toEqual({
      kind: 'audit',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage'),
    ).toEqual({
      kind: 'usage',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/facts'),
    ).toEqual({
      kind: 'usageFacts',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/timeseries'),
    ).toEqual({
      kind: 'usageTimeseries',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/records-summary'),
    ).toEqual({
      kind: 'usageRecordsSummary',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/operations-summary'),
    ).toEqual({
      kind: 'usageOperationsSummary',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/limits/summary'),
    ).toEqual({
      kind: 'limitsSummary',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
  });

  it('matches notebook task cancel route', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/cancel'),
    ).toEqual({
      kind: 'taskCancelRun',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
    });
  });

  it('matches notebook task workspace access route', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/workspace-access'),
    ).toEqual({
      kind: 'taskWorkspaceAccess',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
    });
  });

  it('matches notebook task workspace access release route', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/workspace-access/release'),
    ).toEqual({
      kind: 'taskWorkspaceAccessRelease',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
    });
  });

  it('matches notebook task terminal session collection route', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/terminal/sessions'),
    ).toEqual({
      kind: 'taskTerminalSessions',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
    });
  });

  it('matches notebook task terminal session item route', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/terminal/sessions/term_1'),
    ).toEqual({
      kind: 'taskTerminalSession',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      terminalSessionId: 'term_1',
    });
  });

  it('matches Agent Task activity and run routes without exposing legacy task messages', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/activity'),
    ).toEqual({
      kind: 'taskActivity',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/runs'),
    ).toEqual({
      kind: 'taskRuns',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/tasks/runner-binding-options'),
    ).toEqual({
      kind: 'taskRunnerBindingOptions',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/run-selection-snapshot?selected_agent_runner_id=ag_1'),
    ).toBeNull();

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/messages'),
    ).toBeNull();
  });

  it('returns null for unknown route', () => {
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/unknown')).toBeNull();
  });
});
