import { createHash, randomUUID } from 'node:crypto';
import { access, constants, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import net from 'node:net';
import { Client as PgClient } from 'pg';
import { Client as MinioClient } from 'minio';
import type {
  FileLibraryGatewayManager,
  EnsureFileLibraryGatewayInput,
  EnsureFileLibraryGatewayResult,
  FileLibraryGatewayHealth,
} from './file-library-gateway-manager.js';
import type {
  FileLibraryDeleteInput,
  FileLibraryOrchestrator,
  FileLibraryProvisioningInput,
  FileLibraryProvisioningResult,
} from './file-library-orchestrator.js';

type GatewaySession = EnsureFileLibraryGatewayResult & {
  child?: ChildProcessWithoutNullStreams;
  metadataUrl?: string;
  lastError?: string;
};

interface FileLibraryRuntimeConfig {
  juicefsBin: string;
  mcBin: string;
  pgAdminUrl: string;
  pgConnectHost: string;
  pgConnectPort: number;
  pgClientHost: string;
  pgClientPort: number;
  pgClientSslMode?: string;
  minioAdminEndPoint: string;
  minioAdminPort: number;
  minioAdminUseSSL: boolean;
  minioAdminAccessKey: string;
  minioAdminSecretKey: string;
  minioStorageEndpoint: string;
  minioClientEndpoint: string;
  minioRegion: string;
  gatewayPortBase: number;
  gatewayRootUserPrefix: string;
  gatewayRootPasswordSeed: string;
  gatewayLogDir: string;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envString(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}

function requireEnv(name: string): string {
  const value = envString(name);
  if (!value) {
    throw new Error(`file_library_env_missing_${name.toLowerCase()}`);
  }
  return value;
}

function detectDefaultJuicefsBin(): string {
  return envString('JUICEFS_BIN') || 'juicefs';
}

function detectDefaultMcBin(): string {
  const explicit = envString('MC_BIN');
  if (explicit) return explicit;
  return 'mc';
}

function isAbsoluteLikeExecutable(pathLike: string): boolean {
  return pathLike.includes('/') || pathLike.includes('\\');
}

async function resolveExecutable(pathLike: string): Promise<string> {
  if (!pathLike.trim()) {
    throw new Error('file_library_executable_path_invalid');
  }
  if (isAbsoluteLikeExecutable(pathLike)) {
    await access(pathLike, constants.X_OK);
    return pathLike;
  }
  const pathEntries = (process.env.PATH ?? '')
    .split(':')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = join(entry, pathLike);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep searching
    }
  }
  throw new Error(`file_library_executable_missing_${pathLike}`);
}

async function ensureExecutable(pathLike: string): Promise<string> {
  return resolveExecutable(pathLike);
}

export interface FileLibraryRuntimeReadiness {
  ready: boolean;
  checks: {
    juicefs: 'ready' | 'missing';
    mc: 'ready' | 'missing';
    database_url: 'ready' | 'missing';
    minio_endpoint: 'ready' | 'missing';
    minio_access_key: 'ready' | 'missing';
    minio_secret_key: 'ready' | 'missing';
  };
  errors: string[];
}

