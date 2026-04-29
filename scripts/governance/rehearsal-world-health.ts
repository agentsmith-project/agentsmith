import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  buildCurrentRehearsalWorldHealthSnapshot,
  type CurrentRehearsalWorldComponentHealth,
  type CurrentRehearsalWorldHealthComponentStatus,
  type CurrentRehearsalWorldHealthMode,
  type CurrentRehearsalWorldHealthPresence,
  type CurrentRehearsalWorldHealthResetLevel,
  type CurrentRehearsalWorldHealthRuntimeLine,
  type CurrentRehearsalWorldHealthServiceHealth,
  type CurrentRehearsalWorldHealthSnapshot,
  type CurrentRehearsalWorldHealthStatus,
  type CurrentRehearsalWorldIdentity,
} from './current-rehearsal-world-health-schema';
import { redactSensitiveText } from './redaction';

export interface BuildRehearsalWorldHealthSnapshotInput {
  runtimeLine: CurrentRehearsalWorldHealthRuntimeLine;
  rootDir?: string;
  scenarioRoot?: string;
  runtimeRoot?: string;
  generatedAt?: string;
  env?: Readonly<Record<string, unknown>>;
}

interface ParsedArgs {
  runtimeLine: CurrentRehearsalWorldHealthRuntimeLine;
  json: boolean;
  rootDir?: string;
  scenarioRoot?: string;
  runtimeRoot?: string;
}

interface DeployState {
  phase: string | null;
  releaseId: string | null;
}

interface Recommendation {
  healthStatus: CurrentRehearsalWorldHealthStatus;
  safeResetLevel: CurrentRehearsalWorldHealthResetLevel;
  safeNextCommand: string;
  safeResetReason: string;
}

const DEFAULT_MODE: CurrentRehearsalWorldHealthMode = 'release-fidelity';
const SNAPSHOT_SECRET_ASSIGNMENT_PATTERN = /[A-Za-z0-9_.-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|admin[_-]?token|oauth(?:[_-]?token)?|client[_-]?secret|password|ticket|managed[_-]?credentials?(?:\.[A-Za-z0-9_-]+)?|cookie|authorization)[A-Za-z0-9_.-]*\s*[:=]\s*[^/\\\s"',}]+/gi;

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function normalizeEnvValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function envValue(env: Readonly<Record<string, unknown>>, key: string): string | undefined {
  return normalizeEnvValue(env[key])?.trim() || undefined;
}

function isRuntimeLine(value: string | undefined): value is CurrentRehearsalWorldHealthRuntimeLine {
  return value === 'demo-rehearsal' || value === 'cluster-rehearsal';
}

function rehearsalMode(env: Readonly<Record<string, unknown>>): CurrentRehearsalWorldHealthMode {
  const value = envValue(env, 'REHEARSAL_MODE');
  if (value === 'fast' || value === 'release-fidelity' || value === 'offline-package') {
    return value;
  }
  return DEFAULT_MODE;
}

function defaultScenarioRoot(rootDir: string, runtimeLine: CurrentRehearsalWorldHealthRuntimeLine): string {
  return join(rootDir, 'artifacts', 'runtime', 'scenario', runtimeLine);
}

function defaultRuntimeRoot(rootDir: string): string {
  return join(rootDir, 'artifacts', 'runtime');
}

function envFilePath(rootDir: string, runtimeLine: CurrentRehearsalWorldHealthRuntimeLine): string {
  return join(rootDir, 'infra', 'flows', `${runtimeLine}.env`);
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  const withoutExport = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trim()
    : trimmed;
  const separatorIndex = withoutExport.indexOf('=');
  if (separatorIndex <= 0) {
    return null;
  }
  const key = withoutExport.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }
  return [key, unquoteEnvValue(withoutExport.slice(separatorIndex + 1).trim())];
}

function unquoteEnvValue(value: string): string {
  const quote = value[0];
  if (
    value.length >= 2
    && (quote === '"' || quote === "'")
    && value[value.length - 1] === quote
  ) {
    const inner = value.slice(1, -1);
    if (quote === '"') {
      return inner
        .replaceAll('\\n', '\n')
        .replaceAll('\\r', '\r')
        .replaceAll('\\t', '\t')
        .replaceAll('\\"', '"')
        .replaceAll('\\\\', '\\');
    }
    return inner;
  }
  return value;
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const parsed: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (entry) {
      parsed[entry[0]] = entry[1];
    }
  }
  return parsed;
}

