import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { resolveFileLibraryRuntimeConfig } from '../packages/api-entry-node/src/file-library-runtime.js';
import {
  buildTaskMountUmountAttempts,
  classifyAgentSmithOwnedMountProcess,
  classifyGatewayProcessWithoutState,
  classifyTaskMountpointStatus,
  classifyGatewayState,
  classifyTaskMountProcess,
  extractGatewayProcessIdentity,
  extractJuicefsMountPath,
  hasAnyNotebookRunnerAlive,
  loadTaskMountRegistryOwners,
  matchGatewayStateForProcess,
  resolvePreflightOptions,
  trackedOwnerPidFiles,
  type GatewayStateRecord,
  type ManagedProcessInfo,
} from './juicefs-orphan-preflight';

function buildGatewayState(overrides: Partial<GatewayStateRecord> = {}): GatewayStateRecord {
  return {
    libraryId: 'flib_demo',
    pid: 4100,
    ownerProcessPid: 5100,
    ownerScope: 'api-pid-5100',
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
    cwd: null,
    command: 'juicefs gateway postgres://meta 127.0.0.1:39001 --log /tmp/flib_demo.log --no-banner',
    ...overrides,
  };
}

function buildRunnerProcess(pid: number, instanceId?: string): ManagedProcessInfo {
  return buildProcess({
    pid,
    command: `node /workspace/packages/notebook-codex-runner/dist/index.js${instanceId ? ` runner_instance_id=${instanceId}` : ''}`,
  });
}

function buildCanonicalTsxRunnerProcess(pid: number, overrides: Partial<ManagedProcessInfo> = {}): ManagedProcessInfo {
  return buildProcess({
    pid,
    cwd: '/home/percy/works/mbos-v1/agentsmith/packages/notebook-codex-runner',
    command: 'tsx src/index.ts',
    ...overrides,
  });
}

function buildRunnerTitleProcess(pid: number, instanceId: string): ManagedProcessInfo {
  return buildProcess({
    pid,
    command: `agentsmith-notebook-codex-runner runner_instance_id=${instanceId}`,
  });
}

function buildNonRunnerNotebookCommandProcess(pid: number): ManagedProcessInfo {
  return buildProcess({
    pid,
    command: 'vitest packages/notebook-codex-runner/src/index.ts --runInBand',
  });
}

function buildOwnedGatewayCommand(args: {
  ownerScope: string;
  libraryId: string;
  metadataUrl?: string;
  listenAddress?: string;
  storageBucketUrl?: string;
  logPath?: string;
}) {
  return [
    `juicefs owner_scope=${args.ownerScope} library_id=${args.libraryId}`,
    'gateway',
    args.metadataUrl ?? 'postgres://meta',
    args.listenAddress ?? '127.0.0.1:39001',
    ...(args.storageBucketUrl ? ['--bucket', args.storageBucketUrl] : []),
    ...(args.logPath ? ['--log', args.logPath] : []),
    '--no-banner',
  ].join(' ');
}

function buildBootScopedOwnerScope(instanceId: string, bootId: string) {
  return `api-v1:${instanceId}:${bootId}`;
}

function buildGatewayOwnerEvidence(overrides: {
  localInstanceId?: string | null;
  scopeStatusByScope?: Map<string, 'active' | 'stale' | 'released'>;
} = {}) {
  return {
    localInstanceId: 'instance-a',
    scopeStatusByScope: new Map<string, 'active' | 'stale' | 'released'>(),
    ...overrides,
  };
}

