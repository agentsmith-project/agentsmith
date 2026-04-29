import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DOCKER_AVAILABILITY_FLAG_ENV_KEYS,
  DOCKER_IDENTITY_ENV_KEYS,
  INTERNAL_EXECUTION_WS_ENV_KEYS,
  KEYCLOAK_REDIRECT_BASE_ENV_KEYS,
  KIND_AVAILABILITY_FLAG_ENV_KEYS,
  KIND_IDENTITY_ENV_KEYS,
  PROVIDER_PROFILE_ENV_KEYS,
  PROXY_DATA_TOKEN_ENV_KEYS,
  REGISTRY_AVAILABILITY_FLAG_ENV_KEYS,
  REGISTRY_IDENTITY_ENV_KEYS,
  SECRET_PROFILE_ENV_KEYS,
  TICKET_AUTH_ENV_KEYS,
  buildRedactedDiagnostic,
  type RedactedGovernanceDiagnostic,
  type RedactionEnv,
} from './redaction';

export const ORDERED_SENTINEL_PROBES = [
  'internal_execution_ws_base_url_correct',
  'proxy_data_token_absent',
  'ticket_auth_present',
  'keycloak_redirect_bases_present',
  'dns_gateway_reachable',
  'provider_profile_present',
  'secret_profile_present',
  'kind_available',
  'registry_available',
  'docker_available',
] as const;

export type SentinelProbeName = typeof ORDERED_SENTINEL_PROBES[number];
export type SentinelProfile =
  | 'release-ready'
  | 'verify-real'
  | 'verify-release-real'
  | 'demo-rehearsal'
  | 'cluster-rehearsal';
export type SentinelProbeDisposition = 'required' | 'advisory';

export const DEFAULT_SENTINEL_PROFILE = 'release-ready' as const satisfies SentinelProfile;

export const SENTINEL_PROFILE_PROBE_MATRIX = {
  'release-ready': {
    internal_execution_ws_base_url_correct: 'advisory',
    proxy_data_token_absent: 'advisory',
    ticket_auth_present: 'advisory',
    keycloak_redirect_bases_present: 'required',
    dns_gateway_reachable: 'advisory',
    provider_profile_present: 'required',
    secret_profile_present: 'required',
    kind_available: 'advisory',
    registry_available: 'advisory',
    docker_available: 'advisory',
  },
  'verify-real': {
    internal_execution_ws_base_url_correct: 'advisory',
    proxy_data_token_absent: 'advisory',
    ticket_auth_present: 'advisory',
    keycloak_redirect_bases_present: 'required',
    dns_gateway_reachable: 'advisory',
    provider_profile_present: 'required',
    secret_profile_present: 'required',
    kind_available: 'advisory',
    registry_available: 'advisory',
    docker_available: 'advisory',
  },
  'verify-release-real': {
    internal_execution_ws_base_url_correct: 'advisory',
    proxy_data_token_absent: 'advisory',
    ticket_auth_present: 'advisory',
    keycloak_redirect_bases_present: 'required',
    dns_gateway_reachable: 'advisory',
    provider_profile_present: 'required',
    secret_profile_present: 'required',
    kind_available: 'advisory',
    registry_available: 'advisory',
    docker_available: 'advisory',
  },
  'demo-rehearsal': {
    internal_execution_ws_base_url_correct: 'advisory',
    proxy_data_token_absent: 'advisory',
    ticket_auth_present: 'advisory',
    keycloak_redirect_bases_present: 'required',
    dns_gateway_reachable: 'advisory',
    provider_profile_present: 'required',
    secret_profile_present: 'required',
    kind_available: 'required',
    registry_available: 'required',
    docker_available: 'advisory',
  },
  'cluster-rehearsal': {
    internal_execution_ws_base_url_correct: 'advisory',
    proxy_data_token_absent: 'advisory',
    ticket_auth_present: 'advisory',
    keycloak_redirect_bases_present: 'required',
    dns_gateway_reachable: 'advisory',
    provider_profile_present: 'required',
    secret_profile_present: 'required',
    kind_available: 'required',
    registry_available: 'required',
    docker_available: 'advisory',
  },
} as const satisfies Record<SentinelProfile, Record<SentinelProbeName, SentinelProbeDisposition>>;

