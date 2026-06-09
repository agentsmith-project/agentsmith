import http, { type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { MongoJsonDocStore } from '@mbos/adapters-private';
import { Pool } from 'pg';

import {
  disposeSystemWorkspaceRegistryPersistence,
  upsertPersistedSystemWorkspace,
} from '../../src/lib/system-admin/workspace-registry/persistence';
import type {
  SystemWorkspaceRecord,
  WorkspaceIdentitySnapshot,
} from '../../src/lib/system-admin/workspace-registry/types';
import {
  upsertDeploymentDefaultManagedRunner,
  type DefaultManagedRunnerSeedResult,
} from '../agent-runner-seed-managed-runner-core';
import {
  PRODUCT_VERIFICATION_FLOWS,
  type ProductVerificationFlowId,
} from './check-verification-report';
import {
  REPO_ROOT,
  asRecord,
  prepareUnifiedDeployEvidenceDir,
  type CheckFailure,
} from './manifest';
import {
  DEFAULT_SITE_ENV_PATH,
  parseSiteEnv,
} from './render';
import {
  DOCKER_SUBSTRATE_REQUIRED_ENV,
  DEFAULT_LIVE_SUBSTRATE_TRUTH_PATH,
  DEFAULT_SUBSTRATE_TRUTH_PATH,
  SUBSTRATE_TRUTH_SCHEMA_ENV_KEY,
  parseSubstrateTruth,
} from './substrate-truth';

type ProducerStatus = 'passed' | 'failed';
type FlowStatus = 'passed' | 'failed';
type JsonRecord = Record<string, unknown>;
type ProductFlowFailure = CheckFailure & {
  code?: string;
  blocked_by?: ProductVerificationFlowId;
  root_cause_flow?: ProductVerificationFlowId;
};

export type ProductFlowFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ProductFlowFs = {
  readFile: (filePath: string) => Promise<string>;
  mkdir: (dirPath: string, options?: { recursive?: boolean }) => Promise<unknown>;
  writeFile: (filePath: string, content: string) => Promise<unknown>;
};

export type ProductFlowCommandRunner = (
  command: string,
  args: string[],
  options?: { env?: Record<string, string | undefined>; cwd?: string; input?: string; timeoutMs?: number },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

type FileLibraryFailureEvidenceInput = {
  truth: ProductFlowRuntimeTruth;
  state: ProductFlowState;
  fetchImpl: ProductFlowFetch;
  libraryName: string;
  requestId: string;
  responseStatus: number;
  responseBody: string;
  backendError: JsonRecord;
};

type FileLibraryFailureEvidenceProvider = (
  input: FileLibraryFailureEvidenceInput,
) => Promise<JsonRecord>;

type KeycloakBootstrapResult = {
  users: {
    devAdmin: WorkspaceIdentitySnapshot;
    integrationUser: WorkspaceIdentitySnapshot;
  };
};

type ProviderMockHandle = {
  baseUrl: string;
  getRequestCount: () => number | null;
  close: () => Promise<void>;
};

type ProductFlowRuntimeTruth = {
  siteEnvPath: string;
  substrateTruthPath: string;
  publicBaseUrl: string;
  apiBaseUrl: string;
  runnerPublicApiBaseUrl: string;
  workspaceId: string;
  workspaceName: string;
  keycloak: {
    publicBaseUrl: string;
    internalBaseUrl: string;
    adminBaseUrl: string;
    publicIssuer: string;
    realm: string;
    clientId: string;
    adminUsername: string;
    adminPassword: string;
    devAdminUsername: string;
    devAdminPassword: string;
    integrationUserUsername: string;
    integrationUserPassword: string;
  };
  mongo: {
    url: string;
    dbName: string;
  };
  postgres: {
    url: string;
    dbName: string;
  };
  minio: {
    endpoint: string;
    bucket: string;
  };
  llmup: {
    internalBaseUrl: string;
    adminTokenPresent: boolean;
  };
  managedRunner: {
    image: string;
  };
  provider: {
    baseUrl?: string;
    advertiseHost: string;
  };
};

type ProductFlowProducerOptions = {
  siteEnvPath?: string;
  substrateTruthPath?: string;
  runtimeSubstrateEnvPath?: string;
  runtimeSubstrateEnvSource?: string;
  env?: Record<string, string | undefined>;
  evidenceDir?: string;
  publicBaseUrl?: string;
  apiBaseUrl?: string;
  providerBaseUrl?: string;
  providerAdvertiseHost?: string;
  keycloakAdminBaseUrl?: string;
  workspaceId?: string;
  flowIds?: ProductVerificationFlowId[];
  fs?: ProductFlowFs;
  fetch?: ProductFlowFetch;
  commandRunner?: ProductFlowCommandRunner;
  keycloakBootstrapper?: (truth: ProductFlowRuntimeTruth) => Promise<KeycloakBootstrapResult>;
  backendBootstrapper?: (
    truth: ProductFlowRuntimeTruth,
    fsDriver: ProductFlowFs,
  ) => Promise<JsonRecord>;
  workspaceBootstrapper?: (
    truth: ProductFlowRuntimeTruth,
    keycloak: KeycloakBootstrapResult,
  ) => Promise<void>;
  tokenProvider?: (
    truth: ProductFlowRuntimeTruth,
    user: { username: string; password: string },
  ) => Promise<string>;
  providerStarter?: (truth: ProductFlowRuntimeTruth) => Promise<ProviderMockHandle>;
  managedRunnerSeeder?: (
    truth: ProductFlowRuntimeTruth,
    state: ProductFlowState,
  ) => Promise<DefaultManagedRunnerSeedResult>;
  fileLibraryFailureEvidenceProvider?: FileLibraryFailureEvidenceProvider;
  now?: () => Date;
  producerCommand?: string;
  agentTaskPolls?: number;
  agentTaskPollIntervalMs?: number;
  fileLibraryCreateMaxAttempts?: number;
  fileLibraryCreateRetryBaseMs?: number;
};

type ProductFlowState = {
  token: string;
  keycloak: KeycloakBootstrapResult;
  schemaPreflight?: JsonRecord;
  provider?: ProviderMockHandle;
  projectId?: string;
  credentialId?: string;
  endpointId?: string;
  endpointModel?: string;
  libraryId?: string;
  managedRunner?: DefaultManagedRunnerSeedResult;
  chatSessionId?: string;
  chatAssistantContent?: string;
  flowStartedAt: string;
  requestIds: Record<string, string>;
};

type ProductFlowEvidenceDirPreparer = () => string;

type ProductFlowEvidence = {
  schema_version: 'agentsmith.focused-product-flow.evidence/v1';
  flow: ProductVerificationFlowId;
  status: FlowStatus;
  producer: 'unified-deploy-product-flows';
  command: string;
  source: {
    public_base_url: string;
    api_base_url: string;
    site_env_path: string;
    substrate_truth_path: string;
    provider_base_url?: string;
    llmup_internal_base_url: string;
  };
  generated_at: string;
  duration_ms: number;
  checks: JsonRecord;
  blocked_by?: ProductVerificationFlowId;
  root_cause_flow?: ProductVerificationFlowId;
  failure?: ProductFlowFailure;
};

type ProductFlowAggregateEvidence = {
  schema_version: 'agentsmith.unified-deploy.product-flows.aggregate/v1';
  producer: 'unified-deploy-product-flows';
  status: ProducerStatus;
  command: string;
  generated_at: string;
  source: ProductFlowEvidence['source'] & {
    workspace_id: string;
    postgres_db_name: string;
    mongo_db_name: string;
    minio_bucket: string;
    keycloak_realm: string;
    keycloak_client_id: string;
  };
  flows: ProductFlowEvidence[];
  flow_evidence_paths: Partial<Record<ProductVerificationFlowId, string>>;
  root_cause_flow?: ProductVerificationFlowId;
  failures: ProductFlowFailure[];
  paths: {
    report_path: string;
    log_path: string;
  };
};

export type ProductFlowProducerResult = {
  status: ProducerStatus;
  failures: ProductFlowFailure[];
  evidence: ProductFlowAggregateEvidence;
};

const DEFAULT_LIVE_SITE_ENV_PATH = path.join(REPO_ROOT, 'artifacts', 'unified-deploy', 'local-kind-site.env');
const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, 'artifacts', 'unified-deploy');
const PRODUCT_FLOW_COMMAND = 'npm run test:unified-deploy:product-flows';
const PRODUCT_FLOW_PRODUCER = 'unified-deploy-product-flows' as const;
const DEFAULT_AGENT_TASK_POLLS = 20;
const DEFAULT_AGENT_TASK_POLL_INTERVAL_MS = 2_000;
const DEFAULT_FILE_LIBRARY_CREATE_MAX_ATTEMPTS = 8;
const DEFAULT_FILE_LIBRARY_CREATE_RETRY_BASE_MS = 500;
const FILE_LIBRARY_CATALOG_COLLECTION = 'project_file_libraries';
const FILE_LIBRARY_AFSCP_MAPPING_COLLECTION = 'project_file_library_afscp_mappings';
const PROJECT_AFSCP_NAMESPACE_MAPPING_COLLECTION = 'project_afscp_namespace_mappings';
const DEPENDENCY_BLOCKED_CODE = 'DEPENDENCY_BLOCKED';
const SECRET_DIAGNOSTIC_PATTERN = /\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|ACCESS_KEY|API_KEY|CLIENT_SECRET)[A-Z0-9_]*)=([^\s,"]+)/giu;
const FLOW_ORDER: ProductVerificationFlowId[] = [
  'login_profile',
  'workspace_project',
  'chat_via_llmup',
  'files',
  'agent_task_managed_runner',
  'audit',
  'usage',
];
const FLOW_DEPENDENCIES: Partial<Record<ProductVerificationFlowId, ProductVerificationFlowId[]>> = {
  agent_task_managed_runner: ['files'],
};
const SERVICE_START_PATTERNS = [
  /\bnpm\s+run\s+(?:dev|start|backend-real(?::|$)|test:e2e:.*with-api|test:.*backend-real)/iu,
  /\b(?:make)\s+(?:local-real-up|local-real-reset)/iu,
  /\b(?:next|tsx)\s+.*(?:packages\/api-entry-node\/src\/index|src\/app|server)/iu,
  /\bllmup\b.*\b(?:serve|start|run)\b/iu,
] as const;

function defaultFs(): ProductFlowFs {
  return {
    readFile: (filePath) => readFile(filePath, 'utf8'),
    mkdir,
    writeFile,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactDiagnostic(value: string): string {
  return value
    .replace(SECRET_DIAGNOSTIC_PATTERN, '$1=[REDACTED]')
    .replace(/(password|secret|token)[^,\s"]*/giu, '[REDACTED]')
    .slice(0, 4000);
}

function redactJsonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactDiagnostic(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, nested]) => [key, redactJsonValue(nested)]),
    );
  }
  return value;
}

function redactedJsonRecord(record: JsonRecord): JsonRecord {
  return asRecord(redactJsonValue(record));
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/u, '');
}

function requireValue(record: Record<string, string>, key: string): string {
  const value = record[key]?.trim();
  if (!value) {
    throw new Error(`missing product flow env value: ${key}`);
  }
  return value;
}

function deriveKeycloakPublicBaseUrl(publicIssuer: string, realm: string): string {
  const normalizedIssuer = trimTrailingSlash(publicIssuer);
  const suffix = `/realms/${realm.replace(/^\/+|\/+$/gu, '')}`;
  if (normalizedIssuer.endsWith(suffix)) {
    return normalizedIssuer.slice(0, -suffix.length);
  }
  const realmsIndex = normalizedIssuer.indexOf('/realms/');
  return realmsIndex >= 0 ? normalizedIssuer.slice(0, realmsIndex) : normalizedIssuer;
}

function buildMongoUrl(values: Record<string, string>): string {
  const username = encodeURIComponent(requireValue(values, 'SUBSTRATE_MONGODB_USER'));
  const password = encodeURIComponent(requireValue(values, 'SUBSTRATE_MONGODB_PASSWORD'));
  const host = requireValue(values, 'SUBSTRATE_MONGODB_HOST');
  const port = requireValue(values, 'SUBSTRATE_MONGODB_PORT');
  return `mongodb://${username}:${password}@${host}:${port}/admin`;
}

function buildPostgresUrl(values: Record<string, string>): string {
  const username = encodeURIComponent(requireValue(values, 'SUBSTRATE_POSTGRES_USER'));
  const password = encodeURIComponent(requireValue(values, 'SUBSTRATE_POSTGRES_PASSWORD'));
  const host = requireValue(values, 'SUBSTRATE_POSTGRES_HOST');
  const port = requireValue(values, 'SUBSTRATE_POSTGRES_PORT');
  const database = encodeURIComponent(requireValue(values, 'SUBSTRATE_POSTGRES_DATABASE'));
  return `postgresql://${username}:${password}@${host}:${port}/${database}`;
}

function buildMinioEndpoint(values: Record<string, string>): string {
  return `http://${requireValue(values, 'SUBSTRATE_MINIO_HOST')}:${requireValue(values, 'SUBSTRATE_MINIO_PORT')}`;
}

function sourceForEvidence(truth: ProductFlowRuntimeTruth): ProductFlowEvidence['source'] {
  return {
    public_base_url: truth.publicBaseUrl,
    api_base_url: truth.apiBaseUrl,
    ...(truth.runnerPublicApiBaseUrl ? { runner_public_api_base_url: truth.runnerPublicApiBaseUrl } : {}),
    site_env_path: truth.siteEnvPath,
    substrate_truth_path: truth.substrateTruthPath,
    ...(truth.provider.baseUrl ? { provider_base_url: truth.provider.baseUrl } : {}),
    llmup_internal_base_url: truth.llmup.internalBaseUrl,
  };
}

