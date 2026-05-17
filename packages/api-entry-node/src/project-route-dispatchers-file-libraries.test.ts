import type http from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { handleProjectFileLibraryRoutes } from './project-file-library-routes.js';
import { handleFileLibraryRoutes } from './project-route-dispatchers-file-libraries.js';
import type { ProjectRouteContext } from './project-route-types.js';

vi.mock('./project-file-library-routes.js', () => ({
  handleProjectFileLibraryRoutes: vi.fn(async () => true),
}));

type HandlerFileLibraryRouteKind = Parameters<typeof handleProjectFileLibraryRoutes>[0]['routeKind'];

const baseRoute = {
  workspaceId: 'ws_default',
  projectId: 'proj_1',
} as const;

const FILE_LIBRARY_DISPATCH_CASES = [
  { name: 'fileLibraries', route: { kind: 'fileLibraries', ...baseRoute }, expected: { routeKind: 'fileLibraries' } },
  { name: 'fileLibraryItem', route: { kind: 'fileLibraryItem', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibraryItem', libraryId: 'flib_1' } },
  { name: 'fileLibraryEntries', route: { kind: 'fileLibraryEntries', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibraryEntries', libraryId: 'flib_1' } },
  { name: 'fileLibraryFolders', route: { kind: 'fileLibraryFolders', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibraryFolders', libraryId: 'flib_1' } },
  { name: 'fileLibraryDelete', route: { kind: 'fileLibraryDelete', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibraryDelete', libraryId: 'flib_1' } },
  { name: 'fileLibraryMove', route: { kind: 'fileLibraryMove', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibraryMove', libraryId: 'flib_1' } },
  { name: 'fileLibraryUpload', route: { kind: 'fileLibraryUpload', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibraryUpload', libraryId: 'flib_1' } },
  { name: 'fileLibraryDownload', route: { kind: 'fileLibraryDownload', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibraryDownload', libraryId: 'flib_1' } },
  { name: 'fileLibraryMeta', route: { kind: 'fileLibraryMeta', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibraryMeta', libraryId: 'flib_1' } },
  { name: 'fileLibrarySavePoints', route: { kind: 'fileLibrarySavePoints', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibrarySavePoints', libraryId: 'flib_1' } },
  { name: 'fileLibraryRestore', route: { kind: 'fileLibraryRestore', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibraryRestore', libraryId: 'flib_1' } },
  { name: 'fileLibraryActiveOperation', route: { kind: 'fileLibraryActiveOperation', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibraryActiveOperation', libraryId: 'flib_1' } },
  { name: 'fileLibraryRuntimeAccessRelease', route: { kind: 'fileLibraryRuntimeAccessRelease', ...baseRoute, libraryId: 'flib_1' }, expected: { routeKind: 'fileLibraryRuntimeAccessRelease', libraryId: 'flib_1' } },
  { name: 'fileLibraryOperation', route: { kind: 'fileLibraryOperation', ...baseRoute, operationId: 'op_1' }, expected: { routeKind: 'fileLibraryOperation', operationId: 'op_1' } },
  { name: 'taskFileTemplates', route: { kind: 'taskFileTemplates', ...baseRoute }, expected: { routeKind: 'taskFileTemplates' } },
  { name: 'taskFileTemplateItem', route: { kind: 'taskFileTemplateItem', ...baseRoute, taskFileTemplateId: 'tftpl_1' }, expected: { routeKind: 'taskFileTemplateItem', taskFileTemplateId: 'tftpl_1' } },
  { name: 'taskFileTemplatePublish', route: { kind: 'taskFileTemplatePublish', ...baseRoute, taskFileTemplateId: 'tftpl_1' }, expected: { routeKind: 'taskFileTemplatePublish', taskFileTemplateId: 'tftpl_1' } },
  { name: 'taskFileTemplateUnpublish', route: { kind: 'taskFileTemplateUnpublish', ...baseRoute, taskFileTemplateId: 'tftpl_1' }, expected: { routeKind: 'taskFileTemplateUnpublish', taskFileTemplateId: 'tftpl_1' } },
] as const satisfies readonly {
  name: string;
  route: ProjectRouteContext['route'] & {
    kind: HandlerFileLibraryRouteKind;
    workspaceId: string;
    projectId: string;
  };
  expected: { routeKind: HandlerFileLibraryRouteKind } & Record<string, string>;
}[];

type CoveredFileLibraryRouteKind = typeof FILE_LIBRARY_DISPATCH_CASES[number]['route']['kind'];
const FILE_LIBRARY_ROUTE_KIND_STATIC_GUARD: Record<
  Exclude<HandlerFileLibraryRouteKind, CoveredFileLibraryRouteKind>
    | Exclude<CoveredFileLibraryRouteKind, HandlerFileLibraryRouteKind>,
  never
> = {};

function createContext(route: ProjectRouteContext['route']): ProjectRouteContext {
  return {
    route,
    method: 'GET',
    req: {} as http.IncomingMessage,
    res: {} as http.ServerResponse,
    deps: {} as NodeApiDeps,
    user: { id: 'user_test', email: 'dev-admin@example.com', name: 'Dev Admin' } satisfies AuthenticatedUser,
    workspaces: [],
    requestUrl: new URL('http://localhost/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/flib_1/operations/active'),
    requestId: 'req_test',
    json: vi.fn(),
    readBody: vi.fn(async () => ({})),
  };
}

describe('handleFileLibraryRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the route coverage table aligned with handler-supported file-library route kinds', () => {
    expect(Object.keys(FILE_LIBRARY_ROUTE_KIND_STATIC_GUARD)).toHaveLength(0);
  });

  it.each(FILE_LIBRARY_DISPATCH_CASES)('dispatches $name through the file-library route handler', async ({ route, expected }) => {
    const handled = await handleFileLibraryRoutes(createContext(route));

    expect(handled).toBe(true);
    expect(handleProjectFileLibraryRoutes).toHaveBeenCalledTimes(1);
    expect(handleProjectFileLibraryRoutes).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      ...expected,
    }));
  });
});
