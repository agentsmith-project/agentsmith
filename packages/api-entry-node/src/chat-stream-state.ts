import type http from 'node:http';
import type { CachePort } from '@mbos/ports';

export interface ActiveChatStreamRecord {
  workspaceId: string;
  projectId: string;
  sessionId: string;
  abortController: AbortController;
  startedAt: string;
  status: 'running' | 'stopping' | 'finished';
  stopReason?: 'user_stop' | 'session_stop';
  assistantMessageId: string;
  parentMessageId: string | null;
  variantGroupId?: string;
  variantIndex?: number;
  endpointId: string;
  model: string;
  contentSoFar: string;
  clients: Set<http.ServerResponse>;
}

export interface ChatStreamRegistryRecord {
  streamId: string;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  status: 'running' | 'stopping' | 'completed' | 'stopped' | 'failed';
  updatedAt: string;
}

export type ChatSessionExecutionStatus = 'running' | 'stopping' | 'completed' | 'stopped' | 'failed';
export type ChatSessionExecutionPhase = 'bootstrapping' | 'dispatching' | 'streaming' | 'terminal';
export type ChatSessionExecutionTransport = 'direct_provider' | 'agent_runner';

export interface ChatSessionExecutionRecord {
  workspaceId: string;
  projectId: string;
  sessionId: string;
  streamId: string;
  ownerInstanceId: string;
  transport: ChatSessionExecutionTransport;
  internalAgent?: boolean;
  status: ChatSessionExecutionStatus;
  phase: ChatSessionExecutionPhase;
  startedAt: string;
  updatedAt: string;
  requestId?: string;
  endpointId?: string | null;
  externalAgentId?: string | null;
  stopRequestedAt?: string;
  stopRequestedBy?: string;
  stopReason?: 'user_stop' | 'session_stop';
}

export const ACTIVE_CHAT_STREAMS = new Map<string, ActiveChatStreamRecord>();
export const STREAM_REGISTRY_TTL_SECONDS = 30 * 60;
export const STREAM_REGISTRY_FINAL_TTL_SECONDS = 5 * 60;

type SessionStreamStatus = ChatSessionExecutionStatus;

const CHAT_EXECUTION_OWNER_INSTANCE_ID = process.env.CHAT_STREAM_INSTANCE_ID?.trim()
  || `api-${process.pid}`;

function streamRegistryKey(streamId: string): string {
  return `chat:stream:${streamId}`;
}

function sessionStreamStateKey(
  workspaceId: string,
  projectId: string,
  sessionId: string,
): string {
  return `chat:session-stream:${workspaceId}:${projectId}:${sessionId}`;
}

export async function readSessionStreamState(
  cache: CachePort,
  workspaceId: string,
  projectId: string,
  sessionId: string,
): Promise<SessionStreamStatus | null> {
  const record = await readSessionExecutionRecord(cache, workspaceId, projectId, sessionId);
  return record?.status ?? null;
}

export async function writeSessionStreamState(
  cache: CachePort,
  workspaceId: string,
  projectId: string,
  sessionId: string,
  status: SessionStreamStatus,
  ttlSeconds: number,
): Promise<void> {
  await cache.set(sessionStreamStateKey(workspaceId, projectId, sessionId), status, ttlSeconds);
}

function isSessionStatus(value: unknown): value is ChatSessionExecutionStatus {
  return value === 'running'
    || value === 'stopping'
    || value === 'completed'
    || value === 'stopped'
    || value === 'failed';
}

function isSessionPhase(value: unknown): value is ChatSessionExecutionPhase {
  return value === 'bootstrapping'
    || value === 'dispatching'
    || value === 'streaming'
    || value === 'terminal';
}

function parseSessionExecutionRecord(
  raw: string | null,
  identity: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'>,
): ChatSessionExecutionRecord | null {
  if (!raw) return null;
  if (isSessionStatus(raw)) {
    return {
      ...identity,
      streamId: '',
      ownerInstanceId: CHAT_EXECUTION_OWNER_INSTANCE_ID,
      transport: 'direct_provider',
      status: raw,
      phase: raw === 'running' ? 'streaming' : raw === 'stopping' ? 'dispatching' : 'terminal',
      startedAt: '',
      updatedAt: '',
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ChatSessionExecutionRecord>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!isSessionStatus(parsed.status)) return null;
    if (!isSessionPhase(parsed.phase)) return null;
    const workspaceId = typeof parsed.workspaceId === 'string' && parsed.workspaceId.length > 0
      ? parsed.workspaceId
      : identity.workspaceId;
    const projectId = typeof parsed.projectId === 'string' && parsed.projectId.length > 0
      ? parsed.projectId
      : identity.projectId;
    const sessionId = typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0
      ? parsed.sessionId
      : identity.sessionId;
    const streamId = typeof parsed.streamId === 'string' ? parsed.streamId : '';
    const ownerInstanceId = typeof parsed.ownerInstanceId === 'string' && parsed.ownerInstanceId.length > 0
      ? parsed.ownerInstanceId
      : CHAT_EXECUTION_OWNER_INSTANCE_ID;
    const transport = parsed.transport === 'agent_runner' ? 'agent_runner' : 'direct_provider';
    return {
      workspaceId,
      projectId,
      sessionId,
      streamId,
      ownerInstanceId,
      transport,
      ...(typeof parsed.internalAgent === 'boolean' ? { internalAgent: parsed.internalAgent } : {}),
      status: parsed.status,
      phase: parsed.phase,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      ...(typeof parsed.requestId === 'string' ? { requestId: parsed.requestId } : {}),
      ...(typeof parsed.endpointId === 'string' || parsed.endpointId === null ? { endpointId: parsed.endpointId } : {}),
      ...(typeof parsed.externalAgentId === 'string' || parsed.externalAgentId === null
        ? { externalAgentId: parsed.externalAgentId }
        : {}),
      ...(typeof parsed.stopRequestedAt === 'string' ? { stopRequestedAt: parsed.stopRequestedAt } : {}),
      ...(typeof parsed.stopRequestedBy === 'string' ? { stopRequestedBy: parsed.stopRequestedBy } : {}),
      ...(parsed.stopReason === 'user_stop' || parsed.stopReason === 'session_stop'
        ? { stopReason: parsed.stopReason }
        : {}),
    };
  } catch {
    return null;
  }
}

