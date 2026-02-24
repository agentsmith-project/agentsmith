import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';
import { extractBearerToken, verifyBearerToken } from './auth.js';
import { handleProjectSourceRoute } from './project-source-route-handler.js';
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import { handleChatStreamRoute } from './chat-stream-handler.js';
import { handleEndpointRoute } from './endpoint-route-handler.js';
import { handleAgentRoute } from './agent-route-handler.js';
import { matchProjectsRoute, type ProjectsRoute } from './projects-route-match.js';
import type { ChatRoute } from './chat-route-match.js';
import {
  OWNER_WORKSPACE_PERMISSIONS,
  buildWorkspaceRecords,
  resolveProjectPermissions,
} from './workspace-permissions.js';
import { applyCors, json, proxyJsonRequest, readBody, unauthorized } from './http-utils.js';
import { mapRequestError } from './error-mapper.js';
import { handleApiDocsRoute } from './api-docs-handler.js';
import {
  getNotebookRuntimeMetricsPrometheusText,
  getNotebookRuntimeMetricsSnapshot,
  handleTaskRoute,
} from './task-route-handler.js';

function isChatRoute(route: { kind: string }): route is ChatRoute {
  return route.kind.startsWith('chat');
}

function isAgentRoute(route: { kind: string }): boolean {
  return route.kind === 'agents'
    || route.kind === 'agentItem'
    || route.kind === 'agentDiagnostics'
    || route.kind === 'agentRuntimeConfig'
    || route.kind === 'agentConnectionInfo'
    || route.kind === 'agentKeys'
    || route.kind === 'agentKeyItem';
}

function isTaskRoute(route: { kind: string }): boolean {
  return route.kind === 'tasks'
    || route.kind === 'taskItem'
    || route.kind === 'taskInputs'
    || route.kind === 'taskInputItem'
    || route.kind === 'taskMessages'
    || route.kind === 'taskTraces'
    || route.kind === 'taskArtifacts'
    || route.kind === 'taskArtifactSave'
    || route.kind === 'taskArtifactDownload'
    || route.kind === 'taskEvents';
}

function routeHasProjectScope(route: ProjectsRoute): route is ProjectsRoute & { workspaceId: string; projectId: string } {
  return 'workspaceId' in route
    && typeof route.workspaceId === 'string'
    && 'projectId' in route
    && typeof route.projectId === 'string';
}

function requiredProjectPermissions(route: ProjectsRoute, method: string): string[] {
  if (isTaskRoute(route)) {
    if (route.kind === 'taskMessages' && method === 'POST') {
      return ['project:notebook:access', 'project:agent:use', 'project:endpoint:use'];
    }
    return ['project:notebook:access'];
  }

  if (isAgentRoute(route)) {
    if (method === 'GET') return ['project:agent:use'];
    return ['project:agent:manage'];
  }

  if (route.kind === 'credentials' || route.kind === 'credentialItem' || route.kind === 'credentialRotate') {
    return ['project:credential:manage'];
  }

  if (
    route.kind === 'endpoints'
    || route.kind === 'endpointItem'
    || route.kind === 'endpointRerank'
    || route.kind === 'endpointImageGeneration'
    || route.kind === 'endpointVideoGenerationCreate'
    || route.kind === 'endpointVideoGenerationPoll'
    || route.kind === 'endpointVideoGenerationCancel'
    || route.kind === 'endpointProxy'
    || route.kind === 'endpointImportOpenAICompatible'
  ) {
    if (
      route.kind === 'endpointRerank'
      || route.kind === 'endpointImageGeneration'
      || route.kind === 'endpointVideoGenerationCreate'
      || route.kind === 'endpointVideoGenerationPoll'
      || route.kind === 'endpointVideoGenerationCancel'
      || route.kind === 'endpointProxy'
      || (route.kind === 'endpoints' && method === 'GET')
      || (route.kind === 'endpointItem' && method === 'GET')
    ) {
      return ['project:endpoint:use'];
    }
    return ['project:endpoint:manage'];
  }

  return [];
}

