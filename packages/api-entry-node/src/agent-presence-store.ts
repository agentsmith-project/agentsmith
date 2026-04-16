import type { AgentPresenceStorePort, CachePort } from '@mbos/ports';

const AGENT_PRESENCE_RECORD_VERSION = 2;
export const AGENT_PRESENCE_TTL_SECONDS = 45;
export const AGENT_CONNECTION_TTL_MS = AGENT_PRESENCE_TTL_SECONDS * 1000;
const AGENT_PRESENCE_CAS_MAX_ATTEMPTS = 12;
const AGENT_PRESENCE_CAS_BACKOFF_MAX_MS = 25;

function agentPresenceKey(agentId: string): string {
  return `agent:presence:${agentId}`;
}

export interface AgentConnectionState {
  connection_id: string;
  socket_key: string;
  agent_id: string;
  workspace_id: string;
  project_id: string;
  connected_at: string;
  last_pong_at?: string;
  expires_at: string;
  expires_at_epoch_ms?: number;
  api_instance_id?: string;
  session_id?: string;
  remote_ip?: string;
  protocol_version?: string;
  active_connection_count?: number;
}

interface AgentPresenceRecord {
  version: typeof AGENT_PRESENCE_RECORD_VERSION;
  agent_id: string;
  workspace_id: string;
  project_id: string;
  generation: number;
  updated_at: string;
  connections: Record<string, AgentConnectionState>;
}

export interface AgentPresenceSnapshot {
  agentId: string;
  workspaceId?: string;
  projectId?: string;
  activeConnectionCount: number;
  latestConnection: AgentConnectionState | null;
  connections: AgentConnectionState[];
}

export interface RegisterAgentConnectionInput {
  agentId: string;
  workspaceId: string;
  projectId: string;
  connectionId: string;
  socketKey: string;
  apiInstanceId: string;
  sessionId?: string;
  remoteIp?: string;
  protocolVersion?: string;
  connectedAt?: string;
  lastPongAt?: string;
}

export interface RefreshAgentConnectionInput {
  agentId: string;
  connectionId: string;
  lastPongAt: string;
  remoteIp?: string;
  protocolVersion?: string;
}

export interface ReleaseAgentConnectionInput {
  agentId: string;
  connectionId: string;
}

export interface AgentPresenceMutationResult {
  stale: boolean;
  snapshot: AgentPresenceSnapshot;
}

export interface AgentPresenceStore extends AgentPresenceStorePort {
  readonly kind: 'in_memory' | 'cache_cas';
  upsertConnection(input: RegisterAgentConnectionInput): Promise<AgentPresenceSnapshot>;
  refreshConnection(input: RefreshAgentConnectionInput): Promise<AgentPresenceMutationResult>;
  releaseConnection(input: ReleaseAgentConnectionInput): Promise<AgentPresenceMutationResult & { released: boolean }>;
  getPresence(agentId: string): Promise<AgentPresenceSnapshot>;
  isConnectionCurrent(agentId: string, connectionId: string): Promise<boolean>;
  clearAgent(agentId: string): Promise<void>;
}

interface AtomicCachePort extends CachePort {
  compareAndSet(
    key: string,
    expectedValue: string | null,
    nextValue: string | null,
    ttlSeconds?: number,
  ): Promise<boolean>;
}

interface LeaseExpiry {
  iso: string;
  epochMs: number;
}

function isAtomicCache(cache: CachePort): cache is AtomicCachePort {
  return typeof cache.compareAndSet === 'function';
}

