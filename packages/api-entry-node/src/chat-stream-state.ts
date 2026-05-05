import type http from 'node:http';
import type { CachePort } from '@mbos/ports';

export interface ActiveChatStreamRecord {
  workspaceId: string;
  projectId: string;
  sessionId: string;
  abortController: AbortController;
  startedAt: string;
  status: 'running' | 'stopping' | 'terminating' | 'finished';
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
  status: 'running' | 'stopping' | 'terminating' | 'completed' | 'stopped' | 'failed';
  updatedAt: string;
}

export type ChatStopMode = 'cancel' | 'terminate';
export type ChatStopEscalationReason = 'STOP_ESCALATION_UNAVAILABLE';
export type ChatHardTeardownStatus = 'pending' | 'requested' | 'failed';
export type ChatSessionExecutionStatus = 'running' | 'stopping' | 'terminating' | 'completed' | 'stopped' | 'failed';
export type ChatSessionExecutionPhase = 'bootstrapping' | 'dispatching' | 'streaming' | 'terminal';

export interface ChatSessionExecutionRecord {
  workspaceId: string;
  projectId: string;
  sessionId: string;
  streamId: string;
  ownerInstanceId: string;
  status: ChatSessionExecutionStatus;
  phase: ChatSessionExecutionPhase;
  startedAt: string;
  updatedAt: string;
  requestId?: string;
  endpointId?: string | null;
  stopRequestedAt?: string;
  stopRequestedBy?: string;
  stopReason?: 'user_stop' | 'session_stop';
  stopMode?: ChatStopMode;
  hardTeardownStatus?: ChatHardTeardownStatus;
  hardTeardownRequestedAt?: string;
  hardTeardownLastAttemptAt?: string;
  hardTeardownLastError?: string;
  hardTeardownAttemptCount?: number;
  hardTeardownAttemptId?: string;
  stopEscalationReason?: ChatStopEscalationReason;
}

type ChatSessionHardTeardownDebtRecord = ChatSessionExecutionRecord & {
  stopMode: 'terminate';
  hardTeardownStatus: ChatHardTeardownStatus;
};

export interface ChatSessionExecutionStopTransitionResult {
  record: ChatSessionExecutionRecord | null;
  previous: ChatSessionExecutionRecord | null;
  changed: boolean;
  hardTeardownRequired: boolean;
  hardTeardownDispatchRequired: boolean;
}

export const ACTIVE_CHAT_STREAMS = new Map<string, ActiveChatStreamRecord>();
export const STREAM_REGISTRY_TTL_SECONDS = 30 * 60;
export const STREAM_REGISTRY_FINAL_TTL_SECONDS = 5 * 60;
const SESSION_EXECUTION_CAS_MAX_ATTEMPTS = 5;

type SessionStreamStatus = ChatSessionExecutionStatus;
type ChatSessionExecutionStopInput = Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'> & {
  requestedBy?: string;
  stopReason: 'user_stop' | 'session_stop';
  stopMode?: ChatStopMode;
  stopEscalationReason?: ChatStopEscalationReason;
  updatedAt?: string;
};

const CHAT_EXECUTION_OWNER_INSTANCE_ID = process.env.CHAT_STREAM_INSTANCE_ID?.trim()
  || `api-${process.pid}`;
const sessionExecutionLocalLocks = new Map<string, Promise<void>>();
const LEGACY_SESSION_EXECUTION_FIELDS = new Set([
  'transport',
  'internalAgent',
  'externalAgentId',
  'external_agent_id',
  'chat_runner',
  'agent_runner',
  'runnerTransport',
  'runner_transport',
]);

interface ChatHardTeardownReleaseFenceRecord {
  kind: 'chat_hard_teardown_release_fence';
  workspaceId: string;
  projectId: string;
  sessionId: string;
  streamId: string;
  releasedAt: string;
  generation: number;
  attemptId?: string;
}

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

function sessionHardTeardownDebtKey(
  workspaceId: string,
  projectId: string,
  sessionId: string,
): string {
  return `chat:session-hard-teardown:${workspaceId}:${projectId}:${sessionId}`;
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
  const now = new Date().toISOString();
  await writeSessionExecutionRecord(
    cache,
    {
      workspaceId,
      projectId,
      sessionId,
      streamId: '',
      ownerInstanceId: CHAT_EXECUTION_OWNER_INSTANCE_ID,
      status,
      phase: sessionPhaseForStatus(status),
      startedAt: now,
      updatedAt: now,
    },
    ttlSeconds,
  );
}

function isSessionStatus(value: unknown): value is ChatSessionExecutionStatus {
  return value === 'running'
    || value === 'stopping'
    || value === 'terminating'
    || value === 'completed'
    || value === 'stopped'
    || value === 'failed';
}

function isStopMode(value: unknown): value is ChatStopMode {
  return value === 'cancel' || value === 'terminate';
}

function isHardTeardownStatus(value: unknown): value is ChatHardTeardownStatus {
  return value === 'pending' || value === 'requested' || value === 'failed';
}

function isTerminalSessionExecutionStatus(status: ChatSessionExecutionStatus): boolean {
  return status === 'completed' || status === 'stopped' || status === 'failed';
}

function sessionPhaseForStatus(status: ChatSessionExecutionStatus): ChatSessionExecutionPhase {
  if (status === 'running') return 'streaming';
  if (status === 'stopping' || status === 'terminating') return 'dispatching';
  return 'terminal';
}

