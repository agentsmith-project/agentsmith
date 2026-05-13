import { createHash, randomBytes } from 'node:crypto';
import type { CachePort, JsonDocStorePort } from '@mbos/ports';
import type { AgentRecord, AgentServiceKeyRecord } from './resource-models.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';
import { listRegisteredWorkspaceIds } from './workspace-registry.js';
import { isDeveloperAgentRunner, isManagedAgentRunner } from './agent-runner-profile.js';
import { recordAuditEvent } from './audit-usage-store.js';
import {
  createAgentPresenceStore,
  type AgentConnectionState,
  type AgentPresenceStore,
  type RegisterAgentConnectionInput,
} from './agent-presence-store.js';

const MANAGED_AGENT_RUNNER_DEFAULT_IMAGE = 'agentsmith-agent-task-runner:local';
const AGENT_SERVICE_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEPLOYMENT_DEFAULT_MANAGED_RUNNER_DIAGNOSTIC = 'deployment_default';

export type AgentRunnerConnectionTestStatus = 'connected' | 'disconnected' | 'stale';
export type AgentRunnerConnectionFreshnessState = 'fresh' | 'missing' | 'stale';

export interface AgentRunnerKeyExpiryCleanupEvidence {
  workspace_id: string;
  project_id: string;
  agent_runner_id: string;
  key_id: string;
  key_prefix: string;
  expires_at?: string;
  cleanup_result: 'marked_expired';
  disconnected: boolean;
}

export interface AgentRunnerConnectionTestResult {
  agent_runner_id: string;
  status: AgentRunnerConnectionTestStatus;
  checked_at: string;
  timeout_ms: number;
  freshness: {
    state: AgentRunnerConnectionFreshnessState;
    active_connection_count: number;
    connected_at?: string;
    last_pong_at?: string;
    last_seen_at?: string;
  };
  capabilities: AgentRecord['capabilities'];
  errors: Array<{
    code: 'agent_runner_disconnected' | 'agent_runner_stale';
    message: string;
  }>;
  cleanup?: {
    key_expiry?: AgentRunnerKeyExpiryCleanupEvidence;
  };
}

export interface DeploymentDefaultManagedAgentRunnerInput extends Partial<AgentRecord> {
  endpointId?: string;
}

interface NormalizeKeyExpiryResult {
  record: AgentServiceKeyRecord;
  cleanup?: AgentRunnerKeyExpiryCleanupEvidence;
}

interface ConnectionAuthCheckResult {
  active: boolean;
  cleanup?: AgentRunnerKeyExpiryCleanupEvidence;
}

function resolveManagedAgentRunnerImage(env: NodeJS.ProcessEnv = process.env): string {
  return env.INTERNAL_AGENT_IMAGE?.trim()
    || env.INTEGRATION_INTERNAL_AGENT_IMAGE?.trim()
    || MANAGED_AGENT_RUNNER_DEFAULT_IMAGE;
}

function sanitizeAgentRecord(agent: AgentRecord & Record<string, unknown>): AgentRecord {
  const sanitized: AgentRecord = {
    id: agent.id,
    workspace_id: agent.workspace_id,
    project_id: agent.project_id,
    name: agent.name,
    runner_provider: agent.runner_provider === 'developer' ? 'developer' : 'managed',
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
  if (agent.is_default !== undefined) sanitized.is_default = agent.is_default === true;
  if (agent.default_endpoint_id !== undefined) sanitized.default_endpoint_id = agent.default_endpoint_id;
  if (agent.runner_status !== undefined) sanitized.runner_status = agent.runner_status;
  if (agent.diagnostics !== undefined) sanitized.diagnostics = agent.diagnostics;
  if (agent.owner_id !== undefined) sanitized.owner_id = agent.owner_id;
  if (agent.admin_id !== undefined) sanitized.admin_id = agent.admin_id;
  if (agent.visibility !== undefined) sanitized.visibility = agent.visibility;
  if (agent.capabilities !== undefined) sanitized.capabilities = agent.capabilities;
  if (agent.last_seen_at !== undefined) sanitized.last_seen_at = agent.last_seen_at;

  return sanitized;
}

function isAgentRecord(value: AgentRecord | null): value is AgentRecord {
  return value !== null;
}

export function deploymentDefaultManagedAgentRunnerId(workspaceId: string, projectId: string): string {
  const digest = createHash('sha256')
    .update(`${workspaceId}:${projectId}`)
    .digest('hex')
    .slice(0, 16);
  return `ag_managed_default_${digest}`;
}

function readExecutionPreferenceEndpointId(preferences: Record<string, unknown> | undefined): string {
  const namespaces = ['agent_task', 'task', 'notebook'];
  for (const namespace of namespaces) {
    const value = preferences?.[namespace];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const endpointId = (value as Record<string, unknown>).endpoint_id;
    if (typeof endpointId === 'string' && endpointId.trim()) {
      return endpointId.trim();
    }
  }
  return '';
}

function withManagedEndpointPreferences(
  preferences: Record<string, unknown> | undefined,
  endpointId: string,
): Record<string, unknown> | undefined {
  if (!endpointId) {
    return preferences;
  }
  const base = preferences ?? {};
  const mergeNamespace = (namespace: string): Record<string, unknown> => {
    const existing = base[namespace];
    return {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing)
        ? existing as Record<string, unknown>
        : {}),
      endpoint_id: endpointId,
    };
  };
  return {
    ...base,
    agent_task: mergeNamespace('agent_task'),
    task: mergeNamespace('task'),
    notebook: mergeNamespace('notebook'),
  };
}