function mergedEnv(input: {
  rootDir: string;
  scenarioRoot: string;
  runtimeLine: CurrentRehearsalWorldHealthRuntimeLine;
  env: Readonly<Record<string, unknown>>;
}): Record<string, string> {
  const merged: Record<string, string> = {
    ...readEnvFile(envFilePath(input.rootDir, input.runtimeLine)),
    ...readEnvFile(join(input.scenarioRoot, 'config', 'site.env')),
    ...readEnvFile(join(input.scenarioRoot, 'config', 'registry.env')),
  };
  for (const [key, value] of Object.entries(input.env)) {
    const normalized = normalizeEnvValue(value);
    if (normalized !== undefined && normalized.trim()) {
      merged[key] = normalized;
    }
  }
  return merged;
}

function firstEnv(env: Readonly<Record<string, unknown>>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = envValue(env, key);
    if (value) {
      return value;
    }
  }
  return null;
}

function safeText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const redacted = redactSensitiveText(value)
    .replace(SNAPSHOT_SECRET_ASSIGNMENT_PATTERN, '[redacted]')
    .replace(/\bBearer\s+\[redacted\]/gi, '[redacted]')
    .replace(/\bsk-\[redacted\]/gi, '[redacted]')
    .trim();
  return redacted.length > 0 ? redacted : null;
}

function safeRequiredText(value: string): string {
  return safeText(value) ?? '[redacted]';
}

function safePath(path: string): string {
  return safeRequiredText(path);
}

function normalizePublicUrl(value: string | null): string | null {
  const safeValue = safeText(value);
  if (!safeValue) {
    return null;
  }
  try {
    const rawHasQueryOrHash = safeValue.includes('?') || safeValue.includes('#');
    const url = new URL(safeValue);
    const pathname = url.pathname === '/' && !rawHasQueryOrHash ? '' : url.pathname;
    return `${url.origin}${pathname}`;
  } catch {
    return safeValue;
  }
}

function parsePort(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function portFromUrl(value: string | null): number | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.port) {
      return parsePort(url.port);
    }
    if (url.protocol === 'http:') {
      return 80;
    }
    if (url.protocol === 'https:') {
      return 443;
    }
  } catch {
    return null;
  }
  return null;
}

function statusEnvKey(service: 'web' | 'api' | 'keycloak' | 'sandbox'): string {
  return `AGENTSMITH_REHEARSAL_${service.toUpperCase()}_STATUS`;
}

function classifyServiceHealth(observed: string | null): CurrentRehearsalWorldHealthServiceHealth {
  const normalized = safeText(observed)?.toLowerCase() ?? null;
  if (!normalized) {
    return {
      status: 'unknown',
      observed: null,
    };
  }
  if (normalized === 'skipped') {
    return {
      status: 'skipped',
      observed: 'skipped',
    };
  }
  if (normalized === 'inactive') {
    return {
      status: 'inactive',
      observed: 'inactive',
    };
  }
  const httpCode = Number(normalized);
  if (Number.isInteger(httpCode) && httpCode >= 200 && httpCode < 400) {
    return {
      status: 'healthy',
      observed: normalized,
    };
  }
  if (Number.isInteger(httpCode) || normalized === '000') {
    return {
      status: 'unhealthy',
      observed: normalized,
    };
  }
  return {
    status: 'unknown',
    observed: normalized,
  };
}

function presenceFromEnv(value: string | null): CurrentRehearsalWorldHealthPresence {
  if (value === 'present' || value === 'true' || value === '1' || value === 'yes') {
    return 'present';
  }
  if (value === 'absent' || value === 'false' || value === '0' || value === 'no') {
    return 'absent';
  }
  return 'unknown';
}

function filePresence(path: string): CurrentRehearsalWorldHealthPresence {
  return existsSync(path) ? 'present' : 'absent';
}

function currentReleasePresence(path: string): CurrentRehearsalWorldHealthPresence {
  if (!existsSync(path)) {
    return 'absent';
  }
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() || stat.isSymbolicLink() ? 'present' : 'absent';
  } catch {
    return 'unknown';
  }
}

function stateFilePath(scenarioRoot: string): string {
  return join(scenarioRoot, 'state', 'deploy-state.json');
}

