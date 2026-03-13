/**
 * Project API Endpoints
 *
 * Typed API functions for project operations.
 */

import type { Project, PaginationParams, PaginatedResponse } from '../types';
import type { ApiClient } from '../client';

export interface CreateProjectRequest {
  workspace_id: string;
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
  execution_preferences_json?: Record<string, unknown>;
  limits_json?: Record<string, unknown>;
}

export class ProjectAPI {
  constructor(private client: ApiClient) {}

  /**
   * List projects in a workspace
   */
  async list(workspaceId: string, params?: PaginationParams): Promise<PaginatedResponse<Project>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    if (params?.sort_by) searchParams.set('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.set('sort_order', params.sort_order);

    const query = searchParams.toString();
    const path = `/workspaces/${workspaceId}/projects${query ? `?${query}` : ''}`;
    return this.client.get<PaginatedResponse<Project>>(path);
  }

  /**
   * Get a project by ID
   */
  async get(workspaceId: string, projectId: string): Promise<Project> {
    return this.client.get<Project>(`/workspaces/${workspaceId}/projects/${projectId}`);
  }

  /**
   * Create a new project
   */
  async create(workspaceId: string, data: CreateProjectRequest): Promise<Project> {
    return this.client.post<Project>(`/workspaces/${workspaceId}/projects`, data);
  }

  /**
   * Update a project
   */
  async update(workspaceId: string, projectId: string, data: UpdateProjectRequest): Promise<Project> {
    return this.client.patch<Project>(`/workspaces/${workspaceId}/projects/${projectId}`, data);
  }

  /**
   * Delete a project
   */
  async delete(workspaceId: string, projectId: string): Promise<void> {
    return this.client.delete<void>(`/workspaces/${workspaceId}/projects/${projectId}`);
  }
}
