import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FileLibraryResourceRecoveryApiProcess {
  pid: number;
  label: string;
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
  evidence_kind: 'afscp_files_api';
  api_processes: FileLibraryResourceRecoveryApiProcess[];
  tcp_connections: FileLibraryResourceRecoveryTcpConnection[];
}

interface FileLibraryResourceRecoveryProbeInput {
  step: string;
  notes?: string[];
}

export interface FileLibraryResourceRecoveryProbe extends FileLibraryResourceRecoveryProbeInput {
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

interface FileLibraryStartupSteadyStateContract {
  api_tcp_connections: readonly FileLibraryStartupSteadyStateApiTcpContract[];
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

interface CaptureResourceRecoverySnapshotOptions {
  apiPid?: number | null;
}

function sortUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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

function isProcTruthGone(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
  return code === 'ENOENT';
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

async function captureProcessFdTruth(args: {
  pid: number;
  processLabel: string;
}): Promise<{
  open_fd_count: number;
  socket_fd_count: number;
}> {
  const fdDir = `/proc/${args.pid}/fd`;
  let entries: string[];
  try {
    entries = await readdir(fdDir);
  } catch (error) {
    if (isProcTruthGone(error)) {
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

export async function captureResourceRecoverySnapshot(
  env: NodeJS.ProcessEnv = process.env,
  options: CaptureResourceRecoverySnapshotOptions = {},
): Promise<FileLibraryResourceRecoverySnapshot> {
  void env;
  const resolvedApiProcesses = options.apiPid
    ? await (async () => {
      const fdTruth = await captureProcessFdTruth({
        pid: options.apiPid,
        processLabel: 'api-entry',
      });
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

  return {
    captured_at: new Date().toISOString(),
    evidence_kind: 'afscp_files_api',
    api_processes: resolvedApiProcesses,
    tcp_connections: await captureTrackedTcpConnections(trackedProcessLabels),
  };
}

function difference(current: readonly string[], baseline: readonly string[]): string[] {
  const baselineSet = new Set(baseline);
  return current.filter((value) => !baselineSet.has(value));
}

function buildApiProcessMap(
  processes: readonly FileLibraryResourceRecoveryApiProcess[],
): Map<string, FileLibraryResourceRecoveryApiProcess> {
  return new Map(processes.map((processInfo) => [processInfo.label, processInfo]));
}

function buildTcpConnectionMap(
  connections: readonly FileLibraryResourceRecoveryTcpConnection[],
): Map<string, FileLibraryResourceRecoveryTcpConnection> {
  return new Map(connections.map((connection) => [
    `${connection.process_label}|${connection.remote_host}|${connection.remote_port}|${connection.state}`,
    connection,
  ]));
}

function stripStartupApiTruth(
  snapshot: FileLibraryResourceRecoverySnapshot,
): FileLibraryResourceRecoverySnapshot {
  return {
    ...snapshot,
    api_processes: [],
    tcp_connections: snapshot.tcp_connections.filter((connection) => connection.process_label !== 'api-entry'),
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

export function compareResourceRecoveryBaseline(args: {
  step: string;
  baseline: FileLibraryResourceRecoverySnapshot;
  current: FileLibraryResourceRecoverySnapshot;
  probe?: FileLibraryResourceRecoveryProbe | null;
}): FileLibraryResourceRecoveryStepReport {
  const findings: string[] = [];

  const baselineApiLabels = args.baseline.api_processes.map((processInfo) => processInfo.label);
  const currentApiLabels = args.current.api_processes.map((processInfo) => processInfo.label);
  const unexpectedApiLabels = difference(currentApiLabels, baselineApiLabels);
  if (unexpectedApiLabels.length > 0) {
    findings.push(
      `unexpected api process labels remained after ${args.step}: ${unexpectedApiLabels.join(', ')}`,
    );
  }
  const missingApiLabels = difference(baselineApiLabels, currentApiLabels);
  if (missingApiLabels.length > 0) {
    findings.push(
      `baseline api process labels disappeared after ${args.step}: ${missingApiLabels.join(', ')}`,
    );
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

  if ((args.probe?.cleanup_probe_errors?.length ?? 0) > 0) {
    findings.push(
      `resource cleanup probe could not prove cleanup after ${args.step}: ${args.probe!.cleanup_probe_errors!.join('; ')}`,
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
    baseline: stripStartupApiTruth(args.bootBaseline),
    current: stripStartupApiTruth(comparisonCurrent),
  });
  const findings = appendUniqueFindings(
    compared.findings,
    [
      ...buildStartupApiConnectionFindings({
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
    '# File Library AFSCP Files API Resource Recovery Report',
    '',
    `- generated_at: ${summary.generated_at}`,
    `- overall_status: ${summary.status}`,
    `- evidence_kind: ${observationReference?.evidence_kind ?? 'not_captured'}`,
    `- boot_baseline_captured_at: ${formatSnapshotCapturedAt(summary.boot_baseline)}`,
    `- ready_baseline_captured_at: ${formatSnapshotCapturedAt(summary.ready_baseline)}`,
    `- startup_candidate_captured_at: ${formatSnapshotCapturedAt(summary.startup_candidate)}`,
    `- failure_observation_captured_at: ${formatSnapshotCapturedAt(summary.failure_observation)}`,
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

async function hydrateProbe(
  probe: FileLibraryResourceRecoveryProbe | null,
): Promise<FileLibraryResourceRecoveryProbe | null> {
  return probe;
}

async function captureSnapshotForFallback(
  apiPid: number | null,
  baseline: FileLibraryResourceRecoverySnapshot,
  extraFindings: string[],
  step: string,
): Promise<FileLibraryResourceRecoverySnapshot> {
  try {
    return await captureResourceRecoverySnapshot(process.env, { apiPid });
  } catch (error) {
    extraFindings.push(
      `fallback snapshot capture failed for ${step}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return baseline;
  }
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
  const failureMessage = parseOption(argv, '--failure-message');
  const comparisonCurrentSource = comparisonCurrentSourceRaw
    ? (() => {
      if (
        comparisonCurrentSourceRaw === 'ready_baseline'
        || comparisonCurrentSourceRaw === 'startup_candidate'
        || comparisonCurrentSourceRaw === 'failure_observation'
      ) {
        return comparisonCurrentSourceRaw;
      }
      throw new Error('--comparison-current-source must be ready_baseline, startup_candidate, or failure_observation');
    })()
    : null;

  if (!bootBaselinePath || !outputPath) {
    throw new Error('startup-report requires --boot-baseline <path> --output <path>');
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
  const report = buildStartupResourceRecoveryReport({
    bootBaseline,
    readyBaseline,
    startupCandidate,
    failureObservation,
    comparisonCurrentSource,
    steadyState: {
      api_tcp_connections: steadyStateApiTcpAllowances,
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
  const extraFindings: string[] = [];
  const current = await captureSnapshotForFallback(apiPid, baseline, extraFindings, step);
  const report = buildResourceRecoveryFailureReport({
    step,
    baseline,
    current,
    reason,
    probe: await hydrateProbe(probeInput ? { ...probeInput } : null),
    smoke_status: smokeStatus,
    smoke_message: smokeMessage,
    extra_findings: extraFindings,
  });

  await writeJsonFile(outputPath, report);
}

async function runSummary(argv: string[]): Promise<void> {
  const bootBaselinePath = parseOption(argv, '--boot-baseline');
  const readyBaselinePath = parseOption(argv, '--ready-baseline') ?? parseOption(argv, '--baseline');
  const startupCandidatePath = parseOption(argv, '--startup-candidate');
  const failureObservationPath = parseOption(argv, '--failure-observation');
  const reportPaths = parseMultiOption(argv, '--report');
  const outputJsonPath = parseOption(argv, '--output-json');
  const outputMarkdownPath = parseOption(argv, '--output-markdown');
  const extraFindings = parseMultiOption(argv, '--extra-finding');

  if (!outputJsonPath || !outputMarkdownPath || reportPaths.length === 0) {
    throw new Error('summary requires --report <path> --output-json <path> --output-markdown <path>');
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
  const reports = await Promise.all(reportPaths.map(async (reportPath) => (
    readJsonFile<FileLibraryResourceRecoveryStepReport>(reportPath)
  )));
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

async function main(): Promise<void> {
  const [, , command, ...argv] = process.argv;
  switch (command) {
    case 'snapshot':
      await runSnapshot(argv);
      return;
    case 'verify':
      await runVerify(argv);
      return;
    case 'startup-report':
      await runStartupReport(argv);
      return;
    case 'fallback-report':
      await runFallbackReport(argv);
      return;
    case 'summary':
      await runSummary(argv);
      return;
    default:
      throw new Error(`unknown file-library-resource-recovery command: ${command ?? '<missing>'}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`[file-library-resource-recovery] ERROR: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
