import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';
import { usageRecordFixtures } from '../fixtures/usage';
import { buildRequestUsageRecords, listRequestUsageFacts } from '../state/request-usage';
import type { OrganizationActionServerRecord, OrganizationActionStatus } from '@/lib/stores/organization-actions-store';
import { appendMockNotification } from '../state/me-notifications';

type ResourceType = 'endpoint' | 'source_library' | 'agent';

type UsageLikeRecord = {
  id: string;
  time_bucket: string;
  workspace_id: string;
  project_id: string;
  resource_type: string;
  resource_id?: string;
  end_user_id?: string;
  requests: number;
  duration_p95_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
  tokens?: number;
};

type RequestFactLike = {
  requests?: number;
  result: 'ok' | 'error';
  timestamp?: string;
  end_user_id?: string;
  request_id?: string;
  error_code?: string;
  request_details?: {
    provider?: string;
    resolved_model?: string;
    error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
    fallback_hops?: number;
    estimated_cost?: number | null;
    missing_price?: boolean;
  };
};

const organizationActionRecords = new Map<string, OrganizationActionServerRecord>();

function listOrganizationActionRecords(actionIds: string[]): OrganizationActionServerRecord[] {
  return actionIds.map((actionId) => {
    const existing = organizationActionRecords.get(actionId);
    if (existing) {
      return existing;
    }
    const created: OrganizationActionServerRecord = {
      action_id: actionId,
      status: 'pending',
      updated_at: new Date().toISOString(),
      history: [],
    };
    organizationActionRecords.set(actionId, created);
    return created;
  });
}

function normalizeActionStatus(value: unknown): OrganizationActionStatus | null {
  if (value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'blocked') {
    return value;
  }
  return null;
}

function buildUsageOperationsSummary(facts: RequestFactLike[]) {
  const providerAgg = new Map<string, { provider: string; requests: number; errors: number; estimated_cost: number }>();
  const modelAgg = new Map<string, { provider: string; model: string; requests: number; errors: number; estimated_cost: number }>();
  const endUserAgg = new Map<string, { end_user_id: string; requests: number; errors: number; estimated_cost: number }>();
  const trendBuckets = new Map<string, { requests: number; errors: number; cost: number }>();

  for (const fact of facts) {
    const requests = fact.requests ?? 1;
    const provider = fact.request_details?.provider;
    const model = fact.request_details?.resolved_model;
    const endUserId = fact.end_user_id;
    const estimatedCost = typeof fact.request_details?.estimated_cost === 'number' ? fact.request_details.estimated_cost : 0;
    const bucket = (fact.timestamp ?? new Date().toISOString()).slice(0, 13) + ':00:00.000Z';
    const trend = trendBuckets.get(bucket) ?? { requests: 0, errors: 0, cost: 0 };
    trend.requests += requests;
    if (fact.result === 'error') trend.errors += requests;
    trend.cost += estimatedCost;
    trendBuckets.set(bucket, trend);

    if (provider) {
      const item = providerAgg.get(provider) ?? { provider, requests: 0, errors: 0, estimated_cost: 0 };
      item.requests += requests;
      if (fact.result === 'error') item.errors += requests;
      item.estimated_cost += estimatedCost;
      providerAgg.set(provider, item);
    }

    if (provider && model) {
      const key = `${provider}:${model}`;
      const item = modelAgg.get(key) ?? { provider, model, requests: 0, errors: 0, estimated_cost: 0 };
      item.requests += requests;
      if (fact.result === 'error') item.errors += requests;
      item.estimated_cost += estimatedCost;
      modelAgg.set(key, item);
    }

    if (endUserId) {
      const item = endUserAgg.get(endUserId) ?? { end_user_id: endUserId, requests: 0, errors: 0, estimated_cost: 0 };
      item.requests += requests;
      if (fact.result === 'error') item.errors += requests;
      item.estimated_cost += estimatedCost;
      endUserAgg.set(endUserId, item);
    }
  }

  const trendItems = Array.from(trendBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time_bucket, item]) => ({ time_bucket, ...item }));
  const baselineRequests = trendItems.length > 0 ? trendItems.reduce((sum, item) => sum + item.requests, 0) / trendItems.length : 0;
  const baselineErrors = trendItems.length > 0 ? trendItems.reduce((sum, item) => sum + item.errors, 0) / trendItems.length : 0;
  const baselineCost = trendItems.length > 0 ? trendItems.reduce((sum, item) => sum + item.cost, 0) / trendItems.length : 0;

  return {
    top_providers: Array.from(providerAgg.values()).sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests).slice(0, 5),
    top_models: Array.from(modelAgg.values()).sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests).slice(0, 5),
    top_end_users: Array.from(endUserAgg.values()).sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests).slice(0, 5),
    anomaly_peaks: trendItems.flatMap((item) => {
      const peaks: Array<{ id: string; time_bucket: string; metric: 'requests' | 'errors' | 'cost'; value: number; baseline: number; severity: 'medium' | 'high' }> = [];
      if (baselineRequests > 0 && item.requests > baselineRequests * 1.5) {
        peaks.push({ id: `requests-${item.time_bucket}`, time_bucket: item.time_bucket, metric: 'requests', value: item.requests, baseline: Number(baselineRequests.toFixed(2)), severity: item.requests > baselineRequests * 2 ? 'high' : 'medium' });
      }
      if (baselineErrors > 0 && item.errors > baselineErrors * 1.5) {
        peaks.push({ id: `errors-${item.time_bucket}`, time_bucket: item.time_bucket, metric: 'errors', value: item.errors, baseline: Number(baselineErrors.toFixed(2)), severity: item.errors > baselineErrors * 2 ? 'high' : 'medium' });
      }
      if (baselineCost > 0 && item.cost > baselineCost * 1.5) {
        peaks.push({ id: `cost-${item.time_bucket}`, time_bucket: item.time_bucket, metric: 'cost', value: Number(item.cost.toFixed(8)), baseline: Number(baselineCost.toFixed(8)), severity: item.cost > baselineCost * 2 ? 'high' : 'medium' });
      }
      return peaks;
    }).slice(0, 6),
    recent_requests: facts
      .slice()
      .sort((a, b) => Date.parse(b.timestamp ?? '') - Date.parse(a.timestamp ?? ''))
      .slice(0, 12)
      .map((fact, index) => ({
        id: fact.request_id ?? `mock_request_${index}`,
        timestamp: fact.timestamp ?? new Date().toISOString(),
        request_id: fact.request_id,
        provider: fact.request_details?.provider,
        model: fact.request_details?.resolved_model,
        end_user_id: fact.end_user_id,
        result: fact.result,
        error_class: fact.request_details?.error_class,
        estimated_cost: fact.request_details?.estimated_cost ?? undefined,
      })),
    webhook_destinations: [],
  };
}

