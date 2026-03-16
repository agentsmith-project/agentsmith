/**
 * Audit & Usage API Endpoints
 *
 * Typed API functions for audit and usage operations.
 */

import type {
  AuditEvent,
  UsageFactRecord,
  UsageRecord,
  AuditListParams,
  UsageListParams,
  PaginatedResponse,
} from '../types';
import type { ApiClient } from '../client';

export interface UsageDataPoint {
  time_bucket: string;
  requests: number;
  errors: number;
  tokens?: number;
  estimated_cost?: number;
  duration_p95_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
}

export interface ResourceCostBreakdown {
  resource_id: string;
  resource_name: string;
  resource_type: string;
  requests: number;
  tokens?: number;
  estimated_cost: number;
  percentage_of_total: number;
}

export interface UsageTimeseriesResponse {
  data_points: UsageDataPoint[];
  resource_breakdown?: ResourceCostBreakdown[];
  time_range: {
    start: string;
    end: string;
    granularity?: 'hour' | 'day' | 'week' | 'month';
  };
  total_cost?: number;
}

export interface LimitRuleSnapshot {
  kind: 'rate_limit' | 'spending_limit';
  window: 'minute' | '5h' | 'day';
  metric: 'requests' | 'usd' | 'tokens';
  policy_key: string;
  used: number;
  max: number;
  remaining: number;
  usage_pct: number;
  reset_at: string;
}

export interface EndpointLimitSummary {
  endpoint_id: string;
  endpoint_name: string;
  limits: LimitRuleSnapshot[];
}

export interface LimitsOverview {
  endpoints?: EndpointLimitSummary[];
  project_summary?: {
    project_used: number;
    project_max: number;
    project_remaining: number;
    project_usage_pct: number;
  };
}

export interface UsageRecordsSummaryResponse {
  total_requests: number;
  total_errors: number;
  error_rate: number;
  reroute_hops_histogram: Record<string, number>;
  error_class_counts: {
    provider_retryable: number;
    provider_non_retryable: number;
    system_error: number;
  };
  avg_estimated_cost: number;
  p95_estimated_cost: number;
  records_health: {
    rerouted_requests: number;
    terminal_error_requests: number;
    missing_price_records: number;
    provider_count: number;
    model_count: number;
  };
  request_trend: Array<{
    time_bucket: string;
    requests: number;
    errors: number;
    rerouted_requests: number;
    avg_estimated_cost: number;
    duration_p95_ms?: number;
  }>;
  latency_distribution_ms: {
    p50?: number;
    p95?: number;
    p99?: number;
  };
  cost_distribution_usd: {
    p50?: number;
    p95?: number;
    p99?: number;
  };
  issue_signals: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high';
    kind: 'fallback_spike' | 'error_rate_spike' | 'missing_price' | 'latency_spike';
    title: string;
    message: string;
  }>;
  provider_breakdown: Array<{
    provider: string;
    requests: number;
    errors: number;
    error_rate: number;
    reroute_rate: number;
    avg_estimated_cost: number;
    p95_estimated_cost: number;
    missing_price_records: number;
  }>;
  model_breakdown: Array<{
    provider: string;
    model: string;
    requests: number;
    errors: number;
    error_rate: number;
    reroute_rate: number;
    avg_estimated_cost: number;
    p95_estimated_cost: number;
    missing_price_records: number;
  }>;
  time_range: {
    start: string;
    end: string;
  };
}

export interface UsageOperationsSummaryResponse {
  top_providers: Array<{
    provider: string;
    requests: number;
    errors: number;
    estimated_cost: number;
  }>;
  top_models: Array<{
    provider: string;
    model: string;
    requests: number;
    errors: number;
    estimated_cost: number;
  }>;
  top_end_users: Array<{
    end_user_id: string;
    requests: number;
    errors: number;
    estimated_cost: number;
  }>;
  anomaly_peaks: Array<{
    id: string;
    time_bucket: string;
    metric: 'requests' | 'errors' | 'cost';
    value: number;
    baseline: number;
    severity: 'medium' | 'high';
  }>;
  recent_requests: Array<{
    id: string;
    timestamp: string;
    request_id?: string;
    provider?: string;
    model?: string;
    end_user_id?: string;
    result: 'ok' | 'error';
    error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
    estimated_cost?: number;
  }>;
  webhook_destinations: Array<{
    host: string;
    path?: string;
    protocol?: string;
    deliveries: number;
    successes: number;
    failures: number;
    success_rate: number;
    avg_latency_ms?: number;
    p95_latency_ms?: number;
    timeout_failures: number;
    network_failures: number;
    auth_failures: number;
    client_failures: number;
    server_failures: number;
    last_status: 'success' | 'failed';
    last_delivery_at: string;
  }>;
}

