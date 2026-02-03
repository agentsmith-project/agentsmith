/**
 * Credentials API Endpoints
 *
 * Typed API functions for project-scoped credential management.
 * Secrets are never returned after create; only fingerprint and metadata.
 */

import type { Credential, CreateCredentialRequest } from '../types';
import type { ApiClient } from '../client';

export class CredentialsAPI {
  constructor(private client: ApiClient) {}

  /**
   * List credentials in a project (no secrets returned)
   */
  async list(workspaceId: string, projectId: string): Promise<Credential[]> {
    const response = await this.client.get<{ items: Credential[] }>(
      `/workspaces/${workspaceId}/projects/${projectId}/credentials`
    );
    return response.items ?? [];
  }

  /**
   * Create a credential. Value is stored once; never returned again.
   */
  async create(
    workspaceId: string,
    projectId: string,
    data: CreateCredentialRequest
  ): Promise<Credential> {
    return this.client.post<Credential>(
      `/workspaces/${workspaceId}/projects/${projectId}/credentials`,
      data
    );
  }

  /**
   * Rotate credential value. Old value is replaced; never returned.
   */
  async rotate(
    workspaceId: string,
    projectId: string,
    credentialId: string,
    value: string
  ): Promise<Credential> {
    return this.client.post<Credential>(
      `/workspaces/${workspaceId}/projects/${projectId}/credentials/${credentialId}/rotate`,
      { value }
    );
  }

  /**
   * Delete a credential
   */
  async delete(
    workspaceId: string,
    projectId: string,
    credentialId: string
  ): Promise<void> {
    return this.client.delete<void>(
      `/workspaces/${workspaceId}/projects/${projectId}/credentials/${credentialId}`
    );
  }
}