export async function getFileLibraryRuntimeReadiness(
  input?: { juicefsBin?: string; mcBin?: string; env?: NodeJS.ProcessEnv },
): Promise<FileLibraryRuntimeReadiness> {
  const env = input?.env ?? process.env;
  const checks: FileLibraryRuntimeReadiness['checks'] = {
    juicefs: 'missing',
    mc: 'missing',
    database_url: env.DATABASE_URL?.trim() ? 'ready' : 'missing',
    minio_endpoint: env.MINIO_ENDPOINT?.trim() ? 'ready' : 'missing',
    minio_access_key: env.MINIO_ACCESS_KEY?.trim() ? 'ready' : 'missing',
    minio_secret_key: env.MINIO_SECRET_KEY?.trim() ? 'ready' : 'missing',
  };
  const errors: string[] = [];

  try {
    await resolveExecutable(input?.juicefsBin ?? detectDefaultJuicefsBin());
    checks.juicefs = 'ready';
  } catch {
    errors.push('file_library_juicefs_cli_missing');
  }

  try {
    await resolveExecutable(input?.mcBin ?? detectDefaultMcBin());
    checks.mc = 'ready';
  } catch {
    errors.push('file_library_mc_cli_missing');
  }

  if (checks.database_url === 'missing') errors.push('file_library_env_missing_database_url');
  if (checks.minio_endpoint === 'missing') errors.push('file_library_env_missing_minio_endpoint');
  if (checks.minio_access_key === 'missing') errors.push('file_library_env_missing_minio_access_key');
  if (checks.minio_secret_key === 'missing') errors.push('file_library_env_missing_minio_secret_key');

  return {
    ready: errors.length === 0,
    checks,
    errors,
  };
}

function sanitizeSlug(input: string, fallback: string): string {
  const cleaned = input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (cleaned || fallback).slice(0, 48);
}

function deterministicDbName(libraryId: string): string {
  return `jfs_lib_${sanitizeSlug(libraryId, 'library')}`.slice(0, 63);
}

function deterministicDbUser(libraryId: string): string {
  return `jfsu_${sanitizeSlug(libraryId, 'library')}`.slice(0, 63);
}

function deterministicBucket(libraryId: string): string {
  return `jfs-lib-${sanitizeSlug(libraryId, 'library').replace(/_/g, '-')}`.slice(0, 63);
}

function deterministicMinioUser(libraryId: string): string {
  return `jfsm_${sanitizeSlug(libraryId, 'library')}`.slice(0, 40);
}

function deterministicPolicyName(libraryId: string): string {
  return `jfs-policy-${sanitizeSlug(libraryId, 'library').replace(/_/g, '-')}`.slice(0, 64);
}

function deterministicGatewayUser(libraryId: string, prefix: string): string {
  return `${prefix}${sanitizeSlug(libraryId, 'library').replace(/_/g, '').slice(0, 12)}`.slice(0, 20);
}

function deriveSecret(seed: string, namespace: string, libraryId: string, size = 32): string {
  const digest = createHash('sha256')
    .update(`${seed}:${namespace}:${libraryId}`)
    .digest('base64url');
  const normalized = /^[A-Za-z0-9]/.test(digest)
    ? digest
    : `a${digest.slice(1)}`;
  return normalized.slice(0, size);
}

export function getFileLibraryGatewayInternalCredentials(
  libraryId: string,
  options?: { prefix?: string; seed?: string },
): { accessKey: string; secretKey: string } {
  const prefix = options?.prefix || envString('FILE_LIBRARY_GATEWAY_ROOT_USER_PREFIX') || 'flgw';
  const seed =
    options?.seed
    || envString('FILE_LIBRARY_GATEWAY_ROOT_PASSWORD_SEED')
    || envString('AGENTSMITH_SECRET_KEY')
    || 'agentsmith-file-library-gateway-seed';
  return {
    accessKey: deterministicGatewayUser(libraryId, prefix),
    secretKey: deriveSecret(seed, 'gateway-root', libraryId, 24),
  };
}

function buildClientMetadataUrl(config: FileLibraryRuntimeConfig, dbUser: string, dbPassword: string, dbName: string): string {
  const url = new URL(`postgres://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${config.pgClientHost}:${config.pgClientPort}/${dbName}`);
  if (config.pgClientSslMode) {
    url.searchParams.set('sslmode', config.pgClientSslMode);
  }
  return url.toString();
}

function buildInternalMetadataUrl(config: FileLibraryRuntimeConfig, dbUser: string, dbPassword: string, dbName: string): string {
  const url = new URL(`postgres://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${config.pgConnectHost}:${config.pgConnectPort}/${dbName}`);
  if (config.pgClientSslMode) {
    url.searchParams.set('sslmode', config.pgClientSslMode);
  }
  return url.toString();
}

