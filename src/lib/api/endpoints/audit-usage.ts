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
}
