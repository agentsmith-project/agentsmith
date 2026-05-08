import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SUBSTRATE_COMPOSE_PATH, checkSubstrateComposeText } from './check-substrate-boundary';
import {
  REPO_ROOT,
  asRecord,
  isUnifiedDeployProfile,
  prepareUnifiedDeployEvidenceDir,
  type CheckFailure,
  type UnifiedDeployProfile,
} from './manifest';
import {
  DOCKER_SUBSTRATE_REQUIRED_ENV,
  SUBSTRATE_TRUTH_SCHEMA_ENV_KEY,
  SUBSTRATE_TRUTH_SCHEMA_VERSION,
  parseSubstrateTruth,
  redactedSubstrateTruthValues,
  validateSubstrateTruthText,
} from './substrate-truth';
import { substrateKeycloakInternalBaseUrl } from './substrate-address-roles';

export const DEFAULT_SUBSTRATE_TRUTH_OUTPUT_PATH = path.join(
  REPO_ROOT,
  'infra',
  'deploy',
  'unified',
  'substrate',
  'connection.env',
);
export const DEFAULT_SUBSTRATE_COMPOSE_PROJECT = 'agentsmith-unified-substrate';
export const DEFAULT_SUBSTRATE_LIFECYCLE_EVIDENCE_DIR = path.join(REPO_ROOT, 'artifacts', 'unified-deploy');

export const SUBSTRATE_LIFECYCLE_SERVICES = ['postgresql', 'mongodb', 'redis', 'minio', 'keycloak'] as const;
export const SUBSTRATE_LIFECYCLE_INIT_HELPERS = ['minio-init'] as const;
export const DEFAULT_SUBSTRATE_INTERNAL_NO_PROXY_HOSTS = [
  'postgresql',
  'mongodb',
  'redis',
  'minio',
  'keycloak',
  'localhost',
  '127.0.0.1',
  '::1',
] as const;

export type SubstrateLifecycleCommand = 'up' | 'down' | 'reset' | 'reseed' | 'status';
export type SubstrateLifecycleStatus = 'passed' | 'failed';

export type SubstrateCommandInvocation = {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type SubstrateCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SubstrateCommandRunner = (invocation: SubstrateCommandInvocation) => Promise<SubstrateCommandResult>;

export type BuildSubstrateTruthOptions = {
  profile?: UnifiedDeployProfile;
  env?: Record<string, string | undefined>;
  existingValues?: Record<string, string>;
  detectLocalKindHost?: () => string | null;
};

export type RunSubstrateLifecycleOptions = {
  command: SubstrateLifecycleCommand;
  profile?: UnifiedDeployProfile;
  composePath?: string;
  truthPath?: string;
  composeProject?: string;
  evidenceDir?: string;
  env?: Record<string, string | undefined>;
  runner?: SubstrateCommandRunner;
  detectLocalKindHost?: () => string | null;
};

type LifecycleStepEvidence = {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  exit_code?: number;
  timeout_ms?: number;
};

type ServiceHealth = {
  state: string;
  health: string;
};

type SubstrateHealthSummary = {
  checked: boolean;
  services: Record<string, ServiceHealth>;
};

export type SubstrateRuntimePublishedPortOwner = {
  container_name: string;
  compose_project: string;
  compose_service: string;
  image: string;
  container_port: number;
  host_ports: string[];
  host_bindings: Array<{
    host_ip: string;
    host_port: string;
  }>;
};

export type SubstrateRuntimeTruthServiceCheck = {
  service: typeof SUBSTRATE_LIFECYCLE_SERVICES[number];
  status: 'passed' | 'failed';
  expected: {
    compose_project: string;
    compose_service: string;
    container_port: number;
    host: string;
    host_port: string;
  };
  actual_owner?: SubstrateRuntimePublishedPortOwner;
  candidate_owners: SubstrateRuntimePublishedPortOwner[];
  diagnostic?: string;
};

export type SubstrateRuntimeTruthSummary = {
  checked: boolean;
  status: 'passed' | 'failed' | 'skipped';
  expected_compose_project: string;
  checks: SubstrateRuntimeTruthServiceCheck[];
  failures: CheckFailure[];
};

type ReseedSummary = {
  checked: boolean;
  minio: {
    bucket: string;
    status: 'passed' | 'failed' | 'skipped';
  };
  keycloak: {
    realm: string;
    client_id: string;
    status: 'passed' | 'failed' | 'skipped';
  };
  postgresql: {
    schema: string;
    extensions: string[];
    status: 'passed' | 'failed' | 'skipped';
  };
  mongodb: {
    status: 'passed' | 'failed' | 'skipped';
  };
  redis: {
    status: 'passed' | 'failed' | 'skipped';
  };
  product_bootstrap: false;
};

export type SubstrateLifecycleEvidence = {
  schema_version: 'agentsmith.unified-deploy.substrate-lifecycle.evidence/v1';
  command: SubstrateLifecycleCommand;
  profile: UnifiedDeployProfile;
  compose_project: string;
  status: SubstrateLifecycleStatus;
  generated_at: string;
  services: Array<typeof SUBSTRATE_LIFECYCLE_SERVICES[number]>;
  init_helpers: Array<typeof SUBSTRATE_LIFECYCLE_INIT_HELPERS[number]>;
  truth: {
    schema_version: typeof SUBSTRATE_TRUTH_SCHEMA_VERSION;
    path: string;
    redacted_fingerprint: string;
    redacted_values: Record<string, string>;
  };
  health: SubstrateHealthSummary;
  runtime_truth: SubstrateRuntimeTruthSummary;
  reseed: ReseedSummary;
  steps: LifecycleStepEvidence[];
  failures: CheckFailure[];
  paths: {
    report_path: string;
    log_path: string;
  };
};

type LifecycleContext = {
  command: SubstrateLifecycleCommand;
  profile: UnifiedDeployProfile;
  composePath: string;
  truthPath: string;
  composeProject: string;
  evidenceDir: string;
  env: Record<string, string | undefined>;
  runner: SubstrateCommandRunner;
  detectLocalKindHost: () => string | null;
};

const PRODUCT_BOOTSTRAP_PATTERN = /\b(?:ensure-default-workspace|workspace|project|endpoint|agent-runner|runner)\b|\/api\/v1/iu;
const SECRET_KEY_PATTERN = /(?:PASSWORD|SECRET|TOKEN|PRIVATE|ACCESS[_-]?KEY|API[_-]?KEY|CREDENTIAL|DATABASE_URL|MONGO_URL|MONGODB_URI|REDIS_URL|CLIENT_SECRET|AUTHORIZATION)/iu;

const DEFAULT_SECRET_VALUE = 'agentsmith_dev_password';
const DEFAULT_RESEED_STEP_TIMEOUT_MS = 120_000;

const DEFAULT_TRUTH_VALUES: Record<typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number], string> = {
  SUBSTRATE_POSTGRES_HOST: 'host.docker.internal',
  SUBSTRATE_POSTGRES_PORT: '15432',
  SUBSTRATE_POSTGRES_DATABASE: 'agentsmith',
  SUBSTRATE_POSTGRES_USER: 'agentsmith',
  SUBSTRATE_POSTGRES_PASSWORD: DEFAULT_SECRET_VALUE,
  SUBSTRATE_MONGODB_HOST: 'host.docker.internal',
  SUBSTRATE_MONGODB_PORT: '27027',
  SUBSTRATE_MONGODB_DATABASE: 'agentsmith',
  SUBSTRATE_MONGODB_USER: 'agentsmith',
  SUBSTRATE_MONGODB_PASSWORD: DEFAULT_SECRET_VALUE,
  SUBSTRATE_REDIS_HOST: 'host.docker.internal',
  SUBSTRATE_REDIS_PORT: '16379',
  SUBSTRATE_REDIS_PASSWORD: DEFAULT_SECRET_VALUE,
  SUBSTRATE_MINIO_HOST: 'host.docker.internal',
  SUBSTRATE_MINIO_PORT: '19000',
  SUBSTRATE_MINIO_ACCESS_KEY: 'agentsmith',
  SUBSTRATE_MINIO_SECRET_KEY: DEFAULT_SECRET_VALUE,
  SUBSTRATE_MINIO_BUCKET: 'agentsmith-files',
  SUBSTRATE_KEYCLOAK_HOST: 'host.docker.internal',
  SUBSTRATE_KEYCLOAK_PORT: '18080',
  SUBSTRATE_KEYCLOAK_PUBLIC_ISSUER: 'http://localhost:18080/realms/agentsmith',
  SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL: substrateKeycloakInternalBaseUrl(),
  SUBSTRATE_KEYCLOAK_REALM: 'agentsmith',
  SUBSTRATE_KEYCLOAK_CLIENT_ID: 'agentsmith-web',
  SUBSTRATE_KEYCLOAK_ADMIN: 'agentsmith-admin',
  SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD: DEFAULT_SECRET_VALUE,
};

