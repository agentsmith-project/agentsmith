import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const RUN_READINESS_STATE_SCHEMA = 'agentsmith_run_readiness_state/v1';

export const READINESS_STATE_ENV = {
  path: 'AGENTSMITH_READINESS_STATE_PATH',
  invocationId: 'AGENTSMITH_READINESS_INVOCATION_ID',
  processNonce: 'AGENTSMITH_READINESS_PROCESS_NONCE',
  inputDigest: 'AGENTSMITH_READINESS_INPUT_DIGEST',
  envDigest: 'AGENTSMITH_READINESS_ENV_DIGEST',
  gitSha: 'AGENTSMITH_READINESS_GIT_SHA',
} as const;

const READINESS_ENV_DIGEST_ALLOWLIST = [
  'CI',
  'GITHUB_BASE_REF',
  'GITHUB_EVENT_NAME',
  'KEYCLOAK_BASE_URL',
  'KEYCLOAK_REALM',
  'NEXT_PUBLIC_API_BASE',
  'NEXT_PUBLIC_KEYCLOAK_REALM',
  'NEXT_PUBLIC_KEYCLOAK_URL',
  'NEXT_PUBLIC_USE_MSW',
  'VERIFY_BASE_REF',
] as const;

type ReadinessStateScope = 'verify' | 'release';
type ReadinessStatus = 'unknown' | 'ready' | 'not_ready';
type RunReadinessField = keyof RunReadinessState['readiness'];

const RUN_READINESS_FIELDS = [
  'integration_deps_ready',
  'local_real_substrate_ready',
  'unified_deploy_substrate_ready',
  'runner_image_digest_prepared',
  'afscp_image_digest_prepared',
  'local_kind_image_import_completed',
] as const satisfies readonly RunReadinessField[];

export interface RunReadinessEnvDigestEntry {
  name: string;
  value_hash: string;
}

export interface RunReadinessEnvDigest {
  algorithm: 'sha256';
  allowlist: readonly string[];
  digest: string;
  entries: readonly RunReadinessEnvDigestEntry[];
}

export interface RunReadinessIdentityRecord {
  updated_at: string;
  values: Record<string, string>;
}

export interface RunReadinessState {
  schema: typeof RUN_READINESS_STATE_SCHEMA;
  kind: 'operational_state';
  release_authority: 'not_release_authority';
  scope: ReadinessStateScope;
  invocation_id: string;
  process_nonce: string;
  git_sha: string;
  input_digest: string;
  env_digest: RunReadinessEnvDigest;
  created_at: string;
  readiness: {
    integration_deps_ready: ReadinessStatus;
    local_real_substrate_ready: ReadinessStatus;
    unified_deploy_substrate_ready: ReadinessStatus;
    runner_image_digest_prepared: ReadinessStatus;
    afscp_image_digest_prepared: ReadinessStatus;
    local_kind_image_import_completed: ReadinessStatus;
  };
  readiness_identities?: Partial<Record<RunReadinessField, RunReadinessIdentityRecord>>;
}

export interface CreateRunReadinessStateInput {
  scope: ReadinessStateScope;
  root: string;
  gitSha: string;
  input: unknown;
  env: NodeJS.ProcessEnv;
  invocationId?: string;
  processNonce?: string;
  now?: Date;
}

export interface RunReadinessStateContext {
  statePath: string;
  state: RunReadinessState;
  env: NodeJS.ProcessEnv;
}

