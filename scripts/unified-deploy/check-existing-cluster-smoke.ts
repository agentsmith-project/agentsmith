import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkApiSingleReplica } from './check-api-single-replica';
import { checkRenderedOutput } from './check-render';
import { fingerprintRenderedManifest } from './evidence';
import {
  REPO_ROOT,
  asRecord,
  loadUnifiedDeployManifest,
  manifestRequiredEnv,
  type CheckFailure,
} from './manifest';
import {
  parseKubernetesDocuments,
  resourceId,
  resourceKind,
  resourceName,
} from './kubernetes';
import {
  DEFAULT_SITE_ENV_PATH,
  DEFAULT_TEMPLATES_ROOT,
  parseSiteEnv,
  renderUnifiedDeployFromFiles,
} from './render';
import {
  DEFAULT_SUBSTRATE_TRUTH_PATH,
  parseSubstrateTruth,
} from './substrate-truth';

type ProducerStatus = 'passed' | 'failed';
type StepStatus = 'passed' | 'failed' | 'skipped';

export type ExistingClusterCommandRunOptions = {
  input?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

export type ExistingClusterCommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ExistingClusterCommandRunner = (
  command: string,
  args: string[],
  options?: ExistingClusterCommandRunOptions,
) => Promise<ExistingClusterCommandRunResult>;

export type ExistingClusterHttpProbeResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
  request_headers?: Record<string, string>;
};

export type ExistingClusterHttpProbeRunner = (
  url: string,
  options: { method: 'GET'; headers?: Record<string, string>; timeoutMs?: number },
) => Promise<ExistingClusterHttpProbeResult>;

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
  name: 'namespace-exists' | 'app-dry-run' | 'app-apply';
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

type ProductFlowSmokeEvidence = {
  status: 'not_claimed';
  reason: string;
  required_evidence_input: string;
};

type KedaApiResourceEvidence = {
  resource: 'scaledobjects.keda.sh' | 'scaledjobs.keda.sh';
  kind: 'ScaledObject' | 'ScaledJob';
  status: 'checked' | 'no-api' | 'failed';
  command: string;
  item_count?: number;
  diagnostic?: string;
};

type KedaApiEvidence = {
  status: 'checked' | 'no-api' | 'failed';
  checked: boolean;
  resources: KedaApiResourceEvidence[];
  item_count: number;
};

type ExistingClusterSmokeEvidence = {
  schema_version: 'agentsmith.unified-deploy.existing-cluster-smoke.evidence/v1';
  producer: 'existing-cluster-smoke';
  status: ProducerStatus;
  generated_at: string;
  profile: 'existing-cluster';
  safety: {
    kubeconfig: KubeconfigResolution['source'];
    attempted_kubeconfig: string[];
    namespace: string;
    status: StepStatus;
  };
  rendered_config_fingerprint: string;
  substrate_truth_fingerprint: string;
  manifest_summary: ResourceSummary;
  operations: OperationEvidence[];
  rollouts: RolloutEvidence[];
  live_api_replica_check: {
    status: StepStatus;
    desired_replicas?: number;
    ready_replicas?: number;
    available_replicas?: number;
  };
  forbidden_resource_check: {
    status: StepStatus;
    checked_kinds: string[];
    keda_api: KedaApiEvidence;
  };
  llmup_config_health: LlmupConfigHealthEvidence;
  route_probes: RouteProbeEvidence[];
  product_verification_matrix: {
    login_profile: ProductFlowSmokeEvidence;
    workspace_project: ProductFlowSmokeEvidence;
    chat_via_llmup: ProductFlowSmokeEvidence;
    agent_task_managed_runner: ProductFlowSmokeEvidence;
    files: ProductFlowSmokeEvidence;
    audit: ProductFlowSmokeEvidence;
    usage: ProductFlowSmokeEvidence;
  };
  failures: CheckFailure[];
  paths: {
    report_path: string;
    log_path: string;
  };
};