function buildMcHost(config: FileLibraryRuntimeConfig): string {
  const scheme = config.minioAdminUseSSL ? 'https' : 'http';
  return `${scheme}://${encodeURIComponent(config.minioAdminAccessKey)}:${encodeURIComponent(config.minioAdminSecretKey)}@${config.minioAdminEndPoint}:${config.minioAdminPort}`;
}

async function execCommand(cmd: string, args: string[], options?: { env?: NodeJS.ProcessEnv }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...options?.env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const message = stderr.trim() || stdout.trim() || `${cmd}_failed`;
      reject(new Error(message));
    });
  });
}

async function findFreePort(base: number): Promise<number> {
  for (let offset = 0; offset < 200; offset += 1) {
    const candidate = base + offset;
    const ok = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(candidate, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });
    if (ok) return candidate;
  }
  throw new Error('file_library_gateway_port_unavailable');
}

async function waitForGateway(url: string, timeoutMs = 15000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.status > 0) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('file_library_gateway_start_timeout');
}

export function resolveFileLibraryRuntimeConfig(env: NodeJS.ProcessEnv = process.env): FileLibraryRuntimeConfig {
  const pgAdminUrl = env.DATABASE_URL?.trim();
  if (!pgAdminUrl) {
    throw new Error('file_library_env_missing_database_url');
  }
  const parsedPg = new URL(pgAdminUrl);
  const minioAdminEndPoint = env.MINIO_ENDPOINT?.trim();
  if (!minioAdminEndPoint) {
    throw new Error('file_library_env_missing_minio_endpoint');
  }
  const minioAdminPort = (() => {
    const raw = env.MINIO_PORT;
    if (!raw) return 19000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 19000;
  })();
  const minioAdminUseSSL = (() => {
    const raw = env.MINIO_USE_SSL;
    if (!raw) return false;
    return raw === '1' || raw.toLowerCase() === 'true';
  })();
  return {
    juicefsBin: env.JUICEFS_BIN?.trim() || detectDefaultJuicefsBin(),
    mcBin: env.MC_BIN?.trim() || detectDefaultMcBin(),
    pgAdminUrl,
    pgConnectHost: parsedPg.hostname,
    pgConnectPort: Number(parsedPg.port || '5432'),
    pgClientHost: env.FILE_LIBRARY_CLIENT_POSTGRES_HOST?.trim() || parsedPg.hostname,
    pgClientPort: (() => {
      const raw = env.FILE_LIBRARY_CLIENT_POSTGRES_PORT;
      if (!raw) return Number(parsedPg.port || '5432');
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : Number(parsedPg.port || '5432');
    })(),
    pgClientSslMode: env.FILE_LIBRARY_CLIENT_POSTGRES_SSLMODE?.trim() || undefined,
    minioAdminEndPoint,
    minioAdminPort,
    minioAdminUseSSL,
    minioAdminAccessKey: env.MINIO_ACCESS_KEY?.trim() || requireEnv('MINIO_ACCESS_KEY'),
    minioAdminSecretKey: env.MINIO_SECRET_KEY?.trim() || requireEnv('MINIO_SECRET_KEY'),
    minioStorageEndpoint: `${minioAdminUseSSL ? 'https' : 'http'}://${minioAdminEndPoint}:${minioAdminPort}`,
    minioClientEndpoint:
      env.FILE_LIBRARY_CLIENT_MINIO_ENDPOINT?.trim()
      || `${minioAdminUseSSL ? 'https' : 'http'}://${minioAdminEndPoint}:${minioAdminPort}`,
    minioRegion: env.FILE_LIBRARY_MINIO_REGION?.trim() || 'us-east-1',
    gatewayPortBase: (() => {
      const raw = env.FILE_LIBRARY_GATEWAY_PORT_BASE;
      if (!raw) return 39000;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 39000;
    })(),
    gatewayRootUserPrefix: env.FILE_LIBRARY_GATEWAY_ROOT_USER_PREFIX?.trim() || 'flgw',
    gatewayRootPasswordSeed:
      env.FILE_LIBRARY_GATEWAY_ROOT_PASSWORD_SEED?.trim()
      || env.AGENTSMITH_SECRET_KEY?.trim()
      || 'agentsmith-file-library-gateway-seed',
    gatewayLogDir: env.FILE_LIBRARY_GATEWAY_LOG_DIR?.trim() || join(process.cwd(), 'artifacts/file-library-gateway'),
  };
}

