/**
 * Agent Runner API Endpoints
 *
 * Typed API functions for Agent Runner operations.
 */

import type {
  AgentDiagnostics,
  AgentRunner,
  AgentRunnerListResponse,
  AgentRunnerServiceKey,
  AgentRunnerTestConnectionRequest,
  AgentRunnerTestConnectionResponse,
  AgentRunnerTestTaskRunAcceptedResponse,
  AgentRunnerTestTaskRunRequest,
  CreateAgentRunnerKeyResponse,
  PaginationParams,
} from '../types';
import type { ApiClient } from '../client';
import type { components } from '../types.generated';

export type CreateAgentRunnerRequest = components['schemas']['CreateAgentRunnerRequest'];
export type UpdateAgentRunnerRequest = components['schemas']['UpdateAgentRunnerRequest'];

function agentRunnersPath(workspaceId: string, projectId: string): string {
  return `/workspaces/${workspaceId}/projects/${projectId}/agent-runners`;
}

export class AgentRunnerAPI {
  constructor(private client: ApiClient) {}

  /**
   * List Agent Runners in a project
   */
  async list(workspaceId: string, projectId: string, params?: PaginationParams): Promise<AgentRunnerListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    return this.client.get<AgentRunnerListResponse>(
      `${agentRunnersPath(workspaceId, projectId)}${query ? `?${query}` : ''}`
    );
  }

  /**
   * Get an Agent Runner by ID
   */
  async get(workspaceId: string, projectId: string, runnerId: string): Promise<AgentRunner> {
    return this.client.get<AgentRunner>(`${agentRunnersPath(workspaceId, projectId)}/${runnerId}`);
  }

  /**
   * Create a new Agent Runner
   */
  async create(workspaceId: string, projectId: string, data: CreateAgentRunnerRequest): Promise<AgentRunner> {
    return this.client.post<AgentRunner>(agentRunnersPath(workspaceId, projectId), data);
  }

  /**
   * Update an Agent Runner
   */
  async update(workspaceId: string, projectId: string, runnerId: string, data: UpdateAgentRunnerRequest): Promise<AgentRunner> {
    return this.client.patch<AgentRunner>(`${agentRunnersPath(workspaceId, projectId)}/${runnerId}`, data);
  }

  async getConnectionInfo(
    workspaceId: string,
    projectId: string,
    runnerId: string,
  ): Promise<{ ws_url: string; agent_runner_id: string; protocol_version: string; heartbeat_interval_sec: number }> {
    return this.client.get(
      `${agentRunnersPath(workspaceId, projectId)}/${runnerId}/connection-info`,
    );
  }

  async testConnection(
    workspaceId: string,
    projectId: string,
    runnerId: string,
    data: AgentRunnerTestConnectionRequest = {},
  ): Promise<AgentRunnerTestConnectionResponse> {
    return this.client.post<AgentRunnerTestConnectionResponse>(
      `${agentRunnersPath(workspaceId, projectId)}/${runnerId}/test-connection`,
      data,
    );
  }

  async createTestTaskRun(
    workspaceId: string,
    projectId: string,
    runnerId: string,
    data: AgentRunnerTestTaskRunRequest = {},
  ): Promise<AgentRunnerTestTaskRunAcceptedResponse> {
    return this.client.post<AgentRunnerTestTaskRunAcceptedResponse>(
      `${agentRunnersPath(workspaceId, projectId)}/${runnerId}/test-task-runs`,
      data,
    );
  }

  /**
   * Delete an Agent Runner
   */
  async delete(workspaceId: string, projectId: string, runnerId: string): Promise<void> {
    return this.client.delete<void>(`${agentRunnersPath(workspaceId, projectId)}/${runnerId}`);
  }

  /**
   * Get diagnostics for an Agent Runner
   */
  async getDiagnostics(workspaceId: string, projectId: string, runnerId: string): Promise<AgentDiagnostics> {
    return this.client.get<AgentDiagnostics>(
      `${agentRunnersPath(workspaceId, projectId)}/${runnerId}/diagnostics`
    );
  }

  /**
   * List service keys for an Agent Runner
   */
  async listKeys(workspaceId: string, projectId: string, runnerId: string): Promise<AgentRunnerServiceKey[]> {
    const response = await this.client.get<{ items: AgentRunnerServiceKey[]; total: number }>(
      `${agentRunnersPath(workspaceId, projectId)}/${runnerId}/keys`
    );
    return response.items;
  }

  /**
   * Create a service key for an Agent Runner. Returns full key only once.
   */
  async createKey(workspaceId: string, projectId: string, runnerId: string): Promise<CreateAgentRunnerKeyResponse> {
    return this.client.post<CreateAgentRunnerKeyResponse>(
      `${agentRunnersPath(workspaceId, projectId)}/${runnerId}/keys`,
      {}
    );
  }

  /**
   * Revoke a service key
   */
  async deleteKey(workspaceId: string, projectId: string, runnerId: string, keyId: string): Promise<void> {
    return this.client.delete<void>(
      `${agentRunnersPath(workspaceId, projectId)}/${runnerId}/keys/${keyId}`
    );
  }
}