export class AuditAPI {
  constructor(private client: ApiClient) {}

  private static asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private static asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private static normalizeActorType(value: unknown): string {
    const actorType = AuditAPI.asString(value);
    return actorType ?? 'user';
  }

  private static normalizeResult(value: unknown): 'ok' | 'error' {
    return value === 'error' ? 'error' : 'ok';
  }

  private static extractTraceRefs(item: Record<string, unknown>, metadata: Record<string, unknown>) {
    const getValue = (...keys: string[]) => {
      for (const key of keys) {
        const topValue = AuditAPI.asString(item[key]);
        if (topValue) return topValue;
        const metaValue = AuditAPI.asString(metadata[key]);
        if (metaValue) return metaValue;
      }
      return undefined;
    };
    const incidentId = getValue('trace_incident_id', 'incident_id');
    const escalationId = getValue('trace_escalation_id', 'escalation_id');
    const runId = getValue('trace_run_id', 'run_id');
    return {
      trace_ref: getValue('trace_ref') ?? escalationId ?? incidentId ?? runId,
      trace_incident_id: incidentId,
      trace_escalation_id: escalationId,
      trace_run_id: runId,
    };
  }

  private static normalizeAuditEvent(
    item: unknown,
    workspaceId: string,
    projectId: string,
  ): AuditEvent {
    const record = AuditAPI.asRecord(item) ?? {};
    const metadata = AuditAPI.asRecord(record.metadata_json) ?? AuditAPI.asRecord(record.metadata) ?? {};
    const traceRefs = AuditAPI.extractTraceRefs(record, metadata);
    const decisionId = AuditAPI.asString(record.decision_id) ?? AuditAPI.asString(metadata.decision_id);
    const id = AuditAPI.asString(record.id)
      ?? AuditAPI.asString(record.request_id)
      ?? `${workspaceId}-${projectId}-${AuditAPI.asString(record.timestamp) ?? 'audit'}`;
    const timestamp = AuditAPI.asString(record.timestamp) ?? new Date(0).toISOString();
    const requestId = AuditAPI.asString(record.request_id) ?? id;

    return {
      id,
      timestamp,
      workspace_id: AuditAPI.asString(record.workspace_id) ?? workspaceId,
      project_id: AuditAPI.asString(record.project_id) ?? projectId,
      actor_type: AuditAPI.normalizeActorType(record.actor_type),
      actor_id: AuditAPI.asString(record.actor_id) ?? 'unknown',
      action: AuditAPI.asString(record.action) ?? 'unknown',
      resource_type: AuditAPI.asString(record.resource_type),
      resource_id: AuditAPI.asString(record.resource_id),
      end_user_id: AuditAPI.asString(record.end_user_id),
      result: AuditAPI.normalizeResult(record.result),
      error_code: AuditAPI.asString(record.error_code),
      error_message: AuditAPI.asString(record.error_message),
      request_id: requestId,
      decision_id: decisionId,
      trace_ref: traceRefs.trace_ref,
      trace_incident_id: traceRefs.trace_incident_id,
      trace_escalation_id: traceRefs.trace_escalation_id,
      trace_run_id: traceRefs.trace_run_id,
      metadata_json: metadata,
    };
  }

  /**
   * List audit events with filters
   */
  async list(
    workspaceId: string,
    projectId: string,
    params: AuditListParams,
  ): Promise<PaginatedResponse<AuditEvent>> {
    const searchParams = new URLSearchParams();

    // Required time range
    searchParams.set('start_time', params.start_time);
    searchParams.set('end_time', params.end_time);

    // Pagination
    if (params.page) searchParams.set('page', params.page.toString());
    if (params.page_size) searchParams.set('page_size', params.page_size.toString());

    // Filters
    if (params.action) searchParams.set('action', params.action);
    if (params.actor_type) searchParams.set('actor_type', params.actor_type);
    if (params.actor_id) searchParams.set('actor_id', params.actor_id);
    if (params.end_user_id) searchParams.set('end_user_id', params.end_user_id);
    if (params.resource_type) searchParams.set('resource_type', params.resource_type);
    if (params.resource_id) searchParams.set('resource_id', params.resource_id);
    if (params.request_id) searchParams.set('request_id', params.request_id);
    if (params.decision_id) searchParams.set('decision_id', params.decision_id);
    if (params.trace_ref) searchParams.set('trace_ref', params.trace_ref);
    if (params.trace_incident_id) searchParams.set('trace_incident_id', params.trace_incident_id);
    if (params.trace_escalation_id) searchParams.set('trace_escalation_id', params.trace_escalation_id);
    if (params.trace_run_id) searchParams.set('trace_run_id', params.trace_run_id);
    if (params.result) searchParams.set('result', params.result);

    // Sorting
    if (params.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params.sort_order) searchParams.set('sort_order', params.sort_order);

    // Validate time range (max 90 days)
    const startTime = new Date(params.start_time);
    const endTime = new Date(params.end_time);
    const daysDiff = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > 90) {
      throw new Error('Time range cannot exceed 90 days');
    }