function resolveExternalExecutionHost(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE?.trim();
  if (explicit) {
    return explicit;
  }
  const candidates = [
    env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL?.trim(),
    env.AGENT_EXECUTION_HTTP_BASE_URL?.trim(),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.hostname) {
        return parsed.hostname;
      }
    } catch {
      // Ignore malformed values here; render-env catches them earlier.
    }
  }
  return null;
}

function replaceUrlOrigin(urlValue: string, replacementBase: string): string {
  const parsed = new URL(urlValue);
  const replacement = new URL(replacementBase);
  parsed.protocol = replacement.protocol;
  parsed.username = replacement.username;
  parsed.password = replacement.password;
  parsed.hostname = replacement.hostname;
  parsed.port = replacement.port;
  return parsed.toString();
}

export function resolveFileLibraryMetadataUrlForExternalExecution(
  metadataUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const executionHost = resolveExternalExecutionHost(env);
  if (!executionHost) return metadataUrl;
  try {
    const parsed = new URL(metadataUrl);
    parsed.hostname = executionHost;
    const explicitPort = env.EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE?.trim();
    if (explicitPort) {
      parsed.port = explicitPort;
    }
    return parsed.toString();
  } catch {
    return metadataUrl;
  }
}

export function resolveFileLibraryMetadataUrlForComposeManagedExternalExecution(
  metadataUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) return metadataUrl;
  try {
    const parsed = new URL(metadataUrl);
    const database = new URL(databaseUrl);
    parsed.hostname = database.hostname;
    parsed.port = database.port;
    return parsed.toString();
  } catch {
    return metadataUrl;
  }
}

export function resolveFileLibraryMetadataUrlForDockerManualExternalExecution(
  metadataUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  try {
    const parsed = new URL(metadataUrl);
    parsed.hostname = env.DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE?.trim() || '127.0.0.1';
    parsed.port = env.DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE?.trim()
      || env.FILE_LIBRARY_CLIENT_POSTGRES_PORT?.trim()
      || '15432';
    return parsed.toString();
  } catch {
    return metadataUrl;
  }
}

export function resolveFileLibraryStorageBucketUrlForExternalExecution(
  storageBucketUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!storageBucketUrl?.trim()) return storageBucketUrl;
  const explicitEndpoint = env.EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE?.trim();
  if (explicitEndpoint) {
    try {
      return replaceUrlOrigin(storageBucketUrl, explicitEndpoint);
    } catch {
      return storageBucketUrl;
    }
  }
  const executionHost = resolveExternalExecutionHost(env);
  if (!executionHost) return storageBucketUrl;
  try {
    const parsed = new URL(storageBucketUrl);
    parsed.hostname = executionHost;
    return parsed.toString();
  } catch {
    return storageBucketUrl;
  }
}

export function resolveFileLibraryStorageBucketUrlForComposeManagedExternalExecution(
  storageBucketUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!storageBucketUrl?.trim()) return storageBucketUrl;
  const endpoint = env.MINIO_ENDPOINT?.trim();
  if (!endpoint) return storageBucketUrl;
  const port = env.MINIO_PORT?.trim() || '9000';
  const useSsl = env.MINIO_USE_SSL?.trim() === 'true';
  try {
    const parsed = new URL(storageBucketUrl);
    parsed.protocol = useSsl ? 'https:' : 'http:';
    parsed.hostname = endpoint;
    parsed.port = port;
    return parsed.toString();
  } catch {
    return storageBucketUrl;
  }
}

