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
import { appendUserNotification } from './me-notifications-store.js';
import { getReleaseEscalationDetail, listReleaseEscalations } from './release-escalation-store.js';
import {
  acknowledgeReleaseEscalation,
  assignReleaseEscalation,
  getReleaseEscalationState,
  listReleaseEscalationStates,
  setReleaseEscalationResolution,
} from './release-escalation-state-store.js';
import { getReleaseReportDetail, listReleaseReports } from './release-report-store.js';
import { getReleaseGateRunDetail, listReleaseGateRuns } from './release-run-store.js';
import {
  createReleasePolicyOverride,
  getReleasePolicyOverrideEffectiveStatus,
  listReleasePolicyOverrides,
  updateReleasePolicyOverrideDecision,
} from './release-policy-override-store.js';
import {
  getNotebookRuntimeMetricsPrometheusText,
  getNotebookRuntimeMetricsSnapshot,
  handleTaskRoute,
} from './task-route-handler.js';
import { enforceReleasePolicy, type ReleasePolicyEvaluation } from '../../../src/lib/release-policy.js';

type ReleaseReportPolicyShape = {
  summary?: {
    release_policy?: ReleasePolicyEvaluation;
  };
};

async function buildPolicyEnforcement(
  deps: NodeApiDeps,
  reportName: string,
  report: Record<string, unknown>,
  scope?: { workspaceId?: string | null; projectId?: string | null },
) {
  const evaluation = (report as ReleaseReportPolicyShape).summary?.release_policy;
  if (!evaluation) return undefined;
  const workspaceId = scope?.workspaceId?.trim();
  const projectId = scope?.projectId?.trim();
  const overrides = workspaceId && projectId
    ? await listReleasePolicyOverrides(deps.docStore, { workspaceId, projectId, reportName })
    : [];
  return enforceReleasePolicy(
    evaluation,
    overrides.map((item) => {
      const effectiveStatus = getReleasePolicyOverrideEffectiveStatus(item);
      return {
        issue_id: item.issue_id,
        status: effectiveStatus === 'expired' ? 'rejected' : effectiveStatus,
      };
    }),
  );
}

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

function mergeEscalationState(
  event: {
    status: 'open' | 'resolved';
    acknowledged_at?: string;
    acknowledged_by_user_id?: string;
    acknowledged_by_name?: string;
    assignee_user_id?: string;
    assignee_name?: string;
    due_at?: string;
    resolution_reason?: string;
    resolution_category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
    resolved_at?: string;
    resolved_by_user_id?: string;
    resolved_by_name?: string;
  } & Record<string, unknown>,
  state?: {
    acknowledged_at?: string;
    acknowledged_by_user_id?: string;
    acknowledged_by_name?: string;
    assignee_user_id?: string;
    assignee_name?: string;
    due_at?: string;
    resolution_status?: 'open' | 'resolved';
    resolution_reason?: string;
    resolution_category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
    resolved_at?: string;
    resolved_by_user_id?: string;
    resolved_by_name?: string;
  } | null,
) {
  const status = state?.resolution_status ?? event.status;
  const dueAt = state?.due_at ?? event.due_at;
  const now = Date.now();
  const dueTime = dueAt ? new Date(dueAt).getTime() : Number.NaN;
  const ageMs = typeof event.created_at === 'string' ? now - new Date(event.created_at).getTime() : undefined;
  let slaStatus: 'on_track' | 'due_soon' | 'overdue' | 'resolved' = 'on_track';
  if (status === 'resolved') {
    slaStatus = 'resolved';
  } else if (!Number.isNaN(dueTime)) {
    const remainingMs = dueTime - now;
    if (remainingMs < 0) slaStatus = 'overdue';
    else if (remainingMs <= 4 * 60 * 60 * 1000) slaStatus = 'due_soon';
  }
  return {
    ...event,
    status,
    acknowledged_at: state?.acknowledged_at ?? event.acknowledged_at,
    acknowledged_by_user_id: state?.acknowledged_by_user_id ?? event.acknowledged_by_user_id,
    acknowledged_by_name: state?.acknowledged_by_name ?? event.acknowledged_by_name,
    assignee_user_id: state?.assignee_user_id ?? event.assignee_user_id,
    assignee_name: state?.assignee_name ?? event.assignee_name,
    due_at: dueAt,
    resolution_reason: state?.resolution_reason ?? event.resolution_reason,
    resolution_category: state?.resolution_category ?? event.resolution_category,
    resolved_at: state?.resolved_at ?? event.resolved_at,
    resolved_by_user_id: state?.resolved_by_user_id ?? event.resolved_by_user_id,
    resolved_by_name: state?.resolved_by_name ?? event.resolved_by_name,
    age_ms: Number.isNaN(ageMs) ? undefined : ageMs,
    sla_status: slaStatus,
  };
}

