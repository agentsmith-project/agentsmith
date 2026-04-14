import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path, { basename, join } from 'node:path';

export interface GatewayProcessIdentity {
  ownerScope: string | null;
  libraryId: string | null;
  listenAddress: string | null;
  metadataUrl: string | null;
  storageBucketUrl: string | null;
  logPath: string | null;
  stableKeys: string[];
  label: string;
}

export interface GatewayStateIdentityRecord {
  libraryId: string;
  pid: number | null | undefined;
  ownerScope: string | null | undefined;
  loopbackUrl: string | null | undefined;
  metadataUrl: string | null | undefined;
  storageBucketUrl: string | null | undefined;
  logPath: string | null | undefined;
}

export interface GatewayOwnerScopeParts {
  instanceId: string;
  bootId: string;
}

export interface GatewayOwnerLedgerPaths {
  ownershipDir: string;
  instanceFilePath: string;
  bootsDir: string;
}

export interface GatewayOwnerBootRecord {
  scope: string;
  instanceId: string;
  bootId: string;
  ownerProcessPid: number | null;
  startedAt: string;
  heartbeatAt: string;
  releasedAt: string | null;
}

export interface GatewayOwnerLedgerSnapshot {
  localInstanceId: string | null;
  bootRecordsByScope: Map<string, GatewayOwnerBootRecord>;
}

export interface GatewayOwnerEvidence {
  localInstanceId: string | null;
  scopeStatusByScope: Map<string, 'active' | 'stale'>;
}

export interface GatewayOwnerRuntimeLease {
  instanceId: string;
  bootId: string;
  ownerScope: string;
  heartbeat(): Promise<void>;
  release(): Promise<void>;
}

const OWNER_SCOPE_PREFIX = 'api-v1';
const OWNER_SCOPE_PATTERN = /^api-v1:([^:\s]+):([^:\s]+)$/;
const DEFAULT_OWNERSHIP_DIR = 'file-library-gateway-ownership';
const DEFAULT_OWNER_HEARTBEAT_STALE_MS = 30_000;
const OWNER_INSTANCE_ID_RETRY_COUNT = 20;
const OWNER_INSTANCE_ID_RETRY_DELAY_MS = 10;

function normalizeGatewayIdentityValue(value: string): string {
  return value.trim();
}

function extractGatewayOwnerScope(command: string): string | null {
  const match = command.match(/(?:^|\s)owner_scope=([^\s]+)/);
  return match?.[1] ?? null;
}

function extractGatewayExplicitLibraryId(command: string): string | null {
  const match = command.match(/(?:^|\s)library_id=([^\s]+)/);
  return match?.[1] ?? null;
}

function extractGatewayLogPath(command: string): string | null {
  const match = command.match(/--log\s+([^\s]+)/);
  return match?.[1] ?? null;
}

function extractGatewayMetadataUrl(command: string): string | null {
  const match = command.match(/(?:^|\s)gateway\s+([^\s]+)/);
  return match?.[1] ?? null;
}

function extractGatewayListenAddress(command: string): string | null {
  const match = command.match(/(?:^|\s)gateway\s+[^\s]+\s+([^\s]+)/);
  return match?.[1] ?? null;
}

function extractGatewayStorageBucketUrl(command: string): string | null {
  const match = command.match(/--bucket\s+([^\s]+)/);
  return match?.[1] ?? null;
}

export function buildGatewayOwnerScope(instanceId: string, bootId: string): string {
  return `${OWNER_SCOPE_PREFIX}:${instanceId}:${bootId}`;
}

export function parseGatewayOwnerScope(ownerScope: string | null | undefined): GatewayOwnerScopeParts | null {
  if (!ownerScope?.trim()) {
    return null;
  }
  const match = ownerScope.trim().match(OWNER_SCOPE_PATTERN);
  if (!match) {
    return null;
  }
  return {
    instanceId: match[1],
    bootId: match[2],
  };
}

export function isGatewayCommand(command: string): boolean {
  return command.includes('juicefs') && /(?:^|\s)gateway\s+\S+/.test(command);
}

export function extractGatewayLibraryId(command: string, gatewayLogDir: string): string | null {
  const explicitLibraryId = extractGatewayExplicitLibraryId(command);
  if (explicitLibraryId) {
    return explicitLibraryId;
  }
  if (!isGatewayCommand(command)) {
    return null;
  }
  const logPath = extractGatewayLogPath(command);
  if (!logPath) {
    return null;
  }
  const resolvedLogDir = path.resolve(gatewayLogDir);
  const resolvedLogPath = path.resolve(logPath);
  if (!resolvedLogPath.startsWith(`${resolvedLogDir}${path.sep}`) && resolvedLogPath !== resolvedLogDir) {
    return null;
  }
  const fileName = basename(resolvedLogPath);
  if (!fileName.endsWith('.log')) {
    return null;
  }
  return fileName.slice(0, -'.log'.length);
}

