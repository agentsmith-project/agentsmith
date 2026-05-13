import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import { checkAddressTruth } from './check-address-truth';
import { checkApiSingleReplica } from './check-api-single-replica';
import {
  DEFAULT_LOCAL_KIND_SITE_ENV_PATH,
  checkLocalKindImagePreflight,
  type LocalKindImagePreflightResult,
} from './check-local-kind-images';
import { checkRenderedOutput } from './check-render';
import { fingerprintRenderedManifest } from './evidence';
import {
  REPO_ROOT,
  asRecord,
  loadUnifiedDeployManifest,
  manifestRequiredEnv,
  prepareUnifiedDeployEvidenceDir,
  type CheckFailure,
} from './manifest';
import {
  parseKubernetesDocuments,
  resourceKind,
  resourceName,
} from './kubernetes';
import {
  DEFAULT_TEMPLATES_ROOT,
  parseSiteEnv,
  renderUnifiedDeployFromFiles,
  renderUnifiedDeployPreflightFromFiles,
} from './render';
import {
  DEFAULT_LIVE_SUBSTRATE_TRUTH_PATH,
  parseSubstrateTruth,
} from './substrate-truth';
import {
  DEFAULT_SUBSTRATE_COMPOSE_PROJECT,
  checkSubstrateRuntimeTruth,
  skippedSubstrateRuntimeTruthSummary,
  type SubstrateCommandInvocation,
  type SubstrateRuntimeTruthSummary,
} from './substrate-lifecycle';

type ProducerStatus = 'passed' | 'failed';
type StepStatus = 'passed' | 'failed' | 'skipped';

export type LocalKindCommandRunOptions = {
  input?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

export type LocalKindCommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type LocalKindCommandRunner = (
  command: string,
  args: string[],
  options?: LocalKindCommandRunOptions,
) => Promise<LocalKindCommandRunResult>;

export type LocalKindHttpProbeResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type LocalKindHttpProbeRunner = (
  url: string,
  options: { method: 'GET'; headers?: Record<string, string>; timeoutMs?: number },
) => Promise<LocalKindHttpProbeResult>;

type KubeconfigResolution = {
  path?: string;
  source: 'explicit' | 'default' | 'missing';
  attempted: string[];
};

type ResourceSummary = {
  total: number;
  kinds: Record<string, number>;
  resources: string[];
};

type OperationEvidence = {
  name:
    | 'admin-namespace-dry-run'
    | 'admin-namespace-apply'
    | 'admin-preflight-dry-run'
    | 'admin-preflight-apply'
    | 'ingress-class-check'
    | 'ingress-controller-rollout'
    | 'ingress-admission-create-check'
    | 'ingress-admission-create-wait'
    | 'ingress-admission-patch-check'
    | 'ingress-admission-patch-wait'
    | 'substrate-endpointslice-reconcile-check'
    | 'substrate-endpointslice-reconcile-delete'
    | 'app-dry-run'
    | 'app-apply';
  command: string;
  status: StepStatus;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
};

type RolloutEvidence = {
  deployment: string;
  status: StepStatus;
  command: string;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
};

type LlmupConfigHealthEvidence = {
  status: StepStatus;
  config_map: string;
  admin_token_secret: string;
  readiness_path: string;
  liveness_path: string;
  rollout_status: StepStatus;
};

type RouteProbeEvidence = {
  name: 'web-public-workspaces' | 'api-profile' | 'api-agent-execution-ws' | 'internal-services-not-exposed';
  path: string;
  url?: string;
  expected: string;
  status: StepStatus;
  status_code?: number;
  content_type?: string;
  diagnostic?: string;
};

type LocalKindRolloutEvidence = {
  schema_version: 'agentsmith.unified-deploy.local-kind-rollout.evidence/v1';
  producer: 'local-kind-rollout';
  status: ProducerStatus;
  generated_at: string;
  profile: 'local-kind';
  safety: {
    kubeconfig: KubeconfigResolution['source'];
    attempted_kubeconfig: string[];
    context: string;
    namespace: string;
    status: StepStatus;
  };
  rendered_manifest_fingerprint: string;
  admin_preflight_fingerprint: string;
  substrate_truth_fingerprint: string;
  substrate_live_check: SubstrateRuntimeTruthSummary;
  manifest_summary: ResourceSummary;
  image_refs: Record<string, string>;
  image_preflight: LocalKindImagePreflightResult;
  operations: OperationEvidence[];
  rollouts: RolloutEvidence[];
  llmup_config_health: LlmupConfigHealthEvidence;
  live_api_replica_check: {
    status: StepStatus;
    desired_replicas?: number;
    ready_replicas?: number;
    available_replicas?: number;
  };
  forbidden_resource_check: {
    status: StepStatus;
    checked_kinds: string[];
  };
  route_probes: RouteProbeEvidence[];
  failures: CheckFailure[];
  paths: {
    report_path: string;
    log_path: string;
  };
};

export type LocalKindRolloutProducerOptions = {
  siteEnvPath?: string;
  substrateTruthPath?: string;
  manifestPath?: string;
  templatesRoot?: string;
  evidenceDir?: string;
  kubeconfigPath?: string;
  localKindSiteEnvPath?: string;
  localKindSubstrateTruthPath?: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  publicBaseUrl?: string;
  runner?: LocalKindCommandRunner;
  probeRunner?: LocalKindHttpProbeRunner;
};

export type LocalKindRolloutProducerResult = {
  status: ProducerStatus;
  failures: CheckFailure[];
  evidence: LocalKindRolloutEvidence;
};

type RenderedInputs = {
  preflightYaml: string;
  appYaml: string;
  secretValues: string[];
  publicBaseUrl: string;
};

type SiteEnvResolution = {
  path?: string;
  source: 'explicit' | 'generated' | 'missing';
  attempted: string[];
};

type SubstrateTruthResolution = {
  path?: string;
  source: 'explicit' | 'lifecycle' | 'missing';
  attempted: string[];
};

const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, 'artifacts', 'unified-deploy');
const KUBECTL_REQUEST_TIMEOUT = '20s';
const KUBECTL_TIMEOUT_MS = 45_000;
const PROBE_TIMEOUT_MS = 10_000;
const ROLLOUT_TIMEOUT = '30s';
const INGRESS_ROLLOUT_TIMEOUT = '240s';
const LOCAL_KIND_NAMESPACE = 'agentsmith';
const LOCAL_KIND_INGRESS_NAMESPACE = 'ingress-nginx';
const LOCAL_KIND_INGRESS_CLASS = 'nginx';
const LOCAL_KIND_CONTROL_PLANE_NODE = 'agentsmith-control-plane';
const LOCAL_KIND_INGRESS_NODE_PORT = '30080';
const LOCAL_KIND_INGRESS_HOST_PORT = '29180';
const ROLLOUT_DEPLOYMENTS = [
  'agentsmith-web',
  'agentsmith-api',
  'agentsmith-llmup',
  'afscp-api',
  'afscp-worker',
  'afscp-export-gateway',
  'agentsmith-sandbox-manager',
] as const;
const SECRET_FIELD_KEY_PATTERN = /(?:PASSWORD|SECRET|TOKEN|PRIVATE|ACCESS[_-]?KEY|API[_-]?KEY|CREDENTIAL|DATABASE_URL|MONGO_URL|MONGODB_URI|REDIS_URL|CLIENT_SECRET|AUTHORIZATION)/iu;
const SECRET_VALUE_PATTERN = /(?:password|secret|token|access[_-]?key|api[_-]?key|credential|client[_-]?secret)/iu;
const PUBLIC_VALUE_DENYLIST = new Set(['agentsmith', 'admin', 'admin-cli', 'public', 'true', 'false']);
const EMPTY_SUMMARY: ResourceSummary = {
  total: 0,
  kinds: {},
  resources: [],
};
const EMPTY_LLMUP_CONFIG_HEALTH: LlmupConfigHealthEvidence = {
  status: 'skipped',
  config_map: 'agentsmith-llmup-config',
  admin_token_secret: 'agentsmith-app-secrets/MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN',
  readiness_path: '/health',
  liveness_path: '/health',
  rollout_status: 'skipped',
};

function addFailure(failures: CheckFailure[], failurePath: string, message: string): void {
  failures.push({ path: failurePath, message });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function addSecretValue(secrets: Set<string>, value: string, options: { force?: boolean } = {}): void {
  const trimmed = value.trim();
  if (trimmed.length < 4) {
    return;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.password) {
      addSecretValue(secrets, parsed.password, { force: true });
      addSecretValue(secrets, decodeURIComponent(parsed.password), { force: true });
    }
  } catch {
    // Non-URL values are expected here.
  }

  if (PUBLIC_VALUE_DENYLIST.has(trimmed.toLowerCase())) {
    return;
  }
  if (!options.force && !SECRET_VALUE_PATTERN.test(trimmed)) {
    return;
  }

  secrets.add(trimmed);
}

