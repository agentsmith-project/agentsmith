import { describe, expect, it, vi } from 'vitest';
import type { CachePort } from '@mbos/ports';
import { InMemoryCache } from '@mbos/adapters-private';
import { createAgentPresenceStore } from './agent-presence-store.js';

interface SharedCacheRecord {
  value: string;
  expiresAt?: number;
}

interface WritePause {
  entered: Promise<void>;
  resume: () => void;
}

class RaceyCache implements CachePort {
  private nextWritePause: WritePauseInternal | null = null;

  constructor(private readonly sharedStore: Map<string, SharedCacheRecord>) {}

  pauseNextWrite(): WritePause {
    let resolveEntered!: () => void;
    let resolveResume!: () => void;
    const pause: WritePauseInternal = {
      entered: new Promise<void>((resolve) => {
        resolveEntered = resolve;
      }),
      resumePromise: new Promise<void>((resolve) => {
        resolveResume = resolve;
      }),
      resolveEntered,
      resolveResume,
    };
    this.nextWritePause = pause;
    return {
      entered: pause.entered,
      resume: pause.resolveResume,
    };
  }

  async get(key: string): Promise<string | null> {
    return this.read(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.pauseIfRequested();
    this.sharedStore.set(key, {
      value,
      ...(ttlSeconds && ttlSeconds > 0 ? { expiresAt: Date.now() + ttlSeconds * 1000 } : {}),
    });
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const current = Number.parseInt(this.read(key) ?? '0', 10);
    const next = (Number.isFinite(current) ? current : 0) + 1;
    await this.set(key, String(next), ttlSeconds);
    return next;
  }

  async del(key: string): Promise<void> {
    await this.pauseIfRequested();
    this.sharedStore.delete(key);
  }

  async compareAndSet(
    key: string,
    expectedValue: string | null,
    nextValue: string | null,
    ttlSeconds?: number,
  ): Promise<boolean> {
    await this.pauseIfRequested();
    if (this.read(key) !== expectedValue) return false;
    if (nextValue === null) {
      this.sharedStore.delete(key);
      return true;
    }
    this.sharedStore.set(key, {
      value: nextValue,
      ...(ttlSeconds && ttlSeconds > 0 ? { expiresAt: Date.now() + ttlSeconds * 1000 } : {}),
    });
    return true;
  }

  private read(key: string): string | null {
    const record = this.sharedStore.get(key);
    if (!record) return null;
    if (typeof record.expiresAt === 'number' && record.expiresAt <= Date.now()) {
      this.sharedStore.delete(key);
      return null;
    }
    return record.value;
  }

  private async pauseIfRequested(): Promise<void> {
    const pause = this.nextWritePause;
    if (!pause) return;
    this.nextWritePause = null;
    pause.resolveEntered();
    await pause.resumePromise;
  }
}

class CountingRaceyCache extends RaceyCache {
  compareAndSetCalls = 0;

  override async compareAndSet(
    key: string,
    expectedValue: string | null,
    nextValue: string | null,
    ttlSeconds?: number,
  ): Promise<boolean> {
    this.compareAndSetCalls += 1;
    return super.compareAndSet(key, expectedValue, nextValue, ttlSeconds);
  }
}

class FlakyCasCache extends CountingRaceyCache {
  failCompareAndSetCount = 0;