export function buildGatewayStableKeys(args: {
  ownerScope?: string | null;
  libraryId?: string | null;
}): string[] {
  const stableKeys = new Set<string>();
  const ownerScope = args.ownerScope?.trim() ? normalizeGatewayIdentityValue(args.ownerScope) : null;
  const libraryId = args.libraryId?.trim() ? normalizeGatewayIdentityValue(args.libraryId) : null;

  if (ownerScope && libraryId) {
    stableKeys.add(`scope_library:${ownerScope}:${libraryId}`);
  }

  return [...stableKeys];
}

export function labelGatewayStableKeys(stableKeys: readonly string[]): string {
  return stableKeys.find((key) => key.startsWith('scope_library:'))
    ?? 'unidentified';
}

export function extractGatewayProcessIdentity(command: string): GatewayProcessIdentity {
  const ownerScope = extractGatewayOwnerScope(command);
  const libraryId = extractGatewayExplicitLibraryId(command);
  const listenAddress = extractGatewayListenAddress(command);
  const metadataUrl = extractGatewayMetadataUrl(command);
  const storageBucketUrl = extractGatewayStorageBucketUrl(command);
  const logPath = extractGatewayLogPath(command);
  const stableKeys = buildGatewayStableKeys({
    ownerScope,
    libraryId,
  });
  return {
    ownerScope,
    libraryId,
    listenAddress,
    metadataUrl,
    storageBucketUrl,
    logPath,
    stableKeys,
    label: labelGatewayStableKeys(stableKeys),
  };
}

export function buildGatewayStateIdentity(state: GatewayStateIdentityRecord): GatewayProcessIdentity {
  const stableKeys = buildGatewayStableKeys({
    ownerScope: state.ownerScope,
    libraryId: state.libraryId,
  });
  return {
    ownerScope: state.ownerScope ?? null,
    libraryId: state.libraryId,
    listenAddress: state.loopbackUrl ? state.loopbackUrl.replace(/^https?:\/\//, '') : null,
    metadataUrl: state.metadataUrl ?? null,
    storageBucketUrl: state.storageBucketUrl ?? null,
    logPath: state.logPath ?? null,
    stableKeys,
    label: labelGatewayStableKeys(stableKeys),
  };
}

function resolveGatewayLoopbackListenAddress(loopbackUrl: string | null | undefined): string | null {
  return loopbackUrl?.trim()
    ? loopbackUrl.replace(/^https?:\/\//, '')
    : null;
}

function pathsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left?.trim() || !right?.trim()) {
    return false;
  }
  return path.resolve(left) === path.resolve(right);
}

function countLegacyGatewayIdentityMatches(
  processIdentity: GatewayProcessIdentity,
  state: GatewayStateIdentityRecord,
): number {
  let matches = 0;

  if (state.metadataUrl && processIdentity.metadataUrl === state.metadataUrl) {
    matches += 1;
  }
  if (state.storageBucketUrl && processIdentity.storageBucketUrl === state.storageBucketUrl) {
    matches += 1;
  }
  if (processIdentity.listenAddress && processIdentity.listenAddress === resolveGatewayLoopbackListenAddress(state.loopbackUrl)) {
    matches += 1;
  }

  return matches;
}

function matchesLegacyGatewayState<State extends GatewayStateIdentityRecord>(
  processIdentity: GatewayProcessIdentity,
  state: State,
): boolean {
  if (processIdentity.ownerScope?.trim()) {
    return false;
  }
  if (parseGatewayOwnerScope(state.ownerScope ?? null) !== null) {
    return false;
  }
  if (pathsMatch(processIdentity.logPath, state.logPath ?? null)) {
    return true;
  }
  return countLegacyGatewayIdentityMatches(processIdentity, state) >= 2;
}

function matchesExplicitGatewayState<State extends GatewayStateIdentityRecord>(
  processIdentity: GatewayProcessIdentity,
  state: State,
): boolean {
  const processOwnerScope = processIdentity.ownerScope?.trim()
    ? normalizeGatewayIdentityValue(processIdentity.ownerScope)
    : null;
  const processLibraryId = processIdentity.libraryId?.trim()
    ? normalizeGatewayIdentityValue(processIdentity.libraryId)
    : null;

  if (processOwnerScope) {
    const stateOwnerScope = state.ownerScope?.trim()
      ? normalizeGatewayIdentityValue(state.ownerScope)
      : null;
    if (stateOwnerScope !== processOwnerScope) {
      return false;
    }
  }

  if (processLibraryId && normalizeGatewayIdentityValue(state.libraryId) !== processLibraryId) {
    return false;
  }

  return processOwnerScope !== null || processLibraryId !== null;
}

