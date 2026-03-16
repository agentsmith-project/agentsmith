import { handleProjectSourceLibraryRoutes } from './project-source-library-routes.js';
import type { ProjectSourceRouteContext } from './project-source-route-types.js';

const SOURCE_LIBRARY_ROUTE_KINDS = new Set([
  'sources',
  'sourceItem',
  'sourceDownload',
]);

export async function handleSourceDomainRoutes(context: ProjectSourceRouteContext): Promise<boolean> {
  const {
    route,
    method,
    req,
    res,
    deps,
    user,
    requestId,
    requestUrl,
    json,
    readBody,
    sourceLibraryGuards: {
      enforceSourceLibraryPreflight,
      enforceSourceLibraryLimit,
      enforceSourceLibraryAccessBySourceId,
    },
  } = context;

  if (!SOURCE_LIBRARY_ROUTE_KINDS.has(route.kind) || !route.workspaceId || !route.projectId) {
    return false;
  }

  return handleProjectSourceLibraryRoutes({
    routeKind: route.kind as Parameters<typeof handleProjectSourceLibraryRoutes>[0]['routeKind'],
    method,
    workspaceId: route.workspaceId,
    projectId: route.projectId,
    libraryId: route.libraryId,
    sourceId: route.sourceId,
    jobId: route.jobId,
    req,
    res,
    requestUrl,
    deps,
    user,
    requestId,
    json,
    readBody,
    enforceSourceLibraryPreflight,
    enforceSourceLibraryLimit,
    enforceSourceLibraryAccessBySourceId,
  });
}
