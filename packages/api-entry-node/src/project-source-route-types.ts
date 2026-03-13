import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { WorkspaceRecordLike } from './project-source-handler-types.js';

export interface AnyRoute {
  kind: string;
  workspaceId?: string;
  projectId?: string;
  userId?: string;
  joinId?: string;
  groupId?: string;
  templateId?: string;
  resourceType?: string;
  resourceId?: string;
  libraryId?: string;
  jobId?: string;
  sourceId?: string;
}

export interface ProjectSourceHandlerArgs {
  route: AnyRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  workspaces: WorkspaceRecordLike[];
  defaultWorkspace?: WorkspaceRecordLike;
  requestUrl: URL;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}

export interface ProjectSourceLibraryGuardSet {
  enforceSourceLibraryAccess: (params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
  }) => Promise<boolean>;
  enforceSourceLibraryRateLimit: (params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
  }) => Promise<boolean>;
  enforceSourceLibraryPreflight: (params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
  }) => Promise<boolean>;
  enforceSourceLibraryLimit: (params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
    currentFileCount: number;
    nextFileSizeBytes: number;
  }) => Promise<boolean>;
  enforceSourceLibraryAccessBySourceId: (params: {
    workspaceId: string;
    projectId: string;
    sourceId: string;
    routeKind: string;
  }) => Promise<boolean>;
}

export interface ProjectSourceRouteContext extends ProjectSourceHandlerArgs {
  requestId: string | null;
  sourceLibraryGuards: ProjectSourceLibraryGuardSet;
}