function flowLabel(flow: ProductVerificationFlowId): string {
  return PRODUCT_VERIFICATION_FLOWS.find((item) => item.id === flow)?.label ?? flow;
}

export function buildProductFlowRuntimeTruth(input: {
  siteEnvSource: string;
  siteEnvPath: string;
  substrateTruthSource: string;
  substrateTruthPath: string;
  evidenceSubstrateTruthPath?: string;
  publicBaseUrl?: string;
  apiBaseUrl?: string;
  providerBaseUrl?: string;
  providerAdvertiseHost?: string;
  keycloakAdminBaseUrl?: string;
  workspaceId?: string;
  env?: Record<string, string | undefined>;
}): ProductFlowRuntimeTruth {
  const siteEnv = parseSiteEnv(input.siteEnvSource);
  const substrateTruth = parseSubstrateTruth(input.substrateTruthSource, {
    sourcePath: input.substrateTruthPath,
  });
  const values = substrateTruth.values;
  const realm = requireValue(values, 'SUBSTRATE_KEYCLOAK_REALM');
  const keycloakPublicIssuer = requireValue(values, 'SUBSTRATE_KEYCLOAK_PUBLIC_ISSUER');
  const publicBaseUrl = trimTrailingSlash(input.publicBaseUrl ?? requireValue(siteEnv, 'PUBLIC_BASE_URL'));
  const apiBaseUrl = trimTrailingSlash(
    input.apiBaseUrl
    ?? siteEnv.PUBLIC_API_BASE_URL?.trim()
    ?? `${publicBaseUrl}/api/v1`,
  );
  const keycloakPublicBaseUrl = deriveKeycloakPublicBaseUrl(keycloakPublicIssuer, realm);
  const advertiseHost = input.providerAdvertiseHost
    ?? values.SUBSTRATE_MONGODB_HOST
    ?? values.SUBSTRATE_POSTGRES_HOST
    ?? '';

  return {
    siteEnvPath: input.siteEnvPath,
    substrateTruthPath: input.evidenceSubstrateTruthPath ?? input.substrateTruthPath,
    publicBaseUrl,
    apiBaseUrl,
    runnerPublicApiBaseUrl: trimTrailingSlash(siteEnv.RUNNER_PUBLIC_API_BASE_URL ?? ''),
    workspaceId: input.workspaceId?.trim() || input.env?.MBOS_DEFAULT_WORKSPACE_ID?.trim() || 'ws_default',
    workspaceName: input.env?.MBOS_DEFAULT_WORKSPACE_NAME?.trim() || 'Default Workspace',
    keycloak: {
      publicBaseUrl: keycloakPublicBaseUrl,
      internalBaseUrl: requireValue(values, 'SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL'),
      adminBaseUrl: trimTrailingSlash(input.keycloakAdminBaseUrl ?? input.env?.UNIFIED_KEYCLOAK_ADMIN_BASE_URL ?? keycloakPublicBaseUrl),
      publicIssuer: keycloakPublicIssuer,
      realm,
      clientId: requireValue(values, 'SUBSTRATE_KEYCLOAK_CLIENT_ID'),
      adminUsername: requireValue(values, 'SUBSTRATE_KEYCLOAK_ADMIN'),
      adminPassword: requireValue(values, 'SUBSTRATE_KEYCLOAK_ADMIN_PASSWORD'),
      devAdminUsername: input.env?.INTEGRATION_DEV_ADMIN_USERNAME?.trim() || 'dev-admin',
      devAdminPassword: input.env?.INTEGRATION_DEV_ADMIN_PASSWORD?.trim() || 'dev-admin-123',
      integrationUserUsername: input.env?.INTEGRATION_USER_USERNAME?.trim() || 'integration-user',
      integrationUserPassword: input.env?.INTEGRATION_USER_PASSWORD?.trim() || 'integration-user-123',
    },
    mongo: {
      url: buildMongoUrl(values),
      dbName: requireValue(values, 'SUBSTRATE_MONGODB_DATABASE'),
    },
    postgres: {
      url: buildPostgresUrl(values),
      dbName: requireValue(values, 'SUBSTRATE_POSTGRES_DATABASE'),
    },
    minio: {
      endpoint: buildMinioEndpoint(values),
      bucket: requireValue(values, 'SUBSTRATE_MINIO_BUCKET'),
    },
    llmup: {
      internalBaseUrl: 'http://agentsmith-llmup:8080',
      adminTokenPresent: Boolean(siteEnv.MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN?.trim()),
    },
    managedRunner: {
      image: requireValue(siteEnv, 'MANAGED_RUNNER_IMAGE'),
    },
    provider: {
      ...(input.providerBaseUrl ? { baseUrl: trimTrailingSlash(input.providerBaseUrl) } : {}),
      advertiseHost,
    },
  };
}

export function assertPodRoutableProviderBaseUrl(value: string): void {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  const normalized = hostname === '[::1]' ? '::1' : hostname;
  const ipVersion = isIP(normalized);
  const loopbackIpv4 = /^127\./u.test(normalized);
  const loopbackIpv6 = normalized === '::1' || normalized === '0:0:0:0:0:0:0:1';
  if (
    normalized === 'localhost'
    || normalized === '0.0.0.0'
    || loopbackIpv4
    || loopbackIpv6
    || (ipVersion === 6 && normalized === '::')
  ) {
    throw new Error(`provider base URL must be pod-routable; got ${value}`);
  }
}

export function assertNoServiceStartCommand(commandText: string): void {
  if (SERVICE_START_PATTERNS.some((pattern) => pattern.test(commandText))) {
    throw new Error(`product flow producer must not start API/Web/llmup services: ${commandText}`);
  }
}

export function buildNoServiceStartCommandRunner(
  runner: ProductFlowCommandRunner,
): ProductFlowCommandRunner {
  return async (command, args, options) => {
    assertNoServiceStartCommand([command, ...args].join(' '));
    return runner(command, args, options);
  };
}

export function validateProductFlowEvidence(
  evidence: unknown,
  expectedFlow: ProductVerificationFlowId,
): { ok: true } | { ok: false; diagnostic: string } {
  const record = asRecord(evidence);
  if (record.schema_version !== 'agentsmith.focused-product-flow.evidence/v1') {
    return { ok: false, diagnostic: 'schema_version must be agentsmith.focused-product-flow.evidence/v1' };
  }
  if (record.flow !== expectedFlow) {
    return { ok: false, diagnostic: `flow must be ${expectedFlow}` };
  }
  if (record.status !== 'passed') {
    return { ok: false, diagnostic: 'status must be passed' };
  }
  if (record.producer !== PRODUCT_FLOW_PRODUCER) {
    return { ok: false, diagnostic: `producer must be ${PRODUCT_FLOW_PRODUCER}` };
  }
  if (typeof record.command !== 'string' || record.command.trim().length === 0) {
    return { ok: false, diagnostic: 'command is required' };
  }
  if (typeof record.generated_at !== 'string' || Number.isNaN(Date.parse(record.generated_at))) {
    return { ok: false, diagnostic: 'generated_at must be an ISO timestamp' };
  }
  return { ok: true };
}

function bodySummary(body: string): string {
  return body.trim().slice(0, 600);
}

async function readResponseText(response: Response): Promise<string> {
  return response.text().catch((error: unknown) => `response_text_error:${errorMessage(error)}`);
}

async function readJsonResponse(response: Response): Promise<JsonRecord> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  return asRecord(JSON.parse(text) as unknown);
}

async function expectJson(
  fetchImpl: ProductFlowFetch,
  url: string,
  init: RequestInit,
  expectedStatus: number | readonly number[],
  failureContext: string,
): Promise<JsonRecord> {
  const response = await fetchImpl(url, init);
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expected.includes(response.status)) {
    const text = await readResponseText(response);
    throw new Error(`${failureContext} expected ${expected.join('/')} got ${response.status}: ${bodySummary(text)}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().includes('json')) {
    throw new Error(`${failureContext} expected JSON content-type got ${contentType}`);
  }
  try {
    return await readJsonResponse(response);
  } catch (error: unknown) {
    throw new Error(`${failureContext} returned invalid JSON: ${errorMessage(error)}`);
  }
}

async function expectText(
  fetchImpl: ProductFlowFetch,
  url: string,
  init: RequestInit,
  expectedStatus: number | readonly number[],
  failureContext: string,
): Promise<{ response: Response; text: string }> {
  const response = await fetchImpl(url, init);
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const text = await response.text();
  if (!expected.includes(response.status)) {
    throw new Error(`${failureContext} expected ${expected.join('/')} got ${response.status}: ${bodySummary(text)}`);
  }
  return { response, text };
}

function apiV1Url(truth: ProductFlowRuntimeTruth, pathPart: string): string {
  const normalized = pathPart.replace(/^\/+/, '');
  return new URL(normalized, `${trimTrailingSlash(truth.apiBaseUrl)}/`).toString();
}

function publicRouteUrl(truth: ProductFlowRuntimeTruth, pathPart: string): string {
  const normalized = pathPart.replace(/^\/+/, '');
  return new URL(normalized, `${trimTrailingSlash(truth.publicBaseUrl)}/`).toString();
}

function authHeaders(state: ProductFlowState, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${state.token}`,
    accept: 'application/json',
    ...(extra ?? {}),
  };
}

