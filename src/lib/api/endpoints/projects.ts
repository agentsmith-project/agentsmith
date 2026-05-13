/**
 * Project API Endpoints
 *
 * Typed API functions for project operations.
 */

import type { Project, ProjectListResponse, ProjectWithMembership, PaginationParams } from '../types';
import type { ApiClient } from '../client';

export interface CreateProjectRequest {
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
  join_policy?: 'approval_required' | 'open';
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  owner_id?: string;
  visibility?: 'public' | 'private';
  join_policy?: 'approval_required' | 'open';
  governance_json?: Record<string, unknown>;
  limits_json?: Record<string, unknown>;
}

export class ProjectAPI {
  constructor(private client: ApiClient) {}

  async list(
    workspaceId: string,
    params?: PaginationParams,
  ): Promise<ProjectListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    const path = `/workspaces/${workspaceId}/projects${query ? `?${query}` : ''}`;
    return this.client.get<ProjectListResponse>(path);
  }

  async listGovernable(
    workspaceId: string,
    params?: PaginationParams,
  ): Promise<ProjectListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    const path = `/workspaces/${workspaceId}/governable-projects${query ? `?${query}` : ''}`;
    return this.client.get<ProjectListResponse>(path);
  }

  async get(workspaceId: string, projectId: string): Promise<ProjectWithMembership> {
    return this.client.get<ProjectWithMembership>(`/workspaces/${workspaceId}/projects/${projectId}`);
  }

  async create(workspaceId: string, data: CreateProjectRequest): Promise<Project> {
    return this.client.post<Project>(`/workspaces/${workspaceId}/projects`, data);
  }

  async update(workspaceId: string, projectId: string, data: UpdateProjectRequest): Promise<Project> {
    return this.client.patch<Project>(`/workspaces/${workspaceId}/projects/${projectId}`, data);
  }

  async delete(workspaceId: string, projectId: string): Promise<void> {
    return this.client.delete<void>(`/workspaces/${workspaceId}/projects/${projectId}`);
  }
}