export type ExistingClusterSmokeProducerOptions = {
  siteEnvPath?: string;
  substrateTruthPath?: string;
  manifestPath?: string;
  templatesRoot?: string;
  evidenceDir?: string;
  kubeconfigPath?: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  publicBaseUrl?: string;
  authToken?: string;
  runner?: ExistingClusterCommandRunner;
  probeRunner?: ExistingClusterHttpProbeRunner;
};

export type ExistingClusterSmokeProducerResult = {
  status: ProducerStatus;
  failures: CheckFailure[];
  evidence: ExistingClusterSmokeEvidence;
};

type RenderedInputs = {
  appYaml: string;
  secretValues: string[];
  publicBaseUrl: string;
  namespace: string;
};

const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, 'artifacts', 'unified-deploy');
const KUBECTL_REQUEST_TIMEOUT = '20s';
const KUBECTL_TIMEOUT_MS = 45_000;
const PROBE_TIMEOUT_MS = 10_000;
const ROLLOUT_TIMEOUT = '60s';
const ROLLOUT_DEPLOYMENTS = [
  'agentsmith-web',
  'agentsmith-api',
  'agentsmith-llmup',
  'agentsmith-sandbox-manager',
] as const;
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
const EMPTY_KEDA_API_EVIDENCE: KedaApiEvidence = {
  status: 'no-api',
  checked: false,
  resources: [
    {
      resource: 'scaledobjects.keda.sh',
      kind: 'ScaledObject',
      status: 'no-api',
      command: 'kubectl get scaledobjects.keda.sh -o json --ignore-not-found',
      item_count: 0,
    },
    {
      resource: 'scaledjobs.keda.sh',
      kind: 'ScaledJob',
      status: 'no-api',
      command: 'kubectl get scaledjobs.keda.sh -o json --ignore-not-found',
      item_count: 0,
    },
  ],
  item_count: 0,
};
const SECRET_FIELD_KEY_PATTERN = /(?:PASSWORD|SECRET|TOKEN|PRIVATE|ACCESS[_-]?KEY|API[_-]?KEY|CREDENTIAL|DATABASE_URL|MONGO_URL|MONGODB_URI|REDIS_URL|CLIENT_SECRET|AUTHORIZATION)/iu;
const SECRET_VALUE_PATTERN = /(?:password|secret|token|access[_-]?key|api[_-]?key|credential|client[_-]?secret)/iu;
const PUBLIC_VALUE_DENYLIST = new Set(['agentsmith', 'admin', 'admin-cli', 'public', 'true', 'false']);

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