describe('juicefs orphan preflight', () => {
  it('tracks local-manual owner pid files from the runtime line root instead of backend-real/current', () => {
    expect(trackedOwnerPidFiles('/repo')).toEqual({
      apiPidFile: path.join('/repo', 'artifacts/runtime/lines/local-manual/current/api.pid'),
      runnerPidFile: path.join('/repo', 'artifacts/runtime/lines/local-manual/current/runner.pid'),
    });
  });

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

  it('reclaims a state-backed gateway when its recorded owner pid was reused by a newer boot and the old boot heartbeat is stale', () => {
    const staleOwnerScope = buildBootScopedOwnerScope('instance-a', 'boot-old');
    const decision = classifyGatewayState({
      state: buildGatewayState({
        pid: 4100,
        ownerProcessPid: 5100,
        ownerScope: staleOwnerScope,
      }),
      livePids: new Set([4100, 5100]),
      ownerEvidence: buildGatewayOwnerEvidence({
        localInstanceId: 'instance-a',
        scopeStatusByScope: new Map<string, 'active' | 'stale'>([
          [staleOwnerScope, 'stale'],
          [buildBootScopedOwnerScope('instance-a', 'boot-current'), 'active'],
        ]),
      }),
    });

    expect(decision).toEqual({
      action: 'stop_gateway_and_remove_state',
      reason: 'owner_boot_stale',
    });
  });

  it('reclaims a state-backed gateway when its owner boot was explicitly released', () => {
    const releasedOwnerScope = buildBootScopedOwnerScope('instance-a', 'boot-released');
    const decision = classifyGatewayState({
      state: buildGatewayState({
        pid: 4100,
        ownerProcessPid: 5100,
        ownerScope: releasedOwnerScope,
      }),
      livePids: new Set([4100, 5100]),
      processTableByPid: new Map<number, ManagedProcessInfo>([
        [
          4100,
          buildProcess({
            pid: 4100,
            command: buildOwnedGatewayCommand({
              ownerScope: releasedOwnerScope,
              libraryId: 'flib_demo',
              metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
              listenAddress: '127.0.0.1:39001',
              storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
              logPath: '/tmp/flib_demo.log',
            }),
          }),
        ],
      ]),
      ownerEvidence: buildGatewayOwnerEvidence({
        localInstanceId: 'instance-a',
        scopeStatusByScope: new Map<string, 'active' | 'stale' | 'released'>([
          [releasedOwnerScope, 'released'],
          [buildBootScopedOwnerScope('instance-a', 'boot-current'), 'active'],
        ]),
      }),
    });

    expect(decision).toEqual({
      action: 'stop_gateway_and_remove_state',
      reason: 'owner_boot_released',
    });
  });

  it('fails open when a stale persisted gateway pid was reused by an unrelated live process', () => {
    const decision = classifyGatewayState({
      state: buildGatewayState({
        pid: 4100,
        ownerProcessPid: 5100,
        ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-old'),
      }),
      livePids: new Set([4100, 5100]),
      processTableByPid: new Map<number, ManagedProcessInfo>([
        [
          4100,
          buildProcess({
            pid: 4100,
            command: 'node /tmp/unrelated-server.js',
          }),
        ],
      ]),
      ownerEvidence: buildGatewayOwnerEvidence({
        localInstanceId: 'instance-a',
        scopeStatusByScope: new Map<string, 'active' | 'stale'>([
          [buildBootScopedOwnerScope('instance-a', 'boot-old'), 'stale'],
          [buildBootScopedOwnerScope('instance-a', 'boot-current'), 'active'],
        ]),
      }),
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'pid_authority_unverified',
    });
  });

  it('fails open for a legacy state-backed gateway when both owner and gateway pid are alive but owner scope authority is unverified', () => {
    const decision = classifyGatewayState({
      state: buildGatewayState({ pid: 4100, ownerProcessPid: 5100 }),
      livePids: new Set([4100, 5100]),
      processTableByPid: new Map<number, ManagedProcessInfo>([
        [
          4100,
          buildProcess({
            pid: 4100,
            command: buildOwnedGatewayCommand({
              ownerScope: 'api-pid-5100',
              libraryId: 'flib_demo',
              metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
              listenAddress: '127.0.0.1:39001',
              storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
              logPath: '/tmp/flib_demo.log',
            }),
          }),
        ],
      ]),
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'owner_scope_unverified',
    });
  });

  it('fails open for a state-backed gateway owned by a foreign active boot', () => {
    const foreignOwnerScope = buildBootScopedOwnerScope('instance-b', 'boot-foreign');
    const decision = classifyGatewayState({
      state: buildGatewayState({
        pid: 4100,
        ownerProcessPid: 5100,
        ownerScope: foreignOwnerScope,
      }),
      livePids: new Set([4100, 5100]),
      processTableByPid: new Map<number, ManagedProcessInfo>([
        [
          4100,
          buildProcess({
            pid: 4100,
            command: buildOwnedGatewayCommand({
              ownerScope: foreignOwnerScope,
              libraryId: 'flib_demo',
            }),
          }),
        ],
      ]),
      ownerEvidence: buildGatewayOwnerEvidence({
        localInstanceId: 'instance-a',
        scopeStatusByScope: new Map<string, 'active' | 'stale' | 'released'>([
          [buildBootScopedOwnerScope('instance-a', 'boot-current'), 'active'],
        ]),
      }),
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'foreign_owner_scope',
    });
  });

  it('fails open for a state-backed gateway when same-instance owner scope has no ledger evidence yet', () => {
    const unverifiedOwnerScope = buildBootScopedOwnerScope('instance-a', 'boot-unknown');
    const decision = classifyGatewayState({
      state: buildGatewayState({
        pid: 4100,
        ownerProcessPid: 5100,
        ownerScope: unverifiedOwnerScope,
      }),
      livePids: new Set([4100, 5100]),
      processTableByPid: new Map<number, ManagedProcessInfo>([
        [
          4100,
          buildProcess({
            pid: 4100,
            command: buildOwnedGatewayCommand({
              ownerScope: unverifiedOwnerScope,
              libraryId: 'flib_demo',
            }),
          }),
        ],
      ]),
      ownerEvidence: buildGatewayOwnerEvidence({
        localInstanceId: 'instance-a',
        scopeStatusByScope: new Map<string, 'active' | 'stale' | 'released'>([
          [buildBootScopedOwnerScope('instance-a', 'boot-current'), 'active'],
        ]),
      }),
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'owner_scope_unverified',
    });
  });

  it('treats ownerless live gateway state as a migration candidate instead of healthy forever', () => {
    const decision = classifyGatewayState({
      state: buildGatewayState({ ownerProcessPid: null }),
      livePids: new Set([4100]),
      processTableByPid: new Map<number, ManagedProcessInfo>([
        [
          4100,
          buildProcess({
            pid: 4100,
            command: 'juicefs gateway postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable 127.0.0.1:39001 --log /tmp/flib_demo.log --no-banner',
          }),
        ],
      ]),
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

  it('extracts a stable managed gateway identity from the explicit owner marker even when --log is truncated', () => {
    const identity = extractGatewayProcessIdentity(
      buildOwnedGatewayCommand({
        ownerScope: 'api-pid-5100',
        libraryId: 'flib_demo',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
        listenAddress: '127.0.0.1:39001',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      }),
    );

    expect(identity).toEqual({
      ownerScope: 'api-pid-5100',
      libraryId: 'flib_demo',
      listenAddress: '127.0.0.1:39001',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      logPath: null,
      stableKeys: [
        'scope_library:api-pid-5100:flib_demo',
      ],
      label: 'scope_library:api-pid-5100:flib_demo',
    });
  });

  it('matches a live gateway process to persisted state by its explicit owner scope marker', () => {
    const state = buildGatewayState({
      libraryId: 'flib_demo',
      ownerScope: 'api-pid-5100',
      pid: 4100,
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      logPath: '/tmp/expected.log',
    });
    const processInfo = buildProcess({
      pid: 7100,
      command: buildOwnedGatewayCommand({
        ownerScope: 'api-pid-5100',
        libraryId: 'flib_demo',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
        listenAddress: '127.0.0.1:49001',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      }),
    });

    expect(matchGatewayStateForProcess({
      processInfo,
      gatewayStates: [state],
    })?.libraryId).toBe('flib_demo');
  });

  it('does not match a live gateway process to persisted state when the owner scope differs', () => {
    const state = buildGatewayState({
      libraryId: 'flib_demo',
      ownerScope: 'api-pid-5100',
      pid: 4100,
      port: 39001,
      loopbackUrl: 'http://127.0.0.1:39001',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      logPath: '/tmp/expected.log',
    });
    const processInfo = buildProcess({
      pid: 7100,
      command: buildOwnedGatewayCommand({
        ownerScope: 'api-pid-5200',
        libraryId: 'flib_demo',
        metadataUrl: 'postgres://other-user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        listenAddress: '127.0.0.1:49001',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      }),
    });

    expect(matchGatewayStateForProcess({
      processInfo,
      gatewayStates: [state],
    })).toBeNull();
  });

  it('does not match by pid reuse when the process owner scope boot identity differs', () => {
    const state = buildGatewayState({
      libraryId: 'flib_demo',
      pid: 7100,
      ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-old'),
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      logPath: '/tmp/expected.log',
    });
    const processInfo = buildProcess({
      pid: 7100,
      command: buildOwnedGatewayCommand({
        ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-current'),
        libraryId: 'flib_demo',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
        listenAddress: '127.0.0.1:39001',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
        logPath: '/tmp/expected.log',
      }),
    });

    expect(matchGatewayStateForProcess({
      processInfo,
      gatewayStates: [state],
    })).toBeNull();
  });

  it('does not match a reused pid to persisted state before owner identity matches', () => {
    const state = buildGatewayState({
      libraryId: 'flib_demo',
      ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-old'),
      pid: 7100,
      port: 39001,
      loopbackUrl: 'http://127.0.0.1:39001',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      logPath: '/tmp/expected.log',
    });
    const processInfo = buildProcess({
      pid: 7100,
      command: buildOwnedGatewayCommand({
        ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-current'),
        libraryId: 'flib_demo',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_demo?sslmode=disable',
        listenAddress: '127.0.0.1:49001',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      }),
    });

    expect(matchGatewayStateForProcess({
      processInfo,
      gatewayStates: [state],
    })).toBeNull();
  });

  it('fails open for untracked gateways without an explicit owner scope marker', () => {
    const decision = classifyGatewayProcessWithoutState({
      processInfo: buildProcess(),
      ownerEvidence: buildGatewayOwnerEvidence(),
      minAgeSeconds: 600,
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'owner_scope_unknown',
    });
  });

  it('does not reclaim a stale foreign-owner gateway without local state', () => {
    const decision = classifyGatewayProcessWithoutState({
      processInfo: buildProcess({
        command: buildOwnedGatewayCommand({
          ownerScope: buildBootScopedOwnerScope('instance-b', 'boot-foreign'),
          libraryId: 'flib_demo',
        }),
      }),
      ownerEvidence: buildGatewayOwnerEvidence({
        localInstanceId: 'instance-a',
        scopeStatusByScope: new Map<string, 'active' | 'stale'>([
          [buildBootScopedOwnerScope('instance-a', 'boot-current'), 'active'],
        ]),
      }),
      minAgeSeconds: 600,
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'foreign_owner_scope',
    });
  });

  it('only reclaims an owner-scoped untracked gateway after its local owner scope goes stale and it ages past the threshold', () => {
    const staleOwnerScope = buildBootScopedOwnerScope('instance-a', 'boot-old');
    const freshDecision = classifyGatewayProcessWithoutState({
      processInfo: buildProcess({
        ageSeconds: 120,
        command: buildOwnedGatewayCommand({
          ownerScope: staleOwnerScope,
          libraryId: 'flib_demo',
        }),
      }),
      ownerEvidence: buildGatewayOwnerEvidence({
        localInstanceId: 'instance-a',
        scopeStatusByScope: new Map<string, 'active' | 'stale'>([
          [staleOwnerScope, 'stale'],
        ]),
      }),
      minAgeSeconds: 600,
    });
    const staleDecision = classifyGatewayProcessWithoutState({
      processInfo: buildProcess({
        ageSeconds: 1200,
        command: buildOwnedGatewayCommand({
          ownerScope: staleOwnerScope,
          libraryId: 'flib_demo',
        }),
      }),
      ownerEvidence: buildGatewayOwnerEvidence({
        localInstanceId: 'instance-a',
        scopeStatusByScope: new Map<string, 'active' | 'stale'>([
          [staleOwnerScope, 'stale'],
        ]),
      }),
      minAgeSeconds: 600,
    });

    expect(freshDecision).toEqual({
      action: 'keep',
      reason: 'process_too_fresh',
    });
    expect(staleDecision).toEqual({
      action: 'stop_gateway',
      reason: 'local_owner_boot_stale',
    });
  });

  it('reclaims a released owner-scoped untracked gateway immediately without waiting for stale age', () => {
    const releasedOwnerScope = buildBootScopedOwnerScope('instance-a', 'boot-released');
    const decision = classifyGatewayProcessWithoutState({
      processInfo: buildProcess({
        ageSeconds: 5,
        command: buildOwnedGatewayCommand({
          ownerScope: releasedOwnerScope,
          libraryId: 'flib_demo',
        }),
      }),
      ownerEvidence: buildGatewayOwnerEvidence({
        localInstanceId: 'instance-a',
        scopeStatusByScope: new Map<string, 'active' | 'stale' | 'released'>([
          [releasedOwnerScope, 'released'],
          [buildBootScopedOwnerScope('instance-a', 'boot-current'), 'active'],
        ]),
      }),
      minAgeSeconds: 600,
    });

    expect(decision).toEqual({
      action: 'stop_gateway',
      reason: 'owner_boot_released',
    });
  });

  it('fails open when a same-instance owner scope has no ledger evidence yet', () => {
    const unverifiedOwnerScope = buildBootScopedOwnerScope('instance-a', 'boot-unknown');
    const decision = classifyGatewayProcessWithoutState({
      processInfo: buildProcess({
        ageSeconds: 1200,
        command: buildOwnedGatewayCommand({
          ownerScope: unverifiedOwnerScope,
          libraryId: 'flib_demo',
        }),
      }),
      ownerEvidence: buildGatewayOwnerEvidence({
        localInstanceId: 'instance-a',
        scopeStatusByScope: new Map<string, 'active' | 'stale'>([
          [buildBootScopedOwnerScope('instance-a', 'boot-current'), 'active'],
        ]),
      }),
      minAgeSeconds: 600,
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'owner_scope_unverified',
    });
  });

  it('extracts the mountpoint from a local JuiceFS mount command with backend-real endpoints', () => {
    const mountPath = path.join(tmpdir(), 'agentsmith-real-file-library-ybtBMN');
    const command = [
      'juicefs',
      'mount',
      'postgresql://mbos:secret@127.0.0.1:25432/jfs_lib_demo?sslmode=disable',
      mountPath,
      '-d',
      '--bucket',
      'http://127.0.0.1:29000/jfs-lib-demo',
      '--attr-cache',
      '0',
    ].join(' ');

    expect(extractJuicefsMountPath(command)).toBe(mountPath);
  });

  it('reclaims AgentSmith-owned file-library temp mounts during full reset even when state is gone', () => {
    const mountPath = path.join(tmpdir(), 'agentsmith-real-file-library-ybtBMN');
    const decision = classifyAgentSmithOwnedMountProcess({
      processInfo: buildProcess({
        ageSeconds: 5,
        command: `juicefs mount postgresql://meta ${mountPath} -d --bucket http://127.0.0.1:29000/jfs-lib-demo`,
      }),
      mountPath,
      context: 'full-reset',
      minAgeSeconds: 600,
    });

    expect(decision).toEqual({
      action: 'reclaim_mount',
      reason: 'full_reset_agentsmith_temp_mount',
    });
  });

  it('keeps fresh AgentSmith-owned file-library temp mounts outside full reset but reclaims stale ones', () => {
    const mountPath = path.join(tmpdir(), 'agentsmith-real-file-library-ybtBMN');
    const freshDecision = classifyAgentSmithOwnedMountProcess({
      processInfo: buildProcess({ ageSeconds: 30 }),
      mountPath,
      context: 'file-library-real-gate',
      minAgeSeconds: 600,
    });
    const staleDecision = classifyAgentSmithOwnedMountProcess({
      processInfo: buildProcess({ ageSeconds: 1200 }),
      mountPath,
      context: 'file-library-real-gate',
      minAgeSeconds: 600,
    });

    expect(freshDecision).toEqual({
      action: 'keep',
      reason: 'process_too_fresh',
    });
    expect(staleDecision).toEqual({
      action: 'reclaim_mount',
      reason: 'agentsmith_temp_mount_stale',
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

  it('recognizes the runner process title used by notebook-codex-runner when deciding ownerless mount liveness', () => {
    const runnerProcess = buildRunnerTitleProcess(8100, 'runner-live');
    const livePids = new Set([runnerProcess.pid]);
    const anyRunnerAlive = hasAnyNotebookRunnerAlive({
      trackedRunnerPid: null,
      livePids,
      processes: [runnerProcess],
    });

    const decision = classifyTaskMountProcess({
      processInfo: buildProcess({
        command: `juicefs mount postgres://meta ${path.join('/home/percy', 'ags-workspace', 'task_demo')}`,
      }),
      anyRunnerAlive,
      livePids,
      ownerProcessPid: null,
      processTableByPid: new Map<number, ManagedProcessInfo>([
        [runnerProcess.pid, runnerProcess],
      ]),
    });

    expect(anyRunnerAlive).toBe(true);
    expect(decision).toEqual({
      action: 'keep',
      reason: 'runner_alive',
    });
  });

  it('recognizes canonical tsx src/index.ts launches only when cwd resolves to notebook-codex-runner', () => {
    const runnerProcess = buildCanonicalTsxRunnerProcess(8100);
    const livePids = new Set([runnerProcess.pid]);

    const anyRunnerAlive = hasAnyNotebookRunnerAlive({
      trackedRunnerPid: null,
      livePids,
      processes: [runnerProcess],
    });

    expect(anyRunnerAlive).toBe(true);
  });

  it('does not treat another package tsx src/index.ts launch as notebook runner liveness', () => {
    const apiProcess = buildCanonicalTsxRunnerProcess(8100, {
      cwd: '/home/percy/works/mbos-v1/agentsmith/packages/api-entry-node',
    });
    const livePids = new Set([apiProcess.pid]);

    const anyRunnerAlive = hasAnyNotebookRunnerAlive({
      trackedRunnerPid: null,
      livePids,
      processes: [apiProcess],
    });

    expect(anyRunnerAlive).toBe(false);
  });

  it('does not treat test-style commands that merely mention notebook-codex-runner as live runners', () => {
    const noisyProcess = buildNonRunnerNotebookCommandProcess(8100);
    const livePids = new Set([noisyProcess.pid]);
    const anyRunnerAlive = hasAnyNotebookRunnerAlive({
      trackedRunnerPid: null,
      livePids,
      processes: [noisyProcess],
    });

    expect(anyRunnerAlive).toBe(false);
  });

  it('does not reclaim ownerless mounts when the tracked runner pid is a live supervisor whose child is the canonical tsx runner', () => {
    const supervisorProcess = buildProcess({
      pid: 8100,
      command: 'make notebook-agent-runner',
    });
    const runnerProcess = buildCanonicalTsxRunnerProcess(8101, {
      ppid: supervisorProcess.pid,
    });
    const livePids = new Set([supervisorProcess.pid, runnerProcess.pid]);
    const processTableByPid = new Map<number, ManagedProcessInfo>([
      [supervisorProcess.pid, supervisorProcess],
      [runnerProcess.pid, runnerProcess],
    ]);
    const anyRunnerAlive = hasAnyNotebookRunnerAlive({
      trackedRunnerPid: supervisorProcess.pid,
      livePids,
      processes: [supervisorProcess, runnerProcess],
    });

    const decision = classifyTaskMountProcess({
      processInfo: buildProcess({
        command: `juicefs mount postgres://meta ${path.join('/home/percy', 'ags-workspace', 'task_demo')}`,
      }),
      anyRunnerAlive,
      livePids,
      ownerProcessPid: null,
      processTableByPid,
    });

    expect(anyRunnerAlive).toBe(true);
    expect(decision).toEqual({
      action: 'keep',
      reason: 'runner_alive',
    });
  });

  it('does not suppress ownerless mount cleanup when the persisted runner pid was reused by an unrelated process', () => {
    const reusedPidProcess = buildProcess({
      pid: 8100,
      command: 'node /tmp/unrelated-service.js',
    });
    const livePids = new Set([reusedPidProcess.pid]);
    const anyRunnerAlive = hasAnyNotebookRunnerAlive({
      trackedRunnerPid: reusedPidProcess.pid,
      livePids,
      processes: [reusedPidProcess],
    });

    const decision = classifyTaskMountProcess({
      processInfo: buildProcess({
        command: `juicefs mount postgres://meta ${path.join('/home/percy', 'ags-workspace', 'task_demo')}`,
      }),
      anyRunnerAlive,
      livePids,
      ownerProcessPid: null,
      processTableByPid: new Map<number, ManagedProcessInfo>([
        [reusedPidProcess.pid, reusedPidProcess],
      ]),
    });

    expect(anyRunnerAlive).toBe(false);
    expect(decision).toEqual({
      action: 'reclaim_mount',
      reason: 'runner_absent_for_host_mount',
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
      processTableByPid: new Map<number, ManagedProcessInfo>([
        [5100, buildRunnerProcess(5100, 'runner-live')],
      ]),
    });

    expect(decision).toEqual({
      action: 'keep',
      reason: 'mount_owner_alive',
    });
  });

  it('reclaims a mount when its recorded owner pid was reused by an unrelated process', () => {
    const decision = classifyTaskMountProcess({
      processInfo: buildProcess({
        command: `juicefs mount postgres://meta ${path.join('/home/percy', 'ags-workspace', 'task_demo')}`,
      }),
      anyRunnerAlive: true,
      livePids: new Set([5100]),
      ownerProcessPid: 5100,
      processTableByPid: new Map<number, ManagedProcessInfo>([
        [5100, buildProcess({
          pid: 5100,
          command: 'node /tmp/unrelated-service.js',
        })],
      ]),
    });

    expect(decision).toEqual({
      action: 'reclaim_mount',
      reason: 'mount_owner_pid_reused',
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