const governancePolicyOverrides = [{
  id: 'rpo_001',
  incident_id: 'incident-usage-request-review-warning',
  workspace_id: 'ws_default',
  project_id: 'proj_001',
  report_name: 'usage-request-review-warning',
  issue_id: 'usage_request_review_recommended',
  issue_source: 'usage',
  issue_message: 'usage_request_review_recommended',
  reason_category: 'approved_exception',
  reason: 'Accepted temporarily during the current governance review.',
  expires_at: '2026-03-07T22:20:00.000Z',
  status: 'pending',
  created_at: '2026-02-28T22:20:00.000Z',
  created_by_user_id: 'requester-user',
  created_by_name: 'Requester User',
  effective_status: 'pending',
}] as Array<{
  id: string;
  incident_id: string;
  workspace_id: string;
  project_id: string;
  report_name: string;
  issue_id: string;
  issue_source: 'execution' | 'configuration' | 'usage';
  issue_message: string;
  reason_category: 'upstream_transient' | 'known_acceptable_risk' | 'approved_exception' | 'governance_window';
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
}>;

const governanceReports = [
  {
    name: 'wp11-governance-controls-final-20260228',
    generated_at: '2026-02-28T20:35:10.000Z',
    status: 'pass',
    branch: 'main',
    commit_short: '6e002bd',
    governance_decision: 'ready',
    policy_blocker_count: 0,
    policy_warning_count: 0,
    execution_review_status: 'ready',
    markdown_available: true,
    policy_enforcement: {
      decision: 'ready',
      base_decision: 'ready',
      blocker_count: 0,
      warning_count: 0,
      pending_override_count: 0,
      approved_override_count: 0,
      unresolved_blockers: [],
      overridden_blockers: [],
      pending_override_issues: [],
      rejected_override_issues: [],
    },
  },
  {
    name: 'usage-request-review-warning',
    generated_at: '2026-02-28T22:10:00.000Z',
    status: 'pass',
    branch: 'main',
    commit_short: '5d1e26e',
    governance_decision: 'warning',
    policy_blocker_count: 0,
    policy_warning_count: 1,
    execution_review_status: 'ready',
    markdown_available: true,
    policy_enforcement: {
      decision: 'warning',
      base_decision: 'warning',
      blocker_count: 0,
      warning_count: 1,
      pending_override_count: 0,
      approved_override_count: 0,
      unresolved_blockers: [],
      overridden_blockers: [],
      pending_override_issues: [],
      rejected_override_issues: [],
    },
  },
  {
    name: 'execution-review-governance-regression-20260227',
    generated_at: '2026-02-27T19:25:00.000Z',
    status: 'fail',
    branch: 'main',
    commit_short: 'a0f74a6',
    governance_decision: 'blocked',
    policy_blocker_count: 5,
    policy_warning_count: 2,
    execution_review_status: 'blocked',
    markdown_available: true,
    policy_enforcement: {
      decision: 'blocked',
      base_decision: 'blocked',
      blocker_count: 6,
      warning_count: 2,
      pending_override_count: 0,
      approved_override_count: 1,
      unresolved_blockers: [
        {
          id: 'governance_critical_escalations_overdue',
          severity: 'blocker',
          source: 'governance',
          message: '1 critical governance incidents are overdue.',
          overridable: false,
        },
      ],
      overridden_blockers: [
        {
          id: 'execution_failures_present',
          severity: 'blocker',
          source: 'execution',
          message: 'Execution has 2 failed checks.',
          overridable: true,
        },
      ],
      pending_override_issues: [],
      rejected_override_issues: [],
    },
  },
];

