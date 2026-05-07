import { createHash, randomUUID } from 'node:crypto';
import { access, constants, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import net from 'node:net';
import process from 'node:process';
import { Client as PgClient } from 'pg';
import { Client as MinioClient } from 'minio';
import {
  buildGatewayOwnerEvidence,
  classifyGatewayOwnerScope,
  createGatewayOwnerRuntimeLease,
  extractGatewayLibraryId,
  extractGatewayProcessIdentity,
  isPersistedGatewayPidAuthorityConfirmed,
  isGatewayCommand,
  loadGatewayOwnerLedgerSnapshot,
  matchGatewayStateForProcess,
  parseGatewayOwnerScope,
  type GatewayOwnerEvidence,
  type GatewayOwnerRuntimeLease,
  type GatewayProcessIdentity,
} from './file-library-gateway-ownership.js';
import { resolveFileLibraryGatewayPaths } from './file-library-gateway-paths.js';
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

type GatewayStatus = EnsureFileLibraryGatewayResult['status'] | FileLibraryGatewayHealth['status'];
type GatewayChildProcess = ChildProcessByStdio<null, Readable, Readable>;
type CommandEnvOverrides = Readonly<Record<string, string | undefined>>;

type GatewaySession = Omit<EnsureFileLibraryGatewayResult, 'status'> & {
  status: GatewayStatus;
  pid?: number;
  child?: GatewayChildProcess;
  metadataUrl?: string;
  storageBucketUrl?: string;
  lastError?: string;
  logPath?: string;
  ownerScope?: string;
  sessionToken?: string;
  hasExited?: boolean;
  cleanupPromise?: Promise<void>;
};

interface PersistedGatewayState {
  libraryId: string;
  pid: number;
  port: number;
  loopbackUrl: string;
  metadataUrl: string;
  storageBucketUrl: string | null | undefined;
  logPath: string;
  lastStartedAt: string;
  ownerProcessPid: number;
  ownerScope: string | null | undefined;
  sessionToken?: string;
  status: GatewayStatus;
}

function restoreGatewaySessionFromPersistedState(state: PersistedGatewayState): GatewaySession {
  return {
    loopbackUrl: state.loopbackUrl,
    port: state.port,
    status: state.status,
    lastStartedAt: state.lastStartedAt,
    pid: state.pid,
    metadataUrl: state.metadataUrl,
    storageBucketUrl: state.storageBucketUrl ?? undefined,
    logPath: state.logPath,
    ownerScope: state.ownerScope ?? undefined,
    sessionToken: state.sessionToken,
  };
}

function toEnsureGatewayResult(session: GatewaySession): EnsureFileLibraryGatewayResult {
  if (session.status === 'failed' || session.status === 'stopped') {
    throw new Error('file_library_gateway_not_available');
  }
  return {
    loopbackUrl: session.loopbackUrl,
    port: session.port,
    status: session.status,
    lastStartedAt: session.lastStartedAt,
    pid: session.pid,
  };
}

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
  gatewayArtifactsRoot: string;
  gatewayLogDir: string;
  gatewayStateDir: string;
}

interface GatewayProcessInfo {
  pid: number;
  args: string;
  libraryId: string | null;
}

interface ManagedGatewayProcessInfo extends GatewayProcessInfo {
  matchedState: PersistedGatewayState | null;
  identity: GatewayProcessIdentity;
}

interface GatewayManagerPlatform {
  spawnGateway(
    cmd: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; argv0?: string },
  ): GatewayChildProcess;
  listProcesses(): Promise<GatewayProcessInfo[]>;
  processExists(pid: number): boolean;
  killProcess(pid: number, signal: NodeJS.Signals): void;
  wait(ms: number): Promise<void>;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  now(): string;
  ownerPid(): number;
}

type GatewayReconcileInventory = {
  stateByLibraryId?: ReadonlyMap<string, PersistedGatewayState>;
  processInventory?: readonly GatewayProcessInfo[];
  managedProcesses?: readonly ManagedGatewayProcessInfo[];
  ownerEvidence?: GatewayOwnerEvidence;
  ownerRuntime?: GatewayOwnerRuntimeLease;
  allowWeakStateAdoption?: boolean;
  signal?: AbortSignal;
};

type GatewayPidAuthorityStatus = 'confirmed' | 'missing' | 'unverified';

type GatewayTerminationStatus = 'terminated' | 'missing' | 'unverified';

const DEFAULT_GATEWAY_PROBE_TIMEOUT_MS = 3_000;
const DEFAULT_GATEWAY_START_TIMEOUT_MS = 15_000;
const DEFAULT_GATEWAY_PROBE_INTERVAL_MS = 500;

interface GatewayProbeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

type AbortableEnsureFileLibraryGatewayInput = EnsureFileLibraryGatewayInput & {
  signal?: AbortSignal;
};

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function normalizeAbortReason(reason: unknown, fallback: string): Error {
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason;
  }
  if (reason instanceof Error) {
    const error = createAbortError(reason.message || fallback);
    (error as Error & { cause?: unknown }).cause = reason;
    return error;
  }
  if (typeof reason === 'string' && reason.trim()) {
    return createAbortError(reason);
  }
  return createAbortError(fallback);
}

function throwIfAborted(signal: AbortSignal | undefined, fallback: string): void {
  if (signal?.aborted) {
    throw normalizeAbortReason(signal.reason, fallback);
  }
}

function createTimedAbortController(args: {
  parentSignal?: AbortSignal;
  timeoutMs: number;
  timeoutMessage: string;
}): {
  signal: AbortSignal;
  cleanup: () => void;
  wasParentAborted: () => boolean;
} {
  const controller = new AbortController();
  let parentAborted = false;
  const abortWithReason = (reason: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };
  const onParentAbort = () => {
    parentAborted = true;
    abortWithReason(normalizeAbortReason(args.parentSignal?.reason, 'file_library_gateway_probe_aborted'));
  };

  if (args.parentSignal?.aborted) {
    onParentAbort();
  } else if (args.parentSignal) {
    args.parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timeoutHandle = setTimeout(() => {
    abortWithReason(createAbortError(args.timeoutMessage));
  }, Math.max(0, args.timeoutMs));

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutHandle);
      args.parentSignal?.removeEventListener('abort', onParentAbort);
    },
    wasParentAborted: () => parentAborted,
  };
}

