/**
 * Audit & Usage API Endpoints
 *
 * Typed API functions for audit and usage operations.
 */

import type {
  AuditEvent,
  UsageFactRecord,
  UsageRecord,
  UsageKPI,
  AuditListParams,
  UsageListParams,
  PaginatedResponse,
} from '../types';
import type { ApiClient } from '../client';
import { API_BASE } from '../client';

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

export interface QuotaSummaryItem {
  resource_id: string;
  resource_name: string;
  resource_type: 'endpoint' | 'source_library' | 'agent';
  quota_used: number;
  quota_limit: number;
  quota_unit: 'tokens' | 'requests' | 'bytes' | 'files';
  quota_reset_at: string;
  percentage_used: number;
}

export interface QuotaOverview {
  endpoints?: QuotaSummaryItem[];
  source_libraries?: QuotaSummaryItem[];
  agents?: QuotaSummaryItem[];
  total_quota_limit?: number;
  total_quota_used?: number;
}

export interface RuntimeObservabilityResponse {
  total_requests: number;
  total_errors: number;
  error_rate: number;
  fallback_hops_histogram: Record<string, number>;
  error_class_counts: {
    provider_retryable: number;
    provider_non_retryable: number;
    system_error: number;
  };
  avg_estimated_cost: number;
  p95_estimated_cost: number;
  health_summary: {
    recovered_requests: number;
    terminal_error_requests: number;
    missing_price_facts: number;
    provider_count: number;
    model_count: number;
  };
  request_trend: Array<{
    time_bucket: string;
    requests: number;
    errors: number;
    recovered_requests: number;
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
  degradation_signals: Array<{
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
    fallback_rate: number;
    avg_estimated_cost: number;
    p95_estimated_cost: number;
    missing_price_facts: number;
  }>;
  model_breakdown: Array<{
    provider: string;
    model: string;
    requests: number;
    errors: number;
    error_rate: number;
    fallback_rate: number;
    avg_estimated_cost: number;
    p95_estimated_cost: number;
    missing_price_facts: number;
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
}

export interface UsageReportSchedule {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  cadence: 'daily' | 'weekly' | 'monthly';
  status: 'active' | 'paused';
  format: 'csv' | 'json';
  time_window: 'last_24h' | 'last_7d' | 'last_30d';
  delivery_channel: 'in_app' | 'webhook';
  delivery_config?: {
    webhook_url?: string;
  };
  filters?: {
    resource_type?: string;
    resource_id?: string;
    end_user_id?: string;
    provider?: string;
    model?: string;
    result?: 'ok' | 'error';
    error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
  };
  release_evidence_required: boolean;
  empty_result_policy: 'deliver' | 'fail';
  created_at: string;
  updated_at: string;
  next_run_at: string;
  last_run_at?: string;
  last_delivery_status?: 'idle' | 'success' | 'failed';
  last_delivery_at?: string;
  last_delivery_error?: string;
  recent_deliveries?: UsageReportDelivery[];
}

export interface UsageReportDelivery {
  id: string;
  workspace_id: string;
  project_id: string;
  schedule_id: string;
  trigger: 'scheduled' | 'manual' | 'retry' | 'test';
  status: 'success' | 'failed';
  attempt_count: number;
  report_period_start: string;
  report_period_end: string;
  created_at: string;
  completed_at: string;
  preview_filename?: string;
  content_type?: string;
  summary: {
    requests: number;
    errors: number;
    top_provider?: string;
    estimated_cost?: number;
  };
  error?: string;
  error_class?: 'empty_result' | 'delivery_channel' | 'system_error';
  acknowledged_at?: string;
  acknowledged_by?: string;
  parent_delivery_id?: string;
  delivery_metadata?: Record<string, unknown>;
}

export interface UsageReportScheduleDeliveryResult {
  delivery_id: string;
  schedule_id: string;
  delivery_channel: 'in_app' | 'webhook';
  generated_at: string;
  preview_filename: string;
  content_type: string;
  status: 'success' | 'failed';
  summary: {
    requests: number;
    errors: number;
    top_provider?: string;
    estimated_cost?: number;
  };
  error?: string;
  error_class?: 'empty_result' | 'delivery_channel' | 'system_error';
  delivery_metadata?: Record<string, unknown>;
}

export interface UsageReportEvidence {
  source: 'artifact' | 'dry_run';
  generated_at: string;
  release_readiness: 'ready' | 'blocked';
  blockers: string[];
  warnings: string[];
  active_schedules: number;
  required_schedules: number;
  successful_deliveries_last_7d: number;
  failed_deliveries_last_7d: number;
  unacknowledged_required_deliveries: number;
  runner_health?: {
    enabled: boolean;
    interval_ms: number;
    running: boolean;
    run_count: number;
    last_status: 'idle' | 'success' | 'failed';
    last_started_at?: string;
    last_completed_at?: string;
    last_error?: string;
    last_result?: {
      generated_at: string;
      processed_schedules: number;
      successful_deliveries: number;
      failed_deliveries: number;
    };
  };
}

export class AuditAPI {
  constructor(private client: ApiClient) {}

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
    return this.client.get<PaginatedResponse<AuditEvent>>(
      `/workspaces/${workspaceId}/projects/${projectId}/audit${query ? `?${query}` : ''}`,
    );
  }
}

export class UsageAPI {
  constructor(private client: ApiClient) {}