function isIncompleteHardTeardownStatus(status: ChatHardTeardownStatus | undefined): boolean {
  return status === 'pending' || status === 'failed' || status === 'requested';
}

export function hasSessionHardTeardownDebt(
  record: ChatSessionExecutionRecord | null | undefined,
): record is ChatSessionHardTeardownDebtRecord {
  return record?.stopMode === 'terminate'
    && isHardTeardownStatus(record.hardTeardownStatus);
}

export function hasIncompleteSessionHardTeardown(
  record: ChatSessionExecutionRecord | null | undefined,
): record is ChatSessionHardTeardownDebtRecord {
  return record?.stopMode === 'terminate'
    && isIncompleteHardTeardownStatus(record.hardTeardownStatus);
}

function blocksNewSessionExecution(record: ChatSessionExecutionRecord | null): boolean {
  if (!record) return false;
  if (record.status === 'running' || record.status === 'stopping' || record.status === 'terminating') {
    return true;
  }
  return hasSessionHardTeardownDebt(record);
}

function isSessionPhase(value: unknown): value is ChatSessionExecutionPhase {
  return value === 'bootstrapping'
    || value === 'dispatching'
    || value === 'streaming'
    || value === 'terminal';
}

function hasLegacySessionExecutionField(input: Record<string, unknown>): boolean {
  for (const key of LEGACY_SESSION_EXECUTION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) return true;
  }
  return false;
}

function hasLegacySessionExecutionEndpoint(input: Record<string, unknown>): boolean {
  return typeof input.endpointId === 'string' && input.endpointId.startsWith('agent:');
}

function assertNoLegacySessionExecutionInput(input: unknown): void {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return;
  const record = input as Record<string, unknown>;
  if (hasLegacySessionExecutionField(record) || hasLegacySessionExecutionEndpoint(record)) {
    throw new Error('chat_session_execution_legacy_field');
  }
}

function parseSessionExecutionRecord(
  raw: string | null,
  identity: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'>,
): ChatSessionExecutionRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChatSessionExecutionRecord> & Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (hasLegacySessionExecutionField(parsed) || hasLegacySessionExecutionEndpoint(parsed)) return null;
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
    return {
      workspaceId,
      projectId,
      sessionId,
      streamId,
      ownerInstanceId,
      status: parsed.status,
      phase: parsed.phase,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      ...(typeof parsed.requestId === 'string' ? { requestId: parsed.requestId } : {}),
      ...(typeof parsed.endpointId === 'string' || parsed.endpointId === null ? { endpointId: parsed.endpointId } : {}),
      ...(typeof parsed.stopRequestedAt === 'string' ? { stopRequestedAt: parsed.stopRequestedAt } : {}),
      ...(typeof parsed.stopRequestedBy === 'string' ? { stopRequestedBy: parsed.stopRequestedBy } : {}),
      ...(parsed.stopReason === 'user_stop' || parsed.stopReason === 'session_stop'
        ? { stopReason: parsed.stopReason }
        : {}),
      ...(isStopMode(parsed.stopMode) ? { stopMode: parsed.stopMode } : {}),
      ...(isHardTeardownStatus(parsed.hardTeardownStatus)
        ? { hardTeardownStatus: parsed.hardTeardownStatus }
        : {}),
      ...(typeof parsed.hardTeardownRequestedAt === 'string'
        ? { hardTeardownRequestedAt: parsed.hardTeardownRequestedAt }
        : {}),
      ...(typeof parsed.hardTeardownLastAttemptAt === 'string'
        ? { hardTeardownLastAttemptAt: parsed.hardTeardownLastAttemptAt }
        : {}),
      ...(typeof parsed.hardTeardownLastError === 'string'
        ? { hardTeardownLastError: parsed.hardTeardownLastError }
        : {}),
      ...(typeof parsed.hardTeardownAttemptCount === 'number' && Number.isFinite(parsed.hardTeardownAttemptCount)
        ? { hardTeardownAttemptCount: parsed.hardTeardownAttemptCount }
        : {}),
      ...(typeof parsed.hardTeardownAttemptId === 'string'
        ? { hardTeardownAttemptId: parsed.hardTeardownAttemptId }
        : {}),
      ...(parsed.stopEscalationReason === 'STOP_ESCALATION_UNAVAILABLE'
        ? { stopEscalationReason: parsed.stopEscalationReason }
        : {}),
    };
  } catch {
    return null;
  }
}

export function getChatExecutionOwnerInstanceId(): string {
  return CHAT_EXECUTION_OWNER_INSTANCE_ID;
}