function withOverrideEffectiveStatus<T extends { status: 'pending' | 'approved' | 'rejected'; expires_at: string }>(
  record: T,
): T & { effective_status: 'pending' | 'approved' | 'rejected' | 'expired' } {
  const effectiveStatus = record.status === 'approved' && record.expires_at.localeCompare(new Date().toISOString()) < 0
    ? 'expired'
    : record.status;
  return {
    ...record,
    effective_status: effectiveStatus,
  };
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
    const workspaceId = requestUrl.searchParams.get('workspace_id');
    const projectId = requestUrl.searchParams.get('project_id');
    const reports = listReleaseReports(deps.releaseReportsDir ?? 'artifacts/release-reports');
    const items = await Promise.all(
      reports.map(async (item) => {
        const detail = getReleaseReportDetail(deps.releaseReportsDir ?? 'artifacts/release-reports', item.name);
        if (!detail) return item;
        return {
          ...item,
          policy_enforcement: await buildPolicyEnforcement(deps, item.name, detail.report, { workspaceId, projectId }),
        };
      }),
    );
    json(res, 200, {
      items,
    });
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/release-gate-runner' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    json(res, 200, deps.releaseGateRunner?.getStatus() ?? {
      running: false,
      recent_operations: [],
    });
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/release-gate-runner/trigger' && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    if (!deps.releaseGateRunner) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'release_gate_runner_unavailable' });
      return;
    }
    const body = await readBody(req) as Record<string, unknown>;
    const mode = body.mode === 'full' || body.mode === 'failed_only' ? body.mode : null;
    const sourceRunId = typeof body.source_run_id === 'string' ? body.source_run_id.trim() : undefined;
    const notes = typeof body.notes === 'string' ? body.notes.trim() : undefined;
    if (!mode) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'mode is required' });
      return;
    }
    if (mode === 'failed_only' && !sourceRunId) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'source_run_id is required for failed_only rerun' });
      return;
    }
    try {
      const operation = await deps.releaseGateRunner.triggerRun({
        mode,
        sourceRunId,
        notes,
        actorUserId: user.id,
        actorName: user.name,
      });
      json(res, 202, operation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'release_gate_runner_failed';
      const status = message === 'release_gate_runner_busy' ? 409 : 422;
      json(res, status, { error_code: 'RELEASE_GATE_RUNNER_ERROR', message });
    }
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
    const workspaceId = requestUrl.searchParams.get('workspace_id');
    const projectId = requestUrl.searchParams.get('project_id');
    json(res, 200, {
      ...detail,
      policy_enforcement: await buildPolicyEnforcement(deps, reportName, detail.report, { workspaceId, projectId }),
    });
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/release-runs' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const workspaceId = requestUrl.searchParams.get('workspace_id');
    const projectId = requestUrl.searchParams.get('project_id');
    const runs = listReleaseGateRuns(deps.releaseRunsDir ?? 'artifacts/release-runs');
    const items = await Promise.all(
      runs.map(async (item) => {
        const detail = getReleaseReportDetail(deps.releaseReportsDir ?? 'artifacts/release-reports', item.report_name);
        if (!detail) return item;
        return {
          ...item,
          policy_enforcement: await buildPolicyEnforcement(deps, item.report_name, detail.report, { workspaceId, projectId }),
        };
      }),
    );
    json(res, 200, {
      items,
    });
    return;
  }

  if (requestUrl.pathname.startsWith('/api/v1/internal/release-runs/') && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const runName = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/release-runs/', ''));
    const detail = getReleaseGateRunDetail(deps.releaseRunsDir ?? 'artifacts/release-runs', runName);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'release_run_not_found' });
      return;
    }
    const workspaceId = requestUrl.searchParams.get('workspace_id');
    const projectId = requestUrl.searchParams.get('project_id');
    const report = getReleaseReportDetail(deps.releaseReportsDir ?? 'artifacts/release-reports', detail.report_name);
    json(res, 200, {
      ...detail,
      policy_enforcement: report
        ? await buildPolicyEnforcement(deps, detail.report_name, report.report, { workspaceId, projectId })
        : undefined,
    });
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/release-escalations' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const items = listReleaseEscalations(deps.releaseEscalationsDir ?? 'artifacts/release-escalations');
    const states = await listReleaseEscalationStates(deps.docStore);
    const stateById = new Map(states.map((item) => [item.id, item]));
    json(res, 200, {
      items: items.map((item) => mergeEscalationState(item, stateById.get(item.id))),
    });
    return;
  }

  if (requestUrl.pathname.startsWith('/api/v1/internal/release-escalations/') && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/release-escalations/', ''));
    const detail = getReleaseEscalationDetail(deps.releaseEscalationsDir ?? 'artifacts/release-escalations', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'release_escalation_not_found' });
      return;
    }
    const state = await getReleaseEscalationState(deps.docStore, escalationId);
    json(res, 200, mergeEscalationState(detail, state));
    return;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/release-escalations\/[^/]+\/acknowledge\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/release-escalations/', '').replace('/acknowledge', '').replace(/\/$/, ''));
    const detail = getReleaseEscalationDetail(deps.releaseEscalationsDir ?? 'artifacts/release-escalations', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'release_escalation_not_found' });
      return;
    }
    const state = await acknowledgeReleaseEscalation(deps.docStore, {
      escalationId,
      userId: user.id,
      userName: user.name,
    });
    appendUserNotification(user.id, {
      type: 'release_escalation_acknowledged',
      title: 'Release escalation acknowledged',
      body: detail.title,
      link_url: null,
    });
    json(res, 200, mergeEscalationState(detail, state));
    return;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/release-escalations\/[^/]+\/assignment\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/release-escalations/', '').replace('/assignment', '').replace(/\/$/, ''));
    const detail = getReleaseEscalationDetail(deps.releaseEscalationsDir ?? 'artifacts/release-escalations', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'release_escalation_not_found' });
      return;
    }
    const body = await readBody(req) as Record<string, unknown>;
    const assigneeUserId = typeof body.assignee_user_id === 'string' ? body.assignee_user_id.trim() : '';
    const assigneeName = typeof body.assignee_name === 'string' ? body.assignee_name.trim() : undefined;
    const dueAt = typeof body.due_at === 'string' ? body.due_at.trim() : undefined;
    const dueDate = dueAt ? new Date(dueAt) : undefined;
    if (!assigneeUserId) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'assignee_user_id is required' });
      return;
    }
    if (dueAt && (!dueDate || Number.isNaN(dueDate.getTime()))) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'due_at must be a valid ISO timestamp' });
      return;
    }
    const state = await assignReleaseEscalation(deps.docStore, {
      escalationId,
      assigneeUserId,
      assigneeName,
      dueAt,
    });
    appendUserNotification(user.id, {
      type: 'release_escalation_assigned',
      title: 'Release escalation assigned',
      body: detail.title,
      link_url: null,
    });
    json(res, 200, mergeEscalationState(detail, state));
    return;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/release-escalations\/[^/]+\/resolution\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/release-escalations/', '').replace('/resolution', '').replace(/\/$/, ''));
    const detail = getReleaseEscalationDetail(deps.releaseEscalationsDir ?? 'artifacts/release-escalations', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'release_escalation_not_found' });
      return;
    }
    const body = await readBody(req) as Record<string, unknown>;
    const status = body.status === 'open' || body.status === 'resolved' ? body.status : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : undefined;
    const category = body.category === 'mitigated'
      || body.category === 'accepted_risk'
      || body.category === 'false_positive'
      || body.category === 'deferred'
      ? body.category
      : undefined;
    if (!status) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'resolution status is required' });
      return;
    }
    if (status === 'resolved' && !category) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'resolution category is required when resolving escalation' });
      return;
    }
    const state = await setReleaseEscalationResolution(deps.docStore, {
      escalationId,
      status,
      reason,
      category,
      userId: user.id,
      userName: user.name,
    });
    appendUserNotification(user.id, {
      type: 'release_escalation_resolved',
      title: status === 'resolved' ? 'Release escalation resolved' : 'Release escalation reopened',
      body: detail.title,
      link_url: null,
    });
    json(res, 200, mergeEscalationState(detail, state));
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
    json(res, 200, { items: items.map((item) => withOverrideEffectiveStatus(item)) });
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
    const reasonCategory = body.reason_category === 'upstream_transient'
      || body.reason_category === 'known_acceptable_risk'
      || body.reason_category === 'rollout_exception'
      || body.reason_category === 'governance_window'
      ? body.reason_category
      : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const expiresAt = typeof body.expires_at === 'string' ? body.expires_at.trim() : '';
    const expiresDate = expiresAt ? new Date(expiresAt) : null;
    if (!workspaceId || !projectId || !reportName || !issueId || !issueSource || !issueMessage || !reasonCategory || !reason || !expiresAt) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'workspace_id, project_id, report_name, issue_id, issue_source, issue_message, reason_category, reason, and expires_at are required' });
      return;
    }
    if (!expiresDate || Number.isNaN(expiresDate.getTime()) || expiresDate.getTime() <= Date.now()) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'expires_at must be a future ISO timestamp' });
      return;
    }
    const record = await createReleasePolicyOverride(deps.docStore, {
      workspaceId,
      projectId,
      reportName,
      issueId,
      issueSource,
      issueMessage,
      reasonCategory,
      reason,
      expiresAt: expiresDate.toISOString(),
      createdByUserId: user.id,
      createdByName: user.name,
    });
    appendUserNotification(user.id, {
      type: 'release_override_requested',
      title: 'Release override requested',
      body: `${record.issue_source}: ${record.issue_message}`,
      link_url: null,
    });
    json(res, 201, withOverrideEffectiveStatus(record));
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
    const existing = await deps.docStore.get<{
      created_by_user_id?: string;
    }>('release_policy_overrides', overrideId);
    if (existing?.created_by_user_id === user.id) {
      json(res, 409, { error_code: 'OVERRIDE_SELF_APPROVAL_FORBIDDEN', message: 'override requester cannot approve or reject their own override' });
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
    appendUserNotification(user.id, {
      type: 'release_override_decided',
      title: `Release override ${updated.status}`,
      body: `${updated.issue_source}: ${updated.issue_message}`,
      link_url: null,
    });
    json(res, 200, withOverrideEffectiveStatus(updated));
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
    if (await handleMeRoute({ req, res, method, requestUrl, user, releaseEscalationsDir: deps.releaseEscalationsDir })) {
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
