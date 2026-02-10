import { matchChatRoute, type ChatRoute } from './chat-route-match.js';

export type ProjectsRoute =
  | { kind: 'workspacesCollection' }
  | { kind: 'workspaceItem'; workspaceId: string }
  | { kind: 'workspaceMembers'; workspaceId: string }
  | { kind: 'collection'; workspaceId: string }
  | { kind: 'item'; workspaceId: string; projectId: string }
  | { kind: 'sources'; workspaceId: string; projectId: string }
  | { kind: 'sourceLibraries'; workspaceId: string; projectId: string }
  | { kind: 'sourceLibraryItem'; workspaceId: string; projectId: string; libraryId: string }
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
  | ChatRoute
  | { kind: 'endpoints'; workspaceId: string; projectId: string }
  | { kind: 'endpointItem'; workspaceId: string; projectId: string; endpointId: string }
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

  const chatRoute = matchChatRoute(pathname);
  if (chatRoute) {
    return chatRoute;
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