async function readPrimarySessionExecutionRecord(
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

export async function readSessionHardTeardownDebtRecord(
  cache: CachePort,
  workspaceId: string,
  projectId: string,
  sessionId: string,
): Promise<ChatSessionExecutionRecord | null> {
  const debt = parseSessionExecutionRecord(
    await cache.get(sessionHardTeardownDebtKey(workspaceId, projectId, sessionId)),
    { workspaceId, projectId, sessionId },
  );
  return hasSessionHardTeardownDebt(debt) ? debt : null;
}

function mergeSessionExecutionWithHardTeardownDebt(
  primary: ChatSessionExecutionRecord | null,
  debt: ChatSessionExecutionRecord | null,
): ChatSessionExecutionRecord | null {
  if (!debt) return primary;
  if (!primary) return debt;
  return {
    ...primary,
    stopMode: 'terminate',
    ...(debt.stopRequestedAt ? { stopRequestedAt: debt.stopRequestedAt } : {}),
    ...(debt.stopRequestedBy ? { stopRequestedBy: debt.stopRequestedBy } : {}),
    ...(debt.stopReason ? { stopReason: debt.stopReason } : {}),
    hardTeardownStatus: debt.hardTeardownStatus,
    ...(debt.hardTeardownRequestedAt ? { hardTeardownRequestedAt: debt.hardTeardownRequestedAt } : {}),
    ...(debt.hardTeardownLastAttemptAt ? { hardTeardownLastAttemptAt: debt.hardTeardownLastAttemptAt } : {}),
    ...(debt.hardTeardownLastError ? { hardTeardownLastError: debt.hardTeardownLastError } : {}),
    ...(typeof debt.hardTeardownAttemptCount === 'number'
      ? { hardTeardownAttemptCount: debt.hardTeardownAttemptCount }
      : {}),
    ...(debt.hardTeardownAttemptId ? { hardTeardownAttemptId: debt.hardTeardownAttemptId } : {}),
    updatedAt: debt.updatedAt || primary.updatedAt,
  };
}

function parseSessionHardTeardownReleaseFenceRecord(
  raw: string | null,
  identity: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'>,
): ChatHardTeardownReleaseFenceRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChatHardTeardownReleaseFenceRecord>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.kind !== 'chat_hard_teardown_release_fence') return null;
    if (typeof parsed.streamId !== 'string') return null;
    return {
      kind: 'chat_hard_teardown_release_fence',
      workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : identity.workspaceId,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : identity.projectId,
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : identity.sessionId,
      streamId: parsed.streamId,
      releasedAt: typeof parsed.releasedAt === 'string' ? parsed.releasedAt : '',
      generation: typeof parsed.generation === 'number' && Number.isFinite(parsed.generation)
        ? parsed.generation
        : 0,
      ...(typeof parsed.attemptId === 'string' ? { attemptId: parsed.attemptId } : {}),
    };
  } catch {
    return null;
  }
}

function buildSessionHardTeardownAttemptId(input: {
  workspaceId: string;
  projectId: string;
  sessionId: string;
  streamId: string;
  generation: number;
  attemptedAt: string;
}): string {
  return [
    input.workspaceId,
    input.projectId,
    input.sessionId,
    input.streamId,
    input.generation,
    input.attemptedAt,
  ].join(':');
}

function getSessionHardTeardownGeneration(record: Pick<ChatSessionExecutionRecord, 'hardTeardownAttemptCount'>): number {
  return typeof record.hardTeardownAttemptCount === 'number' && Number.isFinite(record.hardTeardownAttemptCount)
    ? record.hardTeardownAttemptCount
    : 0;
}

function isSessionHardTeardownFenceForRecord(
  fence: ChatHardTeardownReleaseFenceRecord | null,
  record: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId' | 'streamId'>,
): fence is ChatHardTeardownReleaseFenceRecord {
  return Boolean(
    fence
    && fence.workspaceId === record.workspaceId
    && fence.projectId === record.projectId
    && fence.sessionId === record.sessionId
    && fence.streamId === record.streamId,
  );
}

function sessionHardTeardownFenceBlocksRecord(
  fence: ChatHardTeardownReleaseFenceRecord | null,
  record: ChatSessionExecutionRecord,
): boolean {
  return isSessionHardTeardownFenceForRecord(fence, record)
    && getSessionHardTeardownGeneration(record) <= fence.generation;
}

async function writeSessionHardTeardownDebtRecord(
  cache: CachePort,
  record: ChatSessionExecutionRecord,
): Promise<void> {
  if (!hasSessionHardTeardownDebt(record)) return;
  const key = sessionHardTeardownDebtKey(record.workspaceId, record.projectId, record.sessionId);
  const identity = {
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    sessionId: record.sessionId,
  };
  const nextRaw = serializeSessionExecutionRecord(record);
  for (let attempt = 0; attempt < SESSION_EXECUTION_CAS_MAX_ATTEMPTS; attempt += 1) {
    const currentRaw = await cache.get(key);
    const fence = parseSessionHardTeardownReleaseFenceRecord(currentRaw, identity);
    if (sessionHardTeardownFenceBlocksRecord(fence, record)) {
      return;
    }
    if (typeof cache.compareAndSet === 'function') {
      if (await cache.compareAndSet(key, currentRaw, nextRaw)) return;
      continue;
    }
    await cache.set(key, nextRaw);
    return;
  }
}

async function writeSessionHardTeardownReleaseFenceRecord(
  cache: CachePort,
  input: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId' | 'streamId'> & {
    releasedAt: string;
    attemptId?: string;
    generation?: number;
  },
): Promise<void> {
  const key = sessionHardTeardownDebtKey(input.workspaceId, input.projectId, input.sessionId);
  const identity = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
  };
  for (let attempt = 0; attempt < SESSION_EXECUTION_CAS_MAX_ATTEMPTS; attempt += 1) {
    const currentRaw = await cache.get(key);
    const currentDebt = parseSessionExecutionRecord(currentRaw, identity);
    if (currentDebt && currentDebt.streamId !== input.streamId) {
      return;
    }
    const currentFence = parseSessionHardTeardownReleaseFenceRecord(currentRaw, identity);
    const generation = Math.max(
      input.generation ?? 0,
      currentDebt && hasSessionHardTeardownDebt(currentDebt) ? getSessionHardTeardownGeneration(currentDebt) : 0,
      isSessionHardTeardownFenceForRecord(currentFence, input) ? currentFence.generation : 0,
    );
    const fence: ChatHardTeardownReleaseFenceRecord = {
      kind: 'chat_hard_teardown_release_fence',
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      streamId: input.streamId,
      releasedAt: input.releasedAt,
      generation,
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    };
    const nextRaw = JSON.stringify(fence);
    if (typeof cache.compareAndSet === 'function') {
      if (await cache.compareAndSet(key, currentRaw, nextRaw, STREAM_REGISTRY_FINAL_TTL_SECONDS)) return;
      continue;
    }
    await cache.set(key, nextRaw, STREAM_REGISTRY_FINAL_TTL_SECONDS);
    return;
  }
}