function resolveLeaseExpiry(): LeaseExpiry {
  const epochMs = Date.now() + AGENT_CONNECTION_TTL_MS;
  return {
    iso: new Date(epochMs).toISOString(),
    epochMs,
  };
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function normalizeConnection(input: unknown): AgentConnectionState | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const connectionId = readString(raw, 'connection_id');
  const socketKey = readString(raw, 'socket_key');
  const agentId = readString(raw, 'agent_id');
  const workspaceId = readString(raw, 'workspace_id');
  const projectId = readString(raw, 'project_id');
  const connectedAt = readString(raw, 'connected_at');
  const expiresAt = readString(raw, 'expires_at');
  const expiresAtEpochMs = raw.expires_at_epoch_ms;
  if (!connectionId || !socketKey || !agentId || !workspaceId || !projectId || !connectedAt || !expiresAt) {
    return null;
  }
  const connection: AgentConnectionState = {
    connection_id: connectionId,
    socket_key: socketKey,
    agent_id: agentId,
    workspace_id: workspaceId,
    project_id: projectId,
    connected_at: connectedAt,
    expires_at: expiresAt,
  };
  if (typeof expiresAtEpochMs === 'number' && Number.isFinite(expiresAtEpochMs)) {
    connection.expires_at_epoch_ms = expiresAtEpochMs;
  }
  const apiInstanceId = readString(raw, 'api_instance_id');
  const sessionId = readString(raw, 'session_id');
  const remoteIp = readString(raw, 'remote_ip');
  const protocolVersion = readString(raw, 'protocol_version');
  const lastPongAt = readString(raw, 'last_pong_at');
  if (apiInstanceId) connection.api_instance_id = apiInstanceId;
  if (sessionId) connection.session_id = sessionId;
  if (remoteIp) connection.remote_ip = remoteIp;
  if (protocolVersion) connection.protocol_version = protocolVersion;
  if (lastPongAt) connection.last_pong_at = lastPongAt;
  return connection;
}

function normalizeRecord(agentId: string, raw: unknown): AgentPresenceRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== AGENT_PRESENCE_RECORD_VERSION || typeof record.connections !== 'object' || !record.connections) {
    const connectedAt = readString(record, 'connected_at');
    if (!connectedAt) return null;
    const legacyExpiry = resolveLeaseExpiry();
    const legacy: AgentConnectionState = {
      connection_id: `legacy:${agentId}`,
      socket_key: agentId,
      agent_id: agentId,
      workspace_id: '',
      project_id: '',
      connected_at: connectedAt,
      expires_at: legacyExpiry.iso,
      expires_at_epoch_ms: legacyExpiry.epochMs,
      ...(readString(record, 'last_pong_at') ? { last_pong_at: readString(record, 'last_pong_at') } : {}),
      ...(readString(record, 'remote_ip') ? { remote_ip: readString(record, 'remote_ip') } : {}),
      ...(readString(record, 'protocol_version') ? { protocol_version: readString(record, 'protocol_version') } : {}),
    };
    return {
      version: AGENT_PRESENCE_RECORD_VERSION,
      agent_id: agentId,
      workspace_id: '',
      project_id: '',
      generation: 1,
      updated_at: legacy.last_pong_at ?? legacy.connected_at,
      connections: {
        [legacy.connection_id]: legacy,
      },
    };
  }

  const workspaceId = readString(record, 'workspace_id');
  const projectId = readString(record, 'project_id');
  const updatedAt = readString(record, 'updated_at');
  const generation = typeof record.generation === 'number' && Number.isFinite(record.generation)
    ? record.generation
    : 0;
  if (!workspaceId || !projectId || !updatedAt) return null;
  const connections: Record<string, AgentConnectionState> = {};
  for (const [connectionId, connectionRaw] of Object.entries(record.connections as Record<string, unknown>)) {
    const connection = normalizeConnection(connectionRaw);
    if (connection && connection.connection_id === connectionId && connection.agent_id === agentId) {
      connections[connectionId] = connection;
    }
  }
  return {
    version: AGENT_PRESENCE_RECORD_VERSION,
    agent_id: agentId,
    workspace_id: workspaceId,
    project_id: projectId,
    generation,
    updated_at: updatedAt,
    connections,
  };
}

