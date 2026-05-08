import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CheckFailure, CheckResult } from './manifest';
import { substrateKeycloakInternalBaseUrl } from './substrate-address-roles';

export const SUBSTRATE_TRUTH_SCHEMA_VERSION = 'agentsmith.docker-substrate.truth/v1';
export const SUBSTRATE_TRUTH_SCHEMA_ENV_KEY = 'SUBSTRATE_TRUTH_SCHEMA_VERSION';
export const DOCKER_SUBSTRATE_REQUIRED_ENV = [
  'SUBSTRATE_POSTGRES_HOST',
  'SUBSTRATE_POSTGRES_PORT',
  'SUBSTRATE_POSTGRES_DATABASE',
  'SUBSTRATE_POSTGRES_USER',
  'SUBSTRATE_POSTGRES_PASSWORD',
  'SUBSTRATE_MONGODB_HOST',
  'SUBSTRATE_MONGODB_PORT',
  'SUBSTRATE_MONGODB_DATABASE',
  'SUBSTRATE_MONGODB_USER',
  'SUBSTRATE_MONGODB_PASSWORD',
  'SUBSTRATE_REDIS_HOST',
  'SUBSTRATE_REDIS_PORT',
  'SUBSTRATE_REDIS_PASSWORD',
  'SUBSTRATE_MINIO_HOST',
  'SUBSTRATE_MINIO_PORT',
  'SUBSTRATE_MINIO_ACCESS_KEY',
  'SUBSTRATE_MINIO_SECRET_KEY',
  'SUBSTRATE_MINIO_BUCKET',
  'SUBSTRATE_KEYCLOAK_HOST',
  'SUBSTRATE_KEYCLOAK_PORT',
  'SUBSTRATE_KEYCLOAK_PUBLIC_ISSUER',
  'SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL',
  'SUBSTRATE_KEYCLOAK_REALM',
  'SUBSTRATE_KEYCLOAK_CLIENT_ID',
  'SUBSTRATE_KEYCLOAK_ADMIN',
  'SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD',
] as const;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_SUBSTRATE_TRUTH_PATH = path.join(
  REPO_ROOT,
  'infra',
  'deploy',
  'unified',
  'substrate',
  'connection.env.example',
);
export const DEFAULT_LIVE_SUBSTRATE_TRUTH_PATH = path.join(
  REPO_ROOT,
  'infra',
  'deploy',
  'unified',
  'substrate',
  'connection.env',
);

export type ParsedSubstrateTruth = {
  schema_version: typeof SUBSTRATE_TRUTH_SCHEMA_VERSION;
  values: Record<string, string>;
  redacted_values: Record<string, string>;
  redacted_fingerprint: string;
};

export type SubstrateTruthValidationResult = CheckResult & {
  truth?: ParsedSubstrateTruth;
};

type SubstrateTruthOptions = {
  sourcePath?: string;
  requiredEnv?: readonly string[];
};

const SECRET_KEY_PATTERN = /(?:PASSWORD|SECRET|TOKEN|PRIVATE|ACCESS[_-]?KEY|API[_-]?KEY|CREDENTIAL|DATABASE_URL|MONGO_URL|MONGODB_URI|REDIS_URL|CLIENT_SECRET|AUTHORIZATION)/iu;
const FORBIDDEN_KEY_PATTERNS = [/^LLMUP_/u, /^UNIVERSAL_PROXY_/u, /^MBOS_UNIVERSAL_PROXY_/u];
const APP_OWNED_TRUTH_KEYS = new Set([
  'SANDBOX_SERVICE_KEY',
  'SANDBOX_MANAGER_URL',
  'AGENT_EXECUTION_HTTP_BASE_URL',
  'AGENT_EXECUTION_WS_BASE_URL',
  'INTERNAL_API_BASE_URL',
  'PUBLIC_API_BASE_URL',
  'RUNNER_PUBLIC_API_BASE_URL',
]);
const FORBIDDEN_VALUE_PATTERN = /\b(?:llmup|universal[-_]?proxy|mbos[_-]?universal[_-]?proxy)\b/iu;
const NUMERIC_TRUTH_KEYS = new Set([
  'SUBSTRATE_POSTGRES_PORT',
  'SUBSTRATE_MONGODB_PORT',
  'SUBSTRATE_REDIS_PORT',
  'SUBSTRATE_MINIO_PORT',
  'SUBSTRATE_KEYCLOAK_PORT',
]);
const SUBSTRATE_HOST_KEYS = new Set([
  'SUBSTRATE_POSTGRES_HOST',
  'SUBSTRATE_MONGODB_HOST',
  'SUBSTRATE_REDIS_HOST',
  'SUBSTRATE_MINIO_HOST',
  'SUBSTRATE_KEYCLOAK_HOST',
]);

function addFailure(failures: CheckFailure[], sourcePath: string, message: string): void {
  failures.push({ path: sourcePath, message });
}

function stripEnvQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/gu, '"').replace(/\\\\/gu, '\\');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvText(source: string, sourcePath: string): {
  values: Record<string, string>;
  failures: CheckFailure[];
} {
  const values: Record<string, string> = {};
  const failures: CheckFailure[] = [];
  const lines = source.split(/\r?\n/u);

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) {
      return;
    }

    const normalizedLine = trimmedLine.startsWith('export ') ? trimmedLine.slice('export '.length).trim() : trimmedLine;
    const separatorIndex = normalizedLine.indexOf('=');
    if (separatorIndex <= 0) {
      addFailure(failures, sourcePath, `invalid env line ${index + 1}: expected KEY=value`);
      return;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    const rawValue = normalizedLine.slice(separatorIndex + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
      addFailure(failures, sourcePath, `invalid env key on line ${index + 1}: ${key}`);
      return;
    }

    const value = stripEnvQuotes(rawValue);
    if (value.includes('\n')) {
      addFailure(failures, sourcePath, `invalid env value for ${key}: multiline values are not supported`);
      return;
    }
    values[key] = value;
  });

  return { values, failures };
}

function requiredSubstrateEnv(options: SubstrateTruthOptions): readonly string[] {
  return Array.from(new Set([...DOCKER_SUBSTRATE_REQUIRED_ENV, ...(options.requiredEnv ?? [])]));
}

function allowedSubstrateTruthKeys(options: SubstrateTruthOptions): ReadonlySet<string> {
  return new Set([SUBSTRATE_TRUTH_SCHEMA_ENV_KEY, ...requiredSubstrateEnv(options)]);
}

function isForbiddenKey(key: string, allowedKeys: ReadonlySet<string>): boolean {
  return (
    APP_OWNED_TRUTH_KEYS.has(key) ||
    FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key)) ||
    !allowedKeys.has(key)
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJson(nestedValue)]),
    );
  }

  return value;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function redactedSubstrateTruthValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : value,
      ]),
  );
}

export function redactedSubstrateTruthFingerprint(values: Record<string, string>): string {
  return sha256(canonicalJson(redactedSubstrateTruthValues(values)));
}

function buildParsedTruth(values: Record<string, string>): ParsedSubstrateTruth {
  const redactedValues = redactedSubstrateTruthValues(values);
  return {
    schema_version: SUBSTRATE_TRUTH_SCHEMA_VERSION,
    values,
    redacted_values: redactedValues,
    redacted_fingerprint: sha256(canonicalJson(redactedValues)),
  };
}

function validateKeycloakInternalBase(values: Record<string, string>, failures: CheckFailure[], sourcePath: string): void {
  const internalBase = values.SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL;
  if (!internalBase) {
    return;
  }

  const expected = substrateKeycloakInternalBaseUrl();
  if (internalBase !== expected) {
    addFailure(
      failures,
      sourcePath,
      `SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL must be ${expected} for the Kubernetes Service/native Keycloak address`,
    );
  }
}

export function validateSubstrateTruthText(
  source: string,
  options: SubstrateTruthOptions = {},
): SubstrateTruthValidationResult {
  const sourcePath = options.sourcePath ?? DEFAULT_SUBSTRATE_TRUTH_PATH;
  const parsed = parseEnvText(source, sourcePath);
  const failures = [...parsed.failures];
  const values = parsed.values;
  const allowedKeys = allowedSubstrateTruthKeys(options);

  if (values[SUBSTRATE_TRUTH_SCHEMA_ENV_KEY] !== SUBSTRATE_TRUTH_SCHEMA_VERSION) {
    addFailure(
      failures,
      sourcePath,
      `${SUBSTRATE_TRUTH_SCHEMA_ENV_KEY} must be ${SUBSTRATE_TRUTH_SCHEMA_VERSION}`,
    );
  }

  const missing = requiredSubstrateEnv(options).filter((key) => !values[key]);
  if (missing.length > 0) {
    addFailure(failures, sourcePath, `missing Docker substrate truth values: ${missing.join(', ')}`);
  }

  for (const [key, value] of Object.entries(values)) {
    if (isForbiddenKey(key, allowedKeys)) {
      addFailure(failures, sourcePath, `${key} is not allowed in Docker substrate truth`);
    }
    if (FORBIDDEN_VALUE_PATTERN.test(value)) {
      addFailure(failures, sourcePath, `${key} value must not reference llmup or universal-proxy`);
    }
    if (NUMERIC_TRUTH_KEYS.has(key) && !/^\d+$/u.test(value)) {
      addFailure(failures, sourcePath, `${key} must be numeric`);
    }
    if (SUBSTRATE_HOST_KEYS.has(key) && isIP(value.trim()) === 0) {
      addFailure(
        failures,
        sourcePath,
        `${key} substrate binding host must be an IPv4 or IPv6 address; FQDN hosts are not supported by v1 selectorless Service EndpointSlice binding`,
      );
    }
    if (value.includes('"')) {
      addFailure(failures, sourcePath, `${key} contains a double quote; template-safe env values are required`);
    }
  }
  validateKeycloakInternalBase(values, failures, sourcePath);

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  return {
    ok: true,
    failures: [],
    truth: buildParsedTruth(values),
  };
}

export function parseSubstrateTruth(source: string, options: SubstrateTruthOptions = {}): ParsedSubstrateTruth {
  const result = validateSubstrateTruthText(source, options);
  if (!result.ok || !result.truth) {
    throw new Error(result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n'));
  }

  return result.truth;
}

export async function loadSubstrateTruthFromFile(
  truthPath = DEFAULT_SUBSTRATE_TRUTH_PATH,
  options: Omit<SubstrateTruthOptions, 'sourcePath'> = {},
): Promise<ParsedSubstrateTruth> {
  const source = await readFile(truthPath, 'utf8');
  return parseSubstrateTruth(source, { ...options, sourcePath: truthPath });
}