export async function readSessionExecutionRecord(
  cache: CachePort,
  workspaceId: string,
  projectId: string,
  sessionId: string,
): Promise<ChatSessionExecutionRecord | null> {
  const [primary, debt] = await Promise.all([
    readPrimarySessionExecutionRecord(cache, workspaceId, projectId, sessionId),
    readSessionHardTeardownDebtRecord(cache, workspaceId, projectId, sessionId),
  ]);
  return mergeSessionExecutionWithHardTeardownDebt(primary, debt);
}

export async function writeSessionExecutionRecord(
  cache: CachePort,
  record: ChatSessionExecutionRecord,
  ttlSeconds: number,
): Promise<void> {
  assertNoLegacySessionExecutionInput(record);
  const sanitized = sanitizeSessionExecutionRecord(record);
  await cache.set(
    sessionStreamStateKey(sanitized.workspaceId, sanitized.projectId, sanitized.sessionId),
    serializeSessionExecutionRecord(sanitized),
    ttlSeconds,
  );
  if (hasSessionHardTeardownDebt(sanitized)) {
    await writeSessionHardTeardownDebtRecord(cache, sanitized);
  }
}

function serializeSessionExecutionRecord(record: ChatSessionExecutionRecord): string {
  assertNoLegacySessionExecutionInput(record);
  return JSON.stringify(sanitizeSessionExecutionRecord(record));
}

function sanitizeSessionExecutionRecord(record: ChatSessionExecutionRecord): ChatSessionExecutionRecord {
  assertNoLegacySessionExecutionInput(record);
  return {
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    sessionId: record.sessionId,
    streamId: record.streamId,
    ownerInstanceId: record.ownerInstanceId,
    status: record.status,
    phase: record.phase,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    ...(typeof record.requestId === 'string' ? { requestId: record.requestId } : {}),
    ...(typeof record.endpointId === 'string' || record.endpointId === null ? { endpointId: record.endpointId } : {}),
    ...(typeof record.stopRequestedAt === 'string' ? { stopRequestedAt: record.stopRequestedAt } : {}),
    ...(typeof record.stopRequestedBy === 'string' ? { stopRequestedBy: record.stopRequestedBy } : {}),
    ...(record.stopReason === 'user_stop' || record.stopReason === 'session_stop'
      ? { stopReason: record.stopReason }
      : {}),
    ...(isStopMode(record.stopMode) ? { stopMode: record.stopMode } : {}),
    ...(isHardTeardownStatus(record.hardTeardownStatus)
      ? { hardTeardownStatus: record.hardTeardownStatus }
      : {}),
    ...(typeof record.hardTeardownRequestedAt === 'string'
      ? { hardTeardownRequestedAt: record.hardTeardownRequestedAt }
      : {}),
    ...(typeof record.hardTeardownLastAttemptAt === 'string'
      ? { hardTeardownLastAttemptAt: record.hardTeardownLastAttemptAt }
      : {}),
    ...(typeof record.hardTeardownLastError === 'string'
      ? { hardTeardownLastError: record.hardTeardownLastError }
      : {}),
    ...(typeof record.hardTeardownAttemptCount === 'number' && Number.isFinite(record.hardTeardownAttemptCount)
      ? { hardTeardownAttemptCount: record.hardTeardownAttemptCount }
      : {}),
    ...(typeof record.hardTeardownAttemptId === 'string'
      ? { hardTeardownAttemptId: record.hardTeardownAttemptId }
      : {}),
    ...(record.stopEscalationReason === 'STOP_ESCALATION_UNAVAILABLE'
      ? { stopEscalationReason: record.stopEscalationReason }
      : {}),
  };
}

async function withLocalSessionExecutionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionExecutionLocalLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const lock = run.then(() => undefined, () => undefined);
  sessionExecutionLocalLocks.set(key, lock);
  try {
    return await run;
  } finally {
    if (sessionExecutionLocalLocks.get(key) === lock) {
      sessionExecutionLocalLocks.delete(key);
    }
  }
}

