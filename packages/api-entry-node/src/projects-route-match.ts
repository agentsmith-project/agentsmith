import { matchChatRoute, type ChatRoute } from './chat-route-match.js';

export type ProjectsRoute =
  | { kind: 'workspacesCollection' }
  | { kind: 'workspaceItem'; workspaceId: string }
  | { kind: 'workspaceMembers'; workspaceId: string }
  | { kind: 'collection'; workspaceId: string }
  | { kind: 'item'; workspaceId: string; projectId: string }
  | { kind: 'sources'; workspaceId: string; projectId: string }
  | { kind: 'sourceLibraries'; workspaceId: string; projectId: string }
  | { kind: 'sourceLibrariesDefaultPersonal'; workspaceId: string; projectId: string }
  | { kind: 'sourceLibraryItem'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryObjects'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryFolders'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryObjectsUpload'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryObjectsDownload'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryObjectsDelete'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryObjectsMove'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryObjectsMeta'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryObjectsShareLink'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryAIReadyJobs'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryAIReadyJobItem'; workspaceId: string; projectId: string; libraryId: string; jobId: string }
  | { kind: 'sourceLibraryAIReadyJobCancel'; workspaceId: string; projectId: string; libraryId: string; jobId: string }
  | { kind: 'sourcesQuota'; workspaceId: string; projectId: string }
  | { kind: 'sourceAIReadyStart'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceAIReadyCancel'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceAIReadyRetry'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceBatchAIReadyStart'; workspaceId: string; projectId: string }
  | { kind: 'sourceBatchAIReadyCancel'; workspaceId: string; projectId: string }
  | { kind: 'sourceItem'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceDownload'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'tasks'; workspaceId: string; projectId: string }
  | { kind: 'taskItem'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskInputs'; workspaceId: string; projectId: string; taskId: string }
  | {
    kind: 'taskInputItem';
    workspaceId: string;
    projectId: string;
    taskId: string;
    inputId: string;
  }
  | { kind: 'taskMessages'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskTraces'; workspaceId: string; projectId: string; taskId: string }
  | { kind: 'taskArtifacts'; workspaceId: string; projectId: string; taskId: string }
  | {
    kind: 'taskArtifactSave';
    workspaceId: string;
    projectId: string;
    taskId: string;
    artifactId: string;
  }
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
  | { kind: 'usageKpi'; workspaceId: string; projectId: string }
  | { kind: 'projectMembers'; workspaceId: string; projectId: string }
  | { kind: 'projectJoinRequests'; workspaceId: string; projectId: string }
  | { kind: 'projectJoinRequestApprove'; workspaceId: string; projectId: string; joinId: string }
  | { kind: 'projectJoinRequestReject'; workspaceId: string; projectId: string; joinId: string }
  | { kind: 'projectPermissionTemplates'; workspaceId: string; projectId: string }
  | { kind: 'projectPermissionTemplateItem'; workspaceId: string; projectId: string; templateId: string }
  | { kind: 'projectQuotaTemplates'; workspaceId: string; projectId: string }
  | { kind: 'projectQuotaTemplateItem'; workspaceId: string; projectId: string; templateId: string }
  | { kind: 'projectQuotaTemplateApply'; workspaceId: string; projectId: string; templateId: string }
  | { kind: 'projectGroups'; workspaceId: string; projectId: string }
  | { kind: 'projectGroupItem'; workspaceId: string; projectId: string; groupId: string }
  | { kind: 'projectGroupApplyTemplate'; workspaceId: string; projectId: string; groupId: string }
  | { kind: 'projectMembershipItem'; workspaceId: string; projectId: string; userId: string }
  | ChatRoute
  | { kind: 'agents'; workspaceId: string; projectId: string }
  | { kind: 'agentItem'; workspaceId: string; projectId: string; agentId: string }
  | { kind: 'agentDiagnostics'; workspaceId: string; projectId: string; agentId: string }
  | { kind: 'agentRuntimeConfig'; workspaceId: string; projectId: string; agentId: string }
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
  | { kind: 'endpointImportOpenAICompatible'; workspaceId: string; projectId: string }
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

  const sourcesMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/?$/);
  if (sourcesMatched) {
    return {
      kind: 'sources',
      workspaceId: decodeURIComponent(sourcesMatched[1]),
      projectId: decodeURIComponent(sourcesMatched[2]),
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

  const usageKpiMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/usage\/kpi\/?$/);
  if (usageKpiMatched) {
    return {
      kind: 'usageKpi',
      workspaceId: decodeURIComponent(usageKpiMatched[1]),
      projectId: decodeURIComponent(usageKpiMatched[2]),
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

  const projectMembersMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/members\/?$/);
  if (projectMembersMatched) {
    return {
      kind: 'projectMembers',
      workspaceId: decodeURIComponent(projectMembersMatched[1]),
      projectId: decodeURIComponent(projectMembersMatched[2]),
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

  const projectQuotaTemplatesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/quota-templates\/?$/,
  );
  if (projectQuotaTemplatesMatched) {
    return {
      kind: 'projectQuotaTemplates',
      workspaceId: decodeURIComponent(projectQuotaTemplatesMatched[1]),
      projectId: decodeURIComponent(projectQuotaTemplatesMatched[2]),
    };
  }

  const projectQuotaTemplateApplyMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/quota-templates\/([^/]+)\/apply\/?$/,
  );
  if (projectQuotaTemplateApplyMatched) {
    return {
      kind: 'projectQuotaTemplateApply',
      workspaceId: decodeURIComponent(projectQuotaTemplateApplyMatched[1]),
      projectId: decodeURIComponent(projectQuotaTemplateApplyMatched[2]),
      templateId: decodeURIComponent(projectQuotaTemplateApplyMatched[3]),
    };
  }

  const projectQuotaTemplateItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/quota-templates\/([^/]+)\/?$/,
  );
  if (projectQuotaTemplateItemMatched) {
    return {
      kind: 'projectQuotaTemplateItem',
      workspaceId: decodeURIComponent(projectQuotaTemplateItemMatched[1]),
      projectId: decodeURIComponent(projectQuotaTemplateItemMatched[2]),
      templateId: decodeURIComponent(projectQuotaTemplateItemMatched[3]),
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

  const sourceLibrariesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/?$/,
  );
  if (sourceLibrariesMatched) {
    return {
      kind: 'sourceLibraries',
      workspaceId: decodeURIComponent(sourceLibrariesMatched[1]),
      projectId: decodeURIComponent(sourceLibrariesMatched[2]),
    };
  }

  const sourceLibrariesDefaultPersonalMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/default-personal\/?$/,
  );
  if (sourceLibrariesDefaultPersonalMatched) {
    return {
      kind: 'sourceLibrariesDefaultPersonal',
      workspaceId: decodeURIComponent(sourceLibrariesDefaultPersonalMatched[1]),
      projectId: decodeURIComponent(sourceLibrariesDefaultPersonalMatched[2]),
    };
  }

  const sourceLibraryItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/?$/,
  );
  if (sourceLibraryItemMatched) {
    return {
      kind: 'sourceLibraryItem',
      workspaceId: decodeURIComponent(sourceLibraryItemMatched[1]),
      projectId: decodeURIComponent(sourceLibraryItemMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryItemMatched[3]),
    };
  }

  const sourceLibraryObjectsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/objects\/?$/,
  );
  if (sourceLibraryObjectsMatched) {
    return {
      kind: 'sourceLibraryObjects',
      workspaceId: decodeURIComponent(sourceLibraryObjectsMatched[1]),
      projectId: decodeURIComponent(sourceLibraryObjectsMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryObjectsMatched[3]),
    };
  }

  const sourceLibraryFoldersMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/folders\/?$/,
  );
  if (sourceLibraryFoldersMatched) {
    return {
      kind: 'sourceLibraryFolders',
      workspaceId: decodeURIComponent(sourceLibraryFoldersMatched[1]),
      projectId: decodeURIComponent(sourceLibraryFoldersMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryFoldersMatched[3]),
    };
  }

  const sourceLibraryObjectsUploadMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/objects\/upload\/?$/,
  );
  if (sourceLibraryObjectsUploadMatched) {
    return {
      kind: 'sourceLibraryObjectsUpload',
      workspaceId: decodeURIComponent(sourceLibraryObjectsUploadMatched[1]),
      projectId: decodeURIComponent(sourceLibraryObjectsUploadMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryObjectsUploadMatched[3]),
    };
  }

  const sourceLibraryObjectsDownloadMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/objects\/download\/?$/,
  );
  if (sourceLibraryObjectsDownloadMatched) {
    return {
      kind: 'sourceLibraryObjectsDownload',
      workspaceId: decodeURIComponent(sourceLibraryObjectsDownloadMatched[1]),
      projectId: decodeURIComponent(sourceLibraryObjectsDownloadMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryObjectsDownloadMatched[3]),
    };
  }

  const sourceLibraryObjectsDeleteMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/objects\/delete\/?$/,
  );
  if (sourceLibraryObjectsDeleteMatched) {
    return {
      kind: 'sourceLibraryObjectsDelete',
      workspaceId: decodeURIComponent(sourceLibraryObjectsDeleteMatched[1]),
      projectId: decodeURIComponent(sourceLibraryObjectsDeleteMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryObjectsDeleteMatched[3]),
    };
  }

  const sourceLibraryObjectsMoveMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/objects\/move\/?$/,
  );
  if (sourceLibraryObjectsMoveMatched) {
    return {
      kind: 'sourceLibraryObjectsMove',
      workspaceId: decodeURIComponent(sourceLibraryObjectsMoveMatched[1]),
      projectId: decodeURIComponent(sourceLibraryObjectsMoveMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryObjectsMoveMatched[3]),
    };
  }

  const sourceLibraryObjectsMetaMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/objects\/meta\/?$/,
  );
  if (sourceLibraryObjectsMetaMatched) {
    return {
      kind: 'sourceLibraryObjectsMeta',
      workspaceId: decodeURIComponent(sourceLibraryObjectsMetaMatched[1]),
      projectId: decodeURIComponent(sourceLibraryObjectsMetaMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryObjectsMetaMatched[3]),
    };
  }

  const sourceLibraryObjectsShareLinkMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/objects\/share-link\/?$/,
  );
  if (sourceLibraryObjectsShareLinkMatched) {
    return {
      kind: 'sourceLibraryObjectsShareLink',
      workspaceId: decodeURIComponent(sourceLibraryObjectsShareLinkMatched[1]),
      projectId: decodeURIComponent(sourceLibraryObjectsShareLinkMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryObjectsShareLinkMatched[3]),
    };
  }

  const sourceLibraryAIReadyJobsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/ai-ready-jobs\/?$/,
  );
  if (sourceLibraryAIReadyJobsMatched) {
    return {
      kind: 'sourceLibraryAIReadyJobs',
      workspaceId: decodeURIComponent(sourceLibraryAIReadyJobsMatched[1]),
      projectId: decodeURIComponent(sourceLibraryAIReadyJobsMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryAIReadyJobsMatched[3]),
    };
  }

  const sourceLibraryAIReadyJobCancelMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/ai-ready-jobs\/([^/]+):cancel\/?$/,
  );
  if (sourceLibraryAIReadyJobCancelMatched) {
    return {
      kind: 'sourceLibraryAIReadyJobCancel',
      workspaceId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[1]),
      projectId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[3]),
      jobId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[4]),
    };
  }

  const sourceLibraryAIReadyJobItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/ai-ready-jobs\/([^/]+)\/?$/,
  );
  if (sourceLibraryAIReadyJobItemMatched) {
    return {
      kind: 'sourceLibraryAIReadyJobItem',
      workspaceId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[1]),
      projectId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[3]),
      jobId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[4]),
    };
  }

  const sourcesQuotaMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/quota\/?$/,
  );
  if (sourcesQuotaMatched) {
    return {
      kind: 'sourcesQuota',
      workspaceId: decodeURIComponent(sourcesQuotaMatched[1]),
      projectId: decodeURIComponent(sourcesQuotaMatched[2]),
    };
  }

  const sourceAIReadyStartMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/ai-ready\/start\/?$/,
  );
  if (sourceAIReadyStartMatched) {
    return {
      kind: 'sourceAIReadyStart',
      workspaceId: decodeURIComponent(sourceAIReadyStartMatched[1]),
      projectId: decodeURIComponent(sourceAIReadyStartMatched[2]),
      sourceId: decodeURIComponent(sourceAIReadyStartMatched[3]),
    };
  }

  const sourceAIReadyCancelMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/ai-ready\/cancel\/?$/,
  );
  if (sourceAIReadyCancelMatched) {
    return {
      kind: 'sourceAIReadyCancel',
      workspaceId: decodeURIComponent(sourceAIReadyCancelMatched[1]),
      projectId: decodeURIComponent(sourceAIReadyCancelMatched[2]),
      sourceId: decodeURIComponent(sourceAIReadyCancelMatched[3]),
    };
  }

  const sourceAIReadyRetryMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/ai-ready\/retry\/?$/,
  );
  if (sourceAIReadyRetryMatched) {
    return {
      kind: 'sourceAIReadyRetry',
      workspaceId: decodeURIComponent(sourceAIReadyRetryMatched[1]),
      projectId: decodeURIComponent(sourceAIReadyRetryMatched[2]),
      sourceId: decodeURIComponent(sourceAIReadyRetryMatched[3]),
    };
  }

  const sourceBatchAIReadyStartMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/batch\/ai-ready\/start\/?$/,
  );
  if (sourceBatchAIReadyStartMatched) {
    return {
      kind: 'sourceBatchAIReadyStart',
      workspaceId: decodeURIComponent(sourceBatchAIReadyStartMatched[1]),
      projectId: decodeURIComponent(sourceBatchAIReadyStartMatched[2]),
    };
  }

  const sourceBatchAIReadyCancelMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/batch\/ai-ready\/cancel\/?$/,
  );
  if (sourceBatchAIReadyCancelMatched) {
    return {
      kind: 'sourceBatchAIReadyCancel',
      workspaceId: decodeURIComponent(sourceBatchAIReadyCancelMatched[1]),
      projectId: decodeURIComponent(sourceBatchAIReadyCancelMatched[2]),
    };
  }

  const sourceItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/?$/,
  );
  if (sourceItemMatched) {
    return {
      kind: 'sourceItem',
      workspaceId: decodeURIComponent(sourceItemMatched[1]),
      projectId: decodeURIComponent(sourceItemMatched[2]),
      sourceId: decodeURIComponent(sourceItemMatched[3]),
    };
  }

  const sourceDownloadMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/download\/?$/,
  );
  if (sourceDownloadMatched) {
    return {
      kind: 'sourceDownload',
      workspaceId: decodeURIComponent(sourceDownloadMatched[1]),
      projectId: decodeURIComponent(sourceDownloadMatched[2]),
      sourceId: decodeURIComponent(sourceDownloadMatched[3]),
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

  const taskArtifactSaveMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/artifacts\/([^/]+)\/save\/?$/,
  );
  if (taskArtifactSaveMatched) {
    return {
      kind: 'taskArtifactSave',
      workspaceId: decodeURIComponent(taskArtifactSaveMatched[1]),
      projectId: decodeURIComponent(taskArtifactSaveMatched[2]),
      taskId: decodeURIComponent(taskArtifactSaveMatched[3]),
      artifactId: decodeURIComponent(taskArtifactSaveMatched[4]),
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

  const agentRuntimeConfigMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/agents\/([^/]+)\/runtime-config\/?$/,
  );
  if (agentRuntimeConfigMatched) {
    return {
      kind: 'agentRuntimeConfig',
      workspaceId: decodeURIComponent(agentRuntimeConfigMatched[1]),
      projectId: decodeURIComponent(agentRuntimeConfigMatched[2]),
      agentId: decodeURIComponent(agentRuntimeConfigMatched[3]),
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
