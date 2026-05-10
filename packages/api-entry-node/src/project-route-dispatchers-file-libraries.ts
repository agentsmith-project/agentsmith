import { handleProjectFileLibraryRoutes } from './project-file-library-routes.js';
import type { ProjectRouteContext } from './project-route-types.js';

const FILE_LIBRARY_ROUTE_KINDS = new Set([
  'fileLibraries',
  'fileLibraryItem',
  'fileLibraryEntries',
  'fileLibraryFolders',
  'fileLibraryDelete',
  'fileLibraryMove',
  'fileLibraryUpload',
  'fileLibraryDownload',
  'fileLibraryMeta',
  'fileLibrarySavePoints',
  'fileLibraryRestorePreview',
  'fileLibraryRestoreRun',
  'fileLibraryRestoreCancel',
  'fileLibraryOperation',
  'taskFileTemplates',
  'taskFileTemplateItem',
  'taskFileTemplatePublish',
  'taskFileTemplateUnpublish',
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
    libraryId: 'libraryId' in route && typeof route.libraryId === 'string' ? route.libraryId : undefined,
    operationId: 'operationId' in route && typeof route.operationId === 'string' ? route.operationId : undefined,
    taskFileTemplateId: 'taskFileTemplateId' in route && typeof route.taskFileTemplateId === 'string'
      ? route.taskFileTemplateId
      : undefined,
    req,
    res,
    deps,
    user,
    json,
    readBody,
  });
}
