import { matchChatRoute, type ChatRoute } from './chat-route-match.js';

export type ProjectsRoute =
  | { kind: 'workspacesCollection' }
  | { kind: 'workspaceItem'; workspaceId: string }
  | { kind: 'workspaceMembers'; workspaceId: string }
  | { kind: 'workspaceProjectCreators'; workspaceId: string }
  | { kind: 'workspaceDirectoryUsers'; workspaceId: string }
  | { kind: 'workspaceGovernableProjects'; workspaceId: string }
  | { kind: 'workspaceFeishuSettings'; workspaceId: string }
  | { kind: 'workspaceFeishuVerifyStart'; workspaceId: string }
  | { kind: 'workspaceFeishuEnable'; workspaceId: string }
  | { kind: 'workspaceFeishuOAuthComplete'; workspaceId: string }
  | { kind: 'workspaceFeishuUserAuthStart'; workspaceId: string }
  | { kind: 'collection'; workspaceId: string }
  | { kind: 'item'; workspaceId: string; projectId: string }
  | { kind: 'projectAuthorize'; workspaceId: string; projectId: string }
  | { kind: 'agentTaskModelSetting'; workspaceId: string; projectId: string }
  | { kind: 'fileLibraries'; workspaceId: string; projectId: string }
  | { kind: 'fileLibraryItem'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryEntries'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryFolders'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryDelete'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryMove'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryUpload'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryDownload'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryMeta'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibrarySavePoints'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryRestore'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryRuntimeAccessRelease'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'fileLibraryOperation'; workspaceId: string; projectId: string; operationId: string }
  | { kind: 'taskFileTemplates'; workspaceId: string; projectId: string }
  | { kind: 'taskFileTemplateItem'; workspaceId: string; projectId: string; taskFileTemplateId: string }
  | { kind: 'taskFileTemplatePublish'; workspaceId: string; projectId: string; taskFileTemplateId: string }
  | { kind: 'taskFileTemplateUnpublish'; workspaceId: string; projectId: string; taskFileTemplateId: string }
  | { kind: 'tasks'; workspaceId: string; projectId: string }
  | { kind: 'taskItem'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskWorkspaceAccess'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskWorkspaceAccessRelease'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskInputs'; workspaceId: string; projectId: string; taskId: string }
  | {
    kind: 'taskInputItem';
    workspaceId: string;
    projectId: string;
    taskId: string;
    inputId: string;
  }
  | { kind: 'taskActivity'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskRunnerBindingOptions'; workspaceId: string; projectId: string }
  | { kind: 'taskRuns'; workspaceId: string; projectId: string; taskId: string }
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
  | { kind: 'taskTerminalSessions'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskTerminalSession'; workspaceId: string; projectId: string; taskId: string; terminalSessionId: string }
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
  | { kind: 'agentTestConnection'; workspaceId: string; projectId: string; agentId: string }
  | { kind: 'agentTestTaskRuns'; workspaceId: string; projectId: string; agentId: string }
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
  | { kind: 'endpointImportBulk'; workspaceId: string; projectId: string }
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

  const workspaceGovernableProjectsMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/governable-projects\/?$/);
  if (workspaceGovernableProjectsMatched) {
    return {
      kind: 'workspaceGovernableProjects',
      workspaceId: decodeURIComponent(workspaceGovernableProjectsMatched[1]),
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

  const projectAuthorizeMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/authorize\/?$/);
  if (projectAuthorizeMatched) {
    return {
      kind: 'projectAuthorize',
      workspaceId: decodeURIComponent(projectAuthorizeMatched[1]),
      projectId: decodeURIComponent(projectAuthorizeMatched[2]),
    };
  }

  const agentTaskModelSettingMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-task-model-setting\/?$/,
  );
  if (agentTaskModelSettingMatched) {
    return {
      kind: 'agentTaskModelSetting',
      workspaceId: decodeURIComponent(agentTaskModelSettingMatched[1]),
      projectId: decodeURIComponent(agentTaskModelSettingMatched[2]),
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

  const fileLibraryOperationMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-library-operations\/([^/]+)\/?$/,
  );
  if (fileLibraryOperationMatched) {
    return {
      kind: 'fileLibraryOperation',
      workspaceId: decodeURIComponent(fileLibraryOperationMatched[1]),
      projectId: decodeURIComponent(fileLibraryOperationMatched[2]),
      operationId: decodeURIComponent(fileLibraryOperationMatched[3]),
    };
  }

  const taskFileTemplatesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/task-file-templates\/?$/,
  );
  if (taskFileTemplatesMatched) {
    return {
      kind: 'taskFileTemplates',
      workspaceId: decodeURIComponent(taskFileTemplatesMatched[1]),
      projectId: decodeURIComponent(taskFileTemplatesMatched[2]),
    };
  }

  const taskFileTemplatePublishMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/task-file-templates\/([^/]+)\/publish\/?$/,
  );
  if (taskFileTemplatePublishMatched) {
    return {
      kind: 'taskFileTemplatePublish',
      workspaceId: decodeURIComponent(taskFileTemplatePublishMatched[1]),
      projectId: decodeURIComponent(taskFileTemplatePublishMatched[2]),
      taskFileTemplateId: decodeURIComponent(taskFileTemplatePublishMatched[3]),
    };
  }

  const taskFileTemplateUnpublishMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/task-file-templates\/([^/]+)\/unpublish\/?$/,
  );
  if (taskFileTemplateUnpublishMatched) {
    return {
      kind: 'taskFileTemplateUnpublish',
      workspaceId: decodeURIComponent(taskFileTemplateUnpublishMatched[1]),
      projectId: decodeURIComponent(taskFileTemplateUnpublishMatched[2]),
      taskFileTemplateId: decodeURIComponent(taskFileTemplateUnpublishMatched[3]),
    };
  }

  const taskFileTemplateItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/task-file-templates\/([^/]+)\/?$/,
  );
  if (taskFileTemplateItemMatched) {
    return {
      kind: 'taskFileTemplateItem',
      workspaceId: decodeURIComponent(taskFileTemplateItemMatched[1]),
      projectId: decodeURIComponent(taskFileTemplateItemMatched[2]),
      taskFileTemplateId: decodeURIComponent(taskFileTemplateItemMatched[3]),
    };
  }

  const fileLibrarySavePointsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/save-points\/?$/,
  );
  if (fileLibrarySavePointsMatched) {
    return {
      kind: 'fileLibrarySavePoints',
      workspaceId: decodeURIComponent(fileLibrarySavePointsMatched[1]),
      projectId: decodeURIComponent(fileLibrarySavePointsMatched[2]),
      libraryId: decodeURIComponent(fileLibrarySavePointsMatched[3]),
    };
  }

  const fileLibraryRestoreMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/restore\/?$/,
  );
  if (fileLibraryRestoreMatched) {
    return {
      kind: 'fileLibraryRestore',
      workspaceId: decodeURIComponent(fileLibraryRestoreMatched[1]),
      projectId: decodeURIComponent(fileLibraryRestoreMatched[2]),
      libraryId: decodeURIComponent(fileLibraryRestoreMatched[3]),
    };
  }

  const fileLibraryRuntimeAccessReleaseMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/file-libraries\/([^/]+)\/runtime-access\/release\/?$/,
  );
  if (fileLibraryRuntimeAccessReleaseMatched) {
    return {
      kind: 'fileLibraryRuntimeAccessRelease',
      workspaceId: decodeURIComponent(fileLibraryRuntimeAccessReleaseMatched[1]),
      projectId: decodeURIComponent(fileLibraryRuntimeAccessReleaseMatched[2]),
      libraryId: decodeURIComponent(fileLibraryRuntimeAccessReleaseMatched[3]),
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

  const taskActivityMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/activity\/?$/,
  );
  if (taskActivityMatched) {
    return {
      kind: 'taskActivity',
      workspaceId: decodeURIComponent(taskActivityMatched[1]),
      projectId: decodeURIComponent(taskActivityMatched[2]),
      taskId: decodeURIComponent(taskActivityMatched[3]),
    };
  }

  const taskRunnerBindingOptionsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/runner-binding-options\/?$/,
  );
  if (taskRunnerBindingOptionsMatched) {
    return {
      kind: 'taskRunnerBindingOptions',
      workspaceId: decodeURIComponent(taskRunnerBindingOptionsMatched[1]),
      projectId: decodeURIComponent(taskRunnerBindingOptionsMatched[2]),
    };
  }

  const taskRunsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/runs\/?$/,
  );
  if (taskRunsMatched) {
    return {
      kind: 'taskRuns',
      workspaceId: decodeURIComponent(taskRunsMatched[1]),
      projectId: decodeURIComponent(taskRunsMatched[2]),
      taskId: decodeURIComponent(taskRunsMatched[3]),
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

  const taskTerminalSessionMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/terminal\/sessions\/([^/]+)\/?$/,
  );
  if (taskTerminalSessionMatched) {
    return {
      kind: 'taskTerminalSession',
      workspaceId: decodeURIComponent(taskTerminalSessionMatched[1]),
      projectId: decodeURIComponent(taskTerminalSessionMatched[2]),
      taskId: decodeURIComponent(taskTerminalSessionMatched[3]),
      terminalSessionId: decodeURIComponent(taskTerminalSessionMatched[4]),
    };
  }

  const taskTerminalSessionsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/terminal\/sessions\/?$/,
  );
  if (taskTerminalSessionsMatched) {
    return {
      kind: 'taskTerminalSessions',
      workspaceId: decodeURIComponent(taskTerminalSessionsMatched[1]),
      projectId: decodeURIComponent(taskTerminalSessionsMatched[2]),
      taskId: decodeURIComponent(taskTerminalSessionsMatched[3]),
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

  const taskWorkspaceAccessReleaseMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/workspace-access\/release\/?$/,
  );
  if (taskWorkspaceAccessReleaseMatched) {
    return {
      kind: 'taskWorkspaceAccessRelease',
      workspaceId: decodeURIComponent(taskWorkspaceAccessReleaseMatched[1]),
      projectId: decodeURIComponent(taskWorkspaceAccessReleaseMatched[2]),
      taskId: decodeURIComponent(taskWorkspaceAccessReleaseMatched[3]),
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
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-runners\/([^/]+)\/keys\/([^/]+)\/?$/,
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
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-runners\/([^/]+)\/keys\/?$/,
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
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-runners\/([^/]+)\/connection-info\/?$/,
  );
  if (agentConnectionInfoMatched) {
    return {
      kind: 'agentConnectionInfo',
      workspaceId: decodeURIComponent(agentConnectionInfoMatched[1]),
      projectId: decodeURIComponent(agentConnectionInfoMatched[2]),
      agentId: decodeURIComponent(agentConnectionInfoMatched[3]),
    };
  }

  const agentTestConnectionMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-runners\/([^/]+)\/test-connection\/?$/,
  );
  if (agentTestConnectionMatched) {
    return {
      kind: 'agentTestConnection',
      workspaceId: decodeURIComponent(agentTestConnectionMatched[1]),
      projectId: decodeURIComponent(agentTestConnectionMatched[2]),
      agentId: decodeURIComponent(agentTestConnectionMatched[3]),
    };
  }

  const agentTestTaskRunsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-runners\/([^/]+)\/test-task-runs\/?$/,
  );
  if (agentTestTaskRunsMatched) {
    return {
      kind: 'agentTestTaskRuns',
      workspaceId: decodeURIComponent(agentTestTaskRunsMatched[1]),
      projectId: decodeURIComponent(agentTestTaskRunsMatched[2]),
      agentId: decodeURIComponent(agentTestTaskRunsMatched[3]),
    };
  }

  const agentExecutionConfigMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-runners\/([^/]+)\/execution-config\/?$/,
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
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-runners\/([^/]+)\/diagnostics\/?$/,
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
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-runners\/([^/]+)\/?$/,
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
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-runners\/?$/,
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
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/import-bulk\/?$/,
  );
  if (endpointImportMatched) {
    return {
      kind: 'endpointImportBulk',
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