async function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    throwIfAborted(signal, 'file_library_gateway_probe_aborted');
    return;
  }

  throwIfAborted(signal, 'file_library_gateway_probe_aborted');

  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutHandle);
      signal?.removeEventListener('abort', onAbort);
      reject(normalizeAbortReason(signal?.reason, 'file_library_gateway_probe_aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function hasRecordedOwnerProcess(state: PersistedGatewayState): boolean {
  return Number.isInteger(state.ownerProcessPid) && state.ownerProcessPid > 0;
}

function stateNeedsOwnerIdentityMigration(state: PersistedGatewayState): boolean {
  return !hasRecordedOwnerProcess(state) || parseGatewayOwnerScope(state.ownerScope ?? null) === null;
}

function canAdoptWeakGatewayState(
  platform: GatewayManagerPlatform,
  state: PersistedGatewayState,
): boolean {
  return !hasRecordedOwnerProcess(state) || platform.processExists(state.ownerProcessPid);
}

function findLegacyGatewayMigrationCandidates(
  state: PersistedGatewayState,
  processes: readonly ManagedGatewayProcessInfo[],
): ManagedGatewayProcessInfo[] {
  const candidates = new Map<number, ManagedGatewayProcessInfo>();

  for (const processInfo of processes) {
    if (processInfo.matchedState?.libraryId !== state.libraryId) {
      continue;
    }
    if (processInfo.identity.ownerScope?.trim()) {
      continue;
    }
    candidates.set(processInfo.pid, processInfo);
  }

  return [...candidates.values()];
}

function classifyPersistedGatewayOwnerState(
  platform: GatewayManagerPlatform,
  state: PersistedGatewayState,
  ownerEvidence: GatewayOwnerEvidence,
): 'active' | 'stale' | 'unverified' {
  if (!hasRecordedOwnerProcess(state)) {
    return 'stale';
  }
  const ownerScopeStatus = classifyGatewayOwnerScope({
    ownerScope: state.ownerScope ?? null,
    ownerEvidence,
  });
  if (ownerScopeStatus === 'stale') {
    return 'stale';
  }
  if (ownerScopeStatus === 'active') {
    return 'active';
  }
  return platform.processExists(state.ownerProcessPid) ? 'unverified' : 'stale';
}

type PersistedGatewayAuthority = 'current_boot' | 'foreign_active_boot' | 'stale' | 'unverified';

function classifyPersistedGatewayAuthority(args: {
  platform: GatewayManagerPlatform;
  state: PersistedGatewayState;
  ownerEvidence: GatewayOwnerEvidence;
  currentOwnerScope: string;
}): PersistedGatewayAuthority {
  const ownerState = classifyPersistedGatewayOwnerState(
    args.platform,
    args.state,
    args.ownerEvidence,
  );
  if (ownerState === 'stale') {
    return 'stale';
  }
  if (args.state.ownerScope?.trim() && args.state.ownerScope === args.currentOwnerScope) {
    return 'current_boot';
  }
  if (ownerState === 'active') {
    return 'foreign_active_boot';
  }
  if (
    args.state.ownerScope?.trim()
    && hasRecordedOwnerProcess(args.state)
    && args.platform.processExists(args.state.ownerProcessPid)
  ) {
    return 'foreign_active_boot';
  }
  return 'unverified';
}

function createForeignActiveBootGatewayError(): Error {
  return new Error('file_library_gateway_owned_by_another_active_boot');
}

async function resolvePersistedGatewayPidAuthority(args: {
  platform: GatewayManagerPlatform;
  state: PersistedGatewayState;
  processInventory?: readonly GatewayProcessInfo[];
}): Promise<{
  status: GatewayPidAuthorityStatus;
  processInfo: GatewayProcessInfo | null;
}> {
  if (!args.platform.processExists(args.state.pid)) {
    return {
      status: 'missing',
      processInfo: null,
    };
  }

  const processInventory = args.processInventory ?? await args.platform.listProcesses();
  const processInfo = processInventory.find((entry) => entry.pid === args.state.pid) ?? null;
  if (!processInfo) {
    return {
      status: 'unverified',
      processInfo: null,
    };
  }

  return {
    status: isPersistedGatewayPidAuthorityConfirmed({
      state: args.state,
      processPid: processInfo.pid,
      processCommand: processInfo.args,
    })
      ? 'confirmed'
      : 'unverified',
    processInfo,
  };
}

function resolveGatewayProcessLibraryId(
  processInfo: GatewayProcessInfo,
  gatewayLogDir: string,
): string | null {
  return processInfo.libraryId ?? extractGatewayLibraryId(processInfo.args, gatewayLogDir);
}

function isManagedGatewayPidAuthorityConfirmed(args: {
  processInfo: ManagedGatewayProcessInfo;
  currentProcessInfo: GatewayProcessInfo;
  gatewayLogDir: string;
}): boolean {
  if (args.processInfo.matchedState) {
    return isPersistedGatewayPidAuthorityConfirmed({
      state: args.processInfo.matchedState,
      processPid: args.currentProcessInfo.pid,
      processCommand: args.currentProcessInfo.args,
    });
  }

  const expectedOwnerScope = args.processInfo.identity.ownerScope?.trim() ?? null;
  const expectedLibraryId = args.processInfo.libraryId?.trim() ?? null;
  if (!expectedOwnerScope || !expectedLibraryId) {
    return false;
  }

  const currentIdentity = extractGatewayProcessIdentity(args.currentProcessInfo.args);
  const currentOwnerScope = currentIdentity.ownerScope?.trim() ?? null;
  const currentLibraryId = resolveGatewayProcessLibraryId(
    args.currentProcessInfo,
    args.gatewayLogDir,
  )?.trim() ?? null;

  return currentOwnerScope === expectedOwnerScope && currentLibraryId === expectedLibraryId;
}

async function resolveManagedGatewayPidAuthority(args: {
  platform: GatewayManagerPlatform;
  processInfo: ManagedGatewayProcessInfo;
  gatewayLogDir: string;
  processInventory?: readonly GatewayProcessInfo[];
}): Promise<{
  status: GatewayPidAuthorityStatus;
  processInfo: GatewayProcessInfo | null;
}> {
  if (!args.platform.processExists(args.processInfo.pid)) {
    return {
      status: 'missing',
      processInfo: null,
    };
  }

  const processInventory = args.processInventory ?? await args.platform.listProcesses();
  const currentProcessInfo = processInventory.find((entry) => entry.pid === args.processInfo.pid) ?? null;
  if (!currentProcessInfo) {
    return {
      status: 'unverified',
      processInfo: null,
    };
  }

  return {
    status: isManagedGatewayPidAuthorityConfirmed({
      processInfo: args.processInfo,
      currentProcessInfo,
      gatewayLogDir: args.gatewayLogDir,
    })
      ? 'confirmed'
      : 'unverified',
    processInfo: currentProcessInfo,
  };
}

async function isGatewayLoopbackHealthy(
  platform: GatewayManagerPlatform,
  loopbackUrl: string | undefined,
  options?: GatewayProbeOptions,
): Promise<boolean> {
  if (!loopbackUrl?.trim()) {
    return false;
  }
  const readinessUrl = new URL('/minio/health/live', `${loopbackUrl.replace(/\/+$/, '')}/`).toString();
  const controller = createTimedAbortController({
    parentSignal: options?.signal,
    timeoutMs: options?.timeoutMs ?? DEFAULT_GATEWAY_PROBE_TIMEOUT_MS,
    timeoutMessage: 'file_library_gateway_probe_timeout',
  });
  try {
    const response = await platform.fetch(readinessUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.status >= 200 && response.status < 300;
  } catch (error) {
    if (controller.wasParentAborted()) {
      throw normalizeAbortReason(options?.signal?.reason ?? error, 'file_library_gateway_probe_aborted');
    }
    return false;
  } finally {
    controller.cleanup();
  }
}

async function adoptLegacyGatewayState(
  config: FileLibraryRuntimeConfig,
  platform: GatewayManagerPlatform,
  state: PersistedGatewayState,
  ownerScope: string,
  legacyCandidates: readonly ManagedGatewayProcessInfo[] = [],
  options?: GatewayProbeOptions,
): Promise<PersistedGatewayState | null> {
  if (!stateNeedsOwnerIdentityMigration(state)) {
    return state;
  }

  const liveStatePid = state.pid && platform.processExists(state.pid)
    ? state.pid
    : null;
  const adoptedPid = liveStatePid ?? (legacyCandidates.length === 1 ? legacyCandidates[0].pid : null);

  if (!adoptedPid) {
    if (legacyCandidates.length > 0) {
      return state;
    }
    await removeGatewayState(config, state.libraryId);
    return null;
  }
  if (!await isGatewayLoopbackHealthy(platform, state.loopbackUrl, options)) {
    const legacyCandidate = legacyCandidates.find((processInfo) => processInfo.pid === adoptedPid) ?? null;
    const terminationStatus = adoptedPid === state.pid
      ? await terminatePersistedGatewayProcessIfConfirmed({
        platform,
        state: {
          ...state,
          pid: adoptedPid,
        },
      })
      : legacyCandidate
        ? await terminateManagedGatewayProcessIfConfirmed({
          platform,
          processInfo: legacyCandidate,
          gatewayLogDir: config.gatewayLogDir,
        })
        : 'unverified';
    if (terminationStatus === 'unverified') {
      return state;
    }
    await removeGatewayState(config, state.libraryId);
    return null;
  }

  const migratedState: PersistedGatewayState = {
    ...state,
    pid: adoptedPid,
    ownerProcessPid: platform.ownerPid(),
    ownerScope,
    status: 'ready',
  };
  await writeGatewayState(config, migratedState);
  return migratedState;
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

function buildCommandEnv(envOverrides?: CommandEnvOverrides): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides ?? {})) {
    env[key] = value;
  }
  return env;
}