export function resolveFileLibraryStorageBucketUrlForDockerManualExternalExecution(
  storageBucketUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!storageBucketUrl?.trim()) return storageBucketUrl;
  const explicitEndpoint = env.DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE?.trim();
  const loopbackPort = env.DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_PORT_OVERRIDE?.trim()
    || env.MINIO_API_PORT?.trim()
    || env.FILE_LIBRARY_CLIENT_MINIO_PORT?.trim()
    || '19000';
  const endpoint = explicitEndpoint || `http://127.0.0.1:${loopbackPort}`;
  try {
    return replaceUrlOrigin(storageBucketUrl, endpoint);
  } catch {
    return storageBucketUrl;
  }
}

export function resolveFileLibraryMetadataUrlForInternalExecution(
  metadataUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const executionHost = env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE?.trim();
  const executionPort = env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE?.trim();
  if (!executionHost && !executionPort) return metadataUrl;
  try {
    const parsed = new URL(metadataUrl);
    if (executionHost) parsed.hostname = executionHost;
    if (executionPort) parsed.port = executionPort;
    return parsed.toString();
  } catch {
    return metadataUrl;
  }
}

export function resolveFileLibraryStorageBucketUrlForInternalExecution(
  storageBucketUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!storageBucketUrl?.trim()) return storageBucketUrl;
  const overrideEndpoint = env.INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE?.trim();
  if (!overrideEndpoint) return storageBucketUrl;
  try {
    return replaceUrlOrigin(storageBucketUrl, overrideEndpoint);
  } catch {
    return storageBucketUrl;
  }
}

function buildRuntimeConfig(): FileLibraryRuntimeConfig {
  return resolveFileLibraryRuntimeConfig(process.env);
}

async function createPgDatabase(config: FileLibraryRuntimeConfig, libraryId: string): Promise<{ dbName: string; dbUser: string; dbPassword: string }> {
  const client = new PgClient({ connectionString: config.pgAdminUrl });
  const dbName = deterministicDbName(libraryId);
  const dbUser = deterministicDbUser(libraryId);
  const dbPassword = randomUUID().replace(/-/g, '');
  await client.connect();
  try {
    await client.query(`CREATE ROLE "${dbUser}" LOGIN PASSWORD '${dbPassword.replace(/'/g, "''")}'`);
    await client.query(`CREATE DATABASE "${dbName}" OWNER "${dbUser}"`);
  } catch (error) {
    try {
      await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    } catch {
      // ignore cleanup failures
    }
    try {
      await client.query(`DROP ROLE IF EXISTS "${dbUser}"`);
    } catch {
      // ignore cleanup failures
    }
    throw error;
  } finally {
    await client.end();
  }
  return { dbName, dbUser, dbPassword };
}

async function dropPgDatabase(config: FileLibraryRuntimeConfig, libraryId: string): Promise<void> {
  const client = new PgClient({ connectionString: config.pgAdminUrl });
  const dbName = deterministicDbName(libraryId);
  const dbUser = deterministicDbUser(libraryId);
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await client.query(`DROP ROLE IF EXISTS "${dbUser}"`);
  } finally {
    await client.end();
  }
}

