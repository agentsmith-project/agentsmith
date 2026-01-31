/**
 * Agent API Endpoints
 *
 * Typed API functions for agent operations.
 */

import type { Agent, AgentServiceKey, PaginationParams, PaginatedResponse } from '../types';
import type { ApiClient } from '../client';

export interface CreateAgentRequest {
  name: string;
  description?: string;
  mode: 'external' | 'internal';
  config?: {
    image?: string;
    env?: Record<string, string>;
    max_concurrent_sessions_override?: number;
  };
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  mode?: 'external' | 'internal';
  presence?: 'online' | 'offline' | 'managed';
  status?: 'enabled' | 'disabled';
  config?: {
    image?: string;
    env?: Record<string, string>;
    max_concurrent_sessions_override?: number;
  };
}

export class AgentAPI {
  constructor(private client: ApiClient) {}

  /**
   * List agents in a project
   */
  async list(workspaceId: string, projectId: string, params?: PaginationParams): Promise<PaginatedResponse<Agent>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    return this.client.get<PaginatedResponse<Agent>>(
      `/workspaces/${workspaceId}/projects/${projectId}/agents${query ? `?${query}` : ''}`
    );
  }

  /**
   * Get an agent by ID
   */
  async get(workspaceId: string, projectId: string, agentId: string): Promise<Agent> {
    return this.client.get<Agent>(`/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}`);
  }

  /**
   * Create a new agent
   */
  async create(workspaceId: string, projectId: string, data: CreateAgentRequest): Promise<Agent> {
    return this.client.post<Agent>(`/workspaces/${workspaceId}/projects/${projectId}/agents`, data);
  }

  /**
   * Update an agent
   */
  async update(workspaceId: string, projectId: string, agentId: string, data: UpdateAgentRequest): Promise<Agent> {
    return this.client.put<Agent>(`/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}`, data);
  }

  /**
   * Delete an agent
   */
  async delete(workspaceId: string, projectId: string, agentId: string): Promise<void> {
    return this.client.delete<void>(`/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}`);
  }

  /**
   * List service keys for an agent
   */
  async listKeys(workspaceId: string, projectId: string, agentId: string): Promise<AgentServiceKey[]> {
    const response = await this.client.get<{ items: AgentServiceKey[]; total: number }>(
      `/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}/keys`
    );
    return response.items;
  }

  /**
   * Create a service key for an agent
   */
  async createKey(workspaceId: string, projectId: string, agentId: string): Promise<AgentServiceKey> {
    return this.client.post<AgentServiceKey>(
      `/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}/keys`,
      {}
    );
  }

  /**
   * Revoke a service key
   */
  async deleteKey(workspaceId: string, projectId: string, agentId: string, keyId: string): Promise<void> {
    return this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}/keys/${keyId}`
    );
  }
}