export function matchGatewayStateForProcess<State extends GatewayStateIdentityRecord>(args: {
  processPid: number;
  processCommand: string;
  gatewayStates: readonly State[];
}): State | null {
  const processIdentity = extractGatewayProcessIdentity(args.processCommand);
  const explicitIdentityMatches = args.gatewayStates.filter((state) => matchesExplicitGatewayState(processIdentity, state));
  if (explicitIdentityMatches.length > 0) {
    const pidMatch = explicitIdentityMatches.find((state) => state.pid === args.processPid);
    if (pidMatch) {
      return pidMatch;
    }
    return explicitIdentityMatches.length === 1 ? explicitIdentityMatches[0] : null;
  }

  if (processIdentity.ownerScope?.trim() || processIdentity.libraryId?.trim()) {
    return null;
  }

  const legacyMatches = args.gatewayStates.filter((state) => matchesLegacyGatewayState(processIdentity, state));
  const pidMatch = legacyMatches.find((state) => state.pid === args.processPid);
  if (pidMatch) {
    return pidMatch;
  }
  return legacyMatches.length === 1 ? legacyMatches[0] : null;
}

export function resolveGatewayOwnerLedgerPaths(artifactsRoot: string): GatewayOwnerLedgerPaths {
  const ownershipDir = join(artifactsRoot, DEFAULT_OWNERSHIP_DIR);
  return {
    ownershipDir,
    instanceFilePath: join(ownershipDir, 'instance.json'),
    bootsDir: join(ownershipDir, 'boots'),
  };
}

async function readGatewayOwnerInstanceId(paths: GatewayOwnerLedgerPaths): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(paths.instanceFilePath, 'utf8')) as { instanceId?: string };
    return typeof raw.instanceId === 'string' && raw.instanceId.trim()
      ? raw.instanceId.trim()
      : null;
  } catch {
    return null;
  }
}

async function readGatewayOwnerBootRecord(filePath: string): Promise<GatewayOwnerBootRecord | null> {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as Partial<GatewayOwnerBootRecord>;
    if (
      typeof raw.scope !== 'string'
      || typeof raw.instanceId !== 'string'
      || typeof raw.bootId !== 'string'
      || typeof raw.startedAt !== 'string'
      || typeof raw.heartbeatAt !== 'string'
    ) {
      return null;
    }
    return {
      scope: raw.scope,
      instanceId: raw.instanceId,
      bootId: raw.bootId,
      ownerProcessPid: typeof raw.ownerProcessPid === 'number' && Number.isInteger(raw.ownerProcessPid) && raw.ownerProcessPid > 0
        ? raw.ownerProcessPid
        : null,
      startedAt: raw.startedAt,
      heartbeatAt: raw.heartbeatAt,
      releasedAt: typeof raw.releasedAt === 'string' && raw.releasedAt.trim() ? raw.releasedAt.trim() : null,
    };
  } catch {
    return null;
  }
}