export interface AgentRuntimeState {
  agent_id: string;
  workspace_id: string;
  project_id: string;
  metadata?: Record<string, unknown>;
  last_error?: string;
  last_error_at?: string;
}

function sanitizeBaseUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

function sanitizeWebSocketOriginBaseUrl(value: string | undefined | null): string | null {
  const trimmed = sanitizeBaseUrl(value);
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
      parsed.pathname = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/+$/, '');
    }
  } catch {
    return trimmed;
  }
  return trimmed;
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

function resolveConnectionWsBase(agent: Pick<AgentRecord, 'runner_provider'>): string {
  if (isDeveloperAgentRunner(agent)) {
    return (
      deriveWebSocketBaseFromHttpBase(process.env.PUBLIC_API_BASE_URL)
      ?? sanitizeWebSocketOriginBaseUrl(process.env.AGENT_EXECUTION_WS_BASE_URL)
      ?? deriveWebSocketBaseFromHttpBase(process.env.AGENT_EXECUTION_HTTP_BASE_URL)
      ?? 'ws://localhost:20000'
    );
  }
  return (
    sanitizeWebSocketOriginBaseUrl(process.env.AGENT_EXECUTION_WS_BASE_URL)
    ?? deriveWebSocketBaseFromHttpBase(process.env.AGENT_EXECUTION_HTTP_BASE_URL)
    ?? deriveWebSocketBaseFromHttpBase(process.env.INTERNAL_API_BASE_URL)
    ?? 'ws://localhost:20000'
  );
}

export interface AgentConnectionInfo {
  ws_url: string;
  agent_runner_id: string;
  protocol_version: string;
  heartbeat_interval_sec: number;
}

