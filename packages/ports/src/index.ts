import type { ProjectDTO, FileLibraryCatalogDTO } from '@mbos/contracts';
import type { ReadableStream } from 'node:stream/web';

export interface ProjectRepoPort {
  listByWorkspace(workspaceId: string): Promise<ProjectDTO[]>;
  getById(workspaceId: string, projectId: string): Promise<ProjectDTO | null>;
  save(project: ProjectDTO): Promise<void>;
  update(
    workspaceId: string,
    projectId: string,
    patch: Partial<ProjectDTO>,
  ): Promise<ProjectDTO | null>;
  delete(workspaceId: string, projectId: string): Promise<boolean>;
}

export interface IdGeneratorPort {
  nextProjectId(): string;
}

export interface ClockPort {
  nowIso(): string;
}

export interface CachePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  incr(key: string, ttlSeconds?: number): Promise<number>;
  del(key: string): Promise<void>;
  compareAndSet?(
    key: string,
    expectedValue: string | null,
    nextValue: string | null,
    ttlSeconds?: number,
  ): Promise<boolean>;
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

export interface AgentPresenceStorePort {
  readonly kind: 'in_memory' | 'cache_cas';
  upsertConnection(input: RegisterAgentConnectionInput): Promise<AgentPresenceSnapshot>;
  refreshConnection(input: RefreshAgentConnectionInput): Promise<AgentPresenceMutationResult>;
  releaseConnection(input: ReleaseAgentConnectionInput): Promise<AgentPresenceMutationResult & { released: boolean }>;
  getPresence(agentId: string): Promise<AgentPresenceSnapshot>;
  isConnectionCurrent(agentId: string, connectionId: string): Promise<boolean>;
  clearAgent(agentId: string): Promise<void>;
}

export interface JsonDocStorePort {
  get<T>(collection: string, id: string): Promise<T | null>;
  upsert<T>(collection: string, id: string, doc: T): Promise<void>;
  list<T>(collection: string, filter?: Record<string, string>): Promise<T[]>;
  delete(collection: string, id: string): Promise<void>;
}

export interface ObjectStorePutObjectStreamOptions {
  contentType?: string;
  sizeBytes?: number;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ObjectStoreStreamHandle {
  body: ReadableStream<Uint8Array>;
  cancel: (reason?: unknown) => Promise<void>;
  sizeBytes?: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  metadata?: Record<string, string>;
}

export interface ObjectStorePort {
  putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType?: string,
  ): Promise<void>;
  putObjectStream(
    bucket: string,
    key: string,
    body: ReadableStream<Uint8Array>,
    options?: ObjectStorePutObjectStreamOptions,
  ): Promise<void>;
  presignedGetObject(bucket: string, key: string, expirySeconds?: number): Promise<string>;
  getObject(bucket: string, key: string): Promise<Uint8Array>;
  getObjectStream(bucket: string, key: string): Promise<ObjectStoreStreamHandle>;
  statObject(
    bucket: string,
    key: string,
  ): Promise<{
    key: string;
    sizeBytes: number;
    contentType?: string;
    etag?: string;
    lastModified: string;
    metadata?: Record<string, string>;
  }>;
  listObjects(
    bucket: string,
    options: {
      prefix: string;
      delimiter?: string;
      pageSize?: number;
      continuationToken?: string;
    },
  ): Promise<{
    prefix: string;
    objects: Array<{
      key: string;
      sizeBytes: number;
      etag?: string;
      lastModified: string;
    }>;
    commonPrefixes: string[];
    nextContinuationToken: string | null;
  }>;
  copyObject(
    bucket: string,
    fromKey: string,
    toKey: string,
    options?: { overwrite?: boolean },
  ): Promise<void>;
  deleteObject(bucket: string, key: string): Promise<void>;
  deleteMany(bucket: string, keys: string[]): Promise<void>;
}

export interface FileLibraryCatalogRepoPort {
  listByProject(workspaceId: string, projectId: string): Promise<FileLibraryCatalogDTO[]>;
  getById(workspaceId: string, projectId: string, libraryId: string): Promise<FileLibraryCatalogDTO | null>;
  save(library: FileLibraryCatalogDTO): Promise<void>;
  update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    patch: Partial<FileLibraryCatalogDTO>,
  ): Promise<FileLibraryCatalogDTO | null>;
  delete(workspaceId: string, projectId: string, libraryId: string): Promise<boolean>;
}