const SUBSTRATE_RUNTIME_PORTS = [
  {
    service: 'postgresql',
    truthHostKey: 'SUBSTRATE_POSTGRES_HOST',
    truthPortKey: 'SUBSTRATE_POSTGRES_PORT',
    containerPort: 5432,
  },
  {
    service: 'mongodb',
    truthHostKey: 'SUBSTRATE_MONGODB_HOST',
    truthPortKey: 'SUBSTRATE_MONGODB_PORT',
    containerPort: 27017,
  },
  {
    service: 'redis',
    truthHostKey: 'SUBSTRATE_REDIS_HOST',
    truthPortKey: 'SUBSTRATE_REDIS_PORT',
    containerPort: 6379,
  },
  {
    service: 'minio',
    truthHostKey: 'SUBSTRATE_MINIO_HOST',
    truthPortKey: 'SUBSTRATE_MINIO_PORT',
    containerPort: 9000,
  },
  {
    service: 'keycloak',
    truthHostKey: 'SUBSTRATE_KEYCLOAK_HOST',
    truthPortKey: 'SUBSTRATE_KEYCLOAK_PORT',
    containerPort: 8080,
  },
] as const satisfies readonly Array<{
  service: typeof SUBSTRATE_LIFECYCLE_SERVICES[number];
  truthHostKey: typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number];
  truthPortKey: typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number];
  containerPort: number;
}>;

function resolvePath(targetPath: string | undefined, fallback: string): string {
  if (!targetPath) {
    return fallback;
  }

  return path.isAbsolute(targetPath) ? targetPath : path.resolve(REPO_ROOT, targetPath);
}

function asEnvStringRecord(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function splitNoProxyValue(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildSubstrateInternalNoProxy(env: Record<string, string | undefined> = process.env): string {
  return [
    ...new Set([
      ...DEFAULT_SUBSTRATE_INTERNAL_NO_PROXY_HOSTS,
      ...splitNoProxyValue(env.SUBSTRATE_INTERNAL_NO_PROXY),
      ...splitNoProxyValue(env.NO_PROXY),
      ...splitNoProxyValue(env.no_proxy),
    ]),
  ].join(',');
}

function withSubstrateInternalNoProxy(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    ...env,
    SUBSTRATE_INTERNAL_NO_PROXY: buildSubstrateInternalNoProxy(env),
  };
}

function envValue(
  key: typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number],
  env: Record<string, string | undefined>,
  existingValues: Record<string, string>,
  fallback: string,
): string {
  return env[key] ?? existingValues[key] ?? fallback;
}

function derivePublicIssuer(values: Record<typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number], string>): string {
  const realm = values.SUBSTRATE_KEYCLOAK_REALM.replace(/^\/+|\/+$/gu, '');
  return `http://localhost:${values.SUBSTRATE_KEYCLOAK_PORT}/realms/${realm}`;
}

function isIpv4Address(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d+$/u.test(part)) {
      return false;
    }
    const numeric = Number(part);
    return numeric >= 0 && numeric <= 255;
  });
}

function isBlockedLocalKindHost(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === ''
    || normalized === 'localhost'
    || normalized === 'host.docker.internal'
    || normalized === '127.0.0.1'
    || normalized.startsWith('127.');
}

function defaultDetectLocalKindHost(): string | null {
  const result = spawnSync('docker', [
    'network',
    'inspect',
    'kind',
    '-f',
    '{{range .IPAM.Config}}{{println .Gateway}}{{end}}',
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => isIpv4Address(line)) ?? null;
}

function resolveLocalKindHost(
  env: Record<string, string | undefined>,
  existingValues: Record<string, string>,
  detectLocalKindHost: () => string | null,
): string {
  const host = env.SUBSTRATE_LOCAL_KIND_HOST
    ?? env.SUBSTRATE_KIND_GATEWAY_HOST
    ?? env.KIND_GATEWAY_HOST
    ?? env.SUBSTRATE_HOST
    ?? existingValues.SUBSTRATE_LOCAL_KIND_HOST
    ?? existingValues.SUBSTRATE_KIND_GATEWAY_HOST
    ?? detectLocalKindHost()
    ?? '';

  if (isBlockedLocalKindHost(host)) {
    throw new Error(
      'local-kind substrate truth requires SUBSTRATE_LOCAL_KIND_HOST with a pod-routable kind gateway host; refusing to generate host.docker.internal truth',
    );
  }

  return host;
}

function applyLocalKindHost(
  values: Record<typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number], string>,
  env: Record<string, string | undefined>,
  existingValues: Record<string, string>,
  detectLocalKindHost: () => string | null,
): void {
  const localKindHost = resolveLocalKindHost(env, existingValues, detectLocalKindHost);

  values.SUBSTRATE_POSTGRES_HOST = env.SUBSTRATE_POSTGRES_HOST ?? existingValues.SUBSTRATE_POSTGRES_HOST ?? localKindHost;
  values.SUBSTRATE_MONGODB_HOST = env.SUBSTRATE_MONGODB_HOST ?? existingValues.SUBSTRATE_MONGODB_HOST ?? localKindHost;
  values.SUBSTRATE_REDIS_HOST = env.SUBSTRATE_REDIS_HOST ?? existingValues.SUBSTRATE_REDIS_HOST ?? localKindHost;
  values.SUBSTRATE_MINIO_HOST = env.SUBSTRATE_MINIO_HOST ?? existingValues.SUBSTRATE_MINIO_HOST ?? localKindHost;
  values.SUBSTRATE_KEYCLOAK_HOST = env.SUBSTRATE_KEYCLOAK_HOST ?? existingValues.SUBSTRATE_KEYCLOAK_HOST ?? localKindHost;

  for (const key of [
    'SUBSTRATE_POSTGRES_HOST',
    'SUBSTRATE_MONGODB_HOST',
    'SUBSTRATE_REDIS_HOST',
    'SUBSTRATE_MINIO_HOST',
    'SUBSTRATE_KEYCLOAK_HOST',
  ] as const) {
    if (isBlockedLocalKindHost(values[key])) {
      throw new Error(`${key} must be pod-routable for local-kind; got ${values[key]}`);
    }
  }
}

