import {
  handleProjectCrudRoutes,
  handleFileLibraryRoutes,
  handleProjectGovernanceRoutes,
  handleWorkspaceRoutes,
} from './project-route-dispatchers.js';
import { handleAgentTaskModelSettingRoute } from './agent-task-model-setting-route-handler.js';
import type {
  ProjectRouteHandlerArgs,
  ProjectRouteContext,
} from './project-route-types.js';

export async function handleProjectRoute(args: ProjectRouteHandlerArgs): Promise<boolean> {
  const {
    route,
    req,
    res,
    workspaces,
    json,
  } = args;
  const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null;

  const context: ProjectRouteContext = {
    ...args,
    requestId,
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

  if (
    route.kind === 'agentTaskModelSetting'
    && route.workspaceId
    && route.projectId
    && await handleAgentTaskModelSettingRoute({
      route: {
        kind: 'agentTaskModelSetting',
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      },
      method: context.method,
      req: context.req,
      res: context.res,
      deps: context.deps,
      user: context.user,
      json: context.json,
      readBody: context.readBody,
    })
  ) {
    return true;
  }

  if (await handleProjectGovernanceRoutes(context)) {
    return true;
  }

  if (await handleFileLibraryRoutes(context)) {
    return true;
  }

  return false;
}