const governanceRuns = [
  {
    id: 'wp11-governance-controls-final-20260228',
    incident_id: 'incident-wp11-governance-controls-final-20260228',
    report_name: 'wp11-governance-controls-final-20260228',
    artifact_name: 'wp11-governance-controls-final-20260228',
    started_at: '2026-02-28T20:30:00.000Z',
    completed_at: '2026-02-28T20:35:10.000Z',
    duration_ms: 310000,
    trigger: 'manual',
    status: 'pass',
    branch: 'main',
    commit_short: '6e002bd',
    governance_decision: 'ready',
    policy_enforcement: governanceReports[0]?.policy_enforcement,
    execution_review_status: 'ready',
    total_checks: 6,
    passed_checks: 6,
    failed_checks: 0,
  },
  {
    id: 'usage-request-review-warning',
    incident_id: 'incident-usage-request-review-warning',
    report_name: 'usage-request-review-warning',
    artifact_name: 'usage-request-review-warning',
    started_at: '2026-02-28T22:08:00.000Z',
    completed_at: '2026-02-28T22:10:00.000Z',
    duration_ms: 120000,
    trigger: 'scheduled',
    status: 'pass',
    branch: 'main',
    commit_short: '5d1e26e',
    governance_decision: 'warning',
    policy_enforcement: governanceReports[1]?.policy_enforcement,
    execution_review_status: 'ready',
    total_checks: 6,
    passed_checks: 6,
    failed_checks: 0,
  },
  {
    id: 'execution-review-governance-regression-20260227',
    incident_id: 'incident-execution-review-governance-regression-20260227',
    report_name: 'execution-review-governance-regression-20260227',
    artifact_name: 'execution-review-governance-regression-20260227',
    started_at: '2026-02-27T19:15:00.000Z',
    completed_at: '2026-02-27T19:25:00.000Z',
    duration_ms: 600000,
    trigger: 'ci',
    status: 'fail',
    branch: 'main',
    commit_short: 'a0f74a6',
    governance_decision: 'blocked',
    policy_enforcement: governanceReports[2]?.policy_enforcement,
    execution_review_status: 'blocked',
    governance_blockers: [
      { source: 'organization_governance', message: 'organization_governance_drilldown_chain_missing' },
      { source: 'workspace_governance', message: 'workspace_governance_explainability_missing' },
    ],
    governance_warnings: [
      { source: 'governance', message: 'governance_warning_pending_override_review' },
    ],
    total_checks: 6,
    passed_checks: 3,
    failed_checks: 2,
    failed_step_name: 'Governance smoke',
    failed_step_category: 'smoke',
  },
];

