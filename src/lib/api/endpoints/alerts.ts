/**
 * Alert APIs
 *
 * Typed API functions for Epic C2 alert rules and notifications.
 */

import type { ApiClient } from '../client';
import type {
  PaginatedResponse,
} from '../types';
import type {
  AlertRule,
  AlertRuleCreateRequest,
  AlertRuleUpdateRequest,
  AlertRuleTestResponse,
  AlertNotification,
  AlertHistoryListParams,
} from '../../types/alerts';

function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'undefined') {
      searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

function asItems<T>(data: T[] | PaginatedResponse<T>): T[] {
  return Array.isArray(data) ? data : data.items;
}

export class AlertAPI {
  constructor(private client: ApiClient) {}

  async listRules(
    workspaceId: string,
    projectId: string,
    params?: { enabled?: boolean; severity?: string; type?: string },
  ): Promise<AlertRule[]> {
    const query = toQuery({
      enabled: params?.enabled,
      severity: params?.severity,
      type: params?.type,
    });
    const data = await this.client.get<AlertRule[] | PaginatedResponse<AlertRule>>(
      `/workspaces/${workspaceId}/projects/${projectId}/alert-rules${query}`,
    );
    return asItems(data);
  }

  async createRule(
    workspaceId: string,
    projectId: string,
    body: AlertRuleCreateRequest,
  ): Promise<AlertRule> {
    return this.client.post<AlertRule>(
      `/workspaces/${workspaceId}/projects/${projectId}/alert-rules`,
      body,
    );
  }

  async updateRule(
    workspaceId: string,
    projectId: string,
    ruleId: string,
    body: AlertRuleUpdateRequest,
  ): Promise<AlertRule> {
    return this.client.put<AlertRule>(
      `/workspaces/${workspaceId}/projects/${projectId}/alert-rules/${ruleId}`,
      body,
    );
  }

  async deleteRule(workspaceId: string, projectId: string, ruleId: string): Promise<void> {
    await this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/alert-rules/${ruleId}`,
    );
  }

  async testRule(
    workspaceId: string,
    projectId: string,
    ruleId: string,
  ): Promise<AlertRuleTestResponse> {
    return this.client.post<AlertRuleTestResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/alert-rules/${ruleId}/test`,
      {},
    );
  }

  async listNotifications(
    workspaceId: string,
    projectId: string,
    params?: AlertHistoryListParams,
  ): Promise<AlertNotification[]> {
    const query = toQuery({
      status: params?.status,
      rule_id: params?.rule_id,
      start_time: params?.start_time,
      end_time: params?.end_time,
      page: params?.page,
      page_size: params?.page_size,
    });
    const data = await this.client.get<PaginatedResponse<AlertNotification>>(
      `/workspaces/${workspaceId}/projects/${projectId}/alert-notifications${query}`,
    );
    return data.items;
  }
}