export type RunReadinessStateValidationResult =
  | {
    ok: true;
    state: RunReadinessState;
  }
  | {
    ok: false;
    error: string;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableNormalize(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, stableNormalize(value[key])]),
    );
  }
  if (value === undefined) {
    return null;
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function normalizeEnvValue(value: string): string {
  return value.trim();
}

function createReadinessInvocationId(scope: ReadinessStateScope, now: Date): string {
  return `${scope}-${now.toISOString().replace(/[:.]/g, '-')}-${randomBytes(6).toString('hex')}`;
}

function createProcessNonce(): string {
  return `nonce-${randomBytes(16).toString('hex')}`;
}

export function buildReadinessStatePath(root: string): string {
  return join(root, 'state', 'readiness.json');
}

export function buildRunReadinessInputDigest(input: unknown): string {
  return sha256(stableJson(input));
}

export function buildRunReadinessEnvDigest(env: NodeJS.ProcessEnv): RunReadinessEnvDigest {
  const entries = READINESS_ENV_DIGEST_ALLOWLIST
    .filter((name) => env[name] !== undefined)
    .map((name) => ({
      name,
      value_hash: sha256(normalizeEnvValue(String(env[name] ?? ''))),
    }));
  const digest = sha256(stableJson(entries));
  return {
    algorithm: 'sha256',
    allowlist: [...READINESS_ENV_DIGEST_ALLOWLIST],
    digest,
    entries,
  };
}

export function buildRunReadinessChildEnv(input: {
  statePath: string;
  state: RunReadinessState;
}): NodeJS.ProcessEnv {
  return {
    [READINESS_STATE_ENV.path]: input.statePath,
    [READINESS_STATE_ENV.invocationId]: input.state.invocation_id,
    [READINESS_STATE_ENV.processNonce]: input.state.process_nonce,
    [READINESS_STATE_ENV.inputDigest]: input.state.input_digest,
    [READINESS_STATE_ENV.envDigest]: input.state.env_digest.digest,
    [READINESS_STATE_ENV.gitSha]: input.state.git_sha,
  };
}

export function createRunReadinessState(input: CreateRunReadinessStateInput): RunReadinessStateContext {
  const now = input.now ?? new Date();
  const statePath = buildReadinessStatePath(input.root);
  const state: RunReadinessState = {
    schema: RUN_READINESS_STATE_SCHEMA,
    kind: 'operational_state',
    release_authority: 'not_release_authority',
    scope: input.scope,
    invocation_id: input.invocationId ?? createReadinessInvocationId(input.scope, now),
    process_nonce: input.processNonce ?? createProcessNonce(),
    git_sha: input.gitSha,
    input_digest: buildRunReadinessInputDigest(input.input),
    env_digest: buildRunReadinessEnvDigest(input.env),
    created_at: now.toISOString(),
    readiness: {
      integration_deps_ready: 'unknown',
      local_real_substrate_ready: 'unknown',
      unified_deploy_substrate_ready: 'unknown',
      runner_image_digest_prepared: 'unknown',
      afscp_image_digest_prepared: 'unknown',
      local_kind_image_import_completed: 'unknown',
    },
  };

  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  return {
    statePath,
    state,
    env: buildRunReadinessChildEnv({ statePath, state }),
  };
}

function validateReadinessStatus(value: unknown): value is ReadinessStatus {
  return value === 'unknown' || value === 'ready' || value === 'not_ready';
}

function isRunReadinessField(value: string): value is RunReadinessField {
  return (RUN_READINESS_FIELDS as readonly string[]).includes(value);
}

function validateIdentityValues(value: unknown): value is Record<string, string> {
  return isRecord(value)
    && Object.entries(value).every(([key, entry]) => key.length > 0 && typeof entry === 'string');
}

function parseRunReadinessState(value: unknown): RunReadinessStateValidationResult {
  if (!isRecord(value)) {
    return { ok: false, error: 'readiness state must be a JSON object' };
  }
  const requiredStringFields = [
    'schema',
    'kind',
    'release_authority',
    'scope',
    'invocation_id',
    'process_nonce',
    'git_sha',
    'input_digest',
    'created_at',
  ] as const;
  for (const field of requiredStringFields) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      return { ok: false, error: `required readiness state field is missing: ${field}` };
    }
  }
  if (value.schema !== RUN_READINESS_STATE_SCHEMA) {
    return { ok: false, error: `readiness state schema must be ${RUN_READINESS_STATE_SCHEMA}` };
  }
  if (value.kind !== 'operational_state') {
    return { ok: false, error: 'readiness state kind must be operational_state' };
  }
  if (value.release_authority !== 'not_release_authority') {
    return { ok: false, error: 'readiness state must not be release authority evidence' };
  }
  if (value.scope !== 'verify' && value.scope !== 'release') {
    return { ok: false, error: 'readiness state scope must be verify or release' };
  }
  if (!isRecord(value.env_digest)) {
    return { ok: false, error: 'required readiness state field is missing: env_digest' };
  }
  if (value.env_digest.algorithm !== 'sha256' || typeof value.env_digest.digest !== 'string') {
    return { ok: false, error: 'readiness state env_digest is invalid' };
  }
  if (!Array.isArray(value.env_digest.allowlist) || !Array.isArray(value.env_digest.entries)) {
    return { ok: false, error: 'readiness state env_digest allowlist and entries are required' };
  }
  for (const entry of value.env_digest.entries) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.value_hash !== 'string') {
      return { ok: false, error: 'readiness state env_digest entries are invalid' };
    }
  }
  if (!isRecord(value.readiness)) {
    return { ok: false, error: 'required readiness state field is missing: readiness' };
  }
  for (const field of RUN_READINESS_FIELDS) {
    if (!validateReadinessStatus(value.readiness[field])) {
      return { ok: false, error: `required readiness state readiness field is missing: ${field}` };
    }
  }
  if (value.readiness_identities !== undefined) {
    if (!isRecord(value.readiness_identities)) {
      return { ok: false, error: 'readiness state readiness_identities must be an object' };
    }
    for (const [field, record] of Object.entries(value.readiness_identities)) {
      if (!isRunReadinessField(field)) {
        return { ok: false, error: `readiness state readiness_identities has unknown field: ${field}` };
      }
      if (!isRecord(record) || typeof record.updated_at !== 'string' || !validateIdentityValues(record.values)) {
        return { ok: false, error: `readiness state identity is invalid for field: ${field}` };
      }
    }
  }

  return {
    ok: true,
    state: value as unknown as RunReadinessState,
  };
}