const governanceRunDetails = new Map([
  ['wp11-governance-controls-final-20260228', {
    ...governanceRuns[0],
    failed_step_names: [],
    failure_categories: [],
  }],
  ['usage-request-review-warning', {
    ...governanceRuns[1],
    failed_step_names: [],
    failure_categories: [],
  }],
  ['execution-review-governance-regression-20260227', {
    ...governanceRuns[2],
    failed_step_names: ['Governance smoke', 'Project pricing coverage'],
    failure_categories: ['authorization', 'unknown'],
  }],
]);

type GovernanceIncidentHistoryItem = {
  id: string;
  incident_id: string;
  escalation_id: string;
  event_kind: string;
  created_at: string;
  actor_user_id: string;
  actor_name: string;
  previous_assignee_user_id?: string;
  previous_assignee_name?: string;
  previous_due_at?: string;
  next_assignee_user_id?: string;
  next_assignee_name?: string;
  next_due_at?: string;
};

type GovernanceIncidentRecord = {
  id: string;
  incident_id: string;
  report_name: string;
  run_id: string;
  created_at: string;
  event_type: string;
  severity: string;
  status: 'open' | 'resolved';
  title: string;
  body: string;
  artifact_name: string;
  trigger: string;
  governance_decision: string;
  execution_review_status: string;
  assignee_user_id?: string;
  assignee_name?: string;
  due_at?: string;
  age_ms?: number;
  sla_status?: 'on_track' | 'due_soon' | 'overdue' | 'resolved';
  failed_step_name?: string;
  failure_categories?: string[];
  governance_blockers?: Array<{ source: string; message: string }>;
  governance_warnings?: Array<{ source: string; message: string }>;
  webhook_delivery?: Record<string, unknown>;
  incident_history?: GovernanceIncidentHistoryItem[];
  acknowledged_at?: string;
  acknowledged_by_user_id?: string;
  acknowledged_by_name?: string;
  resolution_reason?: string;
  resolution_category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
  resolved_at?: string;
  resolved_by_user_id?: string;
  resolved_by_name?: string;
};

let governanceRunnerStatus = {
  running: false,
  current_operation: undefined as undefined | {
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
  },
  recent_operations: [] as Array<{
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
  }>,
};

