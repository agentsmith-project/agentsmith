import { matchChatRoute, type ChatRoute } from './chat-route-match.js';

export type ProjectsRoute =
  | { kind: 'workspacesCollection' }
  | { kind: 'workspaceItem'; workspaceId: string }
  | { kind: 'workspaceMembers'; workspaceId: string }
  | { kind: 'workspaceProjectCreators'; workspaceId: string }
  | { kind: 'workspaceDirectoryUsers'; workspaceId: string }
  | { kind: 'workspaceFeishuSettings'; workspaceId: string }
  | { kind: 'workspaceFeishuVerifyStart'; workspaceId: string }
  | { kind: 'workspaceFeishuEnable'; workspaceId: string }
  | { kind: 'workspaceFeishuOAuthComplete'; workspaceId: string }
  | { kind: 'workspaceFeishuUserAuthStart'; workspaceId: string }
  | { kind: 'collection'; workspaceId: string }
  | { kind: 'item'; workspaceId: string; projectId: string }
  | { kind: 'projectAuthorize'; workspaceId: string; projectId: string }
  | { kind: 'fileLibraries'; workspaceId: string; projectId: string }
  | { kind: 'fileLibraryItem'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryBackend'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryStorageCredentialExchange'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryDesktopMountAccess'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryEntries'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryFolders'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryDelete'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryMove'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryUpload'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryDownload'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryMeta'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryShareLink'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'tasks'; workspaceId: string; projectId: string }
  | { kind: 'taskItem'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskWorkspaceAccess'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskInputs'; workspaceId: string; projectId: string; taskId: string }
  | {
    kind: 'taskInputItem';
    workspaceId: string;
    projectId: string;
    taskId: string;
    inputId: string;
  }
  | { kind: 'taskMessages'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskCancelRun'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskTraces'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskArtifacts'; workspaceId: string; projectId: string; taskId: string }
  | {
    kind: 'taskArtifactDownload';
    workspaceId: string;
    projectId: string;
    taskId: string;
    artifactId: string;
  }
  | { kind: 'taskEvents'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'audit'; workspaceId: string; projectId: string }
  | { kind: 'usage'; workspaceId: string; projectId: string }
  | { kind: 'usageFacts'; workspaceId: string; projectId: string }
  | { kind: 'usageTimeseries'; workspaceId: string; projectId: string }
  | { kind: 'usageRecordsSummary'; workspaceId: string; projectId: string }
  | { kind: 'usageOperationsSummary'; workspaceId: string; projectId: string }
  | { kind: 'limitsSummary'; workspaceId: string; projectId: string }
  | { kind: 'projectMembers'; workspaceId: string; projectId: string }
  | { kind: 'projectInvites'; workspaceId: string; projectId: string }
  | { kind: 'projectJoinRequests'; workspaceId: string; projectId: string }
  | { kind: 'projectJoinRequestApprove'; workspaceId: string; projectId: string; joinId: string }
  | { kind: 'projectJoinRequestReject'; workspaceId: string; projectId: string; joinId: string }
  | { kind: 'projectPermissionTemplates'; workspaceId: string; projectId: string }
  | { kind: 'projectPermissionTemplateItem'; workspaceId: string; projectId: string; templateId: string }
  | { kind: 'projectGroups'; workspaceId: string; projectId: string }
  | { kind: 'projectGroupItem'; workspaceId: string; projectId: string; groupId: string }
  | { kind: 'projectGroupApplyTemplate'; workspaceId: string; projectId: string; groupId: string }
  | { kind: 'projectMembershipItem'; workspaceId: string; projectId: string; userId: string }
  | { kind: 'projectMemberPermissions'; workspaceId: string; projectId: string; userId: string }
  | { kind: 'projectMemberChangeHistory'; workspaceId: string; projectId: string; userId: string }
  | {
    kind: 'projectResourcePolicy';
    workspaceId: string;
    projectId: string;
    resourceType: string;
    resourceId: string;
  }
  | ChatRoute
  | { kind: 'agents'; workspaceId: string; projectId: string }
  | { kind: 'agentItem'; workspaceId: string; projectId: string; agentId: string }
  | { kind: 'agentDiagnostics'; workspaceId: string; projectId: string; agentId: string }
  | { kind: 'agentExecutionConfig'; workspaceId: string; projectId: string; agentId: string }
  | { kind: 'agentConnectionInfo'; workspaceId: string; projectId: string; agentId: string }
  | { kind: 'agentKeys'; workspaceId: string; projectId: string; agentId: string }
  | {
    kind: 'agentKeyItem';
    workspaceId: string;
    projectId: string;
    agentId: string;
    keyId: string;
  }
  | { kind: 'endpoints'; workspaceId: string; projectId: string }
  | { kind: 'endpointItem'; workspaceId: string; projectId: string; endpointId: string }
  | { kind: 'endpointRerank'; workspaceId: string; projectId: string; endpointId: string }
  | { kind: 'endpointImageGeneration'; workspaceId: string; projectId: string; endpointId: string }
  | { kind: 'endpointVideoGenerationCreate'; workspaceId: string; projectId: string; endpointId: string }
  | { kind: 'endpointVideoGenerationPoll'; workspaceId: string; projectId: string; endpointId: string; jobId: string }
  | { kind: 'endpointVideoGenerationCancel'; workspaceId: string; projectId: string; endpointId: string; jobId: string }
  | {
    kind: 'endpointProxy';
    workspaceId: string;
    projectId: string;
    endpointId: string;
    proxyPath: string;
  }
  | {
    kind: 'llmGatewayProxy';
    workspaceId: string;
    projectId: string;
    proxyPath: string;
  }
  | { kind: 'endpointImportOpenAICompatible'; workspaceId: string; projectId: string }
  | { kind: 'llmUnifiedChat'; workspaceId: string; projectId: string }
  | { kind: 'projectPricing'; workspaceId: string; projectId: string }
  | { kind: 'modelCatalogProviders'; workspaceId: string; projectId: string }
  | { kind: 'modelCatalogModels'; workspaceId: string; projectId: string }
  | { kind: 'modelCatalogSync'; workspaceId: string; projectId: string }
  | { kind: 'credentials'; workspaceId: string; projectId: string }
  | { kind: 'credentialItem'; workspaceId: string; projectId: string; credentialId: string }
  | { kind: 'credentialRotate'; workspaceId: string; projectId: string; credentialId: string };

export function matchProjectsRoute(url: string): ProjectsRoute | null {
  const pathname = new URL(url, 'http://localhost').pathname;
  if (pathname === '/api/v1/workspaces' || pathname === '/api/v1/workspaces/') {
    return { kind: 'workspacesCollection' };
  }

  const workspaceItemMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/?$/);
  if (workspaceItemMatched) {
    return {
      kind: 'workspaceItem',
      workspaceId: decodeURIComponent(workspaceItemMatched[1]),
    };
  }

  const workspaceMembersMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/members\/?$/);
  if (workspaceMembersMatched) {
    return {
      kind: 'workspaceMembers',
      workspaceId: decodeURIComponent(workspaceMembersMatched[1]),
    };
  }

  const workspaceProjectCreatorsMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/project-creators\/?$/);
  if (workspaceProjectCreatorsMatched) {
    return {
      kind: 'workspaceProjectCreators',
      workspaceId: decodeURIComponent(workspaceProjectCreatorsMatched[1]),
    };
  }

  const workspaceDirectoryUsersMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/directory\/users\/?$/);
  if (workspaceDirectoryUsersMatched) {
    return {
      kind: 'workspaceDirectoryUsers',
      workspaceId: decodeURIComponent(workspaceDirectoryUsersMatched[1]),
    };
  }

  const workspaceFeishuSettingsMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/integrations\/feishu\/?$/);
  if (workspaceFeishuSettingsMatched) {
    return {
      kind: 'workspaceFeishuSettings',
      workspaceId: decodeURIComponent(workspaceFeishuSettingsMatched[1]),
    };
  }

  const workspaceFeishuVerifyStartMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/integrations\/feishu\/verify\/start\/?$/);
  if (workspaceFeishuVerifyStartMatched) {
    return {
      kind: 'workspaceFeishuVerifyStart',
      workspaceId: decodeURIComponent(workspaceFeishuVerifyStartMatched[1]),
    };
  }

  const workspaceFeishuEnableMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/integrations\/feishu\/enable\/?$/);
  if (workspaceFeishuEnableMatched) {
    return {
      kind: 'workspaceFeishuEnable',
      workspaceId: decodeURIComponent(workspaceFeishuEnableMatched[1]),
    };
  }

  const workspaceFeishuOAuthCompleteMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/feishu\/oauth\/complete\/?$/);
  if (workspaceFeishuOAuthCompleteMatched) {
    return {
      kind: 'workspaceFeishuOAuthComplete',
      workspaceId: decodeURIComponent(workspaceFeishuOAuthCompleteMatched[1]),
    };
  }

  const workspaceFeishuUserAuthStartMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/me\/feishu\/auth\/start\/?$/);
  if (workspaceFeishuUserAuthStartMatched) {
    return {
      kind: 'workspaceFeishuUserAuthStart',
      workspaceId: decodeURIComponent(workspaceFeishuUserAuthStartMatched[1]),
    };
  }

  const collectionMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/?$/);
  if (collectionMatched) {
    return { kind: 'collection', workspaceId: decodeURIComponent(collectionMatched[1]) };
  }

  const itemMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/?$/);
  if (itemMatched) {
    return {
      kind: 'item',
      workspaceId: decodeURIComponent(itemMatched[1]),
      projectId: decodeURIComponent(itemMatched[2]),
    };
  }

  const fileLibraryDesktopMountAccessMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/desktop-mount-access\/?$/,
  );
  if (fileLibraryDesktopMountAccessMatched) {
    return {
      kind: 'fileLibraryDesktopMountAccess',
      workspaceId: decodeURIComponent(fileLibraryDesktopMountAccessMatched[1]),
      projectId: decodeURIComponent(fileLibraryDesktopMountAccessMatched[2]),
      libraryId: decodeURIComponent(fileLibraryDesktopMountAccessMatched[3]),
    };
  }

  const projectAuthorizeMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/authorize\/?$/);
  if (projectAuthorizeMatched) {
    return {
      kind: 'projectAuthorize',
      workspaceId: decodeURIComponent(projectAuthorizeMatched[1]),
      projectId: decodeURIComponent(projectAuthorizeMatched[2]),
    };
  }

  const fileLibrariesMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/?$/);
  if (fileLibrariesMatched) {
    return {
      kind: 'fileLibraries',
      workspaceId: decodeURIComponent(fileLibrariesMatched[1]),
      projectId: decodeURIComponent(fileLibrariesMatched[2]),
    };
  }

  const fileLibraryItemMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/?$/);
  if (fileLibraryItemMatched) {
    return {
      kind: 'fileLibraryItem',
      workspaceId: decodeURIComponent(fileLibraryItemMatched[1]),
      projectId: decodeURIComponent(fileLibraryItemMatched[2]),
      libraryId: decodeURIComponent(fileLibraryItemMatched[3]),
    };
  }

  const fileLibraryBackendMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/backend\/?$/);
  if (fileLibraryBackendMatched) {
    return {
      kind: 'fileLibraryBackend',
      workspaceId: decodeURIComponent(fileLibraryBackendMatched[1]),
      projectId: decodeURIComponent(fileLibraryBackendMatched[2]),
      libraryId: decodeURIComponent(fileLibraryBackendMatched[3]),
    };
  }

  const fileLibraryStorageCredentialExchangeMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/storage-credential-exchange\/?$/,
  );
  if (fileLibraryStorageCredentialExchangeMatched) {
    return {
      kind: 'fileLibraryStorageCredentialExchange',
      workspaceId: decodeURIComponent(fileLibraryStorageCredentialExchangeMatched[1]),
      projectId: decodeURIComponent(fileLibraryStorageCredentialExchangeMatched[2]),
      libraryId: decodeURIComponent(fileLibraryStorageCredentialExchangeMatched[3]),
    };
  }

  const fileLibraryEntriesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/entries\/?$/,
  );
  if (fileLibraryEntriesMatched) {
    return {
      kind: 'fileLibraryEntries',
      workspaceId: decodeURIComponent(fileLibraryEntriesMatched[1]),
      projectId: decodeURIComponent(fileLibraryEntriesMatched[2]),
      libraryId: decodeURIComponent(fileLibraryEntriesMatched[3]),
    };
  }

  const fileLibraryFoldersMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/folders\/?$/,
  );
  if (fileLibraryFoldersMatched) {
    return {
      kind: 'fileLibraryFolders',
      workspaceId: decodeURIComponent(fileLibraryFoldersMatched[1]),
      projectId: decodeURIComponent(fileLibraryFoldersMatched[2]),
      libraryId: decodeURIComponent(fileLibraryFoldersMatched[3]),
    };
  }

  const fileLibraryDeleteMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/delete\/?$/,
  );
  if (fileLibraryDeleteMatched) {
    return {
      kind: 'fileLibraryDelete',
      workspaceId: decodeURIComponent(fileLibraryDeleteMatched[1]),
      projectId: decodeURIComponent(fileLibraryDeleteMatched[2]),
      libraryId: decodeURIComponent(fileLibraryDeleteMatched[3]),
    };
  }

  const fileLibraryMoveMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/move\/?$/,
  );
  if (fileLibraryMoveMatched) {
    return {
      kind: 'fileLibraryMove',
      workspaceId: decodeURIComponent(fileLibraryMoveMatched[1]),
      projectId: decodeURIComponent(fileLibraryMoveMatched[2]),
      libraryId: decodeURIComponent(fileLibraryMoveMatched[3]),
    };
  }

  const fileLibraryUploadMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/upload\/?$/,
  );
  if (fileLibraryUploadMatched) {
    return {
      kind: 'fileLibraryUpload',
      workspaceId: decodeURIComponent(fileLibraryUploadMatched[1]),
      projectId: decodeURIComponent(fileLibraryUploadMatched[2]),
      libraryId: decodeURIComponent(fileLibraryUploadMatched[3]),
    };
  }

  const fileLibraryDownloadMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/download\/?$/,
  );
  if (fileLibraryDownloadMatched) {
    return {
      kind: 'fileLibraryDownload',
      workspaceId: decodeURIComponent(fileLibraryDownloadMatched[1]),
      projectId: decodeURIComponent(fileLibraryDownloadMatched[2]),
      libraryId: decodeURIComponent(fileLibraryDownloadMatched[3]),
    };
  }

  const fileLibraryMetaMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/meta\/?$/,
  );
  if (fileLibraryMetaMatched) {
    return {
      kind: 'fileLibraryMeta',
      workspaceId: decodeURIComponent(fileLibraryMetaMatched[1]),
      projectId: decodeURIComponent(fileLibraryMetaMatched[2]),
      libraryId: decodeURIComponent(fileLibraryMetaMatched[3]),
    };
  }

  const fileLibraryShareLinkMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/share-link\/?$/,
  );
  if (fileLibraryShareLinkMatched) {
    return {
      kind: 'fileLibraryShareLink',
      workspaceId: decodeURIComponent(fileLibraryShareLinkMatched[1]),
      projectId: decodeURIComponent(fileLibraryShareLinkMatched[2]),
      libraryId: decodeURIComponent(fileLibraryShareLinkMatched[3]),
    };
  }

  const auditMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/audit\/?$/);
  if (auditMatched) {
    return {
      kind: 'audit',
      workspaceId: decodeURIComponent(auditMatched[1]),
      projectId: decodeURIComponent(auditMatched[2]),
    };
  }

  const usageMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/usage\/?$/);
  if (usageMatched) {
    return {
      kind: 'usage',
      workspaceId: decodeURIComponent(usageMatched[1]),
      projectId: decodeURIComponent(usageMatched[2]),
    };
  }

  const usageFactsMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/usage\/facts\/?$/);
  if (usageFactsMatched) {
    return {
      kind: 'usageFacts',
      workspaceId: decodeURIComponent(usageFactsMatched[1]),
      projectId: decodeURIComponent(usageFactsMatched[2]),
    };
  }

  const usageTimeseriesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/usage\/timeseries\/?$/,
  );
  if (usageTimeseriesMatched) {
    return {
      kind: 'usageTimeseries',
      workspaceId: decodeURIComponent(usageTimeseriesMatched[1]),
      projectId: decodeURIComponent(usageTimeseriesMatched[2]),
    };
  }

  const usageRecordsSummaryMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/usage\/records-summary\/?$/,
  );
  if (usageRecordsSummaryMatched) {
    return {
      kind: 'usageRecordsSummary',
      workspaceId: decodeURIComponent(usageRecordsSummaryMatched[1]),
      projectId: decodeURIComponent(usageRecordsSummaryMatched[2]),
    };
  }

  const usageOperationsSummaryMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/usage\/operations-summary\/?$/,
  );
  if (usageOperationsSummaryMatched) {
    return {
      kind: 'usageOperationsSummary',
      workspaceId: decodeURIComponent(usageOperationsSummaryMatched[1]),
      projectId: decodeURIComponent(usageOperationsSummaryMatched[2]),
    };
  }

  const limitsSummaryMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/limits\/summary\/?$/,
  );
  if (limitsSummaryMatched) {
    return {
      kind: 'limitsSummary',
      workspaceId: decodeURIComponent(limitsSummaryMatched[1]),
      projectId: decodeURIComponent(limitsSummaryMatched[2]),
    };
  }

  const projectMembersMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/members\/?$/);
  if (projectMembersMatched) {
    return {
      kind: 'projectMembers',
      workspaceId: decodeURIComponent(projectMembersMatched[1]),
      projectId: decodeURIComponent(projectMembersMatched[2]),
    };
  }

  const projectInvitesMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/invites\/?$/);
  if (projectInvitesMatched) {
    return {
      kind: 'projectInvites',
      workspaceId: decodeURIComponent(projectInvitesMatched[1]),
      projectId: decodeURIComponent(projectInvitesMatched[2]),
    };
  }

  const projectJoinRequestsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/join-requests\/?$/,
  );
  if (projectJoinRequestsMatched) {
    return {
      kind: 'projectJoinRequests',
      workspaceId: decodeURIComponent(projectJoinRequestsMatched[1]),
      projectId: decodeURIComponent(projectJoinRequestsMatched[2]),
    };
  }

  const projectJoinRequestApproveMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/join-requests\/([^/]+)\/approve\/?$/,
  );
  if (projectJoinRequestApproveMatched) {
    return {
      kind: 'projectJoinRequestApprove',
      workspaceId: decodeURIComponent(projectJoinRequestApproveMatched[1]),
      projectId: decodeURIComponent(projectJoinRequestApproveMatched[2]),
      joinId: decodeURIComponent(projectJoinRequestApproveMatched[3]),
    };
  }

  const projectJoinRequestRejectMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/join-requests\/([^/]+)\/reject\/?$/,
  );
  if (projectJoinRequestRejectMatched) {
    return {
      kind: 'projectJoinRequestReject',
      workspaceId: decodeURIComponent(projectJoinRequestRejectMatched[1]),
      projectId: decodeURIComponent(projectJoinRequestRejectMatched[2]),
      joinId: decodeURIComponent(projectJoinRequestRejectMatched[3]),
    };
  }

  const projectPermissionTemplatesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/permission-templates\/?$/,
  );
  if (projectPermissionTemplatesMatched) {
    return {
      kind: 'projectPermissionTemplates',
      workspaceId: decodeURIComponent(projectPermissionTemplatesMatched[1]),
      projectId: decodeURIComponent(projectPermissionTemplatesMatched[2]),
    };
  }

  const projectPermissionTemplateItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/permission-templates\/([^/]+)\/?$/,
  );
  if (projectPermissionTemplateItemMatched) {
    return {
      kind: 'projectPermissionTemplateItem',
      workspaceId: decodeURIComponent(projectPermissionTemplateItemMatched[1]),
      projectId: decodeURIComponent(projectPermissionTemplateItemMatched[2]),
      templateId: decodeURIComponent(projectPermissionTemplateItemMatched[3]),
    };
  }


  const projectGroupsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/groups\/?$/,
  );
  if (projectGroupsMatched) {
    return {
      kind: 'projectGroups',
      workspaceId: decodeURIComponent(projectGroupsMatched[1]),
      projectId: decodeURIComponent(projectGroupsMatched[2]),
    };
  }

  const projectGroupApplyTemplateMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/groups\/([^/]+)\/apply-template\/?$/,
  );
  if (projectGroupApplyTemplateMatched) {
    return {
      kind: 'projectGroupApplyTemplate',
      workspaceId: decodeURIComponent(projectGroupApplyTemplateMatched[1]),
      projectId: decodeURIComponent(projectGroupApplyTemplateMatched[2]),
      groupId: decodeURIComponent(projectGroupApplyTemplateMatched[3]),
    };
  }

  const projectGroupItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/groups\/([^/]+)\/?$/,
  );
  if (projectGroupItemMatched) {
    return {
      kind: 'projectGroupItem',
      workspaceId: decodeURIComponent(projectGroupItemMatched[1]),
      projectId: decodeURIComponent(projectGroupItemMatched[2]),
      groupId: decodeURIComponent(projectGroupItemMatched[3]),
    };
  }

  const projectMembershipItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/memberships\/([^/]+)\/?$/,
  );
  if (projectMembershipItemMatched) {
    return {
      kind: 'projectMembershipItem',
      workspaceId: decodeURIComponent(projectMembershipItemMatched[1]),
      projectId: decodeURIComponent(projectMembershipItemMatched[2]),
      userId: decodeURIComponent(projectMembershipItemMatched[3]),
    };
  }


  const projectMemberPermissionsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/members\/([^/]+)\/permissions\/?$/,
  );
  if (projectMemberPermissionsMatched) {
    return {
      kind: 'projectMemberPermissions',
      workspaceId: decodeURIComponent(projectMemberPermissionsMatched[1]),
      projectId: decodeURIComponent(projectMemberPermissionsMatched[2]),
      userId: decodeURIComponent(projectMemberPermissionsMatched[3]),
    };
  }

  const projectMemberChangeHistoryMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/members\/([^/]+)\/change-history\/?$/,
  );
  if (projectMemberChangeHistoryMatched) {
    return {
      kind: 'projectMemberChangeHistory',
      workspaceId: decodeURIComponent(projectMemberChangeHistoryMatched[1]),
      projectId: decodeURIComponent(projectMemberChangeHistoryMatched[2]),
      userId: decodeURIComponent(projectMemberChangeHistoryMatched[3]),
    };
  }

  const projectResourcePolicyMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/resources\/([^/]+)\/([^/]+)\/policy\/?$/,
  );
  if (projectResourcePolicyMatched) {
    return {
      kind: 'projectResourcePolicy',
      workspaceId: decodeURIComponent(projectResourcePolicyMatched[1]),
      projectId: decodeURIComponent(projectResourcePolicyMatched[2]),
      resourceType: decodeURIComponent(projectResourcePolicyMatched[3]),
      resourceId: decodeURIComponent(projectResourcePolicyMatched[4]),
    };
  }

  const taskArtifactDownloadMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/artifacts\/([^/]+)\/download\/?$/,
  );
  if (taskArtifactDownloadMatched) {
    return {
      kind: 'taskArtifactDownload',
      workspaceId: decodeURIComponent(taskArtifactDownloadMatched[1]),
      projectId: decodeURIComponent(taskArtifactDownloadMatched[2]),
      taskId: decodeURIComponent(taskArtifactDownloadMatched[3]),
      artifactId: decodeURIComponent(taskArtifactDownloadMatched[4]),
    };
  }

  const taskArtifactsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/artifacts\/?$/,
  );
  if (taskArtifactsMatched) {
    return {
      kind: 'taskArtifacts',
      workspaceId: decodeURIComponent(taskArtifactsMatched[1]),
      projectId: decodeURIComponent(taskArtifactsMatched[2]),
      taskId: decodeURIComponent(taskArtifactsMatched[3]),
    };
  }

  const taskMessagesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/messages\/?$/,
  );
  if (taskMessagesMatched) {
    return {
      kind: 'taskMessages',
      workspaceId: decodeURIComponent(taskMessagesMatched[1]),
      projectId: decodeURIComponent(taskMessagesMatched[2]),
      taskId: decodeURIComponent(taskMessagesMatched[3]),
    };
  }

  const taskCancelRunMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/cancel\/?$/,
  );
  if (taskCancelRunMatched) {
    return {
      kind: 'taskCancelRun',
      workspaceId: decodeURIComponent(taskCancelRunMatched[1]),
      projectId: decodeURIComponent(taskCancelRunMatched[2]),
      taskId: decodeURIComponent(taskCancelRunMatched[3]),
    };
  }

  const taskTracesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/traces\/?$/,
  );
  if (taskTracesMatched) {
    return {
      kind: 'taskTraces',
      workspaceId: decodeURIComponent(taskTracesMatched[1]),
      projectId: decodeURIComponent(taskTracesMatched[2]),
      taskId: decodeURIComponent(taskTracesMatched[3]),
    };
  }

  const taskInputItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/inputs\/([^/]+)\/?$/,
  );
  if (taskInputItemMatched) {
    return {
      kind: 'taskInputItem',
      workspaceId: decodeURIComponent(taskInputItemMatched[1]),
      projectId: decodeURIComponent(taskInputItemMatched[2]),
      taskId: decodeURIComponent(taskInputItemMatched[3]),
      inputId: decodeURIComponent(taskInputItemMatched[4]),
    };
  }

  const taskInputsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/inputs\/?$/,
  );
  if (taskInputsMatched) {
    return {
      kind: 'taskInputs',
      workspaceId: decodeURIComponent(taskInputsMatched[1]),
      projectId: decodeURIComponent(taskInputsMatched[2]),
      taskId: decodeURIComponent(taskInputsMatched[3]),
    };
  }

  const taskEventsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/events\/?$/,
  );
  if (taskEventsMatched) {
    return {
      kind: 'taskEvents',
      workspaceId: decodeURIComponent(taskEventsMatched[1]),
      projectId: decodeURIComponent(taskEventsMatched[2]),
      taskId: decodeURIComponent(taskEventsMatched[3]),
    };
  }

  const taskWorkspaceAccessMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/workspace-access\/?$/,
  );
  if (taskWorkspaceAccessMatched) {
    return {
      kind: 'taskWorkspaceAccess',
      workspaceId: decodeURIComponent(taskWorkspaceAccessMatched[1]),
      projectId: decodeURIComponent(taskWorkspaceAccessMatched[2]),
      taskId: decodeURIComponent(taskWorkspaceAccessMatched[3]),
    };
  }

  const taskItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/?$/,
  );
  if (taskItemMatched) {
    return {
      kind: 'taskItem',
      workspaceId: decodeURIComponent(taskItemMatched[1]),
      projectId: decodeURIComponent(taskItemMatched[2]),
      taskId: decodeURIComponent(taskItemMatched[3]),
    };
  }

  const tasksMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/?$/,
  );
  if (tasksMatched) {
    return {
      kind: 'tasks',
      workspaceId: decodeURIComponent(tasksMatched[1]),
      projectId: decodeURIComponent(tasksMatched[2]),
    };
  }

  const chatRoute = matchChatRoute(pathname);
  if (chatRoute) {
    return chatRoute;
  }

  const agentKeyItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agents\/([^/]+)\/keys\/([^/]+)\/?$/,
  );
  if (agentKeyItemMatched) {
    return {
      kind: 'agentKeyItem',
      workspaceId: decodeURIComponent(agentKeyItemMatched[1]),
      projectId: decodeURIComponent(agentKeyItemMatched[2]),
      agentId: decodeURIComponent(agentKeyItemMatched[3]),
      keyId: decodeURIComponent(agentKeyItemMatched[4]),
    };
  }

  const agentKeysMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agents\/([^/]+)\/keys\/?$/,
  );
  if (agentKeysMatched) {
    return {
      kind: 'agentKeys',
      workspaceId: decodeURIComponent(agentKeysMatched[1]),
      projectId: decodeURIComponent(agentKeysMatched[2]),
      agentId: decodeURIComponent(agentKeysMatched[3]),
    };
  }

  const agentConnectionInfoMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agents\/([^/]+)\/connection-info\/?$/,
  );
  if (agentConnectionInfoMatched) {
    return {
      kind: 'agentConnectionInfo',
      workspaceId: decodeURIComponent(agentConnectionInfoMatched[1]),
      projectId: decodeURIComponent(agentConnectionInfoMatched[2]),
      agentId: decodeURIComponent(agentConnectionInfoMatched[3]),
    };
  }

  const agentExecutionConfigMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agents\/([^/]+)\/execution-config\/?$/,
  );
  if (agentExecutionConfigMatched) {
    return {
      kind: 'agentExecutionConfig',
      workspaceId: decodeURIComponent(agentExecutionConfigMatched[1]),
      projectId: decodeURIComponent(agentExecutionConfigMatched[2]),
      agentId: decodeURIComponent(agentExecutionConfigMatched[3]),
    };
  }

  const agentDiagnosticsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agents\/([^/]+)\/diagnostics\/?$/,
  );
  if (agentDiagnosticsMatched) {
    return {
      kind: 'agentDiagnostics',
      workspaceId: decodeURIComponent(agentDiagnosticsMatched[1]),
      projectId: decodeURIComponent(agentDiagnosticsMatched[2]),
      agentId: decodeURIComponent(agentDiagnosticsMatched[3]),
    };
  }

  const agentItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agents\/([^/]+)\/?$/,
  );
  if (agentItemMatched) {
    return {
      kind: 'agentItem',
      workspaceId: decodeURIComponent(agentItemMatched[1]),
      projectId: decodeURIComponent(agentItemMatched[2]),
      agentId: decodeURIComponent(agentItemMatched[3]),
    };
  }

  const agentsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agents\/?$/,
  );
  if (agentsMatched) {
    return {
      kind: 'agents',
      workspaceId: decodeURIComponent(agentsMatched[1]),
      projectId: decodeURIComponent(agentsMatched[2]),
    };
  }

  const llmUnifiedChatMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/llm\/chat\/completions\/?$/,
  );
  if (llmUnifiedChatMatched) {
    return {
      kind: 'llmUnifiedChat',
      workspaceId: decodeURIComponent(llmUnifiedChatMatched[1]),
      projectId: decodeURIComponent(llmUnifiedChatMatched[2]),
    };
  }

  const llmGatewayProxyMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/llm-gateway\/(.+)$/,
  );
  if (llmGatewayProxyMatched) {
    return {
      kind: 'llmGatewayProxy',
      workspaceId: decodeURIComponent(llmGatewayProxyMatched[1]),
      projectId: decodeURIComponent(llmGatewayProxyMatched[2]),
      proxyPath: llmGatewayProxyMatched[3],
    };
  }

  const projectPricingMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/project-pricing\/?$/,
  );
  if (projectPricingMatched) {
    return {
      kind: 'projectPricing',
      workspaceId: decodeURIComponent(projectPricingMatched[1]),
      projectId: decodeURIComponent(projectPricingMatched[2]),
    };
  }

  const modelCatalogProvidersMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/model-catalog\/providers\/?$/,
  );
  if (modelCatalogProvidersMatched) {
    return {
      kind: 'modelCatalogProviders',
      workspaceId: decodeURIComponent(modelCatalogProvidersMatched[1]),
      projectId: decodeURIComponent(modelCatalogProvidersMatched[2]),
    };
  }

  const modelCatalogModelsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/model-catalog\/models\/?$/,
  );
  if (modelCatalogModelsMatched) {
    return {
      kind: 'modelCatalogModels',
      workspaceId: decodeURIComponent(modelCatalogModelsMatched[1]),
      projectId: decodeURIComponent(modelCatalogModelsMatched[2]),
    };
  }

  const modelCatalogSyncMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/model-catalog\/sync\/?$/,
  );
  if (modelCatalogSyncMatched) {
    return {
      kind: 'modelCatalogSync',
      workspaceId: decodeURIComponent(modelCatalogSyncMatched[1]),
      projectId: decodeURIComponent(modelCatalogSyncMatched[2]),
    };
  }

  const endpointImportMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/import-openai-compatible\/?$/,
  );
  if (endpointImportMatched) {
    return {
      kind: 'endpointImportOpenAICompatible',
      workspaceId: decodeURIComponent(endpointImportMatched[1]),
      projectId: decodeURIComponent(endpointImportMatched[2]),
    };
  }

  const endpointProxyMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/([^/]+)\/proxy\/(.+)$/,
  );
  if (endpointProxyMatched) {
    return {
      kind: 'endpointProxy',
      workspaceId: decodeURIComponent(endpointProxyMatched[1]),
      projectId: decodeURIComponent(endpointProxyMatched[2]),
      endpointId: decodeURIComponent(endpointProxyMatched[3]),
      proxyPath: endpointProxyMatched[4],
    };
  }

  const endpointVideoGenerationCancelMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/([^/]+)\/videos\/generations\/([^/]+)\/cancel\/?$/,
  );
  if (endpointVideoGenerationCancelMatched) {
    return {
      kind: 'endpointVideoGenerationCancel',
      workspaceId: decodeURIComponent(endpointVideoGenerationCancelMatched[1]),
      projectId: decodeURIComponent(endpointVideoGenerationCancelMatched[2]),
      endpointId: decodeURIComponent(endpointVideoGenerationCancelMatched[3]),
      jobId: decodeURIComponent(endpointVideoGenerationCancelMatched[4]),
    };
  }

  const endpointVideoGenerationPollMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/([^/]+)\/videos\/generations\/([^/]+)\/?$/,
  );
  if (endpointVideoGenerationPollMatched) {
    return {
      kind: 'endpointVideoGenerationPoll',
      workspaceId: decodeURIComponent(endpointVideoGenerationPollMatched[1]),
      projectId: decodeURIComponent(endpointVideoGenerationPollMatched[2]),
      endpointId: decodeURIComponent(endpointVideoGenerationPollMatched[3]),
      jobId: decodeURIComponent(endpointVideoGenerationPollMatched[4]),
    };
  }

  const endpointVideoGenerationCreateMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/([^/]+)\/videos\/generations\/?$/,
  );
  if (endpointVideoGenerationCreateMatched) {
    return {
      kind: 'endpointVideoGenerationCreate',
      workspaceId: decodeURIComponent(endpointVideoGenerationCreateMatched[1]),
      projectId: decodeURIComponent(endpointVideoGenerationCreateMatched[2]),
      endpointId: decodeURIComponent(endpointVideoGenerationCreateMatched[3]),
    };
  }

  const endpointImageGenerationMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/([^/]+)\/images\/generations\/?$/,
  );
  if (endpointImageGenerationMatched) {
    return {
      kind: 'endpointImageGeneration',
      workspaceId: decodeURIComponent(endpointImageGenerationMatched[1]),
      projectId: decodeURIComponent(endpointImageGenerationMatched[2]),
      endpointId: decodeURIComponent(endpointImageGenerationMatched[3]),
    };
  }

  const endpointRerankMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/([^/]+)\/rerank\/?$/,
  );
  if (endpointRerankMatched) {
    return {
      kind: 'endpointRerank',
      workspaceId: decodeURIComponent(endpointRerankMatched[1]),
      projectId: decodeURIComponent(endpointRerankMatched[2]),
      endpointId: decodeURIComponent(endpointRerankMatched[3]),
    };
  }

  const endpointItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/([^/]+)\/?$/,
  );
  if (endpointItemMatched) {
    return {
      kind: 'endpointItem',
      workspaceId: decodeURIComponent(endpointItemMatched[1]),
      projectId: decodeURIComponent(endpointItemMatched[2]),
      endpointId: decodeURIComponent(endpointItemMatched[3]),
    };
  }

  const endpointsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/?$/,
  );
  if (endpointsMatched) {
    return {
      kind: 'endpoints',
      workspaceId: decodeURIComponent(endpointsMatched[1]),
      projectId: decodeURIComponent(endpointsMatched[2]),
    };
  }

  const credentialRotateMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/credentials\/([^/]+)\/rotate\/?$/,
  );
  if (credentialRotateMatched) {
    return {
      kind: 'credentialRotate',
      workspaceId: decodeURIComponent(credentialRotateMatched[1]),
      projectId: decodeURIComponent(credentialRotateMatched[2]),
      credentialId: decodeURIComponent(credentialRotateMatched[3]),
    };
  }

  const credentialItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/credentials\/([^/]+)\/?$/,
  );
  if (credentialItemMatched) {
    return {
      kind: 'credentialItem',
      workspaceId: decodeURIComponent(credentialItemMatched[1]),
      projectId: decodeURIComponent(credentialItemMatched[2]),
      credentialId: decodeURIComponent(credentialItemMatched[3]),
    };
  }

  const credentialsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/credentials\/?$/,
  );
  if (credentialsMatched) {
    return {
      kind: 'credentials',
      workspaceId: decodeURIComponent(credentialsMatched[1]),
      projectId: decodeURIComponent(credentialsMatched[2]),
    };
  }

  return null;
}