export async function beginSessionExecution(
  cache: CachePort,
  input: Omit<ChatSessionExecutionRecord, 'status' | 'phase' | 'ownerInstanceId' | 'updatedAt'> & {
    ownerInstanceId?: string;
    updatedAt?: string;
  },
  ttlSeconds: number,
): Promise<ChatSessionExecutionRecord | null> {
  assertNoLegacySessionExecutionInput(input);
  const record: ChatSessionExecutionRecord = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    streamId: input.streamId,
    ownerInstanceId: input.ownerInstanceId?.trim() || CHAT_EXECUTION_OWNER_INSTANCE_ID,
    status: 'running',
    phase: 'bootstrapping',
    startedAt: input.startedAt,
    updatedAt: input.updatedAt ?? input.startedAt,
    ...(typeof input.requestId === 'string' ? { requestId: input.requestId } : {}),
    ...(input.endpointId !== undefined ? { endpointId: input.endpointId } : {}),
  };
  const key = sessionStreamStateKey(input.workspaceId, input.projectId, input.sessionId);
  const identity = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
  };

  const writeIfUnblocked = async (): Promise<ChatSessionExecutionRecord | null> => {
    const currentRaw = await cache.get(key);
    const current = mergeSessionExecutionWithHardTeardownDebt(
      parseSessionExecutionRecord(currentRaw, identity),
      await readSessionHardTeardownDebtRecord(cache, input.workspaceId, input.projectId, input.sessionId),
    );
    if (blocksNewSessionExecution(current)) {
      return null;
    }
    await cache.set(key, serializeSessionExecutionRecord(record), ttlSeconds);
    return record;
  };

  if (typeof cache.compareAndSet !== 'function') {
    return withLocalSessionExecutionLock(key, writeIfUnblocked);
  }

  for (let attempt = 0; attempt < SESSION_EXECUTION_CAS_MAX_ATTEMPTS; attempt += 1) {
    const currentRaw = await cache.get(key);
    const current = mergeSessionExecutionWithHardTeardownDebt(
      parseSessionExecutionRecord(currentRaw, identity),
      await readSessionHardTeardownDebtRecord(cache, input.workspaceId, input.projectId, input.sessionId),
    );
    if (blocksNewSessionExecution(current)) {
      return null;
    }
    const committed = await cache.compareAndSet(
      key,
      currentRaw,
      serializeSessionExecutionRecord(record),
      ttlSeconds,
    );
    if (committed) return record;
  }

  return null;
}

export async function patchSessionExecutionRecord(
  cache: CachePort,
  identity: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'>,
  mutate: (current: ChatSessionExecutionRecord | null) => ChatSessionExecutionRecord | null,
  ttlSeconds: number,
): Promise<ChatSessionExecutionRecord | null> {
  const key = sessionStreamStateKey(identity.workspaceId, identity.projectId, identity.sessionId);
  const mutateOnce = async (): Promise<ChatSessionExecutionRecord | null> => {
    const currentRaw = await cache.get(key);
    const current = mergeSessionExecutionWithHardTeardownDebt(
      parseSessionExecutionRecord(currentRaw, identity),
      await readSessionHardTeardownDebtRecord(cache, identity.workspaceId, identity.projectId, identity.sessionId),
    );
    const next = mutate(current);
    if (!next) return null;
    const sanitizedNext = sanitizeSessionExecutionRecord(next);
    await cache.set(key, serializeSessionExecutionRecord(sanitizedNext), ttlSeconds);
    if (hasSessionHardTeardownDebt(sanitizedNext)) {
      await writeSessionHardTeardownDebtRecord(cache, sanitizedNext);
    }
    return sanitizedNext;
  };

  if (typeof cache.compareAndSet !== 'function') {
    return withLocalSessionExecutionLock(key, mutateOnce);
  }

  for (let attempt = 0; attempt < SESSION_EXECUTION_CAS_MAX_ATTEMPTS; attempt += 1) {
    const currentRaw = await cache.get(key);
    const current = mergeSessionExecutionWithHardTeardownDebt(
      parseSessionExecutionRecord(currentRaw, identity),
      await readSessionHardTeardownDebtRecord(cache, identity.workspaceId, identity.projectId, identity.sessionId),
    );
    const next = mutate(current);
    if (!next) return null;
    const sanitizedNext = sanitizeSessionExecutionRecord(next);
    const committed = await cache.compareAndSet(
      key,
      currentRaw,
      serializeSessionExecutionRecord(sanitizedNext),
      ttlSeconds,
    );
    if (committed) {
      if (hasSessionHardTeardownDebt(sanitizedNext)) {
        await writeSessionHardTeardownDebtRecord(cache, sanitizedNext);
      }
      return sanitizedNext;
    }
  }

  return readSessionExecutionRecord(cache, identity.workspaceId, identity.projectId, identity.sessionId);
}

export async function markSessionExecutionPhase(
  cache: CachePort,
  input: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'> & {
    phase: ChatSessionExecutionPhase;
    requestId?: string;
    updatedAt?: string;
  },
  ttlSeconds: number,
): Promise<ChatSessionExecutionRecord | null> {
  assertNoLegacySessionExecutionInput(input);
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
      };
    },
    ttlSeconds,
  );
}

export async function requestSessionExecutionStop(
  cache: CachePort,
  input: ChatSessionExecutionStopInput,
): Promise<ChatSessionExecutionRecord | null> {
  const transition = await requestSessionExecutionStopTransition(cache, input);
  return transition.record;
}