export class AgentResourceService {
  private static readonly agentsCollection = 'agents';
  private static readonly agentKeysCollection = 'agent_service_keys';
  private static readonly storedPresenceSyncMaxAttempts = 3;
  private static readonly storedPresenceSyncBackoffMs = 15;
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
    return `ag_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  private agentKeyId(): string {
    return `agk_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  private hashKey(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  private generatePlainKey(): string {
    return `ask_${randomBytes(24).toString('hex')}`;
  }

  private keyExpiresAt(nowMs = Date.now()): string {
    return new Date(nowMs + AGENT_SERVICE_KEY_TTL_MS).toISOString();
  }

  private isExpiredKey(record: AgentServiceKeyRecord, nowMs = Date.now()): boolean {
    if (record.status !== 'active') return false;
    const expiresAtMs = Date.parse(record.expires_at ?? '');
    return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
  }

  private async normalizeKeyExpiry(
    workspaceId: string,
    record: AgentServiceKeyRecord,
    nowMs = Date.now(),
  ): Promise<NormalizeKeyExpiryResult> {
    if (!this.isExpiredKey(record, nowMs)) {
      return { record };
    }
    const expired: AgentServiceKeyRecord = {
      ...record,
      status: 'expired',
    };
    await this.docStore.upsert(this.agentKeysCollection(workspaceId), record.id, expired);
    const disconnected = await this.releaseConnectionsAuthenticatedByKey(record);
    const cleanup: AgentRunnerKeyExpiryCleanupEvidence = {
      workspace_id: record.workspace_id,
      project_id: record.project_id,
      agent_runner_id: record.agent_id,
      key_id: record.id,
      key_prefix: record.key_prefix,
      ...(record.expires_at ? { expires_at: record.expires_at } : {}),
      cleanup_result: 'marked_expired',
      disconnected,
    };
    await this.recordKeyExpiryCleanupAudit(cleanup);
    return { record: expired, cleanup };
  }

  private buildManagedAgentPrivateConfig(inputConfig: AgentRecord['config'] | undefined): AgentRecord['config'] {
    const existing = inputConfig ?? {};
    const image = typeof existing.image === 'string' && existing.image.trim()
      ? existing.image.trim()
      : resolveManagedAgentRunnerImage();
    const rawKey = typeof existing._internal_raw_key === 'string' && existing._internal_raw_key.trim()
      ? existing._internal_raw_key.trim()
      : this.generatePlainKey();
    const keyId = typeof existing._internal_key_id === 'string' && existing._internal_key_id.trim()
      ? existing._internal_key_id.trim()
      : this.agentKeyId();
    return {
      ...existing,
      image,
      _internal_key_id: keyId,
      _internal_raw_key: rawKey,
    };
  }

  async listAgents(workspaceId: string, projectId: string): Promise<AgentRecord[]> {
    const items = await this.docStore.list<AgentRecord & Record<string, unknown>>(this.agentsCollection(workspaceId), {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    const normalized = await Promise.all(items.map((item) => this.hydrateAgentRecord(item)));
    const hydrated = await Promise.all(normalized.filter(isAgentRecord).map((item) => this.hydratePresence(item)));
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
    const runnerProvider = input.runner_provider === 'developer' ? 'developer' : 'managed';
    const agent: AgentRecord = {
      id: this.agentId(),
      workspace_id: workspaceId,
      project_id: projectId,
      name: String(input.name ?? '').trim(),
      description: input.description?.trim() || undefined,
      runner_provider: runnerProvider,
      presence: input.presence ?? (runnerProvider === 'developer' ? 'offline' : 'managed'),
      status: input.status ?? 'enabled',
      config: runnerProvider === 'managed'
        ? this.buildManagedAgentPrivateConfig(input.config)
        : input.config,
      execution_preferences_json: input.execution_preferences_json,
      is_default: runnerProvider === 'managed' && input.is_default === true,
      default_endpoint_id: input.default_endpoint_id?.trim() || undefined,
      runner_status: input.runner_status,
      diagnostics: input.diagnostics,
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

  async upsertDeploymentDefaultManagedAgentRunner(
    workspaceId: string,
    projectId: string,
    input: DeploymentDefaultManagedAgentRunnerInput,
  ): Promise<AgentRecord> {
    const id = deploymentDefaultManagedAgentRunnerId(workspaceId, projectId);
    const now = new Date().toISOString();
    const existing = await this.docStore.get<AgentRecord & Record<string, unknown>>(
      this.agentsCollection(workspaceId),
      id,
    );
    const existingRecord = existing ? sanitizeAgentRecord(existing) : null;
    const endpointId = input.endpointId?.trim()
      || readExecutionPreferenceEndpointId(input.execution_preferences_json)
      || readExecutionPreferenceEndpointId(existingRecord?.execution_preferences_json)
      || '';
    const defaultEndpointId = input.default_endpoint_id?.trim()
      || endpointId
      || existingRecord?.default_endpoint_id?.trim()
      || undefined;
    const config = this.buildManagedAgentPrivateConfig({
      ...(existingRecord?.config ?? {}),
      ...(input.config ?? {}),
    });
    const agent: AgentRecord = {
      id,
      workspace_id: workspaceId,
      project_id: projectId,
      name: input.name?.trim() || existingRecord?.name || 'Default managed runner',
      description: input.description?.trim() || existingRecord?.description,
      runner_provider: 'managed',
      presence: input.presence ?? existingRecord?.presence ?? 'managed',
      status: input.status ?? existingRecord?.status ?? 'enabled',
      config,
      execution_preferences_json: withManagedEndpointPreferences(
        input.execution_preferences_json ?? existingRecord?.execution_preferences_json,
        endpointId,
      ),
      is_default: input.is_default ?? existingRecord?.is_default ?? false,
      default_endpoint_id: defaultEndpointId,
      runner_status: input.runner_status ?? existingRecord?.runner_status ?? 'ready',
      diagnostics: {
        ...(existingRecord?.diagnostics ?? {}),
        ...(input.diagnostics ?? {}),
        managed_runner_projection: DEPLOYMENT_DEFAULT_MANAGED_RUNNER_DIAGNOSTIC,
      },
      owner_id: input.owner_id ?? existingRecord?.owner_id ?? 'system',
      admin_id: input.admin_id ?? existingRecord?.admin_id ?? 'system',
      visibility: input.visibility ?? existingRecord?.visibility ?? 'public',
      capabilities: input.capabilities ?? existingRecord?.capabilities ?? {
        streaming_completion: true,
        multimodal_completion: false,
        accepted_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/pdf'],
        max_file_count: 8,
        max_total_bytes: 60 * 1024 * 1024,
        terminal: true,
        artifacts: true,
        file_inputs: true,
        url_inputs: true,
        task_execution: true,
      },
      created_at: existingRecord?.created_at ?? now,
      updated_at: now,
      last_seen_at: input.last_seen_at ?? existingRecord?.last_seen_at,
    };
    await this.docStore.upsert(this.agentsCollection(workspaceId), id, agent);
    return agent;
  }

  async getDeploymentDefaultManagedAgentRunner(
    workspaceId: string,
    projectId: string,
  ): Promise<AgentRecord | null> {
    return this.getAgent(workspaceId, projectId, deploymentDefaultManagedAgentRunnerId(workspaceId, projectId));
  }

  async clearDefaultAgentRunnersExcept(
    workspaceId: string,
    projectId: string,
    runnerId: string,
  ): Promise<void> {
    const items = await this.docStore.list<AgentRecord & Record<string, unknown>>(this.agentsCollection(workspaceId), {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    await Promise.all(items.map(async (item) => {
      if (item.id === runnerId || item.is_default !== true) return;
      await this.docStore.upsert(this.agentsCollection(workspaceId), item.id, {
        ...sanitizeAgentRecord(item),
        is_default: false,
        updated_at: new Date().toISOString(),
      });
    }));
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
    updated.runner_provider = updated.runner_provider === 'developer' ? 'developer' : 'managed';
    if (updated.runner_provider === 'developer') {
      updated.is_default = false;
    }
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
    const normalized = await Promise.all(
      items.map(async (item) => (await this.normalizeKeyExpiry(workspaceId, item)).record),
    );
    return normalized.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async createAgentKey(
    workspaceId: string,
    projectId: string,
    agentId: string,
  ): Promise<{ record: AgentServiceKeyRecord; key: string; revokedKeyIds: string[] }> {
    const existingKeys = await this.listAgentKeys(workspaceId, projectId, agentId);
    const revokedKeyIds = existingKeys
      .filter((existing) => existing.status === 'active')
      .map((existing) => existing.id);
    await Promise.all(existingKeys.map(async (existing) => {
      if (existing.status !== 'active') return;
      await this.docStore.upsert(this.agentKeysCollection(workspaceId), existing.id, {
        ...existing,
        status: 'revoked',
      } satisfies AgentServiceKeyRecord);
    }));
    if (revokedKeyIds.length > 0) {
      await this.markAgentDisconnected(agentId);
    }

    const key = this.generatePlainKey();
    const now = Date.now();
    const record: AgentServiceKeyRecord = {
      id: this.agentKeyId(),
      workspace_id: workspaceId,
      project_id: projectId,
      agent_id: agentId,
      key_prefix: key.slice(0, 12),
      key_hash: this.hashKey(key),
      status: 'active',
      created_at: new Date(now).toISOString(),
      expires_at: this.keyExpiresAt(now),
    };
    await this.docStore.upsert(this.agentKeysCollection(workspaceId), record.id, record);
    return { record, key, revokedKeyIds };
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
    if (existing.status === 'active') {
      await this.markAgentDisconnected(agentId);
    }
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
    if (!matched) {
      return this.verifyManagedAgentPrivateKey(agentId, token, hash);
    }
    if (this.isExpiredKey(matched)) {
      await this.normalizeKeyExpiry(matched.workspace_id, matched);
      return null;
    }
    const touched: AgentServiceKeyRecord = {
      ...matched,
      last_used_at: new Date().toISOString(),
    };
    await this.docStore.upsert(this.agentKeysCollection(matched.workspace_id), touched.id, touched);
    return touched;
  }

  private async verifyManagedAgentPrivateKey(
    agentId: string,
    token: string,
    tokenHash: string,
  ): Promise<AgentServiceKeyRecord | null> {
    const collections = await this.listRegisteredWorkspaceCollections(AgentResourceService.agentsCollection);
    for (const collection of collections) {
      const item = await this.docStore.get<AgentRecord & Record<string, unknown>>(collection, agentId);
      if (!item || item.status !== 'enabled') continue;
      const agent = sanitizeAgentRecord(item);
      if (!isManagedAgentRunner(agent)) continue;
      const rawKey = typeof agent.config?._internal_raw_key === 'string'
        ? agent.config._internal_raw_key.trim()
        : '';
      if (!rawKey || this.hashKey(rawKey) !== tokenHash) continue;
      return {
        id: agent.config?._internal_key_id?.trim() || `internal:${agent.id}`,
        workspace_id: agent.workspace_id,
        project_id: agent.project_id,
        agent_id: agent.id,
        key_prefix: token.slice(0, 12),
        key_hash: tokenHash,
        status: 'active',
        created_at: agent.created_at,
        last_used_at: new Date().toISOString(),
      };
    }
    return null;
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
    await this.syncStoredPresenceProjection({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      agentId: input.agentId,
      presence: 'online',
      lastSeenAt,
    });
    return registeredConnection ?? {
      connection_id: input.connectionId,
      socket_key: input.socketKey,
      agent_id: input.agentId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      auth_kind: input.authenticatedKey?.kind ?? 'legacy',
      ...(input.authenticatedKey?.keyId ? { auth_key_id: input.authenticatedKey.keyId } : {}),
      ...(input.authenticatedKey?.expiresAt ? { auth_key_expires_at: input.authenticatedKey.expiresAt } : {}),
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
      await this.syncStoredPresenceProjection({
        workspaceId: latest.workspace_id,
        projectId: latest.project_id,
        agentId: input.agentId,
        presence: 'online',
        lastSeenAt: latest.last_pong_at ?? latest.connected_at,
      });
      return {
        released: result.released,
        stale: result.stale,
        active_connection_count: result.snapshot.activeConnectionCount,
        presence: 'online',
      };
    }
    const existing = await this.findAgentById(input.agentId);
    const nextPresence = existing && isManagedAgentRunner(existing) ? 'managed' : 'offline';
    await this.syncStoredPresenceProjection({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      agentId: input.agentId,
      presence: nextPresence,
      lastSeenAt: new Date().toISOString(),
    });
    return {
      released: result.released,
      stale: result.stale,
      active_connection_count: 0,
      presence: nextPresence,
    };
  }

  async isAgentConnectionCurrent(agentId: string, connectionId: string): Promise<boolean> {
    const snapshot = await this.agentPresenceStore.getPresence(agentId);
    const connection = snapshot.connections.find((item) => item.connection_id === connectionId);
    if (!connection) return false;
    return this.isConnectionAuthActive(connection);
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
        isManagedAgentRunner(agent) ? 'managed' : 'offline',
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

  async testAgentConnection(
    workspaceId: string,
    projectId: string,
    agentId: string,
    input?: {
      timeoutMs?: number;
    },
  ): Promise<AgentRunnerConnectionTestResult | null> {
    const agent = await this.getAgent(workspaceId, projectId, agentId);
    if (!agent) return null;
    const checkedAt = new Date().toISOString();
    const connection = await this.getConnectionInfo(agentId);
    if (connection) {
      const authCheck = await this.checkConnectionAuthActive(connection);
      if (!authCheck.active) {
        await this.releaseAgentConnection({
          workspaceId: connection.workspace_id || workspaceId,
          projectId: connection.project_id || projectId,
          agentId,
          connectionId: connection.connection_id,
        });
        const lastSeenAt = connection.last_pong_at ?? connection.connected_at;
        return {
          agent_runner_id: agentId,
          status: 'stale',
          checked_at: checkedAt,
          timeout_ms: input?.timeoutMs ?? 1000,
          freshness: {
            state: 'stale',
            active_connection_count: 0,
            last_seen_at: lastSeenAt,
          },
          capabilities: agent.capabilities ?? {},
          errors: [
            {
              code: 'agent_runner_stale',
              message: 'agent_runner_stale',
            },
          ],
          ...(authCheck.cleanup
            ? {
              cleanup: {
                key_expiry: authCheck.cleanup,
              },
            }
            : {}),
        };
      }
      return {
        agent_runner_id: agentId,
        status: 'connected',
        checked_at: checkedAt,
        timeout_ms: input?.timeoutMs ?? 1000,
        freshness: {
          state: 'fresh',
          active_connection_count: connection.active_connection_count ?? 1,
          connected_at: connection.connected_at,
          ...(connection.last_pong_at ? { last_pong_at: connection.last_pong_at } : {}),
          last_seen_at: connection.last_pong_at ?? connection.connected_at,
        },
        capabilities: agent.capabilities ?? {},
        errors: [],
      };
    }

    const lastSeenAt = agent.last_seen_at?.trim();
    const status: AgentRunnerConnectionTestStatus = lastSeenAt ? 'stale' : 'disconnected';
    const code = lastSeenAt ? 'agent_runner_stale' : 'agent_runner_disconnected';
    const cleanupEvents = await this.cleanupExpiredActiveKeysForAgent(workspaceId, projectId, agentId);
    return {
      agent_runner_id: agentId,
      status,
      checked_at: checkedAt,
      timeout_ms: input?.timeoutMs ?? 1000,
      freshness: {
        state: lastSeenAt ? 'stale' : 'missing',
        active_connection_count: 0,
        ...(lastSeenAt ? { last_seen_at: lastSeenAt } : {}),
      },
      capabilities: agent.capabilities ?? {},
      errors: [
        {
          code,
          message: code,
        },
      ],
      ...(cleanupEvents[0]
        ? {
          cleanup: {
            key_expiry: cleanupEvents[0],
          },
        }
        : {}),
    };
  }

  async getSessionConnectionInfo(
    agentId: string,
    sessionId?: string,
    options?: {
      allowAgentFallback?: boolean;
    },
  ): Promise<AgentConnectionState | null> {
    const snapshot = await this.agentPresenceStore.getPresence(agentId);
    if (!sessionId) {
      return snapshot.latestConnection;
    }
    const exact = snapshot.connections.find((connection) => connection.session_id === sessionId) ?? null;
    if (exact) return exact;
    if (options?.allowAgentFallback === false) {
      return null;
    }
    return snapshot.connections.find((connection) => connection.session_id === undefined) ?? null;
  }

  async getAuthorizedSessionConnectionInfo(
    agentId: string,
    sessionId?: string,
    options?: {
      allowAgentFallback?: boolean;
    },
  ): Promise<AgentConnectionState | null> {
    const connection = await this.getSessionConnectionInfo(agentId, sessionId, options);
    if (!connection) return null;
    return (await this.isConnectionAuthActive(connection)) ? connection : null;
  }

  buildConnectionInfo(agent: Pick<AgentRecord, 'id' | 'runner_provider'>): AgentConnectionInfo {
    const wsBase = resolveConnectionWsBase(agent);
    return {
      ws_url: `${wsBase.replace(/\/$/, '')}/api/v1/agent-execution/ws?agent_runner_id=${encodeURIComponent(agent.id)}`,
      agent_runner_id: agent.id,
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
      ...(runtime?.metadata ? { runtime_metadata: runtime.metadata } : {}),
    };
  }

  private async hydratePresence(agent: AgentRecord): Promise<AgentRecord> {
    if (isManagedAgentRunner(agent)) {
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

  private async isConnectionAuthActive(connection: AgentConnectionState): Promise<boolean> {
    return (await this.checkConnectionAuthActive(connection)).active;
  }

  private async checkConnectionAuthActive(connection: AgentConnectionState): Promise<ConnectionAuthCheckResult> {
    if (connection.auth_kind === 'service_key') {
      const keyId = connection.auth_key_id?.trim();
      if (!keyId) return { active: false };
      const key = await this.docStore.get<AgentServiceKeyRecord>(
        this.agentKeysCollection(connection.workspace_id),
        keyId,
      );
      if (
        !key ||
        key.workspace_id !== connection.workspace_id ||
        key.project_id !== connection.project_id ||
        key.agent_id !== connection.agent_id
      ) {
        return { active: false };
      }
      const normalized = await this.normalizeKeyExpiry(connection.workspace_id, key);
      return {
        active: normalized.record.status === 'active' && !this.isExpiredKey(normalized.record),
        ...(normalized.cleanup ? { cleanup: normalized.cleanup } : {}),
      };
    }

    if (connection.auth_kind === 'managed_private_key') {
      const agent = await this.docStore.get<AgentRecord & Record<string, unknown>>(
        this.agentsCollection(connection.workspace_id),
        connection.agent_id,
      );
      if (!agent || agent.workspace_id !== connection.workspace_id || agent.project_id !== connection.project_id) {
        return { active: false };
      }
      const normalized = sanitizeAgentRecord(agent);
      if (!isManagedAgentRunner(normalized) || normalized.status !== 'enabled') {
        return { active: false };
      }
      const configuredKeyId = normalized.config?._internal_key_id?.trim() || `internal:${normalized.id}`;
      return { active: connection.auth_key_id === configuredKeyId };
    }

    return { active: false };
  }

  private async releaseConnectionsAuthenticatedByKey(record: AgentServiceKeyRecord): Promise<boolean> {
    const snapshot = await this.agentPresenceStore.getPresence(record.agent_id);
    const matchingConnections = snapshot.connections.filter((connection) => (
      connection.auth_kind === 'service_key'
      && connection.auth_key_id === record.id
      && connection.workspace_id === record.workspace_id
      && connection.project_id === record.project_id
    ));
    let disconnected = false;
    for (const connection of matchingConnections) {
      const released = await this.releaseAgentConnection({
        workspaceId: connection.workspace_id,
        projectId: connection.project_id,
        agentId: record.agent_id,
        connectionId: connection.connection_id,
      });
      disconnected = disconnected || released.released;
    }
    return disconnected;
  }

  private async cleanupExpiredActiveKeysForAgent(
    workspaceId: string,
    projectId: string,
    agentId: string,
  ): Promise<AgentRunnerKeyExpiryCleanupEvidence[]> {
    const activeKeys = await this.docStore.list<AgentServiceKeyRecord>(this.agentKeysCollection(workspaceId), {
      workspace_id: workspaceId,
      project_id: projectId,
      agent_id: agentId,
      status: 'active',
    });
    const normalized = await Promise.all(
      activeKeys.map((key) => this.normalizeKeyExpiry(workspaceId, key)),
    );
    return normalized
      .map((item) => item.cleanup)
      .filter((item): item is AgentRunnerKeyExpiryCleanupEvidence => item !== undefined);
  }

  private async recordKeyExpiryCleanupAudit(cleanup: AgentRunnerKeyExpiryCleanupEvidence): Promise<void> {
    const metadata: Record<string, unknown> = {
      workspace_id: cleanup.workspace_id,
      project_id: cleanup.project_id,
      agent_runner_id: cleanup.agent_runner_id,
      key_id: cleanup.key_id,
      key_prefix: cleanup.key_prefix,
      ...(cleanup.expires_at ? { expires_at: cleanup.expires_at } : {}),
      cleanup_result: cleanup.cleanup_result,
      disconnected: cleanup.disconnected,
    };
    await recordAuditEvent(this.docStore, {
      id: `aud_agent_runner_connection_key_expired_${cleanup.key_id}`,
      workspace_id: cleanup.workspace_id,
      project_id: cleanup.project_id,
      actor_type: 'agent',
      actor_id: cleanup.agent_runner_id,
      action: 'agent_runner.connection_key.expired',
      result: 'ok',
      request_id: `req_agent_runner_connection_key_expired_${cleanup.key_id}`,
      resource_type: 'agent_runner',
      resource_id: cleanup.agent_runner_id,
      metadata_json: metadata,
    });
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

  private async syncStoredPresenceProjection(input: {
    workspaceId: string;
    projectId: string;
    agentId: string;
    presence: AgentRecord['presence'];
    lastSeenAt: string;
  }): Promise<void> {
    for (let attempt = 1; attempt <= AgentResourceService.storedPresenceSyncMaxAttempts; attempt += 1) {
      try {
        await this.writeStoredPresence(
          input.workspaceId,
          input.projectId,
          input.agentId,
          input.presence,
          input.lastSeenAt,
        );
        return;
      } catch {
        if (attempt >= AgentResourceService.storedPresenceSyncMaxAttempts) {
          return;
        }
        await delay(AgentResourceService.storedPresenceSyncBackoffMs * attempt);
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