function jsonInit(
  state: ProductFlowState,
  method: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): RequestInit {
  return {
    method,
    headers: authHeaders(state, {
      'content-type': 'application/json',
      ...(extraHeaders ?? {}),
    }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function stringValue(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function numberValue(record: JsonRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function itemsArray(record: JsonRecord): JsonRecord[] {
  const items = record.items;
  return Array.isArray(items) ? items.map(asRecord) : [];
}

function compactJsonRecord(record: Record<string, unknown>): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== ''),
  );
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function booleanValue(record: JsonRecord, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function productFlowError(message: string, checks: JsonRecord): Error {
  return Object.assign(new Error(message), { checks });
}

function checksFromError(error: unknown): JsonRecord {
  if (error instanceof Error && 'checks' in error) {
    return asRecord((error as Error & { checks?: unknown }).checks);
  }
  return {};
}

function schemaPreflightFromBootstrap(checks: JsonRecord): JsonRecord {
  const schemaPreflight = asRecord(checks.schema_preflight);
  return Object.keys(schemaPreflight).length > 0 ? schemaPreflight : {};
}

function withSchemaPreflightChecks(schemaPreflight: JsonRecord | undefined, checks: JsonRecord): JsonRecord {
  if (!schemaPreflight || Object.keys(schemaPreflight).length === 0) {
    return checks;
  }
  const existingPreflight = asRecord(checks.schema_preflight);
  return {
    ...checks,
    schema_preflight: {
      ...schemaPreflight,
      ...existingPreflight,
    },
  };
}

function requestId(flow: ProductVerificationFlowId): string {
  return `unified-product-${flow}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function apiErrorDetailsFromBodyText(status: number, text: string): JsonRecord {
  try {
    const payload = asRecord(JSON.parse(text) as unknown);
    const nestedError = asRecord(payload.error);
    const details = asRecord(payload.details);
    const nestedDetails = asRecord(nestedError.details);
    return compactJsonRecord({
      status,
      error_code: firstString(
        payload.error_code,
        payload.code,
        typeof payload.error === 'string' ? payload.error : undefined,
        nestedError.error_code,
        nestedError.code,
      ),
      message: firstString(payload.message, nestedError.message),
      operation_id: firstString(
        payload.operation_id,
        nestedError.operation_id,
        details.operation_id,
        nestedDetails.operation_id,
      ),
      correlation_id: firstString(
        payload.correlation_id,
        nestedError.correlation_id,
        details.correlation_id,
        nestedDetails.correlation_id,
      ),
      body_summary: bodySummary(text),
    });
  } catch {
    return compactJsonRecord({
      status,
      body_summary: bodySummary(text),
    });
  }
}

function fileLibraryCreateRetryDelayMs(attempt: number, baseMs: number): number {
  if (baseMs <= 0) {
    return 0;
  }
  return Math.min(baseMs * (2 ** Math.max(0, attempt - 1)), 5_000);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function fileLibraryMappingId(input: { workspaceId: string; projectId: string; libraryId: string }): string {
  return `${input.workspaceId}:${input.projectId}:${input.libraryId}`;
}

function projectStorageMappingId(input: { workspaceId: string; projectId: string }): string {
  return `${input.workspaceId}:${input.projectId}`;
}

function recordTimestampMs(record: JsonRecord): number {
  const timestamp = stringValue(record, 'updated_at') || stringValue(record, 'created_at');
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestRecord(records: JsonRecord[]): JsonRecord | null {
  return records
    .toSorted((left, right) => recordTimestampMs(right) - recordTimestampMs(left))[0] ?? null;
}

function operationProjectionEvidence(payload: JsonRecord): JsonRecord {
  const error = asRecord(payload.error);
  const resource = asRecord(payload.resource);
  const operationState = stringValue(payload, 'operation_state');
  return compactJsonRecord({
    operation_id: stringValue(payload, 'operation_id'),
    operation_state: operationState,
    operation_status: stringValue(payload, 'status') || stringValue(payload, 'operation_status') || operationState,
    operation_type: stringValue(payload, 'operation_type'),
    resource_type: stringValue(resource, 'type'),
    phase: stringValue(payload, 'phase'),
    attempt: numberValue(payload, 'attempt'),
    error_code: stringValue(error, 'code'),
    error_retryable: booleanValue(error, 'retryable'),
    last_error_code: stringValue(payload, 'last_error_code') || stringValue(error, 'code'),
    last_error: firstString(payload.last_error, error.message),
    created_at: stringValue(payload, 'created_at'),
    started_at: stringValue(payload, 'started_at'),
    updated_at: stringValue(payload, 'updated_at'),
    finished_at: stringValue(payload, 'finished_at'),
  });
}

async function fetchStorageOperationProjectionEvidence(input: {
  truth: ProductFlowRuntimeTruth;
  state: ProductFlowState;
  fetchImpl: ProductFlowFetch;
  operationId: string;
  requestId: string;
}): Promise<JsonRecord> {
  if (!input.state.projectId) {
    return { enrichment_status: 'skipped_missing_project' };
  }
  const response = await input.fetchImpl(
    apiV1Url(
      input.truth,
      `workspaces/${encodeURIComponent(input.truth.workspaceId)}/projects/${encodeURIComponent(input.state.projectId)}/file-library-operations/${encodeURIComponent(input.operationId)}`,
    ),
    {
      method: 'GET',
      headers: authHeaders(input.state, { 'x-request-id': input.requestId }),
    },
  );
  const text = await readResponseText(response);
  if (response.status !== 200) {
    const error = apiErrorDetailsFromBodyText(response.status, text);
    return compactJsonRecord({
      enrichment_status: 'unavailable',
      http_status: response.status,
      error_code: stringValue(error, 'error_code'),
      message: stringValue(error, 'message'),
      body_summary: stringValue(error, 'body_summary'),
    });
  }
  try {
    return operationProjectionEvidence(asRecord(JSON.parse(text) as unknown));
  } catch (error: unknown) {
    return {
      enrichment_status: 'invalid_json',
      message: errorMessage(error),
      body_summary: bodySummary(text),
    };
  }
}

function selectProjectStorageOperation(mapping: JsonRecord): { operationId: string; role: string } | null {
  const stage = stringValue(mapping, 'stage');
  const namespaceUpsertOperationId = stringValue(mapping, 'namespace_upsert_operation_id');
  const volumeBindingOperationId = stringValue(mapping, 'volume_binding_operation_id');
  if (stage === 'volume_binding' && volumeBindingOperationId) {
    return { operationId: volumeBindingOperationId, role: 'volume_binding' };
  }
  if (stage === 'namespace_upsert' && namespaceUpsertOperationId) {
    return { operationId: namespaceUpsertOperationId, role: 'namespace_upsert' };
  }
  if (volumeBindingOperationId) {
    return { operationId: volumeBindingOperationId, role: 'volume_binding' };
  }
  if (namespaceUpsertOperationId) {
    return { operationId: namespaceUpsertOperationId, role: 'namespace_upsert' };
  }
  return null;
}

function projectStorageMappingEvidence(mapping: JsonRecord): JsonRecord {
  const selectedOperation = selectProjectStorageOperation(mapping);
  return compactJsonRecord({
    collection: PROJECT_AFSCP_NAMESPACE_MAPPING_COLLECTION,
    mapping_id: stringValue(mapping, 'id'),
    status: stringValue(mapping, 'status'),
    stage: stringValue(mapping, 'stage'),
    generation: numberValue(mapping, 'generation'),
    next_action: stringValue(mapping, 'next_action'),
    retryable: booleanValue(mapping, 'retryable'),
    last_error_code: stringValue(mapping, 'last_error_code'),
    last_error: stringValue(mapping, 'last_error'),
    updated_at: stringValue(mapping, 'updated_at'),
    namespace_upsert_operation_id: stringValue(mapping, 'namespace_upsert_operation_id'),
    volume_binding_operation_id: stringValue(mapping, 'volume_binding_operation_id'),
    active_operation_id: selectedOperation?.operationId,
    active_operation_role: selectedOperation?.role,
  });
}

async function readMongoProjectStorageEvidence(input: {
  truth: ProductFlowRuntimeTruth;
  state: ProductFlowState;
}): Promise<JsonRecord> {
  if (!input.state.projectId) {
    return {
      collection: PROJECT_AFSCP_NAMESPACE_MAPPING_COLLECTION,
      enrichment_status: 'skipped_missing_project',
    };
  }

  const mappingId = projectStorageMappingId({
    workspaceId: input.truth.workspaceId,
    projectId: input.state.projectId,
  });
  const store = new MongoJsonDocStore({
    url: input.truth.mongo.url,
    dbName: input.truth.mongo.dbName,
    mongoClientOptions: {
      maxPoolSize: 1,
      maxConnecting: 1,
      waitQueueTimeoutMS: 2_000,
      maxIdleTimeMS: 1_000,
    },
  });
  try {
    const mapping = await store.get<JsonRecord>(
      PROJECT_AFSCP_NAMESPACE_MAPPING_COLLECTION,
      mappingId,
    );
    if (!mapping) {
      return {
        collection: PROJECT_AFSCP_NAMESPACE_MAPPING_COLLECTION,
        mapping_id: mappingId,
        enrichment_status: 'mapping_not_found',
      };
    }
    return projectStorageMappingEvidence(mapping);
  } finally {
    await store.close();
  }
}

async function readMongoFileLibraryProvisioningEvidence(input: {
  truth: ProductFlowRuntimeTruth;
  state: ProductFlowState;
  libraryName: string;
}): Promise<JsonRecord> {
  if (!input.state.projectId) {
    return { enrichment_status: 'skipped_missing_project' };
  }

  const store = new MongoJsonDocStore({
    url: input.truth.mongo.url,
    dbName: input.truth.mongo.dbName,
    mongoClientOptions: {
      maxPoolSize: 1,
      maxConnecting: 1,
      waitQueueTimeoutMS: 2_000,
      maxIdleTimeMS: 1_000,
    },
  });
  try {
    const libraries = await store.list<JsonRecord>(FILE_LIBRARY_CATALOG_COLLECTION, {
      workspace_id: input.truth.workspaceId,
      project_id: input.state.projectId,
      name: input.libraryName,
    });
    const library = latestRecord(libraries);
    if (!library) {
      return { enrichment_status: 'library_not_found' };
    }

    const libraryId = stringValue(library, 'id');
    const mapping = libraryId
      ? await store.get<JsonRecord>(FILE_LIBRARY_AFSCP_MAPPING_COLLECTION, fileLibraryMappingId({
        workspaceId: input.truth.workspaceId,
        projectId: input.state.projectId,
        libraryId,
      }))
      : null;

    return compactJsonRecord({
      catalog: compactJsonRecord({
        file_library_id: libraryId,
        file_library_status: stringValue(library, 'status'),
        created_at: stringValue(library, 'created_at'),
        updated_at: stringValue(library, 'updated_at'),
      }),
      afscp_mapping: mapping
        ? compactJsonRecord({
          operation_id: stringValue(mapping, 'operation_id'),
          operation_status: stringValue(mapping, 'operation_status'),
          last_error_code: stringValue(mapping, 'last_error_code'),
          updated_at: stringValue(mapping, 'updated_at'),
        })
        : undefined,
    });
  } finally {
    await store.close();
  }
}

async function defaultFileLibraryFailureEvidenceProvider(
  input: FileLibraryFailureEvidenceInput,
): Promise<JsonRecord> {
  const evidenceSources = ['backend_response'];
  const backendErrorCode = stringValue(input.backendError, 'error_code');
  const trace: JsonRecord = {
    evidence_kind: 'file_library_provisioning_failure',
    request_correlation_id: input.requestId,
    create_request_id: input.requestId,
    backend_response: input.backendError,
  };
  let operationId = stringValue(input.backendError, 'operation_id');
  let projectStorageOperationId = '';

  if (backendErrorCode === 'PROJECT_STORAGE_PENDING' || backendErrorCode === 'PROJECT_STORAGE_BLOCKED') {
    try {
      const projectStorageEvidence = await readMongoProjectStorageEvidence(input);
      trace.project_storage_mapping = projectStorageEvidence;
      evidenceSources.push(`mongo:${PROJECT_AFSCP_NAMESPACE_MAPPING_COLLECTION}`);
      projectStorageOperationId = stringValue(projectStorageEvidence, 'active_operation_id');
      if (!operationId && projectStorageOperationId) {
        operationId = projectStorageOperationId;
        trace.project_storage_operation_id = projectStorageOperationId;
      }
    } catch (error: unknown) {
      trace.project_storage_mapping = {
        collection: PROJECT_AFSCP_NAMESPACE_MAPPING_COLLECTION,
        enrichment_status: 'unavailable',
        message: errorMessage(error),
      };
    }
  }

  if (!operationId) {
    try {
      const mongoEvidence = await readMongoFileLibraryProvisioningEvidence(input);
      if (Object.keys(mongoEvidence).length > 0) {
        trace.mongo_evidence = mongoEvidence;
        evidenceSources.push('mongo:project_file_libraries/project_file_library_afscp_mappings');
      }
      const mapping = asRecord(mongoEvidence.afscp_mapping);
      operationId = stringValue(mapping, 'operation_id');
      const catalog = asRecord(mongoEvidence.catalog);
      const libraryId = stringValue(catalog, 'file_library_id');
      if (libraryId) {
        trace.file_library_id = libraryId;
      }
    } catch (error: unknown) {
      trace.mongo_evidence = {
        enrichment_status: 'unavailable',
        message: errorMessage(error),
      };
    }
  }

  if (operationId) {
    trace.afscp_operation_id = operationId;
    try {
      const operationEvidence = await fetchStorageOperationProjectionEvidence({
        truth: input.truth,
        state: input.state,
        fetchImpl: input.fetchImpl,
        operationId,
        requestId: input.requestId,
      });
      if (projectStorageOperationId && projectStorageOperationId === operationId) {
        trace.project_storage_operation = operationEvidence;
        trace.afscp_operation = operationEvidence;
      } else {
        trace.afscp_operation = operationEvidence;
      }
      evidenceSources.push('api:file-library-operations');
    } catch (error: unknown) {
      const unavailableOperationEvidence = {
        enrichment_status: 'unavailable',
        message: errorMessage(error),
      };
      if (projectStorageOperationId && projectStorageOperationId === operationId) {
        trace.project_storage_operation = unavailableOperationEvidence;
        trace.afscp_operation = unavailableOperationEvidence;
      } else {
        trace.afscp_operation = unavailableOperationEvidence;
      }
    }
  }

  trace.evidence_sources = evidenceSources;
  return trace;
}

async function collectFileLibraryFailureEvidence(input: {
  failureEvidenceProvider: FileLibraryFailureEvidenceProvider;
} & FileLibraryFailureEvidenceInput): Promise<JsonRecord> {
  try {
    return redactedJsonRecord(await input.failureEvidenceProvider(input));
  } catch (error: unknown) {
    return {
      enrichment_status: 'unavailable',
      message: redactDiagnostic(errorMessage(error)),
    };
  }
}

function buildFlowEvidence(input: {
  truth: ProductFlowRuntimeTruth;
  flow: ProductVerificationFlowId;
  status: FlowStatus;
  command: string;
  startedMs: number;
  generatedAt: string;
  checks: JsonRecord;
  blockedBy?: ProductVerificationFlowId;
  rootCauseFlow?: ProductVerificationFlowId;
  failure?: ProductFlowFailure;
}): ProductFlowEvidence {
  return {
    schema_version: 'agentsmith.focused-product-flow.evidence/v1',
    flow: input.flow,
    status: input.status,
    producer: PRODUCT_FLOW_PRODUCER,
    command: input.command,
    source: sourceForEvidence(input.truth),
    generated_at: input.generatedAt,
    duration_ms: Math.max(0, Date.now() - input.startedMs),
    checks: input.checks,
    ...(input.blockedBy ? { blocked_by: input.blockedBy } : {}),
    ...(input.rootCauseFlow ? { root_cause_flow: input.rootCauseFlow } : {}),
    ...(input.failure ? { failure: input.failure } : {}),
  };
}

async function writeFlowEvidence(args: {
  fs: ProductFlowFs;
  evidenceDir: string;
  prepareEvidenceDir?: ProductFlowEvidenceDirPreparer;
  evidence: ProductFlowEvidence;
  generatedAt: string;
}): Promise<string> {
  const evidenceDir = args.prepareEvidenceDir ? args.prepareEvidenceDir() : args.evidenceDir;
  if (!args.prepareEvidenceDir) {
    await args.fs.mkdir(evidenceDir, { recursive: true });
  }
  const basename = `product-flow-${args.evidence.flow}-${args.generatedAt.replace(/[:.]/gu, '-')}.json`;
  const target = path.join(evidenceDir, basename);
  await args.fs.writeFile(target, `${JSON.stringify(args.evidence, null, 2)}\n`);
  return target;
}

async function getKeycloakAdminToken(truth: ProductFlowRuntimeTruth, fetchImpl: ProductFlowFetch): Promise<string> {
  const response = await fetchImpl(`${truth.keycloak.adminBaseUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: truth.keycloak.adminUsername,
      password: truth.keycloak.adminPassword,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`keycloak_admin_token_failed:${response.status}:${bodySummary(await readResponseText(response))}`);
  }
  const payload = await readJsonResponse(response);
  const token = stringValue(payload, 'access_token');
  if (!token) {
    throw new Error('keycloak_admin_token_missing');
  }
  return token;
}

async function keycloakAdminJson(
  truth: ProductFlowRuntimeTruth,
  fetchImpl: ProductFlowFetch,
  token: string,
  adminPath: string,
  init: RequestInit,
  expectedStatus: number | readonly number[],
  context: string,
): Promise<JsonRecord> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return expectJson(
    fetchImpl,
    `${truth.keycloak.adminBaseUrl}${adminPath}`,
    { ...init, headers },
    expectedStatus,
    context,
  );
}

async function keycloakAdminStatus(
  truth: ProductFlowRuntimeTruth,
  fetchImpl: ProductFlowFetch,
  token: string,
  adminPath: string,
  init: RequestInit,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return fetchImpl(`${truth.keycloak.adminBaseUrl}${adminPath}`, { ...init, headers });
}

type SeedUser = {
  username: string;
  password: string;
  email: string;
  firstName: string;
  lastName: string;
};

function seedUsers(truth: ProductFlowRuntimeTruth): SeedUser[] {
  return [
    {
      username: truth.keycloak.devAdminUsername,
      password: truth.keycloak.devAdminPassword,
      email: 'dev-admin@example.com',
      firstName: 'Dev',
      lastName: 'Admin',
    },
    {
      username: truth.keycloak.integrationUserUsername,
      password: truth.keycloak.integrationUserPassword,
      email: 'integration-user@example.com',
      firstName: 'Integration',
      lastName: 'User',
    },
    {
      username: 'integration-member',
      password: 'integration-member-123',
      email: 'integration-member@example.com',
      firstName: 'Integration',
      lastName: 'Member',
    },
    {
      username: 'integration-guest',
      password: 'integration-guest-123',
      email: 'integration-guest@example.com',
      firstName: 'Integration',
      lastName: 'Guest',
    },
    {
      username: 'integration-invitee',
      password: 'integration-invitee-123',
      email: 'integration-invitee@example.com',
      firstName: 'Integration',
      lastName: 'Invitee',
    },
  ];
}

function toIdentitySnapshot(user: JsonRecord, expectedEmail: string): WorkspaceIdentitySnapshot | null {
  const userId = stringValue(user, 'id');
  const email = stringValue(user, 'email');
  if (!userId || email.toLowerCase() !== expectedEmail.toLowerCase()) {
    return null;
  }
  const firstName = stringValue(user, 'firstName');
  const lastName = stringValue(user, 'lastName');
  const username = stringValue(user, 'username');
  const name = [firstName, lastName].filter((item) => item.length > 0).join(' ').trim() || username || null;
  return { user_id: userId, email, name };
}

function identitySnapshotFromSeedUser(userId: string, user: SeedUser): WorkspaceIdentitySnapshot {
  return {
    user_id: userId,
    email: user.email,
    name: `${user.firstName} ${user.lastName}`,
  };
}

function userIdFromLocationHeader(location: string | null): string {
  if (!location) {
    return '';
  }
  const trimmed = location.trim().replace(/\/+$/u, '');
  const marker = '/users/';
  const markerIndex = trimmed.lastIndexOf(marker);
  if (markerIndex < 0) {
    return '';
  }
  return decodeURIComponent(trimmed.slice(markerIndex + marker.length));
}

async function findKeycloakUser(args: {
  truth: ProductFlowRuntimeTruth;
  fetchImpl: ProductFlowFetch;
  token: string;
  username: string;
  email: string;
}): Promise<WorkspaceIdentitySnapshot | null> {
  const queryUsers = async (query: string, context: string): Promise<JsonRecord[]> => {
    const response = await keycloakAdminStatus(
      args.truth,
      args.fetchImpl,
      args.token,
      `/admin/realms/${encodeURIComponent(args.truth.keycloak.realm)}/users?${query}`,
      { method: 'GET' },
    );
    if (!response.ok) {
      throw new Error(`keycloak_find_user_failed:${context}:${response.status}:${bodySummary(await readResponseText(response))}`);
    }
    const payload = (await response.json()) as unknown;
    return Array.isArray(payload) ? payload.map(asRecord) : [];
  };
  const queries = [
    [`username=${encodeURIComponent(args.username)}&exact=true&max=5`, args.username],
    [`email=${encodeURIComponent(args.email)}&exact=true&max=5`, args.email],
    [`email=${encodeURIComponent(args.email)}&max=5`, args.email],
    [`search=${encodeURIComponent(args.email)}&max=5`, args.email],
    [`search=${encodeURIComponent(args.username)}&max=5`, args.username],
  ] as const;
  const candidates: JsonRecord[] = [];
  for (const [query, context] of queries) {
    candidates.push(...await queryUsers(query, context));
  }

  return candidates
    .map((item) => toIdentitySnapshot(item, args.email))
    .find((item): item is WorkspaceIdentitySnapshot => item !== null) ?? null;
}

async function ensureKeycloakRealm(truth: ProductFlowRuntimeTruth, fetchImpl: ProductFlowFetch, token: string): Promise<void> {
  const response = await keycloakAdminStatus(
    truth,
    fetchImpl,
    token,
    `/admin/realms/${encodeURIComponent(truth.keycloak.realm)}`,
    { method: 'GET' },
  );
  if (response.status === 200) {
    return;
  }
  if (response.status !== 404) {
    throw new Error(`keycloak_realm_lookup_failed:${response.status}:${bodySummary(await readResponseText(response))}`);
  }
  const create = await keycloakAdminStatus(
    truth,
    fetchImpl,
    token,
    '/admin/realms',
    {
      method: 'POST',
      body: JSON.stringify({ realm: truth.keycloak.realm, enabled: true }),
    },
  );
  if (create.status !== 201 && create.status !== 204) {
    throw new Error(`keycloak_realm_create_failed:${create.status}:${bodySummary(await readResponseText(create))}`);
  }
}

async function ensureKeycloakClient(truth: ProductFlowRuntimeTruth, fetchImpl: ProductFlowFetch, token: string): Promise<void> {
  const clientsResponse = await keycloakAdminStatus(
    truth,
    fetchImpl,
    token,
    `/admin/realms/${encodeURIComponent(truth.keycloak.realm)}/clients?clientId=${encodeURIComponent(truth.keycloak.clientId)}`,
    { method: 'GET' },
  );
  if (!clientsResponse.ok) {
    throw new Error(`keycloak_client_lookup_failed:${clientsResponse.status}:${bodySummary(await readResponseText(clientsResponse))}`);
  }
  const clientCandidates = (await clientsResponse.json()) as unknown;
  let client = Array.isArray(clientCandidates) ? clientCandidates.map(asRecord)[0] : undefined;
  const requiredOrigin = truth.publicBaseUrl;
  const requiredRedirect = `${requiredOrigin}/*`;
  if (!client) {
    const create = await keycloakAdminStatus(
      truth,
      fetchImpl,
      token,
      `/admin/realms/${encodeURIComponent(truth.keycloak.realm)}/clients`,
      {
        method: 'POST',
        body: JSON.stringify({
          clientId: truth.keycloak.clientId,
          enabled: true,
          protocol: 'openid-connect',
          publicClient: true,
          directAccessGrantsEnabled: true,
          standardFlowEnabled: true,
          redirectUris: [requiredRedirect],
          webOrigins: [requiredOrigin],
        }),
      },
    );
    if (create.status !== 201 && create.status !== 204) {
      throw new Error(`keycloak_client_create_failed:${create.status}:${bodySummary(await readResponseText(create))}`);
    }
    const refreshed = await keycloakAdminStatus(
      truth,
      fetchImpl,
      token,
      `/admin/realms/${encodeURIComponent(truth.keycloak.realm)}/clients?clientId=${encodeURIComponent(truth.keycloak.clientId)}`,
      { method: 'GET' },
    );
    const refreshedPayload = (await refreshed.json()) as unknown;
    client = Array.isArray(refreshedPayload) ? refreshedPayload.map(asRecord)[0] : undefined;
  }
  const clientUuid = stringValue(client ?? {}, 'id');
  if (!clientUuid) {
    throw new Error(`keycloak_client_missing_after_create:${truth.keycloak.clientId}`);
  }
  const config = await keycloakAdminJson(
    truth,
    fetchImpl,
    token,
    `/admin/realms/${encodeURIComponent(truth.keycloak.realm)}/clients/${encodeURIComponent(clientUuid)}`,
    { method: 'GET' },
    200,
    `keycloak get client ${truth.keycloak.clientId}`,
  );
  const redirects = new Set((Array.isArray(config.redirectUris) ? config.redirectUris : []).filter((item): item is string => typeof item === 'string'));
  const origins = new Set((Array.isArray(config.webOrigins) ? config.webOrigins : []).filter((item): item is string => typeof item === 'string'));
  redirects.add(requiredRedirect);
  origins.add(requiredOrigin);
  const updated = {
    ...config,
    redirectUris: [...redirects],
    webOrigins: [...origins],
    directAccessGrantsEnabled: true,
    standardFlowEnabled: true,
    publicClient: true,
    enabled: true,
  };
  const put = await keycloakAdminStatus(
    truth,
    fetchImpl,
    token,
    `/admin/realms/${encodeURIComponent(truth.keycloak.realm)}/clients/${encodeURIComponent(clientUuid)}`,
    { method: 'PUT', body: JSON.stringify(updated) },
  );
  if (put.status !== 200 && put.status !== 204) {
    throw new Error(`keycloak_client_update_failed:${put.status}:${bodySummary(await readResponseText(put))}`);
  }
}

async function ensureKeycloakUser(args: {
  truth: ProductFlowRuntimeTruth;
  fetchImpl: ProductFlowFetch;
  token: string;
  user: SeedUser;
}): Promise<WorkspaceIdentitySnapshot> {
  const lookupArgs = {
    truth: args.truth,
    fetchImpl: args.fetchImpl,
    token: args.token,
    username: args.user.username,
    email: args.user.email,
  };
  let found = await findKeycloakUser(lookupArgs);
  if (!found) {
    const create = await keycloakAdminStatus(
      args.truth,
      args.fetchImpl,
      args.token,
      `/admin/realms/${encodeURIComponent(args.truth.keycloak.realm)}/users`,
      {
        method: 'POST',
        body: JSON.stringify({
          username: args.user.username,
          enabled: true,
          emailVerified: true,
          firstName: args.user.firstName,
          lastName: args.user.lastName,
          email: args.user.email,
        }),
      },
    );
    if (create.status === 409) {
      found = await findKeycloakUser(lookupArgs);
      if (!found) {
        throw new Error(`keycloak_user_conflict_unresolved:${args.user.username}:${bodySummary(await readResponseText(create))}`);
      }
    } else if (create.status !== 201 && create.status !== 204) {
      throw new Error(`keycloak_user_create_failed:${args.user.username}:${create.status}:${bodySummary(await readResponseText(create))}`);
    } else {
      const createdUserId = userIdFromLocationHeader(create.headers.get('location'));
      found = createdUserId ? identitySnapshotFromSeedUser(createdUserId, args.user) : null;
      for (let attempt = 0; !found && attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        found = await findKeycloakUser(lookupArgs);
      }
    }
  }
  if (!found) {
    throw new Error(`keycloak_user_missing_after_create:${args.user.username}`);
  }
  const update = await keycloakAdminStatus(
    args.truth,
    args.fetchImpl,
    args.token,
    `/admin/realms/${encodeURIComponent(args.truth.keycloak.realm)}/users/${encodeURIComponent(found.user_id)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        id: found.user_id,
        username: args.user.username,
        enabled: true,
        emailVerified: true,
        firstName: args.user.firstName,
        lastName: args.user.lastName,
        email: args.user.email,
      }),
    },
  );
  if (update.status !== 200 && update.status !== 204) {
    throw new Error(`keycloak_user_update_failed:${args.user.username}:${update.status}:${bodySummary(await readResponseText(update))}`);
  }
  const reset = await keycloakAdminStatus(
    args.truth,
    args.fetchImpl,
    args.token,
    `/admin/realms/${encodeURIComponent(args.truth.keycloak.realm)}/users/${encodeURIComponent(found.user_id)}/reset-password`,
    {
      method: 'PUT',
      body: JSON.stringify({
        type: 'password',
        value: args.user.password,
        temporary: false,
      }),
    },
  );
  if (reset.status !== 200 && reset.status !== 204) {
    throw new Error(`keycloak_user_password_reset_failed:${args.user.username}:${reset.status}:${bodySummary(await readResponseText(reset))}`);
  }
  return {
    ...found,
    name: `${args.user.firstName} ${args.user.lastName}`,
  };
}

async function defaultKeycloakBootstrapper(
  truth: ProductFlowRuntimeTruth,
  fetchImpl: ProductFlowFetch,
): Promise<KeycloakBootstrapResult> {
  const token = await getKeycloakAdminToken(truth, fetchImpl);
  await ensureKeycloakRealm(truth, fetchImpl, token);
  await ensureKeycloakClient(truth, fetchImpl, token);
  const users = await Promise.all(seedUsers(truth).map((user) => ensureKeycloakUser({
    truth,
    fetchImpl,
    token,
    user,
  })));
  const devAdmin = users.find((user) => user.email === 'dev-admin@example.com');
  const integrationUser = users.find((user) => user.email === 'integration-user@example.com');
  if (!devAdmin || !integrationUser) {
    throw new Error('keycloak_seed_user_identity_missing');
  }
  return { users: { devAdmin, integrationUser } };
}

async function defaultWorkspaceBootstrapper(
  truth: ProductFlowRuntimeTruth,
  keycloak: KeycloakBootstrapResult,
): Promise<void> {
  const previous = {
    MONGO_URL: process.env.MONGO_URL,
    MONGO_DB_NAME: process.env.MONGO_DB_NAME,
  };
  process.env.MONGO_URL = truth.mongo.url;
  process.env.MONGO_DB_NAME = truth.mongo.dbName;
  try {
    const timestamp = new Date().toISOString();
    const record: SystemWorkspaceRecord = {
      id: truth.workspaceId,
      name: truth.workspaceName,
      workspace_admin: keycloak.users.devAdmin.email,
      workspace_admin_user_id: keycloak.users.devAdmin.user_id,
      workspace_admin_name: keycloak.users.devAdmin.name,
      workspace_admin_binding_required: false,
      project_creators: [
        keycloak.users.devAdmin,
        keycloak.users.integrationUser,
      ],
      login_idp: {
        kind: 'keycloak',
        url: truth.keycloak.publicBaseUrl,
        realm: truth.keycloak.realm,
        client_id: truth.keycloak.clientId,
      },
      directory_idp: {
        client_id: truth.keycloak.clientId,
      },
      tenant: {
        workspace_id: truth.workspaceId,
        workspace_name: truth.workspaceName,
        substrate_label: 'default',
        database_name: `agentsmith_${truth.workspaceId}`,
        collection_prefix: `${truth.workspaceId}_`,
        key_prefix: `${truth.workspaceId}:`,
      },
      provisioning_status: 'ready',
      last_initialized_at: timestamp,
      last_init_error: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await upsertPersistedSystemWorkspace(record);
  } finally {
    if (previous.MONGO_URL === undefined) delete process.env.MONGO_URL;
    else process.env.MONGO_URL = previous.MONGO_URL;
    if (previous.MONGO_DB_NAME === undefined) delete process.env.MONGO_DB_NAME;
    else process.env.MONGO_DB_NAME = previous.MONGO_DB_NAME;
    await disposeSystemWorkspaceRegistryPersistence();
  }
}

async function defaultTokenProvider(
  truth: ProductFlowRuntimeTruth,
  fetchImpl: ProductFlowFetch,
  user: { username: string; password: string },
): Promise<string> {
  const payload = await expectJson(
    fetchImpl,
    `${truth.keycloak.publicBaseUrl}/realms/${encodeURIComponent(truth.keycloak.realm)}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: truth.keycloak.clientId,
        username: user.username,
        password: user.password,
      }).toString(),
    },
    200,
    'keycloak password grant',
  );
  const token = stringValue(payload, 'access_token');
  if (!token) {
    throw new Error('keycloak_password_grant_token_missing');
  }
  return token;
}