async function execCommand(cmd: string, args: string[], options?: { env?: CommandEnvOverrides }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildCommandEnv(options?.env),
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

async function waitForGateway(
  platform: GatewayManagerPlatform,
  url: string,
  options?: GatewayProbeOptions,
): Promise<void> {
  const controller = createTimedAbortController({
    parentSignal: options?.signal,
    timeoutMs: options?.timeoutMs ?? DEFAULT_GATEWAY_START_TIMEOUT_MS,
    timeoutMessage: 'file_library_gateway_start_timeout',
  });

  try {
    while (true) {
      throwIfAborted(controller.signal, 'file_library_gateway_start_timeout');
      const healthy = await isGatewayLoopbackHealthy(platform, url, {
        signal: controller.signal,
      });
      if (healthy) {
        return;
      }
      await waitWithAbort(DEFAULT_GATEWAY_PROBE_INTERVAL_MS, controller.signal);
    }
  } finally {
    controller.cleanup();
  }
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
  const gatewayPaths = resolveFileLibraryGatewayPaths(env);

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
    gatewayArtifactsRoot: gatewayPaths.artifactsRoot,
    gatewayLogDir: gatewayPaths.gatewayLogDir,
    gatewayStateDir: gatewayPaths.gatewayStateDir,
  };
}

function resolveDeveloperRunnerExecutionHost(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.AGENT_RUNNER_DEVELOPER_JUICEFS_META_HOST_OVERRIDE?.trim();
  if (explicit) {
    return explicit;
  }
  const candidates = [
    env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL?.trim(),
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

function resolveBucketEndpointForInternalMount(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT?.trim() || undefined;
}

function resolveBucketEndpointForGateway(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.JUICEFS_BUCKET_ENDPOINT_FOR_GATEWAY?.trim()
    || env.FILE_LIBRARY_CLIENT_MINIO_ENDPOINT?.trim()
    || undefined;
}

function resolveBucketEndpointForClientMount(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.JUICEFS_BUCKET_ENDPOINT_FOR_CLIENT_MOUNT?.trim()
    || env.FILE_LIBRARY_CLIENT_MINIO_ENDPOINT?.trim()
    || undefined;
}

export function resolveFileLibraryMetadataUrlForDeveloperRunnerExecution(
  metadataUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const executionHost = resolveDeveloperRunnerExecutionHost(env);
  if (!executionHost) return metadataUrl;
  try {
    const parsed = new URL(metadataUrl);
    parsed.hostname = executionHost;
    const explicitPort = env.AGENT_RUNNER_DEVELOPER_JUICEFS_META_PORT_OVERRIDE?.trim();
    if (explicitPort) {
      parsed.port = explicitPort;
    }
    return parsed.toString();
  } catch {
    return metadataUrl;
  }
}

export function resolveFileLibraryStorageBucketUrlForDeveloperRunnerExecution(
  storageBucketUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!storageBucketUrl?.trim()) return storageBucketUrl;
  const explicitEndpoint = env.AGENT_RUNNER_DEVELOPER_JUICEFS_STORAGE_ENDPOINT_OVERRIDE?.trim();
  if (explicitEndpoint) {
    try {
      return replaceUrlOrigin(storageBucketUrl, explicitEndpoint);
    } catch {
      return storageBucketUrl;
    }
  }
  const executionHost = resolveDeveloperRunnerExecutionHost(env);
  if (!executionHost) return storageBucketUrl;
  try {
    const parsed = new URL(storageBucketUrl);
    parsed.hostname = executionHost;
    return parsed.toString();
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
  const overrideEndpoint = resolveBucketEndpointForInternalMount(env);
  if (!overrideEndpoint) return storageBucketUrl;
  try {
    return replaceUrlOrigin(storageBucketUrl, overrideEndpoint);
  } catch {
    return storageBucketUrl;
  }
}

export const resolveFileLibraryMetadataUrlForManagedRunnerExecution =
  resolveFileLibraryMetadataUrlForInternalExecution;
export const resolveFileLibraryStorageBucketUrlForManagedRunnerExecution =
  resolveFileLibraryStorageBucketUrlForInternalExecution;

export function resolveFileLibraryStorageBucketUrlForGatewayRuntime(
  storageBucketUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!storageBucketUrl?.trim()) return storageBucketUrl;
  const overrideEndpoint = resolveBucketEndpointForGateway(env);
  if (!overrideEndpoint) return storageBucketUrl;
  try {
    return replaceUrlOrigin(storageBucketUrl, overrideEndpoint);
  } catch {
    return storageBucketUrl;
  }
}

export function resolveFileLibraryStorageBucketUrlForClientMount(
  storageBucketUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!storageBucketUrl?.trim()) return storageBucketUrl;
  const overrideEndpoint = resolveBucketEndpointForClientMount(env);
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

const gatewayManagerPlatform: GatewayManagerPlatform = {
  spawnGateway(cmd, args, options) {
    return spawn(cmd, args, {
      argv0: options.argv0,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  },
  async listProcesses() {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn('ps', ['-ww', '-eo', 'pid=,args='], {
        stdio: ['ignore', 'pipe', 'pipe'],
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
          resolve(stdout);
          return;
        }
        reject(new Error(stderr.trim() || 'ps_failed'));
      });
    });

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): GatewayProcessInfo | null => {
        const match = line.match(/^(\d+)\s+(.*)$/);
        if (!match) return null;
        return {
          pid: Number(match[1]),
          args: match[2],
          libraryId: null,
        };
      })
      .filter((value): value is GatewayProcessInfo => Boolean(value));
  },
  processExists(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  killProcess(pid, signal) {
    process.kill(pid, signal);
  },
  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
  fetch(input, init) {
    return fetch(input, init);
  },
  now() {
    return new Date().toISOString();
  },
  ownerPid() {
    return process.pid;
  },
};