const governanceIncidents: GovernanceIncidentRecord[] = [
  {
    id: 'usage-request-review-warning',
    incident_id: 'incident-usage-request-review-warning',
    report_name: 'usage-request-review-warning',
    run_id: 'usage-request-review-warning',
    created_at: '2026-02-28T22:10:00.000Z',
    event_type: 'governance_warning',
    severity: 'warning',
    status: 'open',
    title: 'Governance run completed with warning state',
    body: 'Latest governance run completed with 1 warning issues.',
    artifact_name: 'usage-request-review-warning',
    trigger: 'scheduled',
    governance_decision: 'warning',
    execution_review_status: 'ready',
    assignee_user_id: 'user_governance_owner',
    assignee_name: 'Governance Owner',
    due_at: '2026-03-02T12:00:00.000Z',
    age_ms: 2 * 60 * 60 * 1000,
    sla_status: 'due_soon',
    failure_categories: [],
    webhook_delivery: {
      status: 'skipped',
    },
    incident_history: [
      {
        id: 'rih_usage_001',
        incident_id: 'incident-usage-request-review-warning',
        escalation_id: 'usage-request-review-warning',
        event_kind: 'escalation_assignment',
        created_at: '2026-02-28T22:15:00.000Z',
        actor_user_id: 'mock-user',
        actor_name: 'Mock User',
        next_assignee_user_id: 'user_governance_owner',
        next_assignee_name: 'Governance Owner',
        next_due_at: '2026-03-02T12:00:00.000Z',
      },
    ],
  },
  {
    id: 'execution-review-governance-regression-20260227',
    incident_id: 'incident-execution-review-governance-regression-20260227',
    report_name: 'execution-review-governance-regression-20260227',
    run_id: 'execution-review-governance-regression-20260227',
    created_at: '2026-02-27T19:25:00.000Z',
    event_type: 'governance_blocked',
    severity: 'critical',
    status: 'open',
    title: 'Governance run blocked',
    body: 'Latest governance run is blocked by 4 issues.',
    artifact_name: 'execution-review-governance-regression-20260227',
    trigger: 'ci',
    governance_decision: 'blocked',
    execution_review_status: 'blocked',
    governance_blockers: [
      { source: 'organization_governance', message: 'organization_governance_drilldown_chain_missing' },
      { source: 'workspace_governance', message: 'workspace_governance_explainability_missing' },
    ],
    governance_warnings: [
      { source: 'governance', message: 'governance_warning_pending_override_review' },
    ],
    assignee_user_id: 'user_oncall',
    assignee_name: 'Oncall Engineer',
    due_at: '2026-02-27T20:00:00.000Z',
    age_ms: 5 * 60 * 60 * 1000,
    sla_status: 'overdue',
    failed_step_name: 'Governance smoke',
    failure_categories: ['authorization', 'unknown'],
    webhook_delivery: {
      status: 'failed',
      attempted_at: '2026-02-27T19:25:00.000Z',
      response_status: 500,
      error: 'http_500',
      duration_ms: 820,
    },
    incident_history: [
      {
        id: 'rih_governance_001',
        incident_id: 'incident-execution-review-governance-regression-20260227',
        escalation_id: 'execution-review-governance-regression-20260227',
        event_kind: 'escalation_assignment',
        created_at: '2026-02-27T19:30:00.000Z',
        actor_user_id: 'mock-user',
        actor_name: 'Mock User',
        next_assignee_user_id: 'user_oncall',
        next_assignee_name: 'Oncall Engineer',
        next_due_at: '2026-02-27T20:00:00.000Z',
      },
    ],
  },
  {
    id: 'wp11-governance-controls-final-20260228',
    incident_id: 'incident-wp11-governance-controls-final-20260228',
    report_name: 'wp11-governance-controls-final-20260228',
    run_id: 'wp11-governance-controls-final-20260228',
    created_at: '2026-02-28T20:35:10.000Z',
    event_type: 'governance_ready',
    severity: 'info',
    status: 'resolved',
    title: 'Governance run recovered to ready state',
    body: 'Latest governance run completed successfully and no blocking policy issues remain.',
    artifact_name: 'wp11-governance-controls-final-20260228',
    trigger: 'manual',
    governance_decision: 'ready',
    execution_review_status: 'ready',
    assignee_user_id: 'user_governance_mgr',
    assignee_name: 'Governance Manager',
    due_at: '2026-02-28T20:15:00.000Z',
    age_ms: 30 * 60 * 1000,
    sla_status: 'resolved',
    resolution_category: 'mitigated',
    failure_categories: [],
    webhook_delivery: {
      status: 'success',
      attempted_at: '2026-02-28T20:35:10.000Z',
      response_status: 200,
      duration_ms: 140,
    },
    incident_history: [],
  },
];