async function defaultProviderStarter(truth: ProductFlowRuntimeTruth): Promise<ProviderMockHandle> {
  if (truth.provider.baseUrl) {
    assertPodRoutableProviderBaseUrl(truth.provider.baseUrl);
    return {
      baseUrl: truth.provider.baseUrl,
      getRequestCount: () => null,
      close: async () => undefined,
    };
  }
  const advertiseHost = truth.provider.advertiseHost.trim();
  if (!advertiseHost) {
    throw new Error('provider advertise host missing from substrate truth');
  }
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      requestCount += 1;
      if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const body = bodyText.trim() ? asRecord(JSON.parse(bodyText) as unknown) : {};
      const replyText = 'Hello from unified deploy product flow mock provider.';
      if (body.stream === true) {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl_unified_product_flow',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: replyText }, finish_reason: null }],
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl_unified_product_flow',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { total_tokens: 17 },
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl_unified_product_flow',
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: replyText }, finish_reason: 'stop' }],
        usage: { total_tokens: 17 },
      }));
    })().catch((error: unknown) => {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'mock_provider_failed', message: errorMessage(error) }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://${advertiseHost}:${port}/v1`;
  assertPodRoutableProviderBaseUrl(baseUrl);
  return {
    baseUrl,
    getRequestCount: () => requestCount,
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function defaultBackendBootstrapper(
  truth: ProductFlowRuntimeTruth,
  _fsDriver: ProductFlowFs,
): Promise<JsonRecord> {
  const pool = new Pool({
    connectionString: truth.postgres.url,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const result = await pool.query("select to_regclass('public.projects') is not null as projects_table_exists");
    const firstRow = asRecord(result.rows?.[0]);
    const projectsTableExists = firstRow.projects_table_exists === true;
    if (!projectsTableExists) {
      throw productFlowError(
        'product_schema_not_ready/projects_table_missing: public.projects table is missing; run backend schema bootstrap before product flows',
        {
          schema_preflight: {
            postgres_database: truth.postgres.dbName,
            projects_table_exists: false,
          },
        },
      );
    }
  } finally {
    await pool.end();
  }
  return {
    schema_preflight: {
      postgres_database: truth.postgres.dbName,
      projects_table_exists: true,
    },
  };
}

async function defaultManagedRunnerSeeder(
  truth: ProductFlowRuntimeTruth,
  state: ProductFlowState,
): Promise<DefaultManagedRunnerSeedResult> {
  if (!state.projectId || !state.endpointId) {
    throw new Error('managed_runner_seed_missing_project_or_endpoint');
  }
  return upsertDeploymentDefaultManagedRunner({
    workspaceId: truth.workspaceId,
    projectId: state.projectId,
    endpointId: state.endpointId,
    runnerName: 'unified-deploy-managed-runner',
    mongoUrl: truth.mongo.url,
    mongoDbName: truth.mongo.dbName,
    image: truth.managedRunner.image,
    isDefault: true,
    status: 'enabled',
    presence: 'managed',
    runnerStatus: 'ready',
    actorUserId: state.keycloak.users.devAdmin.user_id,
  });
}

async function runLoginProfileFlow(
  truth: ProductFlowRuntimeTruth,
  state: ProductFlowState,
  fetchImpl: ProductFlowFetch,
): Promise<JsonRecord> {
  const profile = await expectJson(
    fetchImpl,
    apiV1Url(truth, 'me/profile'),
    { method: 'GET', headers: authHeaders(state) },
    200,
    '/me/profile',
  );
  return {
    profile_keys: Object.keys(profile).sort(),
    authenticated: true,
  };
}

async function ensureProject(
  truth: ProductFlowRuntimeTruth,
  state: ProductFlowState,
  fetchImpl: ProductFlowFetch,
): Promise<JsonRecord> {
  const publicWorkspaces = await expectJson(
    fetchImpl,
    publicRouteUrl(truth, 'api/public/workspaces'),
    { method: 'GET', headers: { accept: 'application/json' } },
    200,
    '/api/public/workspaces',
  );
  const workspaceIds = itemsArray(publicWorkspaces).map((item) => stringValue(item, 'id'));
  if (!workspaceIds.includes(truth.workspaceId)) {
    throw new Error(`/api/public/workspaces does not contain ${truth.workspaceId}`);
  }
  const createRequestId = requestId('workspace_project');
  state.requestIds.workspace_project = createRequestId;
  const project = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects`),
    jsonInit(state, 'POST', {
      name: `Unified Product Flow ${Date.now()}`,
      visibility: 'private',
      join_policy: 'approval_required',
    }, { 'x-request-id': createRequestId }),
    201,
    'project create',
  );
  const projectId = stringValue(project, 'id');
  if (!projectId) {
    throw new Error('project create response missing id');
  }
  state.projectId = projectId;
  const listed = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects`),
    { method: 'GET', headers: authHeaders(state) },
    200,
    'project list',
  );
  if (!itemsArray(listed).some((item) => stringValue(item, 'id') === projectId)) {
    throw new Error(`project list does not contain created project ${projectId}`);
  }
  const read = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(projectId)}`),
    { method: 'GET', headers: authHeaders(state) },
    200,
    'project read',
  );
  return {
    workspace_id: truth.workspaceId,
    public_workspace_count: workspaceIds.length,
    project_id: projectId,
    project_name: stringValue(read, 'name'),
  };
}

async function ensureEndpoint(
  truth: ProductFlowRuntimeTruth,
  state: ProductFlowState,
  fetchImpl: ProductFlowFetch,
): Promise<JsonRecord> {
  if (!state.projectId || !state.provider) {
    throw new Error('endpoint setup missing project or provider');
  }
  const credential = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/credentials`),
    jsonInit(state, 'POST', {
      name: `unified-product-flow-key-${Date.now()}`,
      type: 'api_key',
      value: 'sk-unified-product-flow',
    }),
    201,
    'credential create',
  );
  const credentialId = stringValue(credential, 'id');
  if (!credentialId) {
    throw new Error('credential create response missing id');
  }
  state.credentialId = credentialId;
  const endpointRequestId = requestId('chat_via_llmup');
  state.requestIds.endpoint_create = endpointRequestId;
  const model = 'integration-chat-model';
  const endpoint = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/endpoints`),
    jsonInit(state, 'POST', {
      name: `unified-product-flow-endpoint-${Date.now()}`,
      model,
      type: 'custom',
      base_url: state.provider.baseUrl,
      credential_ref: credentialId,
      provider_family: 'custom',
      upstream_protocol: 'openai_chat_completions',
      capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: model }],
      models: [{ capability: 'chat_completion', model_id: model, display_name: model }],
      defaults: { chat_model_id: model },
      model_profile: {
        max_context_tokens: 128000,
        max_output_tokens: 8192,
        supports_file: false,
        supports_tool_call: true,
        supports_reasoning: false,
        price_input_per_1m: 0,
        price_output_per_1m: 0,
        cache_read_discount_ratio: 0,
      },
    }, { 'x-request-id': endpointRequestId }),
    201,
    'endpoint create',
  );
  const endpointId = stringValue(endpoint, 'id');
  if (!endpointId) {
    throw new Error('endpoint create response missing id');
  }
  state.endpointId = endpointId;
  state.endpointModel = stringValue(endpoint, 'model') || model;
  return {
    credential_id: credentialId,
    endpoint_id: endpointId,
    endpoint_model: state.endpointModel,
    provider_base_url: state.provider.baseUrl,
    provider_neutral_endpoint: {
      endpoint_type: 'custom',
      provider_family: 'custom',
      upstream_protocol: 'openai_chat_completions',
      credential_type: 'api_key',
      success_path: 'provider_neutral_endpoint',
    },
  };
}

function parseSseAssistantContent(text: string): string {
  let assistant = '';
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      continue;
    }
    const data = trimmed.slice('data:'.length).trim();
    if (!data || data === '[DONE]') {
      continue;
    }
    try {
      const payload = asRecord(JSON.parse(data) as unknown);
      const choices = Array.isArray(payload.choices) ? payload.choices.map(asRecord) : [];
      const first = choices[0] ?? {};
      const delta = asRecord(first.delta);
      const message = asRecord(first.message);
      assistant += stringValue(delta, 'content') || stringValue(message, 'content');
    } catch {
      // The API's own SSE events are not OpenAI chunks; keep scanning.
    }
  }
  if (assistant) {
    return assistant;
  }
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      continue;
    }
    const data = trimmed.slice('data:'.length).trim();
    if (!data || data === '[DONE]') {
      continue;
    }
    try {
      const payload = asRecord(JSON.parse(data) as unknown);
      assistant += stringValue(payload, 'delta');
    } catch {
      // ignore non-JSON event payloads
    }
  }
  return assistant;
}

async function runChatViaLlmupFlow(
  truth: ProductFlowRuntimeTruth,
  state: ProductFlowState,
  fetchImpl: ProductFlowFetch,
): Promise<JsonRecord> {
  if (!state.projectId || !state.endpointId || !state.endpointModel) {
    throw new Error('chat flow missing project endpoint setup');
  }
  const session = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/chat/sessions`),
    jsonInit(state, 'POST', {
      endpoint_id: state.endpointId,
      model: state.endpointModel,
    }),
    201,
    'chat session create',
  );
  const sessionId = stringValue(session, 'id');
  if (!sessionId) {
    throw new Error('chat session create response missing id');
  }
  state.chatSessionId = sessionId;
  const reqId = requestId('chat_via_llmup');
  state.requestIds.chat_via_llmup = reqId;
  const { response, text } = await expectText(
    fetchImpl,
    apiV1Url(
      truth,
      `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/chat/sessions/${encodeURIComponent(sessionId)}/messages/stream`,
    ),
    jsonInit(state, 'POST', {
      endpoint_id: state.endpointId,
      model: state.endpointModel,
      input: {
        role: 'user',
        content: 'Reply with the unified deploy product flow greeting.',
      },
    }, { 'x-request-id': reqId }),
    200,
    'chat stream',
  );
  const assistantContent = parseSseAssistantContent(text);
  if (!assistantContent.includes('unified deploy product flow')) {
    throw new Error(`chat stream assistant content missing expected mock provider text: ${assistantContent || bodySummary(text)}`);
  }
  const providerRequests = state.provider?.getRequestCount();
  if (providerRequests !== null && providerRequests !== undefined && providerRequests < 1) {
    throw new Error('mock provider did not observe a request');
  }
  state.chatAssistantContent = assistantContent;
  return {
    session_id: sessionId,
    endpoint_id: state.endpointId,
    content_type: response.headers.get('content-type') ?? '',
    assistant_content: assistantContent,
    provider_request_count: providerRequests,
  };
}