function ensureExistingClusterSecretsAreExplicit(values: Record<typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number], string>): void {
  const defaultedSecrets = [
    'SUBSTRATE_POSTGRES_PASSWORD',
    'SUBSTRATE_MONGODB_PASSWORD',
    'SUBSTRATE_REDIS_PASSWORD',
    'SUBSTRATE_MINIO_SECRET_KEY',
    'SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD',
  ].filter((key) => {
    const value = values[key as typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number]];
    return !value || value === DEFAULT_SECRET_VALUE;
  });

  if (defaultedSecrets.length > 0) {
    throw new Error(
      `existing-cluster substrate truth requires explicit values: ${defaultedSecrets.join(', ')}`,
    );
  }
}

function ensureExistingClusterHostsAreExplicit(
  values: Record<typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number], string>,
  env: Record<string, string | undefined>,
  existingValues: Record<string, string>,
): void {
  const hostKeys = [
    'SUBSTRATE_POSTGRES_HOST',
    'SUBSTRATE_MONGODB_HOST',
    'SUBSTRATE_REDIS_HOST',
    'SUBSTRATE_MINIO_HOST',
    'SUBSTRATE_KEYCLOAK_HOST',
  ] as const;
  const sharedHost = env.SUBSTRATE_HOST ?? existingValues.SUBSTRATE_HOST;
  const invalidHosts = hostKeys.filter((key) => {
    const hostWasExplicit = Boolean(env[key] ?? existingValues[key] ?? sharedHost);
    return !hostWasExplicit || isBlockedLocalKindHost(values[key]);
  });

  if (invalidHosts.length > 0) {
    throw new Error(
      `existing-cluster substrate truth requires explicit non-local host values: ${invalidHosts.join(', ')}`,
    );
  }
}

function generatedTruthHeader(): string {
  return [
    '# AgentSmith Docker substrate connection truth.',
    '# Generated by scripts/unified-deploy/substrate-lifecycle.ts.',
    '# This file is operator-local and intentionally ignored by git.',
    '',
  ].join('\n');
}

export function buildSubstrateTruthText(options: BuildSubstrateTruthOptions = {}): string {
  const env = options.env ?? process.env;
  const existingValues = options.existingValues ?? {};
  const profile = options.profile ?? 'existing-cluster';
  const sharedHost = env.SUBSTRATE_HOST ?? existingValues.SUBSTRATE_HOST;
  const values = Object.fromEntries(
    DOCKER_SUBSTRATE_REQUIRED_ENV.map((key) => [
      key,
      envValue(key, env, existingValues, DEFAULT_TRUTH_VALUES[key]),
    ]),
  ) as Record<typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number], string>;

  if (sharedHost) {
    values.SUBSTRATE_POSTGRES_HOST = env.SUBSTRATE_POSTGRES_HOST ?? existingValues.SUBSTRATE_POSTGRES_HOST ?? sharedHost;
    values.SUBSTRATE_MONGODB_HOST = env.SUBSTRATE_MONGODB_HOST ?? existingValues.SUBSTRATE_MONGODB_HOST ?? sharedHost;
    values.SUBSTRATE_REDIS_HOST = env.SUBSTRATE_REDIS_HOST ?? existingValues.SUBSTRATE_REDIS_HOST ?? sharedHost;
    values.SUBSTRATE_MINIO_HOST = env.SUBSTRATE_MINIO_HOST ?? existingValues.SUBSTRATE_MINIO_HOST ?? sharedHost;
    values.SUBSTRATE_KEYCLOAK_HOST = env.SUBSTRATE_KEYCLOAK_HOST ?? existingValues.SUBSTRATE_KEYCLOAK_HOST ?? sharedHost;
  }

  if (profile === 'local-kind') {
    applyLocalKindHost(values, env, existingValues, options.detectLocalKindHost ?? defaultDetectLocalKindHost);
  } else {
    ensureExistingClusterSecretsAreExplicit(values);
    ensureExistingClusterHostsAreExplicit(values, env, existingValues);
  }

  values.SUBSTRATE_KEYCLOAK_PUBLIC_ISSUER = env.SUBSTRATE_KEYCLOAK_PUBLIC_ISSUER
    ?? existingValues.SUBSTRATE_KEYCLOAK_PUBLIC_ISSUER
    ?? derivePublicIssuer(values);
  values.SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL = env.SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL
    ?? substrateKeycloakInternalBaseUrl();

  return `${generatedTruthHeader()}${[
    `${SUBSTRATE_TRUTH_SCHEMA_ENV_KEY}=${SUBSTRATE_TRUTH_SCHEMA_VERSION}`,
    '',
    ...DOCKER_SUBSTRATE_REQUIRED_ENV.map((key) => `${key}=${values[key]}`),
  ].join('\n')}\n`;
}

function parseExistingTruthValues(truthPath: string): Record<string, string> {
  if (!existsSync(truthPath)) {
    return {};
  }

  try {
    return parseSubstrateTruth(readFileSync(truthPath, 'utf8'), { sourcePath: truthPath }).values;
  } catch {
    return {};
  }
}

