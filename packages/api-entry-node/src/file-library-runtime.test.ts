import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensureGatewayOwnerInstanceId } from './file-library-gateway-ownership.js';
import { resolveApiEntryPackageRoot } from './file-library-gateway-paths.js';

import {
  RealFileLibraryGatewayManager,
  resolveFileLibraryMetadataUrlForDockerManualExternalExecution,
  getFileLibraryRuntimeReadiness,
  resolveFileLibraryMetadataUrlForComposeManagedExternalExecution,
  resolveFileLibraryMetadataUrlForExternalExecution,
  resolveFileLibraryMetadataUrlForInternalExecution,
  resolveFileLibraryRuntimeConfig,
  resolveFileLibraryStorageBucketUrlForDockerManualExternalExecution,
  resolveFileLibraryStorageBucketUrlForComposeManagedExternalExecution,
  resolveFileLibraryStorageBucketUrlForExternalExecution,
  resolveFileLibraryStorageBucketUrlForGatewayRuntime,
  resolveFileLibraryStorageBucketUrlForClientMount,
  resolveFileLibraryStorageBucketUrlForInternalExecution,
} from './file-library-runtime.js';

function createGatewayConfig(overrides: Partial<ConstructorParameters<typeof RealFileLibraryGatewayManager>[0]> = {}) {
  return {
    juicefsBin: 'juicefs',
    mcBin: 'mc',
    pgAdminUrl: 'postgresql://mbos:secret@localhost:15432/mbos',
    pgConnectHost: 'localhost',
    pgConnectPort: 15432,
    pgClientHost: 'localhost',
    pgClientPort: 15432,
    pgClientSslMode: undefined,
    minioAdminEndPoint: 'localhost',
    minioAdminPort: 19000,
    minioAdminUseSSL: false,
    minioAdminAccessKey: 'mbos',
    minioAdminSecretKey: 'secret',
    minioStorageEndpoint: 'http://localhost:19000',
    minioClientEndpoint: 'http://localhost:19000',
    minioRegion: 'us-east-1',
    gatewayPortBase: 39000,
    gatewayRootUserPrefix: 'flgw',
    gatewayRootPasswordSeed: 'seed',
    gatewayArtifactsRoot: join(tmpdir(), 'agentsmith-test-gateway-artifacts'),
    gatewayLogDir: join(tmpdir(), 'agentsmith-test-gateway-logs'),
    gatewayStateDir: join(tmpdir(), 'agentsmith-test-gateway-state'),
    ...overrides,
  } as ConstructorParameters<typeof RealFileLibraryGatewayManager>[0];
}

function createChild(
  pid: number,
  options?: { onKill?: (signal: NodeJS.Signals) => void },
) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    exitCode: number | null;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.stdout = stdout;
  child.stderr = stderr;
  child.exitCode = null;
  child.kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    options?.onKill?.(signal);
    return true;
  });
  return child as never;
}

function emitChildExit(
  child: EventEmitter & {
    exitCode: number | null;
  },
  code: number | null,
) {
  child.exitCode = code;
  child.emit('exit', code);
}

function mockFreePortProbe() {
  return vi.spyOn(net, 'createServer').mockImplementation(() => ({
    once: vi.fn().mockReturnThis(),
    listen: vi.fn((_: number, __: string, callback?: () => void) => {
      callback?.();
      return undefined;
    }),
    close: vi.fn((callback?: () => void) => {
      callback?.();
      return undefined;
    }),
  }) as unknown as net.Server);
}

function buildOwnedGatewayArgs(args: {
  ownerScope: string;
  libraryId: string;
  metadataUrl: string;
  listenAddress: string;
  storageBucketUrl?: string;
  logPath?: string;
}) {
  return [
    `juicefs owner_scope=${args.ownerScope} library_id=${args.libraryId}`,
    'gateway',
    args.metadataUrl,
    args.listenAddress,
    ...(args.storageBucketUrl ? ['--bucket', args.storageBucketUrl] : []),
    ...(args.logPath ? ['--log', args.logPath] : []),
    '--no-banner',
  ].join(' ');
}

function buildBootScopedOwnerScope(instanceId: string, bootId: string) {
  return `api-v1:${instanceId}:${bootId}`;
}

async function writeOwnerLedgerRecord(args: {
  artifactsRoot: string;
  instanceId: string;
  bootId: string;
  ownerProcessPid: number;
  heartbeatAt: string;
  startedAt?: string;
  releasedAt?: string;
}) {
  const ownershipDir = join(args.artifactsRoot, 'file-library-gateway-ownership');
  await mkdir(join(ownershipDir, 'boots'), { recursive: true });
  await writeFile(join(ownershipDir, 'instance.json'), JSON.stringify({
    instanceId: args.instanceId,
  }, null, 2), 'utf8');
  await writeFile(join(ownershipDir, 'boots', `${args.bootId}.json`), JSON.stringify({
    scope: buildBootScopedOwnerScope(args.instanceId, args.bootId),
    instanceId: args.instanceId,
    bootId: args.bootId,
    ownerProcessPid: args.ownerProcessPid,
    startedAt: args.startedAt ?? args.heartbeatAt,
    heartbeatAt: args.heartbeatAt,
    releasedAt: args.releasedAt,
  }, null, 2), 'utf8');
}

