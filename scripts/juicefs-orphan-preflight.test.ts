import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { resolveFileLibraryRuntimeConfig } from '../packages/api-entry-node/src/file-library-runtime.js';
import {
  buildTaskMountUmountAttempts,
  classifyGatewayProcessWithoutState,
  classifyTaskMountpointStatus,
  classifyGatewayState,
  classifyTaskMountProcess,
  extractGatewayProcessIdentity,
  loadTaskMountRegistryOwners,
  matchGatewayStateForProcess,
  resolvePreflightOptions,
  type GatewayStateRecord,
  type ManagedProcessInfo,
} from './juicefs-orphan-preflight';

function buildGatewayState(overrides: Partial<GatewayStateRecord> = {}): GatewayStateRecord {
  return {
    libraryId: 'flib_demo',
    pid: 4100,
    ownerProcessPid: 5100,
    port: 39001,
    loopbackUrl: 'http://127.0.0.1:39001',
    metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
    storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
    logPath: '/tmp/flib_demo.log',
    lastStartedAt: '2026-04-02T18:30:00.000Z',
    status: 'ready',
    stateFilePath: '/tmp/flib_demo.json',
    ...overrides,
  };
}

function buildProcess(overrides: Partial<ManagedProcessInfo> = {}): ManagedProcessInfo {
  return {
    pid: 7100,
    ppid: 1,
    ageSeconds: 1200,
    command: 'juicefs gateway postgres://meta 127.0.0.1:39001 --log /tmp/flib_demo.log --no-banner',
    ...overrides,
  };
}

