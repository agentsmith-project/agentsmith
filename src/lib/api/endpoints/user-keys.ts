/**
 * User API Key Endpoints
 *
 * Typed API functions for user API key operations.
 */

import type { UserAPIKey } from '../types';
import type { ApiClient } from '../client';

export interface CreateUserKeyRequest {
  note?: string;
  expires_in?: number; // days
}

export class UserAPIKeyService {
  constructor(private client: ApiClient) {}

  /**
   * List user's API keys
   */
  async list(): Promise<UserAPIKey[]> {
    const response = await this.client.get<{ items: UserAPIKey[]; total: number }>('/user/keys');
    return response.items;
  }

  /**
   * Create a new API key
   */
  async create(data: CreateUserKeyRequest): Promise<UserAPIKey> {
    return this.client.post<UserAPIKey>('/user/keys', data);
  }

  /**
   * Revoke an API key
   */
  async revoke(keyId: string): Promise<void> {
    return this.client.delete<void>(`/user/keys/${keyId}`);
  }
}