const governanceReportDetails = new Map([
  ['wp11-governance-controls-final-20260228', {
    name: 'wp11-governance-controls-final-20260228',
    policy_enforcement: governanceReports[0]?.policy_enforcement,
    report: {
      metadata: {
        timestamp: '2026-02-28T20:35:10.000Z',
        git: { branch: 'main', commit_short: '6e002bd' },
      },
      summary: {
        status: 'pass',
        governance_policy: {
          decision: 'ready',
          blockers: [],
          warnings: [],
          summary: {
            total_issues: 0,
            blocker_count: 0,
            warning_count: 0,
            overridable_count: 0,
          },
        },
        execution_review_evidence: {
          generated_at: '2026-02-28T20:35:09.000Z',
          checks: { review_status: 'ready', blockers: [], warnings: [], target: 'openai/gpt-4o', planned_attempts: 2 },
          pricing_source_coverage: {
            total_usage_facts: 3,
            covered_usage_facts: 3,
            missing_usage_facts: 0,
            missing_price_facts: 0,
            coverage_ratio: 1,
          },
        },
      },
      execution: {
        total_checks: 6,
        passed: 6,
        failed: 0,
        skipped: 0,
        checks: [
          { name: 'TypeScript typecheck', category: 'typecheck', status: 'pass', duration_ms: 18200 },
          { name: 'Model request billing governance workflow', category: 'e2e', status: 'pass', duration_ms: 94100 },
        ],
      },
    },
    markdown: '# Governance Report\n\nStatus: PASS\n',
  }],
  ['usage-request-review-warning', {
    name: 'usage-request-review-warning',
    policy_enforcement: governanceReports[1]?.policy_enforcement,
    report: {
      metadata: {
        timestamp: '2026-02-28T22:10:00.000Z',
        git: { branch: 'main', commit_short: '5d1e26e' },
      },
      summary: {
        status: 'pass',
        governance_policy: {
          decision: 'warning',
          blockers: [],
          warnings: [          ],
          summary: {
            total_issues: 1,
            blocker_count: 0,
            warning_count: 1,
            overridable_count: 1,
          },
        },
        execution_review_evidence: {
          generated_at: '2026-02-28T22:09:58.000Z',
          checks: { review_status: 'ready', blockers: [], warnings: [], target: 'openai/gpt-4o', planned_attempts: 2 },
          pricing_source_coverage: {
            total_usage_facts: 4,
            covered_usage_facts: 4,
            missing_usage_facts: 0,
            missing_price_facts: 0,
            coverage_ratio: 1,
          },
        },
      },
      execution: {
        total_checks: 6,
        passed: 6,
        failed: 0,
        skipped: 0,
        checks: [
          { name: 'TypeScript typecheck', category: 'typecheck', status: 'pass', duration_ms: 17900 },
          { name: 'Usage webhook signature policy', category: 'e2e', status: 'pass', duration_ms: 51100 },
        ],
      },
    },
    markdown: '# Usage Webhook Signature Policy Check\n\nStatus: PASS\n',
  }],
  ['execution-review-governance-regression-20260227', {
    name: 'execution-review-governance-regression-20260227',
    policy_enforcement: governanceReports[2]?.policy_enforcement,
    report: {
      metadata: {
        timestamp: '2026-02-27T19:25:00.000Z',
        git: { branch: 'main', commit_short: 'a0f74a6' },
      },
      summary: {
        status: 'fail',
        governance_policy: {
          decision: 'blocked',
          blockers: [
            {
              id: 'execution_failures_present',
              severity: 'blocker',
              source: 'execution',
              message: 'Execution has 2 failed checks.',
              overridable: false,
            },
            {
              id: 'configuration_check_primary_pricing_missing',
              severity: 'blocker',
              source: 'configuration',
              message: 'configuration_check_primary_pricing_missing',
              overridable: false,
            },
            {
              id: 'request_missing_price_records',
              severity: 'blocker',
              source: 'configuration',
              message: 'Configuration contains 1 missing-price facts.',
              overridable: false,
            },          ],
          warnings: [
            {
              id: 'configuration_check_reroute_pricing_missing',
              severity: 'warning',
              source: 'configuration',
              message: 'configuration_check_reroute_pricing_missing',
              overridable: true,
            },          ],
          summary: {
            total_issues: 4,
            blocker_count: 3,
            warning_count: 1,
            overridable_count: 1,
          },
        },
        execution_review_evidence: {
          generated_at: '2026-02-27T19:24:56.000Z',
          checks: {
            review_status: 'blocked',
            blockers: ['configuration_check_primary_pricing_missing'],
            warnings: ['configuration_check_reroute_pricing_missing'],
            target: 'openai/gpt-4o',
            planned_attempts: 2,
          },
          pricing_source_coverage: {
            total_usage_facts: 3,
            covered_usage_facts: 2,
            missing_usage_facts: 1,
            missing_price_facts: 1,
            coverage_ratio: 0.67,
          },
        },
      },
      execution: {
        total_checks: 6,
        passed: 3,
        failed: 2,
        skipped: 1,
        checks: [
          { name: 'TypeScript typecheck', category: 'typecheck', status: 'pass', duration_ms: 18100 },
          { name: 'Governance smoke', category: 'smoke', status: 'fail', duration_ms: 60300 },
          { name: 'Project pricing coverage', category: 'pricing', status: 'fail', duration_ms: 12400 },
          { name: 'Visual regression', category: 'visual', status: 'skipped', duration_ms: 0 },
        ],
      },
    },
    markdown: '# Execution Review Governance Regression\n\nStatus: FAIL\n',
  }],
]);

