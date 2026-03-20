import type http from 'node:http';
import type { NodeApiDeps } from '../node-api-deps.js';
import { verifyBearerToken } from '../auth.js';
import { completeFeishuOAuthFromCallback, getFeishuOAuthFrontendConfig } from '../feishu-oauth.js';
import { completeWorkspaceFeishuOAuthFromState } from '../workspace-feishu-oauth.js';
import { appendUserNotification } from '../me-notifications-store.js';
import { getGovernanceIncidentDetail, listGovernanceIncidents } from '../governance-incident-store.js';
import {
  acknowledgeGovernanceIncident,
  assignGovernanceIncident,
  getGovernanceIncidentState,
  listGovernanceIncidentStates,
  setGovernanceIncidentResolution,
} from '../governance-incident-state-store.js';
import {
  listGovernanceIncidentHistory,
  recordGovernanceIncidentAssignmentHistory,
} from '../governance-incident-history-store.js';
import { getGovernanceReportDetail, listGovernanceReports } from '../governance-report-store.js';
import { getGovernanceRunDetail, listGovernanceRuns } from '../governance-run-store.js';
import {
  createGovernancePolicyOverride,
  updateGovernancePolicyOverrideDecision,
} from '../governance-policy-override-store.js';
import {
  getNotebookTaskMetricsPrometheusText,
  getNotebookTaskMetricsSnapshot,
} from '../notebook-task/task-metrics-api.js';
import type { JsonValue } from '../json-doc-store.js';
import { unauthorized } from '../http-utils.js';
import {
  buildPolicyEnforcement,
  listGovernancePolicyOverrides,
  mergeEscalationState,
  withOverrideEffectiveStatus,
} from './governance-route-utils.js';

type JsonFn = (res: http.ServerResponse, status: number, body: JsonValue) => void;
type ReadBodyFn = (req: http.IncomingMessage) => Promise<unknown>;

type InternalRouteContext = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  requestUrl: URL;
  deps: NodeApiDeps;
  json: JsonFn;
  readBody: ReadBodyFn;
};

