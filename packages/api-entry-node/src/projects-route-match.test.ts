import { describe, expect, it } from 'vitest';
import { matchProjectsRoute } from './projects-route-match.js';

describe('matchProjectsRoute', () => {
  it('matches workspace and project collection routes', () => {
    expect(matchProjectsRoute('/api/v1/workspaces')).toEqual({ kind: 'workspacesCollection' });
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects')).toEqual({
      kind: 'collection',
      workspaceId: 'ws_default',
    });
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1')).toEqual({
      kind: 'item',
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
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/endpoints/import-openai-compatible'),
    ).toEqual({
      kind: 'endpointImportOpenAICompatible',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });

    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_1/proxy/chat/completions'),
    ).toEqual({
      kind: 'endpointProxy',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_1',
      proxyPath: 'chat/completions',
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

  it('matches agent management and key routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agents'),
    ).toEqual({
      kind: 'agents',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agents/ag_1'),
    ).toEqual({
      kind: 'agentItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'ag_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agents/ag_1/connection-info'),
    ).toEqual({
      kind: 'agentConnectionInfo',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'ag_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/agents/ag_1/keys/key_1'),
    ).toEqual({
      kind: 'agentKeyItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'ag_1',
      keyId: 'key_1',
    });
  });

  it('matches source library object browser routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/default-personal'),
    ).toEqual({
      kind: 'sourceLibrariesDefaultPersonal',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects'),
    ).toEqual({
      kind: 'sourceLibraryObjects',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/folders'),
    ).toEqual({
      kind: 'sourceLibraryFolders',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects/upload'),
    ).toEqual({
      kind: 'sourceLibraryObjectsUpload',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects/download'),
    ).toEqual({
      kind: 'sourceLibraryObjectsDownload',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects/delete'),
    ).toEqual({
      kind: 'sourceLibraryObjectsDelete',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects/move'),
    ).toEqual({
      kind: 'sourceLibraryObjectsMove',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects/meta'),
    ).toEqual({
      kind: 'sourceLibraryObjectsMeta',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/lib_1/objects/share-link'),
    ).toEqual({
      kind: 'sourceLibraryObjectsShareLink',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'lib_1',
    });
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
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/quota-templates'),
    ).toEqual({
      kind: 'projectQuotaTemplates',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
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
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/kpi'),
    ).toEqual({
      kind: 'usageKpi',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
  });

  it('returns null for unknown route', () => {
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/unknown')).toBeNull();
  });
});
