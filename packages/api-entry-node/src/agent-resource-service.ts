import { createHash, randomBytes } from 'node:crypto';
import type { CachePort, JsonDocStorePort } from '@mbos/ports';
import type { AgentRecord, AgentServiceKeyRecord } from './resource-models.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';
import { listRegisteredWorkspaceIds } from './workspace-registry.js';
import { resolveAgentRunnerRuntime } from './agent-runner-profile.js';
import {
  createAgentPresenceStore,
  type AgentConnectionState,
  type AgentPresenceStore,
  type RegisterAgentConnectionInput,
} from './agent-presence-store.js';

function sanitizeAgentRecord(agent: AgentRecord & Record<string, unknown>): AgentRecord {
  const sanitized: AgentRecord = {
    id: agent.id,
    workspace_id: agent.workspace_id,
    project_id: agent.project_id,
    name: agent.name,
    mode: agent.mode,
    status: agent.status,
    created_at: agent.created_at,
    updated_at: agent.updated_at,
  };

  if (agent.description !== undefined) sanitized.description = agent.description;
  if (agent.presence !== undefined) sanitized.presence = agent.presence;
  if (agent.config !== undefined) sanitized.config = agent.config;
  if (agent.execution_preferences_json !== undefined) {
    sanitized.execution_preferences_json = agent.execution_preferences_json;
  }
  if (agent.interaction_kind !== undefined) sanitized.interaction_kind = agent.interaction_kind;
  if (agent.owner_id !== undefined) sanitized.owner_id = agent.owner_id;
  if (agent.admin_id !== undefined) sanitized.admin_id = agent.admin_id;
  if (agent.visibility !== undefined) sanitized.visibility = agent.visibility;
  if (agent.capabilities !== undefined) sanitized.capabilities = agent.capabilities;
  if (agent.last_seen_at !== undefined) sanitized.last_seen_at = agent.last_seen_at;

  return sanitized;
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
  private readonly agentPresenceStore: AgentPresenceStore;
  private readonly agentRuntimeState = new Map<string, AgentRuntimeState>();

  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly cache?: CachePort,
    agentPresenceStore?: AgentPresenceStore,
  ) {
    this.agentPresenceStore = agentPresenceStore ?? createAgentPresenceStore(cache);
  }

  private async hydrateAgentRecord(
    raw: (AgentRecord & Record<string, unknown>) | null,
  ): Promise<AgentRecord | null> {
    if (!raw) return null;
    return sanitizeAgentRecord(raw);
  }

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
    const items = await this.docStore.list<AgentRecord & Record<string, unknown>>(this.agentsCollection(workspaceId), {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    const normalized = await Promise.all(items.map((item) => this.hydrateAgentRecord(item)));
    const hydrated = await Promise.all(normalized.filter(Boolean).map((item) => this.hydratePresence(item)));
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
    const item = await this.docStore.get<AgentRecord & Record<string, unknown>>(this.agentsCollection(workspaceId), agentId);
    if (!item) return null;
    if (item.workspace_id !== workspaceId || item.project_id !== projectId) return null;
    const normalized = await this.hydrateAgentRecord(item);
    return normalized ? this.hydratePresence(normalized) : null;
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
    this.agentRuntimeState.delete(agentId);
    await this.agentPresenceStore.clearAgent(agentId);
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

  async registerAgentConnection(input: RegisterAgentConnectionInput): Promise<AgentConnectionState> {
    const snapshot = await this.agentPresenceStore.upsertConnection(input);
    const registeredConnection = snapshot.connections.find((connection) => connection.connection_id === input.connectionId);
    const latestConnection = snapshot.latestConnection;
    const lastSeenAt = latestConnection?.last_pong_at ?? latestConnection?.connected_at ?? new Date().toISOString();
    await this.writeStoredPresence(input.workspaceId, input.projectId, input.agentId, 'online', lastSeenAt);
    return registeredConnection ?? {
      connection_id: input.connectionId,
      socket_key: input.socketKey,
      agent_id: input.agentId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      connected_at: input.connectedAt ?? lastSeenAt,
      last_pong_at: input.lastPongAt ?? lastSeenAt,
      expires_at: lastSeenAt,
      api_instance_id: input.apiInstanceId,
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
      active_connection_count: snapshot.activeConnectionCount,
    };
  }

  async refreshAgentConnection(input: {
    agentId: string;
    connectionId: string;
    lastPongAt: string;
    remoteIp?: string;
    protocolVersion?: string;
  }): Promise<{
    refreshed: boolean;
    stale: boolean;
    active_connection_count: number;
    presence: 'online' | 'offline';
  }> {
    const result = await this.agentPresenceStore.refreshConnection(input);
    return {
      refreshed: !result.stale,
      stale: result.stale,
      active_connection_count: result.snapshot.activeConnectionCount,
      presence: result.snapshot.activeConnectionCount > 0 ? 'online' : 'offline',
    };
  }

  async releaseAgentConnection(input: {
    workspaceId: string;
    projectId: string;
    agentId: string;
    connectionId: string;
  }): Promise<{
    released: boolean;
    stale: boolean;
    active_connection_count: number;
    presence: 'online' | 'offline' | 'managed';
  }> {
    const result = await this.agentPresenceStore.releaseConnection(input);
    const latest = result.snapshot.latestConnection;
    if (latest) {
      await this.writeStoredPresence(
        latest.workspace_id,
        latest.project_id,
        input.agentId,
        'online',
        latest.last_pong_at ?? latest.connected_at,
      );
      return {
        released: result.released,
        stale: result.stale,
        active_connection_count: result.snapshot.activeConnectionCount,
        presence: 'online',
      };
    }
    const existing = await this.findAgentById(input.agentId);
    const nextPresence = existing?.mode === 'internal' ? 'managed' : 'offline';
    await this.writeStoredPresence(input.workspaceId, input.projectId, input.agentId, nextPresence, new Date().toISOString());
    return {
      released: result.released,
      stale: result.stale,
      active_connection_count: 0,
      presence: nextPresence,
    };
  }

  async isAgentConnectionCurrent(agentId: string, connectionId: string): Promise<boolean> {
    return this.agentPresenceStore.isConnectionCurrent(agentId, connectionId);
  }

  async markAgentConnected(
    agentId: string,
    meta: {
      remote_ip?: string;
      last_pong_at?: string;
      protocol_version?: string;
    },
  ): Promise<void> {
    const agent = await this.findAgentById(agentId);
    if (!agent) return;
    await this.registerAgentConnection({
      agentId,
      workspaceId: agent.workspace_id,
      projectId: agent.project_id,
      connectionId: `legacy:${agentId}`,
      socketKey: agentId,
      apiInstanceId: 'legacy',
      ...(meta.remote_ip ? { remoteIp: meta.remote_ip } : {}),
      ...(meta.protocol_version ? { protocolVersion: meta.protocol_version } : {}),
      ...(meta.last_pong_at ? { lastPongAt: meta.last_pong_at } : {}),
    });
  }

  async markAgentDisconnected(agentId: string): Promise<void> {
    const agent = await this.findAgentById(agentId);
    await this.agentPresenceStore.clearAgent(agentId);
    if (agent) {
      await this.writeStoredPresence(
        agent.workspace_id,
        agent.project_id,
        agentId,
        agent.mode === 'internal' ? 'managed' : 'offline',
        new Date().toISOString(),
      );
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
    const snapshot = await this.agentPresenceStore.getPresence(agentId);
    return snapshot.latestConnection;
  }

  async getSessionConnectionInfo(agentId: string, sessionId?: string): Promise<AgentConnectionState | null> {
    const snapshot = await this.agentPresenceStore.getPresence(agentId);
    if (!sessionId) {
      return snapshot.latestConnection;
    }
    return snapshot.connections.find((connection) => connection.session_id === sessionId)
      ?? snapshot.connections.find((connection) => connection.session_id === undefined)
      ?? null;
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

  private async findAgentById(agentId: string): Promise<AgentRecord | null> {
    const collections = await this.listRegisteredWorkspaceCollections(AgentResourceService.agentsCollection);
    for (const collection of collections) {
      const item = await this.docStore.get<AgentRecord & Record<string, unknown>>(collection, agentId);
      if (!item) continue;
      return sanitizeAgentRecord(item);
    }
    return null;
  }

  private async writeStoredPresence(
    workspaceId: string,
    projectId: string,
    agentId: string,
    presence: AgentRecord['presence'],
    lastSeenAt: string,
  ): Promise<void> {
    const item = await this.docStore.get<AgentRecord & Record<string, unknown>>(this.agentsCollection(workspaceId), agentId);
    if (!item || item.workspace_id !== workspaceId || item.project_id !== projectId) return;
    await this.docStore.upsert(this.agentsCollection(workspaceId), agentId, {
      ...sanitizeAgentRecord(item),
      presence,
      last_seen_at: lastSeenAt,
      updated_at: new Date().toISOString(),
    });
  }
}
