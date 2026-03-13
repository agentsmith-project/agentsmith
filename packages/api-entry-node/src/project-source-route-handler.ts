import type http from 'node:http';
import {
  handleProjectCrudRoutes,
  handleProjectGovernanceRoutes,
  handleSourceDomainRoutes,
  handleWorkspaceRoutes,
} from './project-source-route-dispatchers.js';
import type {
  ProjectSourceHandlerArgs,
  ProjectSourceRouteContext,
} from './project-source-route-types.js';
import { createSourceLibraryGuards } from './project-source-library-guards.js';
import {
  checkAndConsumeProjectResourceRateLimitsForUser,
} from './project-resource-policy-enforcer.js';

export async function handleProjectSourceRoute(args: ProjectSourceHandlerArgs): Promise<boolean> {
  const {
    route,
    method,
    req,
    res,
    deps,
    user,
    workspaces,
    defaultWorkspace,
    requestUrl,
    json,
    readBody,
  } = args;
  const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null;

  const {
    enforceSourceLibraryAccess,
    enforceSourceLibraryRateLimit,
    enforceSourceLibraryPreflight,
    enforceSourceLibraryLimit,
    enforceSourceLibraryAccessBySourceId,
  } = createSourceLibraryGuards({
    deps,
    user,
    requestId,
    res,
    json,
  });

  const context: ProjectSourceRouteContext = {
    ...args,
    requestId,
    sourceLibraryGuards: {
      enforceSourceLibraryAccess,
      enforceSourceLibraryRateLimit,
      enforceSourceLibraryPreflight,
      enforceSourceLibraryLimit,
      enforceSourceLibraryAccessBySourceId,
    },
  };

  if (await handleWorkspaceRoutes(context)) {
    return true;
  }

  const workspaceIdInRoute = route.workspaceId ?? null;
  if (workspaceIdInRoute && !workspaces.some((item) => item.id === workspaceIdInRoute)) {
    json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
    return true;
  }

  if (await handleProjectCrudRoutes(context)) {
    return true;
  }

  if (await handleProjectGovernanceRoutes(context)) {
    return true;
  }

  if (await handleSourceDomainRoutes(context)) {
    return true;
  }

  return false;
}
