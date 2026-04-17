import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { isGatewayCommand } from '../packages/api-entry-node/src/file-library-gateway-ownership.js';
import {
  extractGatewayProcessIdentity,
  findMountedTaskDirectories,
  loadGatewayStates,
  loadProcessTable,
  matchGatewayStateForProcess,
  resolvePreflightOptions,
  type GatewayStateRecord,
  type ManagedProcessInfo,
  type TaskMountpointStatus,
} from './juicefs-orphan-preflight';

const execFileAsync = promisify(execFile);

export interface FileLibraryResourceRecoveryManagedGatewayProcess {
  pid: number;
  label: string;
  library_id: string | null;
  owner_scope: string | null;
  state_file: string | null;
  open_fd_count: number;
  socket_fd_count: number;
}

export interface FileLibraryResourceRecoveryApiProcess {
  pid: number;
  label: string;
  open_fd_count: number;
  socket_fd_count: number;
}

export interface FileLibraryResourceRecoveryHelperProcess {
  pid: number;
  label: string;
  command: string;
  open_fd_count: number;
  socket_fd_count: number;
}

export interface FileLibraryResourceRecoveryTcpConnection {
  process_label: string;
  remote_host: string;
  remote_port: number;
  state: string;
  count: number;
}

export interface FileLibraryResourceRecoverySnapshot {
  captured_at: string;
  gateway_state_dir: string;
  task_mount_root: string;
  api_processes: FileLibraryResourceRecoveryApiProcess[];
  helper_labels: string[];
  helper_processes: FileLibraryResourceRecoveryHelperProcess[];
  gateway_state_files: string[];
  managed_gateway_labels: string[];
  managed_gateway_processes: FileLibraryResourceRecoveryManagedGatewayProcess[];
  mounted_task_mounts: string[];
  tcp_connections: FileLibraryResourceRecoveryTcpConnection[];
}

interface FileLibraryResourceRecoveryProbeInput {
  step: string;
  mount_point?: string;
  notes?: string[];
}

export interface FileLibraryResourceRecoveryProbe extends FileLibraryResourceRecoveryProbeInput {
  cleanup_mount_status?: TaskMountpointStatus;
  residual_mount_process_pids?: number[];
  cleanup_probe_errors?: string[];
}

export type FileLibraryResourceRecoveryStartupComparisonCurrentSource =
  | 'ready_baseline'
  | 'startup_candidate'
  | 'failure_observation';

export interface FileLibraryResourceRecoveryEvidenceChain {
  boot_baseline: FileLibraryResourceRecoverySnapshot | null;
  ready_baseline: FileLibraryResourceRecoverySnapshot | null;
  startup_candidate: FileLibraryResourceRecoverySnapshot | null;
  failure_observation: FileLibraryResourceRecoverySnapshot | null;
  comparison_current_source: FileLibraryResourceRecoveryStartupComparisonCurrentSource;
}

export interface FileLibraryResourceRecoveryStepReport {
  schema_version: 1;
  step: string;
  status: 'pass' | 'fail';
  baseline: FileLibraryResourceRecoverySnapshot;
  current: FileLibraryResourceRecoverySnapshot;
  findings: string[];
  probe: FileLibraryResourceRecoveryProbe | null;
  evidence_chain?: FileLibraryResourceRecoveryEvidenceChain | null;
  attempts?: number;
  wait_ms?: number;
  interval_ms?: number;
}

export interface FileLibraryResourceRecoverySummary {
  schema_version: 1;
  generated_at: string;
  status: 'pass' | 'fail';
  boot_baseline: FileLibraryResourceRecoverySnapshot | null;
  ready_baseline: FileLibraryResourceRecoverySnapshot | null;
  startup_candidate: FileLibraryResourceRecoverySnapshot | null;
  failure_observation: FileLibraryResourceRecoverySnapshot | null;
  steps: Array<{
    step: string;
    status: 'pass' | 'fail';
  }>;
  findings: string[];
  markdown: string;
}

interface FinalizeResourceRecoveryStepReportInput {
  report: FileLibraryResourceRecoveryStepReport;
  smoke_status?: number;
  smoke_message?: string | null;
  extra_findings?: readonly string[];
}

interface FileLibraryStartupSteadyStateApiTcpContract {
  process_label: 'api-entry';
  remote_port: number;
  state: string;
  min_count?: number;
  max_count: number;
}

interface FileLibraryStartupSteadyStateHelperLabelAllowance {
  label: string;
  max_count: number;
}

interface FileLibraryStartupSteadyStateContract {
  api_tcp_connections: readonly FileLibraryStartupSteadyStateApiTcpContract[];
  helper_labels?: readonly FileLibraryStartupSteadyStateHelperLabelAllowance[];
}

interface BuildResourceRecoveryFailureReportInput {
  step: string;
  baseline: FileLibraryResourceRecoverySnapshot;
  current: FileLibraryResourceRecoverySnapshot;
  reason: string;
  probe?: FileLibraryResourceRecoveryProbe | null;
  smoke_status?: number;
  smoke_message?: string | null;
  extra_findings?: readonly string[];
}

function sortUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function relativeStateFile(gatewayStateDir: string, stateFilePath: string): string {
  const relative = path.relative(gatewayStateDir, stateFilePath);
  return relative && !relative.startsWith('..') ? relative : path.basename(stateFilePath);
}

function buildManagedGatewayLabel(args: {
  state: GatewayStateRecord | null;
  processInfo: ManagedProcessInfo;
}): string | null {
  if (args.state?.libraryId) {
    return `state:${args.state.libraryId}`;
  }
  const identity = extractGatewayProcessIdentity(args.processInfo.command);
  if (identity.label) {
    return identity.label;
  }
  return null;
}

function buildManagedGatewayProcess(args: {
  gatewayStateDir: string;
  state: GatewayStateRecord | null;
  processInfo: ManagedProcessInfo;
}): Omit<FileLibraryResourceRecoveryManagedGatewayProcess, 'open_fd_count' | 'socket_fd_count'> | null {
  const label = buildManagedGatewayLabel(args);
  if (!label) {
    return null;
  }
  const identity = extractGatewayProcessIdentity(args.processInfo.command);
  return {
    pid: args.processInfo.pid,
    label,
    library_id: args.state?.libraryId ?? identity.libraryId ?? null,
    owner_scope: identity.ownerScope ?? args.state?.ownerScope ?? null,
    state_file: args.state ? relativeStateFile(args.gatewayStateDir, args.state.stateFilePath) : null,
  };
}

function classifyHelperProcessLabel(command: string): string | null {
  const normalized = command.trim();
  if (!normalized) {
    return null;
  }
  if (/(^|\s|\/)mc(\s|$)/.test(normalized)) {
    return 'helper:mc';
  }
  if (/(^|\s|\/)juicefs(\s+.*)?\sformat(\s|$)/.test(normalized)) {
    return 'helper:juicefs-format';
  }
  return null;
}

function buildHelperProcess(
  processInfo: ManagedProcessInfo,
): Omit<FileLibraryResourceRecoveryHelperProcess, 'open_fd_count' | 'socket_fd_count'> | null {
  const label = classifyHelperProcessLabel(processInfo.command);
  if (!label) {
    return null;
  }
  return {
    pid: processInfo.pid,
    label,
    command: processInfo.command,
  };
}