function resolveSessionExecutionStopTransition(
  current: ChatSessionExecutionRecord | null,
  input: ChatSessionExecutionStopInput,
): ChatSessionExecutionStopTransitionResult & { next: ChatSessionExecutionRecord | null } {
  if (!current) {
    return {
      record: null,
      previous: null,
      changed: false,
      hardTeardownRequired: false,
      hardTeardownDispatchRequired: false,
      next: null,
    };
  }
  const currentHardTeardownStatus = current.hardTeardownStatus;
  const terminalStatus = isTerminalSessionExecutionStatus(current.status);
  const terminalHardTeardownDebt = terminalStatus
    && current.stopMode === 'terminate'
    && isHardTeardownStatus(currentHardTeardownStatus);
  if (terminalStatus && !terminalHardTeardownDebt) {
    return {
      record: null,
      previous: current,
      changed: false,
      hardTeardownRequired: false,
      hardTeardownDispatchRequired: false,
      next: null,
    };
  }

  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const requestedStopMode = input.stopMode ?? 'cancel';
  const effectiveStopMode = current.stopMode === 'terminate' || requestedStopMode === 'terminate'
    ? 'terminate'
    : 'cancel';
  const existingTerminateStop = current.stopMode === 'terminate';
  const existingHardTeardownDebt = isHardTeardownStatus(currentHardTeardownStatus);
  const hardTeardownRequired = effectiveStopMode === 'terminate'
    && (
      terminalHardTeardownDebt
      || (
        currentHardTeardownStatus !== 'requested'
        && (
          !existingTerminateStop
          || existingHardTeardownDebt
        )
      )
    );
  const hardTeardownDispatchRequired = hardTeardownRequired;
  if (effectiveStopMode === 'terminate' && currentHardTeardownStatus === 'pending') {
    return {
      record: current,
      previous: current,
      changed: false,
      hardTeardownRequired,
      hardTeardownDispatchRequired,
      next: current,
    };
  }
  const next: ChatSessionExecutionRecord = {
    ...current,
    status: terminalHardTeardownDebt
      ? current.status
      : effectiveStopMode === 'terminate' ? 'terminating' : 'stopping',
    updatedAt,
    stopRequestedAt: current.stopRequestedAt ?? input.updatedAt ?? updatedAt,
    ...(typeof input.requestedBy === 'string' ? { stopRequestedBy: input.requestedBy } : {}),
    stopReason: input.stopReason,
    stopMode: effectiveStopMode,
    ...(effectiveStopMode === 'cancel' && (input.stopEscalationReason ?? current.stopEscalationReason)
      ? { stopEscalationReason: input.stopEscalationReason ?? current.stopEscalationReason }
      : {}),
  };
  if (effectiveStopMode === 'terminate') {
    if (currentHardTeardownStatus === 'requested' && !terminalHardTeardownDebt) {
      next.hardTeardownStatus = 'requested';
      if (current.hardTeardownRequestedAt) {
        next.hardTeardownRequestedAt = current.hardTeardownRequestedAt;
      }
    } else if (hardTeardownRequired) {
      next.hardTeardownStatus = 'pending';
      delete next.hardTeardownRequestedAt;
    } else {
      delete next.hardTeardownStatus;
      delete next.hardTeardownRequestedAt;
    }
    delete next.stopEscalationReason;
  }

  return {
    record: next,
    previous: current,
    changed: true,
    hardTeardownRequired,
    hardTeardownDispatchRequired,
    next,
  };
}

export async function requestSessionExecutionStopTransition(
  cache: CachePort,
  input: ChatSessionExecutionStopInput,
): Promise<ChatSessionExecutionStopTransitionResult> {
  const key = sessionStreamStateKey(input.workspaceId, input.projectId, input.sessionId);
  const identity = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
  };
  const mutateOnce = async (): Promise<ChatSessionExecutionStopTransitionResult> => {
    const currentRaw = await cache.get(key);
    const current = mergeSessionExecutionWithHardTeardownDebt(
      parseSessionExecutionRecord(currentRaw, identity),
      await readSessionHardTeardownDebtRecord(cache, input.workspaceId, input.projectId, input.sessionId),
    );
    const transition = resolveSessionExecutionStopTransition(current, input);
    if (!transition.next) return transition;
    const sanitizedNext = sanitizeSessionExecutionRecord(transition.next);
    await cache.set(key, serializeSessionExecutionRecord(sanitizedNext), STREAM_REGISTRY_TTL_SECONDS);
    if (hasSessionHardTeardownDebt(sanitizedNext)) {
      await writeSessionHardTeardownDebtRecord(cache, sanitizedNext);
    }
    return {
      record: sanitizedNext,
      previous: transition.previous,
      changed: transition.changed,
      hardTeardownRequired: transition.hardTeardownRequired,
      hardTeardownDispatchRequired: transition.hardTeardownDispatchRequired,
    };
  };

  if (typeof cache.compareAndSet !== 'function') {
    return withLocalSessionExecutionLock(key, mutateOnce);
  }

  for (let attempt = 0; attempt < SESSION_EXECUTION_CAS_MAX_ATTEMPTS; attempt += 1) {
    const currentRaw = await cache.get(key);
    const current = mergeSessionExecutionWithHardTeardownDebt(
      parseSessionExecutionRecord(currentRaw, identity),
      await readSessionHardTeardownDebtRecord(cache, input.workspaceId, input.projectId, input.sessionId),
    );
    const transition = resolveSessionExecutionStopTransition(current, input);
    if (!transition.next) return transition;
    const sanitizedNext = sanitizeSessionExecutionRecord(transition.next);
    const committed = await cache.compareAndSet(
      key,
      currentRaw,
      serializeSessionExecutionRecord(sanitizedNext),
      STREAM_REGISTRY_TTL_SECONDS,
    );
    if (committed) {
      if (hasSessionHardTeardownDebt(sanitizedNext)) {
        await writeSessionHardTeardownDebtRecord(cache, sanitizedNext);
      }
      return {
        record: sanitizedNext,
        previous: transition.previous,
        changed: transition.changed,
        hardTeardownRequired: transition.hardTeardownRequired,
        hardTeardownDispatchRequired: transition.hardTeardownDispatchRequired,
      };
    }
  }

  const latest = await readSessionExecutionRecord(cache, input.workspaceId, input.projectId, input.sessionId);
  const transition = resolveSessionExecutionStopTransition(latest, input);
  return {
    record: transition.record,
    previous: transition.previous,
    changed: false,
    hardTeardownRequired: transition.hardTeardownRequired,
    hardTeardownDispatchRequired: transition.hardTeardownDispatchRequired,
  };
}