  /**
   * Get usage KPI summary
   */
  async getKPI(
    workspaceId: string,
    projectId: string,
    startTime?: string,
    endTime?: string,
    endUserId?: string,
  ): Promise<UsageKPI> {
    const searchParams = new URLSearchParams();
    if (startTime) searchParams.set('start_time', startTime);
    if (endTime) searchParams.set('end_time', endTime);
    if (endUserId) searchParams.set('end_user_id', endUserId);

    const query = searchParams.toString();
    return this.client.get<UsageKPI>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/kpi${query ? `?${query}` : ''}`,
    );
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
      resource_type?: 'endpoint' | 'source_library' | 'agent';
    },
  ): Promise<UsageTimeseriesResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('start_time', params.start_time);
    searchParams.set('end_time', params.end_time);
    if (params.granularity) searchParams.set('granularity', params.granularity);
    if (params.metric) searchParams.set('metric', params.metric);
    if (params.resource_type) searchParams.set('resource_type', params.resource_type);

    return this.client.get<UsageTimeseriesResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/timeseries?${searchParams.toString()}`,
    );
  }

  /**
   * Get aggregate quota summary for the project
   */
  async getQuotaSummary(
    workspaceId: string,
    projectId: string,
  ): Promise<QuotaOverview> {
    return this.client.get<QuotaOverview>(
      `/workspaces/${workspaceId}/projects/${projectId}/quota/summary`,
    );
  }

