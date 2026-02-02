/**
 * Member API Endpoints
 *
 * Typed API functions for member operations.
 */

import type { ApiClient } from '../client';
import type {
  MemberPermissions,
  QuotaOverride,
  ResourceACL,
  PermissionTemplate,
  ChangeHistoryEntry,
} from '../types';

export interface Member {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: 'owner' | 'admin' | 'developer' | 'user';
  permissions: string[]; // 平台层权限点
  quota_overrides?: QuotaOverride;
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

  /**
   * Get member permissions
   */
  async getPermissions(
    workspaceId: string,
    projectId: string,
    memberId: string
  ): Promise<MemberPermissions> {
    return this.client.get<MemberPermissions>(
      `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/permissions`
    );
  }

  /**
   * Update member permissions
   */
  async updatePermissions(
    workspaceId: string,
    projectId: string,
    memberId: string,
    data: {
      template?: 'admin' | 'developer' | 'user' | null;
      permissions?: string[];
      mode: 'template' | 'custom';
    }
  ): Promise<void> {
    return this.client.patch<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/permissions`,
      data
    );
  }

  /**
   * Get member quota overrides
   */
  async getQuotaOverrides(
    workspaceId: string,
    projectId: string,
    memberId: string
  ): Promise<QuotaOverride> {
    return this.client.get<QuotaOverride>(
      `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/quota-overrides`
    );
  }

  /**
   * Update member quota overrides
   */
  async updateQuotaOverrides(
    workspaceId: string,
    projectId: string,
    memberId: string,
    data: QuotaOverride
  ): Promise<void> {
    return this.client.patch<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/quota-overrides`,
      data
    );
  }

  /**
   * Get resource ACL for a resource
   */
  async getResourceACL(
    workspaceId: string,
    projectId: string,
    resourceType: 'kb' | 'endpoint',
    resourceId: string
  ): Promise<ResourceACL> {
    return this.client.get<ResourceACL>(
      `/workspaces/${workspaceId}/projects/${projectId}/resources/${resourceType}/${resourceId}/acl`
    );
  }

  /**
   * Update resource ACL
   */
  async updateResourceACL(
    workspaceId: string,
    projectId: string,
    resourceType: 'kb' | 'endpoint',
    resourceId: string,
    data: {
      ops: Array<{
        op: 'allow' | 'deny' | 'remove_deny';
        subject_type: 'user';
        subject_id: string;
        permissions: string[];
        reason?: string;
      }>;
    }
  ): Promise<void> {
    return this.client.patch<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/resources/${resourceType}/${resourceId}/acl`,
      data
    );
  }

  /**
   * List permission templates
   */
  async listPermissionTemplates(
    workspaceId: string,
    projectId: string
  ): Promise<PermissionTemplate[]> {
    const response = await this.client.get<{ items: PermissionTemplate[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/permission-templates`
    );
    return response.items;
  }

  /**
   * Get change history for a member
   */
  async getChangeHistory(
    workspaceId: string,
    projectId: string,
    memberId: string
  ): Promise<ChangeHistoryEntry[]> {
    const response = await this.client.get<{ items: ChangeHistoryEntry[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/change-history`
    );
    return response.items;
  }
}