export async function markSessionHardTeardownRequested(
  cache: CachePort,
  input: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'> & {
    requestedAt: string;
    streamId?: string;
  },
): Promise<ChatSessionExecutionRecord | null> {
  if (input.streamId) {
    const fence = parseSessionHardTeardownReleaseFenceRecord(
      await cache.get(sessionHardTeardownDebtKey(input.workspaceId, input.projectId, input.sessionId)),
      input,
    );
    if (fence?.streamId === input.streamId) {
      return readSessionExecutionRecord(cache, input.workspaceId, input.projectId, input.sessionId);
    }
  }
  return patchSessionExecutionRecord(
    cache,
    input,
    (current) => {
      if (!current || current.stopMode !== 'terminate') return current;
      if (input.streamId && current.streamId !== input.streamId) return current;
      const generation = getSessionHardTeardownGeneration(current) + 1;
      const streamId = current.streamId || input.streamId || '';
      const next: ChatSessionExecutionRecord = {
        ...current,
        hardTeardownStatus: 'requested',
        hardTeardownRequestedAt: input.requestedAt,
        hardTeardownLastAttemptAt: input.requestedAt,
        hardTeardownAttemptCount: generation,
        hardTeardownAttemptId: buildSessionHardTeardownAttemptId({
          workspaceId: current.workspaceId,
          projectId: current.projectId,
          sessionId: current.sessionId,
          streamId,
          generation,
          attemptedAt: input.requestedAt,
        }),
        updatedAt: input.requestedAt,
      };
      delete next.hardTeardownLastError;
      return next;
    },
    STREAM_REGISTRY_TTL_SECONDS,
  );
}

export async function markSessionHardTeardownReleased(
  cache: CachePort,
  input: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'> & {
    releasedAt: string;
    streamId?: string;
    attemptId?: string;
    generation?: number;
  },
): Promise<ChatSessionExecutionRecord | null> {
  const current = await readSessionExecutionRecord(cache, input.workspaceId, input.projectId, input.sessionId);
  const streamId = input.streamId ?? current?.streamId ?? '';
  if (streamId) {
    await writeSessionHardTeardownReleaseFenceRecord(cache, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      streamId,
      releasedAt: input.releasedAt,
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      ...(typeof input.generation === 'number' ? { generation: input.generation } : {}),
    });
  }
  return patchSessionExecutionRecord(
    cache,
    input,
    (current) => {
      if (!current || current.stopMode !== 'terminate') return current;
      if (input.streamId && current.streamId !== input.streamId) return current;
      const next: ChatSessionExecutionRecord = {
        ...current,
        updatedAt: input.releasedAt,
      };
      delete next.hardTeardownStatus;
      delete next.hardTeardownRequestedAt;
      delete next.hardTeardownLastAttemptAt;
      delete next.hardTeardownLastError;
      delete next.hardTeardownAttemptCount;
      delete next.hardTeardownAttemptId;
      return next;
    },
    STREAM_REGISTRY_FINAL_TTL_SECONDS,
  );
}

export async function markSessionHardTeardownFailed(
  cache: CachePort,
  input: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'> & {
    attemptedAt: string;
    errorMessage: string;
    streamId?: string;
    attemptId?: string;
    generation?: number;
  },
): Promise<ChatSessionExecutionRecord | null> {
  if (input.streamId && input.attemptId) {
    const fence = parseSessionHardTeardownReleaseFenceRecord(
      await cache.get(sessionHardTeardownDebtKey(input.workspaceId, input.projectId, input.sessionId)),
      input,
    );
    if (
      fence?.streamId === input.streamId
      && (input.generation ?? 0) <= fence.generation
    ) {
      return readSessionExecutionRecord(cache, input.workspaceId, input.projectId, input.sessionId);
    }
  }
  return patchSessionExecutionRecord(
    cache,
    input,
    (current) => {
      if (!current || current.stopMode !== 'terminate') return current;
      if (input.streamId && current.streamId !== input.streamId) return current;
      if (input.attemptId && current.hardTeardownAttemptId !== input.attemptId) return current;
      const generation = input.generation
        ?? (getSessionHardTeardownGeneration(current) || (current.hardTeardownAttemptCount ?? 0) + 1);
      const next: ChatSessionExecutionRecord = {
        ...current,
        hardTeardownStatus: 'failed',
        hardTeardownLastAttemptAt: input.attemptedAt,
        hardTeardownLastError: input.errorMessage,
        hardTeardownAttemptCount: generation,
        ...(input.attemptId ?? current.hardTeardownAttemptId
          ? { hardTeardownAttemptId: input.attemptId ?? current.hardTeardownAttemptId }
          : {}),
        updatedAt: input.attemptedAt,
      };
      delete next.hardTeardownRequestedAt;
      return next;
    },
    STREAM_REGISTRY_TTL_SECONDS,
  );
}

