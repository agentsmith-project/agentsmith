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

  it('matches runtime routing and unified chat routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/llm/chat/completions'),
    ).toEqual({
      kind: 'llmUnifiedChat',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/v1/messages'),
    ).toEqual({
      kind: 'llmGatewayProxy',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      proxyPath: 'v1/messages',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/providers'),
    ).toEqual({
      kind: 'runtimeProviders',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/providers/prov_1'),
    ).toEqual({
      kind: 'runtimeProviderItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      providerConnectionId: 'prov_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/models'),
    ).toEqual({
      kind: 'runtimeModels',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/providers/openai/models/gpt-4o'),
    ).toEqual({
      kind: 'runtimeModelItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      provider: 'openai',
      modelId: 'gpt-4o',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/routing/aliases'),
    ).toEqual({
      kind: 'runtimeRoutingAliases',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/routing/dry-run'),
    ).toEqual({
      kind: 'runtimeRoutingDryRun',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/impact-preview'),
    ).toEqual({
      kind: 'runtimeImpactPreview',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/routing/aliases/assistant-main/publish'),
    ).toEqual({
      kind: 'runtimeRoutingAliasPublish',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      alias: 'assistant-main',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/routing/aliases/assistant-main'),
    ).toEqual({
      kind: 'runtimeRoutingAliasItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      alias: 'assistant-main',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/routing/combos'),
    ).toEqual({
      kind: 'runtimeRoutingCombos',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/routing/combos/prod-chat/publish'),
    ).toEqual({
      kind: 'runtimeRoutingComboPublish',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      combo: 'prod-chat',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/routing/combos/prod-chat'),
    ).toEqual({
      kind: 'runtimeRoutingComboItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      combo: 'prod-chat',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/pricing'),
    ).toEqual({
      kind: 'runtimePricing',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/pricing/versions'),
    ).toEqual({
      kind: 'runtimePricingVersions',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/pricing/versions/rpv_1/activate'),
    ).toEqual({
      kind: 'runtimePricingVersionActivate',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      pricingVersionId: 'rpv_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/pricing/compare'),
    ).toEqual({
      kind: 'runtimePricingCompare',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/catalog/providers'),
    ).toEqual({
      kind: 'runtimeCatalogProviders',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/catalog/models'),
    ).toEqual({
      kind: 'runtimeCatalogModels',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/catalog/sync'),
    ).toEqual({
      kind: 'runtimeCatalogSync',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/catalog/jobs'),
    ).toEqual({
      kind: 'runtimeCatalogJobs',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/runtime/catalog/status'),
    ).toEqual({
      kind: 'runtimeCatalogStatus',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
  });

  it('matches usage report lifecycle routes', () => {
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/report-schedules/run-due'),
    ).toEqual({
      kind: 'usageReportSchedulesRunDue',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/report-evidence'),
    ).toEqual({
      kind: 'usageReportEvidence',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/report-schedules/sched_1/run-now'),
    ).toEqual({
      kind: 'usageReportScheduleRunNow',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      scheduleId: 'sched_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/report-schedules/sched_1/deliveries/dlv_1/retry'),
    ).toEqual({
      kind: 'usageReportScheduleDeliveryRetry',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      scheduleId: 'sched_1',
      deliveryId: 'dlv_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/report-schedules/sched_1/deliveries/dlv_1/acknowledge'),
    ).toEqual({
      kind: 'usageReportScheduleDeliveryAcknowledge',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      scheduleId: 'sched_1',
      deliveryId: 'dlv_1',
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
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/kpi'),
    ).toEqual({
      kind: 'usageKpi',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/export'),
    ).toEqual({
      kind: 'usageExport',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/report-schedules'),
    ).toEqual({
      kind: 'usageReportSchedules',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/report-schedules/sch_1'),
    ).toEqual({
      kind: 'usageReportScheduleItem',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      scheduleId: 'sch_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/report-schedules/sch_1/test-delivery'),
    ).toEqual({
      kind: 'usageReportScheduleTestDelivery',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      scheduleId: 'sch_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/timeseries'),
    ).toEqual({
      kind: 'usageTimeseries',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(
      matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/usage/runtime-observability'),
    ).toEqual({
      kind: 'usageRuntimeObservability',
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

  it('returns null for unknown route', () => {
    expect(matchProjectsRoute('/api/v1/workspaces/ws_default/projects/proj_1/unknown')).toBeNull();
  });
});