export function validateRunReadinessStateForConsumer(input: {
  statePath: string;
  invocationId: string;
  processNonce: string;
  inputDigest?: string;
  envDigest?: string;
  gitSha?: string;
}): RunReadinessStateValidationResult {
  if (!input.statePath || !input.invocationId || !input.processNonce) {
    return {
      ok: false,
      error: 'readiness state consumer requires statePath, invocation_id, and process_nonce',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(input.statePath, 'utf8')) as unknown;
  } catch (error) {
    return {
      ok: false,
      error: `readiness state cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const result = parseRunReadinessState(parsed);
  if (!result.ok) {
    return result;
  }

  const { state } = result;
  if (state.invocation_id !== input.invocationId) {
    return { ok: false, error: 'readiness state invocation_id mismatch' };
  }
  if (state.process_nonce !== input.processNonce) {
    return { ok: false, error: 'readiness state process_nonce mismatch' };
  }
  if (input.inputDigest !== undefined && state.input_digest !== input.inputDigest) {
    return { ok: false, error: 'readiness state input_digest mismatch' };
  }
  if (input.envDigest !== undefined && state.env_digest.digest !== input.envDigest) {
    return { ok: false, error: 'readiness state env_digest mismatch' };
  }
  if (input.gitSha !== undefined && state.git_sha !== input.gitSha) {
    return { ok: false, error: 'readiness state git_sha mismatch' };
  }

  return result;
}

export function updateRunReadinessStateField(input: {
  statePath: string;
  invocationId: string;
  processNonce: string;
  inputDigest?: string;
  envDigest?: string;
  gitSha?: string;
  field: RunReadinessField;
  status: ReadinessStatus;
  identity?: Record<string, string>;
}): RunReadinessState {
  if (!isRunReadinessField(input.field)) {
    throw new Error(`unknown readiness state field: ${input.field}`);
  }
  if (!validateReadinessStatus(input.status)) {
    throw new Error(`invalid readiness state status: ${input.status}`);
  }
  const validation = validateRunReadinessStateForConsumer(input);
  if (!validation.ok) {
    throw new Error(`readiness state validation failed: ${validation.error}`);
  }
  const readinessIdentities: Partial<Record<RunReadinessField, RunReadinessIdentityRecord>> = {
    ...(validation.state.readiness_identities ?? {}),
  };
  if (input.identity !== undefined) {
    readinessIdentities[input.field] = {
      updated_at: new Date().toISOString(),
      values: Object.fromEntries(
        Object.entries(input.identity)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, String(value)]),
      ),
    };
  } else if (input.status !== 'ready') {
    delete readinessIdentities[input.field];
  }

  const updated: RunReadinessState = {
    ...validation.state,
    readiness: {
      ...validation.state.readiness,
      [input.field]: input.status,
    },
    readiness_identities: readinessIdentities,
  };
  writeFileSync(input.statePath, `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

function readinessEnvIsPresent(env: NodeJS.ProcessEnv): boolean {
  return Object.values(READINESS_STATE_ENV).some((name) => Boolean(env[name]?.trim()));
}

export function ensureRunReadinessState(input: CreateRunReadinessStateInput): RunReadinessStateContext {
  const statePath = buildReadinessStatePath(input.root);
  const inputDigest = buildRunReadinessInputDigest(input.input);
  const envDigest = buildRunReadinessEnvDigest(input.env).digest;

  if (readinessEnvIsPresent(input.env)) {
    const existingStatePath = input.env[READINESS_STATE_ENV.path]?.trim();
    const invocationId = input.env[READINESS_STATE_ENV.invocationId]?.trim();
    const processNonce = input.env[READINESS_STATE_ENV.processNonce]?.trim();
    if (!existingStatePath || !invocationId || !processNonce) {
      throw new Error('readiness state env is partial; refusing to trust stale run-local state');
    }
    if (resolve(existingStatePath) !== resolve(statePath)) {
      throw new Error('readiness state path does not match the current run root');
    }
    const validation = validateRunReadinessStateForConsumer({
      statePath: existingStatePath,
      invocationId,
      processNonce,
      inputDigest,
      envDigest,
      gitSha: input.gitSha,
    });
    if (!validation.ok) {
      throw new Error(`readiness state validation failed: ${validation.error}`);
    }
    return {
      statePath: existingStatePath,
      state: validation.state,
      env: buildRunReadinessChildEnv({
        statePath: existingStatePath,
        state: validation.state,
      }),
    };
  }

  return createRunReadinessState(input);
}

export function resolveReadinessGitSha(cwd = process.cwd()): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return 'unknown-git-sha';
  }
  const gitSha = result.stdout.trim().split(/\r?\n/)[0]?.trim();
  return gitSha && gitSha.length > 0 ? gitSha : 'unknown-git-sha';
}

function isCliEntrypoint(): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/governance/run-readiness-state.ts'));
}

