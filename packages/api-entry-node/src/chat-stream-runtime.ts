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

export const ACTIVE_CHAT_STREAMS = new Map<string, ActiveChatStreamRecord>();
export const STREAM_REGISTRY_TTL_SECONDS = 30 * 60;
export const STREAM_REGISTRY_FINAL_TTL_SECONDS = 5 * 60;

type SessionStreamRuntimeStatus = 'running' | 'stopping' | 'completed' | 'stopped' | 'failed';

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
): Promise<SessionStreamRuntimeStatus | null> {
  const raw = await cache.get(sessionStreamStateKey(workspaceId, projectId, sessionId));
  if (
    raw === 'running' ||
    raw === 'stopping' ||
    raw === 'completed' ||
    raw === 'stopped' ||
    raw === 'failed'
  ) {
    return raw;
  }
  return null;
}

export async function writeSessionStreamState(
  cache: CachePort,
  workspaceId: string,
  projectId: string,
  sessionId: string,
  status: SessionStreamRuntimeStatus,
  ttlSeconds: number,
): Promise<void> {
  await cache.set(sessionStreamStateKey(workspaceId, projectId, sessionId), status, ttlSeconds);
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
      status: stream.status,
      startedAt: stream.startedAt,
    }));
}
