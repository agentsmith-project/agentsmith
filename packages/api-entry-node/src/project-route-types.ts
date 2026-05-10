import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { WorkspaceRecordLike } from './project-handler-types.js';

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
  operationId?: string;
  jobId?: string;
}

export interface ProjectRouteHandlerArgs {
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

export interface ProjectRouteContext extends ProjectRouteHandlerArgs {
  requestId: string | null;
}