async function createMinioResources(config: FileLibraryRuntimeConfig, libraryId: string): Promise<{ bucket: string }> {
  const bucket = deterministicBucket(libraryId);
  const bucketPolicyName = deterministicPolicyName(libraryId);
  const bucketUser = deterministicMinioUser(libraryId);
  const bucketPassword = deriveSecret(config.gatewayRootPasswordSeed, 'minio-backend-user', libraryId, 32);
  const minio = new MinioClient({
    endPoint: config.minioAdminEndPoint,
    port: config.minioAdminPort,
    useSSL: config.minioAdminUseSSL,
    accessKey: config.minioAdminAccessKey,
    secretKey: config.minioAdminSecretKey,
  });
  const exists = await minio.bucketExists(bucket).catch(() => false);
  if (!exists) {
    await minio.makeBucket(bucket, config.minioRegion);
  }

  const policyDoc = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:*'],
        Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
      },
    ],
  };

  const tempDir = await mkdtemp(join(tmpdir(), 'agentsmith-jfs-policy-'));
  const policyPath = join(tempDir, `${bucketPolicyName}.json`);
  try {
    await writeFile(policyPath, JSON.stringify(policyDoc), 'utf8');
    const mcEnv = { MC_HOST_fladmin: buildMcHost(config) };
    await execCommand(config.mcBin, ['mb', '--ignore-existing', `fladmin/${bucket}`], { env: mcEnv });
    await execCommand(config.mcBin, ['admin', 'user', 'add', 'fladmin', bucketUser, bucketPassword], { env: mcEnv });
    await execCommand(config.mcBin, ['admin', 'policy', 'create', 'fladmin', bucketPolicyName, policyPath], { env: mcEnv });
    await execCommand(config.mcBin, ['admin', 'policy', 'attach', 'fladmin', bucketPolicyName, '--user', bucketUser], { env: mcEnv });
  } catch (error) {
    await deleteMinioResources(config, libraryId).catch(() => undefined);
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  return { bucket };
}

async function deleteMinioResources(config: FileLibraryRuntimeConfig, libraryId: string): Promise<void> {
  const bucket = deterministicBucket(libraryId);
  const bucketPolicyName = deterministicPolicyName(libraryId);
  const bucketUser = deterministicMinioUser(libraryId);
  const mcEnv = { MC_HOST_fladmin: buildMcHost(config) };

  await execCommand(config.mcBin, ['rm', '--recursive', '--force', `fladmin/${bucket}`], { env: mcEnv }).catch(() => undefined);
  await execCommand(config.mcBin, ['rb', '--force', `fladmin/${bucket}`], { env: mcEnv }).catch(() => undefined);
  await execCommand(config.mcBin, ['admin', 'policy', 'detach', 'fladmin', bucketPolicyName, '--user', bucketUser], { env: mcEnv }).catch(() => undefined);
  await execCommand(config.mcBin, ['admin', 'policy', 'remove', 'fladmin', bucketPolicyName], { env: mcEnv }).catch(() => undefined);
  await execCommand(config.mcBin, ['admin', 'user', 'remove', 'fladmin', bucketUser], { env: mcEnv }).catch(() => undefined);
}

async function formatJuicefs(config: FileLibraryRuntimeConfig, metadataUrl: string, filesystemName: string, libraryId: string): Promise<void> {
  const bucket = deterministicBucket(libraryId);
  const accessKey = deterministicMinioUser(libraryId);
  const secretKey = deriveSecret(config.gatewayRootPasswordSeed, 'minio-backend-user', libraryId, 32);
  const bucketUrl = `${config.minioStorageEndpoint.replace(/\/+$/, '')}/${bucket}`;
  await execCommand(config.juicefsBin, [
    'format',
    metadataUrl,
    filesystemName,
    '--storage',
    's3',
    '--bucket',
    bucketUrl,
    '--access-key',
    accessKey,
    '--secret-key',
    secretKey,
  ]);
}

