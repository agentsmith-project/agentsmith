import type { ApiClient } from '../client';
import type { ReleasePolicyEnforcement } from '@/lib/release-policy';

export interface GovernanceEvidenceIssue {
  source: 'governance' | 'workspace_governance' | 'organization_governance';
  message: string;
}

export interface ReleaseReportListItem {
  name: string;
  generated_at: string;
  status: 'pass' | 'fail' | 'unknown';
  branch?: string;
  commit_short?: string;
  release_policy_decision?: 'ready' | 'warning' | 'blocked';
  policy_blocker_count?: number;
  policy_warning_count?: number;
  runtime_release_readiness?: 'ready' | 'blocked';
  usage_release_readiness?: 'ready' | 'blocked';
  markdown_available: boolean;
  policy_enforcement?: ReleasePolicyEnforcement;
}

export interface ReleaseReportDetail {
  name: string;
  report: Record<string, unknown>;
  markdown?: string;
  policy_enforcement?: ReleasePolicyEnforcement;
}

export interface ReleaseGateRunListItem {
  id: string;
  incident_id: string;
  report_name: string;
  artifact_name: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  trigger: 'manual' | 'scheduled' | 'ci' | 'unknown';
  status: 'pass' | 'fail';
  branch?: string;
  commit_short?: string;
  release_policy_decision?: 'ready' | 'warning' | 'blocked';
  runtime_release_readiness?: 'ready' | 'blocked';
  usage_release_readiness?: 'ready' | 'blocked';
  governance_blockers?: GovernanceEvidenceIssue[];
  governance_warnings?: GovernanceEvidenceIssue[];
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  failed_step_name?: string;
  failed_step_category?: string;
  actor_user_id?: string;
  actor_name?: string;
  notes?: string;
  rerun_of_run_id?: string;
  policy_enforcement?: ReleasePolicyEnforcement;
}

export interface ReleaseGateRunDetail extends ReleaseGateRunListItem {
  failed_step_names: string[];
  failed_check_ids?: string[];
  requested_check_ids?: string[];
  failure_categories: Array<'token' | 'network' | 'backend' | 'assertion' | 'timeout' | 'authorization' | 'quota' | 'rate_limit' | 'permission' | 'unknown'>;
}

export interface ReleaseGateRunnerOperation {
  id: string;
  status: 'running' | 'completed' | 'failed';
  mode: 'full' | 'failed_only';
  started_at: string;
  completed_at?: string;
  report_name: string;
  source_run_id?: string;
  requested_check_ids?: string[];
  actor_user_id?: string;
  actor_name?: string;
  notes?: string;
  error?: string;
}

export interface ReleaseGateRunnerStatus {
  running: boolean;
  current_operation?: ReleaseGateRunnerOperation;
  recent_operations: ReleaseGateRunnerOperation[];
}

export interface ReleaseEscalationEvent {
  id: string;
  incident_id: string;
  report_name: string;
  run_id: string;
  created_at: string;
  event_type: 'gate_blocked' | 'gate_warning' | 'gate_ready' | 'override_requested' | 'override_decided';
  severity: 'critical' | 'warning' | 'info';
  status: 'open' | 'resolved';
  title: string;
  body?: string;
  artifact_name?: string;
  trigger?: 'manual' | 'scheduled' | 'ci' | 'unknown';
  release_policy_decision?: 'ready' | 'warning' | 'blocked';
  runtime_release_readiness?: 'ready' | 'blocked';
  usage_release_readiness?: 'ready' | 'blocked';
  governance_blockers?: GovernanceEvidenceIssue[];
  governance_warnings?: GovernanceEvidenceIssue[];
  failed_step_name?: string;
  failure_categories?: Array<'token' | 'network' | 'backend' | 'assertion' | 'timeout' | 'authorization' | 'quota' | 'rate_limit' | 'permission' | 'unknown'>;
  acknowledged_at?: string;
  acknowledged_by_user_id?: string;
  acknowledged_by_name?: string;
  assignee_user_id?: string;
  assignee_name?: string;
  due_at?: string;
  age_ms?: number;
  sla_status?: 'on_track' | 'due_soon' | 'overdue' | 'resolved';
  resolution_reason?: string;
  resolution_category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
  resolved_at?: string;
  resolved_by_user_id?: string;
  resolved_by_name?: string;
  webhook_delivery?: {
    status: 'success' | 'failed' | 'skipped';
    attempted_at?: string;
    response_status?: number;
    error?: string;
    duration_ms?: number;
  };
  incident_history?: Array<{
    id: string;
    incident_id: string;
    escalation_id: string;
    event_kind: 'escalation_assignment';
    created_at: string;
    actor_user_id: string;
    actor_name?: string;
    previous_assignee_user_id?: string;
    previous_assignee_name?: string;
    previous_due_at?: string;
    next_assignee_user_id: string;
    next_assignee_name?: string;
    next_due_at?: string;
  }>;
}

