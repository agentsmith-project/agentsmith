import type { ApiClient } from '../client';
import type { UserdataEndUser, UserdataSummary } from '../types';

export class UserdataAPI {
  constructor(private client: ApiClient) {}

  async getSummary(workspaceId: string, projectId: string): Promise<UserdataSummary> {
    return this.client.get<UserdataSummary>(
      `/workspaces/${workspaceId}/projects/${projectId}/userdata/summary`
    );
  }

  async listEndUsers(workspaceId: string, projectId: string): Promise<UserdataEndUser[]> {
    const res = await this.client.get<{ items: UserdataEndUser[]; total: number }>(
      `/workspaces/${workspaceId}/projects/${projectId}/userdata/end-users`
    );
    return res.items;
  }
}