export function buildUpstreamUrl(baseUrl: string, proxyPath: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = proxyPath.replace(/^\/+/, '');
  if (!cleanPath) return cleanBase;

  // Be tolerant of legacy/base URLs that already include the target API path.
  // Example: base_url ".../chat/completions" + proxyPath "chat/completions".
  if (
    cleanBase.toLowerCase().endsWith(`/${cleanPath.toLowerCase()}`) ||
    cleanBase.toLowerCase().endsWith(cleanPath.toLowerCase())
  ) {
    return cleanBase;
  }

  return `${cleanBase}/${cleanPath}`;
}

function sseWrite(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: NodeApiDeps,
): Promise<void> {
  applyCors(res);
  const method = req.method ?? 'GET';
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const requestUrl = new URL(req.url ?? '', 'http://localhost');
  if (handleApiDocsRoute(req, res, requestUrl, json)) {
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/notebook-runtime-metrics' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    json(res, 200, getNotebookRuntimeMetricsSnapshot());
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/notebook-runtime-metrics/prometheus' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(getNotebookRuntimeMetricsPrometheusText());
    return;
  }

  const route = matchProjectsRoute(req.url ?? '');
  if (!route) {
    json(res, 404, { error_code: 'NOT_FOUND', message: 'Route not found' });
    return;
  }

  try {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const rawBearerToken = extractBearerToken(req);

    const workspaces = buildWorkspaceRecords();
    const defaultWorkspace = workspaces[0];

    if (routeHasProjectScope(route)) {
      const required = requiredProjectPermissions(route, method);
      if (required.length > 0) {
        try {
          const project = await deps.getProjectUseCase.execute({
            workspaceId: route.workspaceId,
            projectId: route.projectId,
          });
          const granted = new Set(resolveProjectPermissions(project.owner_id, user.id));
          const missing = required.filter((permission) => !granted.has(permission));
          if (missing.length > 0) {
            json(res, 403, { error_code: 'FORBIDDEN', message: 'forbidden', missing_permissions: missing });
            return;
          }
        } catch {
          // Keep compatibility with in-memory local routes that are not yet tied to project repo records.
        }
      }
    }

    const handledProjectSourceRoute = await handleProjectSourceRoute({
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
      ownerWorkspacePermissions: OWNER_WORKSPACE_PERMISSIONS,
      resolveProjectPermissions,
    });
    if (handledProjectSourceRoute) {
      return;
    }

    if (isChatRoute(route)) {
      const handledChatNonStream = await handleChatNonStreamRoute({
        route,
        method,
        req,
        res,
        deps,
        requestUrl,
        json,
        readBody,
      });
      if (handledChatNonStream) {
        return;
      }

      const handledChatStream = await handleChatStreamRoute({
        route,
        method,
        req,
        res,
        deps,
        json,
        readBody,
        buildUpstreamUrl,
        sseWrite,
      });
      if (handledChatStream) {
        return;
      }
    }

    if (isAgentRoute(route)) {
      const handledAgentRoute = await handleAgentRoute({
        route,
        method,
        req,
        res,
        deps,
        json,
        readBody,
      });
      if (handledAgentRoute) {
        return;
      }
    }

    if (isTaskRoute(route)) {
      const handledTaskRoute = await handleTaskRoute({
        route,
        method,
        req,
        res,
        deps,
        user,
        rawBearerToken,
        json,
        readBody,
      });
      if (handledTaskRoute) {
        return;
      }
    }

    const handledEndpointRoute = await handleEndpointRoute({
      route,
      method,
      req,
      res,
      deps,
      json,
      readBody,
      buildUpstreamUrl,
      proxyJsonRequest,
    });
    if (handledEndpointRoute) {
      return;
    }

    json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  } catch (error) {
    const mapped = mapRequestError(error);
    json(res, mapped.status, mapped.body);
  }
}
