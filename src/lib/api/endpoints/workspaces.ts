/**
 * Workspace API Endpoints
 *
 * Typed API functions for workspace operations.
 */

import type { Workspace, WorkspaceMember } from '../types';
import type { ApiClient } from '../client';

export class WorkspaceAPI {
  constructor(private client: ApiClient) {}

  /**
   * List all workspaces
   */
  async list(): Promise<Workspace[]> {
    const response = await this.client.get<{ items: Workspace[]; total: number }>('/workspaces');
    return response.items;
  }

  /**
   * Get a workspace by ID
   */
  async get(id: string): Promise<Workspace> {
    return this.client.get<Workspace>(`/workspaces/${id}`);
  }

  /**
   * List members in a workspace
   */
  async listMembers(id: string): Promise<WorkspaceMember[]> {
    const response = await this.client.get<{ items: WorkspaceMember[]; total: number }>(
      `/workspaces/${id}/members`
    );
    return response.items;
  }
}