function readDeployState(path: string): DeployState {
  if (!existsSync(path)) {
    return {
      phase: null,
      releaseId: null,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return {
      phase: null,
      releaseId: null,
    };
  }
  if (!isRecord(parsed) || !isRecord(parsed.release)) {
    return {
      phase: null,
      releaseId: null,
    };
  }
  return {
    phase: safeText(typeof parsed.release.phase === 'string' ? parsed.release.phase : null),
    releaseId: safeText(typeof parsed.release.id === 'string' ? parsed.release.id : null),
  };
}

function activeScenario(runtimeRoot: string): string | null {
  const path = join(runtimeRoot, 'active-scenario.lock');
  if (!existsSync(path)) {
    return null;
  }
  return safeText(readFileSync(path, 'utf8').trim());
}

function npmRehearseCommand(runtimeLine: CurrentRehearsalWorldHealthRuntimeLine): string {
  return runtimeLine === 'demo-rehearsal'
    ? 'npm run rehearse:demo'
    : 'npm run rehearse:cluster';
}

function resetAndRehearseCommand(runtimeLine: CurrentRehearsalWorldHealthRuntimeLine): string {
  return runtimeLine === 'demo-rehearsal'
    ? 'make demo-rehearsal-reset && npm run rehearse:demo'
    : 'make cluster-rehearsal-reset && npm run rehearse:cluster';
}

function statusCommand(runtimeLine: CurrentRehearsalWorldHealthRuntimeLine): string {
  return runtimeLine === 'demo-rehearsal'
    ? 'make demo-rehearsal-status'
    : 'make cluster-rehearsal-status';
}

function serviceIssue(
  service: string,
  health: CurrentRehearsalWorldHealthServiceHealth,
): string | null {
  if (health.status === 'unhealthy') {
    return `${service} service health is unhealthy (${health.observed ?? 'unknown'})`;
  }
  if (health.status === 'inactive') {
    return `${service} service health is inactive`;
  }
  if (health.status === 'missing') {
    return `${service} service health is missing`;
  }
  return null;
}

function hasUnknownServiceHealth(componentHealth: CurrentRehearsalWorldComponentHealth): boolean {
  return [
    componentHealth.web,
    componentHealth.api,
    componentHealth.keycloak,
    componentHealth.sandbox,
  ].some((health) => health.status === 'unknown');
}

function buildRecommendation(input: {
  runtimeLine: CurrentRehearsalWorldHealthRuntimeLine;
  componentHealth: CurrentRehearsalWorldComponentHealth;
  worldIdentity: CurrentRehearsalWorldIdentity;
}): Recommendation {
  const issues = [
    input.componentHealth.world_root === 'absent' ? 'world root is absent' : null,
    input.componentHealth.state_file === 'absent' ? 'state file is absent' : null,
    input.worldIdentity.kind_cluster.present === 'absent' ? 'kind cluster is absent' : null,
    input.worldIdentity.registry.present === 'absent' ? 'local registry is absent' : null,
    input.worldIdentity.active_scenario && input.worldIdentity.active_scenario !== input.runtimeLine
      ? `active scenario is ${input.worldIdentity.active_scenario}`
      : null,
    serviceIssue('web', input.componentHealth.web),
    serviceIssue('api', input.componentHealth.api),
    serviceIssue('keycloak', input.componentHealth.keycloak),
    input.componentHealth.sandbox.status === 'skipped' ? null : serviceIssue('sandbox', input.componentHealth.sandbox),
  ].filter((issue): issue is string => Boolean(issue));

  if (input.componentHealth.world_root === 'absent' || input.componentHealth.state_file === 'absent') {
    return {
      healthStatus: 'missing',
      safeResetLevel: 'none',
      safeNextCommand: npmRehearseCommand(input.runtimeLine),
      safeResetReason: issues.length > 0
        ? `${issues.join('; ')}; no existing world was healthy enough to reset.`
        : 'no existing world health was observed.',
    };
  }

  if (issues.length > 0) {
    return {
      healthStatus: 'degraded',
      safeResetLevel: 'world',
      safeNextCommand: resetAndRehearseCommand(input.runtimeLine),
      safeResetReason: `${issues.join('; ')}; reset the rehearsal world before rerun.`,
    };
  }

  if (hasUnknownServiceHealth(input.componentHealth)) {
    return {
      healthStatus: 'unknown',
      safeResetLevel: 'soft',
      safeNextCommand: statusCommand(input.runtimeLine),
      safeResetReason: 'service health is unknown; run the scenario status entrypoint for a probed snapshot.',
    };
  }

  return {
    healthStatus: 'healthy',
    safeResetLevel: 'none',
    safeNextCommand: npmRehearseCommand(input.runtimeLine),
    safeResetReason: 'world health is healthy; rerun keeps release-fidelity and offline-package evidence semantics intact.',
  };
}

function buildWorldId(input: {
  runtimeLine: CurrentRehearsalWorldHealthRuntimeLine;
  clusterName: string;
  registryName: string;
  ports: CurrentRehearsalWorldIdentity['ports'];
}): string {
  return [
    input.runtimeLine,
    input.clusterName,
    input.registryName,
    input.ports.web ?? 'web',
    input.ports.api ?? 'api',
  ].join(':').toLowerCase().replace(/[^a-z0-9:._/-]+/g, '-');
}

export function buildRehearsalWorldHealthSnapshot(
  input: BuildRehearsalWorldHealthSnapshotInput,
): CurrentRehearsalWorldHealthSnapshot {
  const rootDir = resolve(input.rootDir ?? process.cwd());
  const scenarioRoot = resolve(input.scenarioRoot ?? defaultScenarioRoot(rootDir, input.runtimeLine));
  const runtimeRoot = resolve(input.runtimeRoot ?? defaultRuntimeRoot(rootDir));
  const env = mergedEnv({
    rootDir,
    scenarioRoot,
    runtimeLine: input.runtimeLine,
    env: input.env ?? process.env,
  });

  const statePath = stateFilePath(scenarioRoot);
  const deployState = readDeployState(statePath);
  const currentReleasePath = join(scenarioRoot, 'current');
  const siteEnvPath = join(scenarioRoot, 'config', 'site.env');
  const registryEnvPath = join(scenarioRoot, 'config', 'registry.env');
  const kindClusterName = safeRequiredText(
    firstEnv(env, ['LOCAL_KIND_CLUSTER_NAME', 'KIND_CLUSTER_NAME'])
      ?? (input.runtimeLine === 'demo-rehearsal' ? 'agentsmith-demo' : 'agentsmith-cluster'),
  );
  const registryName = safeRequiredText(
    firstEnv(env, ['LOCAL_KIND_REGISTRY_NAME'])
      ?? (input.runtimeLine === 'demo-rehearsal' ? 'agentsmith-demo-registry' : 'agentsmith-cluster-registry'),
  );
  const registryHost = safeRequiredText(firstEnv(env, ['LOCAL_KIND_REGISTRY_HOST', 'REGISTRY_HOST']) ?? '127.0.0.1');
  const registryPort = parsePort(firstEnv(env, ['LOCAL_KIND_REGISTRY_HOST_PORT']));
  const webBase = normalizePublicUrl(firstEnv(env, ['PUBLIC_WEB_BASE_URL', 'FLOW_SITE_ENV_PUBLIC_WEB_BASE_URL']));
  const apiBase = normalizePublicUrl(firstEnv(env, ['PUBLIC_API_BASE_URL', 'FLOW_SITE_ENV_PUBLIC_API_BASE_URL']));
  const keycloakBase = normalizePublicUrl(firstEnv(env, [
    'PUBLIC_KEYCLOAK_BASE_URL',
    'FLOW_SITE_ENV_PUBLIC_KEYCLOAK_BASE_URL',
  ]));
  const sandboxPort = parsePort(firstEnv(env, ['SANDBOX_HOST_PORT', 'FLOW_SITE_ENV_SANDBOX_HOST_PORT']))
    ?? (input.runtimeLine === 'demo-rehearsal'
      ? parsePort(firstEnv(env, ['DEMO_REHEARSAL_SANDBOX_HOST_PORT']))
      : parsePort(firstEnv(env, ['CLUSTER_REHEARSAL_SANDBOX_HOST_PORT'])));
  const sandboxBase = sandboxPort ? `http://127.0.0.1:${sandboxPort}` : null;
  const ports = {
    web: parsePort(firstEnv(env, ['WEB_PORT', 'FLOW_SITE_ENV_WEB_PORT'])) ?? portFromUrl(webBase),
    api: parsePort(firstEnv(env, ['API_PORT', 'FLOW_SITE_ENV_API_PORT'])) ?? portFromUrl(apiBase),
    keycloak: parsePort(firstEnv(env, ['KEYCLOAK_PORT', 'FLOW_SITE_ENV_KEYCLOAK_PORT'])) ?? portFromUrl(keycloakBase),
    sandbox: sandboxPort,
    registry: registryPort,
  };

  const worldIdentity: CurrentRehearsalWorldIdentity = {
    runtime_line: input.runtimeLine,
    world_root: safePath(scenarioRoot),
    world_id: buildWorldId({
      runtimeLine: input.runtimeLine,
      clusterName: kindClusterName,
      registryName,
      ports,
    }),
    active_scenario: activeScenario(runtimeRoot),
    phase: deployState.phase,
    release_id: deployState.releaseId,
    public_bases: {
      web: webBase,
      api: apiBase,
      keycloak: keycloakBase,
      sandbox: sandboxBase,
    },
    ports,
    kind_cluster: {
      name: kindClusterName,
      present: presenceFromEnv(envValue(env, 'AGENTSMITH_REHEARSAL_KIND_CLUSTER_PRESENT') ?? null),
    },
    registry: {
      name: registryName,
      host: registryHost,
      host_port: registryPort,
      present: presenceFromEnv(envValue(env, 'AGENTSMITH_REHEARSAL_REGISTRY_PRESENT') ?? null),
    },
  };

  const componentHealth: CurrentRehearsalWorldComponentHealth = {
    world_root: filePresence(scenarioRoot),
    state_file: filePresence(statePath),
    current_release: currentReleasePresence(currentReleasePath),
    web: classifyServiceHealth(envValue(env, statusEnvKey('web')) ?? null),
    api: classifyServiceHealth(envValue(env, statusEnvKey('api')) ?? null),
    keycloak: classifyServiceHealth(envValue(env, statusEnvKey('keycloak')) ?? null),
    sandbox: classifyServiceHealth(envValue(env, statusEnvKey('sandbox')) ?? null),
  };
  const recommendation = buildRecommendation({
    runtimeLine: input.runtimeLine,
    componentHealth,
    worldIdentity,
  });

  return buildCurrentRehearsalWorldHealthSnapshot({
    generatedAt: input.generatedAt,
    runtimeLine: input.runtimeLine,
    rehearsalMode: rehearsalMode(env),
    healthStatus: recommendation.healthStatus,
    worldIdentity,
    componentHealth,
    safeResetLevel: recommendation.safeResetLevel,
    safeNextCommand: recommendation.safeNextCommand,
    safeResetReason: recommendation.safeResetReason,
    authorityPaths: {
      world_root: safePath(scenarioRoot),
      active_scenario_lock: safePath(join(runtimeRoot, 'active-scenario.lock')),
      active_scenario_state: safePath(join(runtimeRoot, 'active-scenario.env')),
      state_file: safePath(statePath),
      site_env: safePath(siteEnvPath),
      registry_env: safePath(registryEnvPath),
      current_release: safePath(currentReleasePath),
      reports: safePath(join(scenarioRoot, 'reports')),
    },
    notes: [
      'read-only diagnostics only; no commands, leases, claim records, or release decisions are produced.',
      'release-fidelity and offline-package still run the full reset/stage sequence and evidence gates.',
    ],
  });
}

function renderOptional(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '<none>' : String(value);
}

function renderPublicBases(bases: CurrentRehearsalWorldIdentity['public_bases']): string {
  return [
    `web=${renderOptional(bases.web)}`,
    `api=${renderOptional(bases.api)}`,
    `keycloak=${renderOptional(bases.keycloak)}`,
    `sandbox=${renderOptional(bases.sandbox)}`,
  ].join('; ');
}

function renderPorts(ports: CurrentRehearsalWorldIdentity['ports']): string {
  return [
    `web=${renderOptional(ports.web)}`,
    `api=${renderOptional(ports.api)}`,
    `keycloak=${renderOptional(ports.keycloak)}`,
    `sandbox=${renderOptional(ports.sandbox)}`,
    `registry=${renderOptional(ports.registry)}`,
  ].join('; ');
}

function renderServiceHealth(service: string, health: CurrentRehearsalWorldHealthServiceHealth): string {
  return `${service}=${health.status}${health.observed ? ` (${health.observed})` : ''}`;
}

function renderComponentHealth(health: CurrentRehearsalWorldComponentHealth): string {
  return [
    `world_root=${health.world_root}`,
    `state_file=${health.state_file}`,
    `current_release=${health.current_release}`,
    renderServiceHealth('web', health.web),
    renderServiceHealth('api', health.api),
    renderServiceHealth('keycloak', health.keycloak),
    renderServiceHealth('sandbox', health.sandbox),
  ].join('; ');
}

export function renderRehearsalWorldHealthSnapshot(snapshot: CurrentRehearsalWorldHealthSnapshot): string {
  return [
    'AgentSmith Rehearsal World Health',
    '',
    `Projection kind: ${snapshot.projection_kind.replaceAll('_', '-')}`,
    `Runtime line: ${snapshot.runtime_line}`,
    `Mode: ${snapshot.rehearsal_mode}`,
    `Health: ${snapshot.health_status}`,
    `World: ${snapshot.world_identity.world_id} @ ${snapshot.world_identity.world_root}`,
    `Active scenario: ${renderOptional(snapshot.world_identity.active_scenario)}`,
    `Phase: ${renderOptional(snapshot.world_identity.phase)}`,
    `Release ID: ${renderOptional(snapshot.world_identity.release_id)}`,
    `Public bases: ${renderPublicBases(snapshot.world_identity.public_bases)}`,
    `Ports: ${renderPorts(snapshot.world_identity.ports)}`,
    `Kind cluster: ${snapshot.world_identity.kind_cluster.name} (${snapshot.world_identity.kind_cluster.present})`,
    `Registry: ${snapshot.world_identity.registry.name} @ ${snapshot.world_identity.registry.host}:${renderOptional(snapshot.world_identity.registry.host_port)} (${snapshot.world_identity.registry.present})`,
    `Component health: ${renderComponentHealth(snapshot.component_health)}`,
    `Safe reset level: ${snapshot.safe_reset_level}`,
    `Safe next command: ${snapshot.safe_next_command}`,
    `Safe reset reason: ${snapshot.safe_reset_reason}`,
    [
      'Authority:',
      `world_root=${snapshot.authority_paths.world_root}`,
      `active_scenario_lock=${snapshot.authority_paths.active_scenario_lock}`,
      `active_scenario_state=${snapshot.authority_paths.active_scenario_state}`,
      `state_file=${snapshot.authority_paths.state_file}`,
      `site_env=${snapshot.authority_paths.site_env}`,
      `registry_env=${snapshot.authority_paths.registry_env}`,
      `current_release=${snapshot.authority_paths.current_release}`,
      `reports=${snapshot.authority_paths.reports}`,
    ].join(' '),
    `Diagnostic only: ${String(snapshot.diagnostic_only)}`,
    `Mutates world: ${String(snapshot.mutates_world)}`,
    `Writes canonical result: ${String(snapshot.writes_canonical_result)}`,
    `Participates in evidence completeness: ${String(snapshot.participates_in_evidence_completeness)}`,
    `Generated at: ${snapshot.generated_at}`,
    `Note: ${snapshot.notes.join(' ')}`,
    '',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [lineArg, ...rest] = argv;
  if (!isRuntimeLine(lineArg)) {
    throw new Error('rehearsal world health requires demo-rehearsal or cluster-rehearsal.');
  }

  const parsed: ParsedArgs = {
    runtimeLine: lineArg,
    json: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--root-dir' && next) {
      parsed.rootDir = next;
      index += 1;
    } else if (arg.startsWith('--root-dir=')) {
      parsed.rootDir = arg.slice('--root-dir='.length);
    } else if (arg === '--scenario-root' && next) {
      parsed.scenarioRoot = next;
      index += 1;
    } else if (arg.startsWith('--scenario-root=')) {
      parsed.scenarioRoot = arg.slice('--scenario-root='.length);
    } else if (arg === '--runtime-root' && next) {
      parsed.runtimeRoot = next;
      index += 1;
    } else if (arg.startsWith('--runtime-root=')) {
      parsed.runtimeRoot = arg.slice('--runtime-root='.length);
    } else {
      throw new Error('Unknown rehearsal world health argument.');
    }
  }
  return parsed;
}

export function runRehearsalWorldHealthCli(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const args = parseArgs(argv);
    const snapshot = buildRehearsalWorldHealthSnapshot({
      runtimeLine: args.runtimeLine,
      rootDir: args.rootDir,
      scenarioRoot: args.scenarioRoot,
      runtimeRoot: args.runtimeRoot,
    });
    process.stdout.write(args.json
      ? `${JSON.stringify(snapshot, null, 2)}\n`
      : renderRehearsalWorldHealthSnapshot(snapshot));
    return 0;
  } catch {
    process.stderr.write('[rehearsal-world-health] snapshot unavailable; check arguments and rehearsal state.\n');
    return 1;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (isCliEntrypoint('rehearsal-world-health.ts')) {
  process.exit(runRehearsalWorldHealthCli());
}