    const query = searchParams.toString();
    const response = await this.client.get<PaginatedResponse<unknown>>(
      `/workspaces/${workspaceId}/projects/${projectId}/audit${query ? `?${query}` : ''}`,
    );
    const items = Array.isArray(response.items)
      ? response.items.map((item) => AuditAPI.normalizeAuditEvent(item, workspaceId, projectId))
      : [];
    return {
      ...response,
      items,
    };
  }
}

export class UsageAPI {
  constructor(private client: ApiClient) {}

  private static asNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private static asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  private static pick(record: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
      if (key in record) return record[key];
    }
    return undefined;
  }

  private static normalizeLimitRule(item: unknown): LimitRuleSnapshot | null {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    const rawKind = String(UsageAPI.pick(record, ['kind', 'limit_kind', 'type']) ?? '').toLowerCase();
    const rawWindow = String(UsageAPI.pick(record, ['window', 'time_window', 'period']) ?? '').toLowerCase();
    const rawMetric = String(UsageAPI.pick(record, ['metric', 'unit']) ?? '').toLowerCase();

    const kind: LimitRuleSnapshot['kind'] | null = (() => {
      if (rawKind === 'rate_limit' || rawKind === 'rate') return 'rate_limit';
      if (rawKind === 'spending_limit' || rawKind === 'spending' || rawKind === 'cost') return 'spending_limit';
      return null;
    })();
    const window: LimitRuleSnapshot['window'] | null = (() => {
      if (rawWindow === 'minute' || rawWindow === 'min') return 'minute';
      if (rawWindow === '5h' || rawWindow === '5hour' || rawWindow === '5hours' || rawWindow === '5_hour') return '5h';
      if (rawWindow === 'day' || rawWindow === 'daily') return 'day';
      return null;
    })();
    const metric: LimitRuleSnapshot['metric'] = (() => {
      if (rawMetric === 'usd' || rawMetric === 'cost' || rawMetric === 'money') return 'usd';
      if (rawMetric === 'token' || rawMetric === 'tokens') return 'tokens';
      if (rawMetric === 'requests' || rawMetric === 'request' || rawMetric === 'req') return 'requests';
      return kind === 'spending_limit' ? 'usd' : 'requests';
    })();

    const policyKey = UsageAPI.asString(UsageAPI.pick(record, ['policy_key', 'policyKey', 'key']));
    const used = UsageAPI.asNumber(UsageAPI.pick(record, ['used', 'current_usage', 'currentUsed'])) ?? 0;
    const max = UsageAPI.asNumber(UsageAPI.pick(record, ['max', 'limit', 'effective_limit', 'effectiveLimit'])) ?? 0;
    const resetAt = UsageAPI.asString(UsageAPI.pick(record, ['reset_at', 'resetAt', 'window_reset_at', 'windowResetAt'])) ?? '';

    if (!kind || !window || !policyKey) {
      return null;
    }

    const remaining = UsageAPI.asNumber(UsageAPI.pick(record, ['remaining', 'remaining_usage', 'remainingUsage']))
      ?? Math.max(0, max - used);
    const usagePct = UsageAPI.asNumber(UsageAPI.pick(record, ['usage_pct', 'usagePct']))
      ?? (max > 0 ? Math.min(100, (used / max) * 100) : 0);

    return {
      kind,
      window,
      metric,
      policy_key: policyKey,
      used,
      max,
      remaining,
      usage_pct: usagePct,
      reset_at: resetAt,
    };
  }

  private static normalizeLimitsOverview(payload: unknown): LimitsOverview {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const rawEndpoints = UsageAPI.pick(record, ['endpoints', 'endpoint_summaries', 'endpointSummaries']);
    const endpoints = Array.isArray(rawEndpoints)
      ? rawEndpoints
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const endpoint = item as Record<string, unknown>;
          const endpointId = UsageAPI.asString(
            UsageAPI.pick(endpoint, ['endpoint_id', 'endpointId', 'id']),
          );
          const endpointName = UsageAPI.asString(
            UsageAPI.pick(endpoint, ['endpoint_name', 'endpointName', 'name']),
          ) ?? endpointId ?? 'unknown';
          if (!endpointId) return null;
          const rawLimits = UsageAPI.pick(endpoint, ['limits', 'rules', 'snapshots']);
          const limits = Array.isArray(rawLimits)
            ? rawLimits
              .map((rule) => UsageAPI.normalizeLimitRule(rule))
              .filter((rule): rule is LimitRuleSnapshot => rule !== null)
            : [];
          return {
            endpoint_id: endpointId,
            endpoint_name: endpointName,
            limits,
          };
        })
        .filter((item): item is EndpointLimitSummary => item !== null)
      : undefined;

    const rawProjectSummary = UsageAPI.pick(record, ['project_summary', 'projectSummary']);
    const projectSummaryRecord = rawProjectSummary && typeof rawProjectSummary === 'object'
      ? rawProjectSummary as Record<string, unknown>
      : null;
    const projectUsed = UsageAPI.asNumber(UsageAPI.pick(projectSummaryRecord ?? {}, ['project_used', 'projectUsed', 'used']));
    const projectMax = UsageAPI.asNumber(UsageAPI.pick(projectSummaryRecord ?? {}, ['project_max', 'projectMax', 'max']));
    const projectRemaining = UsageAPI.asNumber(UsageAPI.pick(projectSummaryRecord ?? {}, ['project_remaining', 'projectRemaining', 'remaining']));
    const projectUsagePct = UsageAPI.asNumber(UsageAPI.pick(projectSummaryRecord ?? {}, ['project_usage_pct', 'projectUsagePct', 'usage_pct', 'usagePct']));
    const projectSummary = (
      projectUsed !== undefined
      && projectMax !== undefined
      && projectRemaining !== undefined
      && projectUsagePct !== undefined
    )
      ? {
        project_used: projectUsed,
        project_max: projectMax,
        project_remaining: projectRemaining,
        project_usage_pct: projectUsagePct,
      }
      : undefined;

    return {
      endpoints,
      project_summary: projectSummary,
    };
  }

  /**
   * Get usage records (aggregated)
   */
  async list(
    workspaceId: string,
    projectId: string,
    params: UsageListParams,
  ): Promise<PaginatedResponse<UsageRecord>> {
    const searchParams = new URLSearchParams();

    // Required time range
    searchParams.set('start_time', params.start_time);
    searchParams.set('end_time', params.end_time);

    // Pagination
    if (params.page) searchParams.set('page', params.page.toString());
    if (params.page_size) searchParams.set('page_size', params.page_size.toString());

    // Filters
    if (params.resource_type) searchParams.set('resource_type', params.resource_type);
    if (params.resource_id) searchParams.set('resource_id', params.resource_id);
    if (params.end_user_id) searchParams.set('end_user_id', params.end_user_id);
    if (params.provider) searchParams.set('provider', params.provider);
    if (params.model) searchParams.set('model', params.model);
    if (params.request_id) searchParams.set('request_id', params.request_id);
    if (params.decision_id) searchParams.set('decision_id', params.decision_id);
    if (params.trace_ref) searchParams.set('trace_ref', params.trace_ref);
    if (params.trace_incident_id) searchParams.set('trace_incident_id', params.trace_incident_id);
    if (params.trace_escalation_id) searchParams.set('trace_escalation_id', params.trace_escalation_id);
    if (params.trace_run_id) searchParams.set('trace_run_id', params.trace_run_id);
    if (params.result) searchParams.set('result', params.result);
    if (params.error_class) searchParams.set('error_class', params.error_class);
    if (params.group_by) searchParams.set('group_by', params.group_by);

    // Sorting
    if (params.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params.sort_order) searchParams.set('sort_order', params.sort_order);

    // Validate time range (max 90 days)
    const startTime = new Date(params.start_time);
    const endTime = new Date(params.end_time);
    const daysDiff = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > 90) {
      throw new Error('Time range cannot exceed 90 days');
    }

    const query = searchParams.toString();
    return this.client.get<PaginatedResponse<UsageRecord>>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage${query ? `?${query}` : ''}`,
    );
  }

  async listFacts(
    workspaceId: string,
    projectId: string,
    params: Omit<UsageListParams, 'group_by' | 'sort_by'>,
  ): Promise<PaginatedResponse<UsageFactRecord>> {
    const searchParams = new URLSearchParams();
    searchParams.set('start_time', params.start_time);
    searchParams.set('end_time', params.end_time);
    if (params.page) searchParams.set('page', params.page.toString());
    if (params.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params.resource_type) searchParams.set('resource_type', params.resource_type);
    if (params.resource_id) searchParams.set('resource_id', params.resource_id);
    if (params.end_user_id) searchParams.set('end_user_id', params.end_user_id);
    if (params.provider) searchParams.set('provider', params.provider);
    if (params.model) searchParams.set('model', params.model);
    if (params.request_id) searchParams.set('request_id', params.request_id);
    if (params.decision_id) searchParams.set('decision_id', params.decision_id);
    if (params.trace_ref) searchParams.set('trace_ref', params.trace_ref);
    if (params.trace_incident_id) searchParams.set('trace_incident_id', params.trace_incident_id);
    if (params.trace_escalation_id) searchParams.set('trace_escalation_id', params.trace_escalation_id);
    if (params.trace_run_id) searchParams.set('trace_run_id', params.trace_run_id);
    if (params.result) searchParams.set('result', params.result);
    if (params.error_class) searchParams.set('error_class', params.error_class);
    if (params.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    return this.client.get<PaginatedResponse<UsageFactRecord>>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/facts?${query}`,
    );
  }

  /**
   * Get usage/cost time-series data
   */
  async getTimeseries(
    workspaceId: string,
    projectId: string,
    params: {
      start_time: string;
      end_time: string;
      granularity?: 'hour' | 'day' | 'week' | 'month';
      metric?: 'tokens' | 'requests' | 'cost' | 'bytes';
      resource_type?: 'endpoint' | 'file_library' | 'agent';
      resource_id?: string;
      end_user_id?: string;
    },
  ): Promise<UsageTimeseriesResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('start_time', params.start_time);
    searchParams.set('end_time', params.end_time);
    if (params.granularity) searchParams.set('granularity', params.granularity);
    if (params.metric) searchParams.set('metric', params.metric);
    if (params.resource_type) searchParams.set('resource_type', params.resource_type);
    if (params.resource_id) searchParams.set('resource_id', params.resource_id);
    if (params.end_user_id) searchParams.set('end_user_id', params.end_user_id);

    return this.client.get<UsageTimeseriesResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/timeseries?${searchParams.toString()}`,
    );
  }

  /**
   * Get aggregate limits summary for the project
   */
  async getLimitsSummary(
    workspaceId: string,
    projectId: string,
  ): Promise<LimitsOverview> {
    const response = await this.client.get<unknown>(
      `/workspaces/${workspaceId}/projects/${projectId}/limits/summary`,
    );
    return UsageAPI.normalizeLimitsOverview(response);
  }

  async getUsageRecordsSummary(
    workspaceId: string,
    projectId: string,
    params: {
      start_time: string;
      end_time: string;
      provider?: string;
      model?: string;
      result?: 'ok' | 'error';
      error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
    },
  ): Promise<UsageRecordsSummaryResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('start_time', params.start_time);
    searchParams.set('end_time', params.end_time);
    if (params.provider) searchParams.set('provider', params.provider);
    if (params.model) searchParams.set('model', params.model);
    if (params.result) searchParams.set('result', params.result);
    if (params.error_class) searchParams.set('error_class', params.error_class);
    return this.client.get<UsageRecordsSummaryResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/records-summary?${searchParams.toString()}`,
    );
  }

  async getOperationsSummary(
    workspaceId: string,
    projectId: string,
    params: {
      start_time: string;
      end_time: string;
      resource_type?: string;
      resource_id?: string;
      end_user_id?: string;
      provider?: string;
      model?: string;
      result?: 'ok' | 'error';
      error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
    },
  ): Promise<UsageOperationsSummaryResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('start_time', params.start_time);
    searchParams.set('end_time', params.end_time);
    if (params.resource_type) searchParams.set('resource_type', params.resource_type);
    if (params.resource_id) searchParams.set('resource_id', params.resource_id);
    if (params.end_user_id) searchParams.set('end_user_id', params.end_user_id);
    if (params.provider) searchParams.set('provider', params.provider);
    if (params.model) searchParams.set('model', params.model);
    if (params.result) searchParams.set('result', params.result);
    if (params.error_class) searchParams.set('error_class', params.error_class);
    return this.client.get<UsageOperationsSummaryResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/operations-summary?${searchParams.toString()}`,
    );
  }

}
