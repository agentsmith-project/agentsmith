import type { ApiClient } from '../client';

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
}

export interface ReleaseReportDetail {
  name: string;
  report: Record<string, unknown>;
  markdown?: string;
}

export interface ReleaseGateRunListItem {
  id: string;
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
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  failed_step_name?: string;
  failed_step_category?: string;
}

export interface ReleaseGateRunDetail extends ReleaseGateRunListItem {
  failed_step_names: string[];
  failure_categories: Array<'token' | 'network' | 'backend' | 'assertion' | 'timeout' | 'authorization' | 'quota' | 'rate_limit' | 'permission' | 'unknown'>;
}

export interface ReleasePolicyOverrideRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  report_name: string;
  issue_id: string;
  issue_source: 'execution' | 'runtime' | 'usage';
  issue_message: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  created_by_user_id: string;
  created_by_name?: string;
  decided_at?: string;
  decided_by_user_id?: string;
  decided_by_name?: string;
}

export class ReleaseOpsAPI {
  constructor(private readonly client: ApiClient) {}

  async listReports(): Promise<{ items: ReleaseReportListItem[] }> {
    return this.client.get('/internal/release-reports');
  }

  async getReport(name: string): Promise<ReleaseReportDetail> {
    return this.client.get(`/internal/release-reports/${encodeURIComponent(name)}`);
  }

  async listRuns(): Promise<{ items: ReleaseGateRunListItem[] }> {
    return this.client.get('/internal/release-runs');
  }

  async getRun(id: string): Promise<ReleaseGateRunDetail> {
    return this.client.get(`/internal/release-runs/${encodeURIComponent(id)}`);
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
    issue_id: string;
    issue_source: 'execution' | 'runtime' | 'usage';
    issue_message: string;
    reason: string;
  }): Promise<ReleasePolicyOverrideRecord> {
    return this.client.post('/internal/release-policy-overrides', payload);
  }

  async decideOverride(overrideId: string, payload: { status: 'approved' | 'rejected' }): Promise<ReleasePolicyOverrideRecord> {
    return this.client.post(`/internal/release-policy-overrides/${encodeURIComponent(overrideId)}/decision`, payload);
  }
}
