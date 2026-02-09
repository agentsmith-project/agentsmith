import { createHash } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import type {
  CredentialRecord,
  CredentialSecretRecord,
  EndpointImportItem,
  EndpointImportPayload,
  EndpointRecord,
} from './resource-models.js';

export class EndpointResourceService {
  private static readonly credentialsCollection = 'credentials';
  private static readonly credentialSecretsCollection = 'credential_secrets';
  private static readonly endpointsCollection = 'endpoints';

  constructor(private readonly docStore: JsonDocStorePort) {}

  private hashFingerprint(secret: string): string {
    return createHash('sha256').update(secret).digest('hex').slice(0, 12);
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
  }

  private endpointId(): string {
    return `ep_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  private credentialId(): string {
    return `cred_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  async listCredentials(workspaceId: string, projectId: string): Promise<CredentialRecord[]> {
    return this.docStore.list<CredentialRecord>(EndpointResourceService.credentialsCollection, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async createCredential(
    workspaceId: string,
    projectId: string,
    input: { name: string; value: string; type?: 'api_key' },
  ): Promise<CredentialRecord> {
    const id = this.credentialId();
    const now = new Date().toISOString();
    const credential: CredentialRecord = {
      id,
      workspace_id: workspaceId,
      project_id: projectId,
      name: input.name.trim(),
      type: 'api_key',
      fingerprint: this.hashFingerprint(input.value),
      created_at: now,
      last_rotated_at: now,
    };
    const secret: CredentialSecretRecord = {
      id,
      workspace_id: workspaceId,
      project_id: projectId,
      value: input.value,
      updated_at: now,
    };
    await this.docStore.upsert(EndpointResourceService.credentialsCollection, id, credential);
    await this.docStore.upsert(EndpointResourceService.credentialSecretsCollection, id, secret);
    return credential;
  }

  async rotateCredential(
    workspaceId: string,
    projectId: string,
    credentialId: string,
    value: string,
  ): Promise<CredentialRecord | null> {
    const credential = await this.docStore.get<CredentialRecord>(
      EndpointResourceService.credentialsCollection,
      credentialId,
    );
    if (!credential) {
      return null;
    }
    if (credential.workspace_id !== workspaceId || credential.project_id !== projectId) {
      return null;
    }
    const now = new Date().toISOString();
    const updated: CredentialRecord = {
      ...credential,
      fingerprint: this.hashFingerprint(value),
      last_rotated_at: now,
    };
    const secret: CredentialSecretRecord = {
      id: credentialId,
      workspace_id: workspaceId,
      project_id: projectId,
      value,
      updated_at: now,
    };
    await this.docStore.upsert(EndpointResourceService.credentialsCollection, credentialId, updated);
    await this.docStore.upsert(EndpointResourceService.credentialSecretsCollection, credentialId, secret);
    return updated;
  }

  async deleteCredential(workspaceId: string, projectId: string, credentialId: string): Promise<boolean> {
    const existing = await this.docStore.get<CredentialRecord>(
      EndpointResourceService.credentialsCollection,
      credentialId,
    );
    if (!existing) {
      return false;
    }
    if (existing.workspace_id !== workspaceId || existing.project_id !== projectId) {
      return false;
    }
    await this.docStore.delete(EndpointResourceService.credentialsCollection, credentialId);
    await this.docStore.delete(EndpointResourceService.credentialSecretsCollection, credentialId);
    return true;
  }

  async getCredentialSecret(
    workspaceId: string,
    projectId: string,
    credentialId: string,
  ): Promise<string | null> {
    const secret = await this.docStore.get<CredentialSecretRecord>(
      EndpointResourceService.credentialSecretsCollection,
      credentialId,
    );
    if (!secret) {
      return null;
    }
    if (secret.workspace_id !== workspaceId || secret.project_id !== projectId) {
      return null;
    }
    return secret.value;
  }

  async listEndpoints(workspaceId: string, projectId: string): Promise<EndpointRecord[]> {
    return this.docStore.list<EndpointRecord>(EndpointResourceService.endpointsCollection, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async getEndpoint(
    workspaceId: string,
    projectId: string,
    endpointId: string,
  ): Promise<EndpointRecord | null> {
    const endpoint = await this.docStore.get<EndpointRecord>(
      EndpointResourceService.endpointsCollection,
      endpointId,
    );
    if (!endpoint) {
      return null;
    }
    if (endpoint.workspace_id !== workspaceId || endpoint.project_id !== projectId) {
      return null;
    }
    return endpoint;
  }

  async createEndpoint(
    workspaceId: string,
    projectId: string,
    input: Partial<EndpointRecord>,
  ): Promise<EndpointRecord> {
    const existing = await this.listEndpoints(workspaceId, projectId);
    if (existing.some((item) => item.openai_model === String(input.openai_model ?? '').trim())) {
      throw new Error('endpoint_model_conflict');
    }
    const now = new Date().toISOString();
    const endpoint: EndpointRecord = {
      id: this.endpointId(),
      workspace_id: workspaceId,
      project_id: projectId,
      name: String(input.name ?? '').trim(),
      description: input.description?.trim() || undefined,
      openai_model: String(input.openai_model ?? '').trim(),
      source_model: input.source_model?.trim() || undefined,
      type: (input.type as EndpointRecord['type']) ?? 'openai',
      mode: input.mode,
      base_url: this.normalizeBaseUrl(String(input.base_url ?? '')),
      status: (input.status as EndpointRecord['status']) ?? 'active',
      credential_ref: input.credential_ref?.trim() || undefined,
      limits: input.limits,
      created_at: now,
      updated_at: now,
    };
    await this.docStore.upsert(EndpointResourceService.endpointsCollection, endpoint.id, endpoint);
    return endpoint;
  }

  async updateEndpoint(
    workspaceId: string,
    projectId: string,
    endpointId: string,
    patch: Partial<EndpointRecord>,
  ): Promise<EndpointRecord | null> {
    const existing = await this.getEndpoint(workspaceId, projectId, endpointId);
    if (!existing) {
      return null;
    }
    const updated: EndpointRecord = {
      ...existing,
      ...patch,
      name: patch.name !== undefined ? String(patch.name).trim() : existing.name,
      openai_model:
        patch.openai_model !== undefined
          ? String(patch.openai_model).trim()
          : existing.openai_model,
      source_model:
        patch.source_model !== undefined
          ? String(patch.source_model).trim()
          : existing.source_model,
      base_url:
        patch.base_url !== undefined
          ? this.normalizeBaseUrl(String(patch.base_url))
          : existing.base_url,
      updated_at: new Date().toISOString(),
    };
    await this.docStore.upsert(EndpointResourceService.endpointsCollection, endpointId, updated);
    return updated;
  }

  async deleteEndpoint(workspaceId: string, projectId: string, endpointId: string): Promise<boolean> {
    const existing = await this.getEndpoint(workspaceId, projectId, endpointId);
    if (!existing) {
      return false;
    }
    await this.docStore.delete(EndpointResourceService.endpointsCollection, endpointId);
    return true;
  }

  async importOpenAICompatible(
    workspaceId: string,
    projectId: string,
    payload: EndpointImportPayload,
  ): Promise<{ items: EndpointRecord[] }> {
    const pairs: Array<{ name: string; item: EndpointImportItem | undefined; type: EndpointRecord['type'] }> = [
      { name: 'reranker', item: payload.reranker, type: 'custom' },
      { name: 'embedding', item: payload.embedding, type: 'openai' },
      { name: 'completion', item: payload.completion, type: 'openai' },
    ];
    const created: EndpointRecord[] = [];

    for (const pair of pairs) {
      if (!pair.item) continue;
      const credential = await this.createCredential(workspaceId, projectId, {
        name: `${pair.name}-key`,
        value: pair.item.api_key,
      });
      const endpoint = await this.createEndpoint(workspaceId, projectId, {
        name: `${pair.name}-${pair.item.model}`,
        openai_model: pair.item.model,
        source_model: pair.item.source_model ?? pair.item.model,
        type: pair.type,
        mode: pair.item.mode,
        base_url: pair.item.api_base,
        credential_ref: credential.id,
        status: 'active',
      });
      created.push(endpoint);
    }
    return { items: created };
  }
}