export function getChatExecutionOwnerInstanceId(): string {
  return CHAT_EXECUTION_OWNER_INSTANCE_ID;
}

export async function readSessionExecutionRecord(
  cache: CachePort,
  workspaceId: string,
  projectId: string,
  sessionId: string,
): Promise<ChatSessionExecutionRecord | null> {
  return parseSessionExecutionRecord(
    await cache.get(sessionStreamStateKey(workspaceId, projectId, sessionId)),
    { workspaceId, projectId, sessionId },
  );
}

export async function writeSessionExecutionRecord(
  cache: CachePort,
  record: ChatSessionExecutionRecord,
  ttlSeconds: number,
): Promise<void> {
  await cache.set(
    sessionStreamStateKey(record.workspaceId, record.projectId, record.sessionId),
    JSON.stringify(record),
    ttlSeconds,
  );
}

export async function beginSessionExecution(
  cache: CachePort,
  input: Omit<ChatSessionExecutionRecord, 'status' | 'phase' | 'ownerInstanceId' | 'updatedAt'> & {
    ownerInstanceId?: string;
    updatedAt?: string;
  },
  ttlSeconds: number,
): Promise<ChatSessionExecutionRecord> {
  const record: ChatSessionExecutionRecord = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    streamId: input.streamId,
    ownerInstanceId: input.ownerInstanceId?.trim() || CHAT_EXECUTION_OWNER_INSTANCE_ID,
    transport: input.transport,
    ...(typeof input.internalAgent === 'boolean' ? { internalAgent: input.internalAgent } : {}),
    status: 'running',
    phase: 'bootstrapping',
    startedAt: input.startedAt,
    updatedAt: input.updatedAt ?? input.startedAt,
    ...(typeof input.requestId === 'string' ? { requestId: input.requestId } : {}),
    ...(input.endpointId !== undefined ? { endpointId: input.endpointId } : {}),
    ...(input.externalAgentId !== undefined ? { externalAgentId: input.externalAgentId } : {}),
  };
  await writeSessionExecutionRecord(cache, record, ttlSeconds);
  return record;
}

export async function patchSessionExecutionRecord(
  cache: CachePort,
  identity: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'>,
  mutate: (current: ChatSessionExecutionRecord | null) => ChatSessionExecutionRecord | null,
  ttlSeconds: number,
): Promise<ChatSessionExecutionRecord | null> {
  const current = await readSessionExecutionRecord(cache, identity.workspaceId, identity.projectId, identity.sessionId);
  const next = mutate(current);
  if (!next) return null;
  await writeSessionExecutionRecord(cache, next, ttlSeconds);
  return next;
}

export async function markSessionExecutionPhase(
  cache: CachePort,
  input: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'> & {
    phase: ChatSessionExecutionPhase;
    requestId?: string;
    internalAgent?: boolean;
    updatedAt?: string;
  },
  ttlSeconds: number,
): Promise<ChatSessionExecutionRecord | null> {
  return patchSessionExecutionRecord(
    cache,
    input,
    (current) => {
      if (!current) return null;
      return {
        ...current,
        phase: input.phase,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
        ...(typeof input.requestId === 'string' ? { requestId: input.requestId } : {}),
        ...(typeof input.internalAgent === 'boolean' ? { internalAgent: input.internalAgent } : {}),
      };
    },
    ttlSeconds,
  );
}

export async function requestSessionExecutionStop(
  cache: CachePort,
  input: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'> & {
    requestedBy?: string;
    stopReason: 'user_stop' | 'session_stop';
    updatedAt?: string;
  },
): Promise<ChatSessionExecutionRecord | null> {
  return patchSessionExecutionRecord(
    cache,
    input,
    (current) => {
      if (!current) return null;
      if (current.status === 'completed' || current.status === 'stopped' || current.status === 'failed') {
        return null;
      }
      return {
        ...current,
        status: 'stopping',
        updatedAt: input.updatedAt ?? new Date().toISOString(),
        stopRequestedAt: input.updatedAt ?? new Date().toISOString(),
        ...(typeof input.requestedBy === 'string' ? { stopRequestedBy: input.requestedBy } : {}),
        stopReason: input.stopReason,
      };
    },
    STREAM_REGISTRY_TTL_SECONDS,
  );
}

