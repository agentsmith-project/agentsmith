import { describe, expect, it } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';
import {
  readSessionExecutionRecord,
  readSessionStreamState,
  writeSessionExecutionRecord,
  writeSessionStreamState,
} from './chat-stream-state.js';

describe('chat session execution record', () => {
  it('reads legacy string state as session execution status', async () => {
    const cache = new InMemoryCache();

    await writeSessionStreamState(cache, 'ws_legacy', 'proj_legacy', 'sess_legacy', 'running', 60);

    await expect(readSessionStreamState(cache, 'ws_legacy', 'proj_legacy', 'sess_legacy')).resolves.toBe('running');
    await expect(readSessionExecutionRecord(cache, 'ws_legacy', 'proj_legacy', 'sess_legacy')).resolves.toMatchObject({
      workspaceId: 'ws_legacy',
      projectId: 'proj_legacy',
      sessionId: 'sess_legacy',
      status: 'running',
      phase: 'streaming',
      transport: 'direct_provider',
    });
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
        transport: 'agent_runner',
        internalAgent: true,
        status: 'stopping',
        phase: 'dispatching',
        startedAt: '2026-04-23T12:00:00.000Z',
        updatedAt: '2026-04-23T12:00:01.000Z',
        requestId: 'req_record',
        endpointId: 'ep_record',
        externalAgentId: 'agent_record',
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
      transport: 'agent_runner',
      internalAgent: true,
      status: 'stopping',
      phase: 'dispatching',
      startedAt: '2026-04-23T12:00:00.000Z',
      updatedAt: '2026-04-23T12:00:01.000Z',
      requestId: 'req_record',
      endpointId: 'ep_record',
      externalAgentId: 'agent_record',
      stopRequestedAt: '2026-04-23T12:00:01.000Z',
      stopReason: 'session_stop',
    });
    await expect(readSessionStreamState(cache, 'ws_record', 'proj_record', 'sess_record')).resolves.toBe('stopping');
  });
});
