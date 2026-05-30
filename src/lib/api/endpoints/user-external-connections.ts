import type { ApiClient } from '../client';
import type {
  CreateUserExternalConnectionRequest,
  UpdateUserExternalConnectionRequest,
  UserExternalConnection,
} from '../types';

export type {
  CreateUserExternalConnectionRequest,
  UpdateUserExternalConnectionRequest,
};

export class UserExternalConnectionsAPI {
  constructor(private client: ApiClient) {}

  async list(): Promise<UserExternalConnection[]> {
    const response = await this.client.get<{ items: UserExternalConnection[]; total: number }>(
      '/me/external-connections'
    );
    return response.items;
  }

  async create(data: CreateUserExternalConnectionRequest): Promise<UserExternalConnection> {
    return this.client.post<UserExternalConnection>('/me/external-connections', data);
  }

  async update(
    connectionId: string,
    data: UpdateUserExternalConnectionRequest
  ): Promise<UserExternalConnection> {
    return this.client.patch<UserExternalConnection>(`/me/external-connections/${connectionId}`, data);
  }

  async remove(connectionId: string): Promise<void> {
    return this.client.delete<void>(`/me/external-connections/${connectionId}`);
  }
}