describe('juicefs orphan preflight', () => {
  it('removes gateway state when the persisted gateway pid is already gone', () => {
    const decision = classifyGatewayState({
      state: buildGatewayState({ pid: 4100, ownerProcessPid: 5100 }),
      livePids: new Set([5100]),
    });

    expect(decision).toEqual({
      action: 'remove_state',
      reason: 'state_pid_dead',
    });
  });

  it('reclaims a state-backed gateway when its owner pid is gone but the child gateway still lives', () => {
    const decision = classifyGatewayState({
      state: buildGatewayState({ pid: 4100, ownerProcessPid: 5100 }),
      livePids: new Set([4100]),
    });

    expect(decision).toEqual({
      action: 'stop_gateway_and_remove_state',
      reason: 'owner_pid_dead',
    });
  });

  it('keeps a state-backed gateway when both owner and gateway pid are alive', () => {
    const decision = classifyGatewayState({
      state: buildGatewayState({ pid: 4100, ownerProcessPid: 5100 }),
      livePids: new Set([4100, 5100]),
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'owner_and_gateway_alive',
    });
  });

  it('treats ownerless live gateway state as a migration candidate instead of healthy forever', () => {
    const decision = classifyGatewayState({
      state: buildGatewayState({ ownerProcessPid: null }),
      livePids: new Set([4100]),
    });

    expect(decision).toEqual({
      action: 'adopt_state',
      reason: 'owner_pid_missing',
    });
  });

  it('treats a findmnt target as mounted only when it matches the exact task mount path', () => {
    const mountPath = path.join('/home/percy', 'ags-workspace', 'task_demo');

    expect(classifyTaskMountpointStatus({
      mountPath,
      detectedTarget: '/',
    })).toBe('covered_by_parent_mount');

    expect(classifyTaskMountpointStatus({
      mountPath,
      detectedTarget: mountPath,
    })).toBe('exact_mount');

    expect(classifyTaskMountpointStatus({
      mountPath,
      detectedTarget: null,
    })).toBe('not_mounted');
  });

  it('extracts a stable managed gateway identity from metadata and bucket args even when --log is truncated', () => {
    const identity = extractGatewayProcessIdentity(
      'juicefs gateway postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable 127.0.0.1:39001 --bucket http://localhost:19000/jfs-lib-demo',
    );

    expect(identity).toEqual({
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      logPath: null,
      stableKeys: [
        'metadata:postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
        'bucket:http://localhost:19000/jfs-lib-demo',
        'db:jfs_lib_demo',
        'bucket_name:jfs-lib-demo',
      ],
      label: 'db:jfs_lib_demo',
    });
  });

  it('matches a live gateway process to persisted state by stable metadata identity instead of log path', () => {
    const state = buildGatewayState({
      libraryId: 'flib_demo',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      logPath: '/tmp/expected.log',
    });
    const processInfo = buildProcess({
      pid: 7100,
      command: 'juicefs gateway postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable 127.0.0.1:39001 --bucket http://localhost:19000/jfs-lib-demo',
    });

    expect(matchGatewayStateForProcess({
      processInfo,
      gatewayStates: [state],
    })?.libraryId).toBe('flib_demo');
  });

  it('does not touch untracked managed gateways while an api owner is still alive', () => {
    const decision = classifyGatewayProcessWithoutState({
      processInfo: buildProcess(),
      anyApiOwnerAlive: true,
      minAgeSeconds: 600,
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'api_owner_alive',
    });
  });

  it('only reclaims an untracked managed gateway after it ages past the stale threshold', () => {
    const freshDecision = classifyGatewayProcessWithoutState({
      processInfo: buildProcess({ ageSeconds: 120 }),
      anyApiOwnerAlive: false,
      minAgeSeconds: 600,
    });
    const staleDecision = classifyGatewayProcessWithoutState({
      processInfo: buildProcess({ ageSeconds: 1200 }),
      anyApiOwnerAlive: false,
      minAgeSeconds: 600,
    });

    expect(freshDecision).toEqual({
      action: 'keep',
      reason: 'process_too_fresh',
    });
    expect(staleDecision).toEqual({
      action: 'stop_gateway',
      reason: 'untracked_gateway_without_owner',
    });
  });

  it('never reclaims host task mounts while any runner is still alive', () => {
    const decision = classifyTaskMountProcess({
      processInfo: buildProcess({
        command: `juicefs mount postgres://meta ${path.join('/home/percy', 'ags-workspace', 'task_demo')}`,
      }),
      anyRunnerAlive: true,
      livePids: new Set([8100]),
      ownerProcessPid: null,
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'runner_alive',
    });
  });

  it('reclaims host task mounts after the runner ownership disappears', () => {
    const decision = classifyTaskMountProcess({
      processInfo: buildProcess({
        command: `juicefs mount postgres://meta ${path.join('/home/percy', 'ags-workspace', 'task_demo')}`,
      }),
      anyRunnerAlive: false,
      livePids: new Set(),
      ownerProcessPid: null,
    });

    expect(decision).toEqual({
      action: 'reclaim_mount',
      reason: 'runner_absent_for_host_mount',
    });
  });

  it('reclaims a mount whose recorded owner pid is dead even when another runner is still alive', () => {
    const decision = classifyTaskMountProcess({
      processInfo: buildProcess({
        command: `juicefs mount postgres://meta ${path.join('/home/percy', 'ags-workspace', 'task_demo')}`,
      }),
      anyRunnerAlive: true,
      livePids: new Set([5200]),
      ownerProcessPid: 5100,
    });

    expect(decision).toEqual({
      action: 'reclaim_mount',
      reason: 'mount_owner_pid_dead',
    });
  });

  it('keeps a mount whose recorded owner pid is still alive without relying on global runner liveness', () => {
    const decision = classifyTaskMountProcess({
      processInfo: buildProcess({
        command: `juicefs mount postgres://meta ${path.join('/home/percy', 'ags-workspace', 'task_demo')}`,
      }),
      anyRunnerAlive: false,
      livePids: new Set([5100]),
      ownerProcessPid: 5100,
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'mount_owner_alive',
    });
  });

  it('loads owner-aware mount registry fields when they are present and stays compatible with legacy entries', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'task-mount-registry-'));
    const registryPath = path.join(root, 'task-workspace-mount-sessions.json');
    await writeFile(registryPath, JSON.stringify({
      sessions: [
        {
          mount_path: '/tmp/task_alpha',
          ownerProcessPid: 9100,
          ownerRunnerInstanceId: 'runner_a',
          state: 'mounted',
          mountedAt: '2026-04-13T10:00:00.000Z',
        },
        {
          mount_path: '/tmp/task_legacy',
          refs: 1,
        },
      ],
    }), 'utf8');

    const owners = await loadTaskMountRegistryOwners(registryPath);
    expect(owners).toEqual(new Map([
      ['/tmp/task_alpha', 9100],
      ['/tmp/task_legacy', null],
    ]));
  });

  it('resolves the same default gateway directories as the api runtime even when cwd drifts', async () => {
    const tempCwd = await mkdtemp(path.join(tmpdir(), 'preflight-cwd-drift-'));
    const originalCwd = process.cwd();
    process.chdir(tempCwd);
    try {
      const env = {
        DATABASE_URL: 'postgresql://mbos:secret@postgres:5432/mbos',
        MINIO_ENDPOINT: 'minio',
        MINIO_PORT: '9000',
        MINIO_ACCESS_KEY: 'mbos',
        MINIO_SECRET_KEY: 'secret',
      } as NodeJS.ProcessEnv;
      const runtime = resolveFileLibraryRuntimeConfig(env);
      const preflight = resolvePreflightOptions([], env);

      expect(preflight.gatewayLogDir).toBe(runtime.gatewayLogDir);
      expect(preflight.gatewayStateDir).toBe(runtime.gatewayStateDir);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('tries JuiceFS unmount first, then falls back to lazy host unmount for stale mount cleanup', () => {
    const attempts = buildTaskMountUmountAttempts('/home/percy/ags-workspace/task_demo');

    expect(attempts).toEqual([
      { command: 'juicefs', args: ['umount', '/home/percy/ags-workspace/task_demo'] },
      { command: 'juicefs', args: ['umount', '-f', '/home/percy/ags-workspace/task_demo'] },
      { command: 'umount', args: ['-l', '/home/percy/ags-workspace/task_demo'] },
      { command: 'umount', args: ['-lf', '/home/percy/ags-workspace/task_demo'] },
    ]);
  });
});