async function writeValidatedTruthFile(context: LifecycleContext): Promise<{
  text: string;
  parsed: ReturnType<typeof parseSubstrateTruth>;
}> {
  const text = buildSubstrateTruthText({
    profile: context.profile,
    env: context.env,
    existingValues: parseExistingTruthValues(context.truthPath),
    detectLocalKindHost: context.detectLocalKindHost,
  });
  const validation = validateSubstrateTruthText(text, { sourcePath: context.truthPath });

  if (!validation.ok || !validation.truth) {
    throw new Error(validation.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n'));
  }

  await mkdir(path.dirname(context.truthPath), { recursive: true });
  await writeFile(context.truthPath, text, 'utf8');
  await chmod(context.truthPath, 0o600);

  return {
    text,
    parsed: validation.truth,
  };
}

function validateDependencyReadinessText(text: string): void {
  if (PRODUCT_BOOTSTRAP_PATTERN.test(text)) {
    throw new Error('Docker substrate reseed must not run AgentSmith product bootstrap');
  }
}

function composeBaseArgs(context: LifecycleContext): string[] {
  return [
    'compose',
    '--env-file',
    context.truthPath,
    '-f',
    context.composePath,
    '-p',
    context.composeProject,
  ];
}

function composeArgs(context: LifecycleContext, args: readonly string[]): string[] {
  return [...composeBaseArgs(context), ...args];
}

async function defaultCommandRunner(invocation: SubstrateCommandInvocation): Promise<SubstrateCommandResult> {
  return await new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      env: {
        ...process.env,
        ...(invocation.env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const timeout = invocation.timeoutMs && invocation.timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 5_000);
      }, invocation.timeoutMs)
      : undefined;
    const clearTimers = (): void => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
    };
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      resolve({
        exitCode: 1,
        stdout,
        stderr: error.message,
      });
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout,
        stderr: timedOut
          ? `${stderr}${stderr ? '\n' : ''}command timed out after ${invocation.timeoutMs}ms`
          : stderr,
      });
    });
  });
}

async function runDockerComposeStep(
  context: LifecycleContext,
  steps: LifecycleStepEvidence[],
  name: string,
  args: readonly string[],
  options: { timeoutMs?: number } = {},
): Promise<SubstrateCommandResult> {
  const fullArgs = composeArgs(context, args);

  const step: LifecycleStepEvidence = { name, status: 'skipped' };
  if (options.timeoutMs) {
    step.timeout_ms = options.timeoutMs;
  }
  steps.push(step);
  const result = await context.runner({
    executable: 'docker',
    args: fullArgs,
    cwd: REPO_ROOT,
    env: asEnvStringRecord(context.env),
    timeoutMs: options.timeoutMs,
  });
  step.exit_code = result.exitCode;
  step.status = result.exitCode === 0 ? 'passed' : 'failed';

  if (result.exitCode !== 0) {
    const details = result.stderr || result.stdout;
    throw new Error(`docker compose step ${name} failed with exit code ${result.exitCode}${details ? `: ${details}` : ''}`);
  }

  return result;
}

function parseComposePsJson(stdout: string): Record<string, ServiceHealth> {
  const services: Record<string, ServiceHealth> = {};
  const trimmed = stdout.trim();
  if (!trimmed) {
    return services;
  }

  const parsed = parseJsonOrLines(trimmed);
  for (const entry of parsed) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const service = stringField(record, 'Service') || stringField(record, 'Name');
    if (!service || !SUBSTRATE_LIFECYCLE_SERVICES.includes(service as typeof SUBSTRATE_LIFECYCLE_SERVICES[number])) {
      continue;
    }

    services[service] = {
      state: stringField(record, 'State') || 'unknown',
      health: stringField(record, 'Health') || 'unknown',
    };
  }

  return services;
}

function parseJsonOrLines(trimmed: string): unknown[] {
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed
      .split(/\r?\n/u)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is unknown => entry !== undefined);
  }
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

