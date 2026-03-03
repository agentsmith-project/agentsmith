/**
 * Endpoint API Endpoints
 *
 * Typed API functions for endpoint operations.
 */

import type {
  Endpoint,
  EndpointCapability,
  EndpointDefaults,
  EndpointModelBinding,
  EndpointProtocol,
  EndpointProviderFamily,
  PaginationParams,
  PaginatedResponse,
} from '../types';
import type { ApiClient } from '../client';

export interface CreateEndpointRequest {
  name: string;
  description?: string;
  openai_model?: string;
  type: 'openai' | 'anthropic' | 'custom';
  base_url: string;
  credential_ref?: string;
  provider_family?: EndpointProviderFamily;
  protocol?: EndpointProtocol;
  capabilities?: EndpointCapability[];
  models?: EndpointModelBinding[];
  defaults?: EndpointDefaults;
  meta?: Record<string, string>;
  limits?: {
    max_requests_per_minute?: number;
    max_requests_per_day?: number;
    max_tokens_per_day?: number;
    timeout_seconds?: number;
  };
}

export interface UpdateEndpointRequest {
  name?: string;
  description?: string;
  openai_model?: string;
  base_url?: string;
  credential_ref?: string;
  provider_family?: EndpointProviderFamily;
  protocol?: EndpointProtocol;
  capabilities?: EndpointCapability[];
  models?: EndpointModelBinding[];
  defaults?: EndpointDefaults;
  meta?: Record<string, string>;
  status?: 'active' | 'disabled';
  limits?: {
    max_requests_per_minute?: number;
    max_requests_per_day?: number;
    max_tokens_per_day?: number;
    timeout_seconds?: number;
  };
}

export interface OpenAICompatibleImportItem {
  model: string;
  api_base: string;
  api_key: string;
  mode?: 'openai';
}

export interface ImportOpenAICompatibleRequest {
  reranker?: OpenAICompatibleImportItem;
  embedding?: OpenAICompatibleImportItem;
  completion?: OpenAICompatibleImportItem;
  image_generation?: OpenAICompatibleImportItem;
  video_generation?: OpenAICompatibleImportItem;
}

export class EndpointAPI {
  constructor(private client: ApiClient) {}

  /**
   * List endpoints in a project
   */
  async list(workspaceId: string, projectId: string, params?: PaginationParams): Promise<PaginatedResponse<Endpoint>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    return this.client.get<PaginatedResponse<Endpoint>>(
      `/workspaces/${workspaceId}/projects/${projectId}/endpoints${query ? `?${query}` : ''}`
    );
  }

  /**
   * Get an endpoint by ID
   */
  async get(workspaceId: string, projectId: string, endpointId: string): Promise<Endpoint> {
    return this.client.get<Endpoint>(`/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}`);
  }

  /**
   * Create a new endpoint
   */
  async create(workspaceId: string, projectId: string, data: CreateEndpointRequest): Promise<Endpoint> {
    return this.client.post<Endpoint>(`/workspaces/${workspaceId}/projects/${projectId}/endpoints`, data);
  }

  /**
   * Update an endpoint
   */
  async update(workspaceId: string, projectId: string, endpointId: string, data: UpdateEndpointRequest): Promise<Endpoint> {
    return this.client.put<Endpoint>(`/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}`, data);
  }

  /**
   * Delete an endpoint
   */
  async delete(workspaceId: string, projectId: string, endpointId: string): Promise<void> {
    return this.client.delete<void>(`/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}`);
  }

  /**
   * Import reranker/embedding/completion endpoint config in one request
   */
  async importOpenAICompatible(
    workspaceId: string,
    projectId: string,
    payload: ImportOpenAICompatibleRequest,
  ): Promise<{ items: Endpoint[] }> {
    return this.client.post<{ items: Endpoint[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/endpoints/import-openai-compatible`,
      payload,
    );
  }

  async runRerank(
    workspaceId: string,
    projectId: string,
    endpointId: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>(
      `/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/rerank`,
      payload,
    );
  }

  async generateImage(
    workspaceId: string,
    projectId: string,
    endpointId: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>(
      `/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/images/generations`,
      payload,
    );
  }

  async generateVideo(
    workspaceId: string,
    projectId: string,
    endpointId: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>(
      `/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/videos/generations`,
      payload,
    );
  }

  async getVideoGenerationJob(
    workspaceId: string,
    projectId: string,
    endpointId: string,
    jobId: string,
  ): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>(
      `/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/videos/generations/${jobId}`,
    );
  }

  async cancelVideoGenerationJob(
    workspaceId: string,
    projectId: string,
    endpointId: string,
    jobId: string,
  ): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>(
      `/workspaces/${workspaceId}/projects/${projectId}/endpoints/${endpointId}/videos/generations/${jobId}/cancel`,
      {},
    );
  }

}
