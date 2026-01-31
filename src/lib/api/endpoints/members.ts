/**
 * Member API Endpoints
 *
 * Typed API functions for member operations.
 */

// import type { ProjectMembership } from '../types'; // Unused - re-exported from types
import type { ApiClient } from '../client';

export interface Member {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: 'owner' | 'admin' | 'developer' | 'user';
  permissions: string[];
  status: 'active' | 'blocked' | 'removed';
  joined_at: string;
}

export interface UpdateMemberRoleRequest {
  role: 'owner' | 'admin' | 'developer' | 'user';
  permissions: string[];
}

export interface JoinRequest {
  id: string;
  project_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
}

export class MemberAPI {
  constructor(private client: ApiClient) {}

  /**
   * List members in a project
   */
  async list(workspaceId: string, projectId: string): Promise<Member[]> {
    const response = await this.client.get<{ items: Member[]; total: number }>(
      `/workspaces/${workspaceId}/projects/${projectId}/members`
    );
    return response.items;
  }

  /**
   * Update member role
   */
  async updateRole(
    workspaceId: string,
    projectId: string,
    memberId: string,
    data: UpdateMemberRoleRequest
  ): Promise<void> {
    return this.client.put<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/role`,
      data
    );
  }

  /**
   * Remove member from project
   */
  async remove(workspaceId: string, projectId: string, memberId: string): Promise<void> {
    return this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}`
    );
  }

  /**
   * List pending join requests
   */
  async listJoinRequests(workspaceId: string, projectId: string): Promise<JoinRequest[]> {
    const response = await this.client.get<{ items: JoinRequest[]; total: number }>(
      `/workspaces/${workspaceId}/projects/${projectId}/join-requests`
    );
    return response.items;
  }

  /**
   * Approve a join request
   */
  async approveJoinRequest(workspaceId: string, projectId: string, joinId: string): Promise<void> {
    return this.client.post<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/join-requests/${joinId}/approve`,
      {}
    );
  }

  /**
   * Reject a join request
   */
  async rejectJoinRequest(workspaceId: string, projectId: string, joinId: string): Promise<void> {
    return this.client.post<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/join-requests/${joinId}/reject`,
      {}
    );
  }
}