function collectRenderedSecretValues(renderedYaml: string): string[] {
  const parsed = parseKubernetesDocuments(renderedYaml);
  const secrets = new Set<string>();

  for (const document of parsed.documents) {
    if (resourceKind(document) !== 'Secret') {
      continue;
    }

    for (const field of ['data', 'stringData', 'binaryData']) {
      const values = document[field];
      if (values === null || typeof values !== 'object' || Array.isArray(values)) {
        continue;
      }

      for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
        if (typeof value !== 'string') {
          continue;
        }
        addSecretValue(secrets, value, { force: SECRET_FIELD_KEY_PATTERN.test(key) });
        if (field === 'data' || field === 'binaryData') {
          try {
            addSecretValue(secrets, Buffer.from(value, 'base64').toString('utf8'), {
              force: SECRET_FIELD_KEY_PATTERN.test(key),
            });
          } catch {
            // Invalid base64 will be reported by Kubernetes validation when relevant.
          }
        }
      }
    }
  }

  return [...secrets].sort((left, right) => right.length - left.length);
}

function redactDiagnostic(value: string, secretValues: readonly string[] = []): string {
  let redacted = value
    .replace(/\/\/([^:\s/]+):([^@\s/]+)@/gu, '//$1:[REDACTED]@')
    .replace(/\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|ACCESS_KEY|API_KEY|DATABASE_URL|MONGO_URL|REDIS_URL|CLIENT_SECRET)[A-Z0-9_]*)=([^\s]+)/giu, '$1=[REDACTED]');

  for (const secret of secretValues) {
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), 'gu'), '[REDACTED]');
  }

  return redacted.slice(0, 4000);
}

function substrateCommandRunnerFromLocalKind(
  runner: LocalKindCommandRunner,
): (invocation: SubstrateCommandInvocation) => Promise<LocalKindCommandRunResult> {
  return (invocation) => runner(invocation.executable, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    timeoutMs: KUBECTL_TIMEOUT_MS,
  });
}

function localKindSubstrateLiveFailures(check: SubstrateRuntimeTruthSummary): CheckFailure[] {
  return check.failures.map((failure) => ({
    path: failure.path,
    message: `${failure.message}; run npm run test:unified-deploy:substrate-lifecycle and fix Docker substrate before local-kind rollout`,
  }));
}

function summarizeRenderedManifest(renderedYaml: string): ResourceSummary {
  const parsed = parseKubernetesDocuments(renderedYaml);
  const kinds: Record<string, number> = {};
  const resources: string[] = [];

  for (const document of parsed.documents) {
    const kind = resourceKind(document);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    resources.push(`${kind}/${resourceName(document)}`);
  }

  return {
    total: resources.length,
    kinds: Object.fromEntries(Object.entries(kinds).sort(([left], [right]) => left.localeCompare(right))),
    resources: resources.sort(),
  };
}

function collectImageRefs(renderedYaml: string): Record<string, string> {
  const parsed = parseKubernetesDocuments(renderedYaml);
  const images: Record<string, string> = {};

  for (const document of parsed.documents) {
    const kind = resourceKind(document);
    if (kind === 'ConfigMap' && resourceName(document) === 'agentsmith-managed-runner-support') {
      const managedRunnerImage = asRecord(document.data).DEFAULT_MANAGED_RUNNER_IMAGE;
      if (typeof managedRunnerImage === 'string') {
        images['agentsmith-managed-runner-support/DEFAULT_MANAGED_RUNNER_IMAGE'] = managedRunnerImage;
      }
      continue;
    }
    if (kind !== 'Deployment' && kind !== 'Job') {
      continue;
    }
    const workloadName = resourceName(document);
    const podSpec = asRecord(asRecord(asRecord(document.spec).template).spec);
    const containers = [
      ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers as unknown[] : []),
      ...(Array.isArray(podSpec.containers) ? podSpec.containers as unknown[] : []),
    ];
    for (const container of containers) {
      const containerRecord = asRecord(container);
      if (typeof containerRecord.name === 'string' && typeof containerRecord.image === 'string') {
        const key = kind === 'Deployment'
          ? `${workloadName}/${containerRecord.name}`
          : `job/${workloadName}/${containerRecord.name}`;
        images[key] = containerRecord.image;
      }
    }
  }

  return Object.fromEntries(Object.entries(images).sort(([left], [right]) => left.localeCompare(right)));
}

function findRenderedResource(
  renderedYaml: string,
  kind: string,
  name: string,
): Record<string, unknown> {
  const parsed = parseKubernetesDocuments(renderedYaml);
  return parsed.documents.find((document) =>
    resourceKind(document) === kind && resourceName(document) === name,
  ) ?? {};
}

function renderedDeploymentContainer(
  renderedYaml: string,
  deploymentName: string,
  containerName: string,
): Record<string, unknown> {
  const deployment = findRenderedResource(renderedYaml, 'Deployment', deploymentName);
  const podSpec = asRecord(asRecord(asRecord(asRecord(deployment.spec).template).spec));
  const containers = Array.isArray(podSpec.containers) ? podSpec.containers.map(asRecord) : [];
  return containers.find((container) => container.name === containerName) ?? {};
}

function renderedDeploymentPodSpec(renderedYaml: string, deploymentName: string): Record<string, unknown> {
  const deployment = findRenderedResource(renderedYaml, 'Deployment', deploymentName);
  return asRecord(asRecord(asRecord(asRecord(deployment.spec).template).spec));
}

function renderedContainerEnvEntry(container: Record<string, unknown>, name: string): Record<string, unknown> {
  const env = Array.isArray(container.env) ? container.env.map(asRecord) : [];
  return env.find((entry) => entry.name === name) ?? {};
}

function renderedStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function buildLlmupConfigHealthEvidence(
  appYaml: string,
  rollouts: readonly RolloutEvidence[],
): { evidence: LlmupConfigHealthEvidence; failures: CheckFailure[] } {
  const failures: CheckFailure[] = [];
  const configMap = findRenderedResource(appYaml, 'ConfigMap', 'agentsmith-llmup-config');
  const configYaml = asRecord(configMap.data)['config.yaml'];
  const container = renderedDeploymentContainer(appYaml, 'agentsmith-llmup', 'llmup');
  const podSpec = renderedDeploymentPodSpec(appYaml, 'agentsmith-llmup');
  const rolloutStatus = rollouts.find((rollout) => rollout.deployment === 'agentsmith-llmup')?.status ?? 'skipped';

  if (typeof configYaml !== 'string' || !configYaml.includes('listen: 0.0.0.0:8080') || !configYaml.includes('mode: client_provider_key')) {
    addFailure(failures, 'llmup:ConfigMap/agentsmith-llmup-config', 'llmup config must render listen address and client_provider_key auth mode');
  }
  if (renderedStringArray(container.args).join('\0') !== ['--config', '/app/config/config.yaml'].join('\0')) {
    addFailure(failures, 'llmup:Deployment/agentsmith-llmup', 'llmup must start with --config /app/config/config.yaml');
  }
  if (asRecord(renderedContainerEnvEntry(container, 'LLM_UNIVERSAL_PROXY_ADMIN_TOKEN').valueFrom).secretKeyRef === undefined) {
    addFailure(failures, 'llmup:Deployment/agentsmith-llmup', 'llmup must consume admin token from app Secret');
  } else {
    const secretKeyRef = asRecord(asRecord(renderedContainerEnvEntry(container, 'LLM_UNIVERSAL_PROXY_ADMIN_TOKEN').valueFrom).secretKeyRef);
    if (secretKeyRef.name !== 'agentsmith-app-secrets' || secretKeyRef.key !== 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN') {
      addFailure(failures, 'llmup:Deployment/agentsmith-llmup', 'llmup admin token must come from agentsmith-app-secrets/MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
    }
  }

  for (const probeName of ['readinessProbe', 'livenessProbe'] as const) {
    const httpGet = asRecord(asRecord(container[probeName]).httpGet);
    if (httpGet.path !== '/health' || httpGet.port !== 'http') {
      addFailure(failures, 'llmup:Deployment/agentsmith-llmup', `llmup ${probeName} must probe /health on the http port`);
    }
  }

  const volumeMounts = Array.isArray(container.volumeMounts) ? container.volumeMounts.map(asRecord) : [];
  const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];
  if (!volumeMounts.some((mount) =>
    mount.name === 'llmup-config'
    && mount.mountPath === '/app/config/config.yaml'
    && mount.subPath === 'config.yaml'
    && mount.readOnly === true,
  )) {
    addFailure(failures, 'llmup:Deployment/agentsmith-llmup', 'llmup must mount config.yaml read-only by subPath');
  }
  if (!volumes.some((volume) =>
    volume.name === 'llmup-config'
    && asRecord(volume.configMap).name === 'agentsmith-llmup-config',
  )) {
    addFailure(failures, 'llmup:Deployment/agentsmith-llmup', 'llmup must mount agentsmith-llmup-config');
  }
  if (rolloutStatus !== 'passed') {
    addFailure(failures, 'llmup:rollout', 'agentsmith-llmup rollout must pass to prove llmup readiness');
  }

  return {
    evidence: {
      ...EMPTY_LLMUP_CONFIG_HEALTH,
      status: failures.length === 0 ? 'passed' : 'failed',
      rollout_status: rolloutStatus,
    },
    failures,
  };
}