function requiredProbesForProfile(profile: SentinelProfile): SentinelProbeName[] {
  return ORDERED_SENTINEL_PROBES.filter((name) => (
    SENTINEL_PROFILE_PROBE_MATRIX[profile][name] === 'required'
  ));
}

export const SENTINEL_PROFILE_PROBES = {
  'release-ready': requiredProbesForProfile('release-ready'),
  'verify-real': requiredProbesForProfile('verify-real'),
  'verify-release-real': requiredProbesForProfile('verify-release-real'),
  'demo-rehearsal': requiredProbesForProfile('demo-rehearsal'),
  'cluster-rehearsal': requiredProbesForProfile('cluster-rehearsal'),
} satisfies Record<SentinelProfile, readonly SentinelProbeName[]>;

export const SENTINEL_PROFILE_ENV_FILES = {
  'release-ready': [
    'infra/runtime/presets.env',
    'infra/runtime/backend-real.env',
    '.env.backend-real',
  ],
  'verify-real': [
    'infra/runtime/presets.env',
    'infra/runtime/backend-real.env',
    '.env.backend-real',
  ],
  'verify-release-real': [
    'infra/runtime/presets.env',
    'infra/runtime/backend-real.env',
    '.env.backend-real',
  ],
  'demo-rehearsal': [
    'infra/runtime/presets.env',
    '.env.backend-real',
    'infra/flows/demo-rehearsal.env',
    'artifacts/runtime/scenario/demo-rehearsal/config/site.env',
    'artifacts/runtime/scenario/demo-rehearsal/config/registry.env',
  ],
  'cluster-rehearsal': [
    'infra/runtime/presets.env',
    '.env.backend-real',
    'infra/flows/cluster-rehearsal.env',
    'artifacts/runtime/scenario/cluster-rehearsal/config/site.env',
    'artifacts/runtime/scenario/cluster-rehearsal/config/registry.env',
    'env/registry.env',
  ],
} as const satisfies Record<SentinelProfile, readonly string[]>;

export type SentinelProbeContext = {
  env: RedactionEnv;
};

export type SentinelProbe = (context: SentinelProbeContext) => boolean | Promise<boolean>;

export type SentinelPreflightInput = {
  env?: RedactionEnv;
  profile?: SentinelProfile | string;
  probes?: Partial<Record<SentinelProbeName, SentinelProbe>>;
};

export type SentinelEnvHydrationInput = {
  profile: SentinelProfile;
  env?: RedactionEnv;
  cwd?: string;
  envFiles?: readonly string[];
};

export type SentinelPreflightResult = {
  exitCode: 0 | 1;
  output: RedactedGovernanceDiagnostic;
};

export type SentinelPreflightCliStreams = {
  stdout: {
    write(chunk: string): unknown;
  };
  stderr: {
    write(chunk: string): unknown;
  };
};

class SentinelUnknownProfileError extends Error {
  constructor() {
    super('unknown sentinel profile');
    this.name = 'SentinelUnknownProfileError';
  }
}

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

function hasAnyEnv(env: RedactionEnv, keys: readonly string[]): boolean {
  return keys.some((key) => Boolean(normalizeEnvValue(env[key])?.trim()));
}

function truthyEnv(env: RedactionEnv, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const value = normalizeEnvValue(env[key])?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'available';
  });
}

function availabilityEnv(env: RedactionEnv, flagKeys: readonly string[], identityKeys: readonly string[]): boolean {
  let hasFlag = false;
  let hasTruthyFlag = false;

  for (const key of flagKeys) {
    const value = normalizeEnvValue(env[key])?.trim().toLowerCase();
    if (!value) {
      continue;
    }
    hasFlag = true;
    if (value === '1' || value === 'true' || value === 'yes' || value === 'available') {
      hasTruthyFlag = true;
    } else {
      return false;
    }
  }

  return hasFlag ? hasTruthyFlag : hasAnyEnv(env, identityKeys);
}

