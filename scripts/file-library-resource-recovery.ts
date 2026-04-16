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

export interface FileLibraryResourceRecoveryStepReport {
  schema_version: 1;
  step: string;
  status: 'pass' | 'fail';
  baseline: FileLibraryResourceRecoverySnapshot;
  current: FileLibraryResourceRecoverySnapshot;
  findings: string[];
  probe: FileLibraryResourceRecoveryProbe | null;
  attempts?: number;
  wait_ms?: number;
  interval_ms?: number;
}

export interface FileLibraryResourceRecoverySummary {
  schema_version: 1;
  generated_at: string;
  status: 'pass' | 'fail';
  boot_baseline: FileLibraryResourceRecoverySnapshot | null;
  baseline: FileLibraryResourceRecoverySnapshot;
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

interface StartupApiRemotePortAllowance {
  remote_port: number;
  state: string;
  max_count: number;
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

async function captureProcessFdTruth(pid: number): Promise<{
  open_fd_count: number;
  socket_fd_count: number;
}> {
  const fdDir = `/proc/${pid}/fd`;
  let entries: string[];
  try {
    entries = await readdir(fdDir);
  } catch (error) {
    throw new Error(formatCommandRequirementError(fdDir, `inspect fd truth for pid ${pid}`, error));
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
      const fdTruth = await captureProcessFdTruth(processInfo.pid);
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
      const fdTruth = await captureProcessFdTruth(processInfo.pid);
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

  const apiProcesses = options.apiPid
    ? [{
      pid: options.apiPid,
      label: 'api-entry',
      ...(await captureProcessFdTruth(options.apiPid)),
    }]
    : [];
  const trackedProcessLabels = new Map<number, string>();
  for (const apiProcess of apiProcesses) {
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
    api_processes: apiProcesses,
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

function buildStartupApiRemotePortAllowances(
  remotePorts: readonly number[],
): StartupApiRemotePortAllowance[] {
  return [...new Set(remotePorts)]
    .sort((left, right) => left - right)
    .map((remotePort) => ({
      remote_port: remotePort,
      state: 'ESTABLISHED',
      max_count: 1,
    }));
}

function stripStartupApiTcpTruth(
  snapshot: FileLibraryResourceRecoverySnapshot,
): FileLibraryResourceRecoverySnapshot {
  return {
    ...snapshot,
    tcp_connections: snapshot.tcp_connections.filter((connection) => connection.process_label !== 'api-entry'),
  };
}

function buildStartupApiConnectionFindings(args: {
  readyBaseline: FileLibraryResourceRecoverySnapshot;
  allowedApiRemotePorts: readonly number[];
}): string[] {
  const findings: string[] = [];
  const allowances = buildStartupApiRemotePortAllowances(args.allowedApiRemotePorts);
  const allowanceMap = new Map(
    allowances.map((allowance) => [`${allowance.remote_port}|${allowance.state}`, allowance]),
  );
  const observedCounts = new Map<string, number>();

  for (const connection of args.readyBaseline.tcp_connections) {
    if (connection.process_label !== 'api-entry') {
      continue;
    }
    const key = `${connection.remote_port}|${connection.state}`;
    const allowance = allowanceMap.get(key);
    if (!allowance) {
      findings.push(
        `unexpected api startup tcp connections remained before smoke steps: ${connection.process_label} -> ${connection.remote_host}:${connection.remote_port} [${connection.state}] x${connection.count}`,
      );
      continue;
    }
    observedCounts.set(key, (observedCounts.get(key) ?? 0) + connection.count);
  }

  for (const allowance of allowances) {
    const key = `${allowance.remote_port}|${allowance.state}`;
    const observedCount = observedCounts.get(key) ?? 0;
    if (observedCount > allowance.max_count) {
      findings.push(
        `startup api tcp connection count exceeded the declared steady-state allowance before smoke steps for api-entry remote_port ${allowance.remote_port} [${allowance.state}]: expected <= ${allowance.max_count}, found ${observedCount}`,
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
  readyBaseline: FileLibraryResourceRecoverySnapshot;
  allowedApiRemotePorts?: readonly number[];
  extraFindings?: readonly string[];
}): FileLibraryResourceRecoveryStepReport {
  const step = 'file-library-api-startup';
  const compared = compareResourceRecoveryBaseline({
    step,
    baseline: stripStartupApiTcpTruth(args.bootBaseline),
    current: stripStartupApiTcpTruth(args.readyBaseline),
  });
  const findings = appendUniqueFindings(
    compared.findings,
    [
      ...buildStartupApiConnectionFindings({
        readyBaseline: args.readyBaseline,
        allowedApiRemotePorts: args.allowedApiRemotePorts ?? [],
      }),
      ...(args.extraFindings ?? []),
    ],
  );
  return {
    ...compared,
    baseline: args.bootBaseline,
    current: args.readyBaseline,
    status: findings.length === 0 ? 'pass' : 'fail',
    findings,
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

function renderResourceRecoveryMarkdown(summary: Omit<FileLibraryResourceRecoverySummary, 'markdown'>): string {
  const lines = [
    '# File Library Resource Recovery Report',
    '',
    `- generated_at: ${summary.generated_at}`,
    `- overall_status: ${summary.status}`,
    `- boot_baseline_captured_at: ${summary.boot_baseline?.captured_at ?? 'not_provided'}`,
    `- ready_baseline_captured_at: ${summary.baseline.captured_at}`,
    `- gateway_state_dir: ${summary.baseline.gateway_state_dir}`,
    `- task_mount_root: ${summary.baseline.task_mount_root}`,
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
  baseline: FileLibraryResourceRecoverySnapshot;
  reports: readonly FileLibraryResourceRecoveryStepReport[];
}): FileLibraryResourceRecoverySummary {
  const findings = args.reports.flatMap((report) => report.findings);
  const baseSummary = {
    schema_version: 1 as const,
    generated_at: new Date().toISOString(),
    status: findings.length === 0 ? 'pass' as const : 'fail' as const,
    boot_baseline: args.bootBaseline ?? null,
    baseline: args.baseline,
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
  const baselinePath = parseOption(argv, '--baseline');
  const outputPath = parseOption(argv, '--output');
  const allowedApiRemotePorts = parseMultiOption(argv, '--allow-api-remote-port')
    .map((rawPort) => Number.parseInt(rawPort, 10));
  const failureMessage = parseOption(argv, '--failure-message');

  if (!bootBaselinePath || !baselinePath || !outputPath) {
    throw new Error('startup-report requires --boot-baseline <path> --baseline <path> --output <path>');
  }
  if (allowedApiRemotePorts.some((port) => !Number.isInteger(port) || port <= 0)) {
    throw new Error('startup-report --allow-api-remote-port values must be positive integers');
  }

  const bootBaseline = await readJsonFile<FileLibraryResourceRecoverySnapshot>(bootBaselinePath);
  const readyBaseline = await readJsonFile<FileLibraryResourceRecoverySnapshot>(baselinePath);
  const report = buildStartupResourceRecoveryReport({
    bootBaseline,
    readyBaseline,
    allowedApiRemotePorts,
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
  const baselinePath = parseOption(argv, '--baseline');
  const outputJsonPath = parseOption(argv, '--output-json');
  const outputMarkdownPath = parseOption(argv, '--output-markdown');
  const reportPaths = parseMultiOption(argv, '--report');

  if (!baselinePath || !outputJsonPath || !outputMarkdownPath) {
    throw new Error('summary requires --baseline <path> --output-json <path> --output-markdown <path>');
  }
  if (reportPaths.length === 0) {
    throw new Error('summary requires at least one --report <path>');
  }

  const bootBaseline = bootBaselinePath
    ? await readJsonFile<FileLibraryResourceRecoverySnapshot>(bootBaselinePath)
    : null;
  const baseline = await readJsonFile<FileLibraryResourceRecoverySnapshot>(baselinePath);
  const reports = await Promise.all(
    reportPaths
      .filter(Boolean)
      .map((reportPath) => readJsonFile<FileLibraryResourceRecoveryStepReport>(reportPath)),
  );
  const summary = buildResourceRecoverySummary({
    bootBaseline,
    baseline,
    reports,
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
