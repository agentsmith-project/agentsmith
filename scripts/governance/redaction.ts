import { createHash } from 'node:crypto';

export type RedactionEnv = Readonly<Record<string, unknown>>;

export type RedactedGovernanceDiagnostic = {
  presence: Record<string, boolean>;
  profile_digest: string;
  public_endpoint: string | null;
  port_family: string;
};

type PresenceGroup = {
  label: string;
  keys: readonly string[];
};

export type BuildRedactedDiagnosticInput = {
  env: RedactionEnv;
  additionalPresence?: Readonly<Record<string, boolean>>;
  endpointKeys?: readonly string[];
  profileKeys?: readonly string[];
};

export type BuildRedactedFailureBundleInput = BuildRedactedDiagnosticInput;

const DEFAULT_ENDPOINT_KEYS = [
  'NEXT_PUBLIC_API_BASE',
  'NEXT_PUBLIC_APP_URL',
  'PLAYWRIGHT_BASE_URL',
  'BASE_URL',
  'KEYCLOAK_REDIRECT_BASE_URL',
  'NEXT_PUBLIC_KEYCLOAK_URL',
] as const;

const DEFAULT_PROFILE_KEYS = [
  'AUTHORIZATION',
  'BEARER_TOKEN',
  'COOKIE',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'API_KEY',
  'LEGACY_API_KEY',
  'ACCESS_TOKEN',
  'REFRESH_TOKEN',
  'OAUTH_TOKEN',
  'CLIENT_SECRET',
  'PASSWORD',
  'DATABASE_PASSWORD',
  'RUNNER_TICKET',
  'TASK_TICKET',
  'PROXY_DATA_TOKEN',
  'MBOS_PROXY_DATA_TOKEN',
  'MANAGED_CREDENTIALS',
  'MANAGED_CREDENTIALS_FEISHU',
] as const;