function normalizeTcpState(rawState: string): string {
  if (rawState === 'ESTAB') {
    return 'ESTABLISHED';
  }
  return rawState.replaceAll('-', '_');
}

function parseSocketEndpoint(endpoint: string): { host: string; port: number | null } {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    return { host: '', port: null };
  }
  if (trimmed.startsWith('[')) {
    const closingIndex = trimmed.lastIndexOf(']');
    const host = closingIndex >= 0 ? trimmed.slice(1, closingIndex) : trimmed;
    const portRaw = closingIndex >= 0 ? trimmed.slice(closingIndex + 2) : '';
    const port = Number.parseInt(portRaw, 10);
    return {
      host,
      port: Number.isInteger(port) && port > 0 ? port : null,
    };
  }
  const separatorIndex = trimmed.lastIndexOf(':');
  if (separatorIndex === -1) {
    return { host: trimmed, port: null };
  }
  const host = trimmed.slice(0, separatorIndex);
  const portRaw = trimmed.slice(separatorIndex + 1);
  const port = Number.parseInt(portRaw, 10);
  return {
    host,
    port: Number.isInteger(port) && port > 0 ? port : null,
  };
}

type ResourceRecoveryProcessTruthRequirement = 'authority_required' | 'best_effort';

function isProcTruthGone(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
  return code === 'ENOENT';
}

async function captureProcessFdTruth(args: {
  pid: number;
  processLabel: string;
  requirement: ResourceRecoveryProcessTruthRequirement;
}): Promise<{
  open_fd_count: number;
  socket_fd_count: number;
} | null> {
  const fdDir = `/proc/${args.pid}/fd`;
  let entries: string[];
  try {
    entries = await readdir(fdDir);
  } catch (error) {
    if (isProcTruthGone(error)) {
      if (args.requirement === 'best_effort') {
        return null;
      }
      throw new Error(
        `tracked ${args.processLabel} pid ${args.pid} disappeared before fd truth could be captured`,
      );
    }
    throw new Error(
      formatCommandRequirementError(fdDir, `inspect fd truth for ${args.processLabel} pid ${args.pid}`, error),
    );
  }

  const socketTargets = await Promise.all(entries.map(async (entry) => {
    try {
      return await readlink(path.join(fdDir, entry));
    } catch {
      return null;
    }
  }));

  return {
    open_fd_count: entries.length,
    socket_fd_count: socketTargets.filter((target) => typeof target === 'string' && target.startsWith('socket:[')).length,
  };
}