function firstEnv(env: RedactionEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeEnvValue(env[key])?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function internalExecutionWsBaseUrlCorrect(env: RedactionEnv): boolean {
  const value = firstEnv(env, INTERNAL_EXECUTION_WS_ENV_KEYS);
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'ws:' || url.protocol === 'wss:')
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
    );
  } catch {
    return false;
  }
}

const DEFAULT_SENTINEL_PROBES: Record<SentinelProbeName, SentinelProbe> = {
  internal_execution_ws_base_url_correct: ({ env }) => internalExecutionWsBaseUrlCorrect(env),
  proxy_data_token_absent: ({ env }) => !hasAnyEnv(env, PROXY_DATA_TOKEN_ENV_KEYS),
  ticket_auth_present: ({ env }) => hasAnyEnv(env, TICKET_AUTH_ENV_KEYS),
  keycloak_redirect_bases_present: ({ env }) => hasAnyEnv(env, KEYCLOAK_REDIRECT_BASE_ENV_KEYS),
  dns_gateway_reachable: ({ env }) => truthyEnv(env, ['DNS_GATEWAY_REACHABLE', 'GATEWAY_REACHABLE']),
  provider_profile_present: ({ env }) => hasAnyEnv(env, PROVIDER_PROFILE_ENV_KEYS),
  secret_profile_present: ({ env }) => hasAnyEnv(env, SECRET_PROFILE_ENV_KEYS),
  kind_available: ({ env }) => availabilityEnv(env, KIND_AVAILABILITY_FLAG_ENV_KEYS, KIND_IDENTITY_ENV_KEYS),
  registry_available: ({ env }) => availabilityEnv(env, REGISTRY_AVAILABILITY_FLAG_ENV_KEYS, REGISTRY_IDENTITY_ENV_KEYS),
  docker_available: ({ env }) => availabilityEnv(env, DOCKER_AVAILABILITY_FLAG_ENV_KEYS, DOCKER_IDENTITY_ENV_KEYS),
};

function isSentinelProfile(value: string): value is SentinelProfile {
  return Object.hasOwn(SENTINEL_PROFILE_PROBE_MATRIX, value);
}