function stringifyKubernetesDocuments(documents: readonly Record<string, unknown>[]): string {
  if (documents.length === 0) {
    return '';
  }

  return documents
    .map((document) => YAML.stringify(document).trim())
    .filter((document) => document.length > 0)
    .join('\n---\n') + '\n';
}

function splitAdminPreflightYaml(preflightYaml: string): { namespaceYaml: string; resourceYaml: string } {
  const parsed = parseKubernetesDocuments(preflightYaml);
  if (!parsed.ok) {
    throw new Error(parsed.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n'));
  }

  const namespaces: Record<string, unknown>[] = [];
  const resources: Record<string, unknown>[] = [];
  for (const document of parsed.documents) {
    if (resourceKind(document) === 'Namespace') {
      namespaces.push(document);
    } else {
      resources.push(document);
    }
  }

  return {
    namespaceYaml: stringifyKubernetesDocuments(namespaces),
    resourceYaml: stringifyKubernetesDocuments(resources),
  };
}

function resolveKubeconfig(options: {
  kubeconfigPath?: string;
  env: Record<string, string | undefined>;
  homeDir: string;
}): KubeconfigResolution {
  if (options.kubeconfigPath) {
    const resolved = path.resolve(options.kubeconfigPath);
    return existsSync(resolved)
      ? { path: resolved, source: 'explicit', attempted: [resolved] }
      : { source: 'missing', attempted: [resolved] };
  }

  const envKubeconfig = options.env.KUBECONFIG?.trim();
  if (envKubeconfig) {
    const candidates = envKubeconfig
      .split(path.delimiter)
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate.length > 0)
      .map((candidate) => path.resolve(candidate));
    const existing = candidates.find((candidate) => existsSync(candidate));
    return existing
      ? { path: existing, source: 'explicit', attempted: candidates }
      : { source: 'missing', attempted: candidates };
  }

  const defaultPath = path.join(options.homeDir, '.kube', 'config');
  return existsSync(defaultPath)
    ? { path: defaultPath, source: 'default', attempted: [defaultPath] }
    : { source: 'missing', attempted: [defaultPath] };
}

function resolveSiteEnv(options: LocalKindRolloutProducerOptions): SiteEnvResolution {
  if (options.siteEnvPath) {
    const resolved = path.resolve(options.siteEnvPath);
    return existsSync(resolved)
      ? { path: resolved, source: 'explicit', attempted: [resolved] }
      : { source: 'missing', attempted: [resolved] };
  }

  const generatedPath = path.resolve(options.localKindSiteEnvPath ?? DEFAULT_LOCAL_KIND_SITE_ENV_PATH);
  return existsSync(generatedPath)
    ? { path: generatedPath, source: 'generated', attempted: [generatedPath] }
    : { source: 'missing', attempted: [generatedPath] };
}

function resolveSubstrateTruth(options: LocalKindRolloutProducerOptions): SubstrateTruthResolution {
  if (options.substrateTruthPath) {
    const resolved = path.resolve(options.substrateTruthPath);
    return existsSync(resolved)
      ? { path: resolved, source: 'explicit', attempted: [resolved] }
      : { source: 'missing', attempted: [resolved] };
  }

  const lifecyclePath = path.resolve(options.localKindSubstrateTruthPath ?? DEFAULT_LIVE_SUBSTRATE_TRUTH_PATH);
  return existsSync(lifecyclePath)
    ? { path: lifecyclePath, source: 'lifecycle', attempted: [lifecyclePath] }
    : { source: 'missing', attempted: [lifecyclePath] };
}

function kubeBaseArgs(kubeconfigPath: string): string[] {
  return ['--kubeconfig', kubeconfigPath, `--request-timeout=${KUBECTL_REQUEST_TIMEOUT}`];
}

function commandText(args: readonly string[]): string {
  return `kubectl ${args.join(' ')}`;
}

function isLocalKindContext(context: string): boolean {
  return context === 'kind-agentsmith';
}

function isLocalProbeBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();

    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.port === LOCAL_KIND_INGRESS_HOST_PORT
      && (
        hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname.startsWith('127.')
        || hostname === '::1'
        || hostname === '[::1]'
        || hostname.endsWith('.localtest.me')
      );
  } catch {
    return false;
  }
}

function hasExpectedIngressPortMapping(source: string): boolean {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => line.endsWith(`:${LOCAL_KIND_INGRESS_HOST_PORT}`));
}

export async function defaultLocalKindCommandRunner(
  command: string,
  args: string[],
  options: LocalKindCommandRunOptions = {},
): Promise<LocalKindCommandRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs ?? KUBECTL_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: 127,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout,
        stderr: timedOut
          ? `${stderr}${stderr ? '\n' : ''}kubectl timed out after ${options.timeoutMs ?? KUBECTL_TIMEOUT_MS}ms`
          : stderr,
      });
    });
    child.stdin.end(options.input ?? '');
  });
}

export async function defaultLocalKindHttpProbeRunner(
  url: string,
  options: { method: 'GET'; headers?: Record<string, string>; timeoutMs?: number },
): Promise<LocalKindHttpProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      signal: controller.signal,
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function currentContext(options: {
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
}): Promise<LocalKindCommandRunResult> {
  return options.runner('kubectl', [
    ...kubeBaseArgs(options.kubeconfigPath),
    'config',
    'current-context',
  ], {
    cwd: REPO_ROOT,
    env: {
      ...options.env,
      KUBECONFIG: options.kubeconfigPath,
    },
    timeoutMs: KUBECTL_TIMEOUT_MS,
  });
}

async function runKubectlOperation(options: {
  name: OperationEvidence['name'];
  args: string[];
  input: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  kubeconfigPath: string;
  secretValues: readonly string[];
}): Promise<{ evidence: OperationEvidence; failure?: CheckFailure }> {
  const result = await options.runner('kubectl', options.args, {
    input: options.input,
    cwd: REPO_ROOT,
    env: {
      ...options.env,
      KUBECONFIG: options.kubeconfigPath,
    },
    timeoutMs: KUBECTL_TIMEOUT_MS,
  });
  const evidence: OperationEvidence = {
    name: options.name,
    command: commandText(options.args),
    status: result.exitCode === 0 ? 'passed' : 'failed',
    exit_code: result.exitCode,
    stdout: redactDiagnostic(result.stdout, options.secretValues),
    stderr: redactDiagnostic(result.stderr, options.secretValues),
  };

  return {
    evidence,
    failure: result.exitCode === 0
      ? undefined
      : {
        path: `kubectl:${options.name}`,
        message: redactDiagnostic(result.stderr || result.stdout || `kubectl exited ${result.exitCode}`, options.secretValues),
      },
  };
}

async function runKubectlCheck(options: {
  name: OperationEvidence['name'];
  args: string[];
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  kubeconfigPath: string;
  secretValues: readonly string[];
  statusWhenFailed?: StepStatus;
}): Promise<{ evidence: OperationEvidence; failure?: CheckFailure; raw: LocalKindCommandRunResult }> {
  const result = await options.runner('kubectl', options.args, {
    cwd: REPO_ROOT,
    env: {
      ...options.env,
      KUBECONFIG: options.kubeconfigPath,
    },
    timeoutMs: KUBECTL_TIMEOUT_MS,
  });
  const evidence: OperationEvidence = {
    name: options.name,
    command: commandText(options.args),
    status: result.exitCode === 0 ? 'passed' : options.statusWhenFailed ?? 'failed',
    exit_code: result.exitCode,
    stdout: redactDiagnostic(result.stdout, options.secretValues),
    stderr: redactDiagnostic(result.stderr, options.secretValues),
  };

  return {
    evidence,
    raw: result,
    failure: result.exitCode === 0
      ? undefined
      : {
        path: `kubectl:${options.name}`,
        message: redactDiagnostic(result.stderr || result.stdout || `kubectl exited ${result.exitCode}`, options.secretValues),
      },
  };
}

function isNotFoundKubectlResult(result: LocalKindCommandRunResult): boolean {
  return /notfound|not found/u.test(`${result.stderr}\n${result.stdout}`.toLowerCase());
}