async function waitForFileLibraryReady(args: {
  truth: ProductFlowRuntimeTruth;
  state: ProductFlowState;
  fetchImpl: ProductFlowFetch;
  libraryId: string;
}): Promise<JsonRecord> {
  if (!args.state.projectId) {
    throw new Error('file library wait missing project');
  }
  let last: JsonRecord = {};
  for (let attempt = 0; attempt < 30; attempt += 1) {
    last = await expectJson(
      args.fetchImpl,
      apiV1Url(
        args.truth,
        `workspaces/${encodeURIComponent(args.truth.workspaceId)}/projects/${encodeURIComponent(args.state.projectId)}/file-libraries/${encodeURIComponent(args.libraryId)}`,
      ),
      { method: 'GET', headers: authHeaders(args.state) },
      200,
      'file library read',
    );
    const status = stringValue(last, 'status');
    if (status === 'ready') {
      return last;
    }
    if (status === 'failed') {
      throw new Error('file library provisioning failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`file library did not become ready; last_status=${stringValue(last, 'status') || 'unknown'}`);
}

async function createFileLibraryWithPendingRetry(args: {
  truth: ProductFlowRuntimeTruth;
  state: ProductFlowState;
  fetchImpl: ProductFlowFetch;
  failureEvidenceProvider: FileLibraryFailureEvidenceProvider;
  maxAttempts: number;
  retryBaseMs: number;
}): Promise<{ created: JsonRecord; checks: JsonRecord }> {
  if (!args.state.projectId) {
    throw new Error('file library create missing project');
  }
  const checks: JsonRecord = {
    create_attempts: 0,
  };
  const maxAttempts = Math.max(1, Math.trunc(args.maxAttempts));
  const url = apiV1Url(args.truth, `workspaces/${encodeURIComponent(args.truth.workspaceId)}/projects/${encodeURIComponent(args.state.projectId)}/file-libraries`);
  const libraryName = `Unified Product Flow Files ${Date.now()}`;
  const createRequestIds: string[] = [];
  checks.create_library_name = libraryName;
  checks.create_request_ids = createRequestIds;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    checks.create_attempts = attempt;
    const createRequestId = requestId('files');
    createRequestIds.push(createRequestId);
    checks.create_last_request_id = createRequestId;
    args.state.requestIds.files = createRequestId;
    const init = jsonInit(args.state, 'POST', {
      name: libraryName,
      description: 'Unified deploy product-flow smoke library',
    }, { 'x-request-id': createRequestId });
    const response = await args.fetchImpl(url, init);
    if (response.status === 201) {
      try {
        return {
          created: await readJsonResponse(response),
          checks,
        };
      } catch (error: unknown) {
        throw productFlowError(`file library create returned invalid JSON: ${errorMessage(error)}`, checks);
      }
    }

    const body = await readResponseText(response);
    const backendError = apiErrorDetailsFromBodyText(response.status, body);
    const errorCode = stringValue(backendError, 'error_code');
    const lastError = `status=${response.status} code=${errorCode || 'unknown'} body=${bodySummary(body)}`;
    checks.create_last_error = lastError;
    checks.create_last_error_code = errorCode || 'unknown';
    checks.create_last_response = backendError;

    if (response.status === 409 && errorCode === 'PROJECT_STORAGE_PENDING') {
      if (attempt >= maxAttempts) {
        checks.provisioning_failure_trace = await collectFileLibraryFailureEvidence({
          failureEvidenceProvider: args.failureEvidenceProvider,
          truth: args.truth,
          state: args.state,
          fetchImpl: args.fetchImpl,
          libraryName,
          requestId: createRequestId,
          responseStatus: response.status,
          responseBody: body,
          backendError,
        });
        throw productFlowError(`file library create still pending after ${attempt} attempts; last_error=${lastError}`, checks);
      }
      await sleep(fileLibraryCreateRetryDelayMs(attempt, args.retryBaseMs));
      continue;
    }
    if (errorCode === 'PROJECT_STORAGE_BLOCKED') {
      throw productFlowError(`file library create blocked by project storage readiness: ${lastError}`, checks);
    }
    if (
      response.status >= 500
      || errorCode === 'FILE_LIBRARY_PROVISIONING_FAILED'
      || errorCode === 'FILE_LIBRARY_OPERATION_FAILED'
    ) {
      checks.provisioning_failure_trace = await collectFileLibraryFailureEvidence({
        failureEvidenceProvider: args.failureEvidenceProvider,
        truth: args.truth,
        state: args.state,
        fetchImpl: args.fetchImpl,
        libraryName,
        requestId: createRequestId,
        responseStatus: response.status,
        responseBody: body,
        backendError,
      });
    }
    throw productFlowError(`file library create expected 201 got ${response.status}: ${bodySummary(body)}`, checks);
  }

  throw productFlowError('file library create retry loop exhausted without a terminal response', checks);
}

async function runFilesFlow(
  truth: ProductFlowRuntimeTruth,
  state: ProductFlowState,
  fetchImpl: ProductFlowFetch,
  options: {
    fileLibraryCreateMaxAttempts: number;
    fileLibraryCreateRetryBaseMs: number;
    failureEvidenceProvider: FileLibraryFailureEvidenceProvider;
  },
): Promise<JsonRecord> {
  if (!state.projectId) {
    throw new Error('files flow missing project');
  }
  const createdWithChecks = await createFileLibraryWithPendingRetry({
    truth,
    state,
    fetchImpl,
    failureEvidenceProvider: options.failureEvidenceProvider,
    maxAttempts: options.fileLibraryCreateMaxAttempts,
    retryBaseMs: options.fileLibraryCreateRetryBaseMs,
  });
  const created = createdWithChecks.created;
  const libraryId = stringValue(created, 'id');
  if (!libraryId) {
    throw productFlowError('file library create response missing id', createdWithChecks.checks);
  }
  state.libraryId = libraryId;
  const ready = await waitForFileLibraryReady({ truth, state, fetchImpl, libraryId });
  await expectText(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/file-libraries/${encodeURIComponent(libraryId)}/folders`),
    jsonInit(state, 'POST', { path: 'docs' }),
    204,
    'file library folder create',
  );
  const form = new FormData();
  form.set('prefix', 'docs/');
  form.set('file', new Blob(['hello from unified deploy product flow\n'], { type: 'text/plain' }), 'guide.txt');
  await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/file-libraries/${encodeURIComponent(libraryId)}/upload`),
    {
      method: 'POST',
      headers: authHeaders(state),
      body: form,
    },
    [200, 201],
    'file library upload',
  );
  const entries = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/file-libraries/${encodeURIComponent(libraryId)}/entries?path=${encodeURIComponent('docs/')}`),
    { method: 'GET', headers: authHeaders(state) },
    200,
    'file library entries',
  );
  if (!itemsArray(entries).some((item) => stringValue(item, 'name') === 'guide.txt' || stringValue(item, 'path') === 'docs/guide.txt')) {
    throw new Error('uploaded file missing from file library entries');
  }
  const download = await expectText(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/file-libraries/${encodeURIComponent(libraryId)}/download?path=${encodeURIComponent('docs/guide.txt')}`),
    { method: 'GET', headers: authHeaders(state) },
    200,
    'file library download',
  );
  if (!download.text.includes('hello from unified deploy product flow')) {
    throw new Error('downloaded file content mismatch');
  }
  return {
    ...createdWithChecks.checks,
    library_id: libraryId,
    library_status: stringValue(ready, 'status'),
    uploaded_path: 'docs/guide.txt',
    entry_count: itemsArray(entries).length,
  };
}

