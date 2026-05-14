import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  findCurrentResourceLockById,
  type CurrentResourceLockPort,
} from './current-resource-lock-manifest';
import { renderShortFailureProjection } from './status-projection';

export type ResourceOwnerPreflightTarget =
  | 'release-ready'
  | 'verify-real'
  | 'local-real-up'
  | 'local-real-status';

export type ResourceOwnerKind =
  | 'integration-deps'
  | 'local-real-app'
  | 'local-real-substrate'
  | 'unified-deploy-substrate'
  | 'kind-local-registry'
  | 'unknown';

export interface ResourceOwnerPreflightPort {
  port: number;
  label: string;
  family: string | null;
}

export interface ResourceOwnerPreflightCommand {
  executable: string;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ResourceOwnerPreflightCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type ResourceOwnerPreflightCommandRunner = (
  command: ResourceOwnerPreflightCommand,
) => ResourceOwnerPreflightCommandResult;

export type ResourceOwnerRecovery =
  | {
      kind: 'fix';
      command: string;
    }
  | {
      kind: 'inspect';
      command: string;
    };

export interface ResourceOwnerPreflightBlocker {
  port: number;
  label: string;
  owner_kind: ResourceOwnerKind;
  owner_label: string;
  detail: string;
  recovery: ResourceOwnerRecovery;
}

export interface ResourceOwnerPreflightEvidence {
  schema: 'agentsmith_resource_owner_preflight/v1';
  target: ResourceOwnerPreflightTarget;
  status: 'passed' | 'failed';
  generated_at: string;
  lock_id: 'fixed-local-ports';
  checked_ports: readonly number[];
  conflicts: readonly ResourceOwnerPreflightBlocker[];
  blocker: ResourceOwnerPreflightBlocker | null;
}

export type ResourceOwnerPreflightResult =
  | {
      ok: true;
      evidencePath: string | null;
      evidence: ResourceOwnerPreflightEvidence;
      conflicts: readonly ResourceOwnerPreflightBlocker[];
    }
  | {
      ok: false;
      evidencePath: string | null;
      evidence: ResourceOwnerPreflightEvidence;
      blocker: ResourceOwnerPreflightBlocker;
      conflicts: readonly ResourceOwnerPreflightBlocker[];
    };

export interface ResourceOwnerPreflightOptions {
  target: ResourceOwnerPreflightTarget;
  runner?: ResourceOwnerPreflightCommandRunner;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  evidencePath?: string | null;
  generatedAt?: string;
}

interface DockerPortOwner {
  port: number;
  containerName: string;
  composeProject: string;
  composeService: string;
  image: string;
  containerPort: string;
  labels: Record<string, string>;
}

interface ProcessPortOwner {
  port: number;
  pid: string;
  command: string;
  commandLine: string;
}

interface DockerOwnerClassificationContext {
  hasLocalRealSubstrateMarker: boolean;
  hasLocalRealSubstrateState: boolean;
}

const INTEGRATION_DEPS_COMPOSE_SERVICES = new Set(['postgres', 'mongo', 'redis', 'minio', 'keycloak']);
const INTEGRATION_DEPS_CONTAINER_NAMES = new Set(['mbos-postgres', 'mbos-mongo', 'mbos-redis', 'mbos-minio', 'mbos-keycloak']);

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown> | null, field: string): string {
  const value = record?.[field];
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function normalizeContainerName(value: string): string {
  return value.replace(/^\/+/, '');
}

function portRange(port: CurrentResourceLockPort): readonly ResourceOwnerPreflightPort[] {
  if (port.kind === 'port') {
    return [{
      port: port.value,
      label: port.label ?? `port ${port.value}`,
      family: null,
    }];
  }
  if (port.kind === 'range') {
    const values: ResourceOwnerPreflightPort[] = [];
    for (let value = port.start; value <= port.end; value += 1) {
      values.push({
        port: value,
        label: port.label ?? `port range ${port.start}-${port.end}`,
        family: null,
      });
    }
    return values;
  }
  return (port.values ?? []).map((value) => ({
    port: value,
    label: port.label ?? port.name,
    family: port.name,
  }));
}

export function collectFixedLocalPreflightPorts(): readonly ResourceOwnerPreflightPort[] {
  const lock = findCurrentResourceLockById('fixed-local-ports');
  const ports = lock?.appliesTo.ports ?? [];
  const collected = ports.flatMap((port) => [...portRange(port)]);
  return [...new Map(collected.map((port) => [port.port, port])).values()]
    .sort((left, right) => left.port - right.port);
}

function defaultRunner(command: ResourceOwnerPreflightCommand): ResourceOwnerPreflightCommandResult {
  const result = spawnSync(command.executable, [...command.args], {
    cwd: command.cwd,
    env: command.env,
    encoding: 'utf8',
  });
  return {
    exitCode: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function parseDockerInspect(stdout: string): readonly Record<string, unknown>[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

function dockerContainerLabels(record: Record<string, unknown>): Record<string, string> {
  const labels = asRecord(asRecord(record.Config)?.Labels);
  if (!labels) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(labels)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function dockerContainerPortOwners(record: Record<string, unknown>): readonly DockerPortOwner[] {
  const labels = dockerContainerLabels(record);
  const ports = asRecord(asRecord(record.NetworkSettings)?.Ports);
  if (!ports) {
    return [];
  }

  const owners: DockerPortOwner[] = [];
  for (const [containerPort, bindings] of Object.entries(ports)) {
    if (!Array.isArray(bindings)) {
      continue;
    }
    for (const binding of bindings) {
      if (!isRecord(binding)) {
        continue;
      }
      const hostPort = Number(stringField(binding, 'HostPort'));
      if (!Number.isInteger(hostPort) || hostPort <= 0) {
        continue;
      }
      owners.push({
        port: hostPort,
        containerName: normalizeContainerName(stringField(record, 'Name')),
        composeProject: labels['com.docker.compose.project'] ?? '',
        composeService: labels['com.docker.compose.service'] ?? '',
        image: stringField(asRecord(record.Config), 'Image'),
        containerPort,
        labels,
      });
    }
  }
  return owners;
}

function inspectDockerPortOwners(options: {
  runner: ResourceOwnerPreflightCommandRunner;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): readonly DockerPortOwner[] {
  const ps = options.runner({
    executable: 'docker',
    args: ['ps', '-q'],
    cwd: options.cwd,
    env: options.env,
  });
  if (ps.exitCode !== 0) {
    return [];
  }
  const ids = ps.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (ids.length === 0) {
    return [];
  }

  const inspect = options.runner({
    executable: 'docker',
    args: ['inspect', ...ids],
    cwd: options.cwd,
    env: options.env,
  });
  if (inspect.exitCode !== 0) {
    return [];
  }

  try {
    return parseDockerInspect(inspect.stdout).flatMap((record) => [...dockerContainerPortOwners(record)]);
  } catch {
    return [];
  }
}

function parseLsofOwners(port: number, stdout: string): readonly Pick<ProcessPortOwner, 'port' | 'pid' | 'command'>[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('COMMAND '))
    .map((line) => line.split(/\s+/u))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({
      port,
      command: parts[0] ?? 'unknown',
      pid: parts[1] ?? '',
    }))
    .filter((owner) => owner.pid.length > 0);
}

function inspectProcessPortOwners(options: {
  port: number;
  runner: ResourceOwnerPreflightCommandRunner;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): readonly ProcessPortOwner[] {
  const lsof = options.runner({
    executable: 'lsof',
    args: ['-nP', `-iTCP:${options.port}`, '-sTCP:LISTEN'],
    cwd: options.cwd,
    env: options.env,
  });
  if (lsof.exitCode !== 0 || !lsof.stdout.trim()) {
    return [];
  }

  return parseLsofOwners(options.port, lsof.stdout).map((owner) => {
    const ps = options.runner({
      executable: 'ps',
      args: ['-p', owner.pid, '-o', 'command='],
      cwd: options.cwd,
      env: options.env,
    });
    const commandLine = ps.exitCode === 0 && ps.stdout.trim()
      ? ps.stdout.trim().split(/\r?\n/u)[0] ?? owner.command
      : owner.command;
    return {
      ...owner,
      commandLine,
    };
  });
}

function isLocalRealSubstrateMarker(owner: DockerPortOwner): boolean {
  const runtimeLabel = owner.labels['com.agentsmith.runtime-label'] ?? '';
  const managedBy = owner.labels['com.agentsmith.managed-by'] ?? '';
  return (
    (managedBy === 'universal-proxy-runtime' && runtimeLabel === 'substrate-local-dev')
    || owner.containerName.startsWith('agentsmith-substrate-local-dev')
    || owner.composeProject === 'agentsmith-substrate-local-dev'
    || owner.composeService === 'universal-proxy'
  );
}

function hasLocalRealSubstrateState(cwd: string): boolean {
  const stateRoot = resolve(cwd, 'artifacts', 'runtime', 'substrate', 'local-dev');
  return [
    'status.json',
    'connection.env',
    'proxy.container-id',
    'proxy.container-id.meta',
    'proxy.ready',
  ].some((fileName) => existsSync(join(stateRoot, fileName)));
}

function buildDockerOwnerClassificationContext(
  owners: readonly DockerPortOwner[],
  cwd: string,
): DockerOwnerClassificationContext {
  return {
    hasLocalRealSubstrateMarker: owners.some((owner) => isLocalRealSubstrateMarker(owner)),
    hasLocalRealSubstrateState: hasLocalRealSubstrateState(cwd),
  };
}

function isSharedIntegrationComposeOwner(owner: DockerPortOwner): boolean {
  return (
    (owner.composeProject === 'mbos-integration-deps' && INTEGRATION_DEPS_COMPOSE_SERVICES.has(owner.composeService))
    || (INTEGRATION_DEPS_CONTAINER_NAMES.has(owner.containerName) && INTEGRATION_DEPS_COMPOSE_SERVICES.has(owner.composeService))
  );
}

function classifyDockerOwner(
  owner: DockerPortOwner,
  context: DockerOwnerClassificationContext,
): ResourceOwnerKind {
  const haystack = [
    owner.containerName,
    owner.composeProject,
    owner.composeService,
    owner.image,
  ].join(' ').toLowerCase();

  if (owner.composeProject === 'agentsmith-unified-substrate' || owner.containerName.startsWith('agentsmith-unified-substrate-')) {
    return 'unified-deploy-substrate';
  }
  if (
    haystack.includes('kind-registry')
    || owner.containerName === 'registry'
    || (owner.port === 5001 && haystack.includes('registry'))
  ) {
    return 'kind-local-registry';
  }
  if (
    haystack.includes('substrate-local-dev')
    || owner.containerName.startsWith('agentsmith-substrate-local-dev')
    || owner.composeService === 'universal-proxy'
  ) {
    return 'local-real-substrate';
  }
  if (isSharedIntegrationComposeOwner(owner)) {
    if (context.hasLocalRealSubstrateMarker) {
      return 'local-real-substrate';
    }
    if (context.hasLocalRealSubstrateState) {
      return 'unknown';
    }
    return 'integration-deps';
  }
  return 'unknown';
}

function classifyProcessOwner(owner: ProcessPortOwner): ResourceOwnerKind {
  const command = owner.commandLine.toLowerCase();
  if (
    command.includes('local-manual')
    || command.includes('api:node:dev')
    || command.includes('run-next-dev-safe')
    || command.includes('next dev')
    || command.includes('start-api')
    || command.includes('start-web')
  ) {
    return 'local-real-app';
  }
  return 'unknown';
}

function hasSensitiveProcessCommandValue(commandLine: string): boolean {
  return /\b(?:token|api[-_]?key|apikey|ticket|secret|password)\b|(?:TOKEN|API_KEY|TICKET|SECRET|PASSWORD)=/iu.test(commandLine);
}

function sanitizedProcessOwnerLabel(owner: ProcessPortOwner): string {
  const command = owner.command || 'process';
  if (hasSensitiveProcessCommandValue(owner.commandLine)) {
    return `${command} pid ${owner.pid} (command [redacted])`;
  }
  return `${command} pid ${owner.pid}`;
}

function recoveryForOwner(ownerKind: ResourceOwnerKind, port: number): ResourceOwnerRecovery {
  if (ownerKind === 'integration-deps') {
    return { kind: 'fix', command: 'npm run integration:deps:down' };
  }
  if (ownerKind === 'local-real-app') {
    return { kind: 'fix', command: 'make local-real-down' };
  }
  if (ownerKind === 'local-real-substrate') {
    return { kind: 'fix', command: 'make substrate-down' };
  }
  if (ownerKind === 'unified-deploy-substrate') {
    return { kind: 'fix', command: 'npx tsx scripts/unified-deploy/substrate-lifecycle.ts down' };
  }
  if (ownerKind === 'kind-local-registry') {
    return { kind: 'inspect', command: 'docker ps --filter name=kind-registry' };
  }
  return { kind: 'inspect', command: `lsof -nP -iTCP:${port} -sTCP:LISTEN` };
}

function dockerBlocker(
  owner: DockerPortOwner,
  port: ResourceOwnerPreflightPort,
  context: DockerOwnerClassificationContext,
): ResourceOwnerPreflightBlocker {
  const ownerKind = classifyDockerOwner(owner, context);
  const project = owner.composeProject || 'unknown-project';
  const service = owner.composeService || 'unknown-service';
  const label = owner.containerName || `${project}/${service}`;
  return {
    port: port.port,
    label: port.label,
    owner_kind: ownerKind,
    owner_label: label,
    detail: `${project}/${service} publishes host port ${port.port}`,
    recovery: recoveryForOwner(ownerKind, port.port),
  };
}

function processBlocker(owner: ProcessPortOwner, port: ResourceOwnerPreflightPort): ResourceOwnerPreflightBlocker {
  const ownerKind = classifyProcessOwner(owner);
  const label = sanitizedProcessOwnerLabel(owner);
  return {
    port: port.port,
    label: port.label,
    owner_kind: ownerKind,
    owner_label: label,
    detail: `${label} is listening on port ${port.port}`,
    recovery: recoveryForOwner(ownerKind, port.port),
  };
}

function writeEvidence(path: string | null | undefined, evidence: ResourceOwnerPreflightEvidence): string | null {
  if (!path) {
    return null;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  return path;
}

export function runResourceOwnerPreflight(options: ResourceOwnerPreflightOptions): ResourceOwnerPreflightResult {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const runner = options.runner ?? defaultRunner;
  const ports = collectFixedLocalPreflightPorts();
  const dockerOwners = inspectDockerPortOwners({ runner, cwd, env });
  const dockerContext = buildDockerOwnerClassificationContext(dockerOwners, cwd);
  const conflicts: ResourceOwnerPreflightBlocker[] = [];
  const dockerConflictPorts = new Set<number>();

  for (const port of ports) {
    const owner = dockerOwners.find((candidate) => candidate.port === port.port);
    if (owner) {
      conflicts.push(dockerBlocker(owner, port, dockerContext));
      dockerConflictPorts.add(port.port);
    }
  }

  for (const port of ports) {
    if (dockerConflictPorts.has(port.port)) {
      continue;
    }
    const processOwners = inspectProcessPortOwners({
      port: port.port,
      runner,
      cwd,
      env,
    });
    const owner = processOwners[0];
    if (owner) {
      conflicts.push(processBlocker(owner, port));
    }
  }

  const blocker = conflicts[0] ?? null;
  const evidence: ResourceOwnerPreflightEvidence = {
    schema: 'agentsmith_resource_owner_preflight/v1',
    target: options.target,
    status: blocker ? 'failed' : 'passed',
    generated_at: options.generatedAt ?? new Date().toISOString(),
    lock_id: 'fixed-local-ports',
    checked_ports: ports.map((port) => port.port),
    conflicts,
    blocker,
  };
  const evidencePath = writeEvidence(options.evidencePath ?? null, evidence);
  if (!blocker) {
    return {
      ok: true,
      evidencePath,
      evidence,
      conflicts,
    };
  }
  return {
    ok: false,
    evidencePath,
    evidence,
    blocker,
    conflicts,
  };
}

export function renderResourceOwnerPreflightSummary(
  result: ResourceOwnerPreflightResult,
  options: {
    title?: string;
    diagnosticOnly?: boolean;
    rerunCommand?: string | null;
  } = {},
): string {
  if (result.ok) {
    return '';
  }
  return renderShortFailureProjection({
    title: options.title,
    diagnosticOnly: options.diagnosticOnly,
    blocker: 'environment_conflict',
    stage: 'preflight',
    why: `port ${result.blocker.port} is owned by ${result.blocker.owner_label}`,
    fixCommand: result.blocker.recovery.kind === 'fix' ? result.blocker.recovery.command : null,
    inspectCommand: result.blocker.recovery.kind === 'inspect' ? result.blocker.recovery.command : null,
    rerunCommand: options.rerunCommand ?? null,
    evidencePath: result.evidencePath,
  });
}

function safeDefaultRunId(): string {
  return `release-ready-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/u, 'Z')}`;
}

export function defaultResourceOwnerPreflightEvidencePath(input: {
  target: ResourceOwnerPreflightTarget;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  reportRoot?: string | null;
}): string {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  if (input.target === 'release-ready') {
    const campaignRoot = env.RELEASE_CAMPAIGN_ROOT?.trim();
    if (campaignRoot) {
      return resolve(cwd, campaignRoot, 'preflight', 'evidence.json');
    }
    const runsRoot = env.RELEASE_RUNS_ROOT?.trim() || join('artifacts', 'release-runs');
    const rawRunId = env.RELEASE_CAMPAIGN_RUN_ID?.trim();
    const runId = rawRunId && /^[a-zA-Z0-9._-]+$/u.test(rawRunId) ? rawRunId : safeDefaultRunId();
    return resolve(cwd, runsRoot, runId, 'preflight', 'evidence.json');
  }
  if (input.target === 'verify-real') {
    return resolve(cwd, input.reportRoot ?? join('artifacts', 'verification', 'preflight'), 'preflight', 'evidence.json');
  }
  return resolve(cwd, 'artifacts', 'local-real', 'preflight', 'evidence.json');
}

function titleForTarget(target: ResourceOwnerPreflightTarget): string {
  if (target === 'release-ready') {
    return 'AgentSmith Release Readiness';
  }
  if (target === 'verify-real') {
    return 'AgentSmith Verification';
  }
  if (target === 'local-real-up') {
    return 'AgentSmith Local Real Preflight';
  }
  return 'AgentSmith Local Real Status';
}

function rerunForTarget(target: ResourceOwnerPreflightTarget): string | null {
  if (target === 'release-ready') {
    return 'npm run release:ready';
  }
  if (target === 'verify-real') {
    return 'npm run verify -- --goal=real --run';
  }
  return null;
}

function parseTarget(value: string | undefined): ResourceOwnerPreflightTarget {
  if (
    value === 'release-ready'
    || value === 'verify-real'
    || value === 'local-real-up'
    || value === 'local-real-status'
  ) {
    return value;
  }
  throw new Error('resource owner preflight requires --target=release-ready|verify-real|local-real-up|local-real-status');
}

function parseCliArgs(argv: readonly string[]): {
  target: ResourceOwnerPreflightTarget;
  evidencePath?: string;
} {
  let target: ResourceOwnerPreflightTarget | undefined;
  let evidencePath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--target' && next) {
      target = parseTarget(next);
      index += 1;
    } else if (arg.startsWith('--target=')) {
      target = parseTarget(arg.slice('--target='.length));
    } else if (arg === '--evidence-path' && next) {
      evidencePath = next;
      index += 1;
    } else if (arg.startsWith('--evidence-path=')) {
      evidencePath = arg.slice('--evidence-path='.length);
    } else {
      throw new Error('unknown resource owner preflight argument');
    }
  }
  return {
    target: parseTarget(target),
    evidencePath,
  };
}

export function runResourceOwnerPreflightCli(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const options = parseCliArgs(argv);
    const evidencePath = options.evidencePath ?? defaultResourceOwnerPreflightEvidencePath({ target: options.target });
    const result = runResourceOwnerPreflight({
      target: options.target,
      evidencePath,
    });
    if (!result.ok) {
      process.stdout.write(renderResourceOwnerPreflightSummary(result, {
        title: titleForTarget(options.target),
        diagnosticOnly: options.target === 'local-real-status',
        rerunCommand: rerunForTarget(options.target),
      }));
      return options.target === 'local-real-status' ? 0 : 1;
    }
    if (options.target === 'local-real-status') {
      process.stdout.write('Diagnostic only: not a release verdict.\nResource owner preflight: fixed-local-ports clear\n');
    } else {
      process.stdout.write('[resource-owner-preflight] fixed-local-ports clear\n');
    }
    return 0;
  } catch {
    process.stderr.write('[resource-owner-preflight] status unavailable; check arguments.\n');
    return 1;
  }
}

if (isCliEntrypoint('resource-owner-preflight.ts')) {
  process.exit(runResourceOwnerPreflightCli());
}
