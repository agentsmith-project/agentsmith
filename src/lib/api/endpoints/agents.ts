/**
 * Agent API Endpoints
 *
 * Typed API functions for agent operations.
 */

import type { Agent, AgentDiagnostics, AgentInteractionMode, AgentServiceKey, CreateAgentKeyResponse, PaginationParams, PaginatedResponse } from '../types';
import type { ApiClient } from '../client';

export interface CreateAgentRequest {
  name: string;
  description?: string;
  mode: 'external' | 'internal';
  interaction_mode?: AgentInteractionMode;
  config?: {
    image?: string;
    env?: Record<string, string>;
    max_concurrent_sessions_override?: number;
  };
  runtime_preferences?: Record<string, unknown>;
  capabilities?: {
    streaming_completion?: boolean;
    multimodal_completion?: boolean;
    accepted_mime_types?: string[];
    max_file_count?: number;
    max_total_bytes?: number;
  };
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  mode?: 'external' | 'internal';
  interaction_mode?: AgentInteractionMode;
  admin_id?: string;
  presence?: 'online' | 'offline' | 'managed';
  status?: 'enabled' | 'disabled';
  config?: {
    image?: string;
    env?: Record<string, string>;
    max_concurrent_sessions_override?: number;
  };
  runtime_preferences?: Record<string, unknown>;
  capabilities?: {
    streaming_completion?: boolean;
    multimodal_completion?: boolean;
    accepted_mime_types?: string[];
    max_file_count?: number;
    max_total_bytes?: number;
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
    return this.client.patch<Agent>(`/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}`, data);
  }

  /**
   * Get merged runtime config for an agent (requires agent key auth)
   */
  async getRuntimeConfig(
    workspaceId: string,
    projectId: string,
    agentId: string,
    agentKey: string
  ): Promise<{ project_id: string; agent_id: string; runtime_preferences: Record<string, unknown>; schema_version: number }> {
    return this.client.get(
      `/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}/runtime-config`,
      { headers: { Authorization: `Bearer ${agentKey}` } }
    );
  }

  async getConnectionInfo(
    workspaceId: string,
    projectId: string,
    agentId: string,
  ): Promise<{ ws_url: string; agent_id: string; protocol_version: string; heartbeat_interval_sec: number }> {
    return this.client.get(
      `/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}/connection-info`,
    );
  }

  /**
   * Delete an agent
   */
  async delete(workspaceId: string, projectId: string, agentId: string): Promise<void> {
    return this.client.delete<void>(`/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}`);
  }

  /**
   * Get diagnostics for an agent
   */
  async getDiagnostics(workspaceId: string, projectId: string, agentId: string): Promise<AgentDiagnostics> {
    return this.client.get<AgentDiagnostics>(
      `/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}/diagnostics`
    );
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
   * Create a service key for an agent. Returns full key only once - user must copy it.
   */
  async createKey(workspaceId: string, projectId: string, agentId: string): Promise<CreateAgentKeyResponse> {
    return this.client.post<CreateAgentKeyResponse>(
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