async function captureTrackedTcpConnections(
  trackedProcessLabels: ReadonlyMap<number, string>,
): Promise<FileLibraryResourceRecoveryTcpConnection[]> {
  if (trackedProcessLabels.size === 0) {
    return [];
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('ss', ['-H', '-tanp'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (error) {
    throw new Error(formatCommandRequirementError('ss', 'capture tcp connection truth', error));
  }

  const counts = new Map<string, FileLibraryResourceRecoveryTcpConnection>();
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = line.match(/^(\S+)\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const state = normalizeTcpState(match[1]);
    if (state === 'LISTEN') {
      continue;
    }
    const peer = parseSocketEndpoint(match[3]);
    if (!peer.host || peer.host === '*' || peer.port === null) {
      continue;
    }
    const pidMatches = [...match[4].matchAll(/pid=(\d+)/g)]
      .map((pidMatch) => Number.parseInt(pidMatch[1], 10))
      .filter((pid) => Number.isInteger(pid) && trackedProcessLabels.has(pid));
    const uniquePids = [...new Set(pidMatches)];
    for (const pid of uniquePids) {
      const processLabel = trackedProcessLabels.get(pid);
      if (!processLabel) {
        continue;
      }
      const key = `${processLabel}|${peer.host}|${peer.port}|${state}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      counts.set(key, {
        process_label: processLabel,
        remote_host: peer.host,
        remote_port: peer.port,
        state,
        count: 1,
      });
    }
  }

  return [...counts.values()].sort((left, right) => {
    const byLabel = left.process_label.localeCompare(right.process_label);
    if (byLabel !== 0) {
      return byLabel;
    }
    const byHost = left.remote_host.localeCompare(right.remote_host);
    if (byHost !== 0) {
      return byHost;
    }
    const byPort = left.remote_port - right.remote_port;
    if (byPort !== 0) {
      return byPort;
    }
    return left.state.localeCompare(right.state);
  });
}

interface CaptureResourceRecoverySnapshotOptions {
  apiPid?: number | null;
}

export async function captureResourceRecoverySnapshot(
  env: NodeJS.ProcessEnv = process.env,
  options: CaptureResourceRecoverySnapshotOptions = {},
): Promise<FileLibraryResourceRecoverySnapshot> {
  const preflightOptions = resolvePreflightOptions([], env);
  const gatewayStates = await loadGatewayStates(preflightOptions.gatewayStateDir);
  const processes = await loadProcessTable();
  const managedGatewayProcesses = (await Promise.all(processes
    .filter((processInfo) => isGatewayCommand(processInfo.command))
    .map(async (processInfo) => {
      const entry = buildManagedGatewayProcess({
        gatewayStateDir: preflightOptions.gatewayStateDir,
        state: matchGatewayStateForProcess({
          processInfo,
          gatewayStates,
        }),
        processInfo,
      });
      if (!entry) {
        return null;
      }
      const fdTruth = await captureProcessFdTruth({
        pid: processInfo.pid,
        processLabel: entry.label,
        requirement: entry.state_file ? 'authority_required' : 'best_effort',
      });
      if (!fdTruth) {
        return null;
      }
      return {
        ...entry,
        open_fd_count: fdTruth.open_fd_count,
        socket_fd_count: fdTruth.socket_fd_count,
      };
    })))
    .filter((entry): entry is FileLibraryResourceRecoveryManagedGatewayProcess => entry !== null)
    .sort((left, right) => {
      const byLabel = left.label.localeCompare(right.label);
      return byLabel !== 0 ? byLabel : left.pid - right.pid;
    });
  const helperProcesses = (await Promise.all(processes
    .filter((processInfo) => !isGatewayCommand(processInfo.command))
    .map(async (processInfo) => {
      const entry = buildHelperProcess(processInfo);
      if (!entry) {
        return null;
      }
      const fdTruth = await captureProcessFdTruth({
        pid: processInfo.pid,
        processLabel: entry.label,
        requirement: 'best_effort',
      });
      if (!fdTruth) {
        return null;
      }
      return {
        ...entry,
        open_fd_count: fdTruth.open_fd_count,
        socket_fd_count: fdTruth.socket_fd_count,
      };
    })))
    .filter((entry): entry is FileLibraryResourceRecoveryHelperProcess => entry !== null)
    .sort((left, right) => {
      const byLabel = left.label.localeCompare(right.label);
      return byLabel !== 0 ? byLabel : left.pid - right.pid;
    });

  const resolvedApiProcesses = options.apiPid
    ? await (async () => {
      const fdTruth = await captureProcessFdTruth({
        pid: options.apiPid,
        processLabel: 'api-entry',
        requirement: 'authority_required',
      });
      if (!fdTruth) {
        throw new Error(`tracked api-entry pid ${options.apiPid} disappeared before fd truth could be captured`);
      }
      return [{
        pid: options.apiPid,
        label: 'api-entry' as const,
        ...fdTruth,
      }];
    })()
    : [];
  const trackedProcessLabels = new Map<number, string>();
  for (const apiProcess of resolvedApiProcesses) {
    trackedProcessLabels.set(apiProcess.pid, apiProcess.label);
  }
  for (const processInfo of managedGatewayProcesses) {
    trackedProcessLabels.set(processInfo.pid, processInfo.label);
  }
  for (const processInfo of helperProcesses) {
    trackedProcessLabels.set(processInfo.pid, processInfo.label);
  }

  return {
    captured_at: new Date().toISOString(),
    gateway_state_dir: preflightOptions.gatewayStateDir,
    task_mount_root: preflightOptions.taskMountRoot,
    api_processes: resolvedApiProcesses,
    helper_labels: sortUnique(
      helperProcesses.map((processInfo) => processInfo.label),
    ),
    helper_processes: helperProcesses,
    gateway_state_files: sortUnique(
      gatewayStates.map((state) => relativeStateFile(preflightOptions.gatewayStateDir, state.stateFilePath)),
    ),
    managed_gateway_labels: sortUnique(
      managedGatewayProcesses.map((processInfo) => processInfo.label),
    ),
    managed_gateway_processes: managedGatewayProcesses,
    mounted_task_mounts: sortUnique(await findMountedTaskDirectories(preflightOptions.taskMountRoot)),
    tcp_connections: await captureTrackedTcpConnections(trackedProcessLabels),
  };
}

function difference(current: readonly string[], baseline: readonly string[]): string[] {
  const baselineSet = new Set(baseline);
  return current.filter((value) => !baselineSet.has(value));
}

function formatCommandRequirementError(command: string, purpose: string, error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
  if (code === 'ENOENT') {
    return `${command} is required to ${purpose} but was not found`;
  }
  if (error instanceof Error && error.message) {
    return `${command} failed while trying to ${purpose}: ${error.message}`;
  }
  return `${command} failed while trying to ${purpose}`;
}

function formatPidList(pids: readonly number[]): string {
  return `[${[...pids].sort((left, right) => left - right).join(', ')}]`;
}

function buildManagedGatewayProcessPidMap(
  processes: readonly FileLibraryResourceRecoveryManagedGatewayProcess[],
): Map<string, number[]> {
  const pidMap = new Map<string, number[]>();
  for (const processInfo of processes) {
    const existing = pidMap.get(processInfo.label);
    if (existing) {
      existing.push(processInfo.pid);
      continue;
    }
    pidMap.set(processInfo.label, [processInfo.pid]);
  }
  for (const [label, pids] of pidMap.entries()) {
    pidMap.set(label, [...pids].sort((left, right) => left - right));
  }
  return pidMap;
}

function buildApiProcessMap(
  processes: readonly FileLibraryResourceRecoveryApiProcess[],
): Map<string, FileLibraryResourceRecoveryApiProcess> {
  return new Map(processes.map((processInfo) => [processInfo.label, processInfo]));
}

function buildManagedGatewayProcessMap(
  processes: readonly FileLibraryResourceRecoveryManagedGatewayProcess[],
): Map<string, FileLibraryResourceRecoveryManagedGatewayProcess[]> {
  const entries = new Map<string, FileLibraryResourceRecoveryManagedGatewayProcess[]>();
  for (const processInfo of processes) {
    const existing = entries.get(processInfo.label) ?? [];
    existing.push(processInfo);
    entries.set(processInfo.label, existing);
  }
  for (const [label, processesForLabel] of entries.entries()) {
    entries.set(label, [...processesForLabel].sort((left, right) => left.pid - right.pid));
  }
  return entries;
}

function buildHelperProcessMap(
  processes: readonly FileLibraryResourceRecoveryHelperProcess[],
): Map<string, FileLibraryResourceRecoveryHelperProcess[]> {
  const entries = new Map<string, FileLibraryResourceRecoveryHelperProcess[]>();
  for (const processInfo of processes) {
    const existing = entries.get(processInfo.label) ?? [];
    existing.push(processInfo);
    entries.set(processInfo.label, existing);
  }
  for (const [label, processesForLabel] of entries.entries()) {
    entries.set(label, [...processesForLabel].sort((left, right) => left.pid - right.pid));
  }
  return entries;
}

function buildTcpConnectionMap(
  connections: readonly FileLibraryResourceRecoveryTcpConnection[],
): Map<string, FileLibraryResourceRecoveryTcpConnection> {
  return new Map(connections.map((connection) => [
    `${connection.process_label}|${connection.remote_host}|${connection.remote_port}|${connection.state}`,
    connection,
  ]));
}

function stripStartupApiTcpTruth(
  snapshot: FileLibraryResourceRecoverySnapshot,
): FileLibraryResourceRecoverySnapshot {
  return {
    ...snapshot,
    tcp_connections: snapshot.tcp_connections.filter((connection) => connection.process_label !== 'api-entry'),
  };
}

function stripStartupBootOrphanGatewayStateTruth(
  snapshot: FileLibraryResourceRecoverySnapshot,
): FileLibraryResourceRecoverySnapshot {
  const authoritativeManagedGatewayProcesses = snapshot.managed_gateway_processes
    .filter((processInfo) => typeof processInfo.state_file === 'string' && processInfo.state_file.length > 0);
  const authoritativeStateFiles = new Set(
    authoritativeManagedGatewayProcesses.map((processInfo) => processInfo.state_file as string),
  );
  const authoritativeLabels = new Set(
    authoritativeManagedGatewayProcesses.map((processInfo) => processInfo.label),
  );

  return {
    ...snapshot,
    gateway_state_files: snapshot.gateway_state_files.filter((stateFile) => authoritativeStateFiles.has(stateFile)),
    managed_gateway_labels: snapshot.managed_gateway_labels.filter((label) => authoritativeLabels.has(label)),
    managed_gateway_processes: authoritativeManagedGatewayProcesses,
  };
}

function buildStartupApiConnectionFindings(args: {
  observedStartupState: FileLibraryResourceRecoverySnapshot;
  steadyState?: FileLibraryStartupSteadyStateContract;
}): string[] {
  const findings: string[] = [];
  const contracts = (args.steadyState?.api_tcp_connections ?? []).map((contract) => ({
    ...contract,
    min_count: contract.min_count ?? 0,
  }));
  const allowanceMap = new Map(
    contracts.map((contract) => [
      `${contract.process_label}|${contract.remote_port}|${contract.state}`,
      contract,
    ]),
  );
  const observedCounts = new Map<string, number>();

  for (const connection of args.observedStartupState.tcp_connections) {
    if (connection.process_label !== 'api-entry') {
      continue;
    }
    const key = `${connection.process_label}|${connection.remote_port}|${connection.state}`;
    const contract = allowanceMap.get(key);
    if (!contract) {
      findings.push(
        `unexpected api startup tcp connections remained before smoke steps: ${connection.process_label} -> ${connection.remote_host}:${connection.remote_port} [${connection.state}] x${connection.count}`,
      );
      continue;
    }
    observedCounts.set(key, (observedCounts.get(key) ?? 0) + connection.count);
  }

  for (const contract of contracts) {
    const key = `${contract.process_label}|${contract.remote_port}|${contract.state}`;
    const observedCount = observedCounts.get(key) ?? 0;
    if (observedCount < contract.min_count) {
      findings.push(
        `startup api tcp connection count did not reach the declared steady-state floor before smoke steps for api-entry remote_port ${contract.remote_port} [${contract.state}]: expected >= ${contract.min_count}, found ${observedCount}`,
      );
    }
    if (observedCount > contract.max_count) {
      findings.push(
        `startup api tcp connection count exceeded the declared steady-state allowance before smoke steps for api-entry remote_port ${contract.remote_port} [${contract.state}]: expected <= ${contract.max_count}, found ${observedCount}`,
      );
    }
  }

  return findings;
}

function buildStartupHelperFindings(args: {
  observedStartupState: FileLibraryResourceRecoverySnapshot;
  steadyState?: FileLibraryStartupSteadyStateContract;
}): string[] {
  const findings: string[] = [];
  const helperContracts = args.steadyState?.helper_labels ?? [];
  if (helperContracts.length === 0) {
    return findings;
  }

  const observedCounts = new Map<string, number>();
  for (const helperProcess of args.observedStartupState.helper_processes) {
    observedCounts.set(helperProcess.label, (observedCounts.get(helperProcess.label) ?? 0) + 1);
  }

  for (const helperContract of helperContracts) {
    if (helperContract.max_count > 0) {
      findings.push(
        `startup helper steady-state allowance currently supports only max_count=0 because helper fd/socket/tcp truth is not yet contract-defined for ${helperContract.label}: received ${helperContract.max_count}`,
      );
      continue;
    }
    const observedCount = observedCounts.get(helperContract.label) ?? 0;
    if (observedCount > helperContract.max_count) {
      findings.push(
        `startup helper process count exceeded the declared steady-state allowance before smoke steps for ${helperContract.label}: expected <= ${helperContract.max_count}, found ${observedCount}`,
      );
    }
  }

  return findings;
}

async function detectMountCleanupStatus(
  mountPoint: string,
): Promise<{ status: TaskMountpointStatus | null; error: string | null }> {
  try {
    const { stdout } = await execFileAsync('findmnt', ['-T', mountPoint, '-n', '-o', 'TARGET'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const detectedTarget = stdout
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? null;
    if (!detectedTarget) {
      return {
        status: 'not_mounted',
        error: null,
      };
    }
    const normalizedMountPoint = path.resolve(mountPoint);
    const normalizedTarget = path.resolve(detectedTarget);
    return {
      status: normalizedMountPoint === normalizedTarget ? 'exact_mount' : 'covered_by_parent_mount',
      error: null,
    };
  } catch (error) {
    const exitCode = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (exitCode === 1) {
      return {
        status: 'not_mounted',
        error: null,
      };
    }
    return {
      status: null,
      error: formatCommandRequirementError('findmnt', 'verify mount cleanup', error),
    };
  }
}

async function detectResidualMountProcessPids(
  mountPoint: string,
): Promise<{ pids: number[]; error: string | null }> {
  try {
    const { stdout } = await execFileAsync('ps', ['-ww', '-eo', 'pid=,command='], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      pids: stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.*)$/);
        if (!match) {
          return null;
        }
        const pid = Number.parseInt(match[1], 10);
        const command = match[2];
        if (!Number.isInteger(pid) || pid <= 0 || !command.includes('juicefs mount') || !command.includes(mountPoint)) {
          return null;
        }
        return pid;
      })
      .filter((pid): pid is number => pid !== null),
      error: null,
    };
  } catch (error) {
    return {
      pids: [],
      error: formatCommandRequirementError('ps', 'verify mount cleanup', error),
    };
  }
}

async function hydrateProbe(
  probe: FileLibraryResourceRecoveryProbe | null,
): Promise<FileLibraryResourceRecoveryProbe | null> {
  if (!probe || !probe.mount_point) {
    return probe;
  }
  const cleanupProbeErrors: string[] = [];
  const mountStatus = await detectMountCleanupStatus(probe.mount_point);
  const residualProcesses = await detectResidualMountProcessPids(probe.mount_point);
  if (mountStatus.error) {
    cleanupProbeErrors.push(mountStatus.error);
  }
  if (residualProcesses.error) {
    cleanupProbeErrors.push(residualProcesses.error);
  }
  return {
    ...probe,
    cleanup_mount_status: mountStatus.status ?? undefined,
    residual_mount_process_pids: residualProcesses.pids,
    cleanup_probe_errors: sortUnique([...(probe.cleanup_probe_errors ?? []), ...cleanupProbeErrors]),
  };
}

export function compareResourceRecoveryBaseline(args: {
  step: string;
  baseline: FileLibraryResourceRecoverySnapshot;
  current: FileLibraryResourceRecoverySnapshot;
  probe?: FileLibraryResourceRecoveryProbe | null;
}): FileLibraryResourceRecoveryStepReport {
  const findings: string[] = [];

  const unexpectedGatewayStates = difference(args.current.gateway_state_files, args.baseline.gateway_state_files);
  if (unexpectedGatewayStates.length > 0) {
    findings.push(
      `unexpected gateway state files remained after ${args.step}: ${unexpectedGatewayStates.join(', ')}`,
    );
  }
  const missingGatewayStates = difference(args.baseline.gateway_state_files, args.current.gateway_state_files);
  if (missingGatewayStates.length > 0) {
    findings.push(
      `baseline gateway state files disappeared after ${args.step}: ${missingGatewayStates.join(', ')}`,
    );
  }

  const unexpectedManagedGatewayLabels = difference(
    args.current.managed_gateway_labels,
    args.baseline.managed_gateway_labels,
  );
  if (unexpectedManagedGatewayLabels.length > 0) {
    findings.push(
      `unexpected managed gateway labels remained after ${args.step}: ${unexpectedManagedGatewayLabels.join(', ')}`,
    );
  }
  const missingManagedGatewayLabels = difference(
    args.baseline.managed_gateway_labels,
    args.current.managed_gateway_labels,
  );
  if (missingManagedGatewayLabels.length > 0) {
    findings.push(
      `baseline managed gateway labels disappeared after ${args.step}: ${missingManagedGatewayLabels.join(', ')}`,
    );
  }

  const baselineProcessPidsByLabel = buildManagedGatewayProcessPidMap(args.baseline.managed_gateway_processes);
  const currentProcessPidsByLabel = buildManagedGatewayProcessPidMap(args.current.managed_gateway_processes);
  for (const label of sortUnique([...baselineProcessPidsByLabel.keys(), ...currentProcessPidsByLabel.keys()])) {
    const expectedPids = baselineProcessPidsByLabel.get(label) ?? [];
    const currentPids = currentProcessPidsByLabel.get(label) ?? [];
    if (expectedPids.length === currentPids.length && expectedPids.every((pid, index) => pid === currentPids[index])) {
      continue;
    }
    findings.push(
      `managed gateway processes did not return to the baseline after ${args.step} for ${label}: expected ${formatPidList(expectedPids)}, found ${formatPidList(currentPids)}`,
    );
  }

  const unexpectedHelperLabels = difference(
    args.current.helper_labels,
    args.baseline.helper_labels,
  );
  if (unexpectedHelperLabels.length > 0) {
    findings.push(
      `unexpected helper labels remained after ${args.step}: ${unexpectedHelperLabels.join(', ')}`,
    );
  }
  const missingHelperLabels = difference(
    args.baseline.helper_labels,
    args.current.helper_labels,
  );
  if (missingHelperLabels.length > 0) {
    findings.push(
      `baseline helper labels disappeared after ${args.step}: ${missingHelperLabels.join(', ')}`,
    );
  }

  const baselineHelperProcessesByLabel = buildHelperProcessMap(args.baseline.helper_processes);
  const currentHelperProcessesByLabel = buildHelperProcessMap(args.current.helper_processes);
  for (const label of sortUnique([...baselineHelperProcessesByLabel.keys(), ...currentHelperProcessesByLabel.keys()])) {
    const baselineProcesses = baselineHelperProcessesByLabel.get(label) ?? [];
    const currentProcesses = currentHelperProcessesByLabel.get(label) ?? [];
    const expectedPids = baselineProcesses.map((processInfo) => processInfo.pid);
    const currentPids = currentProcesses.map((processInfo) => processInfo.pid);
    if (
      expectedPids.length !== currentPids.length
      || !expectedPids.every((pid, index) => pid === currentPids[index])
    ) {
      findings.push(
        `helper processes did not return to the baseline after ${args.step} for ${label}: expected ${formatPidList(expectedPids)}, found ${formatPidList(currentPids)}`,
      );
      continue;
    }
    baselineProcesses.forEach((baselineProcess, index) => {
      const currentProcess = currentProcesses[index];
      if (!currentProcess) {
        return;
      }
      if (currentProcess.open_fd_count > baselineProcess.open_fd_count) {
        findings.push(
          `helper process fd count grew beyond the baseline after ${args.step} for ${label} (pid ${currentProcess.pid}): expected <= ${baselineProcess.open_fd_count}, found ${currentProcess.open_fd_count}`,
        );
      }
      if (currentProcess.socket_fd_count > baselineProcess.socket_fd_count) {
        findings.push(
          `helper process socket fd count grew beyond the baseline after ${args.step} for ${label} (pid ${currentProcess.pid}): expected <= ${baselineProcess.socket_fd_count}, found ${currentProcess.socket_fd_count}`,
        );
      }
    });
  }

  const baselineApiProcessesByLabel = buildApiProcessMap(args.baseline.api_processes);
  const currentApiProcessesByLabel = buildApiProcessMap(args.current.api_processes);
  for (const label of sortUnique([...baselineApiProcessesByLabel.keys(), ...currentApiProcessesByLabel.keys()])) {
    const baselineProcess = baselineApiProcessesByLabel.get(label) ?? null;
    const currentProcess = currentApiProcessesByLabel.get(label) ?? null;
    if (!baselineProcess || !currentProcess) {
      continue;
    }
    if (currentProcess.open_fd_count > baselineProcess.open_fd_count) {
      findings.push(
        `api process fd count grew beyond the baseline after ${args.step} for ${label} (pid ${currentProcess.pid}): expected <= ${baselineProcess.open_fd_count}, found ${currentProcess.open_fd_count}`,
      );
    }
    if (currentProcess.socket_fd_count > baselineProcess.socket_fd_count) {
      findings.push(
        `api process socket fd count grew beyond the baseline after ${args.step} for ${label} (pid ${currentProcess.pid}): expected <= ${baselineProcess.socket_fd_count}, found ${currentProcess.socket_fd_count}`,
      );
    }
  }

  const baselineManagedGatewayProcessesByLabel = buildManagedGatewayProcessMap(args.baseline.managed_gateway_processes);
  const currentManagedGatewayProcessesByLabel = buildManagedGatewayProcessMap(args.current.managed_gateway_processes);
  for (const label of sortUnique([...baselineManagedGatewayProcessesByLabel.keys(), ...currentManagedGatewayProcessesByLabel.keys()])) {
    const baselineProcesses = baselineManagedGatewayProcessesByLabel.get(label) ?? [];
    const currentProcesses = currentManagedGatewayProcessesByLabel.get(label) ?? [];
    if (
      baselineProcesses.length !== currentProcesses.length
      || !baselineProcesses.every((processInfo, index) => processInfo.pid === currentProcesses[index]?.pid)
    ) {
      continue;
    }
    baselineProcesses.forEach((baselineProcess, index) => {
      const currentProcess = currentProcesses[index];
      if (!currentProcess) {
        return;
      }
      if (currentProcess.open_fd_count > baselineProcess.open_fd_count) {
        findings.push(
          `managed gateway fd count grew beyond the baseline after ${args.step} for ${label} (pid ${currentProcess.pid}): expected <= ${baselineProcess.open_fd_count}, found ${currentProcess.open_fd_count}`,
        );
      }
      if (currentProcess.socket_fd_count > baselineProcess.socket_fd_count) {
        findings.push(
          `managed gateway socket fd count grew beyond the baseline after ${args.step} for ${label} (pid ${currentProcess.pid}): expected <= ${baselineProcess.socket_fd_count}, found ${currentProcess.socket_fd_count}`,
        );
      }
    });
  }

  const baselineTcpConnectionsByKey = buildTcpConnectionMap(args.baseline.tcp_connections);
  const currentTcpConnectionsByKey = buildTcpConnectionMap(args.current.tcp_connections);
  for (const [key, currentConnection] of currentTcpConnectionsByKey.entries()) {
    const baselineConnection = baselineTcpConnectionsByKey.get(key);
    if (!baselineConnection) {
      findings.push(
        `unexpected tcp connections remained after ${args.step}: ${currentConnection.process_label} -> ${currentConnection.remote_host}:${currentConnection.remote_port} [${currentConnection.state}] x${currentConnection.count}`,
      );
      continue;
    }
    if (currentConnection.count > baselineConnection.count) {
      findings.push(
        `tcp connection count grew beyond the baseline after ${args.step} for ${currentConnection.process_label} -> ${currentConnection.remote_host}:${currentConnection.remote_port} [${currentConnection.state}]: expected <= ${baselineConnection.count}, found ${currentConnection.count}`,
      );
    }
  }

  const unexpectedTaskMounts = difference(args.current.mounted_task_mounts, args.baseline.mounted_task_mounts);
  if (unexpectedTaskMounts.length > 0) {
    findings.push(
      `unexpected mounted task roots remained after ${args.step}: ${unexpectedTaskMounts.join(', ')}`,
    );
  }
  const missingTaskMounts = difference(args.baseline.mounted_task_mounts, args.current.mounted_task_mounts);
  if (missingTaskMounts.length > 0) {
    findings.push(
      `baseline mounted task roots disappeared after ${args.step}: ${missingTaskMounts.join(', ')}`,
    );
  }

  if (args.probe?.mount_point && args.probe.cleanup_mount_status === 'exact_mount') {
    findings.push(
      `mount cleanup probe still reports an exact mount for ${args.probe.mount_point} after ${args.step}`,
    );
  }

  if (args.probe?.mount_point && (args.probe.residual_mount_process_pids?.length ?? 0) > 0) {
    findings.push(
      `mount cleanup probe still reports juicefs mount processes for ${args.probe.mount_point} after ${args.step}: ${args.probe.residual_mount_process_pids!.join(', ')}`,
    );
  }
  if ((args.probe?.cleanup_probe_errors?.length ?? 0) > 0) {
    findings.push(
      `mount cleanup probe could not prove cleanup after ${args.step}: ${args.probe!.cleanup_probe_errors!.join('; ')}`,
    );
  }

  return {
    schema_version: 1,
    step: args.step,
    status: findings.length === 0 ? 'pass' : 'fail',
    baseline: args.baseline,
    current: args.current,
    findings,
    probe: args.probe ?? null,
  };
}

export function buildStartupResourceRecoveryReport(args: {
  bootBaseline: FileLibraryResourceRecoverySnapshot;
  readyBaseline?: FileLibraryResourceRecoverySnapshot | null;
  startupCandidate?: FileLibraryResourceRecoverySnapshot | null;
  failureObservation?: FileLibraryResourceRecoverySnapshot | null;
  comparisonCurrentSource?: FileLibraryResourceRecoveryStartupComparisonCurrentSource | null;
  steadyState?: FileLibraryStartupSteadyStateContract;
  extraFindings?: readonly string[];
}): FileLibraryResourceRecoveryStepReport {
  const step = 'file-library-api-startup';
  const comparisonCurrentSource = resolveStartupComparisonCurrentSource({
    readyBaseline: args.readyBaseline,
    startupCandidate: args.startupCandidate,
    failureObservation: args.failureObservation,
    comparisonCurrentSource: args.comparisonCurrentSource ?? null,
  });
  const comparisonCurrent = resolveStartupComparisonCurrentSnapshot({
    readyBaseline: args.readyBaseline,
    startupCandidate: args.startupCandidate,
    failureObservation: args.failureObservation,
    comparisonCurrentSource,
  });
  const compared = compareResourceRecoveryBaseline({
    step,
    baseline: stripStartupApiTcpTruth(stripStartupBootOrphanGatewayStateTruth(args.bootBaseline)),
    current: stripStartupApiTcpTruth(comparisonCurrent),
  });
  const findings = appendUniqueFindings(
    compared.findings,
    [
      ...buildStartupApiConnectionFindings({
        observedStartupState: comparisonCurrent,
        steadyState: args.steadyState,
      }),
      ...buildStartupHelperFindings({
        observedStartupState: comparisonCurrent,
        steadyState: args.steadyState,
      }),
      ...(args.extraFindings ?? []),
    ],
  );
  return {
    ...compared,
    baseline: args.bootBaseline,
    current: comparisonCurrent,
    status: findings.length === 0 ? 'pass' : 'fail',
    findings,
    evidence_chain: {
      boot_baseline: args.bootBaseline,
      ready_baseline: args.readyBaseline ?? null,
      startup_candidate: args.startupCandidate ?? null,
      failure_observation: args.failureObservation ?? null,
      comparison_current_source: comparisonCurrentSource,
    },
  };
}

function appendUniqueFindings(findings: readonly string[], extras: readonly string[]): string[] {
  const nextFindings = [...findings];
  for (const extra of extras) {
    const normalized = extra.trim();
    if (!normalized || nextFindings.includes(normalized)) {
      continue;
    }
    nextFindings.push(normalized);
  }
  return nextFindings;
}

function resolveStartupComparisonCurrentSource(args: {
  readyBaseline?: FileLibraryResourceRecoverySnapshot | null;
  startupCandidate?: FileLibraryResourceRecoverySnapshot | null;
  failureObservation?: FileLibraryResourceRecoverySnapshot | null;
  comparisonCurrentSource?: FileLibraryResourceRecoveryStartupComparisonCurrentSource | null;
}): FileLibraryResourceRecoveryStartupComparisonCurrentSource {
  if (args.comparisonCurrentSource) {
    return args.comparisonCurrentSource;
  }
  if (args.readyBaseline) {
    return 'ready_baseline';
  }
  if (args.startupCandidate) {
    return 'startup_candidate';
  }
  return 'failure_observation';
}

function resolveStartupComparisonCurrentSnapshot(args: {
  readyBaseline?: FileLibraryResourceRecoverySnapshot | null;
  startupCandidate?: FileLibraryResourceRecoverySnapshot | null;
  failureObservation?: FileLibraryResourceRecoverySnapshot | null;
  comparisonCurrentSource: FileLibraryResourceRecoveryStartupComparisonCurrentSource;
}): FileLibraryResourceRecoverySnapshot {
  switch (args.comparisonCurrentSource) {
    case 'ready_baseline':
      if (args.readyBaseline) {
        return args.readyBaseline;
      }
      break;
    case 'startup_candidate':
      if (args.startupCandidate) {
        return args.startupCandidate;
      }
      break;
    case 'failure_observation':
      if (args.failureObservation) {
        return args.failureObservation;
      }
      break;
  }
  throw new Error(
    `startup comparison current source ${args.comparisonCurrentSource} requires a matching snapshot`,
  );
}

export function finalizeResourceRecoveryStepReport(
  args: FinalizeResourceRecoveryStepReportInput,
): FileLibraryResourceRecoveryStepReport {
  const extraFindings = [...(args.extra_findings ?? [])];
  if ((args.smoke_status ?? 0) !== 0) {
    const smokeFinding = args.smoke_message
      ? `smoke step failed for ${args.report.step} with exit code ${args.smoke_status}: ${args.smoke_message}`
      : `smoke step failed for ${args.report.step} with exit code ${args.smoke_status}`;
    extraFindings.push(smokeFinding);
  }
  const findings = appendUniqueFindings(args.report.findings, extraFindings);
  return {
    ...args.report,
    status: findings.length === 0 ? 'pass' : 'fail',
    findings,
  };
}

export function buildResourceRecoveryFailureReport(
  args: BuildResourceRecoveryFailureReportInput,
): FileLibraryResourceRecoveryStepReport {
  const compared = compareResourceRecoveryBaseline({
    step: args.step,
    baseline: args.baseline,
    current: args.current,
    probe: args.probe ?? null,
  });
  return finalizeResourceRecoveryStepReport({
    report: compared,
    smoke_status: args.smoke_status,
    smoke_message: args.smoke_message,
    extra_findings: [args.reason, ...(args.extra_findings ?? [])],
  });
}

function formatSnapshotCapturedAt(snapshot: FileLibraryResourceRecoverySnapshot | null): string {
  return snapshot?.captured_at ?? 'not_captured';
}

function resolveSummaryObservationReference(summary: Omit<FileLibraryResourceRecoverySummary, 'markdown'>):
  FileLibraryResourceRecoverySnapshot | null {
  return summary.ready_baseline ?? summary.startup_candidate ?? summary.failure_observation;
}

function renderResourceRecoveryMarkdown(summary: Omit<FileLibraryResourceRecoverySummary, 'markdown'>): string {
  const observationReference = resolveSummaryObservationReference(summary);
  const lines = [
    '# File Library Resource Recovery Report',
    '',
    `- generated_at: ${summary.generated_at}`,
    `- overall_status: ${summary.status}`,
    `- boot_baseline_captured_at: ${formatSnapshotCapturedAt(summary.boot_baseline)}`,
    `- ready_baseline_captured_at: ${formatSnapshotCapturedAt(summary.ready_baseline)}`,
    `- startup_candidate_captured_at: ${formatSnapshotCapturedAt(summary.startup_candidate)}`,
    `- failure_observation_captured_at: ${formatSnapshotCapturedAt(summary.failure_observation)}`,
    `- gateway_state_dir: ${observationReference?.gateway_state_dir ?? 'not_captured'}`,
    `- task_mount_root: ${observationReference?.task_mount_root ?? 'not_captured'}`,
    '',
    '## Steps',
    '',
    ...summary.steps.map((step) => `- ${step.step}: ${step.status}`),
    '',
    '## Findings',
    '',
    ...(summary.findings.length > 0 ? summary.findings.map((finding) => `- ${finding}`) : ['- none']),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function buildResourceRecoverySummary(args: {
  bootBaseline?: FileLibraryResourceRecoverySnapshot | null;
  readyBaseline?: FileLibraryResourceRecoverySnapshot | null;
  startupCandidate?: FileLibraryResourceRecoverySnapshot | null;
  failureObservation?: FileLibraryResourceRecoverySnapshot | null;
  reports: readonly FileLibraryResourceRecoveryStepReport[];
  extraFindings?: readonly string[];
}): FileLibraryResourceRecoverySummary {
  if (!args.readyBaseline && !args.startupCandidate && !args.failureObservation) {
    throw new Error('resource recovery summary requires at least one of readyBaseline, startupCandidate, or failureObservation');
  }
  const findings = appendUniqueFindings(
    args.reports.flatMap((report) => report.findings),
    args.extraFindings ?? [],
  );
  const baseSummary = {
    schema_version: 1 as const,
    generated_at: new Date().toISOString(),
    status: findings.length === 0 ? 'pass' as const : 'fail' as const,
    boot_baseline: args.bootBaseline ?? null,
    ready_baseline: args.readyBaseline ?? null,
    startup_candidate: args.startupCandidate ?? null,
    failure_observation: args.failureObservation ?? null,
    steps: args.reports.map((report) => ({
      step: report.step,
      status: report.status,
    })),
    findings,
  };
  return {
    ...baseSummary,
    markdown: renderResourceRecoveryMarkdown(baseSummary),
  };
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

function parseOption(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return argv[index + 1] ?? null;
}

function parseMultiOption(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) {
      const value = argv[index + 1];
      if (value) {
        values.push(value);
      }
      index += 1;
    }
  }
  return values;
}

function parseOptionalPidOption(argv: string[], flag: string): number | null {
  const raw = parseOption(argv, flag);
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer pid`);
  }
  return parsed;
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function readOptionalJsonFile<T>(filePath: string | null): Promise<T | null> {
  if (!filePath) {
    return null;
  }
  try {
    return await readJsonFile<T>(filePath);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function readDeclaredJsonFile<T>(args: {
  command: 'startup-report' | 'summary';
  snapshotFamily: 'ready_baseline' | 'startup_candidate';
  filePath: string | null;
}): Promise<T | null> {
  if (!args.filePath) {
    return null;
  }
  try {
    return await readJsonFile<T>(args.filePath);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new Error(
        `${args.command} requires the declared ${args.snapshotFamily} snapshot at ${args.filePath} to exist once the path is provided`,
      );
    }
    throw error;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runSnapshot(argv: string[]): Promise<void> {
  const outputPath = parseOption(argv, '--output');
  const apiPid = parseOptionalPidOption(argv, '--api-pid');
  if (!outputPath) {
    throw new Error('snapshot requires --output <path>');
  }
  await writeJsonFile(outputPath, await captureResourceRecoverySnapshot(process.env, {
    apiPid,
  }));
}

async function runVerify(argv: string[]): Promise<void> {
  const baselinePath = parseOption(argv, '--baseline');
  const outputPath = parseOption(argv, '--output');
  const step = parseOption(argv, '--step');
  const probePath = parseOption(argv, '--probe');
  const smokeStatus = Number.parseInt(parseOption(argv, '--smoke-status') ?? '', 10) || 0;
  const smokeMessage = parseOption(argv, '--smoke-message');
  const waitMs = Number.parseInt(parseOption(argv, '--wait-ms') ?? '', 10) || 15000;
  const intervalMs = Number.parseInt(parseOption(argv, '--interval-ms') ?? '', 10) || 500;
  const apiPid = parseOptionalPidOption(argv, '--api-pid');

  if (!baselinePath || !outputPath || !step) {
    throw new Error('verify requires --baseline <path> --output <path> --step <name>');
  }

  const baseline = await readJsonFile<FileLibraryResourceRecoverySnapshot>(baselinePath);
  const probeInput = probePath ? await readJsonFile<FileLibraryResourceRecoveryProbeInput>(probePath) : null;
  const startedAt = Date.now();
  let attempts = 0;
  let report: FileLibraryResourceRecoveryStepReport | null = null;

  while (Date.now() - startedAt <= waitMs) {
    attempts += 1;
    const current = await captureResourceRecoverySnapshot(process.env, {
      apiPid,
    });
    const hydratedProbe = await hydrateProbe(probeInput ? { ...probeInput } : null);
    report = compareResourceRecoveryBaseline({
      step,
      baseline,
      current,
      probe: hydratedProbe,
    });
    report.attempts = attempts;
    report.wait_ms = waitMs;
    report.interval_ms = intervalMs;
    if (report.status === 'pass') {
      break;
    }
    await sleep(intervalMs);
  }

  if (!report) {
    throw new Error(`unable to verify resource recovery for ${step}`);
  }

  const finalizedReport = finalizeResourceRecoveryStepReport({
    report,
    smoke_status: smokeStatus,
    smoke_message: smokeMessage,
  });

  await writeJsonFile(outputPath, finalizedReport);
  if (finalizedReport.status !== 'pass') {
    throw new Error(finalizedReport.findings.join('; '));
  }
}

async function runStartupReport(argv: string[]): Promise<void> {
  const bootBaselinePath = parseOption(argv, '--boot-baseline');
  const readyBaselinePath = parseOption(argv, '--ready-baseline') ?? parseOption(argv, '--baseline');
  const startupCandidatePath = parseOption(argv, '--startup-candidate');
  const failureObservationPath = parseOption(argv, '--failure-observation');
  const outputPath = parseOption(argv, '--output');
  const comparisonCurrentSourceRaw = parseOption(argv, '--comparison-current-source');
  const steadyStateApiTcpAllowances = parseMultiOption(argv, '--steady-state-api-tcp')
    .map((rawAllowance) => {
      const [processLabel, rawPort, state, rawMinCount, rawMaxCount] = rawAllowance.split('|');
      const remotePort = Number.parseInt(rawPort ?? '', 10);
      const minCount = Number.parseInt(rawMinCount ?? '', 10);
      const maxCount = Number.parseInt(rawMaxCount ?? '', 10);
      if (
        processLabel !== 'api-entry'
        || !state
        || !Number.isInteger(remotePort)
        || remotePort <= 0
        || !Number.isInteger(minCount)
        || minCount < 0
        || !Number.isInteger(maxCount)
        || maxCount < 0
        || minCount > maxCount
      ) {
        throw new Error(
          'startup-report --steady-state-api-tcp values must use api-entry|<positive-port>|<state>|<non-negative-min-count>|<non-negative-max-count> with min <= max',
        );
      }
      return {
        process_label: 'api-entry' as const,
        remote_port: remotePort,
        state,
        min_count: minCount,
        max_count: maxCount,
      };
    });
  const steadyStateHelperLabels = parseMultiOption(argv, '--steady-state-helper-label')
    .map((rawAllowance) => {
      const [label, rawMaxCount] = rawAllowance.split('|');
      const maxCount = Number.parseInt(rawMaxCount ?? '', 10);
      if (!label || !Number.isInteger(maxCount) || maxCount < 0) {
        throw new Error(
          'startup-report --steady-state-helper-label values must use <label>|<non-negative-max-count>',
        );
      }
      return {
        label,
        max_count: maxCount,
      };
    });
  const failureMessage = parseOption(argv, '--failure-message');
  const comparisonCurrentSource = comparisonCurrentSourceRaw
    ? (() => {
      if (
        comparisonCurrentSourceRaw !== 'ready_baseline'
        && comparisonCurrentSourceRaw !== 'startup_candidate'
        && comparisonCurrentSourceRaw !== 'failure_observation'
      ) {
        throw new Error(
          'startup-report --comparison-current-source must be one of ready_baseline, startup_candidate, failure_observation',
        );
      }
      return comparisonCurrentSourceRaw;
    })()
    : null;

  if (!bootBaselinePath || !outputPath) {
    throw new Error(
      'startup-report requires --boot-baseline <path> --output <path> and at least one of --ready-baseline <path>, --startup-candidate <path>, --failure-observation <path>',
    );
  }

  const bootBaseline = await readJsonFile<FileLibraryResourceRecoverySnapshot>(bootBaselinePath);
  const readyBaseline = await readDeclaredJsonFile<FileLibraryResourceRecoverySnapshot>({
    command: 'startup-report',
    snapshotFamily: 'ready_baseline',
    filePath: readyBaselinePath,
  });
  const startupCandidate = await readDeclaredJsonFile<FileLibraryResourceRecoverySnapshot>({
    command: 'startup-report',
    snapshotFamily: 'startup_candidate',
    filePath: startupCandidatePath,
  });
  const failureObservation = await readOptionalJsonFile<FileLibraryResourceRecoverySnapshot>(failureObservationPath);
  if (!readyBaseline && !startupCandidate && !failureObservation) {
    throw new Error(
      'startup-report requires at least one of --ready-baseline <path>, --startup-candidate <path>, --failure-observation <path>',
    );
  }
  const report = buildStartupResourceRecoveryReport({
    bootBaseline,
    readyBaseline,
    startupCandidate,
    failureObservation,
    comparisonCurrentSource,
    steadyState: {
      api_tcp_connections: steadyStateApiTcpAllowances,
      helper_labels: steadyStateHelperLabels,
    },
    extraFindings: failureMessage ? [failureMessage] : [],
  });
  await writeJsonFile(outputPath, report);
  if (report.status !== 'pass') {
    throw new Error(report.findings.join('; '));
  }
}

async function runFallbackReport(argv: string[]): Promise<void> {
  const baselinePath = parseOption(argv, '--baseline');
  const outputPath = parseOption(argv, '--output');
  const step = parseOption(argv, '--step');
  const reason = parseOption(argv, '--reason');
  const probePath = parseOption(argv, '--probe');
  const smokeStatus = Number.parseInt(parseOption(argv, '--smoke-status') ?? '', 10) || 0;
  const smokeMessage = parseOption(argv, '--smoke-message');
  const apiPid = parseOptionalPidOption(argv, '--api-pid');

  if (!baselinePath || !outputPath || !step || !reason) {
    throw new Error('fallback-report requires --baseline <path> --output <path> --step <name> --reason <message>');
  }

  const baseline = await readJsonFile<FileLibraryResourceRecoverySnapshot>(baselinePath);
  const probeInput = probePath ? await readJsonFile<FileLibraryResourceRecoveryProbeInput>(probePath) : null;
  const current = await captureResourceRecoverySnapshot(process.env, {
    apiPid,
  });
  const hydratedProbe = await hydrateProbe(probeInput ? { ...probeInput } : null);
  const report = buildResourceRecoveryFailureReport({
    step,
    baseline,
    current,
    reason,
    probe: hydratedProbe,
    smoke_status: smokeStatus,
    smoke_message: smokeMessage,
  });
  await writeJsonFile(outputPath, report);
}

async function runSummary(argv: string[]): Promise<void> {
  const bootBaselinePath = parseOption(argv, '--boot-baseline');
  const readyBaselinePath = parseOption(argv, '--ready-baseline') ?? parseOption(argv, '--baseline');
  const startupCandidatePath = parseOption(argv, '--startup-candidate');
  const failureObservationPath = parseOption(argv, '--failure-observation');
  const outputJsonPath = parseOption(argv, '--output-json');
  const outputMarkdownPath = parseOption(argv, '--output-markdown');
  const reportPaths = parseMultiOption(argv, '--report');
  const extraFindings = parseMultiOption(argv, '--extra-finding');

  if (!outputJsonPath || !outputMarkdownPath) {
    throw new Error('summary requires --output-json <path> --output-markdown <path>');
  }
  if (reportPaths.length === 0) {
    throw new Error('summary requires at least one --report <path>');
  }

  const bootBaseline = bootBaselinePath
    ? await readJsonFile<FileLibraryResourceRecoverySnapshot>(bootBaselinePath)
    : null;
  const readyBaseline = await readDeclaredJsonFile<FileLibraryResourceRecoverySnapshot>({
    command: 'summary',
    snapshotFamily: 'ready_baseline',
    filePath: readyBaselinePath,
  });
  const startupCandidate = await readDeclaredJsonFile<FileLibraryResourceRecoverySnapshot>({
    command: 'summary',
    snapshotFamily: 'startup_candidate',
    filePath: startupCandidatePath,
  });
  const failureObservation = await readOptionalJsonFile<FileLibraryResourceRecoverySnapshot>(failureObservationPath);
  if (!readyBaseline && !startupCandidate && !failureObservation) {
    throw new Error(
      'summary requires at least one of --ready-baseline <path>, --startup-candidate <path>, --failure-observation <path>',
    );
  }
  const reports = await Promise.all(
    reportPaths
      .filter(Boolean)
      .map((reportPath) => readJsonFile<FileLibraryResourceRecoveryStepReport>(reportPath)),
  );
  const summary = buildResourceRecoverySummary({
    bootBaseline,
    readyBaseline,
    startupCandidate,
    failureObservation,
    reports,
    extraFindings,
  });
  await writeJsonFile(outputJsonPath, summary);
  await writeTextFile(outputMarkdownPath, summary.markdown);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'snapshot':
      await runSnapshot(rest);
      return;
    case 'startup-report':
      await runStartupReport(rest);
      return;
    case 'verify':
      await runVerify(rest);
      return;
    case 'fallback-report':
      await runFallbackReport(rest);
      return;
    case 'summary':
      await runSummary(rest);
      return;
    default:
      throw new Error('expected one of: snapshot, startup-report, verify, fallback-report, summary');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `[file-library-resource-recovery] ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
