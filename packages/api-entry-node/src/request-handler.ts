import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';
import { extractBearerToken, verifyRequestAuth } from './auth.js';
import { handleProjectRoute } from './project-route-handler.js';
import { handleAuditUsageRoute } from './audit-usage-route-handler.js';
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import { handleChatStreamRoute } from './chat-stream-handler.js';
import { handleEndpointRoute } from './endpoint-route-handler.js';
import { handleModelConfigRoute } from './model-config-route-handler.js';
import { handleAgentRoute } from './agent-route-handler.js';
import { matchProjectsRoute } from './projects-route-match.js';
import {
  buildWorkspaceRecords,
} from './workspace-permissions.js';
import {
  evaluateProjectPermissions,
  evaluateResourcePolicyAuthorization,
  mapAuthorizationRequestToPermission,
} from './project-authz-engine.js';
import { applyCors, json, proxyJsonRequest, readBody, unauthorized } from './http-utils.js';
import { mapRequestError } from './error-mapper.js';
import { handleApiDocsRoute } from './api-docs-handler.js';
import { handleMeRoute } from './me-route-handler.js';
import { handleUserKeyRoute } from './user-key-route-handler.js';
import { handleContextRoute } from './context-route-handler.js';
import {
  handleTaskRoute,
} from './task-route-handler.js';
import { issueSSETicket } from './sse-ticket-store.js';
import { isAgentExecutionTicket } from './internal-ticket-store.js';
import {
  exchangeDesktopAuthRequest,
  getDesktopAuthRequest,
  startDesktopAuthRequest,
} from './desktop-auth-store.js';
import { buildUpstreamUrl } from './request-handler/build-upstream-url.js';
import { handleInternalRoutes } from './request-handler/internal-routes.js';
import { handleJoinInviteActionRoute } from './project-invite-routes.js';
import {
  isAgentRoute,
  isChatRoute,
  isTaskRoute,
  routeHasProjectScope,
} from './request-handler/route-kind-guards.js';
import { requiredProjectPermissions } from './request-handler/required-project-permissions.js';

