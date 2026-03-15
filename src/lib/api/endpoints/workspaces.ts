/**
 * Workspace API Endpoints
 *
 * Typed API functions for workspace operations.
 */

import type { Workspace, WorkspaceMember } from '../types';
import type { ApiClient } from '../client';

export interface WorkspaceProjectCreator {
  id: string;
  user_id: string;
  name: string;
  email: string;
}

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

  /**
   * List users who can create projects in a workspace.
   */
  async listProjectCreators(id: string): Promise<WorkspaceProjectCreator[]> {
    const response = await this.client.get<{ items: WorkspaceProjectCreator[]; total: number }>(
      `/workspaces/${id}/project-creators`
    );
    return response.items;
  }

  /**
   * Update users who can create projects in a workspace.
   */
  async updateProjectCreators(workspaceId: string, projectCreators: string[]): Promise<WorkspaceProjectCreator[]> {
    const response = await this.client.patch<{ items: WorkspaceProjectCreator[]; total: number }>(
      `/workspaces/${workspaceId}/project-creators`,
      { project_creators: projectCreators },
    );
    return response.items;
  }

  /**
   * Update governance group for a workspace member.
   */
  async updateMemberGovernanceGroup(
    workspaceId: string,
    memberId: string,
    governanceGroup: 'wheel' | 'user',
  ): Promise<WorkspaceMember> {
    return this.client.patch<WorkspaceMember>(
      `/workspaces/${workspaceId}/members/${memberId}/governance`,
      { governance_group: governanceGroup },
    );
  }
}
