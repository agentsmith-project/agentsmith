/**
 * Audit & Usage API Endpoints
 *
 * Typed API functions for audit and usage operations.
 */

import type { AuditEvent, UsageRecord, PaginationParams, PaginatedResponse } from '../types';
import type { ApiClient } from '../client';

export interface UsageKPI {
  total_requests: number;
  total_errors: number;
  total_tokens: number;
  total_bytes_in: number;
  total_bytes_out: number;
  avg_duration_p95_ms: number;
  active_agents: number;
  online_agents: number;
  queued_turns: number;
  running_turns: number;
}

export class AuditAPI {
  constructor(private client: ApiClient) {}

  /**
   * List audit events
   */
  async list(workspaceId: string, projectId: string, params?: PaginationParams): Promise<PaginatedResponse<AuditEvent>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    return this.client.get<PaginatedResponse<AuditEvent>>(
      `/workspaces/${workspaceId}/projects/${projectId}/audit${query ? `?${query}` : ''}`
    );
  }
}

export class UsageAPI {
  constructor(private client: ApiClient) {}

  /**
   * Get usage KPI summary
   */
  async getKPI(workspaceId: string, projectId: string): Promise<UsageKPI> {
    return this.client.get<UsageKPI>(`/workspaces/${workspaceId}/projects/${projectId}/usage/kpi`);
  }

  /**
   * Get usage records
   */
  async getRecords(
    workspaceId: string,
    projectId: string,
    params?: PaginationParams
  ): Promise<PaginatedResponse<UsageRecord>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    return this.client.get<PaginatedResponse<UsageRecord>>(
      `/workspaces/${workspaceId}/projects/${projectId}/usage/records${query ? `?${query}` : ''}`
    );
  }
}