type AuthorizationRequestBody = {
  subject?: {
    type?: 'user' | 'group' | 'agent';
    id?: string;
  };
  action?: string;
  resource?: {
    type?: 'project' | 'endpoint' | 'file_library' | 'agent';
    id?: string;
  };
  context?: {
    end_user_id?: string;
    metadata?: Record<string, unknown>;
  };
};

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

  if (
    await handleInternalRoutes({
      req,
      res,
      method,
      requestUrl,
      deps,
      json,
      readBody,
    })
  ) {
      return;
    }

  try {
    if (requestUrl.pathname === '/api/v1/desktop/auth/start' && method === 'POST') {
      const body = (await readBody(req)) as { deployment_base_url?: string } | null;
      const deploymentBaseUrl = body?.deployment_base_url?.trim().replace(/\/+$/, '') ?? '';
      if (!/^https?:\/\/[^/]+/i.test(deploymentBaseUrl)) {
        json(res, 400, {
          error_code: 'VALIDATION_ERROR',
          message: 'desktop_auth_invalid_deployment_base_url',
        });
        return;
      }
      const started = await startDesktopAuthRequest(deps.cache, {
        deploymentBaseUrl,
      });
      json(res, 201, {
        request_id: started.request_id,
        browser_start_url: `${deploymentBaseUrl}/en-US/desktop/auth/request?desktop_auth_request_id=${encodeURIComponent(started.request_id)}`,
        poll_url: `/api/v1/desktop/auth/requests/${encodeURIComponent(started.request_id)}`,
        poll_interval_ms: 1500,
        expires_at: started.expires_at,
      });
      return;
    }
    const desktopAuthRequestMatch = requestUrl.pathname.match(/^\/api\/v1\/desktop\/auth\/requests\/([^/]+)$/);
    if (desktopAuthRequestMatch && method === 'GET') {
      const requestId = decodeURIComponent(desktopAuthRequestMatch[1] ?? '');
      const snapshot = await getDesktopAuthRequest(deps.cache, requestId);
      if (!snapshot) {
        json(res, 404, {
          error_code: 'NOT_FOUND',
          message: 'desktop_auth_request_not_found',
        });
        return;
      }
      json(res, 200, snapshot);
      return;
    }
    if (requestUrl.pathname === '/api/v1/desktop/auth/exchange' && method === 'POST') {
      const body = (await readBody(req)) as {
        request_id?: string;
        exchange_ticket?: string;
      } | null;
      const requestId = body?.request_id?.trim() ?? '';
      const exchangeTicket = body?.exchange_ticket?.trim() ?? '';
      if (!requestId || !exchangeTicket) {
        json(res, 400, {
          error_code: 'VALIDATION_ERROR',
          message: 'desktop_auth_exchange_invalid_request',
        });
        return;
      }
      const exchanged = await exchangeDesktopAuthRequest(deps.cache, {
        requestId,
        exchangeTicket,
      });
      if (!exchanged) {
        json(res, 401, {
          error_code: 'UNAUTHORIZED',
          message: 'desktop_auth_exchange_failed',
        });
        return;
      }
      json(res, 200, {
        access_token: exchanged.accessToken,
        signed_in_user: exchanged.signedInUser,
      });
      return;
    }

    const requestAuth = await verifyRequestAuth(req, { cache: deps.cache, docStore: deps.docStore });
    if (!requestAuth) {
      unauthorized(res);
      return;
    }
    const { user, internalTicket } = requestAuth;
    const route = matchProjectsRoute(req.url ?? '');
    if (isAgentExecutionTicket(internalTicket)) {
      const agentExecutionRouteAllowed =
        (
          route !== null
          && (
            (route.kind === 'endpointProxy' && method === 'POST')
            || (route.kind === 'taskWorkspaceAccess' && method === 'POST')
          )
        )
        || requestUrl.pathname === '/api/v1/context'
        || requestUrl.pathname === '/api/v1/context/list'
        || /^\/api\/v1\/context\/managed-credentials\/[^/]+\/refresh$/.test(requestUrl.pathname);
      if (!agentExecutionRouteAllowed) {
        json(res, 403, {
          error_code: 'INTERNAL_TICKET_PURPOSE_MISMATCH',
          message: 'internal_ticket_purpose_mismatch',
        });
        return;
      }
    }
    if (requestUrl.pathname === '/api/v1/sse-ticket' && method === 'POST') {
      const bearerToken = extractBearerToken(req);
      if (!bearerToken) {
        unauthorized(res);
        return;
      }
      const issued = await issueSSETicket(deps.cache, { bearerToken, maxConnections: 1 });
      const host = req.headers.host || 'localhost';
      const protocol = (req.headers['x-forwarded-proto'] as string | undefined) || 'http';
      json(res, 200, {
        ticket: issued.ticket,
        expires_at: issued.expiresAt,
        max_connections: issued.maxConnections,
        sso_url: `${protocol}://${host}/api/v1/events?ticket=${encodeURIComponent(issued.ticket)}`,
      });
      return;
    }
    if (await handleMeRoute({
      req,
      res,
      method,
      requestUrl,
      user,
      cache: deps.cache,
      docStore: deps.docStore,
      governanceIncidentsDir: deps.governanceIncidentsDir,
    })) {
      return;
    }
    if (await handleContextRoute({
      req,
      res,
      method,
      requestUrl,
      deps,
      user,
      internalTicket,
      json,
      readBody,
    })) {
      return;
    }
    if (await handleUserKeyRoute({
      req,
      res,
      method,
      requestUrl,
      user,
      docStore: deps.docStore,
      json,
    })) {
      return;
    }
    if (await handleJoinInviteActionRoute({
      pathname: requestUrl.pathname,
      method,
      req,
      res,
      deps,
      user,
      json,
      readBody,
    })) {
      return;
    }
    if (!route) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Route not found' });
      return;
    }
    const workspaces = await buildWorkspaceRecords();
    const defaultWorkspace = workspaces[0];

    if (routeHasProjectScope(route)) {
      const required = requiredProjectPermissions(route, method);
      if (required.length > 0) {
        try {
          const project = await deps.getProjectUseCase.execute({
            workspaceId: route.workspaceId,
            projectId: route.projectId,
          });
          const evaluation = await evaluateProjectPermissions({
            docStore: deps.docStore,
            workspaceId: route.workspaceId,
            projectId: route.projectId,
            projectOwnerId: project.owner_id,
            projectGovernance: project.governance_json,
            actorUserId: user.id,
            requiredPermissions: required,
          });
          const missing = evaluation.decisions.filter((item) => !item.granted).map((item) => item.permission);
          if (missing.length > 0) {
            json(res, 403, {
              error_code: 'FORBIDDEN',
              message: 'forbidden',
              missing_permissions: missing,
              authz_decision: {
                membership_status: evaluation.membership_status,
                decisions: evaluation.decisions,
              },
            });
            return;
          }
        } catch {
          // Ignore authorization introspection failures on routes that are not bound to a project resource record.
        }
      }
    }

    if (route.kind === 'projectAuthorize' && method === 'POST') {
      const body = await readBody(req) as AuthorizationRequestBody;
      if (
        !body
        || typeof body !== 'object'
        || !body.subject
        || !body.resource
        || typeof body.action !== 'string'
        || (body.subject.type !== 'user' && body.subject.type !== 'group' && body.subject.type !== 'agent')
        || typeof body.subject.id !== 'string'
        || (body.resource.type !== 'project' && body.resource.type !== 'endpoint'
          && body.resource.type !== 'file_library' && body.resource.type !== 'agent')
        || typeof body.resource.id !== 'string'
      ) {
        json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_authorization_request' });
        return;
      }

      const project = await deps.getProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      const actorGate = await evaluateProjectPermissions({
        docStore: deps.docStore,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        projectOwnerId: project.owner_id,
        projectGovernance: project.governance_json,
        actorUserId: user.id,
        requiredPermissions:
          body.subject.type === 'user' && body.subject.id === user.id
            ? ['project:endpoint:use']
            : ['project:audit:read'],
      });
      if (actorGate.decisions.some((item) => !item.granted)) {
        json(res, 403, { error_code: 'FORBIDDEN', message: 'forbidden' });
        return;
      }

      const permission = mapAuthorizationRequestToPermission({
        resourceType: body.resource.type,
        action: body.action,
      });
      if (!permission) {
        json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'unsupported_authorization_action' });
        return;
      }

      const permissionEvaluation = await evaluateProjectPermissions({
        docStore: deps.docStore,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        projectOwnerId: project.owner_id,
        projectGovernance: project.governance_json,
        actorUserId: body.subject.id,
        requiredPermissions: [permission],
      });
      const permissionDecision = permissionEvaluation.decisions[0];
      if (!permissionDecision) {
        json(res, 500, { error_code: 'INTERNAL_ERROR', message: 'authorization_decision_missing' });
        return;
      }
      if (!permissionDecision.granted) {
        json(res, 200, {
          allowed: false,
          decision: {
            source: permissionDecision.source,
            rule_id: permissionDecision.permission,
            reason: permissionDecision.reason,
          },
        });
        return;
      }

      if (body.resource.type === 'endpoint' || body.resource.type === 'file_library' || body.resource.type === 'agent') {
        const policyDecision = await evaluateResourcePolicyAuthorization({
          docStore: deps.docStore,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          resourceType: body.resource.type,
          resourceId: body.resource.id,
          subjectType: body.subject.type,
          subjectId: body.subject.id,
        });
        if (!policyDecision.allowed) {
          json(res, 200, {
            allowed: false,
            decision: {
              source: 'resource_policy',
              rule_id: policyDecision.matched_policy?.id,
              reason: policyDecision.reason ?? 'resource_policy_denied',
            },
            matched_policy: policyDecision.matched_policy,
          });
          return;
        }
        json(res, 200, {
          allowed: true,
          decision: {
            source: policyDecision.matched_policy ? 'resource_policy' : permissionDecision.source,
            rule_id: policyDecision.matched_policy?.id ?? permissionDecision.permission,
            reason: policyDecision.matched_policy ? 'resource_policy_allowed' : permissionDecision.reason,
          },
          matched_policy: policyDecision.matched_policy,
        });
        return;
      }

      json(res, 200, {
        allowed: true,
        decision: {
          source: permissionDecision.source,
          rule_id: permissionDecision.permission,
          reason: permissionDecision.reason,
        },
      });
      return;
    }

    const handledProjectRoute = await handleProjectRoute({
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
    });
    if (handledProjectRoute) {
      return;
    }

    const handledAuditUsageRoute = await handleAuditUsageRoute({
      route,
      method,
      requestUrl,
      res,
      json,
      deps,
      user,
    });
    if (handledAuditUsageRoute) {
      return;
    }

    if (isChatRoute(route)) {
      const handledChatNonStream = await handleChatNonStreamRoute({
        route,
        method,
        req,
        res,
        deps,
        user,
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
        user,
        internalTicket,
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
        user,
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
        internalTicket,
        json,
        readBody,
      });
      if (handledTaskRoute) {
        return;
      }
    }

    const handledModelConfigRoute = await handleModelConfigRoute({
      route,
      method,
      req,
      res,
      deps,
      user,
      json,
      readBody,
    });
    if (handledModelConfigRoute) {
      return;
    }

    const handledEndpointRoute = await handleEndpointRoute({
      route,
      method,
      req,
      res,
      deps,
      user,
      internalTicket,
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
    if (process.env.DEBUG_REQUEST_ERRORS === '1') {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`[api-entry-node] request error: ${message}\n`);
    }
    const mapped = mapRequestError(error);
    if (res.headersSent || res.writableEnded || res.destroyed) {
      return;
    }
    json(res, mapped.status, mapped.body);
  }
}