function summarizeRenderedManifest(renderedYaml: string): ResourceSummary {
  const parsed = parseKubernetesDocuments(renderedYaml);
  const kinds: Record<string, number> = {};
  const resources: string[] = [];

  for (const document of parsed.documents) {
    const kind = resourceKind(document);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    resources.push(resourceId(document));
  }

  return {
    total: resources.length,
    kinds: Object.fromEntries(Object.entries(kinds).sort(([left], [right]) => left.localeCompare(right))),
    resources: resources.sort(),
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

function kubeBaseArgs(kubeconfigPath: string): string[] {
  return ['--kubeconfig', kubeconfigPath, `--request-timeout=${KUBECTL_REQUEST_TIMEOUT}`];
}

function commandText(args: readonly string[]): string {
  return `kubectl ${args.join(' ')}`;
}

export async function defaultExistingClusterCommandRunner(
  command: string,
  args: string[],
  options: ExistingClusterCommandRunOptions = {},
): Promise<ExistingClusterCommandRunResult> {
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

export async function defaultExistingClusterHttpProbeRunner(
  url: string,
  options: { method: 'GET'; headers?: Record<string, string>; timeoutMs?: number },
): Promise<ExistingClusterHttpProbeResult> {
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

async function runKubectlOperation(options: {
  name: OperationEvidence['name'];
  args: string[];
  input?: string;
  runner: ExistingClusterCommandRunner;
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
        path: options.name === 'namespace-exists' ? 'namespace:agentsmith' : `kubectl:${options.name}`,
        message: redactDiagnostic(result.stderr || result.stdout || `kubectl exited ${result.exitCode}`, options.secretValues),
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
  runner: ExistingClusterCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; failure: CheckFailure }> {
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
    };
  }

  try {
    return { ok: true, value: parseJsonObject(result.stdout) };
  } catch (error: unknown) {
    return {
      ok: false,
      failure: {
        path: 'kubectl:get',
        message: `kubectl JSON output must parse: ${errorMessage(error)}`,
      },
    };
  }
}

function listItems(resourceList: Record<string, unknown>): Record<string, unknown>[] {
  const items = resourceList.items;
  return Array.isArray(items) ? items.map(asRecord) : [];
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
      addFailure(failures, `live:${kind}/${name}`, 'execution-gateway Service/Ingress/ConfigMap/env/route drift must not exist in existing-cluster app resources');
    }
    if (
      ['HorizontalPodAutoscaler', 'ScaledObject', 'ScaledJob'].includes(kind)
      && ['api', 'agentsmith-api'].includes(autoscalerTargetName(item))
    ) {
      addFailure(failures, `live:${kind}/${name}`, 'autoscaler must not target api');
    }
  }
}

function isMissingKedaApiResource(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('server doesn\'t have a resource type')
    || normalized.includes('server does not have a resource type')
    || normalized.includes('could not find the requested resource')
    || normalized.includes('no matches for kind');
}

async function checkLiveApiReplica(options: {
  namespace: string;
  kubeconfigPath: string;
  runner: ExistingClusterCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ evidence: ExistingClusterSmokeEvidence['live_api_replica_check']; failures: CheckFailure[] }> {
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
  runner: ExistingClusterCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ evidence: ExistingClusterSmokeEvidence['forbidden_resource_check']; failures: CheckFailure[] }> {
  const checkedKinds = ['Deployment', 'Service', 'ConfigMap', 'Ingress', 'HorizontalPodAutoscaler'];
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

  const kedaResources = [
    { resource: 'scaledobjects.keda.sh', kind: 'ScaledObject' },
    { resource: 'scaledjobs.keda.sh', kind: 'ScaledJob' },
  ] as const;
  const kedaResourceEvidence: KedaApiResourceEvidence[] = [];
  let kedaItemCount = 0;

  for (const kedaResource of kedaResources) {
    const kedaArgs = [
      ...kubeBaseArgs(options.kubeconfigPath),
      '-n',
      options.namespace,
      'get',
      kedaResource.resource,
      '-o',
      'json',
      '--ignore-not-found',
    ];
    const kedaResult = await kubectlJson({ ...options, args: kedaArgs });
    const command = commandText(kedaArgs);

    if (kedaResult.ok) {
      const kedaItems = listItems(kedaResult.value);
      items.push(...kedaItems);
      kedaItemCount += kedaItems.length;
      checkedKinds.push(kedaResource.kind);
      kedaResourceEvidence.push({
        ...kedaResource,
        status: 'checked',
        command,
        item_count: kedaItems.length,
      });
      continue;
    }

    if (isMissingKedaApiResource(kedaResult.failure.message)) {
      kedaResourceEvidence.push({
        ...kedaResource,
        status: 'no-api',
        command,
        item_count: 0,
        diagnostic: kedaResult.failure.message,
      });
      continue;
    }

    kedaResourceEvidence.push({
      ...kedaResource,
      status: 'failed',
      command,
      diagnostic: kedaResult.failure.message,
    });
    failures.push({ ...kedaResult.failure, path: `live:keda-autoscalers:${kedaResource.resource}` });
  }

  checkForbiddenLiveResources(items, failures);
  const kedaFailed = kedaResourceEvidence.some((resource) => resource.status === 'failed');
  const kedaChecked = kedaResourceEvidence.some((resource) => resource.status === 'checked');
  const kedaApi: KedaApiEvidence = {
    status: kedaFailed ? 'failed' : kedaChecked ? 'checked' : 'no-api',
    checked: kedaChecked,
    resources: kedaResourceEvidence,
    item_count: kedaItemCount,
  };

  return {
    evidence: {
      status: failures.length === 0 ? 'passed' : 'failed',
      checked_kinds: checkedKinds,
      keda_api: kedaApi,
    },
    failures,
  };
}

async function rolloutDeployment(options: {
  deployment: string;
  namespace: string;
  kubeconfigPath: string;
  runner: ExistingClusterCommandRunner;
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

async function runRollouts(options: {
  namespace: string;
  kubeconfigPath: string;
  runner: ExistingClusterCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ rollouts: RolloutEvidence[]; failures: CheckFailure[] }> {
  const rollouts: RolloutEvidence[] = [];
  const failures: CheckFailure[] = [];

  for (const deployment of ROLLOUT_DEPLOYMENTS) {
    const result = await rolloutDeployment({ ...options, deployment });
    rollouts.push(result.evidence);
    if (result.failure) {
      failures.push(result.failure);
    }
  }

  return { rollouts, failures };
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
  const adminTokenRef = asRecord(asRecord(renderedContainerEnvEntry(container, 'LLM_UNIVERSAL_PROXY_ADMIN_TOKEN').valueFrom).secretKeyRef);

  if (typeof configYaml !== 'string' || !configYaml.includes('listen: 0.0.0.0:8080') || !configYaml.includes('mode: client_provider_key')) {
    addFailure(failures, 'llmup:ConfigMap/agentsmith-llmup-config', 'llmup config must render listen address and client_provider_key auth mode');
  }
  if (renderedStringArray(container.args).join('\0') !== ['--config', '/app/config/config.yaml'].join('\0')) {
    addFailure(failures, 'llmup:Deployment/agentsmith-llmup', 'llmup must start with --config /app/config/config.yaml');
  }
  if (adminTokenRef.name !== 'agentsmith-app-secrets' || adminTokenRef.key !== 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN') {
    addFailure(failures, 'llmup:Deployment/agentsmith-llmup', 'llmup admin token must come from agentsmith-app-secrets/MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
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
  runner: ExistingClusterCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ probe: RouteProbeEvidence; failures: CheckFailure[] }> {
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
      failures: [{ ...result.failure, path: 'probe:internal-services-not-exposed' }],
    };
  }

  const { routes, services } = ingressRouteTruth(result.value);
  const expectedRoutes = new Map([
    ['/api/v1', 'agentsmith-api'],
    ['/api/public', 'agentsmith-web'],
    ['/api/system', 'agentsmith-web'],
    ['/', 'agentsmith-web'],
  ]);
  const failures: CheckFailure[] = [];
  for (const [routePath, serviceName] of expectedRoutes) {
    if (routes.get(routePath) !== serviceName) {
      addFailure(failures, 'probe:ingress-routes', `${routePath} must route to ${serviceName}`);
    }
  }

  const forbidden = services.filter((service) =>
    service === 'agentsmith-llmup' || service === 'agentsmith-sandbox-manager',
  );
  if (forbidden.length > 0) {
    addFailure(
      failures,
      'probe:internal-services-not-exposed',
      `public ingress must not expose ${forbidden.join(', ')}`,
    );
  }

  return {
    probe: {
      ...probe,
      status: failures.length === 0 ? 'passed' : 'failed',
      diagnostic: failures.length > 0
        ? failures.map((failure) => failure.message).join('; ')
        : `ingress backends: ${services.join(', ')}`,
    },
    failures,
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
  headers?: Record<string, string>;
  validate: (result: ExistingClusterHttpProbeResult) => string | undefined;
  probeRunner: ExistingClusterHttpProbeRunner;
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
      headers: options.headers ?? { accept: 'application/json' },
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

function validateWebPublicWorkspaces(result: ExistingClusterHttpProbeResult): string | undefined {
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

function validateApiProfileUnauthenticated(result: ExistingClusterHttpProbeResult): string | undefined {
  return result.status === 401
    ? undefined
    : 'GET /api/v1/me/profile weak smoke expected unauthenticated 401 after live ingress path ownership check';
}

function validateApiProfileAuthenticated(result: ExistingClusterHttpProbeResult): string | undefined {
  if (result.status !== 200 || !contentType(result.headers).toLowerCase().includes('json')) {
    return 'GET /api/v1/me/profile authenticated smoke expected 200 JSON from API route';
  }
  try {
    JSON.parse(result.body);
  } catch {
    return 'GET /api/v1/me/profile authenticated smoke must return parseable JSON';
  }

  return undefined;
}

function validateWsPath(result: ExistingClusterHttpProbeResult): string | undefined {
  return result.status === 400 || result.status === 401
    ? undefined
    : 'GET /api/v1/agent-execution/ws?agent_runner_id=__probe__ weak smoke expected 400 or 401 after live ingress path ownership check';
}

async function runRouteProbes(options: {
  publicBaseUrl: string;
  namespace: string;
  kubeconfigPath: string;
  runner: ExistingClusterCommandRunner;
  probeRunner: ExistingClusterHttpProbeRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
  authToken?: string;
}): Promise<{ probes: RouteProbeEvidence[]; failures: CheckFailure[] }> {
  const profileHeaders = options.authToken
    ? { accept: 'application/json', Authorization: `Bearer ${options.authToken}` }
    : { accept: 'application/json' };
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
      expected: options.authToken
        ? 'authenticated 200 JSON from API route'
        : '401 unauthenticated from API route',
      headers: profileHeaders,
      validate: options.authToken ? validateApiProfileAuthenticated : validateApiProfileUnauthenticated,
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
  const all = [...httpProbes, { probe: internalExposure.probe, failure: undefined }];

  return {
    probes: all.map((result) => result.probe),
    failures: [
      ...httpProbes.flatMap((result) => result.failure ? [result.failure] : []),
      ...internalExposure.failures,
    ],
  };
}

function staticCheckFailures(appYaml: string): CheckFailure[] {
  const checks = [
    checkRenderedOutput(appYaml),
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
  const app = await renderUnifiedDeployFromFiles({
    profile: 'existing-cluster',
    siteEnvPath: options.siteEnvPath,
    substrateTruthPath: options.substrateTruthPath,
    manifestPath: options.manifestPath,
    templatesRoot: options.templatesRoot,
  });
  const siteEnv = parseSiteEnv(await readFile(options.siteEnvPath, 'utf8'));

  return {
    appYaml: app.output,
    secretValues: collectRenderedSecretValues(app.output),
    publicBaseUrl: siteEnv.PUBLIC_BASE_URL,
    namespace: siteEnv.NAMESPACE,
  };
}

async function loadSubstrateTruthFingerprint(options: {
  substrateTruthPath: string;
  manifestPath?: string;
}): Promise<string> {
  const manifest = loadUnifiedDeployManifest({ manifestPath: options.manifestPath });
  const source = await readFile(options.substrateTruthPath, 'utf8');
  const truth = parseSubstrateTruth(source, {
    sourcePath: options.substrateTruthPath,
    requiredEnv: manifestRequiredEnv(manifest),
  });

  return truth.redacted_fingerprint;
}

function productVerificationMatrix(): ExistingClusterSmokeEvidence['product_verification_matrix'] {
  const base = {
    status: 'not_claimed',
    reason: 'existing-cluster smoke only proves deploy, rollout, and route ownership; product flow requires focused backend-real/e2e evidence',
  } as const;

  return {
    login_profile: {
      ...base,
      reason: 'route smoke is not product login/profile evidence',
      required_evidence_input: 'npm run test:e2e:integration:minimal:with-api or equivalent authenticated login/profile evidence',
    },
    workspace_project: {
      ...base,
      required_evidence_input: 'npm run test:e2e:integration:workspace-governance-switch or workspace/project backend-real evidence',
    },
    chat_via_llmup: {
      ...base,
      required_evidence_input: 'npm run test:e2e:integration:chat:with-api or chat-via-llmup backend-real evidence',
    },
    agent_task_managed_runner: {
      ...base,
      required_evidence_input: 'npm run test:agent-task:backend-real:runner or managed runner Agent task evidence',
    },
    files: {
      ...base,
      required_evidence_input: 'npm run test:files:backend-real:smoke or Files backend-real evidence',
    },
    audit: {
      ...base,
      required_evidence_input: 'backend-real audit evidence tied to key deploy/product actions',
    },
    usage: {
      ...base,
      required_evidence_input: 'backend-real usage evidence tied to key deploy/product actions',
    },
  };
}

function createEmptyEvidence(params: {
  kubeconfig: KubeconfigResolution;
  namespace: string;
  failures: CheckFailure[];
}): Omit<ExistingClusterSmokeEvidence, 'status' | 'generated_at' | 'paths'> {
  return {
    schema_version: 'agentsmith.unified-deploy.existing-cluster-smoke.evidence/v1',
    producer: 'existing-cluster-smoke',
    profile: 'existing-cluster',
    safety: {
      kubeconfig: params.kubeconfig.source,
      attempted_kubeconfig: params.kubeconfig.attempted,
      namespace: params.namespace,
      status: params.failures.length === 0 ? 'passed' : 'failed',
    },
    rendered_config_fingerprint: 'unavailable',
    substrate_truth_fingerprint: 'unavailable',
    manifest_summary: EMPTY_SUMMARY,
    operations: [],
    rollouts: [],
    live_api_replica_check: { status: 'skipped' },
    forbidden_resource_check: { status: 'skipped', checked_kinds: [], keda_api: EMPTY_KEDA_API_EVIDENCE },
    llmup_config_health: EMPTY_LLMUP_CONFIG_HEALTH,
    route_probes: [],
    product_verification_matrix: productVerificationMatrix(),
    failures: params.failures,
  };
}

async function writeExistingClusterSmokeEvidence(
  evidence: Omit<ExistingClusterSmokeEvidence, 'status' | 'generated_at' | 'paths'>,
  evidenceDir: string,
): Promise<ExistingClusterSmokeEvidence> {
  const resolvedEvidenceDir = path.resolve(evidenceDir);
  await mkdir(resolvedEvidenceDir, { recursive: true });

  const status: ProducerStatus = evidence.failures.length === 0 ? 'passed' : 'failed';
  const basename = `existing-cluster-smoke-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
  const reportPath = path.join(resolvedEvidenceDir, `${basename}.json`);
  const logPath = path.join(resolvedEvidenceDir, `${basename}.log`);
  const evidenceWithPaths: ExistingClusterSmokeEvidence = {
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
      'producer=existing-cluster-smoke',
      `status=${status}`,
      'profile=existing-cluster',
      `namespace=${evidence.safety.namespace}`,
      `failures=${evidence.failures.length}`,
      `report_path=${reportPath}`,
    ].join('\n') + '\n',
    'utf8',
  );

  return evidenceWithPaths;
}

async function finish(
  evidence: Omit<ExistingClusterSmokeEvidence, 'status' | 'generated_at' | 'paths'>,
  evidenceDir: string,
): Promise<ExistingClusterSmokeProducerResult> {
  const written = await writeExistingClusterSmokeEvidence(evidence, evidenceDir);

  return {
    status: written.status,
    failures: written.failures,
    evidence: written,
  };
}

async function runApplySequence(options: {
  appYaml: string;
  kubeconfigPath: string;
  runner: ExistingClusterCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ operations: OperationEvidence[]; failures: CheckFailure[] }> {
  const baseArgs = kubeBaseArgs(options.kubeconfigPath);
  const dryRun = await runKubectlOperation({
    name: 'app-dry-run',
    args: [...baseArgs, 'apply', '--dry-run=server', '-f', '-'],
    input: options.appYaml,
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
  });
  if (dryRun.failure) {
    return {
      operations: [dryRun.evidence],
      failures: [dryRun.failure],
    };
  }

  const apply = await runKubectlOperation({
    name: 'app-apply',
    args: [...baseArgs, 'apply', '-f', '-'],
    input: options.appYaml,
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
  });

  return {
    operations: [dryRun.evidence, apply.evidence],
    failures: apply.failure ? [apply.failure] : [],
  };
}

export async function runExistingClusterSmokeProducer(
  options: ExistingClusterSmokeProducerOptions = {},
): Promise<ExistingClusterSmokeProducerResult> {
  const evidenceDir = options.evidenceDir ?? DEFAULT_EVIDENCE_DIR;
  const env = options.env ?? process.env;
  const runner = options.runner ?? defaultExistingClusterCommandRunner;
  const probeRunner = options.probeRunner ?? defaultExistingClusterHttpProbeRunner;
  const siteEnvPath = path.resolve(options.siteEnvPath ?? DEFAULT_SITE_ENV_PATH);
  const substrateTruthPath = path.resolve(options.substrateTruthPath ?? DEFAULT_SUBSTRATE_TRUTH_PATH);
  const templatesRoot = options.templatesRoot ?? DEFAULT_TEMPLATES_ROOT;
  const kubeconfig = resolveKubeconfig({
    kubeconfigPath: options.kubeconfigPath,
    env,
    homeDir: options.homeDir ?? homedir(),
  });
  const initialFailures: CheckFailure[] = [];
  let namespace = '';

  try {
    const siteEnv = parseSiteEnv(await readFile(siteEnvPath, 'utf8'));
    namespace = siteEnv.NAMESPACE;
    if (siteEnv.UNIFIED_DEPLOY_PROFILE && siteEnv.UNIFIED_DEPLOY_PROFILE !== 'existing-cluster') {
      addFailure(initialFailures, 'safety:profile', 'existing-cluster smoke requires UNIFIED_DEPLOY_PROFILE=existing-cluster');
    }
  } catch (error: unknown) {
    addFailure(initialFailures, 'site-env', errorMessage(error));
  }

  if (!kubeconfig.path) {
    addFailure(
      initialFailures,
      'kubeconfig',
      `existing-cluster smoke requires KUBECONFIG or ${path.join(options.homeDir ?? homedir(), '.kube', 'config')}; attempted: ${kubeconfig.attempted.join(', ')}`,
    );
  }

  if (initialFailures.length > 0 || !kubeconfig.path) {
    return finish(createEmptyEvidence({
      kubeconfig,
      namespace,
      failures: initialFailures,
    }), evidenceDir);
  }

  const secretValues: string[] = [];
  const namespaceCheck = await runKubectlOperation({
    name: 'namespace-exists',
    args: [...kubeBaseArgs(kubeconfig.path), 'get', 'namespace', namespace, '-o', 'json'],
    runner,
    env,
    kubeconfigPath: kubeconfig.path,
    secretValues,
  });
  if (namespaceCheck.failure) {
    return finish({
      ...createEmptyEvidence({
        kubeconfig,
        namespace,
        failures: [{
          path: `namespace:${namespace}`,
          message: `existing-cluster namespace ${namespace} must already exist; app smoke does not create namespaces or run cluster-admin preflight`,
        }],
      }),
      operations: [namespaceCheck.evidence],
    }, evidenceDir);
  }

  let rendered: RenderedInputs;
  let substrateTruthFingerprint = 'unavailable';
  try {
    substrateTruthFingerprint = await loadSubstrateTruthFingerprint({
      substrateTruthPath,
      manifestPath: options.manifestPath,
    });
    rendered = await renderInputs({
      siteEnvPath,
      substrateTruthPath,
      manifestPath: options.manifestPath,
      templatesRoot,
    });
  } catch (error: unknown) {
    return finish({
      ...createEmptyEvidence({
        kubeconfig,
        namespace,
        failures: [{
          path: 'render',
          message: errorMessage(error),
        }],
      }),
      substrate_truth_fingerprint: substrateTruthFingerprint,
      operations: [namespaceCheck.evidence],
    }, evidenceDir);
  }

  const renderedSecretValues = rendered.secretValues;
  const renderedConfigFingerprint = fingerprintRenderedManifest(rendered.appYaml);
  const manifestSummary = summarizeRenderedManifest(rendered.appYaml);
  const staticFailures = staticCheckFailures(rendered.appYaml)
    .map((failure) => ({
      path: failure.path,
      message: redactDiagnostic(failure.message, renderedSecretValues),
    }));
  const baseEvidence: Omit<ExistingClusterSmokeEvidence, 'status' | 'generated_at' | 'paths'> = {
    ...createEmptyEvidence({
      kubeconfig,
      namespace: rendered.namespace,
      failures: staticFailures,
    }),
    safety: {
      kubeconfig: kubeconfig.source,
      attempted_kubeconfig: kubeconfig.attempted,
      namespace: rendered.namespace,
      status: 'passed',
    },
    rendered_config_fingerprint: renderedConfigFingerprint,
    substrate_truth_fingerprint: substrateTruthFingerprint,
    manifest_summary: manifestSummary,
    operations: [namespaceCheck.evidence],
  };

  if (staticFailures.length > 0) {
    return finish(baseEvidence, evidenceDir);
  }

  const apply = await runApplySequence({
    appYaml: rendered.appYaml,
    kubeconfigPath: kubeconfig.path,
    runner,
    env,
    secretValues: renderedSecretValues,
  });
  const afterApplyEvidence = {
    ...baseEvidence,
    operations: [...baseEvidence.operations, ...apply.operations],
    failures: apply.failures,
  };
  if (apply.failures.length > 0) {
    return finish(afterApplyEvidence, evidenceDir);
  }

  const rollouts = await runRollouts({
    namespace: rendered.namespace,
    kubeconfigPath: kubeconfig.path,
    runner,
    env,
    secretValues: renderedSecretValues,
  });
  const llmupConfigHealth = buildLlmupConfigHealthEvidence(rendered.appYaml, rollouts.rollouts);
  const liveApi = await checkLiveApiReplica({
    namespace: rendered.namespace,
    kubeconfigPath: kubeconfig.path,
    runner,
    env,
    secretValues: renderedSecretValues,
  });
  const forbiddenResources = await checkForbiddenResources({
    namespace: rendered.namespace,
    kubeconfigPath: kubeconfig.path,
    runner,
    env,
    secretValues: renderedSecretValues,
  });
  const routeProbes = await runRouteProbes({
    publicBaseUrl: options.publicBaseUrl ?? rendered.publicBaseUrl,
    namespace: rendered.namespace,
    kubeconfigPath: kubeconfig.path,
    runner,
    probeRunner,
    env,
    secretValues: renderedSecretValues,
    authToken: options.authToken ?? env.AGENTSMITH_EXISTING_CLUSTER_SMOKE_TOKEN,
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
  ExistingClusterSmokeProducerOptions,
  'siteEnvPath' | 'substrateTruthPath' | 'manifestPath' | 'templatesRoot' | 'evidenceDir' | 'kubeconfigPath' | 'publicBaseUrl' | 'authToken'
>;

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};

  for (const arg of argv) {
    if (arg.startsWith('--site-env=')) {
      options.siteEnvPath = arg.slice('--site-env='.length);
    } else if (arg.startsWith('--substrate-truth=')) {
      options.substrateTruthPath = arg.slice('--substrate-truth='.length);
    } else if (arg.startsWith('--manifest=')) {
      options.manifestPath = arg.slice('--manifest='.length);
    } else if (arg.startsWith('--templates-root=')) {
      options.templatesRoot = arg.slice('--templates-root='.length);
    } else if (arg.startsWith('--evidence-dir=')) {
      options.evidenceDir = arg.slice('--evidence-dir='.length);
    } else if (arg.startsWith('--kubeconfig=')) {
      options.kubeconfigPath = arg.slice('--kubeconfig='.length);
    } else if (arg.startsWith('--public-base-url=')) {
      options.publicBaseUrl = arg.slice('--public-base-url='.length);
    } else if (arg.startsWith('--auth-token=')) {
      options.authToken = arg.slice('--auth-token='.length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const result = await runExistingClusterSmokeProducer(parseCliOptions(process.argv.slice(2)));
  const message = `[unified-deploy] existing-cluster smoke ${result.status}\n[unified-deploy] evidence: ${result.evidence.paths.report_path}\n`;

  if (result.status === 'passed') {
    process.stdout.write(message);
    return;
  }

  process.stderr.write(`${result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n')}\n${message}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