export function skippedSubstrateRuntimeTruthSummary(
  composeProject = DEFAULT_SUBSTRATE_COMPOSE_PROJECT,
): SubstrateRuntimeTruthSummary {
  return {
    checked: false,
    status: 'skipped',
    expected_compose_project: composeProject,
    checks: [],
    failures: [],
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function normalizeContainerName(value: string): string {
  return value.replace(/^\/+/u, '');
}

function dockerContainerLabels(record: Record<string, unknown>): Record<string, string> {
  const labels = asRecord(asRecord(record.Config).Labels);
  return Object.fromEntries(
    Object.entries(labels).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function dockerContainerHostBindings(record: Record<string, unknown>, containerPort: number): Array<{
  host_ip: string;
  host_port: string;
}> {
  const ports = asRecord(asRecord(record.NetworkSettings).Ports);
  const bindings = ports[`${containerPort}/tcp`];
  if (!Array.isArray(bindings)) {
    return [];
  }

  const normalized = bindings
    .map((binding) => {
      const record = asRecord(binding);
      const hostPort = record.HostPort;
      const hostIp = record.HostIp;
      if (typeof hostPort !== 'string') {
        return undefined;
      }

      return {
        host_ip: typeof hostIp === 'string' ? hostIp : '',
        host_port: hostPort,
      };
    })
    .filter((binding): binding is { host_ip: string; host_port: string } => binding !== undefined);

  return [...new Map(normalized
    .map((binding) => [`${binding.host_ip}:${binding.host_port}`, binding])).values()]
    .sort((left, right) => `${left.host_ip}:${left.host_port}`.localeCompare(`${right.host_ip}:${right.host_port}`));
}

function dockerPortOwner(record: Record<string, unknown>, containerPort: number): SubstrateRuntimePublishedPortOwner {
  const labels = dockerContainerLabels(record);
  const hostBindings = dockerContainerHostBindings(record, containerPort);
  return {
    container_name: normalizeContainerName(stringField(record, 'Name')),
    compose_project: labels['com.docker.compose.project'] ?? '',
    compose_service: labels['com.docker.compose.service'] ?? '',
    image: stringField(asRecord(record.Config), 'Image'),
    container_port: containerPort,
    host_ports: uniqueSorted(hostBindings.map((binding) => binding.host_port)),
    host_bindings: hostBindings,
  };
}

function ownerLabel(owner: SubstrateRuntimePublishedPortOwner): string {
  const project = owner.compose_project || 'unknown-project';
  const service = owner.compose_service || 'unknown-service';
  const name = owner.container_name || 'unknown-container';
  const ports = owner.host_bindings.length > 0
    ? owner.host_bindings.map((binding) => `${binding.host_ip || '*'}:${binding.host_port}`).join(',')
    : owner.host_ports.length > 0 ? owner.host_ports.join(',') : 'none';
  return `${project}/${service} (${name}) publishing host port ${ports} to container port ${owner.container_port}`;
}

function parseDockerInspectContainers(stdout: string): Record<string, unknown>[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && !Array.isArray(entry));
}

async function inspectDockerRuntimeContainers(options: {
  runner: SubstrateCommandRunner;
  env: Record<string, string | undefined>;
}): Promise<{ containers: Record<string, unknown>[]; failures: CheckFailure[] }> {
  const ps = await options.runner({
    executable: 'docker',
    args: ['ps', '-q'],
    cwd: REPO_ROOT,
    env: asEnvStringRecord(options.env),
  });
  if (ps.exitCode !== 0) {
    return {
      containers: [],
      failures: [{
        path: 'substrate-runtime:docker-ps',
        message: `docker ps -q failed while checking substrate runtime truth: ${ps.stderr || ps.stdout || `exit ${ps.exitCode}`}`,
      }],
    };
  }

  const ids = ps.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return { containers: [], failures: [] };
  }

  const inspect = await options.runner({
    executable: 'docker',
    args: ['inspect', ...ids],
    cwd: REPO_ROOT,
    env: asEnvStringRecord(options.env),
  });
  if (inspect.exitCode !== 0) {
    return {
      containers: [],
      failures: [{
        path: 'substrate-runtime:docker-inspect',
        message: `docker inspect failed while checking substrate runtime truth: ${inspect.stderr || inspect.stdout || `exit ${inspect.exitCode}`}`,
      }],
    };
  }

  try {
    return {
      containers: parseDockerInspectContainers(inspect.stdout),
      failures: [],
    };
  } catch (error: unknown) {
    return {
      containers: [],
      failures: [{
        path: 'substrate-runtime:docker-inspect',
        message: `docker inspect returned invalid JSON while checking substrate runtime truth: ${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }
}

function failedRuntimeCheckMessage(check: SubstrateRuntimeTruthServiceCheck): string {
  const expected = `${check.expected.compose_project}/${check.expected.compose_service}`;
  const expectedText = `${expected} to publish host port ${check.expected.host_port} on ${check.expected.host} to container port ${check.expected.container_port}`;
  if (!check.actual_owner && check.candidate_owners.length === 0) {
    return `${check.service} expected ${expectedText}, but no running Docker container publishes container port ${check.expected.container_port}`;
  }

  if (!check.actual_owner) {
    return `${check.service} expected ${expectedText}, but no owned running container was found; found ${check.candidate_owners.map(ownerLabel).join('; ')}`;
  }

  const matchingBindings = check.actual_owner.host_bindings.filter((binding) =>
    binding.host_port === check.expected.host_port,
  );
  if (matchingBindings.length > 0) {
    return `${check.service} expected ${expectedText}, but actual owner ${ownerLabel(check.actual_owner)} has matching host port bound only to ${matchingBindings.map((binding) => `${binding.host_ip || '*'}:${binding.host_port}`).join(',')}; not routable from local-kind substrate host ${check.expected.host}`;
  }

  return `${check.service} expected ${expectedText}, but actual owner ${ownerLabel(check.actual_owner)}`;
}

function normalizeHostIp(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;
}

function isRoutableHostBinding(binding: { host_ip: string; host_port: string }, expectedHost: string): boolean {
  const hostIp = normalizeHostIp(binding.host_ip);
  const host = normalizeHostIp(expectedHost);

  return hostIp === ''
    || hostIp === '0.0.0.0'
    || hostIp === '::'
    || hostIp === host;
}

function hasRoutableExpectedBinding(
  owner: SubstrateRuntimePublishedPortOwner | undefined,
  expectedHostPort: string,
  expectedHost: string,
): boolean {
  return Boolean(owner?.host_bindings.some((binding) =>
    binding.host_port === expectedHostPort && isRoutableHostBinding(binding, expectedHost),
  ));
}

function buildRuntimeServiceCheck(options: {
  composeProject: string;
  truthValues: Record<string, string>;
  owners: readonly SubstrateRuntimePublishedPortOwner[];
  service: typeof SUBSTRATE_LIFECYCLE_SERVICES[number];
  truthHostKey: typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number];
  truthPortKey: typeof DOCKER_SUBSTRATE_REQUIRED_ENV[number];
  containerPort: number;
}): SubstrateRuntimeTruthServiceCheck {
  const expectedHost = options.truthValues[options.truthHostKey] ?? '';
  const expectedHostPort = options.truthValues[options.truthPortKey] ?? '';
  const candidates = options.owners.filter((owner) => owner.container_port === options.containerPort);
  const actualOwner = candidates.find((owner) =>
    owner.compose_project === options.composeProject && owner.compose_service === options.service,
  );
  const passed = hasRoutableExpectedBinding(actualOwner, expectedHostPort, expectedHost);
  const check: SubstrateRuntimeTruthServiceCheck = {
    service: options.service,
    status: passed ? 'passed' : 'failed',
    expected: {
      compose_project: options.composeProject,
      compose_service: options.service,
      container_port: options.containerPort,
      host: expectedHost,
      host_port: expectedHostPort,
    },
    actual_owner: actualOwner,
    candidate_owners: candidates
      .filter((owner) => owner !== actualOwner && owner.host_ports.length > 0)
      .sort((left, right) => ownerLabel(left).localeCompare(ownerLabel(right))),
  };

  if (!passed) {
    check.diagnostic = failedRuntimeCheckMessage(check);
  }

  return check;
}

export async function checkSubstrateRuntimeTruth(options: {
  truthValues: Record<string, string>;
  composeProject?: string;
  runner?: SubstrateCommandRunner;
  env?: Record<string, string | undefined>;
}): Promise<SubstrateRuntimeTruthSummary> {
  const composeProject = options.composeProject ?? DEFAULT_SUBSTRATE_COMPOSE_PROJECT;
  const runner = options.runner ?? defaultCommandRunner;
  const inspected = await inspectDockerRuntimeContainers({
    runner,
    env: options.env ?? process.env,
  });
  const owners = SUBSTRATE_RUNTIME_PORTS.flatMap((expected) =>
    inspected.containers.map((container) => dockerPortOwner(container, expected.containerPort)),
  );
  const checks = SUBSTRATE_RUNTIME_PORTS.map((expected) =>
    buildRuntimeServiceCheck({
      composeProject,
      truthValues: options.truthValues,
      owners,
      service: expected.service,
      truthHostKey: expected.truthHostKey,
      truthPortKey: expected.truthPortKey,
      containerPort: expected.containerPort,
    }),
  );
  const failures = [
    ...inspected.failures,
    ...checks
      .filter((check) => check.status === 'failed')
      .map((check): CheckFailure => ({
        path: `substrate-runtime:${check.service}`,
        message: check.diagnostic ?? failedRuntimeCheckMessage(check),
      })),
  ];

  return {
    checked: true,
    status: failures.length === 0 ? 'passed' : 'failed',
    expected_compose_project: composeProject,
    checks,
    failures,
  };
}

class SubstrateHealthCheckError extends Error {
  readonly health: SubstrateHealthSummary;
  readonly failures: CheckFailure[];

  constructor(health: SubstrateHealthSummary, failures: CheckFailure[]) {
    super(`missing healthy Docker substrate services: ${failures.map((failure) => failure.message).join('; ')}`);
    this.health = health;
    this.failures = failures;
  }
}

class SubstrateLiveTruthCheckError extends Error {
  readonly health: SubstrateHealthSummary;
  readonly runtimeTruth: SubstrateRuntimeTruthSummary;
  readonly failures: CheckFailure[];

  constructor(
    health: SubstrateHealthSummary,
    runtimeTruth: SubstrateRuntimeTruthSummary,
    failures: CheckFailure[],
    message: string,
  ) {
    super(message);
    this.health = health;
    this.runtimeTruth = runtimeTruth;
    this.failures = failures;
  }
}

function healthCheckFailures(health: SubstrateHealthSummary): CheckFailure[] {
  const failures: CheckFailure[] = [];

  for (const service of SUBSTRATE_LIFECYCLE_SERVICES) {
    const serviceHealth = health.services[service];
    if (!serviceHealth) {
      failures.push({
        path: `substrate-health:${service}`,
        message: `${service} is missing`,
      });
      continue;
    }

    if (serviceHealth.state !== 'running' || serviceHealth.health !== 'healthy') {
      failures.push({
        path: `substrate-health:${service}`,
        message: `${service} is ${serviceHealth.state}/${serviceHealth.health}`,
      });
    }
  }

  return failures;
}

function assertRequiredServicesHealthy(health: SubstrateHealthSummary): void {
  const failures = healthCheckFailures(health);
  if (failures.length > 0) {
    throw new SubstrateHealthCheckError(health, failures);
  }
}

function assertDockerSubstrateLiveTruth(
  health: SubstrateHealthSummary,
  runtimeTruth: SubstrateRuntimeTruthSummary,
): void {
  const healthFailures = healthCheckFailures(health);
  const failures = [
    ...healthFailures,
    ...runtimeTruth.failures,
  ];
  if (failures.length > 0) {
    const messages = [
      healthFailures.length > 0
        ? `missing healthy Docker substrate services: ${healthFailures.map((failure) => failure.message).join('; ')}`
        : '',
      runtimeTruth.failures.length > 0
        ? `Docker substrate runtime truth mismatch: ${runtimeTruth.failures.map((failure) => failure.message).join('; ')}`
        : '',
    ].filter(Boolean);
    throw new SubstrateLiveTruthCheckError(health, runtimeTruth, failures, messages.join('; '));
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function emptyReseedSummary(truthValues: Record<string, string>): ReseedSummary {
  return {
    checked: false,
    minio: {
      bucket: truthValues.SUBSTRATE_MINIO_BUCKET ?? '',
      status: 'skipped',
    },
    keycloak: {
      realm: truthValues.SUBSTRATE_KEYCLOAK_REALM ?? '',
      client_id: truthValues.SUBSTRATE_KEYCLOAK_CLIENT_ID ?? '',
      status: 'skipped',
    },
    postgresql: {
      schema: 'public',
      extensions: requestedPostgresExtensions({}),
      status: 'skipped',
    },
    mongodb: {
      status: 'skipped',
    },
    redis: {
      status: 'skipped',
    },
    product_bootstrap: false,
  };
}

function requestedPostgresExtensions(env: Record<string, string | undefined>): string[] {
  const raw = env.SUBSTRATE_POSTGRES_REQUIRED_EXTENSIONS?.trim();
  if (raw === undefined) {
    return ['vector'];
  }
  if (raw === '' || raw.toLowerCase() === 'none') {
    return [];
  }

  return raw
    .split(',')
    .map((extension) => extension.trim())
    .filter(Boolean)
    .map((extension) => {
      if (!/^[a-z][a-z0-9_]*$/u.test(extension)) {
        throw new Error(`invalid SUBSTRATE_POSTGRES_REQUIRED_EXTENSIONS value: ${extension}`);
      }

      return extension;
    });
}

function postgresReadinessSql(extensions: readonly string[]): string {
  return [
    'SELECT 1;',
    'CREATE SCHEMA IF NOT EXISTS public;',
    ...extensions.map((extension) => `CREATE EXTENSION IF NOT EXISTS ${extension};`),
  ].join(' ');
}

function keycloakReadinessScript(): string {
  return [
    'set -eu',
    '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null',
    'if ! /opt/keycloak/bin/kcadm.sh get "realms/$SUBSTRATE_KEYCLOAK_REALM" >/dev/null 2>&1; then',
    '  /opt/keycloak/bin/kcadm.sh create realms -s "realm=$SUBSTRATE_KEYCLOAK_REALM" -s enabled=true >/dev/null',
    'fi',
    'if ! /opt/keycloak/bin/kcadm.sh get clients -r "$SUBSTRATE_KEYCLOAK_REALM" -q "clientId=$SUBSTRATE_KEYCLOAK_CLIENT_ID" | grep -q "\\"clientId\\""; then',
    '  /opt/keycloak/bin/kcadm.sh create clients -r "$SUBSTRATE_KEYCLOAK_REALM" -s "clientId=$SUBSTRATE_KEYCLOAK_CLIENT_ID" -s enabled=true -s publicClient=true -s standardFlowEnabled=true -s directAccessGrantsEnabled=true >/dev/null',
    'fi',
  ].join('\n');
}

function validateReseedReadinessTemplates(extensions: readonly string[]): void {
  for (const text of [
    keycloakReadinessScript(),
    postgresReadinessSql(extensions),
    'db.adminCommand("ping").ok',
    'redis-cli -a "$SUBSTRATE_REDIS_PASSWORD" ping | grep PONG',
  ]) {
    validateDependencyReadinessText(text);
  }
}

async function runStatus(context: LifecycleContext, steps: LifecycleStepEvidence[]): Promise<SubstrateHealthSummary> {
  const result = await runDockerComposeStep(context, steps, 'compose-ps', [
    'ps',
    '--format',
    'json',
    ...SUBSTRATE_LIFECYCLE_SERVICES,
  ]);

  return {
    checked: true,
    services: parseComposePsJson(result.stdout),
  };
}

async function waitForHealthy(context: LifecycleContext, steps: LifecycleStepEvidence[]): Promise<SubstrateHealthSummary> {
  const attempts = parsePositiveInteger(context.env.SUBSTRATE_HEALTH_ATTEMPTS, 30, 'SUBSTRATE_HEALTH_ATTEMPTS');
  const intervalMs = parsePositiveInteger(
    context.env.SUBSTRATE_HEALTH_POLL_INTERVAL_MS,
    2000,
    'SUBSTRATE_HEALTH_POLL_INTERVAL_MS',
  );
  let lastHealth: SubstrateHealthSummary = { checked: false, services: {} };
  let lastFailures: CheckFailure[] = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastHealth = await runStatus(context, steps);
    lastFailures = healthCheckFailures(lastHealth);
    if (lastFailures.length === 0) {
      return lastHealth;
    }
    if (attempt < attempts) {
      await sleep(intervalMs);
    }
  }

  throw new SubstrateHealthCheckError(lastHealth, lastFailures);
}

async function runUp(context: LifecycleContext, steps: LifecycleStepEvidence[]): Promise<void> {
  await runDockerComposeStep(context, steps, 'compose-up', [
    'up',
    '-d',
    ...SUBSTRATE_LIFECYCLE_SERVICES,
  ]);
}

async function runDown(context: LifecycleContext, steps: LifecycleStepEvidence[], volumes = false): Promise<void> {
  await runDockerComposeStep(context, steps, volumes ? 'compose-down-volumes' : 'compose-down', [
    'down',
    ...(volumes ? ['-v'] : []),
  ]);
}

function reseedStepTimeoutMs(context: LifecycleContext): number {
  return parsePositiveInteger(
    context.env.SUBSTRATE_RESEED_STEP_TIMEOUT_MS,
    DEFAULT_RESEED_STEP_TIMEOUT_MS,
    'SUBSTRATE_RESEED_STEP_TIMEOUT_MS',
  );
}

async function runReseed(
  context: LifecycleContext,
  steps: LifecycleStepEvidence[],
  truthValues: Record<string, string>,
): Promise<ReseedSummary> {
  const summary = emptyReseedSummary(truthValues);
  summary.checked = true;
  summary.postgresql.extensions = requestedPostgresExtensions(context.env);
  validateReseedReadinessTemplates(summary.postgresql.extensions);
  const timeoutMs = reseedStepTimeoutMs(context);

  await runDockerComposeStep(context, steps, 'minio-bucket-readiness', ['run', '--rm', 'minio-init'], { timeoutMs });
  summary.minio.status = 'passed';

  await runDockerComposeStep(context, steps, 'keycloak-realm-client-readiness', [
    'exec',
    '-T',
    '-e',
    `SUBSTRATE_KEYCLOAK_REALM=${truthValues.SUBSTRATE_KEYCLOAK_REALM}`,
    '-e',
    `SUBSTRATE_KEYCLOAK_CLIENT_ID=${truthValues.SUBSTRATE_KEYCLOAK_CLIENT_ID}`,
    'keycloak',
    '/bin/sh',
    '-c',
    keycloakReadinessScript(),
  ], { timeoutMs });
  summary.keycloak.status = 'passed';

  await runDockerComposeStep(context, steps, 'postgresql-database-readiness', [
    'exec',
    '-T',
    'postgresql',
    '/bin/sh',
    '-c',
    `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c '${postgresReadinessSql(summary.postgresql.extensions)}'`,
  ], { timeoutMs });
  summary.postgresql.status = 'passed';

  await runDockerComposeStep(context, steps, 'mongodb-readiness', [
    'exec',
    '-T',
    'mongodb',
    'mongosh',
    '--quiet',
    '--eval',
    'db.adminCommand("ping").ok',
  ], { timeoutMs });
  summary.mongodb.status = 'passed';

  await runDockerComposeStep(context, steps, 'redis-readiness', [
    'exec',
    '-T',
    'redis',
    '/bin/sh',
    '-c',
    'redis-cli -a "$SUBSTRATE_REDIS_PASSWORD" ping | grep PONG',
  ], { timeoutMs });
  summary.redis.status = 'passed';

  return summary;
}

function lifecycleEvidenceBasename(command: SubstrateLifecycleCommand): string {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return `substrate-lifecycle-${command}-${timestamp}`;
}

function redactFailures(failures: readonly CheckFailure[]): CheckFailure[] {
  return failures.map((failure) => ({
    path: failure.path,
    message: redactSecretLikeText(failure.message),
  }));
}

function redactSecretLikeText(text: string): string {
  return text
    .split(/\s+/u)
    .map((token) => SECRET_KEY_PATTERN.test(token) ? '[REDACTED]' : token)
    .join(' ');
}

async function writeLifecycleEvidence(
  context: LifecycleContext,
  evidence: Omit<SubstrateLifecycleEvidence, 'paths'>,
): Promise<SubstrateLifecycleEvidence> {
  const evidenceDir = prepareUnifiedDeployEvidenceDir({
    evidenceDir: context.evidenceDir,
    defaultRoot: DEFAULT_SUBSTRATE_LIFECYCLE_EVIDENCE_DIR,
    env: context.env,
    label: 'substrate lifecycle evidenceDir',
  });
  const basename = lifecycleEvidenceBasename(context.command);
  const reportPath = path.join(evidenceDir, `${basename}.json`);
  const logPath = path.join(evidenceDir, `${basename}.log`);
  const withPaths: SubstrateLifecycleEvidence = {
    ...evidence,
    paths: {
      report_path: reportPath,
      log_path: logPath,
    },
  };

  await writeFile(reportPath, `${JSON.stringify(withPaths, null, 2)}\n`, 'utf8');
  await writeFile(
    logPath,
    [
      `producer=substrate-lifecycle`,
      `command=${context.command}`,
      `profile=${context.profile}`,
      `status=${evidence.status}`,
      `compose_project=${context.composeProject}`,
      `truth_fingerprint=${evidence.truth.redacted_fingerprint}`,
      `report_path=${reportPath}`,
      `failures=${evidence.failures.length}`,
    ].join('\n') + '\n',
    'utf8',
  );

  return withPaths;
}

function normalizeOptions(options: RunSubstrateLifecycleOptions): LifecycleContext {
  return {
    command: options.command,
    profile: options.profile ?? 'local-kind',
    composePath: resolvePath(options.composePath, DEFAULT_SUBSTRATE_COMPOSE_PATH),
    truthPath: resolvePath(options.truthPath, DEFAULT_SUBSTRATE_TRUTH_OUTPUT_PATH),
    composeProject: options.composeProject ?? DEFAULT_SUBSTRATE_COMPOSE_PROJECT,
    evidenceDir: resolvePath(options.evidenceDir, DEFAULT_SUBSTRATE_LIFECYCLE_EVIDENCE_DIR),
    env: withSubstrateInternalNoProxy(options.env ?? process.env),
    runner: options.runner ?? defaultCommandRunner,
    detectLocalKindHost: options.detectLocalKindHost ?? defaultDetectLocalKindHost,
  };
}

function validateLifecycleInputs(context: LifecycleContext, failures: CheckFailure[]): void {
  if (!isUnifiedDeployProfile(context.profile)) {
    failures.push({
      path: 'profile',
      message: `unknown unified deploy profile: ${context.profile}`,
    });
  }

  if (!existsSync(context.composePath)) {
    failures.push({
      path: context.composePath,
      message: 'Docker substrate compose file must exist',
    });
    return;
  }

  failures.push(...checkSubstrateComposeText(readFileSync(context.composePath, 'utf8'), context.composePath).failures);
}

function lifecycleEvidenceSkeleton(
  context: LifecycleContext,
  truth: ReturnType<typeof parseSubstrateTruth>,
  status: SubstrateLifecycleStatus,
  failures: CheckFailure[],
  steps: LifecycleStepEvidence[],
  health: SubstrateHealthSummary,
  runtimeTruth: SubstrateRuntimeTruthSummary,
  reseed: ReseedSummary,
): Omit<SubstrateLifecycleEvidence, 'paths'> {
  return {
    schema_version: 'agentsmith.unified-deploy.substrate-lifecycle.evidence/v1',
    command: context.command,
    profile: context.profile,
    compose_project: context.composeProject,
    status,
    generated_at: new Date().toISOString(),
    services: [...SUBSTRATE_LIFECYCLE_SERVICES],
    init_helpers: [...SUBSTRATE_LIFECYCLE_INIT_HELPERS],
    truth: {
      schema_version: truth.schema_version,
      path: context.truthPath,
      redacted_fingerprint: truth.redacted_fingerprint,
      redacted_values: redactedSubstrateTruthValues(truth.values),
    },
    health,
    runtime_truth: runtimeTruth,
    reseed,
    steps,
    failures: redactFailures(failures),
  };
}

function fallbackEvidenceTruth(truthPath: string): ReturnType<typeof parseSubstrateTruth> {
  return parseSubstrateTruth(buildSubstrateTruthText({
    profile: 'existing-cluster',
    env: {
      SUBSTRATE_HOST: '192.0.2.1',
      SUBSTRATE_POSTGRES_PASSWORD: 'unavailable',
      SUBSTRATE_MONGODB_PASSWORD: 'unavailable',
      SUBSTRATE_REDIS_PASSWORD: 'unavailable',
      SUBSTRATE_MINIO_SECRET_KEY: 'unavailable',
      SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD: 'unavailable',
    },
  }), { sourcePath: truthPath });
}

export async function runSubstrateLifecycle(options: RunSubstrateLifecycleOptions): Promise<SubstrateLifecycleEvidence> {
  const context = normalizeOptions(options);
  const steps: LifecycleStepEvidence[] = [];
  const failures: CheckFailure[] = [];
  let health: SubstrateHealthSummary = { checked: false, services: {} };
  let runtimeTruth = skippedSubstrateRuntimeTruthSummary(context.composeProject);
  let truth = fallbackEvidenceTruth(context.truthPath);
  let reseed = emptyReseedSummary(truth.values);

  try {
    validateLifecycleInputs(context, failures);
    if (failures.length > 0) {
      throw new Error(failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n'));
    }

    truth = (await writeValidatedTruthFile(context)).parsed;
    reseed = emptyReseedSummary(truth.values);

    if (context.command === 'up') {
      await runUp(context, steps);
      health = await waitForHealthy(context, steps);
      runtimeTruth = await checkSubstrateRuntimeTruth({
        truthValues: truth.values,
        composeProject: context.composeProject,
        runner: context.runner,
        env: context.env,
      });
      assertDockerSubstrateLiveTruth(health, runtimeTruth);
    } else if (context.command === 'down') {
      await runDown(context, steps);
    } else if (context.command === 'reset') {
      await runDown(context, steps, true);
      await runUp(context, steps);
      health = await waitForHealthy(context, steps);
      reseed = await runReseed(context, steps, truth.values);
      health = await waitForHealthy(context, steps);
      runtimeTruth = await checkSubstrateRuntimeTruth({
        truthValues: truth.values,
        composeProject: context.composeProject,
        runner: context.runner,
        env: context.env,
      });
      assertDockerSubstrateLiveTruth(health, runtimeTruth);
    } else if (context.command === 'reseed') {
      health = await waitForHealthy(context, steps);
      reseed = await runReseed(context, steps, truth.values);
      health = await waitForHealthy(context, steps);
    } else {
      health = await runStatus(context, steps);
      runtimeTruth = await checkSubstrateRuntimeTruth({
        truthValues: truth.values,
        composeProject: context.composeProject,
        runner: context.runner,
        env: context.env,
      });
      assertDockerSubstrateLiveTruth(health, runtimeTruth);
    }

    return await writeLifecycleEvidence(
      context,
      lifecycleEvidenceSkeleton(context, truth, 'passed', failures, steps, health, runtimeTruth, reseed),
    );
  } catch (error) {
    if (error instanceof SubstrateHealthCheckError) {
      health = error.health;
      failures.push(...error.failures);
    } else if (error instanceof SubstrateLiveTruthCheckError) {
      health = error.health;
      runtimeTruth = error.runtimeTruth;
      failures.push(...error.failures);
    }
    failures.push({
      path: `substrate-lifecycle:${context.command}`,
      message: error instanceof Error ? error.message : String(error),
    });

    return await writeLifecycleEvidence(
      context,
      lifecycleEvidenceSkeleton(context, truth, 'failed', failures, steps, health, runtimeTruth, reseed),
    );
  }
}

type CliOptions = {
  command?: SubstrateLifecycleCommand;
  profile?: UnifiedDeployProfile;
  composePath?: string;
  truthPath?: string;
  composeProject?: string;
  evidenceDir?: string;
};

function isSubstrateLifecycleCommand(value: string): value is SubstrateLifecycleCommand {
  return value === 'up' || value === 'down' || value === 'reset' || value === 'reseed' || value === 'status';
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};

  for (const arg of argv) {
    if (isSubstrateLifecycleCommand(arg)) {
      if (options.command) {
        throw new Error(`multiple lifecycle commands provided: ${options.command}, ${arg}`);
      }
      options.command = arg;
      continue;
    }
    if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length);
      if (!isUnifiedDeployProfile(value)) {
        throw new Error(`unknown --profile value: ${value}`);
      }
      options.profile = value;
      continue;
    }
    if (arg.startsWith('--compose=')) {
      options.composePath = arg.slice('--compose='.length);
      continue;
    }
    if (arg.startsWith('--substrate-truth=')) {
      options.truthPath = arg.slice('--substrate-truth='.length);
      continue;
    }
    if (arg.startsWith('--truth=')) {
      options.truthPath = arg.slice('--truth='.length);
      continue;
    }
    if (arg.startsWith('--project=')) {
      options.composeProject = arg.slice('--project='.length);
      continue;
    }
    if (arg.startsWith('--evidence-dir=')) {
      options.evidenceDir = arg.slice('--evidence-dir='.length);
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.command) {
    throw new Error('missing substrate lifecycle command: expected up, down, reset, reseed, or status');
  }

  return options;
}

async function main(): Promise<void> {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const evidence = await runSubstrateLifecycle({
    command: cliOptions.command ?? 'status',
    profile: cliOptions.profile,
    composePath: cliOptions.composePath,
    truthPath: cliOptions.truthPath,
    composeProject: cliOptions.composeProject,
    evidenceDir: cliOptions.evidenceDir,
  });
  const message = `[unified-deploy] substrate lifecycle ${evidence.command} ${evidence.status}\n[unified-deploy] evidence: ${evidence.paths.report_path}\n`;

  if (evidence.status === 'passed') {
    process.stdout.write(message);
    return;
  }

  process.stderr.write(message);
  for (const failure of evidence.failures) {
    process.stderr.write(`${failure.path}: ${failure.message}\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
