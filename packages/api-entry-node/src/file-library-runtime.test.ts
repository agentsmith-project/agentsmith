import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

function createChild(pid: number) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    exitCode: number | null;
  };
  child.pid = pid;
  child.stdout = stdout;
  child.stderr = stderr;
  child.exitCode = null;
  return child as never;
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
          return [];
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
});