function isActive(connection: AgentConnectionState, nowMs: number): boolean {
  if (typeof connection.expires_at_epoch_ms === 'number' && Number.isFinite(connection.expires_at_epoch_ms)) {
    return connection.expires_at_epoch_ms > nowMs;
  }
  const expiresAt = Date.parse(connection.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

function cleanupExpired(record: AgentPresenceRecord, nowMs: number): AgentPresenceRecord {
  const connections = Object.fromEntries(
    Object.entries(record.connections).filter(([, connection]) => isActive(connection, nowMs)),
  );
  return {
    ...record,
    connections,
  };
}

function computeCasBackoffMs(attempt: number): number {
  return Math.min(AGENT_PRESENCE_CAS_BACKOFF_MAX_MS, 2 ** attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compareConnectionRecency(a: AgentConnectionState, b: AgentConnectionState): number {
  const aPong = Date.parse(a.last_pong_at ?? a.connected_at);
  const bPong = Date.parse(b.last_pong_at ?? b.connected_at);
  const pongDelta = (Number.isFinite(bPong) ? bPong : 0) - (Number.isFinite(aPong) ? aPong : 0);
  if (pongDelta !== 0) return pongDelta;
  const aConnected = Date.parse(a.connected_at);
  const bConnected = Date.parse(b.connected_at);
  return (Number.isFinite(bConnected) ? bConnected : 0) - (Number.isFinite(aConnected) ? aConnected : 0);
}

function snapshotFromRecord(agentId: string, record: AgentPresenceRecord | null): AgentPresenceSnapshot {
  const connections = Object.values(record?.connections ?? {}).sort(compareConnectionRecency);
  const latestConnection = connections[0] ?? null;
  const activeConnectionCount = connections.length;
  return {
    agentId,
    ...(record?.workspace_id ? { workspaceId: record.workspace_id } : {}),
    ...(record?.project_id ? { projectId: record.project_id } : {}),
    activeConnectionCount,
    latestConnection: latestConnection
      ? { ...latestConnection, active_connection_count: activeConnectionCount }
      : null,
    connections: connections.map((connection) => ({
      ...connection,
      active_connection_count: activeConnectionCount,
    })),
  };
}

export function createAgentPresenceStore(cache?: CachePort): AgentPresenceStore {
  return new CacheBackedAgentPresenceStore(cache);
}

class CacheBackedAgentPresenceStore implements AgentPresenceStore {
  readonly kind: 'in_memory' | 'cache_cas';
  private readonly localRecords = new Map<string, string>();
  private readonly localLocks = new Map<string, Promise<unknown>>();
  private readonly atomicCache?: AtomicCachePort;

  constructor(cache?: CachePort) {
    if (cache) {
      if (!isAtomicCache(cache)) {
        throw new Error('agent_presence_store_requires_atomic_cache');
      }
      this.atomicCache = cache;
      this.kind = 'cache_cas';
    } else {
      this.kind = 'in_memory';
    }
  }

  async upsertConnection(input: RegisterAgentConnectionInput): Promise<AgentPresenceSnapshot> {
    return this.mutateRecord(input.agentId, (existing) => {
      const now = new Date().toISOString();
      const connectedAt = input.connectedAt ?? now;
      const lastPongAt = input.lastPongAt ?? connectedAt;
      const retainedConnections = Object.fromEntries(
        Object.entries(existing.connections).filter(([, connection]) => (
          connection.socket_key !== input.socketKey || connection.connection_id === input.connectionId
        )),
      );
      const expiry = resolveLeaseExpiry();
      const connection: AgentConnectionState = {
        connection_id: input.connectionId,
        socket_key: input.socketKey,
        agent_id: input.agentId,
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        connected_at: connectedAt,
        last_pong_at: lastPongAt,
        expires_at: expiry.iso,
        expires_at_epoch_ms: expiry.epochMs,
        api_instance_id: input.apiInstanceId,
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        ...(input.remoteIp ? { remote_ip: input.remoteIp } : {}),
        ...(input.protocolVersion ? { protocol_version: input.protocolVersion } : {}),
      };
      const next: AgentPresenceRecord = {
        version: AGENT_PRESENCE_RECORD_VERSION,
        agent_id: input.agentId,
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        generation: existing.generation + 1,
        updated_at: lastPongAt,
        connections: {
          ...retainedConnections,
          [input.connectionId]: connection,
        },
      };
      return {
        next,
        result: snapshotFromRecord(input.agentId, next),
      };
    });
  }

  async refreshConnection(input: RefreshAgentConnectionInput): Promise<AgentPresenceMutationResult> {
    return this.mutateRecord(input.agentId, (existing) => {
      const current = existing.connections[input.connectionId];
      if (!current) {
        return {
          next: existing,
          result: { stale: true, snapshot: snapshotFromRecord(input.agentId, existing) },
        };
      }
      const expiry = resolveLeaseExpiry();
      const refreshed: AgentConnectionState = {
        ...current,
        last_pong_at: input.lastPongAt,
        expires_at: expiry.iso,
        expires_at_epoch_ms: expiry.epochMs,
        ...(input.remoteIp ? { remote_ip: input.remoteIp } : {}),
        ...(input.protocolVersion ? { protocol_version: input.protocolVersion } : {}),
      };
      const next: AgentPresenceRecord = {
        ...existing,
        generation: existing.generation + 1,
        updated_at: input.lastPongAt,
        connections: {
          ...existing.connections,
          [input.connectionId]: refreshed,
        },
      };
      return {
        next,
        result: { stale: false, snapshot: snapshotFromRecord(input.agentId, next) },
      };
    });
  }

  async releaseConnection(input: ReleaseAgentConnectionInput): Promise<AgentPresenceMutationResult & { released: boolean }> {
    return this.mutateRecord(input.agentId, (existing) => {
      if (!existing.connections[input.connectionId]) {
        return {
          next: existing,
          result: {
            released: false,
            stale: true,
            snapshot: snapshotFromRecord(input.agentId, existing),
          },
        };
      }
      const { [input.connectionId]: _released, ...remaining } = existing.connections;
      const next: AgentPresenceRecord = {
        ...existing,
        generation: existing.generation + 1,
        updated_at: new Date().toISOString(),
        connections: remaining,
      };
      return {
        next,
        result: {
          released: true,
          stale: false,
          snapshot: snapshotFromRecord(input.agentId, next),
        },
      };
    });
  }

  async getPresence(agentId: string): Promise<AgentPresenceSnapshot> {
    const record = await this.readRecord(agentId);
    return snapshotFromRecord(agentId, record);
  }

  async isConnectionCurrent(agentId: string, connectionId: string): Promise<boolean> {
    const presence = await this.getPresence(agentId);
    return presence.connections.some((connection) => connection.connection_id === connectionId);
  }

  async clearAgent(agentId: string): Promise<void> {
    await this.mutateRecord(agentId, () => {
      return {
        next: this.emptyRecord(agentId),
        result: undefined,
      };
    });
  }

  private emptyRecord(agentId: string): AgentPresenceRecord {
    const now = new Date().toISOString();
    return {
      version: AGENT_PRESENCE_RECORD_VERSION,
      agent_id: agentId,
      workspace_id: '',
      project_id: '',
      generation: 0,
      updated_at: now,
      connections: {},
    };
  }

  private normalizeRecordForMutation(agentId: string, raw: string | null): AgentPresenceRecord {
    if (!raw) return this.emptyRecord(agentId);
    try {
      return normalizeRecord(agentId, JSON.parse(raw)) ?? this.emptyRecord(agentId);
    } catch {
      return this.emptyRecord(agentId);
    }
  }

  private serializeRecord(record: AgentPresenceRecord): string | null {
    if (Object.keys(record.connections).length === 0) return null;
    return JSON.stringify(record);
  }

  private async mutateRecord<T>(
    agentId: string,
    mutate: (existing: AgentPresenceRecord) => { next: AgentPresenceRecord; result: T },
  ): Promise<T> {
    const key = agentPresenceKey(agentId);
    if (!this.atomicCache) {
      return this.withLocalAgentLock(agentId, async () => {
        const expected = this.localRecords.get(key) ?? null;
        const existing = cleanupExpired(this.normalizeRecordForMutation(agentId, expected), Date.now());
        const { next, result } = mutate(existing);
        const nextSerialized = this.serializeRecord(next);
        if (nextSerialized === null) {
          this.localRecords.delete(key);
        } else {
          this.localRecords.set(key, nextSerialized);
        }
        return result;
      });
    }

    for (let attempt = 0; attempt < AGENT_PRESENCE_CAS_MAX_ATTEMPTS; attempt += 1) {
      const expected = await this.atomicCache.get(key);
      const existing = cleanupExpired(this.normalizeRecordForMutation(agentId, expected), Date.now());
      const { next, result } = mutate(existing);
      const nextSerialized = this.serializeRecord(next);
      if (await this.atomicCache.compareAndSet(key, expected, nextSerialized, AGENT_PRESENCE_TTL_SECONDS)) {
        return result;
      }
      if (attempt < AGENT_PRESENCE_CAS_MAX_ATTEMPTS - 1) {
        await sleep(computeCasBackoffMs(attempt));
      }
    }
    throw new Error('agent_presence_store_cas_retry_exhausted');
  }

  private async readRecord(agentId: string): Promise<AgentPresenceRecord> {
    const key = agentPresenceKey(agentId);
    const raw = this.atomicCache
      ? await this.atomicCache.get(key)
      : (this.localRecords.get(key) ?? null);
    return cleanupExpired(this.normalizeRecordForMutation(agentId, raw), Date.now());
  }

  private async withLocalAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.localLocks.get(agentId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    this.localLocks.set(agentId, run.then(() => undefined, () => undefined));
    return run;
  }
}