export async function finalizeSessionExecution(
  cache: CachePort,
  input: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'> & {
    streamId?: string;
    status: 'completed' | 'stopped' | 'failed';
    transport?: ChatSessionExecutionTransport;
    internalAgent?: boolean;
    endpointId?: string | null;
    externalAgentId?: string | null;
    requestId?: string;
    startedAt?: string;
    updatedAt?: string;
    stopReason?: 'user_stop' | 'session_stop';
  },
): Promise<ChatSessionExecutionRecord> {
  const current = await readSessionExecutionRecord(cache, input.workspaceId, input.projectId, input.sessionId);
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const next: ChatSessionExecutionRecord = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    streamId: current?.streamId ?? input.streamId ?? '',
    ownerInstanceId: current?.ownerInstanceId ?? CHAT_EXECUTION_OWNER_INSTANCE_ID,
    transport: current?.transport ?? input.transport ?? 'direct_provider',
    ...(typeof (current?.internalAgent ?? input.internalAgent) === 'boolean'
      ? { internalAgent: current?.internalAgent ?? input.internalAgent }
      : {}),
    status: input.status,
    phase: 'terminal',
    startedAt: current?.startedAt ?? input.startedAt ?? updatedAt,
    updatedAt,
    ...(current?.requestId ?? input.requestId ? { requestId: current?.requestId ?? input.requestId } : {}),
    ...(current?.endpointId !== undefined || input.endpointId !== undefined
      ? { endpointId: current?.endpointId ?? input.endpointId ?? null }
      : {}),
    ...(current?.externalAgentId !== undefined || input.externalAgentId !== undefined
      ? { externalAgentId: current?.externalAgentId ?? input.externalAgentId ?? null }
      : {}),
    ...(current?.stopRequestedAt ? { stopRequestedAt: current.stopRequestedAt } : {}),
    ...(current?.stopRequestedBy ? { stopRequestedBy: current.stopRequestedBy } : {}),
    ...(current?.stopReason || input.stopReason ? { stopReason: current?.stopReason ?? input.stopReason } : {}),
  };
  await writeSessionExecutionRecord(cache, next, STREAM_REGISTRY_FINAL_TTL_SECONDS);
  return next;
}

export async function readStreamRegistry(
  cache: CachePort,
  streamId: string,
): Promise<ChatStreamRegistryRecord | null> {
  const raw = await cache.get(streamRegistryKey(streamId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChatStreamRegistryRecord;
    if (parsed && parsed.streamId === streamId) {
      return parsed;
    }
  } catch {
    // ignore invalid cached payloads
  }
  return null;
}

export async function writeStreamRegistry(
  cache: CachePort,
  record: ChatStreamRegistryRecord,
  ttlSeconds: number,
): Promise<void> {
  await cache.set(streamRegistryKey(record.streamId), JSON.stringify(record), ttlSeconds);
}

export async function stopActiveSessionStreams(
  cache: CachePort,
  workspaceId: string,
  projectId: string,
  sessionId: string,
): Promise<number> {
  await requestSessionExecutionStop(cache, {
    workspaceId,
    projectId,
    sessionId,
    stopReason: 'session_stop',
  });
  let stopped = 0;
  for (const [streamId, stream] of ACTIVE_CHAT_STREAMS.entries()) {
    if (stream.workspaceId !== workspaceId || stream.projectId !== projectId || stream.sessionId !== sessionId) {
      continue;
    }
    stopped += 1;
    stream.status = 'stopping';
    stream.stopReason = 'session_stop';
    stream.abortController.abort();
    await writeStreamRegistry(
      cache,
      {
        streamId,
        workspaceId,
        projectId,
        sessionId,
        status: 'stopping',
        updatedAt: new Date().toISOString(),
      },
      STREAM_REGISTRY_TTL_SECONDS,
    );
  }
  if (stopped > 0) {
    await writeSessionStreamState(cache, workspaceId, projectId, sessionId, 'stopping', STREAM_REGISTRY_TTL_SECONDS);
  }
  return stopped;
}

export function listActiveSessionStreams(
  workspaceId: string,
  projectId: string,
  sessionId: string,
): Array<{ streamId: string; status: 'running' | 'stopping'; startedAt: string }> {
  return Array.from(ACTIVE_CHAT_STREAMS.entries())
    .filter(([, stream]) =>
      stream.workspaceId === workspaceId &&
      stream.projectId === projectId &&
      stream.sessionId === sessionId &&
      (stream.status === 'running' || stream.status === 'stopping'))
    .map(([streamId, stream]) => ({
      streamId,
      status: stream.status === 'running' ? 'running' : 'stopping',
      startedAt: stream.startedAt,
    }));
}