export class InMemoryFileLibraryOrchestrator implements FileLibraryOrchestrator {
  async provisionLibrary(input: FileLibraryProvisioningInput): Promise<FileLibraryProvisioningResult> {
    const host = process.env.FILE_LIBRARY_CLIENT_POSTGRES_HOST?.trim() || 'localhost';
    const port = envNumber('FILE_LIBRARY_CLIENT_POSTGRES_PORT', 15432);
    const dbName = deterministicDbName(input.libraryId);
    const dbUser = deterministicDbUser(input.libraryId);
    const dbPassword = randomUUID().replace(/-/g, '');
    const bucket = deterministicBucket(input.libraryId);
    const minioEndpoint = process.env.FILE_LIBRARY_CLIENT_MINIO_ENDPOINT?.trim() || 'http://localhost:19000';
    const region = process.env.FILE_LIBRARY_MINIO_REGION?.trim() || 'us-east-1';
    return {
      filesystemName: input.filesystemName,
      metadataUrl: `postgres://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${host}:${port}/${dbName}`,
      internalMetadataUrl: `postgres://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${host}:${port}/${dbName}`,
      postgres: {
        host,
        port,
        database: dbName,
        username: dbUser,
      },
      minio: {
        endpoint: minioEndpoint,
        bucket,
        region,
      },
    };
  }

  async deleteLibrary(_input: FileLibraryDeleteInput): Promise<void> {
    return;
  }
}

export class RealFileLibraryOrchestrator implements FileLibraryOrchestrator {
  constructor(private readonly config: FileLibraryRuntimeConfig = buildRuntimeConfig()) {}

  async provisionLibrary(input: FileLibraryProvisioningInput): Promise<FileLibraryProvisioningResult> {
    await ensureExecutable(this.config.juicefsBin);
    await ensureExecutable(this.config.mcBin);

    const { dbName, dbUser, dbPassword } = await createPgDatabase(this.config, input.libraryId);
    try {
      const { bucket } = await createMinioResources(this.config, input.libraryId);
      const internalMetadataUrl = buildInternalMetadataUrl(this.config, dbUser, dbPassword, dbName);
      const metadataUrl = buildClientMetadataUrl(this.config, dbUser, dbPassword, dbName);
      await formatJuicefs(this.config, internalMetadataUrl, input.filesystemName, input.libraryId);
      return {
        filesystemName: input.filesystemName,
        metadataUrl,
        internalMetadataUrl,
        postgres: {
          host: this.config.pgClientHost,
          port: this.config.pgClientPort,
          database: dbName,
          username: dbUser,
        },
        minio: {
          endpoint: this.config.minioClientEndpoint,
          bucket,
          region: this.config.minioRegion,
        },
      };
    } catch (error) {
      await deleteMinioResources(this.config, input.libraryId).catch(() => undefined);
      await dropPgDatabase(this.config, input.libraryId).catch(() => undefined);
      throw error;
    }
  }

  async deleteLibrary(input: FileLibraryDeleteInput): Promise<void> {
    await ensureExecutable(this.config.mcBin);
    await deleteMinioResources(this.config, input.libraryId);
    await dropPgDatabase(this.config, input.libraryId);
  }
}

export class UnavailableFileLibraryOrchestrator implements FileLibraryOrchestrator {
  async provisionLibrary(): Promise<FileLibraryProvisioningResult> {
    throw new Error('file_library_backend_unavailable');
  }

  async deleteLibrary(): Promise<void> {
    throw new Error('file_library_backend_unavailable');
  }
}

export class InMemoryFileLibraryGatewayManager implements FileLibraryGatewayManager {
  private readonly sessions = new Map<string, GatewaySession>();

  async ensureGateway(input: EnsureFileLibraryGatewayInput): Promise<EnsureFileLibraryGatewayResult> {
    const existing = this.sessions.get(input.libraryId);
    if (existing) {
      return existing;
    }
    const port = envNumber('FILE_LIBRARY_GATEWAY_PORT_BASE', 39000) + this.sessions.size + 1;
    const created: GatewaySession = {
      loopbackUrl: `http://127.0.0.1:${port}`,
      port,
      status: 'ready',
      lastStartedAt: new Date().toISOString(),
      metadataUrl: input.metadataUrl,
    };
    this.sessions.set(input.libraryId, created);
    return created;
  }