export const usageHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/usage/operations-summary', ({ request }) => {
    const url = new URL(request.url);
    const start = url.searchParams.get('start_time') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const end = url.searchParams.get('end_time') ?? new Date().toISOString();
    const resourceType = url.searchParams.get('resource_type');
    const resourceId = url.searchParams.get('resource_id');
    const endUserId = url.searchParams.get('end_user_id');
    const provider = url.searchParams.get('provider');
    const model = url.searchParams.get('model');
    const result = url.searchParams.get('result');
    const errorClass = url.searchParams.get('error_class');
    const requestFacts = listRequestUsageFacts({
      startTime: start,
      endTime: end,
      resourceType,
      resourceId,
      endUserId,
      provider,
      model,
      result: result === 'ok' || result === 'error' ? result : null,
      errorClass: errorClass === 'provider_retryable' || errorClass === 'provider_non_retryable' || errorClass === 'system_error' ? errorClass : null,
    });
    const fixtureFactsBase: RequestFactLike[] = [
      {
        timestamp: end,
        end_user_id: 'user_001',
        request_id: 'req_model_001',
        requests: 1,
        result: 'ok',
        request_details: {
          provider: 'secondaryok',
          resolved_model: 'model-b',
          estimated_cost: 0.0068,
        },
      },
      {
        timestamp: start,
        end_user_id: 'user_002',
        request_id: 'req_model_002',
        requests: 1,
        result: 'error',
        error_code: 'UPSTREAM_429',
        request_details: {
          provider: 'primaryfail',
          resolved_model: 'model-a',
          error_class: 'provider_retryable',
          estimated_cost: null,
        },
      },
    ];
    const fixtureFacts = fixtureFactsBase.filter((item) => {
      if (endUserId && item.end_user_id !== endUserId) return false;
      if (provider && item.request_details?.provider !== provider) return false;
      if (model && item.request_details?.resolved_model !== model) return false;
      if (result && item.result !== result) return false;
      if (errorClass && item.request_details?.error_class !== errorClass) return false;
      return true;
    });
    return HttpResponse.json(buildUsageOperationsSummary([...requestFacts, ...fixtureFacts]));
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/limits/summary', () => {
    const resources = p0.top_resources as Array<{
      resource_id: string;
      resource_name: string;
      resource_type: ResourceType;
      requests: number;
    }>;
    const now = new Date();
    const resetAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    const endpoints = resources
      .filter((item) => item.resource_type === 'endpoint')
      .map((item) => {
        const requestsPerMinuteLimit = 1200;
        const requestsPer5HoursLimit = 18000;
        const requestsPerDayLimit = 20000;
        const spendingPerDayLimitUsd = 500;

        const requestsPerMinuteUsed = Math.max(1, Math.round(item.requests / 60));
        const requestsPer5HoursUsed = Math.max(1, Math.round(item.requests * 0.75));
        const requestsPerDayUsed = item.requests;
        const spendingPerDayUsedUsd = Math.max(1, Number((item.requests * 0.08).toFixed(2)));

        const makeRule = (
          kind: 'rate_limit' | 'spending_limit',
          window: 'minute' | '5h' | 'day' | 'current',
          metric: 'requests' | 'usd',
          policyKey: string,
          used: number,
          max: number,
        ) => ({
          kind,
          window,
          metric,
          policy_key: policyKey,
          used,
          max,
          remaining: Math.max(0, max - used),
          usage_pct: Number((max > 0 ? Math.min(100, (used / max) * 100) : 0).toFixed(2)),
          reset_at: resetAt,
        });

        return {
          endpoint_id: item.resource_id,
          endpoint_name: item.resource_name,
          limits: [
            makeRule('rate_limit', 'minute', 'requests', 'endpoint.requests_per_minute', requestsPerMinuteUsed, requestsPerMinuteLimit),
            makeRule('rate_limit', '5h', 'requests', 'endpoint.requests_per_5_hours', requestsPer5HoursUsed, requestsPer5HoursLimit),
            makeRule('rate_limit', 'day', 'requests', 'endpoint.requests_per_day', requestsPerDayUsed, requestsPerDayLimit),
            makeRule('spending_limit', 'day', 'usd', 'endpoint.spending_usd_per_day', spendingPerDayUsedUsd, spendingPerDayLimitUsd),
          ],
        };
      });
    return HttpResponse.json({
      endpoints,
    });
  }),
];