function gatewayStateFilePath(config: FileLibraryRuntimeConfig, libraryId: string): string {
  return join(config.gatewayStateDir, `${libraryId}.json`);
}

async function readGatewayState(
  config: FileLibraryRuntimeConfig,
  libraryId: string,
): Promise<PersistedGatewayState | null> {
  try {
    const raw = await readFile(gatewayStateFilePath(config, libraryId), 'utf8');
    return JSON.parse(raw) as PersistedGatewayState;
  } catch {
    return null;
  }
}

async function writeGatewayState(
  config: FileLibraryRuntimeConfig,
  state: PersistedGatewayState,
): Promise<void> {
  await mkdir(config.gatewayStateDir, { recursive: true });
  await writeFile(
    gatewayStateFilePath(config, state.libraryId),
    JSON.stringify(state, null, 2),
    'utf8',
  );
}

async function removeGatewayState(
  config: FileLibraryRuntimeConfig,
  libraryId: string,
): Promise<void> {
  await rm(gatewayStateFilePath(config, libraryId), { force: true });
}

async function listStateLibraryIds(config: FileLibraryRuntimeConfig): Promise<string[]> {
  try {
    const entries = await readdir(config.gatewayStateDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length));
  } catch {
    return [];
  }
}

async function listPersistedGatewayStates(config: FileLibraryRuntimeConfig): Promise<PersistedGatewayState[]> {
  const libraryIds = await listStateLibraryIds(config);
  const states = await Promise.all(libraryIds.map(async (libraryId) => readGatewayState(config, libraryId)));
  return states.filter((state): state is PersistedGatewayState => state !== null);
}

async function loadGatewayOwnerEvidence(
  config: FileLibraryRuntimeConfig,
  now: string,
): Promise<GatewayOwnerEvidence> {
  const ledger = await loadGatewayOwnerLedgerSnapshot(config.gatewayArtifactsRoot);
  return buildGatewayOwnerEvidence({
    ledger,
    now,
  });
}

function shouldReapNoStateGatewayProcess(args: {
  processInfo: ManagedGatewayProcessInfo;
  ownerEvidence: GatewayOwnerEvidence;
  currentOwnerScope: string;
}): boolean {
  if (!args.processInfo.identity.ownerScope || !args.processInfo.libraryId) {
    return false;
  }
  const ownerScopeStatus = classifyGatewayOwnerScope({
    ownerScope: args.processInfo.identity.ownerScope,
    ownerEvidence: args.ownerEvidence,
  });
  if (ownerScopeStatus === 'stale') {
    return true;
  }
  return ownerScopeStatus === 'active' && args.processInfo.identity.ownerScope === args.currentOwnerScope;
}

async function terminateGatewayProcess(args: {
  platform: GatewayManagerPlatform;
  pid: number;
  resolveAuthorityStatus: () => Promise<GatewayPidAuthorityStatus>;
}): Promise<GatewayTerminationStatus> {
  const initialAuthorityStatus = await args.resolveAuthorityStatus();
  if (initialAuthorityStatus !== 'confirmed') {
    return initialAuthorityStatus;
  }
  try {
    args.platform.killProcess(args.pid, 'SIGTERM');
  } catch {
    return args.platform.processExists(args.pid) ? 'unverified' : 'missing';
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!args.platform.processExists(args.pid)) {
      return 'terminated';
    }
    await args.platform.wait(100);
  }
  if (!args.platform.processExists(args.pid)) {
    return 'terminated';
  }

  const escalatedAuthorityStatus = await args.resolveAuthorityStatus();
  if (escalatedAuthorityStatus !== 'confirmed') {
    return escalatedAuthorityStatus;
  }

  try {
    args.platform.killProcess(args.pid, 'SIGKILL');
    return 'terminated';
  } catch {
    return args.platform.processExists(args.pid) ? 'unverified' : 'missing';
  }
}

async function terminatePersistedGatewayProcessIfConfirmed(args: {
  platform: GatewayManagerPlatform;
  state: PersistedGatewayState;
}): Promise<GatewayTerminationStatus> {
  return terminateGatewayProcess({
    platform: args.platform,
    pid: args.state.pid,
    resolveAuthorityStatus: async () => (
      await resolvePersistedGatewayPidAuthority({
        platform: args.platform,
        state: args.state,
      })
    ).status,
  });
}

async function terminateManagedGatewayProcessIfConfirmed(args: {
  platform: GatewayManagerPlatform;
  processInfo: ManagedGatewayProcessInfo;
  gatewayLogDir: string;
}): Promise<GatewayTerminationStatus> {
  return terminateGatewayProcess({
    platform: args.platform,
    pid: args.processInfo.pid,
    resolveAuthorityStatus: async () => (
      await resolveManagedGatewayPidAuthority({
        platform: args.platform,
        processInfo: args.processInfo,
        gatewayLogDir: args.gatewayLogDir,
      })
    ).status,
  });
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
    throwIfAborted((input as AbortableEnsureFileLibraryGatewayInput).signal, 'file_library_gateway_start_aborted');
    const existing = this.sessions.get(input.libraryId);
    if (existing) {
      return toEnsureGatewayResult(existing);
    }
    const port = envNumber('FILE_LIBRARY_GATEWAY_PORT_BASE', 39000) + this.sessions.size + 1;
    const created: GatewaySession = {
      loopbackUrl: `http://127.0.0.1:${port}`,
      port,
      status: 'ready',
      lastStartedAt: new Date().toISOString(),
      metadataUrl: input.metadataUrl,
      storageBucketUrl: input.storageBucketUrl,
    };
    this.sessions.set(input.libraryId, created);
    return toEnsureGatewayResult(created);
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

  async reconcile(): Promise<void> {
    return;
  }

  async shutdown(): Promise<void> {
    this.sessions.clear();
  }
}

export class RealFileLibraryGatewayManager implements FileLibraryGatewayManager {
  private readonly sessions = new Map<string, GatewaySession>();
  private readonly ownerRuntimePromise: Promise<GatewayOwnerRuntimeLease>;
  private readonly libraryReconcileInFlight = new Map<string, Promise<void>>();
  private reconcilePromise: Promise<void> | null = null;
  private reconcileInFlight: Promise<void> | null = null;
  private reconcileAbortController: AbortController | null = null;
  private ownerHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;

  constructor(
    private readonly config: FileLibraryRuntimeConfig = buildRuntimeConfig(),
    private readonly platform: GatewayManagerPlatform = gatewayManagerPlatform,
  ) {
    this.ownerRuntimePromise = this.initializeOwnerRuntime();
    this.reconcilePromise = this.startReconcile();
    void this.reconcilePromise.catch(() => undefined);
  }