async function rolloutDeployment(options: {
  deployment: string;
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ evidence: RolloutEvidence; failure?: CheckFailure }> {
  const args = [
    ...kubeBaseArgs(options.kubeconfigPath),
    '-n',
    options.namespace,
    'rollout',
    'status',
    `deployment/${options.deployment}`,
    `--timeout=${ROLLOUT_TIMEOUT}`,
  ];
  const result = await options.runner('kubectl', args, {
    cwd: REPO_ROOT,
    env: {
      ...options.env,
      KUBECONFIG: options.kubeconfigPath,
    },
    timeoutMs: KUBECTL_TIMEOUT_MS,
  });
  const evidence: RolloutEvidence = {
    deployment: options.deployment,
    command: commandText(args),
    status: result.exitCode === 0 ? 'passed' : 'failed',
    exit_code: result.exitCode,
    stdout: redactDiagnostic(result.stdout, options.secretValues),
    stderr: redactDiagnostic(result.stderr, options.secretValues),
  };

  return {
    evidence,
    failure: result.exitCode === 0
      ? undefined
      : {
        path: `rollout:${options.deployment}`,
        message: redactDiagnostic(result.stderr || result.stdout || `kubectl rollout exited ${result.exitCode}`, options.secretValues),
      },
  };
}

function parseJsonObject(source: string): Record<string, unknown> {
  const parsed = JSON.parse(source) as unknown;
  return asRecord(parsed);
}

async function kubectlJson(options: {
  args: string[];
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ ok: true; value: Record<string, unknown>; stdout: string; stderr: string } | { ok: false; failure: CheckFailure; stdout: string; stderr: string; exitCode: number }> {
  const result = await options.runner('kubectl', options.args, {
    cwd: REPO_ROOT,
    env: {
      ...options.env,
      KUBECONFIG: options.kubeconfigPath,
    },
    timeoutMs: KUBECTL_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    return {
      ok: false,
      failure: {
        path: 'kubectl:get',
        message: redactDiagnostic(result.stderr || result.stdout || `kubectl exited ${result.exitCode}`, options.secretValues),
      },
      stdout: redactDiagnostic(result.stdout, options.secretValues),
      stderr: redactDiagnostic(result.stderr, options.secretValues),
      exitCode: result.exitCode,
    };
  }

  try {
    return {
      ok: true,
      value: parseJsonObject(result.stdout),
      stdout: redactDiagnostic(result.stdout, options.secretValues),
      stderr: redactDiagnostic(result.stderr, options.secretValues),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      failure: {
        path: 'kubectl:get',
        message: `kubectl JSON output must parse: ${errorMessage(error)}`,
      },
      stdout: redactDiagnostic(result.stdout, options.secretValues),
      stderr: redactDiagnostic(result.stderr, options.secretValues),
      exitCode: result.exitCode,
    };
  }
}

function listItems(resourceList: Record<string, unknown>): Record<string, unknown>[] {
  const items = resourceList.items;
  return Array.isArray(items) ? items.map(asRecord) : [];
}

function metadataLabels(resource: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asRecord(resource.metadata).labels);
}

function metadataAnnotations(resource: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asRecord(resource.metadata).annotations);
}

function desiredSubstrateEndpointAddressTypes(appYaml: string): Map<string, string> {
  const parsed = parseKubernetesDocuments(appYaml);
  if (!parsed.ok) {
    throw new Error(parsed.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n'));
  }

  const desired = new Map<string, string>();
  for (const document of parsed.documents) {
    if (resourceKind(document) !== 'EndpointSlice') {
      continue;
    }
    const name = resourceName(document);
    const addressType = document.addressType;
    if (name.startsWith('substrate-') && typeof addressType === 'string') {
      desired.set(name, addressType);
    }
  }

  return desired;
}

function isOwnedSubstrateEndpointSlice(endpointSlice: Record<string, unknown>): boolean {
  const name = resourceName(endpointSlice);
  const labels = metadataLabels(endpointSlice);
  const annotations = metadataAnnotations(endpointSlice);

  return name.startsWith('substrate-')
    && labels['app.kubernetes.io/component'] === 'substrate-binding'
    && labels['kubernetes.io/service-name'] === name
    && annotations['rendered-by'] === 'agentsmith-unified-deploy';
}

function autoscalerTargetName(resource: Record<string, unknown>): string {
  const spec = asRecord(resource.spec);
  const scaleTargetRef = asRecord(spec.scaleTargetRef);
  const targetRef = asRecord(spec.targetRef);
  const scaleTargetName = scaleTargetRef.name;
  const targetName = targetRef.name;

  if (typeof scaleTargetName === 'string') {
    return scaleTargetName;
  }
  return typeof targetName === 'string' ? targetName : '';
}

function containsExecutionGatewayDrift(resource: Record<string, unknown>): boolean {
  const serialized = JSON.stringify(resource).toLowerCase();
  return serialized.includes('execution-gateway') || serialized.includes('execution_gateway');
}

function checkForbiddenLiveResources(items: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  for (const item of items) {
    const kind = resourceKind(item);
    const name = resourceName(item);
    if (containsExecutionGatewayDrift(item)) {
      addFailure(
        failures,
        `live:${kind}/${name}`,
        'execution-gateway Service/Ingress/ConfigMap/env/route drift must not exist in local-kind app resources',
      );
    }
    if (
      ['HorizontalPodAutoscaler', 'ScaledObject', 'ScaledJob'].includes(kind)
      && ['api', 'agentsmith-api'].includes(autoscalerTargetName(item))
    ) {
      addFailure(failures, `live:${kind}/${name}`, 'autoscaler must not target api');
    }
  }
}

async function checkLiveApiReplica(options: {
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ evidence: LocalKindRolloutEvidence['live_api_replica_check']; failures: CheckFailure[] }> {
  const args = [
    ...kubeBaseArgs(options.kubeconfigPath),
    '-n',
    options.namespace,
    'get',
    'deployment',
    'agentsmith-api',
    '-o',
    'json',
  ];
  const result = await kubectlJson({ ...options, args });
  if (!result.ok) {
    return {
      evidence: { status: 'failed' },
      failures: [{ ...result.failure, path: 'live:Deployment/agentsmith-api' }],
    };
  }

  const spec = asRecord(result.value.spec);
  const status = asRecord(result.value.status);
  const desiredReplicas = typeof spec.replicas === 'number' ? spec.replicas : undefined;
  const readyReplicas = typeof status.readyReplicas === 'number' ? status.readyReplicas : undefined;
  const availableReplicas = typeof status.availableReplicas === 'number' ? status.availableReplicas : undefined;
  const failures: CheckFailure[] = [];

  if (desiredReplicas !== 1) {
    addFailure(failures, 'live:Deployment/agentsmith-api', 'live agentsmith-api Deployment must keep replicas=1');
  }
  if (readyReplicas !== undefined && readyReplicas > 1) {
    addFailure(failures, 'live:Deployment/agentsmith-api', 'live agentsmith-api ready replicas must not exceed 1');
  }

  return {
    evidence: {
      status: failures.length === 0 ? 'passed' : 'failed',
      desired_replicas: desiredReplicas,
      ready_replicas: readyReplicas,
      available_replicas: availableReplicas,
    },
    failures,
  };
}

async function checkForbiddenResources(options: {
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ evidence: LocalKindRolloutEvidence['forbidden_resource_check']; failures: CheckFailure[] }> {
  const checkedKinds = ['Deployment', 'Service', 'ConfigMap', 'Ingress', 'HorizontalPodAutoscaler', 'ScaledObject', 'ScaledJob'];
  const failures: CheckFailure[] = [];
  const workloadArgs = [
    ...kubeBaseArgs(options.kubeconfigPath),
    '-n',
    options.namespace,
    'get',
    'deployment,service,configmap,ingress,horizontalpodautoscaler',
    '-o',
    'json',
  ];
  const workloadResult = await kubectlJson({ ...options, args: workloadArgs });
  const items: Record<string, unknown>[] = [];

  if (workloadResult.ok) {
    items.push(...listItems(workloadResult.value));
  } else {
    failures.push({ ...workloadResult.failure, path: 'live:forbidden-resources' });
  }

  const kedaArgs = [
    ...kubeBaseArgs(options.kubeconfigPath),
    '-n',
    options.namespace,
    'get',
    'scaledobjects.keda.sh,scaledjobs.keda.sh',
    '-o',
    'json',
    '--ignore-not-found',
  ];
  const kedaResult = await kubectlJson({ ...options, args: kedaArgs });
  if (kedaResult.ok) {
    items.push(...listItems(kedaResult.value));
  } else if (!/server doesn't have a resource type|no matches for kind|not found/iu.test(kedaResult.stderr)) {
    failures.push({ ...kedaResult.failure, path: 'live:keda-autoscalers' });
  }

  checkForbiddenLiveResources(items, failures);

  return {
    evidence: {
      status: failures.length === 0 ? 'passed' : 'failed',
      checked_kinds: checkedKinds,
    },
    failures,
  };
}

function ingressRouteTruth(ingress: Record<string, unknown>): {
  services: string[];
  routes: Map<string, string>;
} {
  const services = new Set<string>();
  const routes = new Map<string, string>();
  const rules = Array.isArray(asRecord(ingress.spec).rules) ? asRecord(ingress.spec).rules as unknown[] : [];

  for (const rule of rules) {
    const paths = Array.isArray(asRecord(asRecord(rule).http).paths)
      ? asRecord(asRecord(rule).http).paths as unknown[]
      : [];
    for (const pathEntry of paths) {
      const routePath = asRecord(pathEntry).path;
      const serviceName = asRecord(asRecord(asRecord(pathEntry).backend).service).name;
      if (typeof serviceName === 'string') {
        services.add(serviceName);
      }
      if (typeof routePath === 'string' && typeof serviceName === 'string') {
        routes.set(routePath, serviceName);
      }
    }
  }

  return {
    services: [...services].sort(),
    routes,
  };
}

async function checkInternalIngressExposure(options: {
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ probe: RouteProbeEvidence; failure?: CheckFailure }> {
  const args = [
    ...kubeBaseArgs(options.kubeconfigPath),
    '-n',
    options.namespace,
    'get',
    'ingress',
    'agentsmith',
    '-o',
    'json',
  ];
  const result = await kubectlJson({ ...options, args });
  const probe: RouteProbeEvidence = {
    name: 'internal-services-not-exposed',
    path: 'Ingress/agentsmith',
    expected: 'public ingress must not route to agentsmith-llmup or agentsmith-sandbox-manager',
    status: 'failed',
  };

  if (!result.ok) {
    return {
      probe: {
        ...probe,
        diagnostic: result.failure.message,
      },
      failure: {
        ...result.failure,
        path: 'probe:internal-services-not-exposed',
      },
    };
  }

  const { routes, services } = ingressRouteTruth(result.value);
  const expectedRoutes = new Map([
    ['/api/v1', 'agentsmith-api'],
    ['/api/public', 'agentsmith-web'],
    ['/api/system', 'agentsmith-web'],
    ['/', 'agentsmith-web'],
  ]);
  const routeFailures: string[] = [];
  for (const [routePath, serviceName] of expectedRoutes) {
    if (routes.get(routePath) !== serviceName) {
      routeFailures.push(`${routePath} must route to ${serviceName}`);
    }
  }
  if (routeFailures.length > 0) {
    return {
      probe: {
        ...probe,
        diagnostic: routeFailures.join('; '),
      },
      failure: {
        path: 'probe:ingress-routes',
        message: routeFailures.join('; '),
      },
    };
  }

  const forbidden = services.filter((service) =>
    service === 'agentsmith-llmup' || service === 'agentsmith-sandbox-manager',
  );
  if (forbidden.length > 0) {
    return {
      probe: {
        ...probe,
        diagnostic: `forbidden ingress backends: ${forbidden.join(', ')}`,
      },
      failure: {
        path: 'probe:internal-services-not-exposed',
        message: `public ingress must not expose ${forbidden.join(', ')}`,
      },
    };
  }

  return {
    probe: {
      ...probe,
      status: 'passed',
      diagnostic: `ingress backends: ${services.join(', ')}`,
    },
  };
}

function contentType(headers: Record<string, string>): string {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type');
  return typeof match?.[1] === 'string' ? match[1] : '';
}

function urlForPath(publicBaseUrl: string, routePath: string): string {
  return new URL(routePath, `${publicBaseUrl.replace(/\/+$/u, '')}/`).toString();
}

async function runHttpProbe(options: {
  name: RouteProbeEvidence['name'];
  path: string;
  publicBaseUrl: string;
  expected: string;
  validate: (result: LocalKindHttpProbeResult) => string | undefined;
  probeRunner: LocalKindHttpProbeRunner;
}): Promise<{ probe: RouteProbeEvidence; failure?: CheckFailure }> {
  const url = urlForPath(options.publicBaseUrl, options.path);
  const baseProbe: RouteProbeEvidence = {
    name: options.name,
    path: options.path,
    url,
    expected: options.expected,
    status: 'failed',
  };

  try {
    const result = await options.probeRunner(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const diagnostic = options.validate(result);
    const probe: RouteProbeEvidence = {
      ...baseProbe,
      status: diagnostic ? 'failed' : 'passed',
      status_code: result.status,
      content_type: contentType(result.headers),
      diagnostic,
    };

    return {
      probe,
      failure: diagnostic
        ? {
          path: `probe:${options.name}`,
          message: diagnostic,
        }
        : undefined,
    };
  } catch (error: unknown) {
    const diagnostic = errorMessage(error);
    return {
      probe: {
        ...baseProbe,
        diagnostic,
      },
      failure: {
        path: `probe:${options.name}`,
        message: diagnostic,
      },
    };
  }
}

function validateWebPublicWorkspaces(result: LocalKindHttpProbeResult): string | undefined {
  if (result.status !== 200 || !contentType(result.headers).toLowerCase().includes('json')) {
    return 'GET /api/public/workspaces must return 200 JSON from the Web-owned route';
  }
  try {
    JSON.parse(result.body);
  } catch {
    return 'GET /api/public/workspaces must return parseable JSON';
  }

  return undefined;
}

function validateApiProfile(result: LocalKindHttpProbeResult): string | undefined {
  return result.status === 401
    ? undefined
    : 'GET /api/v1/me/profile weak smoke expected unauthenticated 401 after live ingress path ownership check';
}

function validateWsPath(result: LocalKindHttpProbeResult): string | undefined {
  return result.status === 400 || result.status === 401
    ? undefined
    : 'GET /api/v1/agent-execution/ws?agent_runner_id=__probe__ weak smoke expected 400 or 401 after live ingress path ownership check';
}

async function runRouteProbes(options: {
  publicBaseUrl: string;
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  probeRunner: LocalKindHttpProbeRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ probes: RouteProbeEvidence[]; failures: CheckFailure[] }> {
  const httpProbes = await Promise.all([
    runHttpProbe({
      name: 'web-public-workspaces',
      path: '/api/public/workspaces',
      publicBaseUrl: options.publicBaseUrl,
      expected: '200 JSON from Web-owned route',
      validate: validateWebPublicWorkspaces,
      probeRunner: options.probeRunner,
    }),
    runHttpProbe({
      name: 'api-profile',
      path: '/api/v1/me/profile',
      publicBaseUrl: options.publicBaseUrl,
      expected: '401 unauthenticated from API route',
      validate: validateApiProfile,
      probeRunner: options.probeRunner,
    }),
    runHttpProbe({
      name: 'api-agent-execution-ws',
      path: '/api/v1/agent-execution/ws?agent_runner_id=__probe__',
      publicBaseUrl: options.publicBaseUrl,
      expected: '400 or 401 from API WS handler route',
      validate: validateWsPath,
      probeRunner: options.probeRunner,
    }),
  ]);
  const internalExposure = await checkInternalIngressExposure(options);
  const all = [...httpProbes, internalExposure];

  return {
    probes: all.map((result) => result.probe),
    failures: all.flatMap((result) => result.failure ? [result.failure] : []),
  };
}

function staticCheckFailures(appYaml: string): CheckFailure[] {
  const checks = [
    checkRenderedOutput(appYaml),
    checkAddressTruth(appYaml),
    checkApiSingleReplica(appYaml),
  ];

  return checks.flatMap((check) =>
    check.failures.map((failure) => ({
      path: `static:${failure.path}`,
      message: failure.message,
    })),
  );
}

async function renderInputs(options: {
  siteEnvPath: string;
  substrateTruthPath: string;
  manifestPath?: string;
  templatesRoot?: string;
}): Promise<RenderedInputs> {
  const preflight = await renderUnifiedDeployPreflightFromFiles({
    profile: 'local-kind',
    siteEnvPath: options.siteEnvPath,
    substrateTruthPath: options.substrateTruthPath,
    manifestPath: options.manifestPath,
    templatesRoot: options.templatesRoot,
  });
  const app = await renderUnifiedDeployFromFiles({
    profile: 'local-kind',
    siteEnvPath: options.siteEnvPath,
    substrateTruthPath: options.substrateTruthPath,
    manifestPath: options.manifestPath,
    templatesRoot: options.templatesRoot,
  });
  const siteEnv = parseSiteEnv(await readFile(options.siteEnvPath, 'utf8'));

  return {
    preflightYaml: preflight.output,
    appYaml: app.output,
    secretValues: collectRenderedSecretValues(app.output),
    publicBaseUrl: siteEnv.PUBLIC_BASE_URL,
  };
}

async function loadSubstrateTruthForRollout(options: {
  substrateTruthPath: string;
  manifestPath?: string;
}): Promise<ReturnType<typeof parseSubstrateTruth>> {
  const manifest = loadUnifiedDeployManifest({ manifestPath: options.manifestPath });
  const source = await readFile(options.substrateTruthPath, 'utf8');

  return parseSubstrateTruth(source, {
    sourcePath: options.substrateTruthPath,
    requiredEnv: manifestRequiredEnv(manifest),
  });
}

async function waitForOptionalIngressAdmissionJob(options: {
  jobName: 'ingress-nginx-admission-create' | 'ingress-nginx-admission-patch';
  checkName: 'ingress-admission-create-check' | 'ingress-admission-patch-check';
  waitName: 'ingress-admission-create-wait' | 'ingress-admission-patch-wait';
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ operations: OperationEvidence[]; failure?: CheckFailure }> {
  const baseArgs = kubeBaseArgs(options.kubeconfigPath);
  const check = await runKubectlCheck({
    name: options.checkName,
    args: [
      ...baseArgs,
      '-n',
      LOCAL_KIND_INGRESS_NAMESPACE,
      'get',
      `job/${options.jobName}`,
    ],
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
    statusWhenFailed: 'skipped',
  });
  const operations = [check.evidence];
  if (check.raw.exitCode !== 0) {
    if (isNotFoundKubectlResult(check.raw)) {
      return { operations };
    }
    return {
      operations,
      failure: {
        path: `ingress-preflight:job:${options.jobName}`,
        message: `ingress-nginx admission Job ${options.jobName} could not be checked: ${check.failure?.message ?? 'kubectl failed'}`,
      },
    };
  }

  const wait = await runKubectlCheck({
    name: options.waitName,
    args: [
      ...baseArgs,
      '-n',
      LOCAL_KIND_INGRESS_NAMESPACE,
      'wait',
      '--for=condition=complete',
      `job/${options.jobName}`,
      `--timeout=${INGRESS_ROLLOUT_TIMEOUT}`,
    ],
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
  });
  operations.push(wait.evidence);
  if (wait.failure) {
    return {
      operations,
      failure: {
        path: `ingress-preflight:job:${options.jobName}`,
        message: `ingress-nginx admission Job ${options.jobName} must complete before app apply: ${wait.failure.message}`,
      },
    };
  }

  return { operations };
}

async function waitForIngressPreflight(options: {
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ operations: OperationEvidence[]; failures: CheckFailure[] }> {
  const baseArgs = kubeBaseArgs(options.kubeconfigPath);
  const operations: OperationEvidence[] = [];
  const failures: CheckFailure[] = [];

  const ingressClass = await runKubectlCheck({
    name: 'ingress-class-check',
    args: [
      ...baseArgs,
      'get',
      'ingressclass',
      LOCAL_KIND_INGRESS_CLASS,
    ],
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
  });
  operations.push(ingressClass.evidence);
  if (ingressClass.failure) {
    failures.push({
      path: 'ingress-preflight:class',
      message: `IngressClass/${LOCAL_KIND_INGRESS_CLASS} must exist after local-kind admin preflight: ${ingressClass.failure.message}`,
    });
    return { operations, failures };
  }

  const controller = await runKubectlCheck({
    name: 'ingress-controller-rollout',
    args: [
      ...baseArgs,
      '-n',
      LOCAL_KIND_INGRESS_NAMESPACE,
      'rollout',
      'status',
      'deployment/ingress-nginx-controller',
      `--timeout=${INGRESS_ROLLOUT_TIMEOUT}`,
    ],
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
  });
  operations.push(controller.evidence);
  if (controller.failure) {
    failures.push({
      path: 'ingress-preflight:controller',
      message: `ingress-nginx controller Deployment must be ready before app apply: ${controller.failure.message}`,
    });
    return { operations, failures };
  }

  for (const job of [
    {
      jobName: 'ingress-nginx-admission-create',
      checkName: 'ingress-admission-create-check',
      waitName: 'ingress-admission-create-wait',
    },
    {
      jobName: 'ingress-nginx-admission-patch',
      checkName: 'ingress-admission-patch-check',
      waitName: 'ingress-admission-patch-wait',
    },
  ] as const) {
    const jobWait = await waitForOptionalIngressAdmissionJob({
      ...job,
      kubeconfigPath: options.kubeconfigPath,
      runner: options.runner,
      env: options.env,
      secretValues: options.secretValues,
    });
    operations.push(...jobWait.operations);
    if (jobWait.failure) {
      failures.push(jobWait.failure);
      return { operations, failures };
    }
  }

  return { operations, failures };
}

async function reconcileSubstrateEndpointSliceAddressTypes(options: {
  appYaml: string;
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ operations: OperationEvidence[]; failures: CheckFailure[] }> {
  const operations: OperationEvidence[] = [];
  const failures: CheckFailure[] = [];
  let desired: Map<string, string>;

  try {
    desired = desiredSubstrateEndpointAddressTypes(options.appYaml);
  } catch (error: unknown) {
    return {
      operations,
      failures: [{
        path: 'substrate-endpointslice:rendered-yaml',
        message: errorMessage(error),
      }],
    };
  }

  if (desired.size === 0) {
    return { operations, failures };
  }

  const baseArgs = kubeBaseArgs(options.kubeconfigPath);
  const check = await runKubectlCheck({
    name: 'substrate-endpointslice-reconcile-check',
    args: [
      ...baseArgs,
      '-n',
      options.namespace,
      'get',
      'endpointslices',
      '-o',
      'json',
      '--ignore-not-found',
    ],
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
  });
  operations.push(check.evidence);
  if (check.failure) {
    failures.push({
      path: 'substrate-endpointslice:check',
      message: `could not inspect live substrate EndpointSlices before app apply: ${check.failure.message}`,
    });
    return { operations, failures };
  }

  let liveItems: Record<string, unknown>[];
  try {
    const liveEndpointSliceList = check.raw.stdout.trim();
    liveItems = liveEndpointSliceList ? listItems(parseJsonObject(liveEndpointSliceList)) : [];
  } catch (error: unknown) {
    failures.push({
      path: 'substrate-endpointslice:check',
      message: `live EndpointSlice list must parse before app apply: ${errorMessage(error)}`,
    });
    return { operations, failures };
  }

  const deleteNames: string[] = [];
  for (const endpointSlice of liveItems) {
    const name = resourceName(endpointSlice);
    const desiredAddressType = desired.get(name);
    const liveAddressType = endpointSlice.addressType;
    if (!desiredAddressType || typeof liveAddressType !== 'string' || liveAddressType === desiredAddressType) {
      continue;
    }

    if (!isOwnedSubstrateEndpointSlice(endpointSlice)) {
      failures.push({
        path: `substrate-endpointslice:${name}`,
        message: `${name} live addressType is ${liveAddressType}, desired ${desiredAddressType}, but the EndpointSlice is non-owned; refusing to delete before app apply`,
      });
      continue;
    }

    deleteNames.push(name);
  }

  if (failures.length > 0 || deleteNames.length === 0) {
    return { operations, failures };
  }

  const deleted = await runKubectlCheck({
    name: 'substrate-endpointslice-reconcile-delete',
    args: [
      ...baseArgs,
      '-n',
      options.namespace,
      'delete',
      'endpointslice',
      ...deleteNames.sort(),
    ],
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
  });
  operations.push(deleted.evidence);
  if (deleted.failure) {
    failures.push({
      path: 'substrate-endpointslice:delete',
      message: `failed to delete owned immutable-drift substrate EndpointSlices before app apply: ${deleted.failure.message}`,
    });
  }

  return { operations, failures };
}

function createEmptyEvidence(params: {
  kubeconfig: KubeconfigResolution;
  context: string;
  namespace: string;
  failures: CheckFailure[];
}): Omit<LocalKindRolloutEvidence, 'status' | 'generated_at' | 'paths'> {
  return {
    schema_version: 'agentsmith.unified-deploy.local-kind-rollout.evidence/v1',
    producer: 'local-kind-rollout',
    profile: 'local-kind',
    safety: {
      kubeconfig: params.kubeconfig.source,
      attempted_kubeconfig: params.kubeconfig.attempted,
      context: params.context,
      namespace: params.namespace,
      status: params.failures.length === 0 ? 'passed' : 'failed',
    },
    rendered_manifest_fingerprint: 'unavailable',
    admin_preflight_fingerprint: 'unavailable',
    substrate_truth_fingerprint: 'unavailable',
    substrate_live_check: skippedSubstrateRuntimeTruthSummary(),
    manifest_summary: EMPTY_SUMMARY,
    image_refs: {},
    image_preflight: {
      status: 'skipped',
      image_refs: [],
      host_refs: [],
      failures: [],
      diagnostics: [],
    },
    operations: [],
    rollouts: [],
    llmup_config_health: EMPTY_LLMUP_CONFIG_HEALTH,
    live_api_replica_check: { status: 'skipped' },
    forbidden_resource_check: { status: 'skipped', checked_kinds: [] },
    route_probes: [],
    failures: params.failures,
  };
}

async function writeLocalKindEvidence(
  evidence: Omit<LocalKindRolloutEvidence, 'status' | 'generated_at' | 'paths'>,
  evidenceDir: string,
): Promise<LocalKindRolloutEvidence> {
  const resolvedEvidenceDir = prepareUnifiedDeployEvidenceDir({
    evidenceDir,
    defaultRoot: DEFAULT_EVIDENCE_DIR,
    label: 'local-kind rollout evidenceDir',
  });

  const status: ProducerStatus = evidence.failures.length === 0 ? 'passed' : 'failed';
  const basename = `local-kind-rollout-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
  const reportPath = path.join(resolvedEvidenceDir, `${basename}.json`);
  const logPath = path.join(resolvedEvidenceDir, `${basename}.log`);
  const evidenceWithPaths: LocalKindRolloutEvidence = {
    ...evidence,
    status,
    generated_at: new Date().toISOString(),
    paths: {
      report_path: reportPath,
      log_path: logPath,
    },
  };

  await writeFile(reportPath, `${JSON.stringify(evidenceWithPaths, null, 2)}\n`, 'utf8');
  await writeFile(
    logPath,
    [
      'producer=local-kind-rollout',
      `status=${status}`,
      'profile=local-kind',
      `namespace=${evidence.safety.namespace}`,
      `context=${evidence.safety.context}`,
      `failures=${evidence.failures.length}`,
      `report_path=${reportPath}`,
    ].join('\n') + '\n',
    'utf8',
  );

  return evidenceWithPaths;
}

async function finish(
  evidence: Omit<LocalKindRolloutEvidence, 'status' | 'generated_at' | 'paths'>,
  evidenceDir: string,
): Promise<LocalKindRolloutProducerResult> {
  const written = await writeLocalKindEvidence(evidence, evidenceDir);

  return {
    status: written.status,
    failures: written.failures,
    evidence: written,
  };
}

async function buildSafety(options: {
  producerOptions: LocalKindRolloutProducerOptions;
  env: Record<string, string | undefined>;
  kubeconfig: KubeconfigResolution;
  runner: LocalKindCommandRunner;
  siteEnvPath: string;
}): Promise<{ failures: CheckFailure[]; context: string; namespace: string }> {
  const failures: CheckFailure[] = [];
  let context = '';
  let namespace = '';

  if (!options.kubeconfig.path) {
    addFailure(
      failures,
      'kubeconfig',
      `local-kind rollout requires KUBECONFIG or ${path.join(options.producerOptions.homeDir ?? homedir(), '.kube', 'config')}; attempted: ${options.kubeconfig.attempted.join(', ')}`,
    );
    return { failures, context, namespace };
  }

  try {
    const siteEnv = parseSiteEnv(await readFile(options.siteEnvPath, 'utf8'));
    namespace = siteEnv.NAMESPACE ?? '';
    if (siteEnv.UNIFIED_DEPLOY_PROFILE && siteEnv.UNIFIED_DEPLOY_PROFILE !== 'local-kind') {
      addFailure(failures, 'safety:profile', 'local-kind rollout only accepts UNIFIED_DEPLOY_PROFILE=local-kind');
    }
    if (namespace !== LOCAL_KIND_NAMESPACE) {
      addFailure(failures, 'safety:namespace', `local-kind rollout namespace must be ${LOCAL_KIND_NAMESPACE}`);
    }
    const probeBaseUrl = options.producerOptions.publicBaseUrl ?? siteEnv.PUBLIC_BASE_URL ?? '';
    if (!isLocalProbeBaseUrl(probeBaseUrl)) {
      addFailure(
        failures,
        'safety:probe-url',
        `local-kind rollout probes must use a local-kind local entrypoint on kind ingress host port ${LOCAL_KIND_INGRESS_HOST_PORT}, such as http://agentsmith.localtest.me:${LOCAL_KIND_INGRESS_HOST_PORT}`,
      );
    }
  } catch (error: unknown) {
    addFailure(failures, 'safety:site-env', errorMessage(error));
  }

  const portResult = await options.runner('docker', [
    'port',
    LOCAL_KIND_CONTROL_PLANE_NODE,
    `${LOCAL_KIND_INGRESS_NODE_PORT}/tcp`,
  ], {
    cwd: REPO_ROOT,
    env: options.env,
    timeoutMs: KUBECTL_TIMEOUT_MS,
  });
  if (portResult.exitCode !== 0 || !hasExpectedIngressPortMapping(portResult.stdout)) {
    addFailure(
      failures,
      'safety:kind-ingress-port',
      `local-kind ingress requires ${LOCAL_KIND_CONTROL_PLANE_NODE} to expose ${LOCAL_KIND_INGRESS_NODE_PORT}/tcp -> ${LOCAL_KIND_INGRESS_HOST_PORT}; run scripts/ensure-local-kind-cluster.sh with infra/deploy/unified/local-kind/config.yaml`,
    );
  }

  const contextResult = await currentContext({
    kubeconfigPath: options.kubeconfig.path,
    runner: options.runner,
    env: options.env,
  });
  context = contextResult.stdout.trim();
  if (contextResult.exitCode !== 0) {
    addFailure(failures, 'safety:kube-context', contextResult.stderr || contextResult.stdout || `kubectl exited ${contextResult.exitCode}`);
  } else if (!isLocalKindContext(context)) {
    addFailure(failures, 'safety:kube-context', `kube context must be exactly kind-agentsmith before applying local-kind manifests (actual: ${context})`);
  }

  return { failures, context, namespace };
}

async function runApplySequence(options: {
  preflightYaml: string;
  appYaml: string;
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ operations: OperationEvidence[]; failures: CheckFailure[] }> {
  const baseArgs = kubeBaseArgs(options.kubeconfigPath);
  const operations: OperationEvidence[] = [];
  const failures: CheckFailure[] = [];
  let adminPreflightBatches: { namespaceYaml: string; resourceYaml: string };

  try {
    adminPreflightBatches = splitAdminPreflightYaml(options.preflightYaml);
  } catch (error: unknown) {
    failures.push({
      path: 'admin-preflight:rendered-yaml',
      message: errorMessage(error),
    });
    return { operations, failures };
  }

  const steps: Array<{ name: OperationEvidence['name']; args: string[]; input: string }> = [
    {
      name: 'admin-namespace-dry-run',
      args: [...baseArgs, 'apply', '--dry-run=server', '-f', '-'],
      input: adminPreflightBatches.namespaceYaml,
    },
    {
      name: 'admin-namespace-apply',
      args: [...baseArgs, 'apply', '-f', '-'],
      input: adminPreflightBatches.namespaceYaml,
    },
    {
      name: 'admin-preflight-dry-run',
      args: [...baseArgs, 'apply', '--dry-run=server', '-f', '-'],
      input: adminPreflightBatches.resourceYaml,
    },
    {
      name: 'admin-preflight-apply',
      args: [...baseArgs, 'apply', '-f', '-'],
      input: adminPreflightBatches.resourceYaml,
    },
  ].filter((step) => step.input.trim().length > 0);

  for (const step of steps) {
    const result = await runKubectlOperation({
      name: step.name,
      args: step.args,
      input: step.input,
      runner: options.runner,
      env: options.env,
      kubeconfigPath: options.kubeconfigPath,
      secretValues: options.secretValues,
    });
    operations.push(result.evidence);
    if (result.failure) {
      failures.push(result.failure);
      break;
    }
  }
  if (failures.length > 0) {
    return { operations, failures };
  }

  const ingressPreflight = await waitForIngressPreflight({
    kubeconfigPath: options.kubeconfigPath,
    runner: options.runner,
    env: options.env,
    secretValues: options.secretValues,
  });
  operations.push(...ingressPreflight.operations);
  failures.push(...ingressPreflight.failures);
  if (failures.length > 0) {
    return { operations, failures };
  }

  const substrateEndpointSliceReconcile = await reconcileSubstrateEndpointSliceAddressTypes({
    appYaml: options.appYaml,
    namespace: options.namespace,
    kubeconfigPath: options.kubeconfigPath,
    runner: options.runner,
    env: options.env,
    secretValues: options.secretValues,
  });
  operations.push(...substrateEndpointSliceReconcile.operations);
  failures.push(...substrateEndpointSliceReconcile.failures);
  if (failures.length > 0) {
    return { operations, failures };
  }

  for (const step of [
    {
      name: 'app-dry-run',
      args: [...baseArgs, 'apply', '--dry-run=server', '-f', '-'],
      input: options.appYaml,
    },
    {
      name: 'app-apply',
      args: [...baseArgs, 'apply', '-f', '-'],
      input: options.appYaml,
    },
  ] as const) {
    const result = await runKubectlOperation({
      name: step.name,
      args: step.args,
      input: step.input,
      runner: options.runner,
      env: options.env,
      kubeconfigPath: options.kubeconfigPath,
      secretValues: options.secretValues,
    });
    operations.push(result.evidence);
    if (result.failure) {
      failures.push(result.failure);
      break;
    }
  }

  return { operations, failures };
}

async function runRollouts(options: {
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ rollouts: RolloutEvidence[]; failures: CheckFailure[] }> {
  const rollouts: RolloutEvidence[] = [];
  const failures: CheckFailure[] = [];

  for (const deployment of ROLLOUT_DEPLOYMENTS) {
    const result = await rolloutDeployment({
      deployment,
      namespace: options.namespace,
      kubeconfigPath: options.kubeconfigPath,
      runner: options.runner,
      env: options.env,
      secretValues: options.secretValues,
    });
    rollouts.push(result.evidence);
    if (result.failure) {
      failures.push(result.failure);
      break;
    }
  }

  return { rollouts, failures };
}

export async function runLocalKindRolloutProducer(
  options: LocalKindRolloutProducerOptions = {},
): Promise<LocalKindRolloutProducerResult> {
  const env = options.env ?? process.env;
  const templatesRoot = path.resolve(options.templatesRoot ?? DEFAULT_TEMPLATES_ROOT);
  const evidenceDir = options.evidenceDir ?? DEFAULT_EVIDENCE_DIR;
  const runner = options.runner ?? defaultLocalKindCommandRunner;
  const probeRunner = options.probeRunner ?? defaultLocalKindHttpProbeRunner;
  const kubeconfig = resolveKubeconfig({
    kubeconfigPath: options.kubeconfigPath,
    env,
    homeDir: options.homeDir ?? homedir(),
  });
  if (!kubeconfig.path) {
    return finish(createEmptyEvidence({
      kubeconfig,
      context: '',
      namespace: '',
      failures: [{
        path: 'kubeconfig',
        message: `local-kind rollout requires KUBECONFIG or ${path.join(options.homeDir ?? homedir(), '.kube', 'config')}; attempted: ${kubeconfig.attempted.join(', ')}`,
      }],
    }), evidenceDir);
  }

  const siteEnv = resolveSiteEnv(options);
  if (!siteEnv.path) {
    return finish(createEmptyEvidence({
      kubeconfig,
      context: '',
      namespace: '',
      failures: [{
        path: 'image-handoff:site-env',
        message: `local-kind rollout requires generated image handoff ${siteEnv.attempted.join(', ')}; run npm run test:unified-deploy:local-kind:images before rollout, or pass --site-env explicitly`,
      }],
    }), evidenceDir);
  }
  const siteEnvPath = siteEnv.path;
  const substrateTruth = resolveSubstrateTruth(options);
  if (!substrateTruth.path) {
    return finish(createEmptyEvidence({
      kubeconfig,
      context: '',
      namespace: '',
      failures: [{
        path: 'substrate-truth:connection.env',
        message: options.substrateTruthPath
          ? `local-kind rollout requires explicit substrate truth ${substrateTruth.attempted.join(', ')} to exist`
          : `local-kind rollout requires actual substrate lifecycle truth ${substrateTruth.attempted.join(', ')}; run npm run test:unified-deploy:substrate-lifecycle before rollout`,
      }],
    }), evidenceDir);
  }
  const substrateTruthPath = substrateTruth.path;
  const safety = await buildSafety({
    producerOptions: options,
    env,
    kubeconfig,
    runner,
    siteEnvPath,
  });
  const safetyEvidence = createEmptyEvidence({
    kubeconfig,
    context: safety.context,
    namespace: safety.namespace,
    failures: safety.failures,
  });

  if (safety.failures.length > 0 || !kubeconfig.path) {
    return finish(safetyEvidence, evidenceDir);
  }

  let rendered: RenderedInputs;
  let substrateTruthFingerprint = 'unavailable';
  let substrateLiveCheck = skippedSubstrateRuntimeTruthSummary(DEFAULT_SUBSTRATE_COMPOSE_PROJECT);
  try {
    const substrateTruthForRollout = await loadSubstrateTruthForRollout({
      substrateTruthPath,
      manifestPath: options.manifestPath,
    });
    substrateTruthFingerprint = substrateTruthForRollout.redacted_fingerprint;
    substrateLiveCheck = await checkSubstrateRuntimeTruth({
      truthValues: substrateTruthForRollout.values,
      composeProject: DEFAULT_SUBSTRATE_COMPOSE_PROJECT,
      runner: substrateCommandRunnerFromLocalKind(runner),
      env,
    });
    if (substrateLiveCheck.status !== 'passed') {
      return finish({
        ...safetyEvidence,
        safety: {
          ...safetyEvidence.safety,
          status: 'passed',
        },
        substrate_truth_fingerprint: substrateTruthFingerprint,
        substrate_live_check: substrateLiveCheck,
        failures: localKindSubstrateLiveFailures(substrateLiveCheck),
      }, evidenceDir);
    }
    rendered = await renderInputs({
      siteEnvPath,
      substrateTruthPath,
      manifestPath: options.manifestPath,
      templatesRoot,
    });
  } catch (error: unknown) {
    const failures = [{
      path: 'render',
      message: errorMessage(error),
    }];
    return finish({
      ...safetyEvidence,
      safety: {
        ...safetyEvidence.safety,
        status: 'passed',
      },
      substrate_truth_fingerprint: substrateTruthFingerprint,
      substrate_live_check: substrateLiveCheck,
      failures,
    }, evidenceDir);
  }

  const secretValues = rendered.secretValues;
  const preflightFingerprint = fingerprintRenderedManifest(rendered.preflightYaml);
  const appFingerprint = fingerprintRenderedManifest(rendered.appYaml);
  const manifestSummary = summarizeRenderedManifest(rendered.appYaml);
  const imagePreflightYaml = `${rendered.preflightYaml}\n---\n${rendered.appYaml}`;
  const imageRefs = collectImageRefs(imagePreflightYaml);
  const staticFailures = staticCheckFailures(rendered.appYaml)
    .map((failure) => ({
      path: failure.path,
      message: redactDiagnostic(failure.message, secretValues),
    }));
  const baseEvidence: Omit<LocalKindRolloutEvidence, 'status' | 'generated_at' | 'paths'> = {
    ...safetyEvidence,
    safety: {
      ...safetyEvidence.safety,
      status: 'passed',
    },
    rendered_manifest_fingerprint: appFingerprint,
    admin_preflight_fingerprint: preflightFingerprint,
    substrate_truth_fingerprint: substrateTruthFingerprint,
    substrate_live_check: substrateLiveCheck,
    manifest_summary: manifestSummary,
    image_refs: imageRefs,
    failures: staticFailures,
  };

  if (staticFailures.length > 0) {
    return finish(baseEvidence, evidenceDir);
  }

  const imagePreflight = await checkLocalKindImagePreflight({
    renderedYaml: imagePreflightYaml,
    runner,
    env,
  });
  const afterImagePreflightEvidence = {
    ...baseEvidence,
    image_preflight: imagePreflight,
    failures: imagePreflight.failures,
  };
  if (imagePreflight.failures.length > 0) {
    return finish(afterImagePreflightEvidence, evidenceDir);
  }

  const apply = await runApplySequence({
    preflightYaml: rendered.preflightYaml,
    appYaml: rendered.appYaml,
    namespace: safety.namespace,
    kubeconfigPath: kubeconfig.path,
    runner,
    env,
    secretValues,
  });
  const afterApplyEvidence = {
    ...afterImagePreflightEvidence,
    operations: apply.operations,
    failures: apply.failures,
  };

  if (apply.failures.length > 0) {
    return finish(afterApplyEvidence, evidenceDir);
  }

  const rollouts = await runRollouts({
    namespace: safety.namespace,
    kubeconfigPath: kubeconfig.path,
    runner,
    env,
    secretValues,
  });
  const llmupConfigHealth = buildLlmupConfigHealthEvidence(rendered.appYaml, rollouts.rollouts);
  const liveApi = await checkLiveApiReplica({
    namespace: safety.namespace,
    kubeconfigPath: kubeconfig.path,
    runner,
    env,
    secretValues,
  });
  const forbiddenResources = await checkForbiddenResources({
    namespace: safety.namespace,
    kubeconfigPath: kubeconfig.path,
    runner,
    env,
    secretValues,
  });
  const routeProbes = await runRouteProbes({
    publicBaseUrl: options.publicBaseUrl ?? rendered.publicBaseUrl,
    namespace: safety.namespace,
    kubeconfigPath: kubeconfig.path,
    runner,
    probeRunner,
    env,
    secretValues,
  });
  const failures = [
    ...rollouts.failures,
    ...llmupConfigHealth.failures,
    ...liveApi.failures,
    ...forbiddenResources.failures,
    ...routeProbes.failures,
  ];

  return finish({
    ...afterApplyEvidence,
    rollouts: rollouts.rollouts,
    llmup_config_health: llmupConfigHealth.evidence,
    live_api_replica_check: liveApi.evidence,
    forbidden_resource_check: forbiddenResources.evidence,
    route_probes: routeProbes.probes,
    failures,
  }, evidenceDir);
}

type CliOptions = Pick<
  LocalKindRolloutProducerOptions,
  'siteEnvPath' | 'localKindSiteEnvPath' | 'substrateTruthPath' | 'localKindSubstrateTruthPath' | 'manifestPath' | 'templatesRoot' | 'evidenceDir' | 'kubeconfigPath' | 'publicBaseUrl'
>;

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};

  for (const arg of argv) {
    if (arg.startsWith('--site-env=')) {
      options.siteEnvPath = arg.slice('--site-env='.length);
    } else if (arg.startsWith('--local-kind-site-env=')) {
      options.localKindSiteEnvPath = arg.slice('--local-kind-site-env='.length);
    } else if (arg.startsWith('--substrate-truth=')) {
      options.substrateTruthPath = arg.slice('--substrate-truth='.length);
    } else if (arg.startsWith('--local-kind-substrate-truth=')) {
      options.localKindSubstrateTruthPath = arg.slice('--local-kind-substrate-truth='.length);
    } else if (arg.startsWith('--manifest=')) {
      options.manifestPath = arg.slice('--manifest='.length);
    } else if (arg.startsWith('--templates-root=')) {
      options.templatesRoot = arg.slice('--templates-root='.length);
    } else if (arg.startsWith('--evidence-dir=')) {
      options.evidenceDir = arg.slice('--evidence-dir='.length);
    } else if (arg.startsWith('--kubeconfig=')) {
      options.kubeconfigPath = arg.slice('--kubeconfig='.length);
    } else if (arg.startsWith('--namespace=')) {
      throw new Error('local-kind rollout namespace is fixed to agentsmith');
    } else if (arg.startsWith('--public-base-url=')) {
      options.publicBaseUrl = arg.slice('--public-base-url='.length);
    } else if (arg.startsWith('--profile=')) {
      throw new Error('local-kind rollout producer is fixed to --profile=local-kind');
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const result = await runLocalKindRolloutProducer(parseCliOptions(process.argv.slice(2)));
  if (result.status === 'passed') {
    process.stdout.write(`[unified-deploy] local-kind rollout and ingress routing smoke passed\n[unified-deploy] evidence: ${result.evidence.paths.report_path}\n`);
    return;
  }

  process.stderr.write(`${result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n')}\n`);
  process.stderr.write(`[unified-deploy] local-kind rollout and ingress routing smoke failed\n[unified-deploy] evidence: ${result.evidence.paths.report_path}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