function resolveSentinelProfile(value: SentinelPreflightInput['profile']): SentinelProfile {
  if (value === undefined) {
    return DEFAULT_SENTINEL_PROFILE;
  }
  if (isSentinelProfile(value)) {
    return value;
  }
  throw new SentinelUnknownProfileError();
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof (value as { then: unknown }).then === 'function';
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
  const rawValue = withoutExport.slice(separatorIndex + 1).trim();
  return [key, unquoteEnvValue(rawValue)];
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

function parseEnvFile(path: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const content = readFileSync(path, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (entry) {
      parsed[entry[0]] = entry[1];
    }
  }
  return parsed;
}

function mergePresentEnv(target: Record<string, string>, source: RedactionEnv): void {
  for (const [key, value] of Object.entries(source)) {
    const normalized = normalizeEnvValue(value);
    if (normalized?.trim()) {
      target[key] = normalized;
    }
  }
}

function setIfMissing(target: Record<string, string>, key: string, value: string | undefined): void {
  if (!target[key]?.trim() && value?.trim()) {
    target[key] = value;
  }
}

function deriveSentinelEnvAliases(env: Record<string, string>): void {
  setIfMissing(env, 'BASE_URL', env.FLOW_SITE_ENV_PUBLIC_WEB_BASE_URL);
  setIfMissing(env, 'NEXT_PUBLIC_API_BASE', env.FLOW_SITE_ENV_PUBLIC_API_BASE_URL);
  if (!env.NEXT_PUBLIC_API_BASE?.trim() && env.INTEGRATION_API_PORT?.trim()) {
    env.NEXT_PUBLIC_API_BASE = `http://localhost:${env.INTEGRATION_API_PORT}/api/v1`;
  }
  if (!env.BASE_URL?.trim() && env.INTEGRATION_WEB_PORT?.trim()) {
    env.BASE_URL = `http://localhost:${env.INTEGRATION_WEB_PORT}`;
  }
  setIfMissing(env, 'KEYCLOAK_REDIRECT_BASE_URL', env.BASE_URL);
}

export function buildSentinelPreflightEnv(input: SentinelEnvHydrationInput): RedactionEnv {
  const env = input.env ?? process.env;
  const root = resolve(
    normalizeEnvValue(env.AGENTSMITH_SENTINEL_ENV_ROOT)?.trim()
      || normalizeEnvValue(env.SENTINEL_ENV_ROOT)?.trim()
      || input.cwd
      || process.cwd(),
  );
  const hydrated: Record<string, string> = {};
  for (const envFile of input.envFiles ?? SENTINEL_PROFILE_ENV_FILES[input.profile]) {
    const envPath = resolve(root, envFile);
    if (existsSync(envPath)) {
      mergePresentEnv(hydrated, parseEnvFile(envPath));
    }
  }
  mergePresentEnv(hydrated, env);
  deriveSentinelEnvAliases(hydrated);
  return hydrated;
}

export async function runSentinelPreflight(input: SentinelPreflightInput = {}): Promise<SentinelPreflightResult> {
  const env = input.env ?? process.env;
  const profile = resolveSentinelProfile(input.profile);
  const probePresence: Record<string, boolean> = {};
  let exitCode: 0 | 1 = 0;

  for (const name of ORDERED_SENTINEL_PROBES) {
    const probe = input.probes?.[name] ?? DEFAULT_SENTINEL_PROBES[name];
    let passed = false;
    try {
      passed = await Promise.resolve(probe({ env }));
    } catch {
      passed = false;
    }
    probePresence[`probe.${name}`] = passed;

    if (!passed && SENTINEL_PROFILE_PROBE_MATRIX[profile][name] === 'required') {
      exitCode = 1;
    }
  }

  return {
    exitCode,
    output: buildRedactedDiagnostic({
      env,
      additionalPresence: probePresence,
    }),
  };
}

export function runSentinelPreflightSync(input: SentinelPreflightInput = {}): SentinelPreflightResult {
  const env = input.env ?? process.env;
  const profile = resolveSentinelProfile(input.profile);
  const probePresence: Record<string, boolean> = {};
  let exitCode: 0 | 1 = 0;

  for (const name of ORDERED_SENTINEL_PROBES) {
    const probe = input.probes?.[name] ?? DEFAULT_SENTINEL_PROBES[name];
    let passed = false;
    try {
      const value = probe({ env });
      passed = isPromiseLike(value) ? false : Boolean(value);
    } catch {
      passed = false;
    }
    probePresence[`probe.${name}`] = passed;

    if (!passed && SENTINEL_PROFILE_PROBE_MATRIX[profile][name] === 'required') {
      exitCode = 1;
    }
  }

  return {
    exitCode,
    output: buildRedactedDiagnostic({
      env,
      additionalPresence: probePresence,
    }),
  };
}

export function renderSentinelPreflightOutput(output: RedactedGovernanceDiagnostic): string {
  return `${JSON.stringify(output, null, 2)}\n`;
}

export async function runSentinelPreflightCli(
  input: SentinelPreflightInput = {},
  streams: SentinelPreflightCliStreams = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<number> {
  try {
    const result = await runSentinelPreflight(input);
    streams.stdout.write(renderSentinelPreflightOutput(result.output));
    return result.exitCode;
  } catch (error) {
    if (error instanceof SentinelUnknownProfileError) {
      streams.stderr.write('[sentinel-preflight] unknown profile\n');
      return 1;
    }
    streams.stderr.write('[sentinel-preflight] diagnostic unavailable\n');
    return 1;
  }
}

if (isCliEntrypoint('sentinel-preflight.ts')) {
  runSentinelPreflightCli()
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch(() => {
      process.stderr.write('[sentinel-preflight] diagnostic unavailable\n');
      process.exit(1);
    });
}
