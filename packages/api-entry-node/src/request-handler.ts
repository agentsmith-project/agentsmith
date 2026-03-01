import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';
import { extractBearerToken, verifyBearerToken } from './auth.js';
import { handleProjectSourceRoute } from './project-source-route-handler.js';
import { handleAuditUsageRoute } from './audit-usage-route-handler.js';
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import { handleChatStreamRoute } from './chat-stream-handler.js';
import { handleEndpointRoute } from './endpoint-route-handler.js';
import { handleRuntimeRoute } from './runtime-route-handler.js';
import { handleAgentRoute } from './agent-route-handler.js';
import { matchProjectsRoute, type ProjectsRoute } from './projects-route-match.js';
import type { ChatRoute } from './chat-route-match.js';
import {
  OWNER_WORKSPACE_PERMISSIONS,
  buildWorkspaceRecords,
  resolveProjectPermissions,
} from './workspace-permissions.js';
import { resolveProjectPermissionsForRequest } from './project-authz-resolver.js';
import { applyCors, json, proxyJsonRequest, readBody, unauthorized } from './http-utils.js';
import { mapRequestError } from './error-mapper.js';
import { handleApiDocsRoute } from './api-docs-handler.js';
import { handleMeRoute } from './me-route-handler.js';
import { getReleaseReportDetail, listReleaseReports } from './release-report-store.js';
import { createReleasePolicyOverride, listReleasePolicyOverrides, updateReleasePolicyOverrideDecision } from './release-policy-override-store.js';
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

  if (
    route.kind === 'audit'
    || route.kind === 'usage'
    || route.kind === 'usageKpi'
    || route.kind === 'usageTimeseries'
    || route.kind === 'quotaSummary'
  ) {
    return route.kind === 'audit' ? ['project:audit:view'] : ['project:usage:view'];
  }

  if (
    route.kind === 'projectMembers'
    || route.kind === 'projectJoinRequests'
    || route.kind === 'projectJoinRequestApprove'
    || route.kind === 'projectJoinRequestReject'
    || route.kind === 'projectPermissionTemplates'
    || route.kind === 'projectPermissionTemplateItem'
    || route.kind === 'projectQuotaTemplates'
    || route.kind === 'projectQuotaTemplateItem'
    || route.kind === 'projectQuotaTemplateApply'
    || route.kind === 'projectGroups'
    || route.kind === 'projectGroupItem'
    || route.kind === 'projectGroupApplyTemplate'
    || route.kind === 'projectMembershipItem'
    || route.kind === 'projectMemberPermissions'
    || route.kind === 'projectMemberQuotaOverrides'
    || route.kind === 'projectMemberQuotaOverridesHistory'
    || route.kind === 'projectMemberChangeHistory'
    || route.kind === 'projectResourcePolicy'
  ) {
    if (
      route.kind === 'projectJoinRequestApprove'
      || route.kind === 'projectJoinRequestReject'
      || route.kind === 'projectPermissionTemplates'
      || route.kind === 'projectPermissionTemplateItem'
      || route.kind === 'projectQuotaTemplates'
      || route.kind === 'projectQuotaTemplateItem'
      || route.kind === 'projectQuotaTemplateApply'
      || route.kind === 'projectGroupItem'
      || route.kind === 'projectGroupApplyTemplate'
      || route.kind === 'projectMembershipItem'
      || route.kind === 'projectMemberPermissions'
      || route.kind === 'projectMemberQuotaOverrides'
      || route.kind === 'projectResourcePolicy'
    ) {
      return method === 'GET' ? ['project:member:view'] : ['project:member:manage'];
    }
    return ['project:member:view'];
  }

  if (isAgentRoute(route)) {
    if (method === 'GET') return ['project:agent:use'];
    return ['project:agent:manage'];
  }

  if (route.kind === 'credentials' || route.kind === 'credentialItem' || route.kind === 'credentialRotate') {
    return ['project:credential:manage'];
  }

  if (
    route.kind === 'llmUnifiedChat'
    || route.kind === 'runtimeProviders'
    || route.kind === 'runtimeProviderItem'
    || route.kind === 'runtimeModels'
    || route.kind === 'runtimeRoutingAliases'
    || route.kind === 'runtimeRoutingCombos'
    || route.kind === 'runtimePricing'
  ) {
    if (route.kind === 'llmUnifiedChat') {
      return ['project:endpoint:use'];
    }
    return ['project:endpoint:manage'];
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

  if (requestUrl.pathname === '/api/v1/internal/usage-report-runner' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    json(res, 200, deps.usageReportRunner?.getStatus() ?? {
      enabled: false,
      interval_ms: 60000,
      running: false,
      run_count: 0,
      last_status: 'idle',
    });
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/usage-report-runner/run-due' && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    if (!deps.usageReportRunner) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'usage_report_runner_unavailable' });
      return;
    }
    try {
      const result = await deps.usageReportRunner.runOnce('manual');
      json(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'usage_report_runner_failed';
      json(res, 409, { error_code: 'RUNNER_BUSY', message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/release-reports' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    json(res, 200, {
      items: listReleaseReports(deps.releaseReportsDir ?? 'artifacts/release-reports'),
    });
    return;
  }

  if (requestUrl.pathname.startsWith('/api/v1/internal/release-reports/') && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const reportName = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/release-reports/', ''));
    const detail = getReleaseReportDetail(deps.releaseReportsDir ?? 'artifacts/release-reports', reportName);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'release_report_not_found' });
      return;
    }
    json(res, 200, detail);
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/release-policy-overrides' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const workspaceId = requestUrl.searchParams.get('workspace_id')?.trim();
    const projectId = requestUrl.searchParams.get('project_id')?.trim();
    const reportName = requestUrl.searchParams.get('report_name')?.trim();
    if (!workspaceId || !projectId || !reportName) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'workspace_id, project_id, and report_name are required' });
      return;
    }
    const items = await listReleasePolicyOverrides(deps.docStore, {
      workspaceId,
      projectId,
      reportName,
    });
    json(res, 200, { items });
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/release-policy-overrides' && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const body = await readBody(req) as Record<string, unknown>;
    const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id.trim() : '';
    const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
    const reportName = typeof body.report_name === 'string' ? body.report_name.trim() : '';
    const issueId = typeof body.issue_id === 'string' ? body.issue_id.trim() : '';
    const issueSource = body.issue_source === 'execution' || body.issue_source === 'runtime' || body.issue_source === 'usage'
      ? body.issue_source
      : null;
    const issueMessage = typeof body.issue_message === 'string' ? body.issue_message.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!workspaceId || !projectId || !reportName || !issueId || !issueSource || !issueMessage || !reason) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'workspace_id, project_id, report_name, issue_id, issue_source, issue_message, and reason are required' });
      return;
    }
    const record = await createReleasePolicyOverride(deps.docStore, {
      workspaceId,
      projectId,
      reportName,
      issueId,
      issueSource,
      issueMessage,
      reason,
      createdByUserId: user.id,
      createdByName: user.name,
    });
    json(res, 201, record);
    return;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/release-policy-overrides\/[^/]+\/decision\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const overrideId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/release-policy-overrides/', '').replace('/decision', '').replace(/\/$/, ''));
    const body = await readBody(req) as Record<string, unknown>;
    const status = body.status === 'approved' || body.status === 'rejected' ? body.status : null;
    if (!overrideId || !status) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'override id and decision status are required' });
      return;
    }
    const updated = await updateReleasePolicyOverrideDecision(deps.docStore, {
      overrideId,
      status,
      decidedByUserId: user.id,
      decidedByName: user.name,
    });
    if (!updated) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'release_policy_override_not_found' });
      return;
    }
    json(res, 200, updated);
    return;
  }

  try {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    if (requestUrl.pathname === '/api/v1/sse-ticket' && method === 'POST') {
      const bearerToken = extractBearerToken(req);
      if (!bearerToken) {
        unauthorized(res);
        return;
      }
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const host = req.headers.host || 'localhost';
      const protocol = (req.headers['x-forwarded-proto'] as string | undefined) || 'http';
      json(res, 200, {
        ticket: bearerToken,
        expires_at: expiresAt,
        max_connections: 1,
        sso_url: `${protocol}://${host}/api/v1/events?ticket=${encodeURIComponent(bearerToken)}`,
      });
      return;
    }
    if (await handleMeRoute({ req, res, method, requestUrl, user })) {
      return;
    }
    const route = matchProjectsRoute(req.url ?? '');
    if (!route) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Route not found' });
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
          const granted = new Set(resolveProjectPermissionsForRequest({
            workspaceId: route.workspaceId,
            projectId: route.projectId,
            projectOwnerId: project.owner_id,
            actorUserId: user.id,
          }));
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

    const handledAuditUsageRoute = await handleAuditUsageRoute({
      route,
      method,
      req,
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

    const handledRuntimeRoute = await handleRuntimeRoute({
      route,
      method,
      req,
      res,
      deps,
      user,
      json,
      readBody,
    });
    if (handledRuntimeRoute) {
      return;
    }

    const handledEndpointRoute = await handleEndpointRoute({
      route,
      method,
      req,
      res,
      deps,
      user,
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
