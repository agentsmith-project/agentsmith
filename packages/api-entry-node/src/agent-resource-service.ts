import { createHash, randomBytes } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import type { AgentRecord, AgentServiceKeyRecord } from './resource-models.js';

interface AgentConnectionState {
  connected_at: string;
  remote_ip?: string;
  last_pong_at?: string;
  protocol_version?: string;
}

export interface AgentConnectionInfo {
  ws_url: string;
  agent_id: string;
  protocol_version: string;
  heartbeat_interval_sec: number;
}

export class AgentResourceService {
  private static readonly agentsCollection = 'agents';
  private static readonly agentKeysCollection = 'agent_service_keys';
  private readonly agentConnectionState = new Map<string, AgentConnectionState>();

  constructor(private readonly docStore: JsonDocStorePort) {}

  private agentId(): string {
    return `ag_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  private agentKeyId(): string {
    return `agk_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  private hashKey(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  private generatePlainKey(): string {
    return `ask_${randomBytes(24).toString('hex')}`;
  }

  async listAgents(workspaceId: string, projectId: string): Promise<AgentRecord[]> {
    const items = await this.docStore.list<AgentRecord>(AgentResourceService.agentsCollection, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    return items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async listVisibleAgents(
    workspaceId: string,
    projectId: string,
    actorUserId: string,
    includeAll: boolean,
  ): Promise<AgentRecord[]> {
    const all = await this.listAgents(workspaceId, projectId);
    if (includeAll) return all;
    return all.filter((item) => item.owner_id === actorUserId || item.visibility === 'public');
  }

  async getAgent(workspaceId: string, projectId: string, agentId: string): Promise<AgentRecord | null> {
    const item = await this.docStore.get<AgentRecord>(AgentResourceService.agentsCollection, agentId);
    if (!item) return null;
    if (item.workspace_id !== workspaceId || item.project_id !== projectId) return null;
    return item;
  }

  async createAgent(
    workspaceId: string,
    projectId: string,
    input: Partial<AgentRecord>,
  ): Promise<AgentRecord> {
    const now = new Date().toISOString();
    const agent: AgentRecord = {
      id: this.agentId(),
      workspace_id: workspaceId,
      project_id: projectId,
      name: String(input.name ?? '').trim(),
      description: input.description?.trim() || undefined,
      mode: input.mode === 'internal' ? 'internal' : 'external',
      interaction_mode: input.interaction_mode ?? 'both',
      presence: input.mode === 'internal' ? 'managed' : 'offline',
      status: input.status ?? 'enabled',
      config: input.config,
      execution_preferences_json: input.execution_preferences_json,
      owner_id: input.owner_id,
      admin_id: input.admin_id,
      visibility: input.visibility === 'public' ? 'public' : 'private',
      capabilities: input.capabilities ?? {
        streaming_completion: true,
        multimodal_completion: false,
        accepted_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/pdf'],
        max_file_count: 8,
        max_total_bytes: 60 * 1024 * 1024,
      },
      created_at: now,
      updated_at: now,
      last_seen_at: undefined,
    };
    await this.docStore.upsert(AgentResourceService.agentsCollection, agent.id, agent);
    return agent;
  }

  canAccessAgent(agent: AgentRecord, actorUserId: string, includeAll: boolean): boolean {
    if (includeAll) return true;
    return agent.owner_id === actorUserId || agent.visibility === 'public';
  }

  canManageAgent(agent: AgentRecord, actorUserId: string, includeAll: boolean): boolean {
    if (includeAll) return true;
    return agent.owner_id === actorUserId;
  }

  async updateAgent(
    workspaceId: string,
    projectId: string,
    agentId: string,
    patch: Partial<AgentRecord>,
  ): Promise<AgentRecord | null> {
    const existing = await this.getAgent(workspaceId, projectId, agentId);
    if (!existing) return null;
    const updated: AgentRecord = {
      ...existing,
      ...patch,
      name: patch.name !== undefined ? String(patch.name).trim() : existing.name,
      description: patch.description !== undefined ? patch.description?.trim() || undefined : existing.description,
      updated_at: new Date().toISOString(),
    };
    await this.docStore.upsert(AgentResourceService.agentsCollection, agentId, updated);
    return updated;
  }

  async deleteAgent(workspaceId: string, projectId: string, agentId: string): Promise<boolean> {
    const existing = await this.getAgent(workspaceId, projectId, agentId);
    if (!existing) return false;
    await this.docStore.delete(AgentResourceService.agentsCollection, agentId);
    const keys = await this.listAgentKeys(workspaceId, projectId, agentId);
    for (const key of keys) {
      await this.docStore.delete(AgentResourceService.agentKeysCollection, key.id);
    }
    this.agentConnectionState.delete(agentId);
    return true;
  }

  async listAgentKeys(
    workspaceId: string,
    projectId: string,
    agentId: string,
  ): Promise<AgentServiceKeyRecord[]> {
    const items = await this.docStore.list<AgentServiceKeyRecord>(AgentResourceService.agentKeysCollection, {
      workspace_id: workspaceId,
      project_id: projectId,
      agent_id: agentId,
    });
    return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async createAgentKey(
    workspaceId: string,
    projectId: string,
    agentId: string,
  ): Promise<{ record: AgentServiceKeyRecord; key: string }> {
    const key = this.generatePlainKey();
    const record: AgentServiceKeyRecord = {
      id: this.agentKeyId(),
      workspace_id: workspaceId,
      project_id: projectId,
      agent_id: agentId,
      key_prefix: key.slice(0, 12),
      key_hash: this.hashKey(key),
      status: 'active',
      created_at: new Date().toISOString(),
    };
    await this.docStore.upsert(AgentResourceService.agentKeysCollection, record.id, record);
    return { record, key };
  }

  async revokeAgentKey(
    workspaceId: string,
    projectId: string,
    agentId: string,
    keyId: string,
  ): Promise<boolean> {
    const existing = await this.docStore.get<AgentServiceKeyRecord>(
      AgentResourceService.agentKeysCollection,
      keyId,
    );
    if (!existing) return false;
    if (
      existing.workspace_id !== workspaceId ||
      existing.project_id !== projectId ||
      existing.agent_id !== agentId
    ) {
      return false;
    }
    const revoked: AgentServiceKeyRecord = {
      ...existing,
      status: 'revoked',
    };
    await this.docStore.upsert(AgentResourceService.agentKeysCollection, keyId, revoked);
    return true;
  }

  async verifyAgentKey(agentId: string, token: string): Promise<AgentServiceKeyRecord | null> {
    const hash = this.hashKey(token);
    const all = await this.docStore.list<AgentServiceKeyRecord>(AgentResourceService.agentKeysCollection, {
      agent_id: agentId,
      status: 'active',
    });
    const matched = all.find((item) => item.key_hash === hash) ?? null;
    if (!matched) return null;
    const touched: AgentServiceKeyRecord = {
      ...matched,
      last_used_at: new Date().toISOString(),
    };
    await this.docStore.upsert(AgentResourceService.agentKeysCollection, touched.id, touched);
    return touched;
  }

  markAgentConnected(agentId: string, meta: Omit<AgentConnectionState, 'connected_at'>): void {
    this.agentConnectionState.set(agentId, {
      connected_at: new Date().toISOString(),
      ...meta,
    });
  }

  markAgentDisconnected(agentId: string): void {
    this.agentConnectionState.delete(agentId);
  }

  async touchAgentPresence(
    workspaceId: string,
    projectId: string,
    agentId: string,
    presence: AgentRecord['presence'],
  ): Promise<void> {
    const existing = await this.getAgent(workspaceId, projectId, agentId);
    if (!existing) return;
    await this.updateAgent(workspaceId, projectId, agentId, {
      presence,
      last_seen_at: new Date().toISOString(),
    });
  }

  getConnectionInfo(agentId: string): AgentConnectionState | null {
    return this.agentConnectionState.get(agentId) ?? null;
  }

  buildConnectionInfo(agentId: string): AgentConnectionInfo {
    const wsBase = process.env.AGENT_EXECUTION_WS_BASE_URL?.trim() || 'ws://localhost:20000';
    return {
      ws_url: `${wsBase.replace(/\/$/, '')}/api/v1/agent-execution/ws?agent_id=${encodeURIComponent(agentId)}`,
      agent_id: agentId,
      protocol_version: '1.0',
      heartbeat_interval_sec: 15,
    };
  }

  async getDiagnostics(workspaceId: string, projectId: string, agentId: string): Promise<Record<string, unknown>> {
    const agent = await this.getAgent(workspaceId, projectId, agentId);
    if (!agent) return {};
    const conn = this.getConnectionInfo(agentId);
    return {
      last_error: undefined,
      last_error_at: undefined,
      queue_depth: 0,
      restarts: 0,
      source_ip: conn?.remote_ip,
      connected_at: conn?.connected_at,
      last_pong_at: conn?.last_pong_at,
      presence: agent.presence,
    };
  }
}