  private async initializeOwnerRuntime(): Promise<GatewayOwnerRuntimeLease> {
    const lease = await createGatewayOwnerRuntimeLease({
      artifactsRoot: this.config.gatewayArtifactsRoot,
      ownerProcessPid: this.platform.ownerPid(),
      now: () => this.platform.now(),
    });
    this.ownerHeartbeatTimer = setInterval(() => {
      void lease.heartbeat().catch(() => undefined);
    }, 10_000);
    this.ownerHeartbeatTimer.unref?.();
    return lease;
  }

  private cancelReconcile(): void {
    if (this.reconcileAbortController && !this.reconcileAbortController.signal.aborted) {
      this.reconcileAbortController.abort(createAbortError('file_library_gateway_reconcile_cancelled'));
    }
  }

  private startReconcile(): Promise<void> {
    if (!this.reconcileInFlight) {
      const controller = new AbortController();
      this.reconcileAbortController = controller;
      this.reconcileInFlight = this.performReconcile(controller.signal)
        .finally(() => {
          if (this.reconcileAbortController === controller) {
            this.reconcileAbortController = null;
          }
          this.reconcileInFlight = null;
        });
    }
    this.reconcilePromise = this.reconcileInFlight;
    return this.reconcileInFlight;
  }

  private startLibraryReconcile(
    libraryId: string,
    inventory?: GatewayReconcileInventory,
  ): Promise<void> {
    const existing = this.libraryReconcileInFlight.get(libraryId);
    if (existing) {
      return existing;
    }

    const promise = this.reconcileLibrary(libraryId, inventory)
      .finally(() => {
        if (this.libraryReconcileInFlight.get(libraryId) === promise) {
          this.libraryReconcileInFlight.delete(libraryId);
        }
      });
    this.libraryReconcileInFlight.set(libraryId, promise);
    return promise;
  }

  private isCurrentSession(libraryId: string, session: GatewaySession): boolean {
    return this.sessions.get(libraryId) === session;
  }

  private isOwnedGatewaySession(
    session: GatewaySession | undefined,
  ): session is GatewaySession & {
    child: GatewayChildProcess;
    pid: number;
    ownerScope: string;
    sessionToken: string;
  } {
    return Boolean(
      session?.child
      && session.pid
      && session.ownerScope?.trim()
      && session.sessionToken?.trim(),
    );
  }

  private isOwnedGatewaySessionLive(
    session: GatewaySession | undefined,
  ): session is GatewaySession & {
    child: GatewayChildProcess;
    pid: number;
    ownerScope: string;
    sessionToken: string;
  } {
    return this.isOwnedGatewaySession(session)
      && !session.hasExited
      && this.platform.processExists(session.pid);
  }

  private doesSessionMatchGatewayInput(
    session: GatewaySession,
    input: EnsureFileLibraryGatewayInput,
  ): boolean {
    return session.metadataUrl === input.metadataUrl
      && session.storageBucketUrl === input.storageBucketUrl;
  }

  private canReuseSessionForGatewayInput(
    session: GatewaySession | undefined,
    input: EnsureFileLibraryGatewayInput,
  ): session is GatewaySession & { pid: number } {
    return Boolean(
      session?.pid
      && this.platform.processExists(session.pid)
      && session.status !== 'degraded'
      && session.status !== 'failed'
      && session.status !== 'stopped'
      && this.doesSessionMatchGatewayInput(session, input),
    );
  }

  private clearSessionIfCurrent(libraryId: string, session: GatewaySession): void {
    if (this.sessions.get(libraryId) === session) {
      this.sessions.delete(libraryId);
    }
  }