async function runAgentTaskManagedRunnerFlow(args: {
  truth: ProductFlowRuntimeTruth;
  state: ProductFlowState;
  fetchImpl: ProductFlowFetch;
  seedManagedRunner: (truth: ProductFlowRuntimeTruth, state: ProductFlowState) => Promise<DefaultManagedRunnerSeedResult>;
  pollMax: number;
  pollIntervalMs: number;
}): Promise<JsonRecord> {
  const { truth, state, fetchImpl } = args;
  const checks: JsonRecord = {};
  if (!state.projectId) {
    throw new Error('managed runner flow missing project');
  }
  if (!state.endpointId) {
    if (!state.provider) {
      throw new Error('managed runner flow missing endpoint and provider setup');
    }
    checks.endpoint_setup = await ensureEndpoint(truth, state, fetchImpl);
  }
  state.managedRunner = await args.seedManagedRunner(truth, state);
  checks.seeded_runner = {
    runner_id: state.managedRunner.runnerId,
    runner_status: state.managedRunner.status,
    is_default: state.managedRunner.isDefault,
    default_endpoint_id: state.managedRunner.defaultEndpointId,
    model_setting_endpoint_id: state.managedRunner.agentTaskModelSetting.endpointId,
  };
  if (!state.managedRunner.isDefault || state.managedRunner.status !== 'ready') {
    throw productFlowError(`managed runner seed did not produce ready default runner: ${JSON.stringify({
      isDefault: state.managedRunner.isDefault,
      status: state.managedRunner.status,
    })}`, checks);
  }
  const runners = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/agent-runners`),
    { method: 'GET', headers: authHeaders(state) },
    200,
    'agent runners list',
  );
  const runner = itemsArray(runners).find((item) => stringValue(item, 'id') === state.managedRunner?.runnerId)
    ?? itemsArray(runners).find((item) => item.is_default === true);
  if (!runner) {
    throw productFlowError('default managed runner not visible through API', checks);
  }
  const runnerId = stringValue(runner, 'id');
  const runnerStatus = stringValue(runner, 'status');
  checks.api_runner = {
    runner_id: runnerId,
    runner_status: runnerStatus,
    is_default: runner.is_default === true,
    runner_count: itemsArray(runners).length,
  };
  if (runner.is_default !== true || runnerStatus !== 'ready') {
    throw productFlowError(`default managed runner not ready through API: id=${runnerId} status=${runnerStatus}`, checks);
  }
  const setting = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/agent-task-model-setting`),
    { method: 'GET', headers: authHeaders(state) },
    200,
    'agent task model setting',
  );
  const settingRecord = asRecord(setting.setting ?? setting);
  checks.agent_task_model_setting = {
    endpoint_id: stringValue(settingRecord, 'endpoint_id'),
    readiness_state: stringValue(asRecord(setting.readiness), 'state'),
  };
  if (stringValue(settingRecord, 'endpoint_id') !== state.endpointId) {
    throw productFlowError(`agent task model setting endpoint mismatch: ${stringValue(settingRecord, 'endpoint_id')} !== ${state.endpointId}`, checks);
  }
  const diagnostics = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/agent-runners/${encodeURIComponent(runnerId)}/diagnostics`),
    { method: 'GET', headers: authHeaders(state) },
    200,
    'managed runner diagnostics',
  );
  const executionConfig = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/agent-runners/${encodeURIComponent(runnerId)}/execution-config`),
    { method: 'GET', headers: authHeaders(state) },
    200,
    'managed runner execution config',
  );
  const connectionInfo = await fetchImpl(
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/agent-runners/${encodeURIComponent(runnerId)}/connection-info`),
    { method: 'GET', headers: authHeaders(state) },
  );
  if (connectionInfo.status !== 200 && connectionInfo.status !== 403) {
    throw productFlowError(`managed runner connection-info route not reachable: ${connectionInfo.status}:${bodySummary(await readResponseText(connectionInfo))}`, checks);
  }
  checks.runner_routes = {
    diagnostics_presence: stringValue(asRecord(diagnostics.diagnostics ?? diagnostics), 'presence') || stringValue(diagnostics, 'presence'),
    execution_config_schema_version: numberValue(executionConfig, 'schema_version'),
    connection_info_status: connectionInfo.status,
  };
  const taskCreateRequestId = requestId('agent_task_managed_runner');
  state.requestIds.agent_task_managed_runner_task_create = taskCreateRequestId;
  const task = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/tasks`),
    jsonInit(state, 'POST', {
      title: `Unified managed runner ${Date.now()}`,
      workspace_mode: 'create_new',
    }, { 'x-request-id': taskCreateRequestId }),
    201,
    'managed runner task create',
  );
  const taskId = stringValue(task, 'id');
  if (!taskId) {
    throw productFlowError('managed runner task create response missing id', checks);
  }
  const taskWorkspaceFileLibraryId = stringValue(task, 'workspace_file_library_id');
  const run = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/tasks/${encodeURIComponent(taskId)}/runs`),
    jsonInit(state, 'POST', {
      intent: 'Reply exactly: unified deploy managed runner ok',
    }, { 'x-request-id': requestId('agent_task_managed_runner') }),
    200,
    'managed runner task run',
  );
  let traceStatus = '';
  let traceSummary = '';
  let traceCount = 0;
  for (let attempt = 0; attempt < args.pollMax; attempt += 1) {
    const traces = await expectJson(
      fetchImpl,
      apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/tasks/${encodeURIComponent(taskId)}/traces?page_size=200`),
      { method: 'GET', headers: authHeaders(state) },
      200,
      'managed runner task traces',
    );
    const terminal = itemsArray(traces)
      .reverse()
      .find((item) => stringValue(item, 'status') === 'success' || stringValue(item, 'status') === 'error' || stringValue(item, 'status') === 'cancelled');
    traceCount = itemsArray(traces).length;
    traceStatus = terminal ? stringValue(terminal, 'status') : '';
    traceSummary = terminal ? stringValue(terminal, 'summary') : '';
    if (traceStatus) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, args.pollIntervalMs));
  }
  checks.task_execution = {
    task_id: taskId,
    task_workspace_file_library_id: taskWorkspaceFileLibraryId,
    run_response_id: stringValue(run, 'id'),
    trace_status: traceStatus || 'missing',
    trace_summary: traceSummary,
    trace_count: traceCount,
    poll_count: args.pollMax,
  };
  if (traceStatus !== 'success') {
    throw productFlowError(`managed runner task execution did not reach success; status=${traceStatus || 'missing'} summary=${traceSummary}`, checks);
  }
  return checks;
}

