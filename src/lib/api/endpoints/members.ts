/**
 * Member API Endpoints
 *
 * Typed API functions for member operations.
 */

import type { ApiClient } from '../client';
import { validatePolicyRulesForResource } from '@/lib/constants/resource-policy';
import type {
  MemberPermissions,
  QuotaOverride,
  QuotaOverrideHistoryItem,
  QuotaTemplate,
  ResourcePolicyUpdateRequest,
  ResourcePolicy,
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
  status: 'active' | 'removed';
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
  reject_reason?: string;
}

export interface CreateInviteRequest {
  email: string;
  role_template?: 'developer' | 'user';
  expires_in_hours?: number;
}

export interface InviteResponse {
  invite_id: string;
  invite_url: string;
  expires_at: string;
}

export interface JoinInviteActionResponse {
  ok: true;
  workspace_id?: string;
  project_id?: string;
}

export interface Membership {
  project_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'developer' | 'user';
  permissions: string[];
  status: 'active' | 'removed';
  joined_at: string;
}

export interface ProjectGroup {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  permission_template_id: string;
  member_ids: string[];
  created_at: string;
  updated_at: string;
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
  async rejectJoinRequest(
    workspaceId: string,
    projectId: string,
    joinId: string,
    data?: { reason?: string }
  ): Promise<void> {
    return this.client.post<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/join-requests/${joinId}/reject`,
      data ?? {}
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
    const response = await this.client.get<{
      platform_permissions?: string[];
      resource_permissions?: MemberPermissions['resource_permissions'];
    }>(
      `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/permissions`
    );
    return {
      platform_permissions: response.platform_permissions ?? [],
      resource_permissions: response.resource_permissions,
    };
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
   * Get member quota overrides. Returns { overrides } from backend.
   */
  async getQuotaOverrides(
    workspaceId: string,
    projectId: string,
    memberId: string
  ): Promise<QuotaOverride> {
    const res = await this.client.get<{ overrides: QuotaOverride }>(
      `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/quota-overrides`
    );
    return res.overrides ?? {};
  }

  /**
   * Get quota overrides history (paginated)
   */
  async getQuotaOverridesHistory(
    workspaceId: string,
    projectId: string,
    memberId: string,
    params?: { page?: number; page_size?: number }
  ): Promise<{ items: QuotaOverrideHistoryItem[]; total: number; page: number; page_size: number }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.page_size) searchParams.set('page_size', params.page_size.toString());
    const query = searchParams.toString();
    return this.client.get<{ items: QuotaOverrideHistoryItem[]; total: number; page: number; page_size: number }>(
      `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/quota-overrides/history${query ? `?${query}` : ''}`
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
  ): Promise<QuotaOverride> {
    const res = await this.client.patch<{ overrides: QuotaOverride }>(
      `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/quota-overrides`,
      { overrides: data }
    );
    return res.overrides ?? data;
  }

  /**
   * Get resource policy for a resource
   */
  async getResourcePolicy(
    workspaceId: string,
    projectId: string,
    resourceType: 'endpoint' | 'source_library' | 'agent',
    resourceId: string
  ): Promise<ResourcePolicy> {
    return this.client.get<ResourcePolicy>(
      `/workspaces/${workspaceId}/projects/${projectId}/resources/${resourceType}/${resourceId}/policy`
    );
  }

  /**
   * Update resource policy
   */
  async updateResourcePolicy(
    workspaceId: string,
    projectId: string,
    resourceType: 'endpoint' | 'source_library' | 'agent',
    resourceId: string,
    data: ResourcePolicyUpdateRequest
  ): Promise<void> {
    const rootValidation = validatePolicyRulesForResource(
      resourceType,
      data.rate_limits,
      data.quota_limits
    );
    if (!rootValidation.valid) {
      throw new Error(`Invalid policy rules for ${resourceType}: ${rootValidation.invalidKeys.join(', ')}`);
    }

    for (const subject of data.allowed_subjects) {
      const subjectValidation = validatePolicyRulesForResource(
        resourceType,
        subject.rate_limits,
        subject.quota_limits
      );
      if (!subjectValidation.valid) {
        throw new Error(
          `Invalid subject policy rules for ${resourceType}: ${subjectValidation.invalidKeys.join(', ')}`
        );
      }
    }

    return this.client.patch<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/resources/${resourceType}/${resourceId}/policy`,
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
   * Create a custom permission template
   */
  async createPermissionTemplate(
    workspaceId: string,
    projectId: string,
    data: { name: string; description?: string; permissions: string[] }
  ): Promise<PermissionTemplate> {
    const response = await this.client.post<PermissionTemplate>(
      `/workspaces/${workspaceId}/projects/${projectId}/permission-templates`,
      data
    );
    return response;
  }

  /**
   * Update a custom permission template
   */
  async updatePermissionTemplate(
    workspaceId: string,
    projectId: string,
    templateId: string,
    data: { name?: string; description?: string; permissions?: string[] }
  ): Promise<PermissionTemplate> {
    const response = await this.client.patch<PermissionTemplate>(
      `/workspaces/${workspaceId}/projects/${projectId}/permission-templates/${templateId}`,
      data
    );
    return response;
  }

  /**
   * Delete a custom permission template
   */
  async deletePermissionTemplate(
    workspaceId: string,
    projectId: string,
    templateId: string
  ): Promise<void> {
    await this.client.delete(
      `/workspaces/${workspaceId}/projects/${projectId}/permission-templates/${templateId}`
    );
  }

  /**
   * Create an invite for a new member
   */
  async createInvite(
    workspaceId: string,
    projectId: string,
    data: CreateInviteRequest
  ): Promise<InviteResponse> {
    return this.client.post<InviteResponse>(
      `/workspaces/${workspaceId}/projects/${projectId}/invites`,
      data
    );
  }

  /**
   * Accept invite token from public join page.
   */
  async acceptInvite(token: string): Promise<JoinInviteActionResponse> {
    return this.client.post<JoinInviteActionResponse>('/join/accept', { token });
  }

  /**
   * Decline invite token from public join page.
   */
  async declineInvite(token: string): Promise<JoinInviteActionResponse> {
    return this.client.post<JoinInviteActionResponse>('/join/decline', { token });
  }

  /**
   * List quota templates
   */
  async listQuotaTemplates(
    workspaceId: string,
    projectId: string
  ): Promise<QuotaTemplate[]> {
    const response = await this.client.get<QuotaTemplate[]>(
      `/workspaces/${workspaceId}/projects/${projectId}/quota-templates`
    );
    return Array.isArray(response) ? response : [];
  }

  /**
   * Get a quota template by ID
   */
  async getQuotaTemplate(
    workspaceId: string,
    projectId: string,
    templateId: string
  ): Promise<QuotaTemplate> {
    return this.client.get<QuotaTemplate>(
      `/workspaces/${workspaceId}/projects/${projectId}/quota-templates/${templateId}`
    );
  }

  /**
   * Create a quota template
   */
  async createQuotaTemplate(
    workspaceId: string,
    projectId: string,
    data: { name: string; description?: string; overrides_json: QuotaOverride }
  ): Promise<QuotaTemplate> {
    return this.client.post<QuotaTemplate>(
      `/workspaces/${workspaceId}/projects/${projectId}/quota-templates`,
      data
    );
  }

  /**
   * Update a quota template
   */
  async updateQuotaTemplate(
    workspaceId: string,
    projectId: string,
    templateId: string,
    data: { name?: string; description?: string; overrides_json?: QuotaOverride }
  ): Promise<QuotaTemplate> {
    return this.client.patch<QuotaTemplate>(
      `/workspaces/${workspaceId}/projects/${projectId}/quota-templates/${templateId}`,
      data
    );
  }

  /**
   * Delete a quota template
   */
  async deleteQuotaTemplate(
    workspaceId: string,
    projectId: string,
    templateId: string
  ): Promise<void> {
    await this.client.delete(
      `/workspaces/${workspaceId}/projects/${projectId}/quota-templates/${templateId}`
    );
  }

  /**
   * Apply a quota template to members
   */
  async applyQuotaTemplate(
    workspaceId: string,
    projectId: string,
    templateId: string,
    memberIds: string[]
  ): Promise<{ applied_count: number }> {
    return this.client.post<{ applied_count: number }>(
      `/workspaces/${workspaceId}/projects/${projectId}/quota-templates/${templateId}/apply`,
      { member_ids: memberIds }
    );
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

  /**
   * Get membership for a specific user in a project
   *
   * This endpoint returns the current user's role and permissions
   * for the specified project. Used for permission checks.
   */
  async getMembership(
    workspaceId: string,
    projectId: string,
    userId: string
  ): Promise<Membership> {
    return this.client.get<Membership>(
      `/workspaces/${workspaceId}/projects/${projectId}/memberships/${userId}`
    );
  }

  async listGroups(workspaceId: string, projectId: string): Promise<ProjectGroup[]> {
    const response = await this.client.get<{ items: ProjectGroup[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/groups`
    );
    return response.items ?? [];
  }

  async createGroup(
    workspaceId: string,
    projectId: string,
    data: {
      name: string;
      description?: string;
      permission_template_id: string;
      member_ids?: string[];
    }
  ): Promise<ProjectGroup> {
    return this.client.post<ProjectGroup>(
      `/workspaces/${workspaceId}/projects/${projectId}/groups`,
      data
    );
  }

  async updateGroup(
    workspaceId: string,
    projectId: string,
    groupId: string,
    data: {
      name?: string;
      description?: string;
      permission_template_id?: string;
      member_ids?: string[];
    }
  ): Promise<ProjectGroup> {
    return this.client.patch<ProjectGroup>(
      `/workspaces/${workspaceId}/projects/${projectId}/groups/${groupId}`,
      data
    );
  }

  async deleteGroup(workspaceId: string, projectId: string, groupId: string): Promise<void> {
    await this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/groups/${groupId}`
    );
  }

  async applyGroupTemplate(
    workspaceId: string,
    projectId: string,
    groupId: string,
    memberIds?: string[]
  ): Promise<{
    applied_count: number;
    results?: Array<{
      member_id: string;
      status: 'applied' | 'failed';
      message?: string;
    }>;
  }> {
    return this.client.post<{
      applied_count: number;
      results?: Array<{
        member_id: string;
        status: 'applied' | 'failed';
        message?: string;
      }>;
    }>(
      `/workspaces/${workspaceId}/projects/${projectId}/groups/${groupId}/apply-template`,
      memberIds ? { member_ids: memberIds } : {}
    );
  }
}
