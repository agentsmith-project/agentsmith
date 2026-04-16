import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
}

export interface FileLibraryResourceRecoverySnapshot {
  captured_at: string;
  gateway_state_dir: string;
  task_mount_root: string;
  gateway_state_files: string[];
  managed_gateway_labels: string[];
  managed_gateway_processes: FileLibraryResourceRecoveryManagedGatewayProcess[];
  mounted_task_mounts: string[];
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
  baseline: FileLibraryResourceRecoverySnapshot;
  steps: Array<{
    step: string;
    status: 'pass' | 'fail';
  }>;
  findings: string[];
  markdown: string;
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
}): FileLibraryResourceRecoveryManagedGatewayProcess | null {
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

export async function captureResourceRecoverySnapshot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<FileLibraryResourceRecoverySnapshot> {
  const options = resolvePreflightOptions([], env);
  const gatewayStates = await loadGatewayStates(options.gatewayStateDir);
  const processes = await loadProcessTable();
  const managedGatewayProcesses = processes
    .filter((processInfo) => isGatewayCommand(processInfo.command))
    .map((processInfo) => buildManagedGatewayProcess({
      gatewayStateDir: options.gatewayStateDir,
      state: matchGatewayStateForProcess({
        processInfo,
        gatewayStates,
      }),
      processInfo,
    }))
    .filter((entry): entry is FileLibraryResourceRecoveryManagedGatewayProcess => entry !== null)
    .sort((left, right) => {
      const byLabel = left.label.localeCompare(right.label);
      return byLabel !== 0 ? byLabel : left.pid - right.pid;
    });

  return {
    captured_at: new Date().toISOString(),
    gateway_state_dir: options.gatewayStateDir,
    task_mount_root: options.taskMountRoot,
    gateway_state_files: sortUnique(
      gatewayStates.map((state) => relativeStateFile(options.gatewayStateDir, state.stateFilePath)),
    ),
    managed_gateway_labels: sortUnique(
      managedGatewayProcesses.map((processInfo) => processInfo.label),
    ),
    managed_gateway_processes: managedGatewayProcesses,
    mounted_task_mounts: sortUnique(await findMountedTaskDirectories(options.taskMountRoot)),
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

function renderResourceRecoveryMarkdown(summary: Omit<FileLibraryResourceRecoverySummary, 'markdown'>): string {
  const lines = [
    '# File Library Resource Recovery Report',
    '',
    `- generated_at: ${summary.generated_at}`,
    `- overall_status: ${summary.status}`,
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
  baseline: FileLibraryResourceRecoverySnapshot;
  reports: readonly FileLibraryResourceRecoveryStepReport[];
}): FileLibraryResourceRecoverySummary {
  const findings = args.reports.flatMap((report) => report.findings);
  const baseSummary = {
    schema_version: 1 as const,
    generated_at: new Date().toISOString(),
    status: findings.length === 0 ? 'pass' as const : 'fail' as const,
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runSnapshot(argv: string[]): Promise<void> {
  const outputPath = parseOption(argv, '--output');
  if (!outputPath) {
    throw new Error('snapshot requires --output <path>');
  }
  await writeJsonFile(outputPath, await captureResourceRecoverySnapshot());
}

async function runVerify(argv: string[]): Promise<void> {
  const baselinePath = parseOption(argv, '--baseline');
  const outputPath = parseOption(argv, '--output');
  const step = parseOption(argv, '--step');
  const probePath = parseOption(argv, '--probe');
  const waitMs = Number.parseInt(parseOption(argv, '--wait-ms') ?? '', 10) || 15000;
  const intervalMs = Number.parseInt(parseOption(argv, '--interval-ms') ?? '', 10) || 500;

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
    const current = await captureResourceRecoverySnapshot();
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

  await writeJsonFile(outputPath, report);
  if (report.status !== 'pass') {
    throw new Error(report.findings.join('; '));
  }
}

async function runSummary(argv: string[]): Promise<void> {
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

  const baseline = await readJsonFile<FileLibraryResourceRecoverySnapshot>(baselinePath);
  const reports = await Promise.all(
    reportPaths
      .filter(Boolean)
      .map((reportPath) => readJsonFile<FileLibraryResourceRecoveryStepReport>(reportPath)),
  );
  const summary = buildResourceRecoverySummary({
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
    case 'verify':
      await runVerify(rest);
      return;
    case 'summary':
      await runSummary(rest);
      return;
    default:
      throw new Error('expected one of: snapshot, verify, summary');
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
