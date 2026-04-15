import { execFile } from 'node:child_process';
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildGatewayOwnerEvidence,
  classifyGatewayManagedProcessAuthority,
  classifyPersistedGatewayJanitorAuthority,
  extractGatewayProcessIdentity,
  isPersistedGatewayPidAuthorityConfirmed,
  isGatewayCommand,
  loadGatewayOwnerLedgerSnapshot,
  matchGatewayStateForProcess as matchGatewayStateForProcessFromOwnership,
  type GatewayOwnerEvidence,
} from '../packages/api-entry-node/src/file-library-gateway-ownership.js';
import {
  isNotebookRunnerProcessSnapshot,
  notebookRunnerProcessNeedsCwd,
} from '../packages/notebook-codex-runner/src/task-workspace-ownership.js';
import { resolveFileLibraryGatewayPaths } from '../packages/api-entry-node/src/file-library-gateway-paths.js';

const execFileAsync = promisify(execFile);

export interface ManagedProcessInfo {
  pid: number;
  ppid: number;
  ageSeconds: number;
  command: string;
  cwd: string | null;
}

export interface GatewayStateRecord {
  libraryId: string;
  pid: number | null;
  ownerProcessPid: number | null;
  ownerScope: string | null;
  port: number | null;
  loopbackUrl: string | null;
  metadataUrl: string | null;
  storageBucketUrl: string | null;
  logPath: string | null;
  lastStartedAt: string | null;
  status: string | null;
  stateFilePath: string;
}

export interface GatewayStateDecision {
  action: 'remove_state' | 'stop_gateway_and_remove_state' | 'adopt_state' | 'keep';
  reason: string;
}

export interface GatewayProcessDecision {
  action: 'stop_gateway' | 'keep';
  reason: string;
}

export interface TaskMountDecision {
  action: 'reclaim_mount' | 'keep';
  reason: string;
}

export { extractGatewayProcessIdentity };
export type { GatewayProcessIdentity } from '../packages/api-entry-node/src/file-library-gateway-ownership.js';

export type TaskMountpointStatus = 'exact_mount' | 'covered_by_parent_mount' | 'not_mounted';

interface GatewayStateDiskShape {
  pid?: number;
  ownerProcessPid?: number;
  ownerScope?: string;
  port?: number;
  loopbackUrl?: string;
  metadataUrl?: string;
  storageBucketUrl?: string;
  logPath?: string;
  lastStartedAt?: string;
  status?: string;
}

interface TaskMountRegistryDiskShape {
  sessions?: TaskMountRegistrySessionShape[];
}

interface TaskMountRegistrySessionShape {
  mount_path?: string;
  ownerProcessPid?: number;
  owner_process_pid?: number;
}

interface PreflightOptions {
  apply: boolean;
  context: string;
  rootDir: string;
  gatewayArtifactsRoot: string;
  gatewayStateDir: string;
  gatewayLogDir: string;
  taskMountRoot: string;
  taskMountRegistryPath: string;
  noStateGatewayMinAgeSeconds: number;
}

const EMPTY_GATEWAY_OWNER_EVIDENCE: GatewayOwnerEvidence = {
  localInstanceId: null,
  scopeStatusByScope: new Map(),
};

function logLine(message: string): void {
  process.stdout.write(`[juicefs-orphan-preflight] ${message}\n`);
}

function warnLine(message: string): void {
  process.stderr.write(`[juicefs-orphan-preflight] WARN: ${message}\n`);
}