  override async compareAndSet(
    key: string,
    expectedValue: string | null,
    nextValue: string | null,
    ttlSeconds?: number,
  ): Promise<boolean> {
    if (this.failCompareAndSetCount > 0) {
      this.compareAndSetCalls += 1;
      this.failCompareAndSetCount -= 1;
      return false;
    }
    return super.compareAndSet(key, expectedValue, nextValue, ttlSeconds);
  }
}

interface WritePauseInternal {
  entered: Promise<void>;
  resumePromise: Promise<void>;
  resolveEntered: () => void;
  resolveResume: () => void;
}

describe('AgentPresenceStore', () => {
  it('replaces only the same socket claim and makes old refresh/release stale', async () => {
    const store = createAgentPresenceStore(new InMemoryCache());

    await store.upsertConnection({
      agentId: 'ag_claimed',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_old',
      socketKey: 'ag_claimed',
      apiInstanceId: 'api_a',
      lastPongAt: '2026-03-18T00:00:00.000Z',
    });
    await store.upsertConnection({
      agentId: 'ag_claimed',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_new',
      socketKey: 'ag_claimed',
      apiInstanceId: 'api_b',
      lastPongAt: '2026-03-18T00:00:05.000Z',
    });

    await expect(store.refreshConnection({
      agentId: 'ag_claimed',
      connectionId: 'conn_old',
      lastPongAt: '2026-03-18T00:00:10.000Z',
    })).resolves.toEqual(expect.objectContaining({
      stale: true,
      snapshot: expect.objectContaining({
        activeConnectionCount: 1,
        latestConnection: expect.objectContaining({ connection_id: 'conn_new' }),
      }),
    }));
    await expect(store.releaseConnection({
      agentId: 'ag_claimed',
      connectionId: 'conn_old',
    })).resolves.toEqual(expect.objectContaining({
      stale: true,
      released: false,
      snapshot: expect.objectContaining({ activeConnectionCount: 1 }),
    }));
  });

  it('keeps independent session connections until the last lease is released', async () => {
    const store = createAgentPresenceStore(new InMemoryCache());

    await store.upsertConnection({
      agentId: 'ag_sessions',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_task_a',
      socketKey: 'ag_sessions::task_a',
      sessionId: 'task_a',
      apiInstanceId: 'api_a',
      lastPongAt: '2026-03-18T00:00:00.000Z',
    });
    await store.upsertConnection({
      agentId: 'ag_sessions',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_task_b',
      socketKey: 'ag_sessions::task_b',
      sessionId: 'task_b',
      apiInstanceId: 'api_a',
      lastPongAt: '2026-03-18T00:00:05.000Z',
    });

    await expect(store.releaseConnection({
      agentId: 'ag_sessions',
      connectionId: 'conn_task_a',
    })).resolves.toEqual(expect.objectContaining({
      released: true,
      stale: false,
      snapshot: expect.objectContaining({
        activeConnectionCount: 1,
        latestConnection: expect.objectContaining({ connection_id: 'conn_task_b' }),
      }),
    }));
    await expect(store.releaseConnection({
      agentId: 'ag_sessions',
      connectionId: 'conn_task_b',
    })).resolves.toEqual(expect.objectContaining({
      released: true,
      stale: false,
      snapshot: expect.objectContaining({
        activeConnectionCount: 0,
        latestConnection: null,
      }),
    }));
  });

  it('preserves a newer cross-process upsert when an old release resumes from a stale read', async () => {
    const sharedStore = new Map<string, SharedCacheRecord>();
    const cacheA = new RaceyCache(sharedStore);
    const cacheB = new RaceyCache(sharedStore);
    const storeA = createAgentPresenceStore(cacheA);
    const storeB = createAgentPresenceStore(cacheB);

    await storeA.upsertConnection({
      agentId: 'ag_release_race',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_old',
      socketKey: 'ag_release_race',
      apiInstanceId: 'api_a',
      lastPongAt: '2026-03-18T00:00:00.000Z',
    });

    const pause = cacheA.pauseNextWrite();
    const release = storeA.releaseConnection({
      agentId: 'ag_release_race',
      connectionId: 'conn_old',
    });
    await pause.entered;
    await storeB.upsertConnection({
      agentId: 'ag_release_race',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_new',
      socketKey: 'ag_release_race',
      apiInstanceId: 'api_b',
      lastPongAt: '2026-03-18T00:00:05.000Z',
    });
    pause.resume();
    await expect(release).resolves.toEqual(expect.objectContaining({
      released: false,
      stale: true,
      snapshot: expect.objectContaining({
        activeConnectionCount: 1,
        latestConnection: expect.objectContaining({ connection_id: 'conn_new' }),
      }),
    }));

    await expect(storeB.getPresence('ag_release_race')).resolves.toEqual(expect.objectContaining({
      activeConnectionCount: 1,
      latestConnection: expect.objectContaining({ connection_id: 'conn_new' }),
    }));
  });

  it('preserves a newer cross-process upsert when an old refresh resumes from a stale read', async () => {
    const sharedStore = new Map<string, SharedCacheRecord>();
    const cacheA = new RaceyCache(sharedStore);
    const cacheB = new RaceyCache(sharedStore);
    const storeA = createAgentPresenceStore(cacheA);
    const storeB = createAgentPresenceStore(cacheB);

    await storeA.upsertConnection({
      agentId: 'ag_refresh_race',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_old',
      socketKey: 'ag_refresh_race',
      apiInstanceId: 'api_a',
      lastPongAt: '2026-03-18T00:00:00.000Z',
    });

    const pause = cacheA.pauseNextWrite();
    const refresh = storeA.refreshConnection({
      agentId: 'ag_refresh_race',
      connectionId: 'conn_old',
      lastPongAt: '2026-03-18T00:00:10.000Z',
    });
    await pause.entered;
    await storeB.upsertConnection({
      agentId: 'ag_refresh_race',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_new',
      socketKey: 'ag_refresh_race',
      apiInstanceId: 'api_b',
      lastPongAt: '2026-03-18T00:00:05.000Z',
    });
    pause.resume();

    await expect(refresh).resolves.toEqual(expect.objectContaining({
      stale: true,
      snapshot: expect.objectContaining({
        activeConnectionCount: 1,
        latestConnection: expect.objectContaining({ connection_id: 'conn_new' }),
      }),
    }));
    await expect(storeB.getPresence('ag_refresh_race')).resolves.toEqual(expect.objectContaining({
      activeConnectionCount: 1,
      latestConnection: expect.objectContaining({ connection_id: 'conn_new' }),
    }));
  });

  it('merges concurrent cross-process session upserts instead of losing one session', async () => {
    const sharedStore = new Map<string, SharedCacheRecord>();
    const cacheA = new RaceyCache(sharedStore);
    const cacheB = new RaceyCache(sharedStore);
    const storeA = createAgentPresenceStore(cacheA);
    const storeB = createAgentPresenceStore(cacheB);

    const pause = cacheA.pauseNextWrite();
    const upsertA = storeA.upsertConnection({
      agentId: 'ag_session_race',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_task_a',
      socketKey: 'ag_session_race::task_a',
      sessionId: 'task_a',
      apiInstanceId: 'api_a',
      lastPongAt: '2026-03-18T00:00:00.000Z',
    });
    await pause.entered;
    await storeB.upsertConnection({
      agentId: 'ag_session_race',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_task_b',
      socketKey: 'ag_session_race::task_b',
      sessionId: 'task_b',
      apiInstanceId: 'api_b',
      lastPongAt: '2026-03-18T00:00:05.000Z',
    });
    pause.resume();
    await upsertA;

    await expect(storeB.getPresence('ag_session_race')).resolves.toEqual(expect.objectContaining({
      activeConnectionCount: 2,
      connections: expect.arrayContaining([
        expect.objectContaining({ connection_id: 'conn_task_a' }),
        expect.objectContaining({ connection_id: 'conn_task_b' }),
      ]),
    }));
  });

  it('does not let reader cleanup delete a newer connection written by another process', async () => {
    const sharedStore = new Map<string, SharedCacheRecord>();
    const cacheA = new RaceyCache(sharedStore);
    const cacheB = new RaceyCache(sharedStore);
    const reader = createAgentPresenceStore(cacheA);
    const writer = createAgentPresenceStore(cacheB);
    sharedStore.set('agent:presence:ag_reader_cleanup_race', {
      value: JSON.stringify({
        version: 2,
        agent_id: 'ag_reader_cleanup_race',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        generation: 1,
        updated_at: '2026-03-18T00:00:00.000Z',
        connections: {
          conn_expired: {
            connection_id: 'conn_expired',
            socket_key: 'ag_reader_cleanup_race',
            agent_id: 'ag_reader_cleanup_race',
            workspace_id: 'ws_default',
            project_id: 'proj_1',
            connected_at: '2026-03-18T00:00:00.000Z',
            last_pong_at: '2026-03-18T00:00:00.000Z',
            expires_at: '2026-03-18T00:00:01.000Z',
          },
        },
      }),
    });

    await expect(reader.getPresence('ag_reader_cleanup_race')).resolves.toEqual(expect.objectContaining({
      activeConnectionCount: 0,
      latestConnection: null,
    }));
    await writer.upsertConnection({
      agentId: 'ag_reader_cleanup_race',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_new',
      socketKey: 'ag_reader_cleanup_race',
      apiInstanceId: 'api_b',
      lastPongAt: '2026-03-18T00:00:05.000Z',
    });

    await expect(writer.getPresence('ag_reader_cleanup_race')).resolves.toEqual(expect.objectContaining({
      activeConnectionCount: 1,
      latestConnection: expect.objectContaining({ connection_id: 'conn_new' }),
    }));
  });

  it('treats getPresence as a pure read without compareAndSet cleanup writes', async () => {
    const sharedStore = new Map<string, SharedCacheRecord>();
    const cache = new CountingRaceyCache(sharedStore);
    const store = createAgentPresenceStore(cache);

    await store.upsertConnection({
      agentId: 'ag_read_only',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_read_only',
      socketKey: 'ag_read_only',
      apiInstanceId: 'api_a',
      lastPongAt: '2026-03-18T00:00:00.000Z',
    });
    const compareAndSetCallsAfterWrite = cache.compareAndSetCalls;

    await expect(store.getPresence('ag_read_only')).resolves.toEqual(expect.objectContaining({
      activeConnectionCount: 1,
      latestConnection: expect.objectContaining({
        connection_id: 'conn_read_only',
      }),
    }));
    await expect(store.getPresence('ag_read_only')).resolves.toEqual(expect.objectContaining({
      activeConnectionCount: 1,
    }));
    expect(cache.compareAndSetCalls).toBe(compareAndSetCallsAfterWrite);
  });

  it('backs off between CAS retries instead of hot-spinning the shared presence key', async () => {
    const sharedStore = new Map<string, SharedCacheRecord>();
    const cache = new FlakyCasCache(sharedStore);
    cache.failCompareAndSetCount = 3;
    const store = createAgentPresenceStore(cache);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    try {
      await expect(store.upsertConnection({
        agentId: 'ag_cas_backoff',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        connectionId: 'conn_backoff',
        socketKey: 'ag_cas_backoff',
        apiInstanceId: 'api_a',
        lastPongAt: '2026-03-18T00:00:00.000Z',
      })).resolves.toEqual(expect.objectContaining({
        activeConnectionCount: 1,
        latestConnection: expect.objectContaining({
          connection_id: 'conn_backoff',
        }),
      }));
      expect(cache.compareAndSetCalls).toBeGreaterThanOrEqual(4);
      expect(timeoutSpy).toHaveBeenCalled();
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});
