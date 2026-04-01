import { handleProjectFileLibraryRoutes } from './project-file-library-routes.js';
import type { ProjectRouteContext } from './project-route-types.js';

const FILE_LIBRARY_ROUTE_KINDS = new Set([
  'fileLibraries',
  'fileLibraryItem',
  'fileLibraryBackend',
  'fileLibraryStorageCredentialExchange',
  'fileLibraryDesktopMountAccess',
  'fileLibraryEntries',
  'fileLibraryFolders',
  'fileLibraryDelete',
  'fileLibraryMove',
  'fileLibraryUpload',
  'fileLibraryDownload',
  'fileLibraryMeta',
  'fileLibraryShareLink',
]);

export async function handleFileLibraryRoutes(context: ProjectRouteContext): Promise<boolean> {
  const {
    route,
    method,
    req,
    res,
    deps,
    user,
    json,
    readBody,
  } = context;

  if (!FILE_LIBRARY_ROUTE_KINDS.has(route.kind) || !route.workspaceId || !route.projectId) {
    return false;
  }

  return handleProjectFileLibraryRoutes({
    routeKind: route.kind as Parameters<typeof handleProjectFileLibraryRoutes>[0]['routeKind'],
    method,
    workspaceId: route.workspaceId,
    projectId: route.projectId,
    libraryId: route.libraryId,
    req,
    res,
    deps,
    user,
    json,
    readBody,
  });
}