function normalizePid(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

export function classifyGatewayState(args: {
  state: GatewayStateRecord;
  livePids: ReadonlySet<number>;
  processTableByPid?: ReadonlyMap<number, ManagedProcessInfo>;
  ownerEvidence?: GatewayOwnerEvidence;
  currentOwnerScope?: string | null;
}): GatewayStateDecision {
  const pidAlive = args.state.pid !== null && args.livePids.has(args.state.pid);

  if (!pidAlive) {
    return {
      action: 'remove_state',
      reason: 'state_pid_dead',
    };
  }

  if (args.processTableByPid) {
    const processInfo = args.processTableByPid.get(args.state.pid!);
    if (!processInfo || !isPersistedGatewayPidAuthorityConfirmed({
      state: args.state,
      processPid: processInfo.pid,
      processCommand: processInfo.command,
    })) {
      return {
        action: 'keep',
        reason: 'pid_authority_unverified',
      };
    }
  }

  const authorityDecision = classifyPersistedGatewayJanitorAuthority({
    ownerScope: args.state.ownerScope,
    ownerProcessPid: args.state.ownerProcessPid,
    currentOwnerScope: args.currentOwnerScope,
    ownerEvidence: args.ownerEvidence ?? EMPTY_GATEWAY_OWNER_EVIDENCE,
    pidAuthorityStatus: 'confirmed',
    processExists: (pid) => args.livePids.has(pid),
  });

  switch (authorityDecision.authority) {
    case 'ownerless_adoptable':
      return {
        action: 'adopt_state',
        reason: authorityDecision.reason,
      };
    case 'stale_reclaimable':
    case 'released':
      return {
        action: 'stop_gateway_and_remove_state',
        reason: authorityDecision.reason,
      };
    case 'foreign_active':
    case 'unverified':
      return {
        action: 'keep',
        reason: authorityDecision.reason,
      };
    case 'current_active':
      return {
        action: 'keep',
        reason: 'owner_and_gateway_alive',
      };
  }
}

export function classifyGatewayProcessWithoutState(args: {
  processInfo: ManagedProcessInfo;
  ownerEvidence: GatewayOwnerEvidence;
  minAgeSeconds: number;
  currentOwnerScope?: string | null;
}): GatewayProcessDecision {
  const identity = extractGatewayProcessIdentity(args.processInfo.command);

  if (!identity.ownerScope || !identity.libraryId) {
    return {
      action: 'keep',
      reason: 'owner_scope_unknown',
    };
  }

  const authorityDecision = classifyGatewayManagedProcessAuthority({
    ownerScope: identity.ownerScope,
    currentOwnerScope: args.currentOwnerScope,
    ownerEvidence: args.ownerEvidence,
  });

  if (authorityDecision.authority === 'current_active') {
    return {
      action: 'keep',
      reason: 'local_owner_boot_active',
    };
  }

  if (authorityDecision.authority === 'foreign_active') {
    return {
      action: 'keep',
      reason: 'foreign_owner_scope',
    };
  }

  if (authorityDecision.authority === 'unverified') {
    return {
      action: 'keep',
      reason: 'owner_scope_unverified',
    };
  }

  if (authorityDecision.authority === 'released') {
    return {
      action: 'stop_gateway',
      reason: authorityDecision.reason,
    };
  }

  if (authorityDecision.authority !== 'stale_reclaimable') {
    return {
      action: 'keep',
      reason: 'owner_scope_unknown',
    };
  }

  if (args.processInfo.ageSeconds < args.minAgeSeconds) {
    return {
      action: 'keep',
      reason: 'process_too_fresh',
    };
  }

  return {
    action: 'stop_gateway',
    reason: 'local_owner_boot_stale',
  };
}

export function classifyTaskMountProcess(args: {
  processInfo?: ManagedProcessInfo | null;
  anyRunnerAlive: boolean;
  livePids: ReadonlySet<number>;
  ownerProcessPid: number | null;
  processTableByPid?: ReadonlyMap<number, ManagedProcessInfo>;
}): TaskMountDecision {
  if (args.ownerProcessPid !== null) {
    const ownerProcess = args.processTableByPid?.get(args.ownerProcessPid) ?? null;
    if (ownerProcess) {
      if (isNotebookRunnerProcessSnapshot(ownerProcess)) {
        return {
          action: 'keep',
          reason: 'mount_owner_alive',
        };
      }
      return {
        action: 'reclaim_mount',
        reason: 'mount_owner_pid_reused',
      };
    }
    if (args.livePids.has(args.ownerProcessPid)) {
      return {
        action: 'keep',
        reason: 'mount_owner_alive',
      };
    }
    return {
      action: 'reclaim_mount',
      reason: 'mount_owner_pid_dead',
    };
  }

  if (args.anyRunnerAlive) {
    return {
      action: 'keep',
      reason: 'runner_alive',
    };
  }

  return {
    action: 'reclaim_mount',
    reason: 'runner_absent_for_host_mount',
  };
}

function buildProcessTableByPid(processes: readonly ManagedProcessInfo[]): Map<number, ManagedProcessInfo> {
  return new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
}

function buildProcessChildrenByPid(processes: readonly ManagedProcessInfo[]): Map<number, ManagedProcessInfo[]> {
  const childrenByPid = new Map<number, ManagedProcessInfo[]>();
  for (const processInfo of processes) {
    const siblings = childrenByPid.get(processInfo.ppid) ?? [];
    siblings.push(processInfo);
    childrenByPid.set(processInfo.ppid, siblings);
  }
  return childrenByPid;
}

function hasTrackedNotebookRunnerAlive(args: {
  trackedRunnerPid: number | null;
  livePids: ReadonlySet<number>;
  processTableByPid: ReadonlyMap<number, ManagedProcessInfo>;
  processes: readonly ManagedProcessInfo[];
}): boolean {
  if (args.trackedRunnerPid === null || !args.livePids.has(args.trackedRunnerPid)) {
    return false;
  }
  const trackedProcess = args.processTableByPid.get(args.trackedRunnerPid) ?? null;
  if (trackedProcess && isNotebookRunnerProcessSnapshot(trackedProcess)) {
    return true;
  }

  const childrenByPid = buildProcessChildrenByPid(args.processes);
  const visited = new Set<number>();
  const queue = [...(childrenByPid.get(args.trackedRunnerPid) ?? [])];

  while (queue.length > 0) {
    const processInfo = queue.shift();
    if (!processInfo || visited.has(processInfo.pid)) {
      continue;
    }
    visited.add(processInfo.pid);
    if (args.livePids.has(processInfo.pid) && isNotebookRunnerProcessSnapshot(processInfo)) {
      return true;
    }
    queue.push(...(childrenByPid.get(processInfo.pid) ?? []));
  }

  return false;
}

export function hasAnyNotebookRunnerAlive(args: {
  trackedRunnerPid: number | null;
  livePids: ReadonlySet<number>;
  processes: readonly ManagedProcessInfo[];
}): boolean {
  const processTableByPid = buildProcessTableByPid(args.processes);
  const trackedRunnerAlive = hasTrackedNotebookRunnerAlive({
    trackedRunnerPid: args.trackedRunnerPid,
    livePids: args.livePids,
    processTableByPid,
    processes: args.processes,
  });
  return Boolean(
    trackedRunnerAlive
      || args.processes.some((processInfo) => isNotebookRunnerProcessSnapshot(processInfo)),
  );
}

export function buildTaskMountUmountAttempts(mountPath: string): Array<{ command: string; args: string[] }> {
  return [
    { command: 'juicefs', args: ['umount', mountPath] },
    { command: 'juicefs', args: ['umount', '-f', mountPath] },
    { command: 'umount', args: ['-l', mountPath] },
    { command: 'umount', args: ['-lf', mountPath] },
  ];
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function safeReadPidFile(filePath: string): Promise<number | null> {
  try {
    const raw = (await readFile(filePath, 'utf8')).trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadTaskMountRegistryOwners(registryPath: string): Promise<Map<string, number | null>> {
  if (!await pathExists(registryPath)) {
    return new Map();
  }

  try {
    const raw = JSON.parse(await readFile(registryPath, 'utf8')) as TaskMountRegistryDiskShape;
    const entries = new Map<string, number | null>();
    for (const session of raw.sessions ?? []) {
      const mountPath = typeof session.mount_path === 'string' && session.mount_path.trim()
        ? session.mount_path.trim()
        : null;
      if (!mountPath) {
        continue;
      }
      const ownerProcessPid = normalizePid(session.ownerProcessPid ?? session.owner_process_pid);
      entries.set(mountPath, ownerProcessPid);
    }
    return entries;
  } catch (error) {
    warnLine(`unable to parse task mount registry ${registryPath}: ${error instanceof Error ? error.message : String(error)}`);
    return new Map();
  }
}

async function loadGatewayStates(gatewayStateDir: string): Promise<GatewayStateRecord[]> {
  if (!await pathExists(gatewayStateDir)) {
    return [];
  }

  const entries = await readdir(gatewayStateDir, { withFileTypes: true });
  const states: GatewayStateRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const stateFilePath = path.join(gatewayStateDir, entry.name);
    try {
      const state = JSON.parse(await readFile(stateFilePath, 'utf8')) as GatewayStateDiskShape;
      states.push({
        libraryId: entry.name.replace(/\.json$/, ''),
        pid: normalizePid(state.pid),
        ownerProcessPid: normalizePid(state.ownerProcessPid),
        ownerScope: typeof state.ownerScope === 'string' && state.ownerScope.trim() ? state.ownerScope.trim() : null,
        port: normalizePid(state.port),
        loopbackUrl: typeof state.loopbackUrl === 'string' && state.loopbackUrl.trim() ? state.loopbackUrl.trim() : null,
        metadataUrl: typeof state.metadataUrl === 'string' && state.metadataUrl.trim() ? state.metadataUrl.trim() : null,
        storageBucketUrl: typeof state.storageBucketUrl === 'string' && state.storageBucketUrl.trim() ? state.storageBucketUrl.trim() : null,
        logPath: typeof state.logPath === 'string' && state.logPath.trim() ? state.logPath.trim() : null,
        lastStartedAt: typeof state.lastStartedAt === 'string' && state.lastStartedAt.trim() ? state.lastStartedAt.trim() : null,
        status: typeof state.status === 'string' && state.status.trim() ? state.status.trim() : null,
        stateFilePath,
      });
    } catch (error) {
      warnLine(`unable to parse state file ${stateFilePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return states;
}

async function loadProcessTable(): Promise<ManagedProcessInfo[]> {
  const { stdout } = await execFileAsync('ps', ['-ww', '-eo', 'pid=,ppid=,etimes=,command='], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  const processes = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number.parseInt(match[1], 10),
        ppid: Number.parseInt(match[2], 10),
        ageSeconds: Number.parseInt(match[3], 10),
        command: match[4],
        cwd: null,
      } satisfies ManagedProcessInfo;
    })
    .filter((value): value is ManagedProcessInfo => value !== null);
  await Promise.all(processes.map(async (processInfo) => {
    if (!notebookRunnerProcessNeedsCwd(processInfo.command)) {
      return;
    }
    processInfo.cwd = await loadProcessCwd(processInfo.pid);
  }));
  return processes;
}

async function loadProcessCwd(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-ww', '-o', 'cwd=', '-p', String(pid)], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const cwd = stdout
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);
    return cwd && cwd !== '-' ? cwd : null;
  } catch {
    return null;
  }
}

function buildLivePidSet(processes: ManagedProcessInfo[]): Set<number> {
  return new Set(processes.map((processInfo) => processInfo.pid));
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchGatewayStateForProcess(args: {
  processInfo: ManagedProcessInfo;
  gatewayStates: readonly GatewayStateRecord[];
}): GatewayStateRecord | null {
  return matchGatewayStateForProcessFromOwnership({
    processPid: args.processInfo.pid,
    processCommand: args.processInfo.command,
    gatewayStates: args.gatewayStates,
  });
}

function extractTaskMountPath(command: string, taskMountRoot: string): string | null {
  const match = command.match(new RegExp(`${escapeForRegExp(path.resolve(taskMountRoot))}${escapeForRegExp(path.sep)}task_[^\s]+`));
  return match?.[0] ?? null;
}

function serializeGatewayState(state: GatewayStateRecord, ownerProcessPid: number, ownerScope: string): string {
  return JSON.stringify({
    libraryId: state.libraryId,
    pid: state.pid,
    port: state.port ?? undefined,
    loopbackUrl: state.loopbackUrl ?? undefined,
    metadataUrl: state.metadataUrl ?? undefined,
    storageBucketUrl: state.storageBucketUrl ?? undefined,
    logPath: state.logPath ?? undefined,
    lastStartedAt: state.lastStartedAt ?? undefined,
    ownerProcessPid,
    ownerScope,
    status: 'ready',
  }, null, 2);
}

async function canReachGateway(loopbackUrl: string | null | undefined): Promise<boolean> {
  if (!loopbackUrl?.trim()) {
    return false;
  }
  try {
    const response = await fetch(`${loopbackUrl}/`, { method: 'GET' });
    return response.status > 0;
  } catch {
    return false;
  }
}

async function terminatePid(pid: number, label: string): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnLine(`unable to signal ${label} pid=${pid}: ${message}`);
    return;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!pidExists(pid)) {
      return;
    }
    await sleep(250);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnLine(`unable to SIGKILL ${label} pid=${pid}: ${message}`);
    return;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!pidExists(pid)) {
      return;
    }
    await sleep(250);
  }

  warnLine(`${label} pid=${pid} still appears alive after SIGKILL`);
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function removeStateFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

function parseFindmntTarget(stdout: string): string | null {
  const target = stdout
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return target ?? null;
}

function normalizeComparablePath(pathValue: string): string {
  const resolved = path.resolve(pathValue);
  return resolved === path.sep ? resolved : resolved.replace(/[\\/]+$/, '');
}

export function classifyTaskMountpointStatus(args: {
  mountPath: string;
  detectedTarget: string | null;
}): TaskMountpointStatus {
  if (!args.detectedTarget?.trim()) {
    return 'not_mounted';
  }
  return normalizeComparablePath(args.mountPath) === normalizeComparablePath(args.detectedTarget)
    ? 'exact_mount'
    : 'covered_by_parent_mount';
}

async function detectTaskMountpointStatus(mountPath: string): Promise<TaskMountpointStatus> {
  try {
    const { stdout } = await execFileAsync('findmnt', ['-T', mountPath, '-n', '-o', 'TARGET'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return classifyTaskMountpointStatus({
      mountPath,
      detectedTarget: parseFindmntTarget(stdout),
    });
  } catch {
    return 'not_mounted';
  }
}

async function tryJuicefsUmount(mountPath: string): Promise<void> {
  for (const attempt of buildTaskMountUmountAttempts(mountPath)) {
    try {
      await execFileAsync(attempt.command, attempt.args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      return;
    } catch {
      // Fall through to the next attempt.
    }
  }

  warnLine(`juicefs umount did not report success for ${mountPath}`);
}

async function reclaimTaskMount(args: {
  mountPath: string;
  mountProcesses?: readonly ManagedProcessInfo[];
}): Promise<boolean> {
  const hadExactMount = await detectTaskMountpointStatus(args.mountPath) === 'exact_mount';

  await tryJuicefsUmount(args.mountPath);
  for (const processInfo of args.mountProcesses ?? []) {
    await terminatePid(processInfo.pid, `task-mount:${args.mountPath}`);
  }

  if (await detectTaskMountpointStatus(args.mountPath) === 'exact_mount') {
    await tryJuicefsUmount(args.mountPath);
  }

  const reclaimed = hadExactMount && await detectTaskMountpointStatus(args.mountPath) !== 'exact_mount';
  if (!reclaimed && hadExactMount) {
    warnLine(`task mount remained mounted after reclaim attempts for ${args.mountPath}`);
  }
  return reclaimed;
}

async function findMountedTaskDirectories(taskMountRoot: string): Promise<string[]> {
  if (!await pathExists(taskMountRoot)) {
    return [];
  }

  const entries = await readdir(taskMountRoot, { withFileTypes: true });
  const mounted: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('task_')) {
      continue;
    }

    const mountPath = path.join(taskMountRoot, entry.name);
    try {
      const mountStatus = await detectTaskMountpointStatus(mountPath);
      if (mountStatus === 'exact_mount') {
        mounted.push(mountPath);
      }
    } catch {
      // Not a mountpoint or findmnt unavailable. Ignore quietly.
    }
  }

  return mounted;
}

function parseArgs(argv: string[]): { apply: boolean; context: string } {
  let apply = false;
  let context = 'manual';

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--apply') {
      apply = true;
      continue;
    }
    if (token === '--context') {
      context = argv[index + 1] ?? context;
      index += 1;
    }
  }

  return { apply, context };
}

export function trackedOwnerPidFiles(rootDir: string): { apiPidFile: string; runnerPidFile: string } {
  return {
    apiPidFile: path.join(rootDir, 'artifacts/runtime/lines/local-manual/current/api.pid'),
    runnerPidFile: path.join(rootDir, 'artifacts/runtime/lines/local-manual/current/runner.pid'),
  };
}

async function runPreflight(options: PreflightOptions): Promise<void> {
  logLine(`starting context=${options.context} mode=${options.apply ? 'apply' : 'dry-run'}`);

  const processes = await loadProcessTable();
  const livePids = buildLivePidSet(processes);
  const taskMountOwners = await loadTaskMountRegistryOwners(options.taskMountRegistryPath);

  const { apiPidFile, runnerPidFile } = trackedOwnerPidFiles(options.rootDir);
  const trackedApiPid = await safeReadPidFile(apiPidFile);
  const trackedRunnerPid = await safeReadPidFile(runnerPidFile);
  const apiProcessRegex = new RegExp(`${escapeForRegExp(options.rootDir)}.*node_modules/.bin/tsx\\s+src/index.ts`);

  const anyRunnerAlive = hasAnyNotebookRunnerAlive({
    trackedRunnerPid,
    livePids,
    processes,
  });
  const adoptableApiPid = trackedApiPid && livePids.has(trackedApiPid)
    ? trackedApiPid
    : processes.find((processInfo) => apiProcessRegex.test(processInfo.command))?.pid ?? null;
  const ownerLedger = await loadGatewayOwnerLedgerSnapshot(options.gatewayArtifactsRoot);
  const ownerEvidence = buildGatewayOwnerEvidence({
    ledger: ownerLedger,
    now: new Date().toISOString(),
  });
  const activeLocalOwnerScopes = [...ownerEvidence.scopeStatusByScope.entries()]
    .filter(([, status]) => status === 'active')
    .map(([scope]) => scope);
  const adoptableOwnerScope = activeLocalOwnerScopes.length === 1
    ? activeLocalOwnerScopes[0]
    : null;

  const gatewayStates = await loadGatewayStates(options.gatewayStateDir);
  const gatewayProcesses = processes.filter((processInfo) => isGatewayCommand(processInfo.command));
  const processTableByPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  const managedGatewayProcesses = gatewayProcesses
    .map((processInfo) => ({
      processInfo,
      identity: extractGatewayProcessIdentity(processInfo.command),
      matchedState: matchGatewayStateForProcess({
        processInfo,
        gatewayStates,
      }),
    }))
    .filter((entry) => entry.identity.stableKeys.length > 0 || entry.matchedState !== null);

  let reclaimedGatewayStates = 0;
  let reclaimedGatewayProcesses = 0;
  let reclaimedMounts = 0;

  for (const state of gatewayStates) {
    const decision = classifyGatewayState({
      state,
      livePids,
      processTableByPid,
      ownerEvidence,
      currentOwnerScope: adoptableOwnerScope,
    });
    if (decision.action === 'keep') {
      continue;
    }

    logLine(`gateway-state library=${state.libraryId} action=${decision.action} reason=${decision.reason}`);
    if (!options.apply) {
      continue;
    }
    if (decision.action === 'adopt_state') {
      if (!adoptableApiPid || !adoptableOwnerScope || !state.pid || !await canReachGateway(state.loopbackUrl)) {
        if (state.pid) {
          await terminatePid(state.pid, `gateway:${state.libraryId}`);
          reclaimedGatewayProcesses += 1;
        }
        await removeStateFile(state.stateFilePath);
        reclaimedGatewayStates += 1;
        continue;
      }
      await writeFile(state.stateFilePath, serializeGatewayState(state, adoptableApiPid, adoptableOwnerScope), 'utf8');
      reclaimedGatewayStates += 1;
      continue;
    }
    if (decision.action === 'stop_gateway_and_remove_state' && state.pid) {
      await terminatePid(state.pid, `gateway:${state.libraryId}`);
      reclaimedGatewayProcesses += 1;
    }
    await removeStateFile(state.stateFilePath);
    reclaimedGatewayStates += 1;
  }

  for (const { processInfo, identity, matchedState } of managedGatewayProcesses) {
    if (matchedState) {
      continue;
    }
    const decision = classifyGatewayProcessWithoutState({
      processInfo,
      ownerEvidence,
      minAgeSeconds: options.noStateGatewayMinAgeSeconds,
      currentOwnerScope: adoptableOwnerScope,
    });
    if (decision.action === 'keep') {
      continue;
    }

    logLine(`gateway-process identity=${identity.label} pid=${processInfo.pid} action=${decision.action} reason=${decision.reason}`);
    if (!options.apply) {
      continue;
    }
    await terminatePid(processInfo.pid, `gateway:${identity.label}`);
    reclaimedGatewayProcesses += 1;
  }

  const taskMountProcesses = processes
    .filter((processInfo) => processInfo.command.includes('juicefs mount'))
    .map((processInfo) => ({
      processInfo,
      mountPath: extractTaskMountPath(processInfo.command, options.taskMountRoot),
    }))
    .filter((entry): entry is { processInfo: ManagedProcessInfo; mountPath: string } => Boolean(entry.mountPath));

  const seenMountPaths = new Set<string>();
  const taskMountGroups = new Map<string, ManagedProcessInfo[]>();
  for (const { processInfo, mountPath } of taskMountProcesses) {
    const existing = taskMountGroups.get(mountPath) ?? [];
    existing.push(processInfo);
    taskMountGroups.set(mountPath, existing);
  }

  for (const [mountPath, mountProcesses] of taskMountGroups.entries()) {
    seenMountPaths.add(mountPath);
    const decision = classifyTaskMountProcess({
      processInfo: mountProcesses[0],
      anyRunnerAlive,
      livePids,
      ownerProcessPid: taskMountOwners.get(mountPath) ?? null,
      processTableByPid,
    });
    if (decision.action === 'keep') {
      continue;
    }
    const pidSummary = mountProcesses.map((processInfo) => processInfo.pid).join(',');
    logLine(`task-mount mount_path=${mountPath} pids=${pidSummary} action=${decision.action} reason=${decision.reason}`);
    if (!options.apply) {
      continue;
    }
    if (await reclaimTaskMount({
      mountPath,
      mountProcesses,
    })) {
      reclaimedMounts += 1;
    }
  }

  const mountedTaskDirs = await findMountedTaskDirectories(options.taskMountRoot);
  for (const mountPath of mountedTaskDirs) {
    if (seenMountPaths.has(mountPath)) {
      continue;
    }
    const decision = classifyTaskMountProcess({
      anyRunnerAlive,
      livePids,
      ownerProcessPid: taskMountOwners.get(mountPath) ?? null,
      processTableByPid,
    });
    if (decision.action === 'keep') {
      continue;
    }
    logLine(`task-mount mount_path=${mountPath} action=${decision.action} reason=${decision.reason}`);
    if (!options.apply) {
      continue;
    }
    if (await reclaimTaskMount({ mountPath })) {
      reclaimedMounts += 1;
    }
  }

  logLine(
    `summary reclaimed_gateway_states=${reclaimedGatewayStates} reclaimed_gateway_processes=${reclaimedGatewayProcesses} reclaimed_mounts=${reclaimedMounts}`,
  );
}

function resolveTaskMountRegistryPath(env: NodeJS.ProcessEnv): string {
  const workspaceRoot = env.MBOS_AGENT_WORKSPACE_ROOT?.trim();
  if (workspaceRoot) {
    return path.join(workspaceRoot, 'task-workspace-mount-sessions.json');
  }
  return path.join(env.HOME || os.homedir() || '/tmp', '.mbos', 'task-workspace-mount-sessions.json');
}

export function resolvePreflightOptions(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): PreflightOptions {
  const { apply, context } = parseArgs(argv);
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const gatewayPaths = resolveFileLibraryGatewayPaths(env);
  return {
    apply,
    context,
    rootDir,
    gatewayArtifactsRoot: gatewayPaths.artifactsRoot,
    gatewayStateDir: gatewayPaths.gatewayStateDir,
    gatewayLogDir: gatewayPaths.gatewayLogDir,
    taskMountRoot: env.MBOS_AGENT_WORKSPACE_ROOT?.trim()
      || path.join(env.HOME || os.homedir() || '/tmp', 'ags-workspace'),
    taskMountRegistryPath: resolveTaskMountRegistryPath(env),
    noStateGatewayMinAgeSeconds: Number.parseInt(env.JUICEFS_ORPHAN_NO_STATE_GATEWAY_MIN_AGE_SECONDS ?? '', 10) || 600,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runPreflight(resolvePreflightOptions()).catch((error) => {
    process.stderr.write(
      `[juicefs-orphan-preflight] ERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
