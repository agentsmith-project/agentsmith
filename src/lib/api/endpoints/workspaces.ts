/**
 * Workspace API Endpoints
 *
 * Typed API functions for workspace operations.
 */

import type {
  Workspace,
  WorkspaceDirectoryUser,
  WorkspaceFeishuIntegration,
  WorkspaceFeishuOAuthCompleteResponse,
  WorkspaceFeishuOAuthStartResponse,
  WorkspaceMember,
} from '../types';
import type { ApiClient } from '../client';

export interface WorkspaceProjectCreator extends WorkspaceDirectoryUser {
  id: string;
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

  async searchDirectoryUsers(workspaceId: string, query: string): Promise<WorkspaceDirectoryUser[]> {
    const encodedQuery = encodeURIComponent(query.trim());
    const response = await this.client.get<{ items: WorkspaceDirectoryUser[]; total: number }>(
      `/workspaces/${workspaceId}/directory/users?query=${encodedQuery}`
    );
    return response.items;
  }

  /**
   * Update users who can create projects in a workspace.
   */
  async updateProjectCreators(workspaceId: string, projectCreatorUserIds: string[]): Promise<WorkspaceProjectCreator[]> {
    const response = await this.client.patch<{ items: WorkspaceProjectCreator[]; total: number }>(
      `/workspaces/${workspaceId}/project-creators`,
      { project_creator_user_ids: projectCreatorUserIds },
    );
    return response.items;
  }

  async getFeishuIntegration(workspaceId: string): Promise<WorkspaceFeishuIntegration> {
    return this.client.get<WorkspaceFeishuIntegration>(
      `/workspaces/${workspaceId}/integrations/feishu`,
    );
  }

  async updateFeishuIntegration(
    workspaceId: string,
    data: { app_id: string; app_secret?: string; redirect_uri: string },
  ): Promise<WorkspaceFeishuIntegration> {
    return this.client.put<WorkspaceFeishuIntegration>(
      `/workspaces/${workspaceId}/integrations/feishu`,
      data,
    );
  }

  async startFeishuVerification(
    workspaceId: string,
    postRedirectPath: string,
  ): Promise<WorkspaceFeishuOAuthStartResponse> {
    return this.client.post<WorkspaceFeishuOAuthStartResponse>(
      `/workspaces/${workspaceId}/integrations/feishu/verify/start`,
      { post_redirect_path: postRedirectPath },
    );
  }

  async enableFeishuIntegration(workspaceId: string): Promise<WorkspaceFeishuIntegration> {
    return this.client.post<WorkspaceFeishuIntegration>(
      `/workspaces/${workspaceId}/integrations/feishu/enable`,
      {},
    );
  }

  async startWorkspaceFeishuAuth(
    workspaceId: string,
    postRedirectPath: string,
  ): Promise<WorkspaceFeishuOAuthStartResponse> {
    return this.client.post<WorkspaceFeishuOAuthStartResponse>(
      `/workspaces/${workspaceId}/me/feishu/auth/start`,
      { post_redirect_path: postRedirectPath },
    );
  }

  async completeWorkspaceFeishuAuth(
    workspaceId: string,
    data: { code?: string; state?: string },
  ): Promise<WorkspaceFeishuOAuthCompleteResponse> {
    return this.client.post<WorkspaceFeishuOAuthCompleteResponse>(
      `/workspaces/${workspaceId}/feishu/oauth/complete`,
      data,
    );
  }

}