export async function finalizeSessionExecution(
  cache: CachePort,
  input: Pick<ChatSessionExecutionRecord, 'workspaceId' | 'projectId' | 'sessionId'> & {
    streamId?: string;
    status: 'completed' | 'stopped' | 'failed';
    endpointId?: string | null;
    requestId?: string;
    startedAt?: string;
    updatedAt?: string;
    stopReason?: 'user_stop' | 'session_stop';
  },
): Promise<ChatSessionExecutionRecord> {
  assertNoLegacySessionExecutionInput(input);
  const current = await readSessionExecutionRecord(cache, input.workspaceId, input.projectId, input.sessionId);
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const next: ChatSessionExecutionRecord = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    streamId: current?.streamId ?? input.streamId ?? '',
    ownerInstanceId: current?.ownerInstanceId ?? CHAT_EXECUTION_OWNER_INSTANCE_ID,
    status: input.status,
    phase: 'terminal',
    startedAt: current?.startedAt ?? input.startedAt ?? updatedAt,
    updatedAt,
    ...(current?.requestId ?? input.requestId ? { requestId: current?.requestId ?? input.requestId } : {}),
    ...(current?.endpointId !== undefined || input.endpointId !== undefined
      ? { endpointId: current?.endpointId ?? input.endpointId ?? null }
      : {}),
    ...(current?.stopRequestedAt ? { stopRequestedAt: current.stopRequestedAt } : {}),
    ...(current?.stopRequestedBy ? { stopRequestedBy: current.stopRequestedBy } : {}),
    ...(current?.stopReason || input.stopReason ? { stopReason: current?.stopReason ?? input.stopReason } : {}),
    ...(current?.stopMode ? { stopMode: current.stopMode } : {}),
    ...(current?.hardTeardownStatus
      ? { hardTeardownStatus: current.hardTeardownStatus }
      : {}),
    ...(current?.hardTeardownStatus && current.hardTeardownRequestedAt
      ? { hardTeardownRequestedAt: current.hardTeardownRequestedAt }
      : {}),
    ...(current?.hardTeardownStatus && current.hardTeardownLastAttemptAt
      ? { hardTeardownLastAttemptAt: current.hardTeardownLastAttemptAt }
      : {}),
    ...(current?.hardTeardownStatus && current.hardTeardownLastError
      ? { hardTeardownLastError: current.hardTeardownLastError }
      : {}),
    ...(current?.hardTeardownStatus && typeof current?.hardTeardownAttemptCount === 'number'
      ? { hardTeardownAttemptCount: current.hardTeardownAttemptCount }
      : {}),
    ...(current?.hardTeardownStatus && current?.hardTeardownAttemptId
      ? { hardTeardownAttemptId: current.hardTeardownAttemptId }
      : {}),
    ...(current?.stopEscalationReason ? { stopEscalationReason: current.stopEscalationReason } : {}),
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
  options?: {
    requestedBy?: string;
    stopReason?: 'user_stop' | 'session_stop';
    stopMode?: ChatStopMode;
    stopEscalationReason?: ChatStopEscalationReason;
  },
): Promise<number> {
  const stopMode = options?.stopMode ?? 'cancel';
  const stopReason = options?.stopReason ?? 'session_stop';
  const requestedExecution = await requestSessionExecutionStop(cache, {
    workspaceId,
    projectId,
    sessionId,
    ...(typeof options?.requestedBy === 'string' ? { requestedBy: options.requestedBy } : {}),
    stopReason,
    stopMode,
    ...(options?.stopEscalationReason ? { stopEscalationReason: options.stopEscalationReason } : {}),
  });
  let stopped = 0;
  const activeStatus = stopMode === 'terminate' ? 'terminating' : 'stopping';
  for (const [streamId, stream] of ACTIVE_CHAT_STREAMS.entries()) {
    if (stream.workspaceId !== workspaceId || stream.projectId !== projectId || stream.sessionId !== sessionId) {
      continue;
    }
    stopped += 1;
    stream.status = activeStatus;
    stream.stopReason = stopReason;
    stream.abortController.abort();
    await writeStreamRegistry(
      cache,
      {
        streamId,
        workspaceId,
        projectId,
        sessionId,
        status: activeStatus,
        updatedAt: new Date().toISOString(),
      },
      STREAM_REGISTRY_TTL_SECONDS,
    );
  }
  if (stopped > 0 && !requestedExecution) {
    const existing = await readSessionExecutionRecord(cache, workspaceId, projectId, sessionId);
    if (!existing) {
      await writeSessionStreamState(cache, workspaceId, projectId, sessionId, activeStatus, STREAM_REGISTRY_TTL_SECONDS);
    }
  }
  return stopped;
}

export function listActiveSessionStreams(
  workspaceId: string,
  projectId: string,
  sessionId: string,
): Array<{ streamId: string; status: 'running' | 'stopping' | 'terminating'; startedAt: string }> {
  return Array.from(ACTIVE_CHAT_STREAMS.entries())
    .filter(([, stream]) =>
      stream.workspaceId === workspaceId &&
      stream.projectId === projectId &&
      stream.sessionId === sessionId &&
      (stream.status === 'running' || stream.status === 'stopping' || stream.status === 'terminating'))
    .map(([streamId, stream]) => ({
      streamId,
      status: stream.status === 'running' ? 'running' : stream.status === 'terminating' ? 'terminating' : 'stopping',
      startedAt: stream.startedAt,
    }));
}