describe('file-library-runtime readiness', () => {
  it('converges concurrent owner instance id creation onto the persisted instance id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-owner-instance-race-'));
    const instanceIds = await Promise.all(
      Array.from({ length: 32 }, async () => ensureGatewayOwnerInstanceId(root)),
    );

    expect(new Set(instanceIds).size).toBe(1);
    expect(JSON.parse(
      await readFile(join(root, 'file-library-gateway-ownership', 'instance.json'), 'utf8'),
    )).toEqual({
      instanceId: instanceIds[0],
    });
  });

  it('reports missing executables and env explicitly', async () => {
    const readiness = await getFileLibraryRuntimeReadiness({
      juicefsBin: 'missing-juicefs-cli',
      mcBin: 'missing-mc-cli',
      env: {},
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.juicefs).toBe('missing');
    expect(readiness.checks.mc).toBe('missing');
    expect(readiness.checks.database_url).toBe('missing');
    expect(readiness.errors).toContain('file_library_juicefs_cli_missing');
    expect(readiness.errors).toContain('file_library_mc_cli_missing');
    expect(readiness.errors).toContain('file_library_env_missing_database_url');
    expect(readiness.errors).toContain('file_library_env_missing_minio_endpoint');
    expect(readiness.errors).toContain('file_library_env_missing_minio_access_key');
    expect(readiness.errors).toContain('file_library_env_missing_minio_secret_key');
  });

  it('separates internal provisioning endpoints from public mount endpoints', () => {
    const config = resolveFileLibraryRuntimeConfig({
      DATABASE_URL: 'postgresql://mbos:secret@postgres:5432/mbos',
      MINIO_ENDPOINT: 'minio',
      MINIO_PORT: '9000',
      MINIO_ACCESS_KEY: 'mbos',
      MINIO_SECRET_KEY: 'secret',
      FILE_LIBRARY_CLIENT_POSTGRES_HOST: 'files.example.com',
      FILE_LIBRARY_CLIENT_POSTGRES_PORT: '15432',
      FILE_LIBRARY_CLIENT_MINIO_ENDPOINT: 'https://files.example.com:19000',
    });

    expect(config.pgConnectHost).toBe('postgres');
    expect(config.pgConnectPort).toBe(5432);
    expect(config.pgClientHost).toBe('files.example.com');
    expect(config.pgClientPort).toBe(15432);
    expect(config.minioStorageEndpoint).toBe('http://minio:9000');
    expect(config.minioClientEndpoint).toBe('https://files.example.com:19000');
  });

  it('anchors gateway state and log directories to the api-entry package instead of caller cwd', async () => {
    const tempCwd = await mkdtemp(join(tmpdir(), 'gateway-cwd-drift-'));
    const originalCwd = process.cwd();
    process.chdir(tempCwd);
    try {
      const config = resolveFileLibraryRuntimeConfig({
        DATABASE_URL: 'postgresql://mbos:secret@postgres:5432/mbos',
        MINIO_ENDPOINT: 'minio',
        MINIO_PORT: '9000',
        MINIO_ACCESS_KEY: 'mbos',
        MINIO_SECRET_KEY: 'secret',
      });

      const packageRoot = resolveApiEntryPackageRoot();
      expect(config.gatewayLogDir).toBe(join(packageRoot, 'artifacts/file-library-gateway'));
      expect(config.gatewayStateDir).toBe(join(packageRoot, 'artifacts/file-library-gateway-state'));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('rewrites loopback file library access for external runner execution', () => {
    const env = {
      EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL: 'http://172.18.0.1:20000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForExternalExecution(
        'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@172.18.0.1:15432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForExternalExecution(
        'http://localhost:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://172.18.0.1:19000/jfs-lib-demo');
  });

  it('prefers explicit external runner JuiceFS overrides over execution API host inference', () => {
    const env = {
      EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL: 'http://host.docker.internal:20000',
      EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE: '192.168.0.220',
      EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE: '15432',
      EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE: 'http://192.168.0.220:19000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForExternalExecution(
        'postgres://jfsu_user:secret@files.example.com:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@192.168.0.220:15432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForExternalExecution(
        'https://files.example.com:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://192.168.0.220:19000/jfs-lib-demo');
  });

  it('rewrites loopback file library access for compose-managed external runner execution', () => {
    const env = {
      DATABASE_URL: 'postgresql://mbos:secret@postgres:5432/mbos',
      MINIO_ENDPOINT: 'minio',
      MINIO_PORT: '9000',
      MINIO_USE_SSL: 'false',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForComposeManagedExternalExecution(
        'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@postgres:5432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForComposeManagedExternalExecution(
        'http://localhost:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://minio:9000/jfs-lib-demo');
  });

  it('rewrites client-visible file library access for docker-manual external runner execution', () => {
    const env = {
      DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE: 'host.docker.internal',
      FILE_LIBRARY_CLIENT_POSTGRES_PORT: '15432',
      DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE: 'http://host.docker.internal:19000',
      MINIO_API_PORT: '19000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForDockerManualExternalExecution(
        'postgres://jfsu_user:secret@192.168.0.220:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@host.docker.internal:15432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForDockerManualExternalExecution(
        'http://192.168.0.220:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://host.docker.internal:19000/jfs-lib-demo');
  });

  it('does not guess docker-manual file library access when overrides are missing', () => {
    const env = {
      FILE_LIBRARY_CLIENT_POSTGRES_PORT: '15432',
      MINIO_API_PORT: '19000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForDockerManualExternalExecution(
        'postgres://jfsu_user:secret@192.168.0.220:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@192.168.0.220:15432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForDockerManualExternalExecution(
        'http://192.168.0.220:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://192.168.0.220:19000/jfs-lib-demo');
  });

  it('preserves non-loopback file library access for external runner execution', () => {
    const env = {
      EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL: 'http://172.18.0.1:20000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForExternalExecution(
        'postgres://jfsu_user:secret@postgres.example.internal:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@172.18.0.1:15432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForExternalExecution(
        'http://minio.example.internal:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://172.18.0.1:19000/jfs-lib-demo');
  });

  it('rewrites loopback file library access for internal agent execution', () => {
    const env = {
      INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE: 'postgres-external.agentsmith-sandbox.svc.cluster.local',
      INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE: '5432',
      JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForInternalExecution(
        'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForInternalExecution(
        'http://localhost:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/jfs-lib-demo');
  });

  it('rewrites client-visible file library access for internal agent execution', () => {
    const env = {
      INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE: 'postgres-external.agentsmith-sandbox.svc.cluster.local',
      INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE: '5432',
      JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryMetadataUrlForInternalExecution(
        'postgres://jfsu_user:secret@files.example.com:15432/jfs_lib_demo?sslmode=disable',
        env,
      ),
    ).toBe('postgres://jfsu_user:secret@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/jfs_lib_demo?sslmode=disable');

    expect(
      resolveFileLibraryStorageBucketUrlForInternalExecution(
        'https://files.example.com:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/jfs-lib-demo');
  });

  it('rewrites bucket urls for gateway runtime with a gateway-specific endpoint', () => {
    const env = {
      JUICEFS_BUCKET_ENDPOINT_FOR_GATEWAY: 'http://localhost:19000',
      JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryStorageBucketUrlForGatewayRuntime(
        'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/jfs-lib-demo',
        env,
      ),
    ).toBe('http://localhost:19000/jfs-lib-demo');
  });

  it('rewrites bucket urls for client mount access with a client-facing endpoint', () => {
    const env = {
      JUICEFS_BUCKET_ENDPOINT_FOR_CLIENT_MOUNT: 'https://files.example.com:19000',
    } as NodeJS.ProcessEnv;

    expect(
      resolveFileLibraryStorageBucketUrlForClientMount(
        'http://localhost:19000/jfs-lib-demo',
        env,
      ),
    ).toBe('https://files.example.com:19000/jfs-lib-demo');
  });

  it('reconciles stale same-instance no-state gateway processes from an older boot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-reconcile-'));
    const staleOwnerScope = buildBootScopedOwnerScope('instance-a', 'boot-old');
    await writeOwnerLedgerRecord({
      artifactsRoot: root,
      instanceId: 'instance-a',
      bootId: 'boot-old',
      ownerProcessPid: 999,
      heartbeatAt: '2026-04-02T18:00:00.000Z',
    });
    const kills: Array<{ pid: number; signal: string }> = [];
    const alive = new Set<number>([101, 102]);
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayArtifactsRoot: root,
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(),
        async listProcesses() {
          return [
            {
              pid: 101,
              args: buildOwnedGatewayArgs({
                ownerScope: staleOwnerScope,
                libraryId: 'flib_dup',
                metadataUrl: 'postgres://user:pass@localhost:15432/db',
                listenAddress: '127.0.0.1:39001',
                logPath: join(root, 'logs', 'owners', 'boot-old', 'flib_dup.log'),
              }),
              libraryId: null,
            },
            {
              pid: 102,
              args: buildOwnedGatewayArgs({
                ownerScope: staleOwnerScope,
                libraryId: 'flib_dup',
                metadataUrl: 'postgres://user:pass@localhost:15432/db',
                listenAddress: '127.0.0.1:39002',
                logPath: join(root, 'logs', 'owners', 'boot-old', 'flib_dup.log'),
              }),
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return alive.has(pid);
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
          alive.delete(pid);
        },
        wait: async () => undefined,
        fetch: vi.fn(),
        now: () => '2026-04-02T18:30:00.000Z',
        ownerPid: () => 999,
      },
    );

    await manager.reconcile();

    expect(kills).toEqual([
      { pid: 101, signal: 'SIGTERM' },
      { pid: 102, signal: 'SIGTERM' },
    ]);
  });

  it('ignores foreign no-state gateways that only share our JuiceFS naming scheme', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-reconcile-foreign-'));
    const kills: Array<{ pid: number; signal: string }> = [];
    const alive = new Set<number>([111]);
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(),
        async listProcesses() {
          return [
            {
              pid: 111,
              args: 'juicefs gateway postgres://other-user:secret@localhost:15432/jfs_lib_shared?sslmode=disable 127.0.0.1:49011 --bucket http://localhost:19000/jfs-lib-shared',
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return alive.has(pid);
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
          alive.delete(pid);
        },
        wait: async () => undefined,
        fetch: vi.fn(),
        now: () => '2026-04-02T18:30:00.000Z',
        ownerPid: () => 999,
      },
    );

    await manager.reconcile();

    expect(kills).toEqual([]);
  });

  it('reclaims only the exact state-backed orphan gateway when --log is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-reconcile-truncated-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_truncated.json'), JSON.stringify({
      libraryId: 'flib_truncated',
      pid: 999,
      port: 39012,
      loopbackUrl: 'http://127.0.0.1:39012',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_truncated?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-truncated',
      logPath: join(root, 'logs', 'flib_truncated.log'),
      lastStartedAt: '2026-04-02T18:31:00.000Z',
      ownerProcessPid: 444,
      ownerScope: 'api-pid-444',
      status: 'ready',
    }), 'utf8');

    const kills: Array<{ pid: number; signal: string }> = [];
    const alive = new Set<number>([111, 112, 113]);
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(),
        async listProcesses() {
          return [
            {
              pid: 111,
              args: buildOwnedGatewayArgs({
                ownerScope: 'api-pid-441',
                libraryId: 'flib_truncated',
                metadataUrl: 'postgres://other-user:secret@localhost:15432/jfs_lib_truncated?sslmode=disable',
                listenAddress: '127.0.0.1:39011',
                storageBucketUrl: 'http://localhost:19000/jfs-lib-truncated',
              }),
              libraryId: null,
            },
            {
              pid: 112,
              args: buildOwnedGatewayArgs({
                ownerScope: 'api-pid-444',
                libraryId: 'flib_truncated',
                metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_truncated?sslmode=disable',
                listenAddress: '127.0.0.1:39012',
                storageBucketUrl: 'http://localhost:19000/jfs-lib-truncated',
              }),
              libraryId: null,
            },
            {
              pid: 113,
              args: 'juicefs gateway postgres://user:pass@localhost:15432/postgres 127.0.0.1:39013',
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return alive.has(pid);
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
          alive.delete(pid);
        },
        wait: async () => undefined,
        fetch: vi.fn(),
        now: () => '2026-04-02T18:30:00.000Z',
        ownerPid: () => 999,
      },
    );

    await manager.reconcile();

    expect(kills).toEqual([
      { pid: 112, signal: 'SIGTERM' },
    ]);
    await expect(readFile(join(root, 'state', 'flib_truncated.json'), 'utf8')).rejects.toThrow();
  });

  it('persists an explicit owner scope marker when starting a gateway', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-owned-start-'));
    const spawnGateway = vi.fn(() => createChild(901));
    const globalFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    const freePortProbe = mockFreePortProbe();
    vi.stubGlobal('fetch', globalFetch);

    try {
      const manager = new RealFileLibraryGatewayManager(
        createGatewayConfig({
          gatewayArtifactsRoot: root,
          gatewayLogDir: join(root, 'logs'),
          gatewayStateDir: join(root, 'state'),
        }),
        {
          spawnGateway,
          async listProcesses() {
            return [];
          },
          processExists(pid) {
            return pid === 901;
          },
          killProcess: vi.fn(),
          wait: async () => undefined,
          fetch: vi.fn(async () => new Response('ok', { status: 200 })),
          now: () => '2026-04-02T18:40:00.000Z',
          ownerPid: () => 1000,
        },
      );

      await manager.ensureGateway({
        libraryId: 'flib_owned',
        filesystemName: 'flib-owned',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_owned?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-owned',
      });

      expect(spawnGateway).toHaveBeenCalledWith(
        'juicefs',
        [
          'gateway',
          'postgres://user:pass@localhost:15432/jfs_lib_owned?sslmode=disable',
          expect.stringMatching(/^127\.0\.0\.1:\d+$/),
          '--bucket',
          'http://localhost:19000/jfs-lib-owned',
          '--log',
          join(root, 'logs', 'flib_owned.log'),
          '--no-banner',
        ],
        expect.objectContaining({
          argv0: expect.stringMatching(/^juicefs owner_scope=api-v1:[^:\s]+:[^:\s]+ library_id=flib_owned$/),
        }),
      );

      const persisted = JSON.parse(await readFile(join(root, 'state', 'flib_owned.json'), 'utf8')) as {
        ownerProcessPid: number;
        ownerScope?: string;
      };
      expect(persisted.ownerProcessPid).toBe(1000);
      expect(persisted.ownerScope).toMatch(/^api-v1:[^:\s]+:[^:\s]+$/);

      const [, instanceId, bootId] = persisted.ownerScope?.match(/^api-v1:([^:\s]+):([^:\s]+)$/) ?? [];
      expect(instanceId).toBeTruthy();
      expect(bootId).toBeTruthy();
      expect(JSON.parse(await readFile(join(root, 'file-library-gateway-ownership', 'instance.json'), 'utf8'))).toEqual({
        instanceId,
      });
      expect(JSON.parse(
        await readFile(join(root, 'file-library-gateway-ownership', 'boots', `${bootId}.json`), 'utf8'),
      )).toEqual(expect.objectContaining({
        scope: persisted.ownerScope,
        instanceId,
        bootId,
        ownerProcessPid: 1000,
        heartbeatAt: '2026-04-02T18:40:00.000Z',
      }));
    } finally {
      freePortProbe.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('treats /minio/health/live as the gateway readiness authority instead of the bucket root', async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(join(tmpdir(), 'gateway-health-live-ready-'));
    const spawnGateway = vi.fn(() => createChild(901));
    const freePortProbe = mockFreePortProbe();
    const globalFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', globalFetch);

    try {
      const platformFetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === 'http://127.0.0.1:39000/minio/health/live') {
          return new Response('ok', { status: 200 });
        }
        if (url === 'http://127.0.0.1:39000/') {
          return new Response('AccessDenied', { status: 403 });
        }
        return new Response('unexpected', { status: 500 });
      });
      const manager = new RealFileLibraryGatewayManager(
        createGatewayConfig({
          gatewayArtifactsRoot: root,
          gatewayLogDir: join(root, 'logs'),
          gatewayStateDir: join(root, 'state'),
        }),
        {
          spawnGateway,
          async listProcesses() {
            return [];
          },
          processExists(pid) {
            return pid === 901;
          },
          killProcess: vi.fn(),
          wait: async () => undefined,
          fetch: platformFetch,
          now: () => '2026-04-02T18:40:00.000Z',
          ownerPid: () => 1000,
        },
      );

      const ensurePromise = manager.ensureGateway({
        libraryId: 'flib_health_live',
        filesystemName: 'flib-health-live',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_health_live?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-health-live',
      });
      const resolution = ensurePromise.then(
        (gateway) => ({ type: 'resolved' as const, gateway }),
        (error: unknown) => ({ type: 'rejected' as const, error }),
      );

      await vi.advanceTimersByTimeAsync(15_100);

      const outcome = await resolution;
      expect(outcome.type).toBe('resolved');
      if (outcome.type !== 'resolved') {
        throw outcome.error;
      }
      expect(outcome.gateway).toMatchObject({
        pid: 901,
        status: 'ready',
      });
      expect(platformFetch.mock.calls.some(([input]) => String(input) === 'http://127.0.0.1:39000/minio/health/live')).toBe(true);
    } finally {
      freePortProbe.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('reaps a state-backed gateway from an older boot even when the api pid was reused by a newer boot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-owner-pid-reuse-'));
    const staleOwnerScope = buildBootScopedOwnerScope('instance-a', 'boot-old');
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_pid_reuse.json'), JSON.stringify({
      libraryId: 'flib_pid_reuse',
      pid: 611,
      port: 39061,
      loopbackUrl: 'http://127.0.0.1:39061',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_pid_reuse?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-pid-reuse',
      logPath: join(root, 'logs', 'flib_pid_reuse.log'),
      lastStartedAt: '2026-04-02T18:05:00.000Z',
      ownerProcessPid: 444,
      ownerScope: staleOwnerScope,
      status: 'ready',
    }), 'utf8');
    await writeOwnerLedgerRecord({
      artifactsRoot: root,
      instanceId: 'instance-a',
      bootId: 'boot-old',
      ownerProcessPid: 444,
      heartbeatAt: '2026-04-02T18:05:00.000Z',
    });

    const kills: Array<{ pid: number; signal: string }> = [];
    const alive = new Set<number>([444, 611]);
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayArtifactsRoot: root,
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(),
        async listProcesses() {
          return [
            {
              pid: 611,
              args: buildOwnedGatewayArgs({
                ownerScope: staleOwnerScope,
                libraryId: 'flib_pid_reuse',
                metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_pid_reuse?sslmode=disable',
                listenAddress: '127.0.0.1:39061',
                storageBucketUrl: 'http://localhost:19000/jfs-lib-pid-reuse',
              }),
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return alive.has(pid);
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
          alive.delete(pid);
        },
        wait: async () => undefined,
        fetch: vi.fn(async () => new Response('ok', { status: 200 })),
        now: () => '2026-04-02T18:40:00.000Z',
        ownerPid: () => 444,
      },
    );

    await manager.reconcile();

    expect(kills).toEqual([{ pid: 611, signal: 'SIGTERM' }]);
    await expect(readFile(join(root, 'state', 'flib_pid_reuse.json'), 'utf8')).rejects.toThrow();
  });

  it('reuses a persisted healthy gateway instead of spawning a duplicate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-state-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_ready.json'), JSON.stringify({
      libraryId: 'flib_ready',
      pid: 501,
      port: 39051,
      loopbackUrl: 'http://127.0.0.1:39051',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_ready?sslmode=disable',
      logPath: join(root, 'logs', 'flib_ready.log'),
      lastStartedAt: '2026-04-02T18:31:00.000Z',
      ownerProcessPid: 321,
      status: 'ready',
    }), 'utf8');

    const spawnGateway = vi.fn();
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway,
        async listProcesses() {
          return [
            {
              pid: 501,
              args: `juicefs gateway postgres://user:pass@localhost:15432/jfs_lib_ready?sslmode=disable 127.0.0.1:39051 --log ${join(root, 'logs', 'flib_ready.log')} --no-banner`,
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return pid === 501 || pid === 321;
        },
        killProcess: vi.fn(),
        wait: async () => undefined,
        fetch: vi.fn(async () => new Response('ok', { status: 200 })),
        now: () => '2026-04-02T18:32:00.000Z',
        ownerPid: () => 1000,
      },
    );

    const gateway = await manager.ensureGateway({
      libraryId: 'flib_ready',
      filesystemName: 'flib-ready',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_ready?sslmode=disable',
    });

    expect(gateway.port).toBe(39051);
    expect(spawnGateway).not.toHaveBeenCalled();
  });

  it('lets direct ensureGateway bypass a hung startup reconcile for another library', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-startup-reconcile-hang-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_startup_hung.json'), JSON.stringify({
      libraryId: 'flib_startup_hung',
      pid: 701,
      port: 39071,
      loopbackUrl: 'http://127.0.0.1:39071',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_startup_hung?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-startup-hung',
      logPath: join(root, 'logs', 'flib_startup_hung.log'),
      lastStartedAt: '2026-04-02T18:35:00.000Z',
      status: 'ready',
    }), 'utf8');

    const spawnGateway = vi.fn(() => createChild(901));
    const freePortProbe = mockFreePortProbe();
    const globalFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', globalFetch);

    try {
      const manager = new RealFileLibraryGatewayManager(
        createGatewayConfig({
          gatewayArtifactsRoot: root,
          gatewayLogDir: join(root, 'logs'),
          gatewayStateDir: join(root, 'state'),
        }),
        {
          spawnGateway,
          async listProcesses() {
            return [
              {
                pid: 701,
                args: `juicefs gateway postgres://user:pass@localhost:15432/jfs_lib_startup_hung?sslmode=disable 127.0.0.1:39071 --bucket http://localhost:19000/jfs-lib-startup-hung --log ${join(root, 'logs', 'flib_startup_hung.log')} --no-banner`,
                libraryId: null,
              },
            ];
          },
          processExists(pid) {
            return pid === 701 || pid === 901;
          },
          killProcess: vi.fn(),
          wait: async () => undefined,
          fetch: vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.startsWith('http://127.0.0.1:39071/')) {
              return new Promise<Response>(() => undefined);
            }
            return new Response('ok', { status: 200 });
          }),
          now: () => '2026-04-02T18:36:00.000Z',
          ownerPid: () => 1000,
        },
      );

      const outcome = await Promise.race([
        manager.ensureGateway({
          libraryId: 'flib_direct_ensure',
          filesystemName: 'flib-direct-ensure',
          metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_direct_ensure?sslmode=disable',
          storageBucketUrl: 'http://localhost:19000/jfs-lib-direct-ensure',
        }).then((gateway) => ({ type: 'gateway' as const, gateway })),
        new Promise<{ type: 'timeout' }>((resolve) => setTimeout(() => resolve({ type: 'timeout' }), 100)),
      ]);

      expect(outcome.type).toBe('gateway');
      if (outcome.type === 'gateway') {
        expect(outcome.gateway.pid).toBe(901);
      }
    } finally {
      freePortProbe.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('does not restore or kill a persisted gateway when its pid was reused by an unrelated process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-pid-unrelated-ensure-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_pid_unrelated.json'), JSON.stringify({
      libraryId: 'flib_pid_unrelated',
      pid: 501,
      port: 39051,
      loopbackUrl: 'http://127.0.0.1:39051',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_pid_unrelated?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-pid-unrelated',
      logPath: join(root, 'logs', 'flib_pid_unrelated.log'),
      lastStartedAt: '2026-04-02T18:31:00.000Z',
      ownerProcessPid: 321,
      ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-current'),
      status: 'ready',
    }), 'utf8');
    await writeOwnerLedgerRecord({
      artifactsRoot: root,
      instanceId: 'instance-a',
      bootId: 'boot-current',
      ownerProcessPid: 321,
      heartbeatAt: '2026-04-02T18:31:45.000Z',
    });

    const kills: Array<{ pid: number; signal: string }> = [];
    const spawnGateway = vi.fn(() => createChild(901));
    const freePortProbe = mockFreePortProbe();
    const globalFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    const platformFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:39000/')) {
        return new Response('ok', { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', globalFetch);

    try {
      const manager = new RealFileLibraryGatewayManager(
        createGatewayConfig({
          gatewayArtifactsRoot: root,
          gatewayLogDir: join(root, 'logs'),
          gatewayStateDir: join(root, 'state'),
        }),
        {
          spawnGateway,
          async listProcesses() {
            return [
              {
                pid: 501,
                args: 'node /tmp/unrelated-server.js',
                libraryId: null,
              },
            ];
          },
          processExists(pid) {
            return pid === 321 || pid === 501 || pid === 901;
          },
          killProcess(pid, signal) {
            kills.push({ pid, signal });
          },
          wait: async () => undefined,
          fetch: platformFetch,
          now: () => '2026-04-02T18:32:00.000Z',
          ownerPid: () => 1000,
        },
      );

      const gateway = await manager.ensureGateway({
        libraryId: 'flib_pid_unrelated',
        filesystemName: 'flib-pid-unrelated',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_pid_unrelated?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-pid-unrelated',
      });

      expect(gateway.pid).toBe(901);
      expect(spawnGateway).toHaveBeenCalledTimes(1);
      expect(platformFetch).toHaveBeenCalledTimes(1);
      expect(String(platformFetch.mock.calls[0]?.[0] ?? '')).toContain('http://127.0.0.1:39000/');
      expect(kills).toEqual([]);
    } finally {
      freePortProbe.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('does not kill a reused pid from a stale managed-process snapshot during direct ensure reconciliation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-ensure-sequential-pid-reuse-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_ensure_sequential.json'), JSON.stringify({
      libraryId: 'flib_ensure_sequential',
      pid: 551,
      port: 39051,
      loopbackUrl: 'http://127.0.0.1:39051',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_ensure_sequential?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-ensure-sequential',
      logPath: join(root, 'logs', 'flib_ensure_sequential.log'),
      lastStartedAt: '2026-04-02T18:31:00.000Z',
      ownerProcessPid: 445,
      ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-old'),
      status: 'ready',
    }), 'utf8');
    await writeOwnerLedgerRecord({
      artifactsRoot: root,
      instanceId: 'instance-a',
      bootId: 'boot-old',
      ownerProcessPid: 445,
      heartbeatAt: '2026-04-02T18:00:00.000Z',
    });

    const kills: Array<{ pid: number; signal: string }> = [];
    const spawnGateway = vi.fn(() => createChild(901));
    const freePortProbe = mockFreePortProbe();
    const globalFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    const platformFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:39000/')) {
        return new Response('ok', { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    });
    let listProcessesCall = 0;
    vi.stubGlobal('fetch', globalFetch);

    try {
      const manager = new RealFileLibraryGatewayManager(
        createGatewayConfig({
          gatewayArtifactsRoot: root,
          gatewayLogDir: join(root, 'logs'),
          gatewayStateDir: join(root, 'state'),
        }),
        {
          spawnGateway,
          async listProcesses() {
            listProcessesCall += 1;
            if (listProcessesCall === 1) {
              return [];
            }
            if (listProcessesCall === 2) {
              return [
                {
                  pid: 551,
                  args: buildOwnedGatewayArgs({
                    ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-old'),
                    libraryId: 'flib_ensure_sequential',
                    metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_ensure_sequential?sslmode=disable',
                    listenAddress: '127.0.0.1:39051',
                    storageBucketUrl: 'http://localhost:19000/jfs-lib-ensure-sequential',
                    logPath: join(root, 'logs', 'flib_ensure_sequential.log'),
                  }),
                  libraryId: null,
                },
              ];
            }
            return [
              {
                pid: 551,
                args: 'node /tmp/unrelated-server.js',
                libraryId: null,
              },
            ];
          },
          processExists(pid) {
            return pid === 445 || pid === 551 || pid === 901;
          },
          killProcess(pid, signal) {
            kills.push({ pid, signal });
          },
          wait: async () => undefined,
          fetch: platformFetch,
          now: () => '2026-04-02T18:32:00.000Z',
          ownerPid: () => 1000,
        },
      );

      const gateway = await manager.ensureGateway({
        libraryId: 'flib_ensure_sequential',
        filesystemName: 'flib-ensure-sequential',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_ensure_sequential?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-ensure-sequential',
      });

      expect(gateway.pid).toBe(901);
      expect(spawnGateway).toHaveBeenCalledTimes(1);
      expect(kills).toEqual([]);
    } finally {
      freePortProbe.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  for (const persistedMode of ['missing', 'unverified'] as const) {
    it(`replaces a live current-boot child when persisted authority is ${persistedMode} without leaving the old process behind`, async () => {
      const root = await mkdtemp(join(tmpdir(), `gateway-owned-replacement-${persistedMode}-`));
      const libraryId = `flib_owned_replacement_${persistedMode}`;
      const kills: Array<{ pid: number; signal: string }> = [];
      const alive = new Set<number>([1000]);
      const children = new Map<number, ReturnType<typeof createChild>>();
      let nextPid = 901;

      const terminatePid = (pid: number, signal: NodeJS.Signals) => {
        kills.push({ pid, signal });
        alive.delete(pid);
        const child = children.get(pid);
        if (child) {
          emitChildExit(child, signal === 'SIGKILL' ? 137 : 0);
        }
      };

      const spawnGateway = vi.fn(() => {
        const pid = nextPid;
        nextPid += 1;
        alive.add(pid);
        const child = createChild(pid, {
          onKill(signal) {
            terminatePid(pid, signal);
          },
        });
        children.set(pid, child);
        return child;
      });

      const freePortProbe = mockFreePortProbe();
      const globalFetch = vi.fn(async () => new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', globalFetch);

      try {
        const manager = new RealFileLibraryGatewayManager(
          createGatewayConfig({
            gatewayArtifactsRoot: root,
            gatewayLogDir: join(root, 'logs'),
            gatewayStateDir: join(root, 'state'),
          }),
          {
            spawnGateway,
            async listProcesses() {
              if (persistedMode === 'unverified') {
                return [
                  {
                    pid: 901,
                    args: 'node /tmp/unrelated-server.js',
                    libraryId: null,
                  },
                ];
              }
              return [];
            },
            processExists(pid) {
              return alive.has(pid);
            },
            killProcess(pid, signal) {
              terminatePid(pid, signal);
            },
            wait: async () => undefined,
            fetch: vi.fn(async () => new Response('ok', { status: 200 })),
            now: () => '2026-04-02T18:40:00.000Z',
            ownerPid: () => 1000,
          },
        );

        const first = await manager.ensureGateway({
          libraryId,
          filesystemName: libraryId,
          metadataUrl: `postgres://user:pass@localhost:15432/jfs_${libraryId}?sslmode=disable`,
          storageBucketUrl: `http://localhost:19000/${libraryId}`,
        });

        if (persistedMode === 'missing') {
          await rm(join(root, 'state', `${libraryId}.json`), { force: true });
        }

        const second = await manager.ensureGateway({
          libraryId,
          filesystemName: libraryId,
          metadataUrl: `postgres://user:pass@localhost:15432/jfs_${libraryId}_replacement?sslmode=disable`,
          storageBucketUrl: `http://localhost:19000/${libraryId}-replacement`,
        });

        expect(first.pid).toBe(901);
        expect(second.pid).toBe(902);
        expect(spawnGateway).toHaveBeenCalledTimes(2);
        expect(kills).toEqual(expect.arrayContaining([{ pid: 901, signal: 'SIGTERM' }]));
        expect(alive.has(901)).toBe(false);
        expect(alive.has(902)).toBe(true);

        const sessions = Reflect.get(manager as object, 'sessions') as Map<string, { pid?: number }>;
        expect(sessions.get(libraryId)?.pid).toBe(902);

        const persisted = JSON.parse(await readFile(join(root, 'state', `${libraryId}.json`), 'utf8')) as {
          pid: number;
          metadataUrl: string;
          storageBucketUrl?: string;
        };
        expect(persisted.pid).toBe(902);
        expect(persisted.metadataUrl).toBe(`postgres://user:pass@localhost:15432/jfs_${libraryId}_replacement?sslmode=disable`);
        expect(persisted.storageBucketUrl).toBe(`http://localhost:19000/${libraryId}-replacement`);
      } finally {
        freePortProbe.mockRestore();
        vi.unstubAllGlobals();
      }
    });
  }

  it('does not let an exited old child clear a newer session or persisted state for the same library', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-exit-handler-race-'));
    const libraryId = 'flib_exit_race';
    const alive = new Set<number>([1000]);
    const freePortProbe = mockFreePortProbe();
    const globalFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', globalFetch);

    try {
      const manager = new RealFileLibraryGatewayManager(
        createGatewayConfig({
          gatewayArtifactsRoot: root,
          gatewayLogDir: join(root, 'logs'),
          gatewayStateDir: join(root, 'state'),
        }),
        {
          spawnGateway: vi.fn(() => {
            alive.add(901);
            return createChild(901);
          }),
          async listProcesses() {
            return [];
          },
          processExists(pid) {
            return alive.has(pid);
          },
          killProcess: vi.fn(),
          wait: async () => undefined,
          fetch: vi.fn(async () => new Response('ok', { status: 200 })),
          now: () => '2026-04-02T18:40:00.000Z',
          ownerPid: () => 1000,
        },
      );

      await manager.ensureGateway({
        libraryId,
        filesystemName: libraryId,
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_flib_exit_race?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-flib-exit-race',
      });

      const sessions = Reflect.get(manager as object, 'sessions') as Map<string, Record<string, unknown>>;
      const oldSession = sessions.get(libraryId) as {
        child: ReturnType<typeof createChild>;
      };
      const oldPersisted = JSON.parse(await readFile(join(root, 'state', `${libraryId}.json`), 'utf8')) as {
        ownerScope?: string;
      };
      const replacementSession = {
        loopbackUrl: 'http://127.0.0.1:39001',
        port: 39001,
        status: 'ready',
        lastStartedAt: '2026-04-02T18:41:00.000Z',
        pid: 902,
        child: createChild(902),
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_flib_exit_race_replacement?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-flib-exit-race-replacement',
        logPath: join(root, 'logs', `${libraryId}.log`),
        ownerScope: oldPersisted.ownerScope,
        sessionToken: 'replacement-session-token',
      };
      alive.delete(901);
      alive.add(902);
      sessions.set(libraryId, replacementSession);
      await writeFile(join(root, 'state', `${libraryId}.json`), JSON.stringify({
        libraryId,
        pid: 902,
        port: 39001,
        loopbackUrl: replacementSession.loopbackUrl,
        metadataUrl: replacementSession.metadataUrl,
        storageBucketUrl: replacementSession.storageBucketUrl,
        logPath: replacementSession.logPath,
        lastStartedAt: replacementSession.lastStartedAt,
        ownerProcessPid: 1000,
        ownerScope: replacementSession.ownerScope,
        sessionToken: replacementSession.sessionToken,
        status: 'ready',
      }, null, 2), 'utf8');

      emitChildExit(oldSession.child, 1);

      expect(sessions.get(libraryId)).toBe(replacementSession);
      const persisted = JSON.parse(await readFile(join(root, 'state', `${libraryId}.json`), 'utf8')) as {
        pid: number;
        sessionToken?: string;
      };
      expect(persisted.pid).toBe(902);
      expect(persisted.sessionToken).toBe('replacement-session-token');
    } finally {
      freePortProbe.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('fails closed when another active boot owns a healthy persisted gateway', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-foreign-ensure-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeOwnerLedgerRecord({
      artifactsRoot: root,
      instanceId: 'instance-a',
      bootId: 'boot-other',
      ownerProcessPid: 321,
      heartbeatAt: '2026-04-02T18:31:45.000Z',
    });
    await writeFile(join(root, 'state', 'flib_foreign_ready.json'), JSON.stringify({
      libraryId: 'flib_foreign_ready',
      pid: 501,
      port: 39051,
      loopbackUrl: 'http://127.0.0.1:39051',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_foreign_ready?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-foreign-ready',
      logPath: join(root, 'logs', 'flib_foreign_ready.log'),
      lastStartedAt: '2026-04-02T18:31:00.000Z',
      ownerProcessPid: 321,
      ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-other'),
      status: 'ready',
    }), 'utf8');

    const kills: Array<{ pid: number; signal: string }> = [];
    const spawnGateway = vi.fn();
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayArtifactsRoot: root,
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway,
        async listProcesses() {
          return [
            {
              pid: 501,
              args: buildOwnedGatewayArgs({
                ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-other'),
                libraryId: 'flib_foreign_ready',
                metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_foreign_ready?sslmode=disable',
                listenAddress: '127.0.0.1:39051',
                storageBucketUrl: 'http://localhost:19000/jfs-lib-foreign-ready',
                logPath: join(root, 'logs', 'flib_foreign_ready.log'),
              }),
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return pid === 321 || pid === 501;
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
        },
        wait: async () => undefined,
        fetch: vi.fn(async () => new Response('ok', { status: 200 })),
        now: () => '2026-04-02T18:32:00.000Z',
        ownerPid: () => 1000,
      },
    );

    await expect(manager.ensureGateway({
      libraryId: 'flib_foreign_ready',
      filesystemName: 'flib-foreign-ready',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_foreign_ready?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-foreign-ready',
    })).rejects.toThrow('file_library_gateway_owned_by_another_active_boot');

    expect(spawnGateway).not.toHaveBeenCalled();
    expect(kills).toEqual([]);
    expect((Reflect.get(manager as object, 'sessions') as Map<string, unknown>).has('flib_foreign_ready')).toBe(false);
  });

  it('reaps a persisted healthy gateway when its recorded owner pid is dead', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-orphan-owner-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_orphan.json'), JSON.stringify({
      libraryId: 'flib_orphan',
      pid: 601,
      port: 39061,
      loopbackUrl: 'http://127.0.0.1:39061',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_orphan?sslmode=disable',
      logPath: join(root, 'logs', 'flib_orphan.log'),
      lastStartedAt: '2026-04-02T18:32:00.000Z',
      ownerProcessPid: 444,
      status: 'ready',
    }), 'utf8');

    const kills: Array<{ pid: number; signal: string }> = [];
    const alive = new Set<number>([601]);
    const fetchSpy = vi.fn(async () => new Response('ok', { status: 200 }));
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(),
        async listProcesses() {
          return [
            {
              pid: 601,
              args: `juicefs gateway postgres://user:pass@localhost:15432/jfs_lib_orphan?sslmode=disable 127.0.0.1:39061 --log ${join(root, 'logs', 'flib_orphan.log')} --no-banner`,
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return alive.has(pid);
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
          alive.delete(pid);
        },
        wait: async () => undefined,
        fetch: fetchSpy,
        now: () => '2026-04-02T18:33:00.000Z',
        ownerPid: () => 1000,
      },
    );

    await manager.reconcile();

    expect(kills).toEqual([{ pid: 601, signal: 'SIGTERM' }]);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(readFile(join(root, 'state', 'flib_orphan.json'), 'utf8')).rejects.toThrow();
  });

  it('reconfirms authority before killing a stale persisted gateway when pid reuse happens after reconcile snapshotting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-reconcile-sequential-pid-reuse-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_reconcile_sequential.json'), JSON.stringify({
      libraryId: 'flib_reconcile_sequential',
      pid: 621,
      port: 39061,
      loopbackUrl: 'http://127.0.0.1:39061',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_reconcile_sequential?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-reconcile-sequential',
      logPath: join(root, 'logs', 'flib_reconcile_sequential.log'),
      lastStartedAt: '2026-04-02T18:05:00.000Z',
      ownerProcessPid: 445,
      ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-old'),
      status: 'ready',
    }), 'utf8');
    await writeOwnerLedgerRecord({
      artifactsRoot: root,
      instanceId: 'instance-a',
      bootId: 'boot-old',
      ownerProcessPid: 445,
      heartbeatAt: '2026-04-02T18:05:00.000Z',
    });

    const kills: Array<{ pid: number; signal: string }> = [];
    let listProcessesCall = 0;
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayArtifactsRoot: root,
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(),
        async listProcesses() {
          listProcessesCall += 1;
          if (listProcessesCall === 1) {
            return [];
          }
          if (listProcessesCall === 2) {
            return [
              {
                pid: 621,
                args: buildOwnedGatewayArgs({
                  ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-old'),
                  libraryId: 'flib_reconcile_sequential',
                  metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_reconcile_sequential?sslmode=disable',
                  listenAddress: '127.0.0.1:39061',
                  storageBucketUrl: 'http://localhost:19000/jfs-lib-reconcile-sequential',
                  logPath: join(root, 'logs', 'flib_reconcile_sequential.log'),
                }),
                libraryId: null,
              },
            ];
          }
          return [
            {
              pid: 621,
              args: 'node /tmp/unrelated-server.js',
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return pid === 445 || pid === 621;
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
        },
        wait: async () => undefined,
        fetch: vi.fn(async () => new Response('ok', { status: 200 })),
        now: () => '2026-04-02T18:40:00.000Z',
        ownerPid: () => 444,
      },
    );

    await Reflect.get(manager as object, 'reconcilePromise');
    await manager.reconcile();

    expect(kills).toEqual([]);
    await expect(readFile(join(root, 'state', 'flib_reconcile_sequential.json'), 'utf8')).resolves.toContain('"libraryId":"flib_reconcile_sequential"');
  });

  it('migrates ownerless persisted gateways after validating the live loopback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-legacy-ownerless-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_legacy.json'), JSON.stringify({
      libraryId: 'flib_legacy',
      pid: 701,
      port: 39071,
      loopbackUrl: 'http://127.0.0.1:39071',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_legacy?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-legacy',
      logPath: join(root, 'logs', 'flib_legacy.log'),
      lastStartedAt: '2026-04-02T18:35:00.000Z',
      status: 'ready',
    }), 'utf8');

    const kills: Array<{ pid: number; signal: string }> = [];
    const alive = new Set<number>([701, 1000]);
    const fetchSpy = vi.fn(async () => new Response('ok', { status: 200 }));
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(),
        async listProcesses() {
          return [
            {
              pid: 701,
              args: `juicefs gateway postgres://user:pass@localhost:15432/jfs_lib_legacy?sslmode=disable 127.0.0.1:39071 --log ${join(root, 'logs', 'flib_legacy.log')} --no-banner`,
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return alive.has(pid);
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
          alive.delete(pid);
        },
        wait: async () => undefined,
        fetch: fetchSpy,
        now: () => '2026-04-02T18:36:00.000Z',
        ownerPid: () => 1000,
      },
    );

    await manager.reconcile();

    expect(kills).toEqual([]);
    expect(fetchSpy).toHaveBeenCalled();
    const migrated = JSON.parse(await readFile(join(root, 'state', 'flib_legacy.json'), 'utf8')) as { ownerProcessPid: number; status: string };
    expect(migrated.ownerProcessPid).toBe(1000);
    expect(migrated.status).toBe('ready');
  });

  it('fails closed and removes ownerless persisted gateways when validation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-legacy-ownerless-fail-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_legacy_fail.json'), JSON.stringify({
      libraryId: 'flib_legacy_fail',
      pid: 702,
      port: 39072,
      loopbackUrl: 'http://127.0.0.1:39072',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_legacy_fail?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-legacy-fail',
      logPath: join(root, 'logs', 'flib_legacy_fail.log'),
      lastStartedAt: '2026-04-02T18:37:00.000Z',
      status: 'ready',
    }), 'utf8');

    const kills: Array<{ pid: number; signal: string }> = [];
    const alive = new Set<number>([702]);
    const fetchSpy = vi.fn(async () => { throw new Error('connection refused'); });
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(),
        async listProcesses() {
          return [
            {
              pid: 702,
              args: `juicefs gateway postgres://user:pass@localhost:15432/jfs_lib_legacy_fail?sslmode=disable 127.0.0.1:39072 --log ${join(root, 'logs', 'flib_legacy_fail.log')} --no-banner`,
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return alive.has(pid);
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
          alive.delete(pid);
        },
        wait: async () => undefined,
        fetch: fetchSpy,
        now: () => '2026-04-02T18:38:00.000Z',
        ownerPid: () => 1000,
      },
    );

    await manager.reconcile();

    expect(kills).toEqual([{ pid: 702, signal: 'SIGTERM' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect(readFile(join(root, 'state', 'flib_legacy_fail.json'), 'utf8')).rejects.toThrow();
  });

  it('reaps the legacy live gateway before replacing it when the persisted pid drifts before owner marker migration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-legacy-live-drift-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_legacy_live.json'), JSON.stringify({
      libraryId: 'flib_legacy_live',
      pid: 701,
      port: 39071,
      loopbackUrl: 'http://127.0.0.1:39071',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_legacy_live?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-legacy-live',
      logPath: join(root, 'logs', 'flib_legacy_live.log'),
      lastStartedAt: '2026-04-02T18:37:00.000Z',
      ownerProcessPid: 444,
      status: 'ready',
    }), 'utf8');

    const kills: Array<{ pid: number; signal: string }> = [];
    const alive = new Set<number>([702, 1000]);
    const spawnGateway = vi.fn(() => createChild(901));
    const freePortProbe = mockFreePortProbe();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('http://127.0.0.1:39071/')) {
        return new Response('ok', { status: 200 });
      }
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const manager = new RealFileLibraryGatewayManager(
        createGatewayConfig({
          gatewayArtifactsRoot: root,
          gatewayLogDir: join(root, 'logs'),
          gatewayStateDir: join(root, 'state'),
        }),
        {
          spawnGateway,
          async listProcesses() {
            return [
              {
                pid: 702,
                args: `juicefs gateway postgres://user:pass@localhost:15432/jfs_lib_legacy_live?sslmode=disable 127.0.0.1:39071 --bucket http://localhost:19000/jfs-lib-legacy-live --log ${join(root, 'logs', 'flib_legacy_live.log')} --no-banner`,
                libraryId: null,
              },
            ];
          },
          processExists(pid) {
            return alive.has(pid);
          },
          killProcess(pid, signal) {
            kills.push({ pid, signal });
            alive.delete(pid);
          },
          wait: async () => undefined,
          fetch: fetchSpy,
          now: () => '2026-04-02T18:38:00.000Z',
          ownerPid: () => 1000,
        },
      );

      const gateway = await manager.ensureGateway({
        libraryId: 'flib_legacy_live',
        filesystemName: 'flib-legacy-live',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_legacy_live?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-legacy-live',
      });

      expect(kills).toEqual([{ pid: 702, signal: 'SIGTERM' }]);
      expect(spawnGateway).toHaveBeenCalledTimes(1);
      expect(gateway.port).toBe(39000);

      const migrated = JSON.parse(await readFile(join(root, 'state', 'flib_legacy_live.json'), 'utf8')) as {
        pid: number;
        ownerProcessPid: number;
        ownerScope?: string;
        status: string;
      };
      expect(migrated.pid).toBe(901);
      expect(migrated.ownerProcessPid).toBe(1000);
      expect(migrated.ownerScope).toMatch(/^api-v1:[^:\s]+:[^:\s]+$/);
      expect(migrated.status).toBe('ready');
    } finally {
      freePortProbe.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('self-heals orphaned persisted gateways discovered after startup health checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-orphan-health-'));
    await mkdir(join(root, 'state'), { recursive: true });

    const kills: Array<{ pid: number; signal: string }> = [];
    const alive = new Set<number>([602]);
    const fetchSpy = vi.fn(async () => new Response('ok', { status: 200 }));
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(),
        async listProcesses() {
          return [
            {
              pid: 602,
              args: `juicefs gateway postgres://user:pass@localhost:15432/jfs_lib_orphan_after_start?sslmode=disable 127.0.0.1:39062 --log ${join(root, 'logs', 'flib_orphan_after_start.log')} --no-banner`,
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return alive.has(pid);
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
          alive.delete(pid);
        },
        wait: async () => undefined,
        fetch: fetchSpy,
        now: () => '2026-04-02T18:34:00.000Z',
        ownerPid: () => 1001,
      },
    );

    await writeFile(join(root, 'state', 'flib_orphan_after_start.json'), JSON.stringify({
      libraryId: 'flib_orphan_after_start',
      pid: 602,
      port: 39062,
      loopbackUrl: 'http://127.0.0.1:39062',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_orphan_after_start?sslmode=disable',
      logPath: join(root, 'logs', 'flib_orphan_after_start.log'),
      lastStartedAt: '2026-04-02T18:34:00.000Z',
      ownerProcessPid: 445,
      status: 'ready',
    }), 'utf8');

    const health = await manager.getHealth('flib_orphan_after_start');

    expect(health.status).toBe('stopped');
    expect(kills).toEqual([{ pid: 602, signal: 'SIGTERM' }]);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(readFile(join(root, 'state', 'flib_orphan_after_start.json'), 'utf8')).rejects.toThrow();
  });

  it('fails open when a stale persisted gateway pid was reused by an unrelated process during health reconciliation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-health-pid-unrelated-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_health_pid_unrelated.json'), JSON.stringify({
      libraryId: 'flib_health_pid_unrelated',
      pid: 602,
      port: 39062,
      loopbackUrl: 'http://127.0.0.1:39062',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_health_pid_unrelated?sslmode=disable',
      logPath: join(root, 'logs', 'flib_health_pid_unrelated.log'),
      lastStartedAt: '2026-04-02T18:34:00.000Z',
      ownerProcessPid: 445,
      ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-old'),
      status: 'ready',
    }), 'utf8');
    await writeOwnerLedgerRecord({
      artifactsRoot: root,
      instanceId: 'instance-a',
      bootId: 'boot-old',
      ownerProcessPid: 445,
      heartbeatAt: '2026-04-02T18:00:00.000Z',
    });

    const kills: Array<{ pid: number; signal: string }> = [];
    const fetchSpy = vi.fn(async () => new Response('ok', { status: 200 }));
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayArtifactsRoot: root,
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(),
        async listProcesses() {
          return [
            {
              pid: 602,
              args: 'node /tmp/unrelated-server.js',
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return pid === 445 || pid === 602;
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
        },
        wait: async () => undefined,
        fetch: fetchSpy,
        now: () => '2026-04-02T18:34:00.000Z',
        ownerPid: () => 1001,
      },
    );

    const health = await manager.getHealth('flib_health_pid_unrelated');

    expect(health.status).toBe('stopped');
    expect(kills).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(readFile(join(root, 'state', 'flib_health_pid_unrelated.json'), 'utf8')).resolves.toContain('"libraryId":"flib_health_pid_unrelated"');
  });

  it('keeps foreign active persisted gateways out of sessions so shutdown stays read-only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-foreign-health-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeOwnerLedgerRecord({
      artifactsRoot: root,
      instanceId: 'instance-a',
      bootId: 'boot-other',
      ownerProcessPid: 654,
      heartbeatAt: '2026-04-02T18:33:45.000Z',
    });
    await writeFile(join(root, 'state', 'flib_foreign_health.json'), JSON.stringify({
      libraryId: 'flib_foreign_health',
      pid: 604,
      port: 39064,
      loopbackUrl: 'http://127.0.0.1:39064',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_foreign_health?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-foreign-health',
      logPath: join(root, 'logs', 'flib_foreign_health.log'),
      lastStartedAt: '2026-04-02T18:33:00.000Z',
      ownerProcessPid: 654,
      ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-other'),
      status: 'ready',
    }), 'utf8');

    const kills: Array<{ pid: number; signal: string }> = [];
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayArtifactsRoot: root,
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(),
        async listProcesses() {
          return [
            {
              pid: 604,
              args: buildOwnedGatewayArgs({
                ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-other'),
                libraryId: 'flib_foreign_health',
                metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_foreign_health?sslmode=disable',
                listenAddress: '127.0.0.1:39064',
                storageBucketUrl: 'http://localhost:19000/jfs-lib-foreign-health',
                logPath: join(root, 'logs', 'flib_foreign_health.log'),
              }),
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return pid === 604 || pid === 654;
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
        },
        wait: async () => undefined,
        fetch: vi.fn(async () => new Response('ok', { status: 200 })),
        now: () => '2026-04-02T18:34:00.000Z',
        ownerPid: () => 1001,
      },
    );

    const health = await manager.getHealth('flib_foreign_health');

    expect(health.status).toBe('stopped');
    expect((Reflect.get(manager as object, 'sessions') as Map<string, unknown>).has('flib_foreign_health')).toBe(false);

    await manager.shutdown();

    expect(kills).toEqual([]);
    await expect(readFile(join(root, 'state', 'flib_foreign_health.json'), 'utf8')).resolves.toContain('"libraryId":"flib_foreign_health"');
  });

  it('replaces a degraded persisted gateway after getHealth instead of reusing its cached session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-health-ensure-interleave-'));
    await mkdir(join(root, 'state'), { recursive: true });

    const alive = new Set<number>([602, 1000]);
    const kills: Array<{ pid: number; signal: string }> = [];
    const spawnGateway = vi.fn(() => {
      alive.add(603);
      return createChild(603);
    });
    const freePortProbe = mockFreePortProbe();
    const globalFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', globalFetch);

    try {
      const manager = new RealFileLibraryGatewayManager(
        createGatewayConfig({
          gatewayArtifactsRoot: root,
          gatewayLogDir: join(root, 'logs'),
          gatewayStateDir: join(root, 'state'),
        }),
        {
          spawnGateway,
          async listProcesses() {
            const ownerRuntime = await (
              Reflect.get(manager as object, 'ownerRuntimePromise') as Promise<{ ownerScope: string }>
            );
            return alive.has(602)
              ? [
                {
                  pid: 602,
                  args: buildOwnedGatewayArgs({
                    ownerScope: ownerRuntime.ownerScope,
                    libraryId: 'flib_health_then_ensure',
                    metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_health_then_ensure?sslmode=disable',
                    listenAddress: '127.0.0.1:39062',
                    storageBucketUrl: 'http://localhost:19000/jfs-lib-health-then-ensure',
                    logPath: join(root, 'logs', 'flib_health_then_ensure.log'),
                  }),
                  libraryId: null,
                },
              ]
              : [];
          },
          processExists(pid) {
            return alive.has(pid);
          },
          killProcess(pid, signal) {
            kills.push({ pid, signal });
            alive.delete(pid);
          },
          wait: async () => undefined,
          fetch: vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.startsWith('http://127.0.0.1:39062/')) {
              throw new Error('gateway_unreachable');
            }
            return new Response('ok', { status: 200 });
          }),
          now: () => '2026-04-02T18:34:00.000Z',
          ownerPid: () => 1000,
        },
      );

      const ownerRuntime = await (
        Reflect.get(manager as object, 'ownerRuntimePromise') as Promise<{ ownerScope: string }>
      );

      await writeFile(join(root, 'state', 'flib_health_then_ensure.json'), JSON.stringify({
        libraryId: 'flib_health_then_ensure',
        pid: 602,
        port: 39062,
        loopbackUrl: 'http://127.0.0.1:39062',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_health_then_ensure?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-health-then-ensure',
        logPath: join(root, 'logs', 'flib_health_then_ensure.log'),
        lastStartedAt: '2026-04-02T18:34:00.000Z',
        ownerProcessPid: 1000,
        ownerScope: ownerRuntime.ownerScope,
        status: 'ready',
      }), 'utf8');

      const health = await manager.getHealth('flib_health_then_ensure');

      expect(health.status).toBe('degraded');

      const gateway = await manager.ensureGateway({
        libraryId: 'flib_health_then_ensure',
        filesystemName: 'flib-health-then-ensure',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_health_then_ensure?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-health-then-ensure',
      });

      expect(gateway.pid).toBe(603);
      expect(spawnGateway).toHaveBeenCalledTimes(1);
      expect(kills).toEqual([{ pid: 602, signal: 'SIGTERM' }]);
    } finally {
      freePortProbe.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('fails closed when a persisted gateway probe returns 503 and replaces it instead of restoring the old session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-http-503-fail-closed-'));
    await mkdir(join(root, 'state'), { recursive: true });

    const alive = new Set<number>([602, 1000]);
    const kills: Array<{ pid: number; signal: string }> = [];
    const spawnGateway = vi.fn(() => {
      alive.add(603);
      return createChild(603);
    });
    const freePortProbe = mockFreePortProbe();

    try {
      const manager = new RealFileLibraryGatewayManager(
        createGatewayConfig({
          gatewayArtifactsRoot: root,
          gatewayLogDir: join(root, 'logs'),
          gatewayStateDir: join(root, 'state'),
        }),
        {
          spawnGateway,
          async listProcesses() {
            const ownerRuntime = await (
              Reflect.get(manager as object, 'ownerRuntimePromise') as Promise<{ ownerScope: string }>
            );
            return alive.has(602)
              ? [
                {
                  pid: 602,
                  args: buildOwnedGatewayArgs({
                    ownerScope: ownerRuntime.ownerScope,
                    libraryId: 'flib_http_503',
                    metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_http_503?sslmode=disable',
                    listenAddress: '127.0.0.1:39062',
                    storageBucketUrl: 'http://localhost:19000/jfs-lib-http-503',
                    logPath: join(root, 'logs', 'flib_http_503.log'),
                  }),
                  libraryId: null,
                },
              ]
              : [];
          },
          processExists(pid) {
            return alive.has(pid);
          },
          killProcess(pid, signal) {
            kills.push({ pid, signal });
            alive.delete(pid);
          },
          wait: async () => undefined,
          fetch: vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.startsWith('http://127.0.0.1:39062/')) {
              return new Response('gateway unavailable', { status: 503 });
            }
            return new Response('ok', { status: 200 });
          }),
          now: () => '2026-04-02T18:34:00.000Z',
          ownerPid: () => 1000,
        },
      );

      const ownerRuntime = await (
        Reflect.get(manager as object, 'ownerRuntimePromise') as Promise<{ ownerScope: string }>
      );

      await writeFile(join(root, 'state', 'flib_http_503.json'), JSON.stringify({
        libraryId: 'flib_http_503',
        pid: 602,
        port: 39062,
        loopbackUrl: 'http://127.0.0.1:39062',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_http_503?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-http-503',
        logPath: join(root, 'logs', 'flib_http_503.log'),
        lastStartedAt: '2026-04-02T18:34:00.000Z',
        ownerProcessPid: 1000,
        ownerScope: ownerRuntime.ownerScope,
        status: 'ready',
      }), 'utf8');

      const gateway = await manager.ensureGateway({
        libraryId: 'flib_http_503',
        filesystemName: 'flib-http-503',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_http_503?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-http-503',
      });

      expect(gateway.pid).toBe(603);
      expect(spawnGateway).toHaveBeenCalledTimes(1);
      expect(kills).toEqual([{ pid: 602, signal: 'SIGTERM' }]);
    } finally {
      freePortProbe.mockRestore();
    }
  });

  it('stops a gateway from persisted state even when memory session is gone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-stop-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_stop.json'), JSON.stringify({
      libraryId: 'flib_stop',
      pid: 777,
      port: 39077,
      loopbackUrl: 'http://127.0.0.1:39077',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_stop?sslmode=disable',
      logPath: join(root, 'logs', 'flib_stop.log'),
      lastStartedAt: '2026-04-02T18:33:00.000Z',
      ownerProcessPid: 222,
      status: 'ready',
    }), 'utf8');

    const kills: Array<{ pid: number; signal: string }> = [];
    let alive = true;
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(() => createChild(888)),
        async listProcesses() {
          return [
            {
              pid: 777,
              args: `juicefs gateway postgres://user:pass@localhost:15432/jfs_lib_stop?sslmode=disable 127.0.0.1:39077 --log ${join(root, 'logs', 'flib_stop.log')} --no-banner`,
              libraryId: null,
            },
          ];
        },
        processExists() {
          return alive;
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
          alive = false;
        },
        wait: async () => undefined,
        fetch: vi.fn(),
        now: () => '2026-04-02T18:34:00.000Z',
        ownerPid: () => 2000,
      },
    );

    await manager.stopGateway('flib_stop');

    expect(kills).toEqual([{ pid: 777, signal: 'SIGTERM' }]);
  });

  it('does not stop or remove a persisted gateway from another active boot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-stop-foreign-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeOwnerLedgerRecord({
      artifactsRoot: root,
      instanceId: 'instance-a',
      bootId: 'boot-other',
      ownerProcessPid: 722,
      heartbeatAt: '2026-04-02T18:35:45.000Z',
    });
    await writeFile(join(root, 'state', 'flib_stop_foreign.json'), JSON.stringify({
      libraryId: 'flib_stop_foreign',
      pid: 777,
      port: 39077,
      loopbackUrl: 'http://127.0.0.1:39077',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_stop_foreign?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-stop-foreign',
      logPath: join(root, 'logs', 'flib_stop_foreign.log'),
      lastStartedAt: '2026-04-02T18:33:00.000Z',
      ownerProcessPid: 722,
      ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-other'),
      status: 'ready',
    }), 'utf8');

    const kills: Array<{ pid: number; signal: string }> = [];
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayArtifactsRoot: root,
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(() => createChild(888)),
        async listProcesses() {
          return [];
        },
        processExists(pid) {
          return pid === 777 || pid === 722;
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
        },
        wait: async () => undefined,
        fetch: vi.fn(),
        now: () => '2026-04-02T18:34:00.000Z',
        ownerPid: () => 2000,
      },
    );

    await manager.stopGateway('flib_stop_foreign');

    expect(kills).toEqual([]);
    await expect(readFile(join(root, 'state', 'flib_stop_foreign.json'), 'utf8')).resolves.toContain('"libraryId":"flib_stop_foreign"');
  });

  it('does not stop or remove a persisted gateway when its pid was reused by an unrelated process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-stop-unrelated-'));
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'flib_stop_unrelated.json'), JSON.stringify({
      libraryId: 'flib_stop_unrelated',
      pid: 778,
      port: 39078,
      loopbackUrl: 'http://127.0.0.1:39078',
      metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_stop_unrelated?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-stop-unrelated',
      logPath: join(root, 'logs', 'flib_stop_unrelated.log'),
      lastStartedAt: '2026-04-02T18:33:00.000Z',
      ownerProcessPid: 222,
      ownerScope: buildBootScopedOwnerScope('instance-a', 'boot-current'),
      status: 'ready',
    }), 'utf8');
    await writeOwnerLedgerRecord({
      artifactsRoot: root,
      instanceId: 'instance-a',
      bootId: 'boot-current',
      ownerProcessPid: 222,
      heartbeatAt: '2026-04-02T18:35:45.000Z',
    });

    const kills: Array<{ pid: number; signal: string }> = [];
    const manager = new RealFileLibraryGatewayManager(
      createGatewayConfig({
        gatewayArtifactsRoot: root,
        gatewayLogDir: join(root, 'logs'),
        gatewayStateDir: join(root, 'state'),
      }),
      {
        spawnGateway: vi.fn(() => createChild(888)),
        async listProcesses() {
          return [
            {
              pid: 778,
              args: 'node /tmp/unrelated-server.js',
              libraryId: null,
            },
          ];
        },
        processExists(pid) {
          return pid === 222 || pid === 778;
        },
        killProcess(pid, signal) {
          kills.push({ pid, signal });
        },
        wait: async () => undefined,
        fetch: vi.fn(),
        now: () => '2026-04-02T18:34:00.000Z',
        ownerPid: () => 2000,
      },
    );

    await manager.stopGateway('flib_stop_unrelated');

    expect(kills).toEqual([]);
    await expect(readFile(join(root, 'state', 'flib_stop_unrelated.json'), 'utf8')).resolves.toContain('"libraryId":"flib_stop_unrelated"');
  });

  it('fails gateway startup within the declared deadline when a single probe never returns', async () => {
    vi.useFakeTimers();
    const root = await mkdtemp(join(tmpdir(), 'gateway-start-timeout-hang-'));
    const freePortProbe = mockFreePortProbe();
    let resolveFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    const hangingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        resolveFetchStarted?.();
        const signal = init?.signal;
        const rejectAbort = () => {
          signal?.removeEventListener('abort', rejectAbort);
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };

        if (signal?.aborted) {
          rejectAbort();
          return;
        }

        signal?.addEventListener('abort', rejectAbort, { once: true });
      })
    ));
    vi.stubGlobal('fetch', hangingFetch);
    const alive = new Set<number>([901]);
    const kills: Array<{ pid: number; signal: string }> = [];

    try {
      const manager = new RealFileLibraryGatewayManager(
        createGatewayConfig({
          gatewayArtifactsRoot: root,
          gatewayLogDir: join(root, 'logs'),
          gatewayStateDir: join(root, 'state'),
        }),
        {
          spawnGateway: vi.fn(() => createChild(901, {
            onKill(signal) {
              kills.push({ pid: 901, signal });
              alive.delete(901);
            },
          })),
          async listProcesses() {
            return [];
          },
          processExists(pid) {
            return alive.has(pid);
          },
          killProcess(pid, signal) {
            kills.push({ pid, signal });
            alive.delete(pid);
          },
          wait: async () => undefined,
          fetch: hangingFetch,
          now: () => '2026-04-02T18:40:00.000Z',
          ownerPid: () => 1000,
        },
      );

      let outcome: string | null = null;
      void manager.ensureGateway({
        libraryId: 'flib_timeout_hang',
        filesystemName: 'flib-timeout-hang',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_timeout_hang?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-timeout-hang',
      }).then(
        () => {
          outcome = 'resolved';
        },
        (error: unknown) => {
          outcome = error instanceof Error ? error.message : String(error);
        },
      );

      await fetchStarted;
      await vi.advanceTimersByTimeAsync(15_100);
      await vi.waitFor(() => {
        expect(outcome).toBe('file_library_gateway_start_timeout');
      });
      await vi.waitFor(() => {
        expect(kills).toEqual([{ pid: 901, signal: 'SIGTERM' }]);
      });
      await expect(readFile(join(root, 'state', 'flib_timeout_hang.json'), 'utf8')).rejects.toThrow();
    } finally {
      freePortProbe.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('aborts gateway startup on caller cancellation and tears down the spawned child plus state file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gateway-start-abort-'));
    const alive = new Set<number>([901, 1000]);
    const kills: Array<{ pid: number; signal: string }> = [];
    const child = createChild(901, {
      onKill(signal) {
        kills.push({ pid: 901, signal });
        alive.delete(901);
        emitChildExit(child, 0);
      },
    });
    const freePortProbe = mockFreePortProbe();
    const controller = new AbortController();
    let resolveFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });

    try {
      const manager = new RealFileLibraryGatewayManager(
        createGatewayConfig({
          gatewayArtifactsRoot: root,
          gatewayLogDir: join(root, 'logs'),
          gatewayStateDir: join(root, 'state'),
        }),
        {
          spawnGateway: vi.fn(() => child),
          async listProcesses() {
            return [];
          },
          processExists(pid) {
            return alive.has(pid);
          },
          killProcess(pid, signal) {
            kills.push({ pid, signal });
            alive.delete(pid);
          },
          wait: async () => undefined,
          fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
            resolveFetchStarted?.();
            init?.signal?.addEventListener('abort', () => {
              reject(init.signal?.reason ?? new Error('gateway_start_aborted'));
            }, { once: true });
          })),
          now: () => '2026-04-16T10:00:00.000Z',
          ownerPid: () => 1000,
        },
      );

      const ensurePromise = manager.ensureGateway({
        libraryId: 'flib_abort_startup',
        filesystemName: 'flib-abort-startup',
        metadataUrl: 'postgres://user:pass@localhost:15432/jfs_lib_abort_startup?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-abort-startup',
        signal: controller.signal,
      } as never);

      await fetchStarted;
      controller.abort(new Error('client_request_aborted'));

      await expect(ensurePromise).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(kills).toEqual([{ pid: 901, signal: 'SIGTERM' }]);
      await expect(readFile(join(root, 'state', 'flib_abort_startup.json'), 'utf8')).rejects.toThrow();
      expect((Reflect.get(manager as object, 'sessions') as Map<string, unknown>).has('flib_abort_startup')).toBe(false);
    } finally {
      freePortProbe.mockRestore();
    }
  });
});