export async function handleInternalRoutes({
  req,
  res,
  method,
  requestUrl,
  deps,
  json,
  readBody,
}: InternalRouteContext): Promise<boolean> {
  const workspaceFeishuPublicCompleteMatched = requestUrl.pathname.match(
    /^\/api\/public\/workspaces\/([^/]+)\/feishu\/oauth\/complete\/?$/,
  );
  if (workspaceFeishuPublicCompleteMatched && method === 'POST') {
    try {
      const body = await readBody(req) as { code?: unknown; state?: unknown } | undefined;
      const normalizeString = (value: unknown) => typeof value === 'string' ? value.trim() : '';
      const result = await completeWorkspaceFeishuOAuthFromState({
        cache: deps.cache,
        docStore: deps.docStore,
        workspaceId: decodeURIComponent(workspaceFeishuPublicCompleteMatched[1]),
        code: normalizeString(body?.code),
        state: normalizeString(body?.state),
      });
      json(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'workspace_feishu_callback_failed';
      const status = message === 'feishu_callback_state_invalid' || message === 'feishu_callback_missing_code_or_state'
        ? 422
        : 400;
      json(res, status, { error_code: 'WORKSPACE_FEISHU_CALLBACK_FAILED', message });
    }
    return true;
  }

  if (requestUrl.pathname === '/api/v1/me/external-connections/providers/feishu/callback' && method === 'GET') {
    try {
      await completeFeishuOAuthFromCallback({
        docStore: deps.docStore,
        cache: deps.cache,
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
    return true;
  }

  if (requestUrl.pathname === '/api/v1/internal/notebook-task-metrics' && method === 'GET') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    json(res, 200, getNotebookTaskMetricsSnapshot());
    return true;
  }

  if (requestUrl.pathname === '/api/v1/internal/notebook-task-metrics/prometheus' && method === 'GET') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(getNotebookTaskMetricsPrometheusText());
    return true;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-reports' && method === 'GET') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
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
    json(res, 200, { items });
    return true;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-runner' && method === 'GET') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    json(res, 200, deps.governanceRunner?.getStatus() ?? {
      running: false,
      recent_operations: [],
    });
    return true;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-runner/trigger' && method === 'POST') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    if (!deps.governanceRunner) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'governance_runner_unavailable' });
      return true;
    }
    const body = await readBody(req) as Record<string, unknown>;
    const mode = body.mode === 'full' || body.mode === 'failed_only' ? body.mode : null;
    const sourceRunId = typeof body.source_run_id === 'string' ? body.source_run_id.trim() : undefined;
    const notes = typeof body.notes === 'string' ? body.notes.trim() : undefined;
    if (!mode) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'mode is required' });
      return true;
    }
    if (mode === 'failed_only' && !sourceRunId) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'source_run_id is required for failed_only rerun' });
      return true;
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
    return true;
  }

  if (requestUrl.pathname.startsWith('/api/v1/internal/governance-reports/') && method === 'GET') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    const reportName = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-reports/', ''));
    const detail = getGovernanceReportDetail(deps.governanceReportsDir ?? 'artifacts/governance-reports', reportName);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_report_not_found' });
      return true;
    }
    const workspaceId = requestUrl.searchParams.get('workspace_id');
    const projectId = requestUrl.searchParams.get('project_id');
    json(res, 200, {
      ...detail,
      policy_enforcement: await buildPolicyEnforcement(deps, reportName, detail.report, { workspaceId, projectId }),
    });
    return true;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-runs' && method === 'GET') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
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
    json(res, 200, { items });
    return true;
  }

  if (requestUrl.pathname.startsWith('/api/v1/internal/governance-runs/') && method === 'GET') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    const runName = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-runs/', ''));
    const detail = getGovernanceRunDetail(deps.governanceRunsDir ?? 'artifacts/governance-runs', runName);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_run_not_found' });
      return true;
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
    return true;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-incidents' && method === 'GET') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    const items = listGovernanceIncidents(deps.governanceIncidentsDir ?? 'artifacts/governance-incidents');
    const states = await listGovernanceIncidentStates(deps.docStore);
    const stateById = new Map(states.map((item) => [item.id, item]));
    json(res, 200, { items: items.map((item) => mergeEscalationState(item, stateById.get(item.id))) });
    return true;
  }

  if (requestUrl.pathname.startsWith('/api/v1/internal/governance-incidents/') && method === 'GET') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-incidents/', ''));
    const detail = getGovernanceIncidentDetail(deps.governanceIncidentsDir ?? 'artifacts/governance-incidents', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_incident_not_found' });
      return true;
    }
    const state = await getGovernanceIncidentState(deps.docStore, escalationId);
    const merged = mergeEscalationState(detail, state);
    const incidentHistory = await listGovernanceIncidentHistory(deps.docStore, { incidentId: merged.incident_id });
    json(res, 200, { ...merged, incident_history: incidentHistory });
    return true;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/governance-incidents\/[^/]+\/acknowledge\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-incidents/', '').replace('/acknowledge', '').replace(/\/$/, ''));
    const detail = getGovernanceIncidentDetail(deps.governanceIncidentsDir ?? 'artifacts/governance-incidents', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_incident_not_found' });
      return true;
    }
    const state = await acknowledgeGovernanceIncident(deps.docStore, {
      escalationId,
      userId: user.id,
      userName: user.name,
    });
    await appendUserNotification(deps.docStore, user.id, {
      type: 'governance_incident_acknowledged',
      title: 'Governance incident acknowledged',
      body: detail.title,
      link_url: null,
    });
    json(res, 200, mergeEscalationState(detail, state));
    return true;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/governance-incidents\/[^/]+\/assignment\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-incidents/', '').replace('/assignment', '').replace(/\/$/, ''));
    const detail = getGovernanceIncidentDetail(deps.governanceIncidentsDir ?? 'artifacts/governance-incidents', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_incident_not_found' });
      return true;
    }
    const body = await readBody(req) as Record<string, unknown>;
    const assigneeUserId = typeof body.assignee_user_id === 'string' ? body.assignee_user_id.trim() : '';
    const assigneeName = typeof body.assignee_name === 'string' ? body.assignee_name.trim() : undefined;
    const dueAt = typeof body.due_at === 'string' ? body.due_at.trim() : undefined;
    const dueDate = dueAt ? new Date(dueAt) : undefined;
    if (!assigneeUserId) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'assignee_user_id is required' });
      return true;
    }
    if (dueAt && (!dueDate || Number.isNaN(dueDate.getTime()))) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'due_at must be a valid ISO timestamp' });
      return true;
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
    await appendUserNotification(deps.docStore, user.id, {
      type: 'governance_incident_assigned',
      title: 'Governance incident assigned',
      body: detail.title,
      link_url: null,
    });
    json(res, 200, mergeEscalationState(detail, state));
    return true;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/governance-incidents\/[^/]+\/resolution\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    const escalationId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-incidents/', '').replace('/resolution', '').replace(/\/$/, ''));
    const detail = getGovernanceIncidentDetail(deps.governanceIncidentsDir ?? 'artifacts/governance-incidents', escalationId);
    if (!detail) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_incident_not_found' });
      return true;
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
      return true;
    }
    if (status === 'resolved' && !category) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'resolution category is required when resolving escalation' });
      return true;
    }
    const state = await setGovernanceIncidentResolution(deps.docStore, {
      escalationId,
      status,
      reason,
      category,
      userId: user.id,
      userName: user.name,
    });
    await appendUserNotification(deps.docStore, user.id, {
      type: 'governance_incident_resolved',
      title: status === 'resolved' ? 'Governance incident resolved' : 'Governance incident reopened',
      body: detail.title,
      link_url: null,
    });
    json(res, 200, mergeEscalationState(detail, state));
    return true;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-policy-overrides' && method === 'GET') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    const workspaceId = requestUrl.searchParams.get('workspace_id')?.trim();
    const projectId = requestUrl.searchParams.get('project_id')?.trim();
    const reportName = requestUrl.searchParams.get('report_name')?.trim();
    if (!workspaceId || !projectId || !reportName) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'workspace_id, project_id, and report_name are required' });
      return true;
    }
    const items = await listGovernancePolicyOverrides(deps.docStore, {
      workspaceId,
      projectId,
      reportName,
    });
    json(res, 200, { items: items.map((item) => withOverrideEffectiveStatus(item)) });
    return true;
  }

  if (requestUrl.pathname === '/api/v1/internal/governance-policy-overrides' && method === 'POST') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
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
      return true;
    }
    if (!expiresDate || Number.isNaN(expiresDate.getTime()) || expiresDate.getTime() <= Date.now()) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'expires_at must be a future ISO timestamp' });
      return true;
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
    await appendUserNotification(deps.docStore, user.id, {
      type: 'governance_override_requested',
      title: 'Governance override requested',
      body: `${record.issue_source}: ${record.issue_message}`,
      link_url: null,
    });
    json(res, 201, withOverrideEffectiveStatus(record));
    return true;
  }

  if (requestUrl.pathname.match(/^\/api\/v1\/internal\/governance-policy-overrides\/[^/]+\/decision\/?$/) && method === 'POST') {
    const user = await verifyBearerToken(req, { cache: deps.cache });
    if (!user) {
      unauthorized(res);
      return true;
    }
    const overrideId = decodeURIComponent(requestUrl.pathname.replace('/api/v1/internal/governance-policy-overrides/', '').replace('/decision', '').replace(/\/$/, ''));
    const body = await readBody(req) as Record<string, unknown>;
    const status = body.status === 'approved' || body.status === 'rejected' ? body.status : null;
    if (!overrideId || !status) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'override id and decision status are required' });
      return true;
    }
    const existing = await deps.docStore.get<{ created_by_user_id?: string }>('governance_policy_overrides', overrideId);
    if (existing?.created_by_user_id === user.id) {
      json(res, 409, { error_code: 'OVERRIDE_SELF_APPROVAL_FORBIDDEN', message: 'override requester cannot approve or reject their own override' });
      return true;
    }
    const updated = await updateGovernancePolicyOverrideDecision(deps.docStore, {
      overrideId,
      status,
      decidedByUserId: user.id,
      decidedByName: user.name,
    });
    if (!updated) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'governance_policy_override_not_found' });
      return true;
    }
    await appendUserNotification(deps.docStore, user.id, {
      type: 'governance_override_decided',
      title: `Governance override ${updated.status}`,
      body: `${updated.issue_source}: ${updated.issue_message}`,
      link_url: null,
    });
    json(res, 200, withOverrideEffectiveStatus(updated));
    return true;
  }

  return false;
}