export interface ReleasePolicyOverrideRecord {
  id: string;
  incident_id: string;
  workspace_id: string;
  project_id: string;
  report_name: string;
  issue_id: string;
  issue_source: 'execution' | 'runtime' | 'usage';
  issue_message: string;
  reason_category: 'upstream_transient' | 'known_acceptable_risk' | 'rollout_exception' | 'governance_window';
  reason: string;
  expires_at: string;
  status: 'pending' | 'approved' | 'rejected';
  effective_status?: 'pending' | 'approved' | 'rejected' | 'expired';
  created_at: string;
  created_by_user_id: string;
  created_by_name?: string;
  decided_at?: string;
  decided_by_user_id?: string;
  decided_by_name?: string;
}

export class ReleaseOpsAPI {
  constructor(private readonly client: ApiClient) {}

  async listReports(params?: { workspaceId?: string; projectId?: string }): Promise<{ items: ReleaseReportListItem[] }> {
    const query = new URLSearchParams();
    if (params?.workspaceId) query.set('workspace_id', params.workspaceId);
    if (params?.projectId) query.set('project_id', params.projectId);
    return this.client.get(`/internal/release-reports${query.size > 0 ? `?${query.toString()}` : ''}`);
  }

  async getReport(name: string, params?: { workspaceId?: string; projectId?: string }): Promise<ReleaseReportDetail> {
    const query = new URLSearchParams();
    if (params?.workspaceId) query.set('workspace_id', params.workspaceId);
    if (params?.projectId) query.set('project_id', params.projectId);
    return this.client.get(`/internal/release-reports/${encodeURIComponent(name)}${query.size > 0 ? `?${query.toString()}` : ''}`);
  }

  async listRuns(params?: { workspaceId?: string; projectId?: string }): Promise<{ items: ReleaseGateRunListItem[] }> {
    const query = new URLSearchParams();
    if (params?.workspaceId) query.set('workspace_id', params.workspaceId);
    if (params?.projectId) query.set('project_id', params.projectId);
    return this.client.get(`/internal/release-runs${query.size > 0 ? `?${query.toString()}` : ''}`);
  }

  async getRun(id: string, params?: { workspaceId?: string; projectId?: string }): Promise<ReleaseGateRunDetail> {
    const query = new URLSearchParams();
    if (params?.workspaceId) query.set('workspace_id', params.workspaceId);
    if (params?.projectId) query.set('project_id', params.projectId);
    return this.client.get(`/internal/release-runs/${encodeURIComponent(id)}${query.size > 0 ? `?${query.toString()}` : ''}`);
  }

  async getGateRunnerStatus(): Promise<ReleaseGateRunnerStatus> {
    return this.client.get('/internal/release-gate-runner');
  }

  async triggerGateRun(payload: {
    mode: 'full' | 'failed_only';
    source_run_id?: string;
    notes?: string;
  }): Promise<ReleaseGateRunnerOperation> {
    return this.client.post('/internal/release-gate-runner/trigger', payload);
  }

  async listEscalations(): Promise<{ items: ReleaseEscalationEvent[] }> {
    return this.client.get('/internal/release-escalations');
  }

  async getEscalation(id: string): Promise<ReleaseEscalationEvent> {
    return this.client.get(`/internal/release-escalations/${encodeURIComponent(id)}`);
  }

  async acknowledgeEscalation(id: string): Promise<ReleaseEscalationEvent> {
    return this.client.post(`/internal/release-escalations/${encodeURIComponent(id)}/acknowledge`);
  }

  async assignEscalation(id: string, payload: { assignee_user_id: string; assignee_name?: string; due_at?: string }): Promise<ReleaseEscalationEvent> {
    return this.client.post(`/internal/release-escalations/${encodeURIComponent(id)}/assignment`, payload);
  }

  async resolveEscalation(
    id: string,
    payload: {
      status: 'open' | 'resolved';
      reason?: string;
      category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
    },
  ): Promise<ReleaseEscalationEvent> {
    return this.client.post(`/internal/release-escalations/${encodeURIComponent(id)}/resolution`, payload);
  }

  async listOverrides(params: { workspaceId: string; projectId: string; reportName: string }): Promise<{ items: ReleasePolicyOverrideRecord[] }> {
    const query = new URLSearchParams({
      workspace_id: params.workspaceId,
      project_id: params.projectId,
      report_name: params.reportName,
    });
    return this.client.get(`/internal/release-policy-overrides?${query.toString()}`);
  }

  async createOverride(payload: {
    workspace_id: string;
    project_id: string;
    report_name: string;
    incident_id: string;
    issue_id: string;
    issue_source: 'execution' | 'runtime' | 'usage';
    issue_message: string;
    reason_category: 'upstream_transient' | 'known_acceptable_risk' | 'rollout_exception' | 'governance_window';
    reason: string;
    expires_at: string;
  }): Promise<ReleasePolicyOverrideRecord> {
    return this.client.post('/internal/release-policy-overrides', payload);
  }

  async decideOverride(overrideId: string, payload: { status: 'approved' | 'rejected' }): Promise<ReleasePolicyOverrideRecord> {
    return this.client.post(`/internal/release-policy-overrides/${encodeURIComponent(overrideId)}/decision`, payload);
  }
}