  async getRuntimeObservability(
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
  ): Promise<RuntimeObservabilityResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('start_time', params.start_time);
    searchParams.set('end_time', params.end_time);
    if (params.provider) searchParams.set('provider', params.provider);
    if (params.model) searchParams.set('model', params.model);
    if (params.result) searchParams.set('result', params.result);
    if (params.error_class) searchParams.set('error_class', params.error_class);
    return this.client.get<RuntimeObservabilityResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/runtime-observability?${searchParams.toString()}`,
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

  async exportReport(
    workspaceId: string,
    projectId: string,
    params: {
      start_time: string;
      end_time: string;
      format: 'csv' | 'json';
      resource_type?: string;
      resource_id?: string;
      end_user_id?: string;
      provider?: string;
      model?: string;
      result?: 'ok' | 'error';
      error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
    },
  ): Promise<{ blob: Blob; filename: string; contentType: string }> {
    const searchParams = new URLSearchParams();
    searchParams.set('start_time', params.start_time);
    searchParams.set('end_time', params.end_time);
    searchParams.set('format', params.format);
    if (params.resource_type) searchParams.set('resource_type', params.resource_type);
    if (params.resource_id) searchParams.set('resource_id', params.resource_id);
    if (params.end_user_id) searchParams.set('end_user_id', params.end_user_id);
    if (params.provider) searchParams.set('provider', params.provider);
    if (params.model) searchParams.set('model', params.model);
    if (params.result) searchParams.set('result', params.result);
    if (params.error_class) searchParams.set('error_class', params.error_class);

    const path = `/workspaces/${workspaceId}/projects/${projectId}/usage/export?${searchParams.toString()}`;
    const token = this.client.getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message =
        typeof errorData === 'object' && errorData && 'message' in errorData
          ? String((errorData as { message?: string }).message)
          : `Export failed: ${response.statusText}`;
      throw new Error(message);
    }

    const disposition = response.headers.get('content-disposition') ?? '';
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    return {
      blob: await response.blob(),
      filename: filenameMatch?.[1] ?? `usage-report.${params.format}`,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async listReportSchedules(
    workspaceId: string,
    projectId: string,
  ): Promise<{ items: UsageReportSchedule[] }> {
    return this.client.get<{ items: UsageReportSchedule[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/report-schedules`,
    );
  }

  async createReportSchedule(
    workspaceId: string,
    projectId: string,
    body: Omit<UsageReportSchedule, 'id' | 'workspace_id' | 'project_id' | 'created_at' | 'updated_at' | 'next_run_at' | 'last_run_at' | 'last_delivery_status' | 'last_delivery_at' | 'last_delivery_error' | 'recent_deliveries'>,
  ): Promise<UsageReportSchedule> {
    const requestBody = {
      ...body,
      webhook_url: body.delivery_channel === 'webhook' ? body.delivery_config?.webhook_url : undefined,
    };
    return this.client.post<UsageReportSchedule>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/report-schedules`,
      requestBody,
    );
  }

  async updateReportSchedule(
    workspaceId: string,
    projectId: string,
    scheduleId: string,
    patch: Partial<Pick<UsageReportSchedule, 'name' | 'cadence' | 'status' | 'format' | 'time_window' | 'delivery_channel' | 'delivery_config' | 'filters' | 'release_evidence_required' | 'empty_result_policy'>>,
  ): Promise<UsageReportSchedule> {
    const requestBody = {
      ...patch,
      webhook_url: patch.delivery_channel === 'webhook' ? patch.delivery_config?.webhook_url : undefined,
    };
    return this.client.patch<UsageReportSchedule>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/report-schedules/${scheduleId}`,
      requestBody,
    );
  }

  async deleteReportSchedule(
    workspaceId: string,
    projectId: string,
    scheduleId: string,
  ): Promise<void> {
    await this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/report-schedules/${scheduleId}`,
    );
  }

  async testReportScheduleDelivery(
    workspaceId: string,
    projectId: string,
    scheduleId: string,
  ): Promise<UsageReportScheduleDeliveryResult> {
    return this.client.post<UsageReportScheduleDeliveryResult>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/report-schedules/${scheduleId}/test-delivery`,
    );
  }

  async runReportScheduleNow(
    workspaceId: string,
    projectId: string,
    scheduleId: string,
  ): Promise<UsageReportScheduleDeliveryResult> {
    return this.client.post<UsageReportScheduleDeliveryResult>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/report-schedules/${scheduleId}/run-now`,
    );
  }

  async retryReportScheduleDelivery(
    workspaceId: string,
    projectId: string,
    scheduleId: string,
    deliveryId: string,
  ): Promise<UsageReportScheduleDeliveryResult> {
    return this.client.post<UsageReportScheduleDeliveryResult>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/report-schedules/${scheduleId}/deliveries/${deliveryId}/retry`,
    );
  }

  async acknowledgeReportScheduleDelivery(
    workspaceId: string,
    projectId: string,
    scheduleId: string,
    deliveryId: string,
  ): Promise<UsageReportDelivery> {
    return this.client.post<UsageReportDelivery>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/report-schedules/${scheduleId}/deliveries/${deliveryId}/acknowledge`,
    );
  }

  async runDueReportSchedules(
    workspaceId: string,
    projectId: string,
  ): Promise<{ processed: number; deliveries: UsageReportScheduleDeliveryResult[] }> {
    return this.client.post<{ processed: number; deliveries: UsageReportScheduleDeliveryResult[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/report-schedules/run-due`,
    );
  }

  async getReportEvidence(
    workspaceId: string,
    projectId: string,
  ): Promise<UsageReportEvidence> {
    return this.client.get<UsageReportEvidence>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/report-evidence`,
    );
  }
}
