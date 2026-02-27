/**
 * Audit & Usage API Endpoints
 *
 * Typed API functions for audit and usage operations.
 */

import type {
  AuditEvent,
  UsageRecord,
  UsageKPI,
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
  time_range: {
    start: string;
    end: string;
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
    },
  ): Promise<RuntimeObservabilityResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('start_time', params.start_time);
    searchParams.set('end_time', params.end_time);
    return this.client.get<RuntimeObservabilityResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/runtime-observability?${searchParams.toString()}`,
    );
  }
}