const DEFAULT_PRESENCE_GROUPS: readonly PresenceGroup[] = [
  { label: 'endpoint.public', keys: DEFAULT_ENDPOINT_KEYS },
  { label: 'endpoint.internal_ws', keys: ['INTERNAL_EXECUTION_WS_BASE_URL', 'EXECUTION_WS_BASE_URL'] },
  { label: 'auth.proxy_data_token', keys: ['PROXY_DATA_TOKEN', 'MBOS_PROXY_DATA_TOKEN', 'DATA_PROXY_TOKEN'] },
  { label: 'auth.ticket', keys: ['RUNNER_TICKET', 'TASK_TICKET', 'AGENTSMITH_TICKET', 'MBOS_TICKET'] },
  { label: 'auth.authorization', keys: ['AUTHORIZATION'] },
  { label: 'auth.cookie', keys: ['COOKIE'] },
  {
    label: 'profile.provider',
    keys: ['PROVIDER_PROFILE', 'LLM_PROVIDER_PROFILE', 'MODEL_PROVIDER_PROFILE', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY'],
  },
  {
    label: 'profile.secret',
    keys: ['SECRET_PROFILE', 'SECRET_PROFILE_PATH', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'MANAGED_CREDENTIALS'],
  },
  { label: 'profile.managed_credentials', keys: ['MANAGED_CREDENTIALS', 'MANAGED_CREDENTIALS_FEISHU'] },
  { label: 'keycloak.redirect_base', keys: ['KEYCLOAK_REDIRECT_BASE_URL', 'NEXT_PUBLIC_APP_URL', 'BASE_URL'] },
  { label: 'tool.kind', keys: ['KIND_AVAILABLE', 'KIND_CLUSTER_NAME'] },
  { label: 'tool.registry', keys: ['REGISTRY_AVAILABLE', 'REGISTRY_HOST', 'REGISTRY_PROJECT'] },
  { label: 'tool.docker', keys: ['DOCKER_AVAILABLE', 'DOCKER_HOST'] },
] as const;

const SAFE_ADDITIONAL_PRESENCE_LABELS = new Set<string>([
  'probe.internal_execution_ws_base_url_correct',
  'probe.proxy_data_token_present',
  'probe.ticket_auth_present',
  'probe.keycloak_redirect_bases_present',
  'probe.dns_gateway_reachable',
  'probe.provider_profile_present',
  'probe.secret_profile_present',
  'probe.kind_available',
  'probe.registry_available',
  'probe.docker_available',
]);

const SECRET_KEY_PATTERNS = [
  /authorization/i,
  /cookie/i,
  /bearer/i,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /oauth/i,
  /client[_-]?secret/i,
  /password/i,
  /ticket/i,
  /managed[_-]?credentials?/i,
] as const;

const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{6,}/i,
  /\bapi[_-]?key\s*[:=]\s*[^"',\s}]+/i,
  /\baccess[_-]?token\s*[:=]\s*[^"',\s}]+/i,
  /\brefresh[_-]?token\s*[:=]\s*[^"',\s}]+/i,
  /\boauth(?:[_-]?token)?\s*[:=]\s*[^"',\s}]+/i,
  /\bclient[_-]?secret\s*[:=]\s*[^"',\s}]+/i,
  /\bpassword\s*[:=]\s*[^"',\s}]+/i,
  /\bticket\s*[:=]\s*[^"',\s}]+/i,
  /\bmanaged[_-]?credentials?\s*[:=]\s*[^"',\s}]+/i,
  /\bCookie\s*[:=]\s*[^"',\n}]+/i,
  /\bAuthorization\s*[:=]\s*[^"',\n}]+/i,
] as const;

function normalizeEnvValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function hasEnvValue(env: RedactionEnv, key: string): boolean {
  const value = normalizeEnvValue(env[key]);
  return Boolean(value?.trim());
}

function firstEnvValue(env: RedactionEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeEnvValue(env[key])?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function sortBooleanRecord(values: Readonly<Record<string, boolean>>): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, Boolean(value)]),
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSensitiveProfileKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function collectProfileKeys(env: RedactionEnv, explicitKeys: readonly string[]): string[] {
  return [...new Set([
    ...explicitKeys,
    ...Object.keys(env).filter(isSensitiveProfileKey),
  ])].sort((left, right) => left.localeCompare(right));
}

function buildProfileDigest(env: RedactionEnv, profileKeys: readonly string[]): string {
  const entries = collectProfileKeys(env, profileKeys).map((key) => {
    const value = normalizeEnvValue(env[key]);
    return {
      key,
      present: Boolean(value?.trim()),
      value_digest: typeof value === 'string' ? sha256(value) : null,
    };
  });

  return `sha256:${sha256(JSON.stringify(entries))}`;
}

function isPublicEndpointKey(key: string): boolean {
  return DEFAULT_ENDPOINT_KEYS.includes(key as never);
}

function sanitizePublicEndpoint(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function publicEndpointFromEnv(env: RedactionEnv, endpointKeys: readonly string[]): string | null {
  for (const key of endpointKeys) {
    if (!isPublicEndpointKey(key)) {
      continue;
    }
    const endpoint = sanitizePublicEndpoint(firstEnvValue(env, [key]));
    if (endpoint) {
      return endpoint;
    }
  }
  return null;
}

function inferPortFamily(publicEndpoint: string | null): string {
  if (!publicEndpoint) {
    return 'unknown';
  }

  try {
    const url = new URL(publicEndpoint);
    const port = url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '80');

    if (port === '20000') {
      return 'api-20000';
    }
    if (port === '3000' || port === '3001') {
      return 'web-300x';
    }
    if (port === '18080' || port === '8080') {
      return 'keycloak';
    }
    if (port === '15432' || port === '5432') {
      return 'postgres';
    }
    if (port === '16379' || port === '6379') {
      return 'redis';
    }
    if (port === '80' || port === '443') {
      return 'http-standard';
    }
  } catch {
    return 'unknown';
  }

  return 'custom';
}

function defaultPresence(env: RedactionEnv): Record<string, boolean> {
  return Object.fromEntries(
    DEFAULT_PRESENCE_GROUPS.map((group) => [
      group.label,
      group.keys.some((key) => hasEnvValue(env, key)),
    ]),
  );
}

function safeAdditionalPresenceLabel(label: string): string {
  if (SAFE_ADDITIONAL_PRESENCE_LABELS.has(label)) {
    return label;
  }
  return `presence_label_sha256_${sha256(label)}`;
}

function normalizeAdditionalPresence(
  additionalPresence: Readonly<Record<string, boolean>> | undefined,
): Record<string, boolean> {
  if (!additionalPresence) {
    return {};
  }

  const normalized: Record<string, boolean> = {};
  for (const [label, value] of Object.entries(additionalPresence)) {
    const safeLabel = safeAdditionalPresenceLabel(label);
    normalized[safeLabel] = Boolean(normalized[safeLabel]) || Boolean(value);
  }
  return normalized;
}

export function buildRedactedDiagnostic(input: BuildRedactedDiagnosticInput): RedactedGovernanceDiagnostic {
  const endpointKeys = input.endpointKeys ?? DEFAULT_ENDPOINT_KEYS;
  const profileKeys = input.profileKeys ?? DEFAULT_PROFILE_KEYS;
  const publicEndpoint = publicEndpointFromEnv(input.env, endpointKeys);
  const presence = sortBooleanRecord({
    ...defaultPresence(input.env),
    ...normalizeAdditionalPresence(input.additionalPresence),
  });

  return {
    presence,
    profile_digest: buildProfileDigest(input.env, profileKeys),
    public_endpoint: publicEndpoint,
    port_family: inferPortFamily(publicEndpoint),
  };
}

export function buildRedactedFailureBundle(input: BuildRedactedFailureBundleInput): RedactedGovernanceDiagnostic {
  return buildRedactedDiagnostic(input);
}

export function findRedactionLeaks(value: unknown): string[] {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (!serialized) {
    return [];
  }

  return SECRET_VALUE_PATTERNS
    .filter((pattern) => pattern.test(serialized))
    .map((pattern) => pattern.source);
}