export async function ensureGatewayOwnerInstanceId(artifactsRoot: string): Promise<string> {
  const paths = resolveGatewayOwnerLedgerPaths(artifactsRoot);
  await mkdir(paths.ownershipDir, { recursive: true });
  const existing = await readGatewayOwnerInstanceId(paths);
  if (existing) {
    return existing;
  }
  const instanceId = randomUUID();
  const payload = JSON.stringify({ instanceId }, null, 2);

  try {
    await writeFile(paths.instanceFilePath, payload, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return instanceId;
  } catch (error) {
    const errorCode = error instanceof Error && 'code' in error ? error.code : null;
    if (errorCode !== 'EEXIST') {
      throw error;
    }
  }

  for (let attempt = 0; attempt < OWNER_INSTANCE_ID_RETRY_COUNT; attempt += 1) {
    const persisted = await readGatewayOwnerInstanceId(paths);
    if (persisted) {
      return persisted;
    }
    await new Promise((resolve) => setTimeout(resolve, OWNER_INSTANCE_ID_RETRY_DELAY_MS));
  }

  throw new Error('file_library_gateway_owner_instance_id_unavailable');
}

export async function upsertGatewayOwnerBootRecord(args: {
  artifactsRoot: string;
  instanceId: string;
  bootId: string;
  ownerProcessPid: number;
  now: string;
  releasedAt?: string | null;
}): Promise<GatewayOwnerBootRecord> {
  const paths = resolveGatewayOwnerLedgerPaths(args.artifactsRoot);
  await mkdir(paths.bootsDir, { recursive: true });
  const filePath = join(paths.bootsDir, `${args.bootId}.json`);
  const existing = await readGatewayOwnerBootRecord(filePath);
  const record: GatewayOwnerBootRecord = {
    scope: buildGatewayOwnerScope(args.instanceId, args.bootId),
    instanceId: args.instanceId,
    bootId: args.bootId,
    ownerProcessPid: args.ownerProcessPid,
    startedAt: existing?.startedAt ?? args.now,
    heartbeatAt: args.now,
    releasedAt: args.releasedAt ?? existing?.releasedAt ?? null,
  };
  await writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
  return record;
}

export async function createGatewayOwnerRuntimeLease(args: {
  artifactsRoot: string;
  ownerProcessPid: number;
  now: () => string;
}): Promise<GatewayOwnerRuntimeLease> {
  const instanceId = await ensureGatewayOwnerInstanceId(args.artifactsRoot);
  const bootId = randomUUID();
  await upsertGatewayOwnerBootRecord({
    artifactsRoot: args.artifactsRoot,
    instanceId,
    bootId,
    ownerProcessPid: args.ownerProcessPid,
    now: args.now(),
  });

  return {
    instanceId,
    bootId,
    ownerScope: buildGatewayOwnerScope(instanceId, bootId),
    async heartbeat() {
      await upsertGatewayOwnerBootRecord({
        artifactsRoot: args.artifactsRoot,
        instanceId,
        bootId,
        ownerProcessPid: args.ownerProcessPid,
        now: args.now(),
      });
    },
    async release() {
      const now = args.now();
      await upsertGatewayOwnerBootRecord({
        artifactsRoot: args.artifactsRoot,
        instanceId,
        bootId,
        ownerProcessPid: args.ownerProcessPid,
        now,
        releasedAt: now,
      });
    },
  };
}

export async function loadGatewayOwnerLedgerSnapshot(artifactsRoot: string): Promise<GatewayOwnerLedgerSnapshot> {
  const paths = resolveGatewayOwnerLedgerPaths(artifactsRoot);
  const localInstanceId = await readGatewayOwnerInstanceId(paths);
  const bootRecordsByScope = new Map<string, GatewayOwnerBootRecord>();

  try {
    const entries = await readdir(paths.bootsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      const record = await readGatewayOwnerBootRecord(join(paths.bootsDir, entry.name));
      if (!record) {
        continue;
      }
      bootRecordsByScope.set(record.scope, record);
    }
  } catch {
    // ignore missing ownership dir
  }

  return {
    localInstanceId,
    bootRecordsByScope,
  };
}

export function buildGatewayOwnerEvidence(args: {
  ledger: GatewayOwnerLedgerSnapshot;
  now: string;
  heartbeatStaleMs?: number;
}): GatewayOwnerEvidence {
  const heartbeatStaleMs = args.heartbeatStaleMs ?? DEFAULT_OWNER_HEARTBEAT_STALE_MS;
  const nowMs = Date.parse(args.now);
  const scopeStatusByScope = new Map<string, 'active' | 'stale'>();

  if (!args.ledger.localInstanceId || !Number.isFinite(nowMs)) {
    return {
      localInstanceId: args.ledger.localInstanceId,
      scopeStatusByScope,
    };
  }

  for (const [scope, record] of args.ledger.bootRecordsByScope) {
    const parsedScope = parseGatewayOwnerScope(scope);
    if (!parsedScope || parsedScope.instanceId !== args.ledger.localInstanceId) {
      continue;
    }
    const heartbeatSource = record.releasedAt ?? record.heartbeatAt ?? record.startedAt;
    const heartbeatMs = Date.parse(heartbeatSource);
    if (!Number.isFinite(heartbeatMs)) {
      continue;
    }
    const isActive = record.releasedAt === null && nowMs - heartbeatMs <= heartbeatStaleMs;
    scopeStatusByScope.set(scope, isActive ? 'active' : 'stale');
  }

  return {
    localInstanceId: args.ledger.localInstanceId,
    scopeStatusByScope,
  };
}

export function classifyGatewayOwnerScope(args: {
  ownerScope: string | null | undefined;
  ownerEvidence: GatewayOwnerEvidence;
}): 'active' | 'stale' | 'foreign' | 'unverified' | 'unknown' {
  if (!args.ownerScope?.trim()) {
    return 'unknown';
  }
  const parsedScope = parseGatewayOwnerScope(args.ownerScope);
  if (!parsedScope) {
    return 'unverified';
  }
  if (!args.ownerEvidence.localInstanceId?.trim()) {
    return 'unverified';
  }
  if (parsedScope.instanceId !== args.ownerEvidence.localInstanceId) {
    return 'foreign';
  }
  const status = args.ownerEvidence.scopeStatusByScope.get(args.ownerScope);
  if (status === 'active' || status === 'stale') {
    return status;
  }
  return 'unverified';
}