async function runAuditFlow(
  truth: ProductFlowRuntimeTruth,
  state: ProductFlowState,
  fetchImpl: ProductFlowFetch,
): Promise<JsonRecord> {
  if (!state.projectId) {
    throw new Error('audit flow missing project');
  }
  const end = new Date(Date.now() + 5 * 60_000).toISOString();
  const start = new Date(Date.parse(state.flowStartedAt) - 5 * 60_000).toISOString();
  const audit = await expectJson(
    fetchImpl,
    apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page_size=200`),
    { method: 'GET', headers: authHeaders(state) },
    200,
    'audit query',
  );
  const actions = itemsArray(audit).map((item) => stringValue(item, 'action'));
  const requiredAny = ['project.create', 'endpoint.create', 'chat.run.completed', 'notebook.task.created'];
  const matched = requiredAny.filter((action) => actions.includes(action));
  if (matched.length === 0) {
    throw new Error(`audit query did not contain any product action evidence: expected one of ${requiredAny.join(', ')}`);
  }
  return {
    total: numberValue(audit, 'total') ?? itemsArray(audit).length,
    matched_actions: matched,
    observed_actions: Array.from(new Set(actions)).sort(),
  };
}

async function runUsageFlow(
  truth: ProductFlowRuntimeTruth,
  state: ProductFlowState,
  fetchImpl: ProductFlowFetch,
): Promise<JsonRecord> {
  if (!state.projectId) {
    throw new Error('usage flow missing project');
  }
  const end = new Date(Date.now() + 5 * 60_000).toISOString();
  const start = new Date(Date.parse(state.flowStartedAt) - 5 * 60_000).toISOString();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const usage = await expectJson(
      fetchImpl,
      apiV1Url(truth, `workspaces/${encodeURIComponent(truth.workspaceId)}/projects/${encodeURIComponent(state.projectId)}/usage/facts?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page_size=200`),
      { method: 'GET', headers: authHeaders(state) },
      200,
      'usage facts query',
    );
    const facts = itemsArray(usage);
    const chatOrEndpoint = facts.filter((item) => {
      const resourceType = stringValue(item, 'resource_type');
      return resourceType === 'chat' || resourceType === 'endpoint';
    });
    if (chatOrEndpoint.length > 0) {
      return {
        total: numberValue(usage, 'total') ?? facts.length,
        matched_resource_types: Array.from(new Set(chatOrEndpoint.map((item) => stringValue(item, 'resource_type')))).sort(),
        matched_fact_ids: chatOrEndpoint.map((item) => stringValue(item, 'id')).filter((item) => item.length > 0),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('usage facts query did not contain chat or endpoint usage evidence after bounded polling');
}

async function runSingleFlow(args: {
  flow: ProductVerificationFlowId;
  truth: ProductFlowRuntimeTruth;
  state: ProductFlowState;
  command: string;
  fetchImpl: ProductFlowFetch;
  seedManagedRunner: (truth: ProductFlowRuntimeTruth, state: ProductFlowState) => Promise<DefaultManagedRunnerSeedResult>;
  now: () => Date;
  agentTaskPolls: number;
  agentTaskPollIntervalMs: number;
  fileLibraryCreateMaxAttempts: number;
  fileLibraryCreateRetryBaseMs: number;
  fileLibraryFailureEvidenceProvider: FileLibraryFailureEvidenceProvider;
}): Promise<ProductFlowEvidence> {
  const startedMs = Date.now();
  try {
    let checks: JsonRecord;
    if (args.flow === 'login_profile') {
      checks = await runLoginProfileFlow(args.truth, args.state, args.fetchImpl);
    } else if (args.flow === 'workspace_project') {
      checks = await ensureProject(args.truth, args.state, args.fetchImpl);
    } else if (args.flow === 'chat_via_llmup') {
      checks = await ensureEndpoint(args.truth, args.state, args.fetchImpl);
      checks = {
        ...checks,
        chat: await runChatViaLlmupFlow(args.truth, args.state, args.fetchImpl),
      };
    } else if (args.flow === 'files') {
      checks = await runFilesFlow(args.truth, args.state, args.fetchImpl, {
        fileLibraryCreateMaxAttempts: args.fileLibraryCreateMaxAttempts,
        fileLibraryCreateRetryBaseMs: args.fileLibraryCreateRetryBaseMs,
        failureEvidenceProvider: args.fileLibraryFailureEvidenceProvider,
      });
    } else if (args.flow === 'agent_task_managed_runner') {
      checks = await runAgentTaskManagedRunnerFlow({
        truth: args.truth,
        state: args.state,
        fetchImpl: args.fetchImpl,
        seedManagedRunner: args.seedManagedRunner,
        pollMax: args.agentTaskPolls,
        pollIntervalMs: args.agentTaskPollIntervalMs,
      });
    } else if (args.flow === 'audit') {
      checks = await runAuditFlow(args.truth, args.state, args.fetchImpl);
    } else if (args.flow === 'usage') {
      checks = await runUsageFlow(args.truth, args.state, args.fetchImpl);
    } else {
      throw new Error(`unknown product flow: ${args.flow satisfies never}`);
    }
    checks = withSchemaPreflightChecks(args.state.schemaPreflight, checks);
    return buildFlowEvidence({
      truth: args.truth,
      flow: args.flow,
      status: 'passed',
      command: args.command,
      startedMs,
      generatedAt: nowIso(args.now),
      checks,
    });
  } catch (error: unknown) {
    const failure = {
      path: `flow:${args.flow}`,
      message: `${flowLabel(args.flow)} failed: ${errorMessage(error)}`,
    };
    return buildFlowEvidence({
      truth: args.truth,
      flow: args.flow,
      status: 'failed',
      command: args.command,
      startedMs,
      generatedAt: nowIso(args.now),
      checks: withSchemaPreflightChecks(args.state.schemaPreflight, checksFromError(error)),
      failure,
    });
  }
}

function isDependencyBlockedFlow(flow: ProductFlowEvidence): boolean {
  return flow.failure?.code === DEPENDENCY_BLOCKED_CODE;
}

function rootCauseFlowFor(flow: ProductFlowEvidence): ProductVerificationFlowId {
  return flow.root_cause_flow ?? flow.failure?.root_cause_flow ?? flow.flow;
}

function firstFailedDependency(args: {
  flow: ProductVerificationFlowId;
  evidenceByFlow: Partial<Record<ProductVerificationFlowId, ProductFlowEvidence>>;
}): ProductFlowEvidence | null {
  const dependencies = FLOW_DEPENDENCIES[args.flow] ?? [];
  for (const dependency of dependencies) {
    const evidence = args.evidenceByFlow[dependency];
    if (evidence?.status === 'failed') {
      return evidence;
    }
  }
  return null;
}

function flowNeedsProvider(flow: ProductVerificationFlowId, state: ProductFlowState): boolean {
  return flow === 'chat_via_llmup' || (flow === 'agent_task_managed_runner' && !state.endpointId);
}

async function ensureProviderStartedForFlow(args: {
  flow: ProductVerificationFlowId;
  truth: ProductFlowRuntimeTruth;
  state: ProductFlowState;
  providerStarter: (truth: ProductFlowRuntimeTruth) => Promise<ProviderMockHandle>;
}): Promise<void> {
  if (!flowNeedsProvider(args.flow, args.state) || args.state.provider) {
    return;
  }
  args.state.provider = await args.providerStarter(args.truth);
  args.truth.provider.baseUrl = args.state.provider.baseUrl;
  assertPodRoutableProviderBaseUrl(args.state.provider.baseUrl);
}

function buildDependencyBlockedFlowEvidence(input: {
  truth: ProductFlowRuntimeTruth;
  flow: ProductVerificationFlowId;
  dependency: ProductFlowEvidence;
  command: string;
  startedMs: number;
  generatedAt: string;
}): ProductFlowEvidence {
  const blockedBy = input.dependency.flow;
  const rootCauseFlow = rootCauseFlowFor(input.dependency);
  const failure: ProductFlowFailure = {
    path: `flow:${input.flow}`,
    code: DEPENDENCY_BLOCKED_CODE,
    blocked_by: blockedBy,
    root_cause_flow: rootCauseFlow,
    message: `${flowLabel(input.flow)} blocked by ${blockedBy}; root_cause_flow=${rootCauseFlow}`,
  };

  return buildFlowEvidence({
    truth: input.truth,
    flow: input.flow,
    status: 'failed',
    command: input.command,
    startedMs: input.startedMs,
    generatedAt: input.generatedAt,
    checks: {
      blocked_by: blockedBy,
      root_cause_flow: rootCauseFlow,
      dependency_status: input.dependency.status,
      dependency_failure: input.dependency.failure,
    },
    blockedBy,
    rootCauseFlow,
    failure,
  });
}

function aggregateRootCauseFlow(flows: readonly ProductFlowEvidence[]): ProductVerificationFlowId | undefined {
  const failedFlows = flows.filter((flow) => flow.status === 'failed' || flow.failure);
  const primaryFailure = failedFlows.find((flow) => !isDependencyBlockedFlow(flow)) ?? failedFlows[0];
  return primaryFailure ? rootCauseFlowFor(primaryFailure) : undefined;
}

const NEUTRAL_SUBSTRATE_CONNECTION_SCHEMA_VERSION = 'agentsmith.substrate-connection.truth/v1';
const RUNTIME_SUBSTRATE_ENV_SOURCE_ENV_KEY = 'UNIFIED_DEPLOY_PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV_SOURCE';
const RUNTIME_SUBSTRATE_ENV_PATH_ENV_KEY = 'UNIFIED_DEPLOY_PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV';

function isNeutralSubstrateConnectionTruthJson(source: string): boolean {
  try {
    const parsed = JSON.parse(source) as unknown;
    return asRecord(parsed).schema_version === NEUTRAL_SUBSTRATE_CONNECTION_SCHEMA_VERSION;
  } catch {
    return false;
  }
}

function buildRuntimeSubstrateEnvSourceFromEnv(env: Record<string, string | undefined>): {
  source: string | null;
  missing: string[];
} {
  const requiredKeys = [SUBSTRATE_TRUTH_SCHEMA_ENV_KEY, ...DOCKER_SUBSTRATE_REQUIRED_ENV];
  const missing = requiredKeys.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    return { source: null, missing };
  }

  return {
    source: `${requiredKeys.map((key) => `${key}=${env[key]?.trim() ?? ''}`).join('\n')}\n`,
    missing: [],
  };
}

function runtimeSubstrateProjectionError(missing: readonly string[]): Error {
  const missingText = missing.length > 0
    ? ` Missing request env values: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}.`
    : '';
  return new Error(
    `neutral substrate truth JSON requires runtime-only substrate env projection via --runtime-substrate-env, ${RUNTIME_SUBSTRATE_ENV_SOURCE_ENV_KEY}, ${RUNTIME_SUBSTRATE_ENV_PATH_ENV_KEY}, or SUBSTRATE_* request env.${missingText}`,
  );
}

async function loadTruth(options: ProductFlowProducerOptions, fsDriver: ProductFlowFs): Promise<ProductFlowRuntimeTruth> {
  const siteEnvPath = path.resolve(options.siteEnvPath ?? DEFAULT_LIVE_SITE_ENV_PATH);
  const substrateTruthPath = path.resolve(options.substrateTruthPath ?? DEFAULT_LIVE_SUBSTRATE_TRUTH_PATH);
  const env = options.env ?? process.env;
  let siteEnvSource: string;
  try {
    siteEnvSource = await fsDriver.readFile(siteEnvPath);
  } catch (error: unknown) {
    if (options.siteEnvPath) {
      throw error;
    }
    siteEnvSource = await fsDriver.readFile(DEFAULT_SITE_ENV_PATH);
  }
  let evidenceSubstrateTruthSource: string;
  let evidenceSubstrateTruthPath = substrateTruthPath;
  try {
    evidenceSubstrateTruthSource = await fsDriver.readFile(substrateTruthPath);
  } catch (error: unknown) {
    if (options.substrateTruthPath) {
      throw error;
    }
    evidenceSubstrateTruthSource = await fsDriver.readFile(DEFAULT_SUBSTRATE_TRUTH_PATH);
    evidenceSubstrateTruthPath = DEFAULT_SUBSTRATE_TRUTH_PATH;
  }

  let runtimeSubstrateEnvSource = options.runtimeSubstrateEnvSource
    ?? env[RUNTIME_SUBSTRATE_ENV_SOURCE_ENV_KEY];
  let runtimeSubstrateEnvPath = options.runtimeSubstrateEnvPath
    ?? env[RUNTIME_SUBSTRATE_ENV_PATH_ENV_KEY];
  if (runtimeSubstrateEnvPath?.trim()) {
    runtimeSubstrateEnvPath = path.resolve(runtimeSubstrateEnvPath);
    runtimeSubstrateEnvSource = await fsDriver.readFile(runtimeSubstrateEnvPath);
  }

  if (!runtimeSubstrateEnvSource?.trim() && isNeutralSubstrateConnectionTruthJson(evidenceSubstrateTruthSource)) {
    const runtimeFromEnv = buildRuntimeSubstrateEnvSourceFromEnv(env);
    if (!runtimeFromEnv.source) {
      throw runtimeSubstrateProjectionError(runtimeFromEnv.missing);
    }
    runtimeSubstrateEnvSource = runtimeFromEnv.source;
  }

  const substrateTruthSource = runtimeSubstrateEnvSource?.trim()
    ? runtimeSubstrateEnvSource
    : evidenceSubstrateTruthSource;
  const runtimeSubstrateTruthPath = runtimeSubstrateEnvSource?.trim()
    ? (runtimeSubstrateEnvPath ?? RUNTIME_SUBSTRATE_ENV_SOURCE_ENV_KEY)
    : substrateTruthPath;
  return buildProductFlowRuntimeTruth({
    siteEnvSource,
    siteEnvPath,
    substrateTruthSource,
    substrateTruthPath: runtimeSubstrateTruthPath,
    evidenceSubstrateTruthPath,
    publicBaseUrl: options.publicBaseUrl,
    apiBaseUrl: options.apiBaseUrl,
    providerBaseUrl: options.providerBaseUrl,
    providerAdvertiseHost: options.providerAdvertiseHost,
    keycloakAdminBaseUrl: options.keycloakAdminBaseUrl,
    workspaceId: options.workspaceId,
    env,
  });
}

function resolveFlowIds(input: ProductFlowProducerOptions['flowIds']): ProductVerificationFlowId[] {
  if (!input || input.length === 0) {
    return [...FLOW_ORDER];
  }
  const known = new Set(PRODUCT_VERIFICATION_FLOWS.map((item) => item.id));
  for (const flow of input) {
    if (!known.has(flow)) {
      throw new Error(`unknown product flow: ${flow}`);
    }
  }
  return [...input];
}

function resolveProducerCommand(input: ProductFlowProducerOptions['producerCommand']): string {
  const command = input?.trim() || PRODUCT_FLOW_COMMAND;
  if (command.includes('\n') || command.includes('\r')) {
    throw new Error('--producer-command must be a single-line command label');
  }
  return command;
}

async function writeAggregateEvidence(args: {
  fs: ProductFlowFs;
  evidenceDir: string;
  prepareEvidenceDir?: ProductFlowEvidenceDirPreparer;
  truth: ProductFlowRuntimeTruth;
  command: string;
  flows: ProductFlowEvidence[];
  flowPaths: Partial<Record<ProductVerificationFlowId, string>>;
  generatedAt: string;
}): Promise<ProductFlowAggregateEvidence> {
  const evidenceDir = args.prepareEvidenceDir ? args.prepareEvidenceDir() : args.evidenceDir;
  if (!args.prepareEvidenceDir) {
    await args.fs.mkdir(evidenceDir, { recursive: true });
  }
  const failures: ProductFlowFailure[] = args.flows.flatMap((flow) => flow.failure ? [flow.failure] : []);
  const status: ProducerStatus = args.flows.length > 0 && failures.length === 0 && args.flows.every((flow) => flow.status === 'passed')
    ? 'passed'
    : 'failed';
  const rootCauseFlow = aggregateRootCauseFlow(args.flows);
  const basename = `product-flows-${args.generatedAt.replace(/[:.]/gu, '-')}`;
  const reportPath = path.join(evidenceDir, `${basename}.json`);
  const logPath = path.join(evidenceDir, `${basename}.log`);
  const source = sourceForEvidence(args.truth);
  const aggregate: ProductFlowAggregateEvidence = {
    schema_version: 'agentsmith.unified-deploy.product-flows.aggregate/v1',
    producer: PRODUCT_FLOW_PRODUCER,
    status,
    command: args.command,
    generated_at: args.generatedAt,
    source: {
      ...source,
      workspace_id: args.truth.workspaceId,
      postgres_db_name: args.truth.postgres.dbName,
      mongo_db_name: args.truth.mongo.dbName,
      minio_bucket: args.truth.minio.bucket,
      keycloak_realm: args.truth.keycloak.realm,
      keycloak_client_id: args.truth.keycloak.clientId,
    },
    flows: args.flows,
    flow_evidence_paths: args.flowPaths,
    ...(rootCauseFlow ? { root_cause_flow: rootCauseFlow } : {}),
    failures,
    paths: {
      report_path: reportPath,
      log_path: logPath,
    },
  };
  await args.fs.writeFile(reportPath, `${JSON.stringify(aggregate, null, 2)}\n`);
  await args.fs.writeFile(
    logPath,
    [
      `producer=${PRODUCT_FLOW_PRODUCER}`,
      `status=${status}`,
      `failures=${failures.length}`,
      `report_path=${reportPath}`,
      ...Object.entries(args.flowPaths).map(([flow, evidencePath]) => `product_evidence_${flow}=${evidencePath}`),
      '',
    ].join('\n'),
  );
  return aggregate;
}

export async function runUnifiedDeployProductFlowsProducer(
  options: ProductFlowProducerOptions = {},
): Promise<ProductFlowProducerResult> {
  const fsDriver = options.fs ?? defaultFs();
  const fetchImpl = options.fetch ?? fetch;
  const rawEvidenceDir = options.evidenceDir ?? DEFAULT_EVIDENCE_DIR;
  const prepareEvidenceDir = options.fs
    ? undefined
    : () => prepareUnifiedDeployEvidenceDir({
      evidenceDir: rawEvidenceDir,
      defaultRoot: DEFAULT_EVIDENCE_DIR,
      label: 'product-flow evidenceDir',
    });
  const evidenceDir = path.resolve(rawEvidenceDir);
  const now = options.now ?? (() => new Date());
  const truth = await loadTruth(options, fsDriver);
  if (truth.provider.baseUrl) {
    assertPodRoutableProviderBaseUrl(truth.provider.baseUrl);
  }
  const commandRunner = options.commandRunner
    ? buildNoServiceStartCommandRunner(options.commandRunner)
    : undefined;
  void commandRunner;
  const backendBootstrapper = options.backendBootstrapper ?? defaultBackendBootstrapper;
  const keycloakBootstrapper = options.keycloakBootstrapper
    ?? ((runtimeTruth: ProductFlowRuntimeTruth) => defaultKeycloakBootstrapper(runtimeTruth, fetchImpl));
  const workspaceBootstrapper = options.workspaceBootstrapper ?? defaultWorkspaceBootstrapper;
  const tokenProvider = options.tokenProvider
    ?? ((runtimeTruth: ProductFlowRuntimeTruth, user: { username: string; password: string }) => defaultTokenProvider(runtimeTruth, fetchImpl, user));
  const providerStarter = options.providerStarter ?? defaultProviderStarter;
  const seedManagedRunner = options.managedRunnerSeeder ?? defaultManagedRunnerSeeder;
  const fileLibraryFailureEvidenceProvider = options.fileLibraryFailureEvidenceProvider
    ?? defaultFileLibraryFailureEvidenceProvider;
  const generatedAt = nowIso(now);
  const flowIds = resolveFlowIds(options.flowIds);
  const producerCommand = resolveProducerCommand(options.producerCommand);
  let keycloak: KeycloakBootstrapResult;
  let token: string;
  let schemaPreflight: JsonRecord = {};
  try {
    schemaPreflight = schemaPreflightFromBootstrap(await backendBootstrapper(truth, fsDriver));
    keycloak = await keycloakBootstrapper(truth);
    await workspaceBootstrapper(truth, keycloak);
    token = await tokenProvider(truth, {
      username: truth.keycloak.devAdminUsername,
      password: truth.keycloak.devAdminPassword,
    });
  } catch (error: unknown) {
    const failureMessage = `product bootstrap failed: ${errorMessage(error)}`;
    const bootstrapChecks = checksFromError(error);
    const flowEvidence: ProductFlowEvidence[] = flowIds.map((flow) => buildFlowEvidence({
      truth,
      flow,
      status: 'failed',
      command: producerCommand,
      startedMs: Date.now(),
      generatedAt,
      checks: bootstrapChecks,
      failure: {
        path: `flow:${flow}`,
        message: `${flowLabel(flow)} blocked by ${failureMessage}`,
      },
    }));
    const flowPaths: Partial<Record<ProductVerificationFlowId, string>> = {};
    for (const evidence of flowEvidence) {
      flowPaths[evidence.flow] = await writeFlowEvidence({
        fs: fsDriver,
        evidenceDir,
        prepareEvidenceDir,
        evidence,
        generatedAt: evidence.generated_at,
      });
    }
    const aggregate = await writeAggregateEvidence({
      fs: fsDriver,
      evidenceDir,
      prepareEvidenceDir,
      truth,
      command: producerCommand,
      flows: flowEvidence,
      flowPaths,
      generatedAt,
    });
    return {
      status: aggregate.status,
      failures: aggregate.failures,
      evidence: aggregate,
    };
  }
  const state: ProductFlowState = {
    token,
    keycloak,
    schemaPreflight,
    flowStartedAt: generatedAt,
    requestIds: {},
  };

  const flowEvidence: ProductFlowEvidence[] = [];
  const flowPaths: Partial<Record<ProductVerificationFlowId, string>> = {};
  const evidenceByFlow: Partial<Record<ProductVerificationFlowId, ProductFlowEvidence>> = {};

  try {
    for (const flow of flowIds) {
      const failedDependency = firstFailedDependency({ flow, evidenceByFlow });
      const evidence = failedDependency
        ? buildDependencyBlockedFlowEvidence({
          truth,
          flow,
          dependency: failedDependency,
          command: producerCommand,
          startedMs: Date.now(),
          generatedAt: nowIso(now),
        })
        : await (async () => {
          const startedMs = Date.now();
          try {
            await ensureProviderStartedForFlow({
              flow,
              truth,
              state,
              providerStarter,
            });
          } catch (error: unknown) {
            return buildFlowEvidence({
              truth,
              flow,
              status: 'failed',
              command: producerCommand,
              startedMs,
              generatedAt: nowIso(now),
              checks: withSchemaPreflightChecks(state.schemaPreflight, {}),
              failure: {
                path: `flow:${flow}`,
                message: errorMessage(error),
              },
            });
          }

          return runSingleFlow({
            flow,
            truth,
            state,
            command: producerCommand,
            fetchImpl,
            seedManagedRunner,
            now,
            agentTaskPolls: options.agentTaskPolls ?? DEFAULT_AGENT_TASK_POLLS,
            agentTaskPollIntervalMs: options.agentTaskPollIntervalMs ?? DEFAULT_AGENT_TASK_POLL_INTERVAL_MS,
            fileLibraryCreateMaxAttempts: options.fileLibraryCreateMaxAttempts ?? DEFAULT_FILE_LIBRARY_CREATE_MAX_ATTEMPTS,
            fileLibraryCreateRetryBaseMs: options.fileLibraryCreateRetryBaseMs ?? DEFAULT_FILE_LIBRARY_CREATE_RETRY_BASE_MS,
            fileLibraryFailureEvidenceProvider,
          });
        })();
      flowEvidence.push(evidence);
      evidenceByFlow[flow] = evidence;
      flowPaths[flow] = await writeFlowEvidence({
        fs: fsDriver,
        evidenceDir,
        prepareEvidenceDir,
        evidence,
        generatedAt: evidence.generated_at,
      });
    }
  } finally {
    await state.provider?.close();
  }

  const aggregate = await writeAggregateEvidence({
    fs: fsDriver,
    evidenceDir,
    prepareEvidenceDir,
    truth,
    command: producerCommand,
    flows: flowEvidence,
    flowPaths,
    generatedAt,
  });
  return {
    status: aggregate.status,
    failures: aggregate.failures,
    evidence: aggregate,
  };
}

type CliOptions = ProductFlowProducerOptions;

function parseFlow(value: string): ProductVerificationFlowId {
  if (PRODUCT_VERIFICATION_FLOWS.some((item) => item.id === value)) {
    return value as ProductVerificationFlowId;
  }
  throw new Error(`unknown product flow: ${value}`);
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  const flows: ProductVerificationFlowId[] = [];
  for (const arg of argv) {
    if (arg.startsWith('--site-env=')) {
      options.siteEnvPath = arg.slice('--site-env='.length);
    } else if (arg.startsWith('--substrate-truth=')) {
      options.substrateTruthPath = arg.slice('--substrate-truth='.length);
    } else if (arg.startsWith('--runtime-substrate-env=')) {
      options.runtimeSubstrateEnvPath = arg.slice('--runtime-substrate-env='.length);
    } else if (arg.startsWith('--public-base-url=')) {
      options.publicBaseUrl = arg.slice('--public-base-url='.length);
    } else if (arg.startsWith('--api-base=')) {
      options.apiBaseUrl = arg.slice('--api-base='.length);
    } else if (arg.startsWith('--provider-base-url=')) {
      options.providerBaseUrl = arg.slice('--provider-base-url='.length);
    } else if (arg.startsWith('--provider-advertise-host=')) {
      options.providerAdvertiseHost = arg.slice('--provider-advertise-host='.length);
    } else if (arg.startsWith('--keycloak-admin-base-url=')) {
      options.keycloakAdminBaseUrl = arg.slice('--keycloak-admin-base-url='.length);
    } else if (arg.startsWith('--workspace-id=')) {
      options.workspaceId = arg.slice('--workspace-id='.length);
    } else if (arg.startsWith('--evidence-dir=')) {
      options.evidenceDir = arg.slice('--evidence-dir='.length);
    } else if (arg.startsWith('--producer-command=')) {
      options.producerCommand = arg.slice('--producer-command='.length);
    } else if (arg.startsWith('--flow=')) {
      flows.push(parseFlow(arg.slice('--flow='.length)));
    } else if (arg.startsWith('--agent-task-polls=')) {
      const value = Number.parseInt(arg.slice('--agent-task-polls='.length), 10);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--agent-task-polls must be a positive integer');
      }
      options.agentTaskPolls = value;
    } else if (arg.startsWith('--agent-task-poll-interval-ms=')) {
      const value = Number.parseInt(arg.slice('--agent-task-poll-interval-ms='.length), 10);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error('--agent-task-poll-interval-ms must be a non-negative integer');
      }
      options.agentTaskPollIntervalMs = value;
    } else if (arg.startsWith('--file-library-create-attempts=')) {
      const value = Number.parseInt(arg.slice('--file-library-create-attempts='.length), 10);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--file-library-create-attempts must be a positive integer');
      }
      options.fileLibraryCreateMaxAttempts = value;
    } else if (arg.startsWith('--file-library-create-retry-base-ms=')) {
      const value = Number.parseInt(arg.slice('--file-library-create-retry-base-ms='.length), 10);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error('--file-library-create-retry-base-ms must be a non-negative integer');
      }
      options.fileLibraryCreateRetryBaseMs = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (flows.length > 0) {
    options.flowIds = flows;
  }
  return options;
}

async function main(): Promise<void> {
  const result = await runUnifiedDeployProductFlowsProducer(parseCliOptions(process.argv.slice(2)));
  const productArgs = Object.entries(result.evidence.flow_evidence_paths)
    .map(([flow, evidencePath]) => `--product-evidence=${flow}=${evidencePath}`)
    .join(' ');
  const message = [
    `[unified-deploy] product flows ${result.status}`,
    `[unified-deploy] evidence: ${result.evidence.paths.report_path}`,
    `[unified-deploy] verification-report aggregate arg: --product-flows=${result.evidence.paths.report_path}`,
    productArgs ? `[unified-deploy] verification-report args: ${productArgs}` : '',
    '',
  ].filter((line) => line.length > 0).join('\n');
  if (result.status === 'passed') {
    process.stdout.write(`${message}\n`);
    return;
  }
  process.stderr.write(`${result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n')}\n${message}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