  private async waitForOwnedSessionExit(
    session: GatewaySession & {
      child: GatewayChildProcess;
      pid: number;
    },
    attempts: number,
  ): Promise<GatewayTerminationStatus> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (session.hasExited || session.child.exitCode !== null) {
        session.hasExited = true;
        return 'terminated';
      }
      if (!this.platform.processExists(session.pid)) {
        return 'missing';
      }
      await this.platform.wait(100);
    }

    if (session.hasExited || session.child.exitCode !== null) {
      session.hasExited = true;
      return 'terminated';
    }
    if (!this.platform.processExists(session.pid)) {
      return 'missing';
    }
    return 'unverified';
  }

  private signalOwnedSessionChild(
    session: GatewaySession & {
      child: GatewayChildProcess;
      pid: number;
    },
    signal: NodeJS.Signals,
  ): boolean {
    try {
      const kill = (
        session.child as GatewayChildProcess & {
          kill?: (signal?: NodeJS.Signals) => boolean;
        }
      ).kill;
      if (typeof kill === 'function') {
        return kill.call(session.child, signal);
      }
    } catch {
      // fall back to platform kill below
    }

    try {
      this.platform.killProcess(session.pid, signal);
      return true;
    } catch {
      return false;
    }
  }

  private async terminateOwnedSessionChild(
    session: GatewaySession & {
      child: GatewayChildProcess;
      pid: number;
    },
  ): Promise<GatewayTerminationStatus> {
    if (session.hasExited || session.child.exitCode !== null) {
      session.hasExited = true;
      return 'terminated';
    }
    if (!this.platform.processExists(session.pid)) {
      return 'missing';
    }

    if (!this.signalOwnedSessionChild(session, 'SIGTERM')) {
      return this.platform.processExists(session.pid) ? 'unverified' : 'missing';
    }

    const terminatedBySigterm = await this.waitForOwnedSessionExit(session, 20);
    if (terminatedBySigterm !== 'unverified') {
      return terminatedBySigterm;
    }

    if (!this.signalOwnedSessionChild(session, 'SIGKILL')) {
      return this.platform.processExists(session.pid) ? 'unverified' : 'missing';
    }

    return this.waitForOwnedSessionExit(session, 10);
  }

  private doesPersistedStateBelongToSession(
    state: PersistedGatewayState,
    session: GatewaySession & {
      pid: number;
      ownerScope: string;
      sessionToken: string;
    },
  ): boolean {
    const persistedSessionToken = state.sessionToken?.trim() ?? null;
    const sessionToken = session.sessionToken.trim();
    if (persistedSessionToken) {
      return persistedSessionToken === sessionToken;
    }
    if (state.pid !== session.pid) {
      return false;
    }
    if (state.ownerScope?.trim() && state.ownerScope !== session.ownerScope) {
      return false;
    }
    return state.loopbackUrl === session.loopbackUrl;
  }

  private async removeOwnedSessionStateIfCurrent(
    libraryId: string,
    session: GatewaySession & {
      pid: number;
      ownerScope: string;
      sessionToken: string;
    },
  ): Promise<void> {
    const persisted = await readGatewayState(this.config, libraryId);
    if (!persisted) {
      return;
    }
    if (!this.doesPersistedStateBelongToSession(persisted, session)) {
      return;
    }
    await removeGatewayState(this.config, libraryId);
  }

  private async cleanupOwnedSession(
    libraryId: string,
    session: GatewaySession & {
      child: GatewayChildProcess;
      pid: number;
      ownerScope: string;
      sessionToken: string;
    },
  ): Promise<void> {
    if (session.cleanupPromise) {
      await session.cleanupPromise;
      return;
    }

    const cleanupPromise = (async () => {
      const terminationStatus = await this.terminateOwnedSessionChild(session);
      if (terminationStatus === 'unverified') {
        throw new Error('file_library_gateway_current_boot_cleanup_unverified');
      }
      if (this.isCurrentSession(libraryId, session)) {
        this.sessions.delete(libraryId);
      }
      await this.removeOwnedSessionStateIfCurrent(libraryId, session);
    })();

    session.cleanupPromise = cleanupPromise
      .finally(() => {
        if (session.cleanupPromise === cleanupPromise) {
          session.cleanupPromise = undefined;
        }
      });
    await session.cleanupPromise;
  }

  private async listManagedProcesses(
    states?: readonly PersistedGatewayState[],
    processInventory?: readonly GatewayProcessInfo[],
  ): Promise<ManagedGatewayProcessInfo[]> {
    const resolvedStates = states ?? await listPersistedGatewayStates(this.config);
    const processes = processInventory ?? await this.platform.listProcesses();
    return processes
      .map((processInfo) => ({
        ...processInfo,
        identity: extractGatewayProcessIdentity(processInfo.args),
        matchedState: matchGatewayStateForProcess({
          processPid: processInfo.pid,
          processCommand: processInfo.args,
          gatewayStates: resolvedStates,
        }),
        libraryId: processInfo.libraryId ?? extractGatewayLibraryId(processInfo.args, this.config.gatewayLogDir),
      }))
      .filter((processInfo): processInfo is ManagedGatewayProcessInfo => (
        isGatewayCommand(processInfo.args)
        && Boolean(processInfo.libraryId || processInfo.matchedState || processInfo.identity.stableKeys.length > 0)
      ));
  }

  private async reconcileLibrary(
    libraryId: string,
    inventory?: GatewayReconcileInventory,
  ): Promise<void> {
    throwIfAborted(inventory?.signal, 'file_library_gateway_reconcile_cancelled');
    const ownerRuntime = inventory?.ownerRuntime ?? await this.ownerRuntimePromise;
    const ownerEvidence = inventory?.ownerEvidence ?? await loadGatewayOwnerEvidence(this.config, this.platform.now());
    const resolvedStates = inventory?.stateByLibraryId
      ? [...inventory.stateByLibraryId.values()]
      : await listPersistedGatewayStates(this.config);
    const stateByLibraryId = inventory?.stateByLibraryId ?? new Map(
      resolvedStates.map((state) => [state.libraryId, state]),
    );
    const processInventory = inventory?.processInventory ?? await this.platform.listProcesses();
    const allManagedProcesses = inventory?.managedProcesses ?? await this.listManagedProcesses(
      resolvedStates,
      processInventory,
    );
    let state = stateByLibraryId.get(libraryId) ?? null;
    const legacyMigrationCandidatePids = new Set<number>(
      state && stateNeedsOwnerIdentityMigration(state)
        ? findLegacyGatewayMigrationCandidates(
          state,
          allManagedProcesses.filter((processInfo) => (
            processInfo.matchedState?.libraryId === libraryId
            || processInfo.libraryId === libraryId
          )),
        ).map((processInfo) => processInfo.pid)
        : [],
    );
    if (
      state
      && (inventory?.allowWeakStateAdoption ?? true)
      && stateNeedsOwnerIdentityMigration(state)
      && canAdoptWeakGatewayState(this.platform, state)
    ) {
      state = await adoptLegacyGatewayState(
        this.config,
        this.platform,
        state,
        ownerRuntime.ownerScope,
        allManagedProcesses.filter((processInfo) => legacyMigrationCandidatePids.has(processInfo.pid)),
        {
          signal: inventory?.signal,
        },
      );
    }
    const stateAuthority = state
      ? classifyPersistedGatewayAuthority({
        platform: this.platform,
        state,
        ownerEvidence,
        currentOwnerScope: ownerRuntime.ownerScope,
      })
      : 'stale';
    const statePidAuthority = state
      ? await resolvePersistedGatewayPidAuthority({
        platform: this.platform,
        state,
        processInventory,
      })
      : { status: 'missing' as const, processInfo: null };
    if (
      state
      && stateAuthority === 'foreign_active_boot'
      && statePidAuthority.status === 'confirmed'
    ) {
      return;
    }
    const processes = allManagedProcesses.filter(
      (processInfo) => {
        if (legacyMigrationCandidatePids.has(processInfo.pid)) {
          return true;
        }
        if (processInfo.matchedState?.libraryId === libraryId) {
          return true;
        }
        if (processInfo.libraryId !== libraryId) {
          return false;
        }
        if (!state) {
          return processInfo.identity.ownerScope === ownerRuntime.ownerScope;
        }
        if (!state.ownerScope?.trim()) {
          return false;
        }
        return processInfo.identity.ownerScope === state.ownerScope;
      },
    );
    const keepPid = state && stateAuthority !== 'stale' && statePidAuthority.status === 'confirmed'
      ? state.pid
      : null;

    let finalStatePidAuthorityStatus = statePidAuthority.status;
    if (state && stateAuthority === 'stale' && statePidAuthority.status === 'confirmed') {
      const terminationStatus = await terminatePersistedGatewayProcessIfConfirmed({
        platform: this.platform,
        state,
      });
      finalStatePidAuthorityStatus = terminationStatus === 'terminated'
        ? 'missing'
        : terminationStatus;
    }

    for (const processInfo of processes) {
      throwIfAborted(inventory?.signal, 'file_library_gateway_reconcile_cancelled');
      if (keepPid && processInfo.pid === keepPid) continue;
      await terminateManagedGatewayProcessIfConfirmed({
        platform: this.platform,
        processInfo,
        gatewayLogDir: this.config.gatewayLogDir,
      });
    }

    if (state && !keepPid && finalStatePidAuthorityStatus !== 'unverified') {
      await removeGatewayState(this.config, libraryId);
    }
  }

  private async performReconcile(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal, 'file_library_gateway_reconcile_cancelled');
    const ownerRuntime = await this.ownerRuntimePromise;
    await ownerRuntime.heartbeat().catch(() => undefined);
    await mkdir(this.config.gatewayStateDir, { recursive: true });
    throwIfAborted(signal, 'file_library_gateway_reconcile_cancelled');
    const ownerEvidence = await loadGatewayOwnerEvidence(this.config, this.platform.now());
    const states = await listPersistedGatewayStates(this.config);
    const stateByLibraryId = new Map(states.map((state) => [state.libraryId, state]));
    const processInventory = await this.platform.listProcesses();
    const managedProcesses = await this.listManagedProcesses(states, processInventory);
    const processLibraryIds = new Set(
      managedProcesses
        .map((processInfo) => processInfo.libraryId ?? processInfo.matchedState?.libraryId ?? null)
        .filter((libraryId): libraryId is string => Boolean(libraryId)),
    );
    const libraryIds = [...new Set([...stateByLibraryId.keys(), ...processLibraryIds])];
    const libraryResults = await Promise.allSettled(libraryIds.map(async (libraryId) => this.startLibraryReconcile(libraryId, {
        stateByLibraryId,
        processInventory,
        managedProcesses,
        ownerEvidence,
        ownerRuntime,
        signal,
      })));

    throwIfAborted(signal, 'file_library_gateway_reconcile_cancelled');
    for (const result of libraryResults) {
      if (result.status === 'rejected') {
        throw result.reason;
      }
    }

    for (const processInfo of managedProcesses) {
      throwIfAborted(signal, 'file_library_gateway_reconcile_cancelled');
      if (processInfo.matchedState) {
        continue;
      }
      if (!shouldReapNoStateGatewayProcess({
        processInfo,
        ownerEvidence,
        currentOwnerScope: ownerRuntime.ownerScope,
      })) {
        continue;
      }
      await terminateManagedGatewayProcessIfConfirmed({
        platform: this.platform,
        processInfo,
        gatewayLogDir: this.config.gatewayLogDir,
      });
    }
  }

  async reconcile(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    await this.startReconcile();
  }

  async ensureGateway(input: EnsureFileLibraryGatewayInput): Promise<EnsureFileLibraryGatewayResult> {
    const signal = (input as AbortableEnsureFileLibraryGatewayInput).signal;
    throwIfAborted(signal, 'file_library_gateway_start_aborted');
    const ownerRuntime = await this.ownerRuntimePromise;
    await ownerRuntime.heartbeat().catch(() => undefined);
    throwIfAborted(signal, 'file_library_gateway_start_aborted');
    await ensureExecutable(this.config.juicefsBin);
    const currentSession = this.sessions.get(input.libraryId);
    if (
      this.isOwnedGatewaySessionLive(currentSession)
      && this.canReuseSessionForGatewayInput(currentSession, input)
    ) {
      return toEnsureGatewayResult(currentSession);
    }
    if (this.isOwnedGatewaySession(currentSession)) {
      await this.cleanupOwnedSession(input.libraryId, currentSession);
    } else if (currentSession) {
      this.clearSessionIfCurrent(input.libraryId, currentSession);
    }

    await waitWithAbort(0, signal);
    await this.startLibraryReconcile(input.libraryId, {
      signal,
    });
    throwIfAborted(signal, 'file_library_gateway_start_aborted');
    const existing = this.sessions.get(input.libraryId);
    if (existing && !this.isOwnedGatewaySession(existing)) {
      this.clearSessionIfCurrent(input.libraryId, existing);
    } else if (this.canReuseSessionForGatewayInput(existing, input)) {
      return toEnsureGatewayResult(existing);
    }
    if (existing) {
      this.sessions.delete(input.libraryId);
    }

    const persisted = await readGatewayState(this.config, input.libraryId);
    const ownerEvidence = await loadGatewayOwnerEvidence(this.config, this.platform.now());
    const processInventory = persisted?.pid ? await this.platform.listProcesses() : [];
    const persistedAuthority = persisted
      ? classifyPersistedGatewayAuthority({
        platform: this.platform,
        state: persisted,
        ownerEvidence,
        currentOwnerScope: ownerRuntime.ownerScope,
      })
      : 'stale';
    const persistedPidAuthority = persisted
      ? await resolvePersistedGatewayPidAuthority({
        platform: this.platform,
        state: persisted,
        processInventory,
      })
      : { status: 'missing' as const, processInfo: null };
    if (
      persisted
      && persistedAuthority === 'foreign_active_boot'
      && persistedPidAuthority.status === 'confirmed'
    ) {
      this.sessions.delete(input.libraryId);
      throw createForeignActiveBootGatewayError();
    }
    if (
      persisted
      && persistedAuthority !== 'stale'
      && persistedPidAuthority.status === 'confirmed'
      && persisted.metadataUrl === input.metadataUrl
      && persisted.storageBucketUrl === input.storageBucketUrl
    ) {
      if (await isGatewayLoopbackHealthy(this.platform, persisted.loopbackUrl, { signal })) {
        throwIfAborted(signal, 'file_library_gateway_start_aborted');
        const restored: GatewaySession = {
          ...restoreGatewaySessionFromPersistedState(persisted),
          status: 'ready',
        };
        this.sessions.set(input.libraryId, restored);
        return toEnsureGatewayResult(restored);
      }
      const terminationStatus = await terminatePersistedGatewayProcessIfConfirmed({
        platform: this.platform,
        state: persisted,
      });
      if (terminationStatus !== 'unverified') {
        await removeGatewayState(this.config, input.libraryId);
      }
    } else if (persisted && persistedPidAuthority.status === 'confirmed') {
      const terminationStatus = await terminatePersistedGatewayProcessIfConfirmed({
        platform: this.platform,
        state: persisted,
      });
      if (terminationStatus !== 'unverified') {
        await removeGatewayState(this.config, input.libraryId);
      }
    }

    await mkdir(this.config.gatewayLogDir, { recursive: true });
    const port = await findFreePort(this.config.gatewayPortBase);
    const loopbackUrl = `http://127.0.0.1:${port}`;
    const logPath = join(this.config.gatewayLogDir, `${input.libraryId}.log`);
    await mkdir(dirname(logPath), { recursive: true });
    const rootUser = deterministicGatewayUser(input.libraryId, this.config.gatewayRootUserPrefix);
    const rootPassword = deriveSecret(this.config.gatewayRootPasswordSeed, 'gateway-root', input.libraryId, 24);
    const child = this.platform.spawnGateway(
      this.config.juicefsBin,
      [
        'gateway',
        input.metadataUrl,
        `127.0.0.1:${port}`,
        ...(input.storageBucketUrl ? ['--bucket', input.storageBucketUrl] : []),
        '--log',
        logPath,
        '--no-banner',
      ],
      {
        argv0: `juicefs owner_scope=${ownerRuntime.ownerScope} library_id=${input.libraryId}`,
        env: {
          ...process.env,
          MINIO_ROOT_USER: rootUser,
          MINIO_ROOT_PASSWORD: rootPassword,
        },
      },
    );

    const created: GatewaySession = {
      loopbackUrl,
      port,
      status: 'starting',
      lastStartedAt: this.platform.now(),
      pid: child.pid ?? undefined,
      child,
      metadataUrl: input.metadataUrl,
      storageBucketUrl: input.storageBucketUrl,
      logPath,
      ownerScope: ownerRuntime.ownerScope,
      sessionToken: randomUUID(),
    };
    this.sessions.set(input.libraryId, created);
    if (child.pid) {
      await writeGatewayState(this.config, {
        libraryId: input.libraryId,
        pid: child.pid,
        port,
        loopbackUrl,
        metadataUrl: input.metadataUrl,
        storageBucketUrl: input.storageBucketUrl,
        logPath,
        lastStartedAt: created.lastStartedAt,
        ownerProcessPid: this.platform.ownerPid(),
        ownerScope: ownerRuntime.ownerScope,
        sessionToken: created.sessionToken,
        status: 'starting',
      });
    }
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      created.lastError = stderr.trim().slice(-2000);
    });
    child.on('exit', (code) => {
      created.hasExited = true;
      if (code !== 0 && created.status !== 'ready') {
        created.status = 'failed';
      } else if (code !== 0) {
        created.status = 'degraded';
      } else {
        created.status = 'stopped';
      }
      if (this.isCurrentSession(input.libraryId, created)) {
        this.sessions.delete(input.libraryId);
      }
      if (this.isOwnedGatewaySession(created)) {
        void this.removeOwnedSessionStateIfCurrent(input.libraryId, created);
      }
    });

    try {
      await waitForGateway(this.platform, loopbackUrl, { signal });
      created.status = 'ready';
      if (child.pid) {
        await writeGatewayState(this.config, {
          libraryId: input.libraryId,
          pid: child.pid,
          port,
          loopbackUrl,
          metadataUrl: input.metadataUrl,
          storageBucketUrl: input.storageBucketUrl,
          logPath,
          lastStartedAt: created.lastStartedAt,
          ownerProcessPid: this.platform.ownerPid(),
          ownerScope: ownerRuntime.ownerScope,
          sessionToken: created.sessionToken,
          status: 'ready',
        });
      }
      return toEnsureGatewayResult(created);
    } catch (error) {
      created.status = 'failed';
      created.lastError = error instanceof Error ? error.message : 'file_library_gateway_start_failed';
      if (child.pid) {
        await this.terminateOwnedSessionChild({
          ...created,
          child,
          pid: child.pid,
        }).catch(() => 'unverified' as const);
        this.clearSessionIfCurrent(input.libraryId, created);
        await removeGatewayState(this.config, input.libraryId).catch(() => undefined);
      } else {
        await removeGatewayState(this.config, input.libraryId);
      }
      throw error;
    }
  }

  async getHealth(libraryId: string): Promise<FileLibraryGatewayHealth> {
    let current = this.sessions.get(libraryId);
    let canReportReady = this.isOwnedGatewaySession(current);
    if (current && !this.isOwnedGatewaySession(current)) {
      this.clearSessionIfCurrent(libraryId, current);
      current = undefined;
      canReportReady = false;
    }
    if (!current) {
      const ownerRuntime = await this.ownerRuntimePromise;
      await this.startLibraryReconcile(libraryId, {
        allowWeakStateAdoption: false,
      });
      const persisted = await readGatewayState(this.config, libraryId);
      const processInventory = persisted?.pid ? await this.platform.listProcesses() : [];
      const persistedPidAuthority = persisted
        ? await resolvePersistedGatewayPidAuthority({
          platform: this.platform,
          state: persisted,
          processInventory,
        })
        : { status: 'missing' as const, processInfo: null };
      if (persisted && persistedPidAuthority.status === 'confirmed') {
        const ownerEvidence = await loadGatewayOwnerEvidence(this.config, this.platform.now());
        const persistedAuthority = classifyPersistedGatewayAuthority({
          platform: this.platform,
          state: persisted,
          ownerEvidence,
          currentOwnerScope: ownerRuntime.ownerScope,
        });
        if (persistedAuthority === 'foreign_active_boot') {
          this.sessions.delete(libraryId);
          return {
            status: 'stopped',
            checkedAt: this.platform.now(),
          };
        }
        current = restoreGatewaySessionFromPersistedState(persisted);
        canReportReady = persistedAuthority === 'current_boot';
      }
    }
    if (!current) {
      return {
        status: 'stopped',
        checkedAt: this.platform.now(),
      };
    }
    if (current.pid && !this.platform.processExists(current.pid)) {
      this.clearSessionIfCurrent(libraryId, current);
      await removeGatewayState(this.config, libraryId);
      return {
        status: current.status === 'failed' ? 'failed' : 'stopped',
        checkedAt: this.platform.now(),
        lastError: current.lastError,
      };
    }
    try {
      const healthy = await isGatewayLoopbackHealthy(this.platform, current.loopbackUrl);
      const status = healthy && canReportReady ? 'ready' : 'degraded';
      current.status = status;
      if (status === 'ready') {
        this.sessions.set(libraryId, current);
      } else if (!this.isOwnedGatewaySession(current)) {
        this.clearSessionIfCurrent(libraryId, current);
      }
      return {
        status,
        checkedAt: this.platform.now(),
        lastError: current.lastError,
      };
    } catch (error) {
      current.lastError = error instanceof Error ? error.message : 'file_library_gateway_health_failed';
      current.status = 'degraded';
      if (!this.isOwnedGatewaySession(current)) {
        this.clearSessionIfCurrent(libraryId, current);
      }
      return {
        status: 'degraded',
        checkedAt: this.platform.now(),
        lastError: current.lastError,
      };
    }
  }

  async stopGateway(libraryId: string): Promise<void> {
    const ownerRuntime = await this.ownerRuntimePromise;
    const currentSession = this.sessions.get(libraryId);
    if (this.isOwnedGatewaySession(currentSession)) {
      await this.cleanupOwnedSession(libraryId, currentSession);
    } else if (currentSession) {
      this.sessions.delete(libraryId);
    }

    const persisted = await readGatewayState(this.config, libraryId);
    const processInventory = persisted?.pid ? await this.platform.listProcesses() : [];
    const persistedPidAuthority = persisted
      ? await resolvePersistedGatewayPidAuthority({
        platform: this.platform,
        state: persisted,
        processInventory,
      })
      : { status: 'missing' as const, processInfo: null };
    if (persisted && persistedPidAuthority.status === 'confirmed') {
      const ownerEvidence = await loadGatewayOwnerEvidence(this.config, this.platform.now());
      const persistedAuthority = classifyPersistedGatewayAuthority({
        platform: this.platform,
        state: persisted,
        ownerEvidence,
        currentOwnerScope: ownerRuntime.ownerScope,
      });
      if (persistedAuthority === 'foreign_active_boot') {
        this.sessions.delete(libraryId);
        return;
      }
    }
    let finalPersistedPidAuthorityStatus = persistedPidAuthority.status;
    if (persisted && persistedPidAuthority.status === 'confirmed') {
      const terminationStatus = await terminatePersistedGatewayProcessIfConfirmed({
        platform: this.platform,
        state: persisted,
      });
      finalPersistedPidAuthorityStatus = terminationStatus === 'terminated'
        ? 'missing'
        : terminationStatus;
    }
    this.sessions.delete(libraryId);
    if (persisted && finalPersistedPidAuthorityStatus !== 'unverified') {
      await removeGatewayState(this.config, libraryId);
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.shuttingDown = true;
      this.cancelReconcile();
      await this.reconcileInFlight?.catch(() => undefined);
      const libraryIds = new Set<string>([
        ...this.sessions.keys(),
        ...(await listStateLibraryIds(this.config)),
      ]);
      for (const libraryId of libraryIds) {
        await this.stopGateway(libraryId);
      }
    } finally {
      if (this.ownerHeartbeatTimer) {
        clearInterval(this.ownerHeartbeatTimer);
        this.ownerHeartbeatTimer = null;
      }
      const ownerRuntime = await this.ownerRuntimePromise.catch(() => null);
      if (ownerRuntime) {
        await ownerRuntime.release().catch(() => undefined);
      }
    }
  }
}
