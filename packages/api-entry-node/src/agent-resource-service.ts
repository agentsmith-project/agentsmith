import { createHash, randomBytes } from 'node:crypto';
import type { CachePort, JsonDocStorePort } from '@mbos/ports';
import type { AgentRecord, AgentServiceKeyRecord } from './resource-models.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';
import { listRegisteredWorkspaceIds } from './workspace-registry.js';
import { resolveAgentRunnerRuntime } from './agent-runner-profile.js';

interface AgentConnectionState {
  connected_at: string;
  remote_ip?: string;
  last_pong_at?: string;
  protocol_version?: string;
}

export interface AgentRuntimeState {
  agent_id: string;
  workspace_id: string;
  project_id: string;
  metadata?: Record<string, unknown>;
  last_error?: string;
  last_error_at?: string;
  runner_spec_mismatch?: {
    expected_interaction_kind: 'chat' | 'notebook';
    actual_runner_spec?: Record<string, unknown>;
  };
}

const AGENT_PRESENCE_TTL_SECONDS = 45;

function agentPresenceKey(agentId: string): string {
  return `agent:presence:${agentId}`;
}

function sanitizeBaseUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

function deriveWebSocketBaseFromHttpBase(value: string | undefined | null): string | null {
  const trimmed = sanitizeBaseUrl(value);
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'ws:';
    } else if (parsed.protocol === 'https:') {
      parsed.protocol = 'wss:';
    }
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function resolveConnectionWsBase(agent: Pick<AgentRecord, 'mode' | 'config'>): string {
  const runtime = resolveAgentRunnerRuntime(agent);
  if (agent.mode === 'external') {
    if (runtime === 'compose_managed') {
      return (
        deriveWebSocketBaseFromHttpBase(process.env.INTERNAL_API_BASE_URL)
        ?? 'ws://api:20000'
      );
    }
    return (
      deriveWebSocketBaseFromHttpBase(process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL)
      ?? deriveWebSocketBaseFromHttpBase(process.env.PUBLIC_API_BASE_URL)
      ?? 'ws://localhost:20000'
    );
  }
  return (
    sanitizeBaseUrl(process.env.AGENT_EXECUTION_WS_BASE_URL)
    ?? deriveWebSocketBaseFromHttpBase(process.env.AGENT_EXECUTION_HTTP_BASE_URL)
    ?? 'ws://localhost:20000'
  );
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
  private readonly agentRuntimeState = new Map<string, AgentRuntimeState>();

  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly cache?: CachePort,
  ) {}

  private agentsCollection(workspaceId: string): string {
    return resolveWorkspaceScopedCollection(AgentResourceService.agentsCollection, workspaceId);
  }

  private agentKeysCollection(workspaceId: string): string {
    return resolveWorkspaceScopedCollection(AgentResourceService.agentKeysCollection, workspaceId);
  }

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
    const items = await this.docStore.list<AgentRecord>(this.agentsCollection(workspaceId), {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    const hydrated = await Promise.all(items.map((item) => this.hydratePresence(item)));
    return hydrated.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
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
    const item = await this.docStore.get<AgentRecord>(this.agentsCollection(workspaceId), agentId);
    if (!item) return null;
    if (item.workspace_id !== workspaceId || item.project_id !== projectId) return null;
    return this.hydratePresence(item);
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
      interaction_kind: input.interaction_kind,
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
    await this.docStore.upsert(this.agentsCollection(workspaceId), agent.id, agent);
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
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<AgentRecord>;
    const updated: AgentRecord = {
      ...existing,
      ...definedPatch,
      name: patch.name !== undefined ? String(patch.name).trim() : existing.name,
      description: patch.description !== undefined ? patch.description?.trim() || undefined : existing.description,
      updated_at: new Date().toISOString(),
    };
    await this.docStore.upsert(this.agentsCollection(workspaceId), agentId, updated);
    return updated;
  }

  async deleteAgent(workspaceId: string, projectId: string, agentId: string): Promise<boolean> {
    const existing = await this.getAgent(workspaceId, projectId, agentId);
    if (!existing) return false;
    await this.docStore.delete(this.agentsCollection(workspaceId), agentId);
    const keys = await this.listAgentKeys(workspaceId, projectId, agentId);
    for (const key of keys) {
      await this.docStore.delete(this.agentKeysCollection(workspaceId), key.id);
    }
    this.agentConnectionState.delete(agentId);
    this.agentRuntimeState.delete(agentId);
    if (this.cache) {
      await this.cache.del(agentPresenceKey(agentId));
    }
    return true;
  }

  async listAgentKeys(
    workspaceId: string,
    projectId: string,
    agentId: string,
  ): Promise<AgentServiceKeyRecord[]> {
    const items = await this.docStore.list<AgentServiceKeyRecord>(this.agentKeysCollection(workspaceId), {
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
    await this.docStore.upsert(this.agentKeysCollection(workspaceId), record.id, record);
    return { record, key };
  }

  async revokeAgentKey(
    workspaceId: string,
    projectId: string,
    agentId: string,
    keyId: string,
  ): Promise<boolean> {
    const existing = await this.docStore.get<AgentServiceKeyRecord>(
      this.agentKeysCollection(workspaceId),
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
    await this.docStore.upsert(this.agentKeysCollection(workspaceId), keyId, revoked);
    return true;
  }

  async verifyAgentKey(agentId: string, token: string): Promise<AgentServiceKeyRecord | null> {
    const hash = this.hashKey(token);
    // Keys are discovered across registered workspace collections, then bound
    // back to the matched workspace_id/project_id. That bound scope is what the
    // websocket layer later enforces for notebook execution requests.
    const collections = await this.listRegisteredWorkspaceCollections(AgentResourceService.agentKeysCollection);
    const allActiveKeys = await Promise.all(
      collections.map((collection) =>
        this.docStore.list<AgentServiceKeyRecord>(collection, {
          agent_id: agentId,
          status: 'active',
        }),
      ),
    );
    const matched = allActiveKeys.flat().find((item) => item.key_hash === hash) ?? null;
    if (!matched) return null;
    const touched: AgentServiceKeyRecord = {
      ...matched,
      last_used_at: new Date().toISOString(),
    };
    await this.docStore.upsert(this.agentKeysCollection(matched.workspace_id), touched.id, touched);
    return touched;
  }

  private async listRegisteredWorkspaceCollections(baseCollection: string): Promise<string[]> {
    const collections = new Set<string>([baseCollection]);
    for (const workspaceId of await listRegisteredWorkspaceIds()) {
      if (!workspaceId) continue;
      collections.add(resolveWorkspaceScopedCollection(baseCollection, workspaceId));
    }
    return [...collections];
  }

  async markAgentConnected(agentId: string, meta: Omit<AgentConnectionState, 'connected_at'>): Promise<void> {
    this.agentConnectionState.set(agentId, {
      connected_at: new Date().toISOString(),
      ...meta,
    });
    if (this.cache) {
      await this.cache.set(
        agentPresenceKey(agentId),
        JSON.stringify({
          connected_at: new Date().toISOString(),
          ...meta,
        } satisfies AgentConnectionState),
        AGENT_PRESENCE_TTL_SECONDS,
      );
    }
  }

  async markAgentDisconnected(agentId: string): Promise<void> {
    this.agentConnectionState.delete(agentId);
    if (this.cache) {
      await this.cache.del(agentPresenceKey(agentId));
    }
  }

  async updateAgentRuntimeState(
    workspaceId: string,
    projectId: string,
    agentId: string,
    patch: Partial<AgentRuntimeState>,
  ): Promise<AgentRuntimeState | null> {
    const agent = await this.getAgent(workspaceId, projectId, agentId);
    if (!agent) return null;
    const existing = this.agentRuntimeState.get(agentId);
    const metadataPatch = patch.metadata;
    const next: AgentRuntimeState = {
      agent_id: agentId,
      workspace_id: workspaceId,
      project_id: projectId,
      ...existing,
      ...patch,
      ...(metadataPatch !== undefined
        ? {
          metadata: {
            ...(existing?.metadata ?? {}),
            ...metadataPatch,
          },
        }
        : {}),
    };
    this.agentRuntimeState.set(agentId, next);
    return next;
  }

  async getAgentRuntimeState(
    workspaceId: string,
    projectId: string,
    agentId: string,
  ): Promise<AgentRuntimeState | null> {
    const agent = await this.getAgent(workspaceId, projectId, agentId);
    if (!agent) return null;
    return this.agentRuntimeState.get(agentId) ?? null;
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

  async getConnectionInfo(agentId: string): Promise<AgentConnectionState | null> {
    const local = this.agentConnectionState.get(agentId);
    if (local) return local;
    if (!this.cache) return null;
    const raw = await this.cache.get(agentPresenceKey(agentId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AgentConnectionState;
      if (
        typeof parsed?.connected_at !== 'string'
        || (parsed.remote_ip !== undefined && typeof parsed.remote_ip !== 'string')
        || (parsed.last_pong_at !== undefined && typeof parsed.last_pong_at !== 'string')
        || (parsed.protocol_version !== undefined && typeof parsed.protocol_version !== 'string')
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  buildConnectionInfo(agent: Pick<AgentRecord, 'id' | 'mode' | 'config'>): AgentConnectionInfo {
    const wsBase = resolveConnectionWsBase(agent);
    return {
      ws_url: `${wsBase.replace(/\/$/, '')}/api/v1/agent-execution/ws?agent_id=${encodeURIComponent(agent.id)}`,
      agent_id: agent.id,
      protocol_version: '1.0',
      heartbeat_interval_sec: 15,
    };
  }

  async getDiagnostics(workspaceId: string, projectId: string, agentId: string): Promise<Record<string, unknown>> {
    const agent = await this.getAgent(workspaceId, projectId, agentId);
    if (!agent) return {};
    const conn = await this.getConnectionInfo(agentId);
    const runtime = await this.getAgentRuntimeState(workspaceId, projectId, agentId);
    return {
      last_error: runtime?.last_error,
      last_error_at: runtime?.last_error_at,
      queue_depth: 0,
      restarts: 0,
      source_ip: conn?.remote_ip,
      connected_at: conn?.connected_at,
      last_pong_at: conn?.last_pong_at,
      presence: agent.presence,
      ...(runtime?.runner_spec_mismatch ? { runner_spec_mismatch: runtime.runner_spec_mismatch } : {}),
      ...(runtime?.metadata ? { runtime_metadata: runtime.metadata } : {}),
    };
  }

  private async hydratePresence(agent: AgentRecord): Promise<AgentRecord> {
    if (agent.mode === 'internal') {
      return agent;
    }
    const connection = await this.getConnectionInfo(agent.id);
    if (connection) {
      return {
        ...agent,
        presence: 'online',
        last_seen_at: connection.last_pong_at ?? connection.connected_at,
      };
    }
    if (agent.presence === 'online') {
      return {
        ...agent,
        presence: 'offline',
      };
    }
    return agent;
  }
}