  async getHealth(libraryId: string): Promise<FileLibraryGatewayHealth> {
    const existing = this.sessions.get(libraryId);
    if (!existing) {
      return {
        status: 'stopped',
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      status: existing.status === 'ready' ? 'ready' : existing.status === 'degraded' ? 'degraded' : 'failed',
      checkedAt: new Date().toISOString(),
      lastError: existing.lastError,
    };
  }

  async stopGateway(libraryId: string): Promise<void> {
    this.sessions.delete(libraryId);
  }
}

export class RealFileLibraryGatewayManager implements FileLibraryGatewayManager {
  private readonly sessions = new Map<string, GatewaySession>();

  constructor(private readonly config: FileLibraryRuntimeConfig = buildRuntimeConfig()) {}

  async ensureGateway(input: EnsureFileLibraryGatewayInput): Promise<EnsureFileLibraryGatewayResult> {
    await ensureExecutable(this.config.juicefsBin);
    const existing = this.sessions.get(input.libraryId);
    if (existing?.child && existing.child.exitCode === null) {
      return existing;
    }

    await mkdir(this.config.gatewayLogDir, { recursive: true });
    const port = await findFreePort(this.config.gatewayPortBase);
    const loopbackUrl = `http://127.0.0.1:${port}`;
    const logPath = join(this.config.gatewayLogDir, `${input.libraryId}.log`);
    await mkdir(dirname(logPath), { recursive: true });
    const rootUser = deterministicGatewayUser(input.libraryId, this.config.gatewayRootUserPrefix);
    const rootPassword = deriveSecret(this.config.gatewayRootPasswordSeed, 'gateway-root', input.libraryId, 24);
    const child = spawn(
      this.config.juicefsBin,
      [
        'gateway',
        input.metadataUrl,
        `127.0.0.1:${port}`,
        '--log',
        logPath,
        '--no-banner',
      ],
      {
        env: {
          ...process.env,
          MINIO_ROOT_USER: rootUser,
          MINIO_ROOT_PASSWORD: rootPassword,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const created: GatewaySession = {
      loopbackUrl,
      port,
      status: 'starting',
      lastStartedAt: new Date().toISOString(),
      child,
      metadataUrl: input.metadataUrl,
    };
    this.sessions.set(input.libraryId, created);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      created.lastError = stderr.trim().slice(-2000);
    });
    child.on('exit', (code) => {
      if (code !== 0 && created.status !== 'ready') {
        created.status = 'failed';
      } else if (code !== 0) {
        created.status = 'degraded';
      } else {
        created.status = 'stopped';
      }
    });

    try {
      await waitForGateway(`${loopbackUrl}/`);
      created.status = 'ready';
      return created;
    } catch (error) {
      created.status = 'failed';
      created.lastError = error instanceof Error ? error.message : 'file_library_gateway_start_failed';
      child.kill('SIGTERM');
      throw error;
    }
  }

  async getHealth(libraryId: string): Promise<FileLibraryGatewayHealth> {
    const existing = this.sessions.get(libraryId);
    if (!existing) {
      return {
        status: 'stopped',
        checkedAt: new Date().toISOString(),
      };
    }
    if (!existing.child || existing.child.exitCode !== null) {
      return {
        status: existing.status === 'failed' ? 'failed' : 'stopped',
        checkedAt: new Date().toISOString(),
        lastError: existing.lastError,
      };
    }
    try {
      const response = await fetch(`${existing.loopbackUrl}/`, { method: 'GET' });
      return {
        status: response.status > 0 ? 'ready' : 'degraded',
        checkedAt: new Date().toISOString(),
        lastError: existing.lastError,
      };
    } catch (error) {
      existing.lastError = error instanceof Error ? error.message : 'file_library_gateway_health_failed';
      return {
        status: 'degraded',
        checkedAt: new Date().toISOString(),
        lastError: existing.lastError,
      };
    }
  }

  async stopGateway(libraryId: string): Promise<void> {
    const existing = this.sessions.get(libraryId);
    if (existing?.child && existing.child.exitCode === null) {
      existing.child.kill('SIGTERM');
    }
    this.sessions.delete(libraryId);
  }
}
