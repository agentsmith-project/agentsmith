import type { ApiClient } from '../client';
import type { OrganizationActionServerRecord, OrganizationActionStatus } from '@/lib/stores/organization-actions-store';

export interface OrganizationActionStatusUpdateRequest {
  status: OrganizationActionStatus;
  actor_user_id: string;
  actor_name: string;
  note?: string;
}

export class OrganizationActionsAPI {
  constructor(private readonly client: ApiClient) {}

  async list(actionIds: string[]): Promise<{ items: OrganizationActionServerRecord[] }> {
    const query = new URLSearchParams();
    if (actionIds.length > 0) {
      query.set('action_ids', actionIds.join(','));
    }
    return this.client.get(`/internal/organization-actions${query.size > 0 ? `?${query.toString()}` : ''}`);
  }

  async updateStatus(actionId: string, payload: OrganizationActionStatusUpdateRequest): Promise<OrganizationActionServerRecord> {
    return this.client.post(`/internal/organization-actions/${encodeURIComponent(actionId)}/status`, payload);
  }

  async listHistory(actionId: string, limit = 100): Promise<{ action_id: string; total: number; items: OrganizationActionServerRecord['history'] }> {
    return this.client.get(`/internal/organization-actions/${encodeURIComponent(actionId)}/history?limit=${Math.max(1, Math.min(limit, 500))}`);
  }
}
