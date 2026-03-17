import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';
import { extractBearerToken, verifyBearerToken } from './auth.js';
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
import {
  completeFeishuOAuthFromCallback,
  getFeishuOAuthFrontendConfig,
} from './feishu-oauth.js';
import { appendUserNotification } from './me-notifications-store.js';
import { getGovernanceIncidentDetail, listGovernanceIncidents } from './governance-incident-store.js';
import {
  acknowledgeGovernanceIncident,
  assignGovernanceIncident,
  getGovernanceIncidentState,
  listGovernanceIncidentStates,
  setGovernanceIncidentResolution,
} from './governance-incident-state-store.js';
import {
  listGovernanceIncidentHistory,
  recordGovernanceIncidentAssignmentHistory,
} from './governance-incident-history-store.js';
import { getGovernanceReportDetail, listGovernanceReports } from './governance-report-store.js';
import { getGovernanceRunDetail, listGovernanceRuns } from './governance-run-store.js';
import {
  createGovernancePolicyOverride,
  updateGovernancePolicyOverrideDecision,
} from './governance-policy-override-store.js';
import {
  handleTaskRoute,
} from './task-route-handler.js';
import {
  getNotebookTaskMetricsPrometheusText,
  getNotebookTaskMetricsSnapshot,
} from './notebook-task/task-metrics-api.js';
import { issueSSETicket } from './sse-ticket-store.js';
import { buildUpstreamUrl } from './request-handler/build-upstream-url.js';
import {
  buildPolicyEnforcement,
  mergeEscalationState,
  withOverrideEffectiveStatus,
} from './request-handler/governance-route-utils.js';
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

  if (requestUrl.pathname === '/api/v1/me/external-connections/providers/feishu/callback' && method === 'GET') {
    try {
      await completeFeishuOAuthFromCallback({
        docStore: deps.docStore,
        code: requestUrl.searchParams.get('code') ?? undefined,
        state: requestUrl.searchParams.get('state') ?? undefined,
      });
      const frontend = getFeishuOAuthFrontendConfig();
      const redirectUrl = new URL(`/${frontend.locale}/user/third-party-accounts`, `${frontend.webBaseUrl}/`);
      redirectUrl.searchParams.set('provider', 'feishu');
      redirectUrl.searchParams.set('connected', '1');
      res.statusCode = 302;
      res.setHeader('location', redirectUrl.toString());
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'feishu_callback_failed';
      res.statusCode = 400;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><body><h1>Feishu callback failed</h1><p>${message}</p></body></html>`);
    }
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/notebook-task-metrics' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    json(res, 200, getNotebookTaskMetricsSnapshot());
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/notebook-task-metrics/prometheus' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(getNotebookTaskMetricsPrometheusText());
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-reports' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const workspaceId = requestUrl.searchParams.get('workspace_id');
    const projectId = requestUrl.searchParams.get('project_id');
    const reports = listGovernanceReports(deps.governanceReportsDir ?? 'artifacts/governance-reports');
    const items = await Promise.all(
      reports.map(async (item) => {
        const detail = getGovernanceReportDetail(deps.governanceReportsDir ?? 'artifacts/governance-reports', item.name);
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

  if (requestUrl.pathname === '/api/v1/internal/governance-runner' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    json(res, 200, deps.governanceRunner?.getStatus() ?? {
      running: false,
      recent_operations: [],
    });
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-runner/trigger' && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    if (!deps.governanceRunner) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'governance_runner_unavailable' });
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
      const operation = await deps.governanceRunner.triggerRun({
        mode,
        sourceRunId,
        notes,
        actorUserId: user.id,
        actorName: user.name,
      });
      json(res, 202, operation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'governance_runner_failed';
      const status = message === 'governance_runner_busy' ? 409 : 422;
      json(res, status, { error_code: 'GOVERNANCE_RUNNER_ERROR', message });
    }
    return;
  }

  if (requestUrl.pathname.startsWith('/api/v1/internal/governance-reports/') && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const reportName = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-reports/', ''));
    const detail = getGovernanceReportDetail(deps.governanceReportsDir ?? 'artifacts/governance-reports', reportName);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_report_not_found' });
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

  if (requestUrl.pathname === '/api/v1/internal/governance-runs' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const workspaceId = requestUrl.searchParams.get('workspace_id');
    const projectId = requestUrl.searchParams.get('project_id');
    const runs = listGovernanceRuns(deps.governanceRunsDir ?? 'artifacts/governance-runs');
    const items = await Promise.all(
      runs.map(async (item) => {
        const detail = getGovernanceReportDetail(deps.governanceReportsDir ?? 'artifacts/governance-reports', item.report_name);
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

  if (requestUrl.pathname.startsWith('/api/v1/internal/governance-runs/') && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const runName = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-runs/', ''));
    const detail = getGovernanceRunDetail(deps.governanceRunsDir ?? 'artifacts/governance-runs', runName);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_run_not_found' });
      return;
    }
    const workspaceId = requestUrl.searchParams.get('workspace_id');
    const projectId = requestUrl.searchParams.get('project_id');
    const report = getGovernanceReportDetail(deps.governanceReportsDir ?? 'artifacts/governance-reports', detail.report_name);
    json(res, 200, {
      ...detail,
      policy_enforcement: report
        ? await buildPolicyEnforcement(deps, detail.report_name, report.report, { workspaceId, projectId })
        : undefined,
    });
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-incidents' && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const items = listGovernanceIncidents(deps.governanceIncidentsDir ?? 'artifacts/governance-incidents');
    const states = await listGovernanceIncidentStates(deps.docStore);
    const stateById = new Map(states.map((item) => [item.id, item]));
    json(res, 200, {
      items: items.map((item) => mergeEscalationState(item, stateById.get(item.id))),
    });
    return;
  }

  if (requestUrl.pathname.startsWith('/api/v1/internal/governance-incidents/') && method === 'GET') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-incidents/', ''));
    const detail = getGovernanceIncidentDetail(deps.governanceIncidentsDir ?? 'artifacts/governance-incidents', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_incident_not_found' });
      return;
    }
    const state = await getGovernanceIncidentState(deps.docStore, escalationId);
    const merged = mergeEscalationState(detail, state);
    const incidentHistory = await listGovernanceIncidentHistory(deps.docStore, { incidentId: merged.incident_id });
    json(res, 200, {
      ...merged,
      incident_history: incidentHistory,
    });
    return;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/governance-incidents\/[^/]+\/acknowledge\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-incidents/', '').replace('/acknowledge', '').replace(/\/$/, ''));
    const detail = getGovernanceIncidentDetail(deps.governanceIncidentsDir ?? 'artifacts/governance-incidents', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_incident_not_found' });
      return;
    }
    const state = await acknowledgeGovernanceIncident(deps.docStore, {
      escalationId,
      userId: user.id,
      userName: user.name,
    });
    appendUserNotification(user.id, {
      type: 'governance_incident_acknowledged',
      title: 'Governance incident acknowledged',
      body: detail.title,
      link_url: null,
    });
    json(res, 200, mergeEscalationState(detail, state));
    return;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/governance-incidents\/[^/]+\/assignment\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-incidents/', '').replace('/assignment', '').replace(/\/$/, ''));
    const detail = getGovernanceIncidentDetail(deps.governanceIncidentsDir ?? 'artifacts/governance-incidents', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_incident_not_found' });
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
    const previousState = await getGovernanceIncidentState(deps.docStore, escalationId);
    const state = await assignGovernanceIncident(deps.docStore, {
      escalationId,
      assigneeUserId,
      assigneeName,
      dueAt,
    });
    await recordGovernanceIncidentAssignmentHistory(deps.docStore, {
      incidentId: detail.incident_id,
      escalationId,
      actorUserId: user.id,
      actorName: user.name,
      previousAssigneeUserId: previousState?.assignee_user_id,
      previousAssigneeName: previousState?.assignee_name,
      previousDueAt: previousState?.due_at,
      nextAssigneeUserId: assigneeUserId,
      nextAssigneeName: assigneeName,
      nextDueAt: dueAt,
    });
    appendUserNotification(user.id, {
      type: 'governance_incident_assigned',
      title: 'Governance incident assigned',
      body: detail.title,
      link_url: null,
    });
    json(res, 200, mergeEscalationState(detail, state));
    return;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/governance-incidents\/[^/]+\/resolution\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-incidents/', '').replace('/resolution', '').replace(/\/$/, ''));
    const detail = getGovernanceIncidentDetail(deps.governanceIncidentsDir ?? 'artifacts/governance-incidents', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_incident_not_found' });
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
    const state = await setGovernanceIncidentResolution(deps.docStore, {
      escalationId,
      status,
      reason,
      category,
      userId: user.id,
      userName: user.name,
    });
    appendUserNotification(user.id, {
      type: 'governance_incident_resolved',
      title: status === 'resolved' ? 'Governance incident resolved' : 'Governance incident reopened',
      body: detail.title,
      link_url: null,
    });
    json(res, 200, mergeEscalationState(detail, state));
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-policy-overrides' && method === 'GET') {
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
    const items = await listGovernancePolicyOverrides(deps.docStore, {
      workspaceId,
      projectId,
      reportName,
    });
    json(res, 200, { items: items.map((item) => withOverrideEffectiveStatus(item)) });
    return;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-policy-overrides' && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const body = await readBody(req) as Record<string, unknown>;
    const workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id.trim() : '';
    const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
    const reportName = typeof body.report_name === 'string' ? body.report_name.trim() : '';
    const incidentId = typeof body.incident_id === 'string' ? body.incident_id.trim() : '';
    const issueId = typeof body.issue_id === 'string' ? body.issue_id.trim() : '';
    const issueSource = body.issue_source === 'execution' || body.issue_source === 'configuration' || body.issue_source === 'usage'
      ? body.issue_source
      : null;
    const issueMessage = typeof body.issue_message === 'string' ? body.issue_message.trim() : '';
    const reasonCategory = body.reason_category === 'upstream_transient'
      || body.reason_category === 'known_acceptable_risk'
      || body.reason_category === 'approved_exception'
      || body.reason_category === 'governance_window'
      ? body.reason_category
      : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const expiresAt = typeof body.expires_at === 'string' ? body.expires_at.trim() : '';
    const expiresDate = expiresAt ? new Date(expiresAt) : null;
    if (!workspaceId || !projectId || !reportName || !incidentId || !issueId || !issueSource || !issueMessage || !reasonCategory || !reason || !expiresAt) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'workspace_id, project_id, report_name, incident_id, issue_id, issue_source, issue_message, reason_category, reason, and expires_at are required' });
      return;
    }
    if (!expiresDate || Number.isNaN(expiresDate.getTime()) || expiresDate.getTime() <= Date.now()) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'expires_at must be a future ISO timestamp' });
      return;
    }
    const record = await createGovernancePolicyOverride(deps.docStore, {
      workspaceId,
      projectId,
      reportName,
      incidentId,
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
      type: 'governance_override_requested',
      title: 'Governance override requested',
      body: `${record.issue_source}: ${record.issue_message}`,
      link_url: null,
    });
    json(res, 201, withOverrideEffectiveStatus(record));
    return;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/governance-policy-overrides\/[^/]+\/decision\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    const overrideId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-policy-overrides/', '').replace('/decision', '').replace(/\/$/, ''));
    const body = await readBody(req) as Record<string, unknown>;
    const status = body.status === 'approved' || body.status === 'rejected' ? body.status : null;
    if (!overrideId || !status) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'override id and decision status are required' });
      return;
    }
    const existing = await deps.docStore.get<{
      created_by_user_id?: string;
    }>('governance_policy_overrides', overrideId);
    if (existing?.created_by_user_id === user.id) {
      json(res, 409, { error_code: 'OVERRIDE_SELF_APPROVAL_FORBIDDEN', message: 'override requester cannot approve or reject their own override' });
      return;
    }
    const updated = await updateGovernancePolicyOverrideDecision(deps.docStore, {
      overrideId,
      status,
      decidedByUserId: user.id,
      decidedByName: user.name,
    });
    if (!updated) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_policy_override_not_found' });
      return;
    }
    appendUserNotification(user.id, {
      type: 'governance_override_decided',
      title: `Governance override ${updated.status}`,
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
      const issued = issueSSETicket({ bearerToken, maxConnections: 1 });
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
      docStore: deps.docStore,
      governanceIncidentsDir: deps.governanceIncidentsDir,
    })) {
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
          const evaluation = evaluateProjectPermissions({
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
          // Keep compatibility with in-memory local routes that are not yet tied to project repo records.
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
      const actorGate = evaluateProjectPermissions({
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

      const permissionEvaluation = evaluateProjectPermissions({
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
        const policyDecision = evaluateResourcePolicyAuthorization({
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
        rawBearerToken,
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