function parseCheckArgs(argv: readonly string[]): {
  field: string | null;
  identities: Record<string, string>;
  error?: string;
} {
  if (argv[0] !== 'check') {
    return { field: null, identities: {} };
  }
  let field: string | null = null;
  const identities: Record<string, string> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--field' && next) {
      field = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--field=')) {
      field = arg.slice('--field='.length);
      continue;
    }
    let identity: string | null = null;
    if (arg === '--identity' && next) {
      identity = next;
      index += 1;
    } else if (arg.startsWith('--identity=')) {
      identity = arg.slice('--identity='.length);
    }
    if (identity !== null) {
      const separator = identity.indexOf('=');
      if (separator <= 0) {
        return { field, identities, error: 'readiness identity must be key=value' };
      }
      identities[identity.slice(0, separator)] = identity.slice(separator + 1);
    }
  }
  return { field, identities };
}

function readinessIdentityMatches(
  state: RunReadinessState,
  field: RunReadinessField,
  identities: Record<string, string>,
): boolean {
  const entries = Object.entries(identities);
  if (entries.length === 0) {
    return true;
  }
  const stored = state.readiness_identities?.[field]?.values;
  if (!stored) {
    return false;
  }
  return entries.every(([key, value]) => stored[key] === value);
}

function runReadinessStateCli(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): number {
  const parsed = parseCheckArgs(argv);
  const field = parsed.field;
  if (!field || !isRunReadinessField(field) || parsed.error) {
    process.stderr.write(`[readiness-state] ${parsed.error ?? 'usage: check --field <readiness_field>'}\n`);
    return 1;
  }
  const statePath = env[READINESS_STATE_ENV.path]?.trim();
  const invocationId = env[READINESS_STATE_ENV.invocationId]?.trim();
  const processNonce = env[READINESS_STATE_ENV.processNonce]?.trim();
  const inputDigest = env[READINESS_STATE_ENV.inputDigest]?.trim();
  const envDigest = env[READINESS_STATE_ENV.envDigest]?.trim();
  const gitSha = env[READINESS_STATE_ENV.gitSha]?.trim();
  if (!statePath || !invocationId || !processNonce || !inputDigest || !envDigest) {
    process.stderr.write('[readiness-state] missing readiness state env; fail closed.\n');
    return 1;
  }
  const validation = validateRunReadinessStateForConsumer({
    statePath,
    invocationId,
    processNonce,
    inputDigest,
    envDigest,
    ...(gitSha ? { gitSha } : {}),
  });
  if (!validation.ok) {
    process.stderr.write(`[readiness-state] ${validation.error}\n`);
    return 1;
  }
  return validation.state.readiness[field] === 'ready'
    && readinessIdentityMatches(validation.state, field, parsed.identities)
    ? 0
    : 1;
}

if (isCliEntrypoint()) {
  process.exit(runReadinessStateCli(process.argv.slice(2)));
}
