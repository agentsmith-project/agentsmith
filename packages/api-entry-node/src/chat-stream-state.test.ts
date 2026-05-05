import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';
import {
  ACTIVE_CHAT_STREAMS,
  beginSessionExecution,
  markSessionHardTeardownFailed,
  markSessionHardTeardownRequested,
  markSessionHardTeardownReleased,
  readSessionExecutionRecord,
  readSessionStreamState,
  requestSessionExecutionStop,
  requestSessionExecutionStopTransition,
  stopActiveSessionStreams,
  writeSessionExecutionRecord,
  writeSessionStreamState,
} from './chat-stream-state.js';

class SessionExecutionReadBarrierCache extends InMemoryCache {
  private blockedReads = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly barrierReadCount: number) {
    super();
  }

  override async get(key: string): Promise<string | null> {
    if (key.startsWith('chat:session-stream:') && this.blockedReads < this.barrierReadCount) {
      this.blockedReads += 1;
      if (this.blockedReads >= this.barrierReadCount) {
        for (const resolve of this.waiters.splice(0)) resolve();
      } else {
        await new Promise<void>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    }
    return super.get(key);
  }
}

afterEach(() => {
  ACTIVE_CHAT_STREAMS.clear();
  vi.useRealTimers();
});

describe('chat session execution record', () => {
  it('rejects raw string session state instead of parsing legacy status compatibility', async () => {
    const cache = new InMemoryCache();

    await cache.set('chat:session-stream:ws_raw_string:proj_raw_string:sess_raw_string', 'running', 60);

    await expect(readSessionStreamState(cache, 'ws_raw_string', 'proj_raw_string', 'sess_raw_string')).resolves.toBeNull();
    await expect(readSessionExecutionRecord(
      cache,
      'ws_raw_string',
      'proj_raw_string',
      'sess_raw_string',
    )).resolves.toBeNull();
  });

  it('writes session stream state as canonical structured execution truth', async () => {
    const cache = new InMemoryCache();

    await writeSessionStreamState(cache, 'ws_state', 'proj_state', 'sess_state', 'running', 60);

    const raw = await cache.get('chat:session-stream:ws_state:proj_state:sess_state');
    expect(raw).toContain('"status":"running"');
    expect(raw).not.toBe('running');
    await expect(readSessionStreamState(cache, 'ws_state', 'proj_state', 'sess_state')).resolves.toBe('running');
    await expect(readSessionExecutionRecord(cache, 'ws_state', 'proj_state', 'sess_state')).resolves.toMatchObject({
      workspaceId: 'ws_state',
      projectId: 'proj_state',
      sessionId: 'sess_state',
      status: 'running',
      phase: 'streaming',
    });
  });

  it('rejects legacy runner fields from structured state reads and writes', async () => {
    const cache = new InMemoryCache();

    await cache.set(
      'chat:session-stream:ws_legacy_shape:proj_legacy_shape:sess_legacy_shape',
      JSON.stringify({
        workspaceId: 'ws_legacy_shape',
        projectId: 'proj_legacy_shape',
        sessionId: 'sess_legacy_shape',
        streamId: 'stream_legacy_shape',
        ownerInstanceId: 'api-test',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        endpointId: 'ep_legacy_shape',
        externalAgentId: 'agent_legacy_shape',
      }),
      60,
    );

    const parsed = await readSessionExecutionRecord(
      cache,
      'ws_legacy_shape',
      'proj_legacy_shape',
      'sess_legacy_shape',
    );
    expect(parsed).toBeNull();

    await expect(writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_clean_write',
        projectId: 'proj_clean_write',
        sessionId: 'sess_clean_write',
        streamId: 'stream_clean_write',
        ownerInstanceId: 'api-test',
        transport: 'agent_runner',
        internalAgent: true,
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        endpointId: 'ep_clean_write',
        externalAgentId: 'agent_clean_write',
      } as never,
      60,
    )).rejects.toThrowError('chat_session_execution_legacy_field');

    const storedRaw = await cache.get('chat:session-stream:ws_clean_write:proj_clean_write:sess_clean_write');
    expect(storedRaw).toBeNull();
  });

  it('rejects legacy external agent endpoint ids instead of normalizing them', async () => {
    const cache = new InMemoryCache();

    await expect(writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_agent_endpoint',
        projectId: 'proj_agent_endpoint',
        sessionId: 'sess_agent_endpoint',
        streamId: 'stream_agent_endpoint',
        ownerInstanceId: 'api-test',
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
        endpointId: 'agent:agent_legacy',
      },
      60,
    )).rejects.toThrowError('chat_session_execution_legacy_field');
  });

  it('rejects legacy runner fields on begin execution inputs', async () => {
    const cache = new InMemoryCache();

    await expect(beginSessionExecution(
      cache,
      {
        workspaceId: 'ws_begin_legacy',
        projectId: 'proj_begin_legacy',
        sessionId: 'sess_begin_legacy',
        streamId: 'stream_begin_legacy',
        startedAt: '2026-04-23T12:00:00.000Z',
        transport: 'agent_runner',
      } as never,
      60,
    )).rejects.toThrowError('chat_session_execution_legacy_field');
  });

  it('persists and reads the structured session execution record', async () => {
    const cache = new InMemoryCache();

    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_record',
        projectId: 'proj_record',
        sessionId: 'sess_record',
        streamId: 'stream_record',
        ownerInstanceId: 'api-test',
        status: 'stopping',
        phase: 'dispatching',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:01.000Z',
        requestId: 'req_record',
        endpointId: 'ep_record',
        stopRequestedAt: '2026-04-23T12:00:01.000Z',
        stopReason: 'session_stop',
      },
      60,
    );

    await expect(readSessionExecutionRecord(cache, 'ws_record', 'proj_record', 'sess_record')).resolves.toEqual({
      workspaceId: 'ws_record',
      projectId: 'proj_record',
      sessionId: 'sess_record',
      streamId: 'stream_record',
      ownerInstanceId: 'api-test',
      status: 'stopping',
      phase: 'dispatching',
      startedAt: '2026-04-23T12:00:00.000Z',
      updatedAt: '2026-04-23T12:00:01.000Z',
      requestId: 'req_record',
      endpointId: 'ep_record',
      stopRequestedAt: '2026-04-23T12:00:01.000Z',
      stopReason: 'session_stop',
    });
    await expect(readSessionStreamState(cache, 'ws_record', 'proj_record', 'sess_record')).resolves.toBe('stopping');
  });

  it('keeps terminate authoritative when a later cancel stop is requested', async () => {
    const cache = new InMemoryCache();

    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_terminate',
        projectId: 'proj_terminate',
        sessionId: 'sess_terminate',
        streamId: 'stream_terminate',
        ownerInstanceId: 'api-test',
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
      },
      60,
    );

    await expect(requestSessionExecutionStop(cache, {
      workspaceId: 'ws_terminate',
      projectId: 'proj_terminate',
      sessionId: 'sess_terminate',
      requestedBy: 'user_terminate',
      stopReason: 'session_stop',
      stopMode: 'terminate',
      updatedAt: '2026-04-23T12:00:01.000Z',
    })).resolves.toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
      hardTeardownStatus: 'pending',
    });

    await expect(requestSessionExecutionStop(cache, {
      workspaceId: 'ws_terminate',
      projectId: 'proj_terminate',
      sessionId: 'sess_terminate',
      requestedBy: 'user_terminate',
      stopReason: 'session_stop',
      stopMode: 'cancel',
      updatedAt: '2026-04-23T12:00:02.000Z',
    })).resolves.toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
      hardTeardownStatus: 'pending',
    });
    await expect(readSessionStreamState(cache, 'ws_terminate', 'proj_terminate', 'sess_terminate')).resolves.toBe('terminating');
  });

  it('keeps hard teardown pending and retryable for concurrent terminate stop transitions', async () => {
    const cache = new SessionExecutionReadBarrierCache(2);

    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_terminate_cas',
        projectId: 'proj_terminate_cas',
        sessionId: 'sess_terminate_cas',
        streamId: 'stream_terminate_cas',
        ownerInstanceId: 'api-test',
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
      },
      60,
    );

    const [first, second] = await Promise.all([
      requestSessionExecutionStopTransition(cache, {
        workspaceId: 'ws_terminate_cas',
        projectId: 'proj_terminate_cas',
        sessionId: 'sess_terminate_cas',
        requestedBy: 'user_terminate_cas',
        stopReason: 'session_stop',
        stopMode: 'terminate',
        updatedAt: '2026-04-23T12:00:01.000Z',
      }),
      requestSessionExecutionStopTransition(cache, {
        workspaceId: 'ws_terminate_cas',
        projectId: 'proj_terminate_cas',
        sessionId: 'sess_terminate_cas',
        requestedBy: 'user_terminate_cas',
        stopReason: 'session_stop',
        stopMode: 'terminate',
        updatedAt: '2026-04-23T12:00:02.000Z',
      }),
    ]);

    expect(first.hardTeardownRequired).toBe(true);
    expect(second.hardTeardownRequired).toBe(true);
    await expect(readSessionExecutionRecord(
      cache,
      'ws_terminate_cas',
      'proj_terminate_cas',
      'sess_terminate_cas',
    )).resolves.toMatchObject({
      status: 'terminating',
      stopMode: 'terminate',
      hardTeardownStatus: 'pending',
    });
  });

  it('keeps terminal hard teardown debt retryable without resurrecting active execution status', async () => {
    const cache = new InMemoryCache();

    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_terminal_debt',
        projectId: 'proj_terminal_debt',
        sessionId: 'sess_terminal_debt',
        streamId: 'stream_terminal_debt',
        ownerInstanceId: 'api-test',
        status: 'stopped',
        phase: 'terminal',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:05.000Z',
        stopMode: 'terminate',
        stopReason: 'session_stop',
        hardTeardownStatus: 'failed',
        hardTeardownLastAttemptAt: '2026-04-23T12:00:05.000Z',
        hardTeardownLastError: 'release pod failed after terminal',
        hardTeardownAttemptCount: 1,
      },
      60,
    );

    await expect(requestSessionExecutionStopTransition(cache, {
      workspaceId: 'ws_terminal_debt',
      projectId: 'proj_terminal_debt',
      sessionId: 'sess_terminal_debt',
      requestedBy: 'user_terminal_debt',
      stopReason: 'session_stop',
      stopMode: 'terminate',
      updatedAt: '2026-04-23T12:00:06.000Z',
    })).resolves.toMatchObject({
      hardTeardownRequired: true,
      record: {
        status: 'stopped',
        phase: 'terminal',
        stopMode: 'terminate',
        hardTeardownStatus: 'pending',
        hardTeardownLastError: 'release pod failed after terminal',
      },
    });

    await expect(readSessionExecutionRecord(
      cache,
      'ws_terminal_debt',
      'proj_terminal_debt',
      'sess_terminal_debt',
    )).resolves.toMatchObject({
      status: 'stopped',
      phase: 'terminal',
      stopMode: 'terminate',
      hardTeardownStatus: 'pending',
    });
  });

  it('treats terminal requested hard teardown debt as retryable instead of finished truth', async () => {
    const cache = new InMemoryCache();

    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_terminal_requested_debt',
        projectId: 'proj_terminal_requested_debt',
        sessionId: 'sess_terminal_requested_debt',
        streamId: 'stream_terminal_requested_debt',
        ownerInstanceId: 'api-test',
        status: 'stopped',
        phase: 'terminal',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:05.000Z',
        stopMode: 'terminate',
        stopReason: 'session_stop',
        hardTeardownStatus: 'requested',
        hardTeardownRequestedAt: '2026-04-23T12:00:05.000Z',
      },
      60,
    );

    await expect(requestSessionExecutionStopTransition(cache, {
      workspaceId: 'ws_terminal_requested_debt',
      projectId: 'proj_terminal_requested_debt',
      sessionId: 'sess_terminal_requested_debt',
      requestedBy: 'user_terminal_requested_debt',
      stopReason: 'session_stop',
      stopMode: 'terminate',
      updatedAt: '2026-04-23T12:00:06.000Z',
    })).resolves.toMatchObject({
      hardTeardownRequired: true,
      record: {
        status: 'stopped',
        phase: 'terminal',
        stopMode: 'terminate',
        hardTeardownStatus: 'pending',
      },
    });
  });

  it('keeps hard teardown debt authoritative after the stream registry TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T12:30:00.000Z'));
    const cache = new InMemoryCache();

    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_ttl_debt',
        projectId: 'proj_ttl_debt',
        sessionId: 'sess_ttl_debt',
        streamId: 'stream_ttl_debt',
        ownerInstanceId: 'api-test',
        status: 'stopped',
        phase: 'terminal',
        startedAt: '2026-04-23T12:30:00.000Z',
        updatedAt: '2026-04-23T12:30:01.000Z',
        stopMode: 'terminate',
        stopReason: 'session_stop',
        hardTeardownStatus: 'failed',
        hardTeardownLastAttemptAt: '2026-04-23T12:30:01.000Z',
        hardTeardownLastError: 'release failed before ttl expiry',
        hardTeardownAttemptCount: 1,
      },
      1,
    );

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(readSessionExecutionRecord(
      cache,
      'ws_ttl_debt',
      'proj_ttl_debt',
      'sess_ttl_debt',
    )).resolves.toMatchObject({
      status: 'stopped',
      phase: 'terminal',
      stopMode: 'terminate',
      hardTeardownStatus: 'failed',
      hardTeardownLastError: 'release failed before ttl expiry',
    });
    await expect(beginSessionExecution(
      cache,
      {
        workspaceId: 'ws_ttl_debt',
        projectId: 'proj_ttl_debt',
        sessionId: 'sess_ttl_debt',
        streamId: 'stream_after_ttl',
        startedAt: '2026-04-23T12:30:03.000Z',
      },
      60,
    )).resolves.toBeNull();
  });

  it('clears terminal hard teardown debt only after real release succeeds', async () => {
    const cache = new InMemoryCache();

    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_release_debt',
        projectId: 'proj_release_debt',
        sessionId: 'sess_release_debt',
        streamId: 'stream_release_debt',
        ownerInstanceId: 'api-test',
        status: 'stopped',
        phase: 'terminal',
        startedAt: '2026-04-23T12:40:00.000Z',
        updatedAt: '2026-04-23T12:40:01.000Z',
        stopMode: 'terminate',
        stopReason: 'session_stop',
        hardTeardownStatus: 'failed',
        hardTeardownLastAttemptAt: '2026-04-23T12:40:01.000Z',
        hardTeardownLastError: 'release failed before retry',
        hardTeardownAttemptCount: 1,
      },
      60,
    );

    await expect(markSessionHardTeardownReleased(cache, {
      workspaceId: 'ws_release_debt',
      projectId: 'proj_release_debt',
      sessionId: 'sess_release_debt',
      releasedAt: '2026-04-23T12:40:05.000Z',
    })).resolves.toMatchObject({
      status: 'stopped',
      phase: 'terminal',
      stopMode: 'terminate',
    });

    await expect(readSessionExecutionRecord(
      cache,
      'ws_release_debt',
      'proj_release_debt',
      'sess_release_debt',
    )).resolves.toMatchObject({
      status: 'stopped',
      phase: 'terminal',
      stopMode: 'terminate',
    });
    const released = await readSessionExecutionRecord(
      cache,
      'ws_release_debt',
      'proj_release_debt',
      'sess_release_debt',
    );
    expect(released?.hardTeardownStatus).toBeUndefined();
    await expect(beginSessionExecution(
      cache,
      {
        workspaceId: 'ws_release_debt',
        projectId: 'proj_release_debt',
        sessionId: 'sess_release_debt',
        streamId: 'stream_after_release',
        startedAt: '2026-04-23T12:40:06.000Z',
      },
      60,
    )).resolves.toMatchObject({
      streamId: 'stream_after_release',
      status: 'running',
    });
  });

  it('does not let a stale failed hard teardown attempt revive debt after a newer release succeeds', async () => {
    const cache = new InMemoryCache();

    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_release_fence',
        projectId: 'proj_release_fence',
        sessionId: 'sess_release_fence',
        streamId: 'stream_release_fence',
        ownerInstanceId: 'api-test',
        status: 'stopped',
        phase: 'terminal',
        startedAt: '2026-04-23T13:00:00.000Z',
        updatedAt: '2026-04-23T13:00:01.000Z',
        stopMode: 'terminate',
        stopReason: 'session_stop',
        hardTeardownStatus: 'pending',
      },
      60,
    );

    const attemptA = await markSessionHardTeardownRequested(cache, {
      workspaceId: 'ws_release_fence',
      projectId: 'proj_release_fence',
      sessionId: 'sess_release_fence',
      streamId: 'stream_release_fence',
      requestedAt: '2026-04-23T13:00:02.000Z',
    });
    expect(attemptA).toMatchObject({
      hardTeardownStatus: 'requested',
      hardTeardownAttemptCount: 1,
    });

    await requestSessionExecutionStopTransition(cache, {
      workspaceId: 'ws_release_fence',
      projectId: 'proj_release_fence',
      sessionId: 'sess_release_fence',
      stopReason: 'session_stop',
      stopMode: 'terminate',
      updatedAt: '2026-04-23T13:00:03.000Z',
    });
    const attemptB = await markSessionHardTeardownRequested(cache, {
      workspaceId: 'ws_release_fence',
      projectId: 'proj_release_fence',
      sessionId: 'sess_release_fence',
      streamId: 'stream_release_fence',
      requestedAt: '2026-04-23T13:00:04.000Z',
    });
    expect(attemptB).toMatchObject({
      hardTeardownStatus: 'requested',
      hardTeardownAttemptCount: 2,
    });

    await markSessionHardTeardownReleased(cache, {
      workspaceId: 'ws_release_fence',
      projectId: 'proj_release_fence',
      sessionId: 'sess_release_fence',
      streamId: 'stream_release_fence',
      releasedAt: '2026-04-23T13:00:05.000Z',
      ...(attemptB?.hardTeardownAttemptId ? { attemptId: attemptB.hardTeardownAttemptId } : {}),
      ...(typeof attemptB?.hardTeardownAttemptCount === 'number'
        ? { generation: attemptB.hardTeardownAttemptCount }
        : {}),
    });
    await markSessionHardTeardownRequested(cache, {
      workspaceId: 'ws_release_fence',
      projectId: 'proj_release_fence',
      sessionId: 'sess_release_fence',
      streamId: 'stream_release_fence',
      requestedAt: '2026-04-23T13:00:05.500Z',
    });
    await markSessionHardTeardownFailed(cache, {
      workspaceId: 'ws_release_fence',
      projectId: 'proj_release_fence',
      sessionId: 'sess_release_fence',
      streamId: 'stream_release_fence',
      attemptedAt: '2026-04-23T13:00:06.000Z',
      errorMessage: 'stale attempt A failed late',
      ...(attemptA?.hardTeardownAttemptId ? { attemptId: attemptA.hardTeardownAttemptId } : {}),
      ...(typeof attemptA?.hardTeardownAttemptCount === 'number'
        ? { generation: attemptA.hardTeardownAttemptCount }
        : {}),
    });

    const released = await readSessionExecutionRecord(
      cache,
      'ws_release_fence',
      'proj_release_fence',
      'sess_release_fence',
    );
    expect(released?.hardTeardownStatus).toBeUndefined();
    await expect(beginSessionExecution(
      cache,
      {
        workspaceId: 'ws_release_fence',
        projectId: 'proj_release_fence',
        sessionId: 'sess_release_fence',
        streamId: 'stream_after_fenced_release',
        startedAt: '2026-04-23T13:00:07.000Z',
      },
      60,
    )).resolves.toMatchObject({
      streamId: 'stream_after_fenced_release',
      status: 'running',
    });
  });

  it('keeps a current hard teardown failure retryable and dispatchable from pending debt', async () => {
    const cache = new InMemoryCache();

    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_failure_fence',
        projectId: 'proj_failure_fence',
        sessionId: 'sess_failure_fence',
        streamId: 'stream_failure_fence',
        ownerInstanceId: 'api-test',
        status: 'terminating',
        phase: 'dispatching',
        startedAt: '2026-04-23T13:10:00.000Z',
        updatedAt: '2026-04-23T13:10:01.000Z',
        stopMode: 'terminate',
        stopReason: 'session_stop',
        hardTeardownStatus: 'pending',
      },
      60,
    );

    const attempt = await markSessionHardTeardownRequested(cache, {
      workspaceId: 'ws_failure_fence',
      projectId: 'proj_failure_fence',
      sessionId: 'sess_failure_fence',
      streamId: 'stream_failure_fence',
      requestedAt: '2026-04-23T13:10:02.000Z',
    });
    await expect(markSessionHardTeardownFailed(cache, {
      workspaceId: 'ws_failure_fence',
      projectId: 'proj_failure_fence',
      sessionId: 'sess_failure_fence',
      streamId: 'stream_failure_fence',
      attemptedAt: '2026-04-23T13:10:03.000Z',
      errorMessage: 'current release failed',
      ...(attempt?.hardTeardownAttemptId ? { attemptId: attempt.hardTeardownAttemptId } : {}),
      ...(typeof attempt?.hardTeardownAttemptCount === 'number'
        ? { generation: attempt.hardTeardownAttemptCount }
        : {}),
    })).resolves.toMatchObject({
      hardTeardownStatus: 'failed',
      hardTeardownLastError: 'current release failed',
    });

    await expect(requestSessionExecutionStopTransition(cache, {
      workspaceId: 'ws_failure_fence',
      projectId: 'proj_failure_fence',
      sessionId: 'sess_failure_fence',
      stopReason: 'session_stop',
      stopMode: 'terminate',
      updatedAt: '2026-04-23T13:10:04.000Z',
    })).resolves.toMatchObject({
      hardTeardownDispatchRequired: true,
      record: {
        hardTeardownStatus: 'pending',
      },
    });
  });

  it('does not overwrite structured execution records with fallback state when stopping active streams', async () => {
    const cache = new InMemoryCache();
    await writeSessionExecutionRecord(
      cache,
      {
        workspaceId: 'ws_structured_stop',
        projectId: 'proj_structured_stop',
        sessionId: 'sess_structured_stop',
        streamId: 'stream_structured_stop',
        ownerInstanceId: 'api-test',
        status: 'running',
        phase: 'streaming',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:00.000Z',
      },
      60,
    );
    ACTIVE_CHAT_STREAMS.set('stream_structured_stop', {
      workspaceId: 'ws_structured_stop',
      projectId: 'proj_structured_stop',
      sessionId: 'sess_structured_stop',
      abortController: new AbortController(),
      startedAt: '2026-04-23T12:00:00.000Z',
      status: 'running',
      assistantMessageId: 'msg_structured_stop',
      parentMessageId: null,
      endpointId: 'ep_structured_stop',
      model: 'gpt-5-codex',
      contentSoFar: '',
      clients: new Set(),
    });

    await expect(stopActiveSessionStreams(
      cache,
      'ws_structured_stop',
      'proj_structured_stop',
      'sess_structured_stop',
      { stopMode: 'cancel', stopReason: 'session_stop' },
    )).resolves.toBe(1);

    await expect(readSessionExecutionRecord(
      cache,
      'ws_structured_stop',
      'proj_structured_stop',
      'sess_structured_stop',
    )).resolves.toMatchObject({
      streamId: 'stream_structured_stop',
      status: 'stopping',
      stopMode: 'cancel',
    });
  });
});
