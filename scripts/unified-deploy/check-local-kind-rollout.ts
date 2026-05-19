import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  AFSCP_SCHEMA_BOOTSTRAP_JOB,
  AFSCP_VOLUME_BOOTSTRAP_JOB,
  PRODUCT_SCHEMA_BOOTSTRAP_JOB,
  splitAppBootstrapYaml,
  summarizeKubernetesJobStatus,
} from './afscp-bootstrap';
import { checkAddressTruth } from './check-address-truth';
import { checkApiSingleReplica } from './check-api-single-replica';
import {
  DEFAULT_LOCAL_KIND_SITE_ENV_PATH,
  checkLocalKindImagePreflight,
  type LocalKindImagePreflightResult,
  type RegistryAvailabilityPollOptions,
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
  splitKubernetesDocuments,
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
import {
  LEGACY_ASBCP_LOCAL_KIND_CLUSTER_RESOURCE_IDS,
  LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS,
  LEGACY_ASBCP_RESIDUE_MATCHERS,
} from './asbcp-legacy-residue-negative-evidence';
import {
  READINESS_STATE_ENV,
  runReadinessFieldIdentityMatches,
  validateRunReadinessStateForConsumer,
  type RunReadinessState,
} from '../governance/run-readiness-state';

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
    | 'afscp-storage-csi-apply'
    | 'afscp-storage-csi-controller-scale'
    | 'afscp-storage-csi-controller-rollout'
    | 'afscp-storage-csi-node-rollout'
    | 'substrate-endpointslice-reconcile-check'
    | 'substrate-endpointslice-reconcile-delete'
    | 'afscp-static-volume-reset-check-pvc'
    | 'afscp-static-volume-reset-check-pv'
    | 'afscp-static-volume-reset-diff'
    | 'afscp-static-volume-reset-delete-workloads'
    | 'afscp-static-volume-reset-delete-pvc'
    | 'afscp-static-volume-reset-delete-pv'
    | 'product-schema-bootstrap-delete-previous'
    | 'product-schema-bootstrap-wait'
    | 'product-schema-bootstrap-diagnostics-job-yaml'
    | 'product-schema-bootstrap-diagnostics-job-describe'
    | 'product-schema-bootstrap-diagnostics-pods-json'
    | 'product-schema-bootstrap-diagnostics-pod-describe'
    | 'product-schema-bootstrap-diagnostics-pod-logs'
    | 'product-schema-bootstrap-diagnostics-pod-previous-logs'
    | 'product-schema-bootstrap-diagnostics-pod-events'
    | 'product-schema-bootstrap-diagnostics-events'
    | 'afscp-schema-bootstrap-delete-previous'
    | 'afscp-schema-bootstrap-wait'
    | 'afscp-schema-bootstrap-diagnostics-job-yaml'
    | 'afscp-schema-bootstrap-diagnostics-job-describe'
    | 'afscp-schema-bootstrap-diagnostics-pods-json'
    | 'afscp-schema-bootstrap-diagnostics-pod-describe'
    | 'afscp-schema-bootstrap-diagnostics-pod-logs'
    | 'afscp-schema-bootstrap-diagnostics-pod-previous-logs'
    | 'afscp-schema-bootstrap-diagnostics-pod-events'
    | 'afscp-schema-bootstrap-diagnostics-events'
    | 'afscp-volume-bootstrap-delete-previous'
    | 'afscp-volume-bootstrap-wait'
    | 'afscp-volume-bootstrap-diagnostics-job-yaml'
    | 'afscp-volume-bootstrap-diagnostics-job-describe'
    | 'afscp-volume-bootstrap-diagnostics-pods-json'
    | 'afscp-volume-bootstrap-diagnostics-pod-describe'
    | 'afscp-volume-bootstrap-diagnostics-pod-logs'
    | 'afscp-volume-bootstrap-diagnostics-pod-previous-logs'
    | 'afscp-volume-bootstrap-diagnostics-pod-events'
    | 'afscp-volume-bootstrap-diagnostics-events'
    | 'afscp-functional-convergence-check'
    | 'afscp-functional-diagnostics-pods-json'
    | 'afscp-functional-diagnostics-deployment-describe'
    | 'afscp-functional-diagnostics-pod-describe'
    | 'afscp-functional-diagnostics-pod-logs'
    | 'afscp-functional-diagnostics-pod-previous-logs'
    | 'afscp-functional-diagnostics-pod-events'
    | 'afscp-functional-diagnostics-events'
    | 'product-schema-bootstrap-dry-run'
    | 'product-schema-bootstrap-apply'
    | 'afscp-schema-bootstrap-dry-run'
    | 'afscp-schema-bootstrap-apply'
    | 'afscp-volume-bootstrap-dry-run'
    | 'afscp-volume-bootstrap-apply'
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

type AsbcpImageAdoptionEvidence = {
  status: StepStatus;
  source_ref?: string;
  source_digest?: string;
  site_env_ref?: string;
  rendered_ref?: string;
  target_digest?: string;
  running_pods: string[];
  running_image_ids: string[];
};

type StaleResourceAbsenceEvidence = {
  status: StepStatus;
  scope: 'absence_only';
  checked_kinds: string[];
  absent: string[];
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
  asbcp_image_adoption: AsbcpImageAdoptionEvidence;
  stale_resource_absence_check: StaleResourceAbsenceEvidence;
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
  registryAvailabilityPoll?: RegistryAvailabilityPollOptions;
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
  siteEnvValues: Record<string, string>;
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
const AFSCP_WORKLOAD_ROLLOUT_TIMEOUT = '180s';
const ROLLOUT_COMMAND_TIMEOUT_BUFFER_MS = 30_000;
const INGRESS_ROLLOUT_TIMEOUT = '240s';
const LOCAL_KIND_NAMESPACE = 'agentsmith';
const LOCAL_KIND_INGRESS_NAMESPACE = 'ingress-nginx';
const LOCAL_KIND_INGRESS_CLASS = 'nginx';
const LOCAL_KIND_CONTROL_PLANE_NODE = 'agentsmith-control-plane';
const LOCAL_KIND_INGRESS_NODE_PORT = '30080';
const LOCAL_KIND_INGRESS_HOST_PORT = '29180';
const DEFAULT_ASBCP_IMAGE_LOCK_PATH = path.join(REPO_ROOT, 'infra', 'deploy', 'shared', 'asbcp-image.lock');
const AFSCP_DEFAULT_VOLUME_PVC = 'afscp-default-volume';
const AFSCP_RUNTIME_COMPONENT = 'afscp-runtime';
const AFSCP_STORAGE_CSI_NAMESPACE = 'kube-system';
const AFSCP_STORAGE_CSI_MANIFEST_PATH = path.join(REPO_ROOT, 'infra', 'deploy', 'unified', 'local-kind', 'juicefs-csi', 'upstream-manifest.yaml');
const AFSCP_STORAGE_CSI_CONTROLLER = 'juicefs-csi-controller';
const AFSCP_STORAGE_CSI_NODE = 'juicefs-csi-node';
const AFSCP_STORAGE_CSI_ROLLOUT_TIMEOUT = '600s';
const AFSCP_SCHEMA_BOOTSTRAP_WAIT_TIMEOUT = '120s';
const AFSCP_SCHEMA_BOOTSTRAP_WAIT_TIMEOUT_MS = 150_000;
const AFSCP_BOOTSTRAP_JOB_POLL_INTERVAL_MS = 2_000;
const AFSCP_SCHEMA_BOOTSTRAP_DIAGNOSTIC_TIMEOUT_MS = 30_000;
const AFSCP_SCHEMA_BOOTSTRAP_DIAGNOSTIC_OUTPUT_LIMIT = 12_000;
const AFSCP_FUNCTIONAL_CONVERGENCE_TIMEOUT_MS = 90_000;
const AFSCP_FUNCTIONAL_DIAGNOSTIC_TIMEOUT_MS = 30_000;
const AFSCP_FUNCTIONAL_DIAGNOSTIC_OUTPUT_LIMIT = 12_000;
const AFSCP_WORKLOAD_DEPLOYMENTS = [
  'afscp-api',
  'afscp-worker',
  'afscp-export-gateway',
] as const;
const ROLLOUT_DEPLOYMENTS = [
  'agentsmith-web',
  'agentsmith-api',
  'agentsmith-llmup',
  ...AFSCP_WORKLOAD_DEPLOYMENTS,
  'agentsmith-sandbox-control-plane',
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
const EMPTY_ASBCP_IMAGE_ADOPTION: AsbcpImageAdoptionEvidence = {
  status: 'skipped',
  running_pods: [],
  running_image_ids: [],
};
const STALE_RESOURCE_ABSENT_IDS = [
  ...LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS,
  ...LEGACY_ASBCP_LOCAL_KIND_CLUSTER_RESOURCE_IDS,
] as const;
const EMPTY_STALE_RESOURCE_ABSENCE: StaleResourceAbsenceEvidence = {
  status: 'skipped',
  scope: 'absence_only',
  checked_kinds: [],
  absent: [],
};

function rolloutTimeoutForDeployment(deployment: string): string {
  return (AFSCP_WORKLOAD_DEPLOYMENTS as readonly string[]).includes(deployment)
    ? AFSCP_WORKLOAD_ROLLOUT_TIMEOUT
    : ROLLOUT_TIMEOUT;
}

function rolloutCommandTimeoutMsForDeployment(deployment: string): number {
  const timeout = rolloutTimeoutForDeployment(deployment);
  const seconds = /^(\d+)s$/u.exec(timeout)?.[1];
  if (!seconds) {
    return KUBECTL_TIMEOUT_MS;
  }
  return (Number(seconds) * 1_000) + ROLLOUT_COMMAND_TIMEOUT_BUFFER_MS;
}

function addFailure(failures: CheckFailure[], failurePath: string, message: string): void {
  failures.push({ path: failurePath, message });
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
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

function addAfscpCompositeServiceTokens(secrets: Set<string>, key: string, value: string): void {
  if (key !== 'AFSCP_API_SERVICE_TOKENS') {
    return;
  }

  for (const entry of value.split(',')) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    addSecretValue(secrets, entry.slice(separatorIndex + 1), { force: true });
  }
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
        addAfscpCompositeServiceTokens(secrets, key, value);
        if (field === 'data' || field === 'binaryData') {
          try {
            const decodedValue = Buffer.from(value, 'base64').toString('utf8');
            addSecretValue(secrets, decodedValue, {
              force: SECRET_FIELD_KEY_PATTERN.test(key),
            });
            addAfscpCompositeServiceTokens(secrets, key, decodedValue);
          } catch {
            // Invalid base64 will be reported by Kubernetes validation when relevant.
          }
        }
      }
    }
  }

  return [...secrets].sort((left, right) => right.length - left.length);
}

function redactDiagnostic(value: string, secretValues: readonly string[] = [], maxLength = 4000): string {
  let redacted = value
    .replace(/\/\/([^:\s/]+):([^@\s/]+)@/gu, '//$1:[REDACTED]@')
    .replace(/\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|ACCESS_KEY|API_KEY|DATABASE_URL|MONGO_URL|REDIS_URL|CLIENT_SECRET)[A-Z0-9_]*)=([^\s]+)/giu, '$1=[REDACTED]');

  for (const secret of secretValues) {
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), 'gu'), '[REDACTED]');
  }

  return redacted.slice(0, maxLength);
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

function splitAdminPreflightYaml(preflightYaml: string): { namespaceYaml: string; resourceYaml: string } {
  const split = splitKubernetesDocuments(preflightYaml, (document) => resourceKind(document) === 'Namespace');

  return {
    namespaceYaml: split.firstYaml,
    resourceYaml: split.secondYaml,
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
  timeoutMs?: number;
}): Promise<{ evidence: OperationEvidence; failure?: CheckFailure }> {
  const result = await options.runner('kubectl', options.args, {
    input: options.input,
    cwd: REPO_ROOT,
    env: {
      ...options.env,
      KUBECONFIG: options.kubeconfigPath,
    },
    timeoutMs: options.timeoutMs ?? KUBECTL_TIMEOUT_MS,
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
  timeoutMs?: number;
  diagnosticMaxLength?: number;
}): Promise<{ evidence: OperationEvidence; failure?: CheckFailure; raw: LocalKindCommandRunResult }> {
  const result = await options.runner('kubectl', options.args, {
    cwd: REPO_ROOT,
    env: {
      ...options.env,
      KUBECONFIG: options.kubeconfigPath,
    },
    timeoutMs: options.timeoutMs ?? KUBECTL_TIMEOUT_MS,
  });
  const evidence: OperationEvidence = {
    name: options.name,
    command: commandText(options.args),
    status: result.exitCode === 0 ? 'passed' : options.statusWhenFailed ?? 'failed',
    exit_code: result.exitCode,
    stdout: redactDiagnostic(result.stdout, options.secretValues, options.diagnosticMaxLength),
    stderr: redactDiagnostic(result.stderr, options.secretValues, options.diagnosticMaxLength),
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
    `--timeout=${rolloutTimeoutForDeployment(options.deployment)}`,
  ];
  const result = await options.runner('kubectl', args, {
    cwd: REPO_ROOT,
    env: {
      ...options.env,
      KUBECONFIG: options.kubeconfigPath,
    },
    timeoutMs: rolloutCommandTimeoutMsForDeployment(options.deployment),
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

function readinessFieldReadyWithIdentity(options: {
  env: Record<string, string | undefined>;
  field: keyof RunReadinessState['readiness'];
  identity: Record<string, string>;
}): boolean {
  const statePath = options.env[READINESS_STATE_ENV.path]?.trim();
  const invocationId = options.env[READINESS_STATE_ENV.invocationId]?.trim();
  const processNonce = options.env[READINESS_STATE_ENV.processNonce]?.trim();
  const inputDigest = options.env[READINESS_STATE_ENV.inputDigest]?.trim();
  const envDigest = options.env[READINESS_STATE_ENV.envDigest]?.trim();
  const gitSha = options.env[READINESS_STATE_ENV.gitSha]?.trim();
  if (!statePath || !invocationId || !processNonce || !inputDigest || !envDigest) {
    return false;
  }

  const validation = validateRunReadinessStateForConsumer({
    statePath,
    invocationId,
    processNonce,
    inputDigest,
    envDigest,
    ...(gitSha ? { gitSha } : {}),
  });
  if (!validation.ok || validation.state.readiness[options.field] !== 'ready') {
    return false;
  }

  return runReadinessFieldIdentityMatches({
    state: validation.state,
    field: options.field,
    identities: options.identity,
  });
}

async function resolveLocalKindClusterUid(options: {
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
}): Promise<string | null> {
  const result = await options.runner('kubectl', [
    'get',
    'namespace',
    'kube-system',
    '-o',
    'jsonpath={.metadata.uid}',
  ], {
    env: options.env,
    timeoutMs: KUBECTL_TIMEOUT_MS,
  });
  return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function listItems(resourceList: Record<string, unknown>): Record<string, unknown>[] {
  const items = resourceList.items;
  return Array.isArray(items) ? items.map(asRecord) : [];
}

function digestFromImageRef(value: string | undefined): string | undefined {
  const match = value ? /(sha256:[a-fA-F0-9]{64})/u.exec(value) : undefined;
  return match?.[1]?.toLowerCase();
}

async function readAsbcpSourceImageLock(): Promise<{ sourceRef?: string; sourceDigest?: string; failure?: CheckFailure }> {
  try {
    const source = await readFile(DEFAULT_ASBCP_IMAGE_LOCK_PATH, 'utf8');
    const sourceRef = /^asbcp_source_image=(.+)$/mu.exec(source)?.[1]?.trim();
    const sourceDigest = digestFromImageRef(sourceRef);
    if (!sourceRef || !sourceDigest) {
      return {
        failure: {
          path: 'image-adoption:asbcp-lock',
          message: 'ASBCP image adoption evidence requires asbcp-image.lock with asbcp_source_image pinned by sha256 digest',
        },
      };
    }

    return { sourceRef, sourceDigest };
  } catch (error: unknown) {
    return {
      failure: {
        path: 'image-adoption:asbcp-lock',
        message: `failed to read ASBCP image lock: ${errorMessage(error)}`,
      },
    };
  }
}

function runningAsbcpImageIds(podList: Record<string, unknown>): { pods: string[]; imageIds: string[] } {
  const pods: string[] = [];
  const imageIds: string[] = [];

  for (const pod of listItems(podList)) {
    const status = asRecord(pod.status);
    if (status.phase !== 'Running') {
      continue;
    }
    const podName = resourceName(pod);
    const containerStatuses = Array.isArray(status.containerStatuses)
      ? status.containerStatuses.map(asRecord)
      : [];
    for (const containerStatus of containerStatuses) {
      if (containerStatus.name !== 'asbcp' || typeof containerStatus.imageID !== 'string') {
        continue;
      }
      pods.push(podName);
      imageIds.push(containerStatus.imageID);
    }
  }

  return { pods, imageIds };
}

async function checkAsbcpImageAdoption(options: {
  siteEnvValues: Record<string, string>;
  appYaml: string;
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ evidence: AsbcpImageAdoptionEvidence; failures: CheckFailure[] }> {
  const failures: CheckFailure[] = [];
  const lock = await readAsbcpSourceImageLock();
  if (lock.failure) {
    failures.push(lock.failure);
  }

  const siteEnvRef = options.siteEnvValues.ASBCP_IMAGE;
  const asbcpContainer = renderedDeploymentContainer(
    options.appYaml,
    'agentsmith-sandbox-control-plane',
    'asbcp',
  );
  const renderedRef = typeof asbcpContainer.image === 'string' ? asbcpContainer.image : undefined;
  const targetDigest = digestFromImageRef(renderedRef ?? siteEnvRef);

  if (!siteEnvRef) {
    addFailure(failures, 'image-adoption:ASBCP_IMAGE', 'generated site env must include ASBCP_IMAGE for ASBCP image adoption evidence');
  }
  if (!renderedRef) {
    addFailure(failures, 'image-adoption:Deployment/agentsmith-sandbox-control-plane', 'rendered ASBCP Deployment must include an image ref');
  }
  if (siteEnvRef && renderedRef && siteEnvRef !== renderedRef) {
    addFailure(failures, 'image-adoption:Deployment/agentsmith-sandbox-control-plane', 'rendered ASBCP Deployment image must match generated site env ASBCP_IMAGE');
  }
  if (lock.sourceDigest && targetDigest && lock.sourceDigest !== targetDigest) {
    addFailure(
      failures,
      'image-adoption:agentsmith-sandbox-control-plane:digest',
      `ASBCP source digest ${lock.sourceDigest} must match target/rendered digest ${targetDigest}`,
    );
  }
  if (!targetDigest) {
    addFailure(failures, 'image-adoption:agentsmith-sandbox-control-plane:digest', 'ASBCP target image must be pinned by sha256 digest');
  }

  const args = [
    ...kubeBaseArgs(options.kubeconfigPath),
    '-n',
    options.namespace,
    'get',
    'pods',
    '-l',
    'app.kubernetes.io/name=agentsmith,app.kubernetes.io/component=asbcp',
    '-o',
    'json',
  ];
  const podsResult = await kubectlJson({ ...options, args });
  let runningPods: string[] = [];
  let runningImageIds: string[] = [];
  if (podsResult.ok) {
    const live = runningAsbcpImageIds(podsResult.value);
    runningPods = live.pods;
    runningImageIds = live.imageIds;
    if (runningImageIds.length === 0) {
      addFailure(failures, 'live:Pod/agentsmith-sandbox-control-plane:imageID', 'running ASBCP Pod must expose status.containerStatuses[].imageID');
    } else if (targetDigest) {
      const mismatchedImageIds = runningImageIds.filter((imageId) => digestFromImageRef(imageId) !== targetDigest);
      if (mismatchedImageIds.length > 0) {
        addFailure(
          failures,
          'live:Pod/agentsmith-sandbox-control-plane:imageID',
          `all running ASBCP Pod imageID digests must match target digest ${targetDigest}`,
        );
      }
    }
  } else {
    failures.push({ ...podsResult.failure, path: 'live:Pod/agentsmith-sandbox-control-plane:imageID' });
  }

  return {
    evidence: {
      status: failures.length === 0 ? 'passed' : 'failed',
      source_ref: lock.sourceRef,
      source_digest: lock.sourceDigest,
      site_env_ref: siteEnvRef,
      rendered_ref: renderedRef,
      target_digest: targetDigest,
      running_pods: runningPods,
      running_image_ids: runningImageIds,
    },
    failures,
  };
}

function containsLegacyAsbcpResidue(resource: Record<string, unknown>): boolean {
  const name = resourceName(resource).toLowerCase();
  const serialized = JSON.stringify(resource).toLowerCase();

  return LEGACY_ASBCP_RESIDUE_MATCHERS.some((matcher) =>
    name.includes(matcher) || serialized.includes(matcher),
  );
}

async function checkStaleResourceAbsence(options: {
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ evidence: StaleResourceAbsenceEvidence; failures: CheckFailure[] }> {
  const failures: CheckFailure[] = [];
  const checkedKinds = ['Deployment', 'Service', 'ConfigMap', 'ServiceAccount', 'Role', 'RoleBinding', 'ClusterRole', 'ClusterRoleBinding'];
  const items: Record<string, unknown>[] = [];
  const namespacedArgs = [
    ...kubeBaseArgs(options.kubeconfigPath),
    '-n',
    options.namespace,
    'get',
    'deployment,service,configmap,serviceaccount,role,rolebinding',
    '-o',
    'json',
    '--ignore-not-found',
  ];
  const namespacedResult = await kubectlJson({ ...options, args: namespacedArgs });
  if (namespacedResult.ok) {
    items.push(...listItems(namespacedResult.value));
  } else {
    failures.push({
      ...namespacedResult.failure,
      path: 'live:stale-legacy-asbcp:namespaced',
      message: `failed to complete stale legacy ASBCP absence-only namespaced resource check: ${namespacedResult.failure.message}`,
    });
  }

  const clusterArgs = [
    ...kubeBaseArgs(options.kubeconfigPath),
    'get',
    'clusterrole,clusterrolebinding',
    '-o',
    'json',
    '--ignore-not-found',
  ];
  const clusterResult = await kubectlJson({ ...options, args: clusterArgs });
  if (clusterResult.ok) {
    items.push(...listItems(clusterResult.value));
  } else {
    failures.push({
      ...clusterResult.failure,
      path: 'live:stale-legacy-asbcp:cluster-rbac',
      message: `failed to complete stale legacy ASBCP absence-only local-kind PV RBAC check: ${clusterResult.failure.message}`,
    });
  }

  for (const item of items) {
    if (!containsLegacyAsbcpResidue(item)) {
      continue;
    }
    addFailure(
      failures,
      `live:${resourceKind(item)}/${resourceName(item)}`,
      'legacy ASBCP resource is present; this producer is absence-only and does not modify migrated clusters',
    );
  }

  return {
    evidence: {
      status: failures.length === 0 ? 'passed' : 'failed',
      scope: 'absence_only',
      checked_kinds: checkedKinds,
      absent: [...STALE_RESOURCE_ABSENT_IDS],
    },
    failures,
  };
}

function metadataLabels(resource: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asRecord(resource.metadata).labels);
}

function metadataAnnotations(resource: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asRecord(resource.metadata).annotations);
}

function resourceNamespace(resource: Record<string, unknown>): string {
  const namespace = asRecord(resource.metadata).namespace;
  return typeof namespace === 'string' ? namespace : '';
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

type DesiredAfscpStaticVolume = {
  namespace: string;
  pvcName: string;
  pvName: string;
  storageQuantity: string;
  pvc: Record<string, unknown>;
  pv: Record<string, unknown>;
};

function desiredAfscpStaticVolume(appYaml: string, namespace: string): DesiredAfscpStaticVolume | undefined {
  const parsed = parseKubernetesDocuments(appYaml);
  if (!parsed.ok) {
    throw new Error(parsed.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n'));
  }

  const pvc = parsed.documents.find((document) =>
    resourceKind(document) === 'PersistentVolumeClaim'
    && resourceName(document) === AFSCP_DEFAULT_VOLUME_PVC
    && resourceNamespace(document) === namespace,
  );
  if (!pvc) {
    return undefined;
  }

  const pvcSpec = asRecord(pvc.spec);
  const pvcRequests = asRecord(asRecord(pvcSpec.resources).requests);
  const pvName = typeof pvcSpec.volumeName === 'string' ? pvcSpec.volumeName : '';
  const storageQuantity = pvcRequests.storage;
  if (!pvName || typeof storageQuantity !== 'string') {
    throw new Error('AFSCP default PersistentVolumeClaim must render volumeName and resources.requests.storage before local-kind reset');
  }

  const pv = parsed.documents.find((document) =>
    resourceKind(document) === 'PersistentVolume'
    && resourceName(document) === pvName,
  );
  if (!pv) {
    throw new Error(`AFSCP default PersistentVolume ${pvName} must render with PersistentVolumeClaim ${AFSCP_DEFAULT_VOLUME_PVC} before local-kind reset`);
  }
  const pvStorageQuantity = asRecord(asRecord(pv?.spec).capacity).storage;
  if (pvStorageQuantity !== storageQuantity) {
    throw new Error('AFSCP default PersistentVolume and PersistentVolumeClaim must render the same storage quantity before local-kind reset');
  }

  return {
    namespace,
    pvcName: AFSCP_DEFAULT_VOLUME_PVC,
    pvName,
    storageQuantity,
    pvc,
    pv,
  };
}

function isOwnedAfscpStaticVolumeResource(
  resource: Record<string, unknown>,
  desired: DesiredAfscpStaticVolume,
): boolean {
  const labels = metadataLabels(resource);
  const annotations = metadataAnnotations(resource);
  const kind = resourceKind(resource);
  const expectedName = kind === 'PersistentVolume' ? desired.pvName : desired.pvcName;
  const expectedNamespace = kind === 'PersistentVolumeClaim' ? desired.namespace : '';

  return resourceName(resource) === expectedName
    && (expectedNamespace === '' || resourceNamespace(resource) === expectedNamespace)
    && labels['app.kubernetes.io/name'] === 'agentsmith'
    && labels['app.kubernetes.io/component'] === AFSCP_RUNTIME_COMPONENT
    && labels['app.kubernetes.io/part-of'] === 'agentsmith-deploy'
    && annotations['rendered-by'] === 'agentsmith-unified-deploy';
}

type ResetFieldFingerprint = {
  present: boolean;
  value?: unknown;
};

type ResetSpecDiff = {
  path: string;
  desired: string;
  live: string;
};

type ResetSpecFingerprint = Record<string, ResetFieldFingerprint>;

function isResetRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnResetField(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function readOwnResetPath(
  source: unknown,
  pathSegments: readonly string[],
): { present: true; value: unknown } | { present: false } {
  let current = source;
  for (const segment of pathSegments) {
    if (!isResetRecord(current) || !hasOwnResetField(current, segment)) {
      return { present: false };
    }
    current = current[segment];
  }

  return { present: true, value: current };
}

function canonicalResetValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalResetValue);
  }
  if (isResetRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalResetValue(nestedValue)]),
    );
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  return String(value);
}

function resetFieldFingerprint(value: unknown): ResetFieldFingerprint {
  return {
    present: true,
    value: canonicalResetValue(value),
  };
}

function resetPathFingerprint(source: unknown, pathSegments: readonly string[]): ResetFieldFingerprint {
  const result = readOwnResetPath(source, pathSegments);
  return result.present ? resetFieldFingerprint(result.value) : { present: false };
}

function resetArrayPathFingerprint(
  source: unknown,
  pathSegments: readonly string[],
  options: { sort: boolean },
): ResetFieldFingerprint {
  const result = readOwnResetPath(source, pathSegments);
  if (!result.present) {
    return { present: false };
  }
  if (!Array.isArray(result.value)) {
    return resetFieldFingerprint(result.value);
  }

  const values = result.value.map(canonicalResetValue);
  if (options.sort) {
    values.sort((left, right) => resetValueText(left).localeCompare(resetValueText(right)));
  }

  return resetFieldFingerprint(values);
}

function resetPresenceFingerprint(source: unknown, pathSegments: readonly string[]): ResetFieldFingerprint {
  return resetFieldFingerprint(readOwnResetPath(source, pathSegments).present);
}

function resetSecretReferenceFingerprint(
  source: unknown,
  pathName: string,
  pathSegments: readonly string[],
): ResetSpecFingerprint {
  return {
    [`${pathName}.present`]: resetPresenceFingerprint(source, pathSegments),
    [`${pathName}.name`]: resetPathFingerprint(source, [...pathSegments, 'name']),
    [`${pathName}.namespace`]: resetPathFingerprint(source, [...pathSegments, 'namespace']),
  };
}

function resetValueText(value: unknown): string {
  const stringified = JSON.stringify(canonicalResetValue(value));
  return stringified === undefined ? String(value) : stringified;
}

function diffResetSpecFingerprints(
  desired: ResetSpecFingerprint,
  live: ResetSpecFingerprint,
): ResetSpecDiff[] {
  const paths = [...new Set([...Object.keys(desired), ...Object.keys(live)])].sort();
  return paths.flatMap((pathName) => {
    const desiredText = resetValueText(desired[pathName]);
    const liveText = resetValueText(live[pathName]);
    return desiredText === liveText
      ? []
      : [{
        path: pathName,
        desired: desiredText,
        live: liveText,
      }];
  });
}

function afscpPersistentVolumeResetFingerprint(resource: Record<string, unknown>): ResetSpecFingerprint {
  const spec = asRecord(resource.spec);
  return {
    'spec.capacity.storage': resetPathFingerprint(spec, ['capacity', 'storage']),
    'spec.volumeMode': resetPathFingerprint(spec, ['volumeMode']),
    'spec.accessModes': resetArrayPathFingerprint(spec, ['accessModes'], { sort: true }),
    'spec.storageClassName': resetPathFingerprint(spec, ['storageClassName']),
    'spec.mountOptions': resetArrayPathFingerprint(spec, ['mountOptions'], { sort: false }),
    'spec.nodeAffinity': resetPathFingerprint(spec, ['nodeAffinity']),
    'spec.csi.driver': resetPathFingerprint(spec, ['csi', 'driver']),
    'spec.csi.volumeHandle': resetPathFingerprint(spec, ['csi', 'volumeHandle']),
    'spec.csi.readOnly': resetPathFingerprint(spec, ['csi', 'readOnly']),
    'spec.csi.fsType': resetPathFingerprint(spec, ['csi', 'fsType']),
    ...resetSecretReferenceFingerprint(spec, 'spec.csi.nodePublishSecretRef', ['csi', 'nodePublishSecretRef']),
    ...resetSecretReferenceFingerprint(spec, 'spec.csi.nodeStageSecretRef', ['csi', 'nodeStageSecretRef']),
    ...resetSecretReferenceFingerprint(spec, 'spec.csi.controllerPublishSecretRef', ['csi', 'controllerPublishSecretRef']),
    ...resetSecretReferenceFingerprint(spec, 'spec.csi.controllerExpandSecretRef', ['csi', 'controllerExpandSecretRef']),
    'spec.csi.volumeAttributes': resetPathFingerprint(spec, ['csi', 'volumeAttributes']),
  };
}

function afscpPersistentVolumeClaimResetFingerprint(resource: Record<string, unknown>): ResetSpecFingerprint {
  const spec = asRecord(resource.spec);
  return {
    'spec.accessModes': resetArrayPathFingerprint(spec, ['accessModes'], { sort: true }),
    'spec.volumeMode': resetPathFingerprint(spec, ['volumeMode']),
    'spec.storageClassName': resetPathFingerprint(spec, ['storageClassName']),
    'spec.volumeName': resetPathFingerprint(spec, ['volumeName']),
    'spec.resources.requests.storage': resetPathFingerprint(spec, ['resources', 'requests', 'storage']),
    'spec.selector.present': resetPresenceFingerprint(spec, ['selector']),
    'spec.dataSource.present': resetPresenceFingerprint(spec, ['dataSource']),
    'spec.dataSourceRef.present': resetPresenceFingerprint(spec, ['dataSourceRef']),
  };
}

function afscpStaticVolumeResetDiff(
  resource: Record<string, unknown> | undefined,
  desired: DesiredAfscpStaticVolume,
): ResetSpecDiff[] {
  if (!resource) {
    return [];
  }

  if (resourceKind(resource) === 'PersistentVolume') {
    return diffResetSpecFingerprints(
      afscpPersistentVolumeResetFingerprint(desired.pv),
      afscpPersistentVolumeResetFingerprint(resource),
    );
  }

  if (resourceKind(resource) === 'PersistentVolumeClaim') {
    return diffResetSpecFingerprints(
      afscpPersistentVolumeClaimResetFingerprint(desired.pvc),
      afscpPersistentVolumeClaimResetFingerprint(resource),
    );
  }

  return [];
}

function afscpStaticVolumeBoundPvFailure(
  livePvc: Record<string, unknown> | undefined,
  desired: DesiredAfscpStaticVolume,
): CheckFailure | undefined {
  if (!livePvc) {
    return undefined;
  }

  const volumeName = asRecord(livePvc.spec).volumeName;
  if (typeof volumeName !== 'string' || volumeName.length === 0 || volumeName === desired.pvName) {
    return undefined;
  }

  return {
    path: `afscp-static-volume:PersistentVolumeClaim/${desired.pvcName}:spec.volumeName`,
    message: `live AFSCP PersistentVolumeClaim spec.volumeName is ${volumeName}; expected ${desired.pvName}; refusing to delete workloads/PVC/PV before app apply`,
  };
}

function afscpStaticVolumeClaimRefFailure(
  livePv: Record<string, unknown> | undefined,
  desired: DesiredAfscpStaticVolume,
): CheckFailure | undefined {
  if (!livePv) {
    return undefined;
  }

  const spec = asRecord(livePv.spec);
  if (!hasOwnResetField(spec, 'claimRef')) {
    return undefined;
  }

  const claimRef = spec.claimRef;
  if (!isResetRecord(claimRef)) {
    return {
      path: `afscp-static-volume:PersistentVolume/${desired.pvName}:claimRef`,
      message: `live AFSCP PersistentVolume claimRef must point at ${desired.namespace}/${desired.pvcName}; refusing to delete before app apply`,
    };
  }

  const claimNamespace = typeof claimRef.namespace === 'string' ? claimRef.namespace : '';
  const claimName = typeof claimRef.name === 'string' ? claimRef.name : '';
  if (claimNamespace === desired.namespace && claimName === desired.pvcName) {
    return undefined;
  }

  return {
    path: `afscp-static-volume:PersistentVolume/${desired.pvName}:claimRef`,
    message: `live AFSCP PersistentVolume claimRef points at ${claimNamespace || '<missing>'}/${claimName || '<missing>'}; expected ${desired.namespace}/${desired.pvcName}; refusing to delete before app apply`,
  };
}

function reclaimPolicyText(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : '<missing>';
}

function afscpStaticVolumeReclaimPolicyFailure(
  livePv: Record<string, unknown> | undefined,
  desired: DesiredAfscpStaticVolume,
): CheckFailure | undefined {
  if (!livePv) {
    return undefined;
  }

  const livePolicy = asRecord(livePv.spec).persistentVolumeReclaimPolicy;
  const desiredPolicy = asRecord(desired.pv.spec).persistentVolumeReclaimPolicy;
  if (livePolicy === desiredPolicy) {
    return undefined;
  }

  return {
    path: `afscp-static-volume:PersistentVolume/${desired.pvName}:spec.persistentVolumeReclaimPolicy`,
    message: `live AFSCP PersistentVolume persistentVolumeReclaimPolicy is ${reclaimPolicyText(livePolicy)}; desired is ${reclaimPolicyText(desiredPolicy)}; refusing to delete workloads/PVC/PV before app apply`,
  };
}

function afscpStaticVolumeResetDiffEvidence(params: {
  pvcDiff: ResetSpecDiff[];
  pvDiff: ResetSpecDiff[];
  secretValues: readonly string[];
}): OperationEvidence {
  return {
    name: 'afscp-static-volume-reset-diff',
    command: 'internal: compare rendered and live AFSCP static PV/PVC reset fields',
    status: 'passed',
    stdout: redactDiagnostic(JSON.stringify({
      pvc: params.pvcDiff,
      pv: params.pvDiff,
    }, null, 2), params.secretValues),
  };
}

function parseOptionalKubectlResource(source: string): Record<string, unknown> | undefined {
  const trimmed = source.trim();
  if (!trimmed) {
    return undefined;
  }

  return parseJsonObject(trimmed);
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
    expected: 'public ingress must not route to agentsmith-llmup or agentsmith-sandbox-control-plane',
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
    service === 'agentsmith-llmup' || service === 'agentsmith-sandbox-control-plane',
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
  let payload: unknown;
  try {
    payload = JSON.parse(result.body) as unknown;
  } catch {
    return 'GET /api/public/workspaces must return parseable JSON';
  }
  if (!isPublicWorkspacesDirectoryPayload(payload)) {
    return 'GET /api/public/workspaces JSON shape must match the public workspace directory payload';
  }

  return undefined;
}

function isPublicWorkspacesDirectoryPayload(value: unknown): boolean {
  if (!isJsonRecord(value)) {
    return false;
  }
  if (!Array.isArray(value.items)) {
    return false;
  }

  const total = value.total;
  return value.items.every(isPublicWorkspaceDirectoryItem)
    && (total === undefined || (typeof total === 'number' && Number.isFinite(total)));
}

function isPublicWorkspaceDirectoryItem(value: unknown): boolean {
  if (!isJsonRecord(value)) {
    return false;
  }
  return typeof value.id === 'string' && value.id.length > 0
    && (value.name === undefined || typeof value.name === 'string');
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    siteEnvValues: siteEnv,
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

async function ensureAfscpStorageCsiReady(options: {
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ operations: OperationEvidence[]; failures: CheckFailure[] }> {
  const baseArgs = kubeBaseArgs(options.kubeconfigPath);
  const operations: OperationEvidence[] = [];
  const failures: CheckFailure[] = [];

  if (!existsSync(AFSCP_STORAGE_CSI_MANIFEST_PATH)) {
    return {
      operations,
      failures: [{
        path: 'afscp-storage-csi:manifest',
        message: `local-kind rollout requires the bundled JuiceFS CSI manifest at ${AFSCP_STORAGE_CSI_MANIFEST_PATH}`,
      }],
    };
  }

  const steps: Array<{ name: OperationEvidence['name']; args: string[]; input?: string; timeoutMs?: number }> = [
    {
      name: 'afscp-storage-csi-apply',
      args: [
        ...baseArgs,
        'apply',
        '--validate=false',
        '-f',
        AFSCP_STORAGE_CSI_MANIFEST_PATH,
      ],
      timeoutMs: 120_000,
    },
    {
      name: 'afscp-storage-csi-controller-scale',
      args: [
        ...baseArgs,
        '-n',
        AFSCP_STORAGE_CSI_NAMESPACE,
        'scale',
        `statefulset/${AFSCP_STORAGE_CSI_CONTROLLER}`,
        '--replicas=1',
      ],
    },
    {
      name: 'afscp-storage-csi-controller-rollout',
      args: [
        ...baseArgs,
        '-n',
        AFSCP_STORAGE_CSI_NAMESPACE,
        'rollout',
        'status',
        `statefulset/${AFSCP_STORAGE_CSI_CONTROLLER}`,
        `--timeout=${AFSCP_STORAGE_CSI_ROLLOUT_TIMEOUT}`,
      ],
      timeoutMs: 650_000,
    },
    {
      name: 'afscp-storage-csi-node-rollout',
      args: [
        ...baseArgs,
        '-n',
        AFSCP_STORAGE_CSI_NAMESPACE,
        'rollout',
        'status',
        `daemonset/${AFSCP_STORAGE_CSI_NODE}`,
        `--timeout=${AFSCP_STORAGE_CSI_ROLLOUT_TIMEOUT}`,
      ],
      timeoutMs: 650_000,
    },
  ];

  for (const step of steps) {
    const result = await runKubectlCheck({
      name: step.name,
      args: step.args,
      runner: options.runner,
      env: options.env,
      kubeconfigPath: options.kubeconfigPath,
      secretValues: options.secretValues,
      timeoutMs: step.timeoutMs,
    });
    operations.push(result.evidence);
    if (result.failure) {
      failures.push({
        path: `afscp-storage-csi:${step.name}`,
        message: `JuiceFS CSI must be ready before AFSCP workloads can mount ${AFSCP_DEFAULT_VOLUME_PVC}: ${result.failure.message}`,
      });
      break;
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

async function resetOwnedAfscpStaticVolumeDrift(options: {
  appYaml: string;
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ operations: OperationEvidence[]; failures: CheckFailure[] }> {
  const operations: OperationEvidence[] = [];
  const failures: CheckFailure[] = [];
  let desired: DesiredAfscpStaticVolume | undefined;

  try {
    desired = desiredAfscpStaticVolume(options.appYaml, options.namespace);
  } catch (error: unknown) {
    return {
      operations,
      failures: [{
        path: 'afscp-static-volume:rendered-yaml',
        message: errorMessage(error),
      }],
    };
  }

  if (!desired) {
    return { operations, failures };
  }

  const baseArgs = kubeBaseArgs(options.kubeconfigPath);
  const pvcCheck = await runKubectlCheck({
    name: 'afscp-static-volume-reset-check-pvc',
    args: [
      ...baseArgs,
      '-n',
      options.namespace,
      'get',
      'pvc',
      desired.pvcName,
      '-o',
      'json',
      '--ignore-not-found',
    ],
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
  });
  operations.push(pvcCheck.evidence);
  if (pvcCheck.failure) {
    failures.push({
      path: 'afscp-static-volume:pvc-check',
      message: `could not inspect live AFSCP PersistentVolumeClaim before app apply: ${pvcCheck.failure.message}`,
    });
    return { operations, failures };
  }

  const pvCheck = await runKubectlCheck({
    name: 'afscp-static-volume-reset-check-pv',
    args: [
      ...baseArgs,
      'get',
      'pv',
      desired.pvName,
      '-o',
      'json',
      '--ignore-not-found',
    ],
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
  });
  operations.push(pvCheck.evidence);
  if (pvCheck.failure) {
    failures.push({
      path: 'afscp-static-volume:pv-check',
      message: `could not inspect live AFSCP PersistentVolume before app apply: ${pvCheck.failure.message}`,
    });
    return { operations, failures };
  }

  let livePvc: Record<string, unknown> | undefined;
  let livePv: Record<string, unknown> | undefined;
  try {
    livePvc = parseOptionalKubectlResource(pvcCheck.raw.stdout);
    livePv = parseOptionalKubectlResource(pvCheck.raw.stdout);
  } catch (error: unknown) {
    failures.push({
      path: 'afscp-static-volume:check',
      message: `live AFSCP PV/PVC JSON must parse before app apply: ${errorMessage(error)}`,
    });
    return { operations, failures };
  }

  const liveResources = [livePvc, livePv].filter((resource): resource is Record<string, unknown> => Boolean(resource));
  for (const resource of liveResources) {
    if (!isOwnedAfscpStaticVolumeResource(resource, desired)) {
      failures.push({
        path: `afscp-static-volume:${resourceKind(resource)}/${resourceName(resource)}`,
        message: `${resourceKind(resource)}/${resourceName(resource)} exists but is not owned by agentsmith-unified-deploy; refusing to delete before app apply`,
      });
    }
  }
  if (failures.length > 0) {
    return { operations, failures };
  }

  const boundPvFailure = afscpStaticVolumeBoundPvFailure(livePvc, desired);
  if (boundPvFailure) {
    failures.push(boundPvFailure);
    return { operations, failures };
  }

  const claimRefFailure = afscpStaticVolumeClaimRefFailure(livePv, desired);
  if (claimRefFailure) {
    failures.push(claimRefFailure);
    return { operations, failures };
  }

  const pvcDiff = afscpStaticVolumeResetDiff(livePvc, desired);
  const pvDiff = afscpStaticVolumeResetDiff(livePv, desired);
  if (pvcDiff.length === 0 && pvDiff.length === 0) {
    return { operations, failures };
  }

  const reclaimPolicyFailure = afscpStaticVolumeReclaimPolicyFailure(livePv, desired);
  if (reclaimPolicyFailure) {
    failures.push(reclaimPolicyFailure);
    return { operations, failures };
  }

  operations.push(afscpStaticVolumeResetDiffEvidence({
    pvcDiff,
    pvDiff,
    secretValues: options.secretValues,
  }));

  const workloadDelete = await runKubectlCheck({
    name: 'afscp-static-volume-reset-delete-workloads',
    args: [
      ...baseArgs,
      '-n',
      options.namespace,
      'delete',
      'deployment',
      ...AFSCP_WORKLOAD_DEPLOYMENTS,
      '--ignore-not-found=true',
      '--cascade=foreground',
      '--wait=true',
      '--timeout=90s',
    ],
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
  });
  operations.push(workloadDelete.evidence);
  if (workloadDelete.failure) {
    failures.push({
      path: 'afscp-static-volume:delete-workloads',
      message: `failed to delete AFSCP workloads before static PV/PVC reset: ${workloadDelete.failure.message}`,
    });
    return { operations, failures };
  }

  if (livePvc) {
    const pvcDelete = await runKubectlCheck({
      name: 'afscp-static-volume-reset-delete-pvc',
      args: [
        ...baseArgs,
        '-n',
        options.namespace,
        'delete',
        'pvc',
        desired.pvcName,
        '--ignore-not-found=true',
        '--wait=true',
        '--timeout=90s',
      ],
      runner: options.runner,
      env: options.env,
      kubeconfigPath: options.kubeconfigPath,
      secretValues: options.secretValues,
    });
    operations.push(pvcDelete.evidence);
    if (pvcDelete.failure) {
      failures.push({
        path: 'afscp-static-volume:delete-pvc',
        message: `failed to delete owned stale AFSCP PersistentVolumeClaim before app apply: ${pvcDelete.failure.message}`,
      });
      return { operations, failures };
    }
  }

  if (livePv) {
    const pvDelete = await runKubectlCheck({
      name: 'afscp-static-volume-reset-delete-pv',
      args: [
        ...baseArgs,
        'delete',
        'pv',
        desired.pvName,
        '--ignore-not-found=true',
        '--wait=true',
        '--timeout=90s',
      ],
      runner: options.runner,
      env: options.env,
      kubeconfigPath: options.kubeconfigPath,
      secretValues: options.secretValues,
    });
    operations.push(pvDelete.evidence);
    if (pvDelete.failure) {
      failures.push({
        path: 'afscp-static-volume:delete-pv',
        message: `failed to delete owned stale AFSCP PersistentVolume before app apply: ${pvDelete.failure.message}`,
      });
    }
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
    asbcp_image_adoption: EMPTY_ASBCP_IMAGE_ADOPTION,
    stale_resource_absence_check: EMPTY_STALE_RESOURCE_ABSENCE,
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

type AfscpBootstrapJobDefinition = {
  jobName: typeof PRODUCT_SCHEMA_BOOTSTRAP_JOB | typeof AFSCP_SCHEMA_BOOTSTRAP_JOB | typeof AFSCP_VOLUME_BOOTSTRAP_JOB;
  label: string;
  failurePath: 'product-schema-bootstrap' | 'afscp-schema-bootstrap' | 'afscp-volume-bootstrap';
  operationNames: {
    deletePrevious: OperationEvidence['name'];
    wait: OperationEvidence['name'];
    diagnosticsJobYaml: OperationEvidence['name'];
    diagnosticsJobDescribe: OperationEvidence['name'];
    diagnosticsPodsJson: OperationEvidence['name'];
    diagnosticsPodDescribe: OperationEvidence['name'];
    diagnosticsPodLogs: OperationEvidence['name'];
    diagnosticsPodPreviousLogs: OperationEvidence['name'];
    diagnosticsPodEvents: OperationEvidence['name'];
    diagnosticsEvents: OperationEvidence['name'];
  };
};

const PRODUCT_SCHEMA_BOOTSTRAP_DEFINITION: AfscpBootstrapJobDefinition = {
  jobName: PRODUCT_SCHEMA_BOOTSTRAP_JOB,
  label: 'product schema bootstrap',
  failurePath: 'product-schema-bootstrap',
  operationNames: {
    deletePrevious: 'product-schema-bootstrap-delete-previous',
    wait: 'product-schema-bootstrap-wait',
    diagnosticsJobYaml: 'product-schema-bootstrap-diagnostics-job-yaml',
    diagnosticsJobDescribe: 'product-schema-bootstrap-diagnostics-job-describe',
    diagnosticsPodsJson: 'product-schema-bootstrap-diagnostics-pods-json',
    diagnosticsPodDescribe: 'product-schema-bootstrap-diagnostics-pod-describe',
    diagnosticsPodLogs: 'product-schema-bootstrap-diagnostics-pod-logs',
    diagnosticsPodPreviousLogs: 'product-schema-bootstrap-diagnostics-pod-previous-logs',
    diagnosticsPodEvents: 'product-schema-bootstrap-diagnostics-pod-events',
    diagnosticsEvents: 'product-schema-bootstrap-diagnostics-events',
  },
};

const AFSCP_SCHEMA_BOOTSTRAP_DEFINITION: AfscpBootstrapJobDefinition = {
  jobName: AFSCP_SCHEMA_BOOTSTRAP_JOB,
  label: 'AFSCP schema bootstrap',
  failurePath: 'afscp-schema-bootstrap',
  operationNames: {
    deletePrevious: 'afscp-schema-bootstrap-delete-previous',
    wait: 'afscp-schema-bootstrap-wait',
    diagnosticsJobYaml: 'afscp-schema-bootstrap-diagnostics-job-yaml',
    diagnosticsJobDescribe: 'afscp-schema-bootstrap-diagnostics-job-describe',
    diagnosticsPodsJson: 'afscp-schema-bootstrap-diagnostics-pods-json',
    diagnosticsPodDescribe: 'afscp-schema-bootstrap-diagnostics-pod-describe',
    diagnosticsPodLogs: 'afscp-schema-bootstrap-diagnostics-pod-logs',
    diagnosticsPodPreviousLogs: 'afscp-schema-bootstrap-diagnostics-pod-previous-logs',
    diagnosticsPodEvents: 'afscp-schema-bootstrap-diagnostics-pod-events',
    diagnosticsEvents: 'afscp-schema-bootstrap-diagnostics-events',
  },
};

const AFSCP_VOLUME_BOOTSTRAP_DEFINITION: AfscpBootstrapJobDefinition = {
  jobName: AFSCP_VOLUME_BOOTSTRAP_JOB,
  label: 'AFSCP default volume bootstrap',
  failurePath: 'afscp-volume-bootstrap',
  operationNames: {
    deletePrevious: 'afscp-volume-bootstrap-delete-previous',
    wait: 'afscp-volume-bootstrap-wait',
    diagnosticsJobYaml: 'afscp-volume-bootstrap-diagnostics-job-yaml',
    diagnosticsJobDescribe: 'afscp-volume-bootstrap-diagnostics-job-describe',
    diagnosticsPodsJson: 'afscp-volume-bootstrap-diagnostics-pods-json',
    diagnosticsPodDescribe: 'afscp-volume-bootstrap-diagnostics-pod-describe',
    diagnosticsPodLogs: 'afscp-volume-bootstrap-diagnostics-pod-logs',
    diagnosticsPodPreviousLogs: 'afscp-volume-bootstrap-diagnostics-pod-previous-logs',
    diagnosticsPodEvents: 'afscp-volume-bootstrap-diagnostics-pod-events',
    diagnosticsEvents: 'afscp-volume-bootstrap-diagnostics-events',
  },
};

async function deletePreviousAfscpBootstrapJob(options: {
  definition: AfscpBootstrapJobDefinition;
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ operations: OperationEvidence[]; failures: CheckFailure[] }> {
  const result = await runKubectlCheck({
    name: options.definition.operationNames.deletePrevious,
    args: [
      ...kubeBaseArgs(options.kubeconfigPath),
      '-n',
      options.namespace,
      'delete',
      'job',
      options.definition.jobName,
      '--ignore-not-found=true',
      '--wait=true',
      '--timeout=90s',
    ],
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
    timeoutMs: 120_000,
  });

  return {
    operations: [result.evidence],
    failures: result.failure
      ? [{
        path: `${options.definition.failurePath}:delete-previous`,
        message: `failed to delete the previous owned ${options.definition.label} Job before app apply: ${result.failure.message}`,
      }]
      : [],
  };
}

function podNamesFromPodList(source: string): string[] {
  try {
    return listItems(parseJsonObject(source))
      .map(resourceName)
      .filter((name) => name.length > 0)
      .sort();
  } catch {
    return [];
  }
}

async function collectAfscpBootstrapDiagnostics(options: {
  definition: AfscpBootstrapJobDefinition;
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<OperationEvidence[]> {
  const baseArgs = kubeBaseArgs(options.kubeconfigPath);
  const operations: OperationEvidence[] = [];
  const runDiagnostic = async (
    name: OperationEvidence['name'],
    args: string[],
  ): Promise<Awaited<ReturnType<typeof runKubectlCheck>>> => {
    const result = await runKubectlCheck({
      name,
      args,
      runner: options.runner,
      env: options.env,
      kubeconfigPath: options.kubeconfigPath,
      secretValues: options.secretValues,
      timeoutMs: AFSCP_SCHEMA_BOOTSTRAP_DIAGNOSTIC_TIMEOUT_MS,
      diagnosticMaxLength: AFSCP_SCHEMA_BOOTSTRAP_DIAGNOSTIC_OUTPUT_LIMIT,
    });
    operations.push(result.evidence);
    return result;
  };

  const podList = await runDiagnostic(options.definition.operationNames.diagnosticsPodsJson, [
    ...baseArgs,
    '-n',
    options.namespace,
    'get',
    'pods',
    '-l',
    `job-name=${options.definition.jobName}`,
    '-o',
    'json',
  ]);
  let podNames = podNamesFromPodList(podList.raw.stdout);

  if (podNames.length === 0) {
    const prefixedPodList = await runDiagnostic(options.definition.operationNames.diagnosticsPodsJson, [
      ...baseArgs,
      '-n',
      options.namespace,
      'get',
      'pods',
      '-l',
      `batch.kubernetes.io/job-name=${options.definition.jobName}`,
      '-o',
      'json',
    ]);
    podNames = podNamesFromPodList(prefixedPodList.raw.stdout);
  }

  for (const podName of podNames) {
    await runDiagnostic(options.definition.operationNames.diagnosticsPodLogs, [
      ...baseArgs,
      '-n',
      options.namespace,
      'logs',
      `pod/${podName}`,
      '--all-containers=true',
      '--prefix=true',
      '--timestamps=true',
      '--tail=200',
    ]);
    await runDiagnostic(options.definition.operationNames.diagnosticsPodPreviousLogs, [
      ...baseArgs,
      '-n',
      options.namespace,
      'logs',
      `pod/${podName}`,
      '--all-containers=true',
      '--prefix=true',
      '--timestamps=true',
      '--previous',
      '--tail=200',
    ]);
    await runDiagnostic(options.definition.operationNames.diagnosticsPodDescribe, [
      ...baseArgs,
      '-n',
      options.namespace,
      'describe',
      `pod/${podName}`,
    ]);
    await runDiagnostic(options.definition.operationNames.diagnosticsPodEvents, [
      ...baseArgs,
      '-n',
      options.namespace,
      'get',
      'events',
      `--field-selector=involvedObject.kind=Pod,involvedObject.name=${podName}`,
      '--sort-by=.lastTimestamp',
    ]);
  }

  await runDiagnostic(options.definition.operationNames.diagnosticsJobYaml, [
    ...baseArgs,
    '-n',
    options.namespace,
    'get',
    `job/${options.definition.jobName}`,
    '-o',
    'yaml',
  ]);
  await runDiagnostic(options.definition.operationNames.diagnosticsJobDescribe, [
    ...baseArgs,
    '-n',
    options.namespace,
    'describe',
    `job/${options.definition.jobName}`,
  ]);
  await runDiagnostic(options.definition.operationNames.diagnosticsEvents, [
    ...baseArgs,
    '-n',
    options.namespace,
    'get',
    'events',
    `--field-selector=involvedObject.kind=Job,involvedObject.name=${options.definition.jobName}`,
    '--sort-by=.lastTimestamp',
  ]);
  await runDiagnostic(options.definition.operationNames.diagnosticsEvents, [
    ...baseArgs,
    '-n',
    options.namespace,
    'get',
    'events',
    '--sort-by=.lastTimestamp',
  ]);

  return operations;
}

async function waitForAfscpBootstrapJob(options: {
  definition: AfscpBootstrapJobDefinition;
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ operations: OperationEvidence[]; failures: CheckFailure[] }> {
  const args = [
    ...kubeBaseArgs(options.kubeconfigPath),
    '-n',
    options.namespace,
    'get',
    `job/${options.definition.jobName}`,
    '-o',
    'json',
  ];
  const deadline = Date.now() + AFSCP_SCHEMA_BOOTSTRAP_WAIT_TIMEOUT_MS;
  const operations: OperationEvidence[] = [];
  let lastDiagnostic = `${options.definition.label} Job did not reach Complete before ${AFSCP_SCHEMA_BOOTSTRAP_WAIT_TIMEOUT}`;

  while (Date.now() <= deadline) {
    const result = await options.runner('kubectl', args, {
      cwd: REPO_ROOT,
      env: {
        ...options.env,
        KUBECONFIG: options.kubeconfigPath,
      },
      timeoutMs: KUBECTL_TIMEOUT_MS,
    });
    const evidence: OperationEvidence = {
      name: options.definition.operationNames.wait,
      command: commandText(args),
      status: result.exitCode === 0 ? 'passed' : 'failed',
      exit_code: result.exitCode,
      stdout: redactDiagnostic(result.stdout, options.secretValues),
      stderr: redactDiagnostic(result.stderr, options.secretValues),
    };
    operations.splice(0, operations.length, evidence);

    if (result.exitCode !== 0) {
      lastDiagnostic = redactDiagnostic(result.stderr || result.stdout || `kubectl exited ${result.exitCode}`, options.secretValues);
      break;
    }

    try {
      const status = summarizeKubernetesJobStatus(parseJsonObject(result.stdout));
      if (status.state === 'complete') {
        return { operations, failures: [] };
      }
      if (status.state === 'failed') {
        const reason = status.reason ? `${status.reason}: ` : '';
        lastDiagnostic = `${reason}${status.message ?? `${options.definition.label} Job reported Failed`}`;
        break;
      }
      lastDiagnostic = `${options.definition.label} Job is still pending (active=${status.active ?? 0}, succeeded=${status.succeeded ?? 0}, failed=${status.failed ?? 0})`;
    } catch (error: unknown) {
      lastDiagnostic = `kubectl Job JSON output must parse: ${errorMessage(error)}`;
      break;
    }

    await sleep(Math.min(AFSCP_BOOTSTRAP_JOB_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }

  operations.push(...await collectAfscpBootstrapDiagnostics(options));

  return {
    operations,
    failures: [{
      path: `${options.definition.failurePath}:wait`,
      message: `${options.definition.label} Job must complete before app rollouts: ${lastDiagnostic}; diagnostics captured in local-kind rollout evidence operations`,
    }],
  };
}

function afscpFunctionalConvergenceProbeScript(): string {
  return [
    "const crypto = require('node:crypto');",
    "const READY_STATES = new Set(['succeeded', 'success', 'completed', 'ready']);",
    "const FAILED_STATES = new Set(['failed', 'failure', 'error', 'errored', 'cancelled', 'canceled']);",
    "const marker = 'afscp-functional-convergence';",
    "const namespaceId = 'ns_rollout_probe';",
    "const productRoles = ['repo_admin', 'repo_lifecycle_admin', 'restore_admin', 'template_admin', 'export_admin', 'mount_admin', 'operation_inspector'];",
    "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
    "function env(name) {",
    "  const value = process.env[name];",
    "  if (typeof value !== 'string' || value.trim().length === 0) {",
    "    throw new Error(`missing required env ${name}`);",
    "  }",
    "  return value.trim();",
    "}",
    "function sortJson(value) {",
    "  if (Array.isArray(value)) {",
    "    return value.map(sortJson);",
    "  }",
    "  if (value !== null && typeof value === 'object') {",
    "    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, sortJson(nested)]));",
    "  }",
    "  return value;",
    "}",
    "function signature(value) {",
    "  return crypto.createHash('sha256').update(JSON.stringify(sortJson(value))).digest('hex');",
    "}",
    "const config = {",
    "  baseUrl: env('AFSCP_BASE_URL').replace(/\\/+$/u, ''),",
    "  defaultVolumeId: env('AFSCP_DEFAULT_VOLUME_ID'),",
    "  productCaller: env('AFSCP_CALLER_SERVICE'),",
    "  bootstrapCaller: env('AFSCP_BOOTSTRAP_CALLER_SERVICE'),",
    "  orchestratorCaller: env('AFSCP_ORCHESTRATOR_CALLER_SERVICE'),",
    "  productToken: env('AFSCP_SERVICE_TOKEN'),",
    "  bootstrapToken: env('AFSCP_BOOTSTRAP_SERVICE_TOKEN'),",
    "};",
    "function buildVolumeBinding() {",
    "  return {",
    "    namespace_id: namespaceId,",
    "    default_volume_id: config.defaultVolumeId,",
    "    allowed_callers: [",
    "      { caller_service: config.productCaller, roles: productRoles },",
    "      { caller_service: config.orchestratorCaller, roles: ['orchestrator_mount'] },",
    "    ],",
    "    quota_bytes_default: 0,",
    "    export_policy: { webdav_enabled: true, max_session_seconds: 900 },",
    "    lifecycle_policy: { tombstone_retention_seconds: 604800, purge_requires_lifecycle_admin: true, break_glass_purge_enabled: false },",
    "    mount_policy: { workload_mount_enabled: true, workload_mount_requires_external_control_root: true, allow_privileged_workload: false },",
    "    template_policy: { namespace_templates_enabled: true, cross_namespace_clone_enabled: false },",
    "    status: 'active',",
    "  };",
    "}",
    "function headers(options) {",
    "  const result = {",
    "    Accept: 'application/json',",
    "    Authorization: `Bearer ${options.token}`,",
    "    'X-AFSCP-Caller-Service': options.callerService,",
    "    'X-Correlation-Id': marker,",
    "  };",
    "  if (options.namespaceId) {",
    "    result['X-AFSCP-Namespace-Id'] = options.namespaceId;",
    "  }",
    "  if (options.mutation) {",
    "    result['Idempotency-Key'] = options.mutation.idempotencyKey;",
    "    result['X-AFSCP-Actor-Type'] = 'operator';",
    "    result['X-AFSCP-Actor-Id'] = 'local-kind-rollout';",
    "  }",
    "  if (options.hasBody) {",
    "    result['Content-Type'] = 'application/json';",
    "  }",
    "  return result;",
    "}",
    "async function requestJson(stage, method, requestPath, options) {",
    "  const response = await fetch(`${config.baseUrl}${requestPath}`, {",
    "    method,",
    "    headers: headers({ ...options, hasBody: options.body !== undefined }),",
    "    body: options.body === undefined ? undefined : JSON.stringify(options.body),",
    "  });",
    "  const text = await response.text();",
    "  let payload = undefined;",
    "  if (text.trim().length > 0) {",
    "    try {",
    "      payload = JSON.parse(text);",
    "    } catch {",
    "      payload = text.slice(0, 1000);",
    "    }",
    "  }",
    "  if (!response.ok) {",
    "    throw new Error(`${stage} http ${response.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);",
    "  }",
    "  return payload ?? {};",
    "}",
    "function operationState(operation) {",
    "  return typeof operation.operation_state === 'string' ? operation.operation_state : '';",
    "}",
    "function operationId(stage, operation) {",
    "  if (typeof operation.operation_id === 'string' && operation.operation_id.length > 0) {",
    "    return operation.operation_id;",
    "  }",
    "  throw new Error(`${stage} response did not include operation_id`);",
    "}",
    "async function pollOperation(stage, id) {",
    "  const deadline = Date.now() + 60_000;",
    "  let lastState = '';",
    "  while (Date.now() <= deadline) {",
    "    const operation = await requestJson(stage, 'GET', `/internal/v1/operations/${encodeURIComponent(id)}`, {",
    "      callerService: config.bootstrapCaller,",
    "      token: config.bootstrapToken,",
    "    });",
    "    lastState = operationState(operation);",
    "    const normalized = lastState.trim().toLowerCase();",
    "    if (READY_STATES.has(normalized)) {",
    "      return operation;",
    "    }",
    "    if (FAILED_STATES.has(normalized)) {",
    "      throw new Error(`${stage} operation ${id} failed with state=${lastState}`);",
    "    }",
    "    await sleep(1_000);",
    "  }",
    "  throw new Error(`timed out waiting for AFSCP ${stage.replace(/_/gu, ' ')} operation ${id}; last_state=${lastState || 'unknown'}`);",
    "}",
    "async function main() {",
    "  const namespaceOperation = await requestJson('namespace_upsert', 'PUT', `/internal/v1/namespaces/${encodeURIComponent(namespaceId)}`, {",
    "    callerService: config.bootstrapCaller,",
    "    token: config.bootstrapToken,",
    "    namespaceId,",
    "    mutation: { idempotencyKey: `${marker}:${namespaceId}:namespace-upsert` },",
    "    body: { namespace_id: namespaceId },",
    "  });",
    "  const namespaceOperationId = operationId('namespace_upsert', namespaceOperation);",
    "  const namespaceFinal = await pollOperation('namespace_upsert', namespaceOperationId);",
    "  const binding = buildVolumeBinding();",
    "  const bindingSignature = signature(binding).slice(0, 16);",
    "  const volumeOperation = await requestJson('volume_binding', 'PUT', `/internal/v1/namespaces/${encodeURIComponent(namespaceId)}/volume-binding`, {",
    "    callerService: config.bootstrapCaller,",
    "    token: config.bootstrapToken,",
    "    namespaceId,",
    "    mutation: { idempotencyKey: `${marker}:${namespaceId}:volume-binding:${bindingSignature}` },",
    "    body: binding,",
    "  });",
    "  const volumeOperationId = operationId('volume_binding', volumeOperation);",
    "  const volumeFinal = await pollOperation('volume_binding', volumeOperationId);",
    "  const reposQuery = new URLSearchParams({ namespace_id: namespaceId }).toString();",
    "  await requestJson('product_binding_check', 'GET', `/internal/v1/repos?${reposQuery}`, {",
    "    callerService: config.productCaller,",
    "    token: config.productToken,",
    "    namespaceId,",
    "  });",
    "  console.log(JSON.stringify({",
    "    status: 'passed',",
    "    marker,",
    "    namespace_id: namespaceId,",
    "    default_volume_id: config.defaultVolumeId,",
    "    namespace_operation_id: namespaceOperationId,",
    "    namespace_operation_state: operationState(namespaceFinal),",
    "    volume_binding_operation_id: volumeOperationId,",
    "    volume_binding_operation_state: operationState(volumeFinal),",
    "  }));",
    "}",
    "main().catch((error) => {",
    "  const message = error instanceof Error ? error.message : String(error);",
    "  console.error(JSON.stringify({ status: 'failed', marker, message }));",
    "  if (error instanceof Error && error.stack) {",
    "    console.error(error.stack);",
    "  }",
    "  process.exit(1);",
    "});",
  ].join('\n');
}

async function collectAfscpFunctionalDiagnostics(options: {
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<OperationEvidence[]> {
  const baseArgs = kubeBaseArgs(options.kubeconfigPath);
  const operations: OperationEvidence[] = [];
  const runDiagnostic = async (
    name: OperationEvidence['name'],
    args: string[],
  ): Promise<Awaited<ReturnType<typeof runKubectlCheck>>> => {
    const result = await runKubectlCheck({
      name,
      args,
      runner: options.runner,
      env: options.env,
      kubeconfigPath: options.kubeconfigPath,
      secretValues: options.secretValues,
      timeoutMs: AFSCP_FUNCTIONAL_DIAGNOSTIC_TIMEOUT_MS,
      diagnosticMaxLength: AFSCP_FUNCTIONAL_DIAGNOSTIC_OUTPUT_LIMIT,
    });
    operations.push(result.evidence);
    return result;
  };

  for (const component of AFSCP_WORKLOAD_DEPLOYMENTS) {
    const podList = await runDiagnostic('afscp-functional-diagnostics-pods-json', [
      ...baseArgs,
      '-n',
      options.namespace,
      'get',
      'pods',
      '-l',
      `app.kubernetes.io/component=${component}`,
      '-o',
      'json',
    ]);
    const podNames = podNamesFromPodList(podList.raw.stdout);

    await runDiagnostic('afscp-functional-diagnostics-deployment-describe', [
      ...baseArgs,
      '-n',
      options.namespace,
      'describe',
      `deployment/${component}`,
    ]);

    for (const podName of podNames) {
      await runDiagnostic('afscp-functional-diagnostics-pod-logs', [
        ...baseArgs,
        '-n',
        options.namespace,
        'logs',
        `pod/${podName}`,
        '--all-containers=true',
        '--prefix=true',
        '--timestamps=true',
        '--tail=200',
      ]);
      await runDiagnostic('afscp-functional-diagnostics-pod-previous-logs', [
        ...baseArgs,
        '-n',
        options.namespace,
        'logs',
        `pod/${podName}`,
        '--all-containers=true',
        '--prefix=true',
        '--timestamps=true',
        '--previous',
        '--tail=200',
      ]);
      await runDiagnostic('afscp-functional-diagnostics-pod-describe', [
        ...baseArgs,
        '-n',
        options.namespace,
        'describe',
        `pod/${podName}`,
      ]);
      await runDiagnostic('afscp-functional-diagnostics-pod-events', [
        ...baseArgs,
        '-n',
        options.namespace,
        'get',
        'events',
        `--field-selector=involvedObject.kind=Pod,involvedObject.name=${podName}`,
        '--sort-by=.lastTimestamp',
      ]);
    }
  }

  await runDiagnostic('afscp-functional-diagnostics-events', [
    ...baseArgs,
    '-n',
    options.namespace,
    'get',
    'events',
    '--sort-by=.lastTimestamp',
  ]);

  return operations;
}

async function checkAfscpFunctionalConvergence(options: {
  namespace: string;
  kubeconfigPath: string;
  runner: LocalKindCommandRunner;
  env: Record<string, string | undefined>;
  secretValues: readonly string[];
}): Promise<{ operations: OperationEvidence[]; failures: CheckFailure[] }> {
  const check = await runKubectlOperation({
    name: 'afscp-functional-convergence-check',
    args: [
      ...kubeBaseArgs(options.kubeconfigPath),
      '-n',
      options.namespace,
      'exec',
      'deployment/agentsmith-api',
      '-c',
      'api',
      '-i',
      '--',
      'node',
      '-',
    ],
    input: afscpFunctionalConvergenceProbeScript(),
    runner: options.runner,
    env: options.env,
    kubeconfigPath: options.kubeconfigPath,
    secretValues: options.secretValues,
    timeoutMs: AFSCP_FUNCTIONAL_CONVERGENCE_TIMEOUT_MS,
  });
  const operations = [check.evidence];
  if (!check.failure) {
    return { operations, failures: [] };
  }

  operations.push(...await collectAfscpFunctionalDiagnostics(options));

  return {
    operations,
    failures: [{
      path: 'afscp-functional-convergence:check',
      message: `AFSCP functional convergence must complete namespace and volume binding operations after AFSCP workloads are ready: ${check.failure.message}; diagnostics captured in local-kind rollout evidence operations`,
    }],
  };
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
  let appBatches: {
    productBootstrapYaml: string;
    schemaBootstrapYaml: string;
    volumeBootstrapYaml: string;
    remainingYaml: string;
  };

  try {
    adminPreflightBatches = splitAdminPreflightYaml(options.preflightYaml);
    appBatches = splitAppBootstrapYaml(options.appYaml);
  } catch (error: unknown) {
    failures.push({
      path: 'apply-sequence:rendered-yaml',
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

  const afscpStorageCsi = await ensureAfscpStorageCsiReady({
    kubeconfigPath: options.kubeconfigPath,
    runner: options.runner,
    env: options.env,
    secretValues: options.secretValues,
  });
  operations.push(...afscpStorageCsi.operations);
  failures.push(...afscpStorageCsi.failures);
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

  const afscpStaticVolumeReset = await resetOwnedAfscpStaticVolumeDrift({
    appYaml: options.appYaml,
    namespace: options.namespace,
    kubeconfigPath: options.kubeconfigPath,
    runner: options.runner,
    env: options.env,
    secretValues: options.secretValues,
  });
  operations.push(...afscpStaticVolumeReset.operations);
  failures.push(...afscpStaticVolumeReset.failures);
  if (failures.length > 0) {
    return { operations, failures };
  }

  for (const step of [
    {
      name: 'product-schema-bootstrap-dry-run',
      args: [...baseArgs, 'apply', '--dry-run=server', '-f', '-'],
      input: appBatches.productBootstrapYaml,
    },
    {
      name: 'product-schema-bootstrap-apply',
      args: [...baseArgs, 'apply', '-f', '-'],
      input: appBatches.productBootstrapYaml,
    },
  ] as const) {
    if (step.input.trim().length === 0) {
      continue;
    }
    if (step.name === 'product-schema-bootstrap-dry-run') {
      const jobReset = await deletePreviousAfscpBootstrapJob({
        definition: PRODUCT_SCHEMA_BOOTSTRAP_DEFINITION,
        namespace: options.namespace,
        kubeconfigPath: options.kubeconfigPath,
        runner: options.runner,
        env: options.env,
        secretValues: options.secretValues,
      });
      operations.push(...jobReset.operations);
      failures.push(...jobReset.failures);
      if (failures.length > 0) {
        return { operations, failures };
      }
    }
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

  const productBootstrap = await waitForAfscpBootstrapJob({
    definition: PRODUCT_SCHEMA_BOOTSTRAP_DEFINITION,
    namespace: options.namespace,
    kubeconfigPath: options.kubeconfigPath,
    runner: options.runner,
    env: options.env,
    secretValues: options.secretValues,
  });
  operations.push(...productBootstrap.operations);
  failures.push(...productBootstrap.failures);
  if (failures.length > 0) {
    return { operations, failures };
  }

  for (const definition of [AFSCP_SCHEMA_BOOTSTRAP_DEFINITION, AFSCP_VOLUME_BOOTSTRAP_DEFINITION]) {
    const jobReset = await deletePreviousAfscpBootstrapJob({
      definition,
      namespace: options.namespace,
      kubeconfigPath: options.kubeconfigPath,
      runner: options.runner,
      env: options.env,
      secretValues: options.secretValues,
    });
    operations.push(...jobReset.operations);
    failures.push(...jobReset.failures);
    if (failures.length > 0) {
      return { operations, failures };
    }
  }

  for (const step of [
    {
      name: 'afscp-schema-bootstrap-dry-run',
      args: [...baseArgs, 'apply', '--dry-run=server', '-f', '-'],
      input: appBatches.schemaBootstrapYaml,
    },
    {
      name: 'afscp-schema-bootstrap-apply',
      args: [...baseArgs, 'apply', '-f', '-'],
      input: appBatches.schemaBootstrapYaml,
    },
  ] as const) {
    if (step.input.trim().length === 0) {
      continue;
    }
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

  const schemaBootstrap = await waitForAfscpBootstrapJob({
    definition: AFSCP_SCHEMA_BOOTSTRAP_DEFINITION,
    namespace: options.namespace,
    kubeconfigPath: options.kubeconfigPath,
    runner: options.runner,
    env: options.env,
    secretValues: options.secretValues,
  });
  operations.push(...schemaBootstrap.operations);
  failures.push(...schemaBootstrap.failures);
  if (failures.length > 0) {
    return { operations, failures };
  }

  for (const step of [
    {
      name: 'afscp-volume-bootstrap-dry-run',
      args: [...baseArgs, 'apply', '--dry-run=server', '-f', '-'],
      input: appBatches.volumeBootstrapYaml,
    },
    {
      name: 'afscp-volume-bootstrap-apply',
      args: [...baseArgs, 'apply', '-f', '-'],
      input: appBatches.volumeBootstrapYaml,
    },
  ] as const) {
    if (step.input.trim().length === 0) {
      continue;
    }
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

  const volumeBootstrap = await waitForAfscpBootstrapJob({
    definition: AFSCP_VOLUME_BOOTSTRAP_DEFINITION,
    namespace: options.namespace,
    kubeconfigPath: options.kubeconfigPath,
    runner: options.runner,
    env: options.env,
    secretValues: options.secretValues,
  });
  operations.push(...volumeBootstrap.operations);
  failures.push(...volumeBootstrap.failures);
  if (failures.length > 0) {
    return { operations, failures };
  }

  for (const step of [
    {
      name: 'app-dry-run',
      args: [...baseArgs, 'apply', '--dry-run=server', '-f', '-'],
      input: appBatches.remainingYaml,
    },
    {
      name: 'app-apply',
      args: [...baseArgs, 'apply', '-f', '-'],
      input: appBatches.remainingYaml,
    },
  ] as const) {
    if (step.input.trim().length === 0) {
      continue;
    }
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

  const clusterUid = await resolveLocalKindClusterUid({ runner, env });
  const imageHandoffReadinessMatched = clusterUid
    ? readinessFieldReadyWithIdentity({
      env,
      field: 'local_kind_image_import_completed',
      identity: {
        local_kind_context: safety.context,
        local_kind_cluster_uid: clusterUid,
        local_kind_site_env_digest: sha256(await readFile(siteEnvPath, 'utf8')),
      },
    })
    : false;
  const verifiedImagePreflight = await checkLocalKindImagePreflight({
    renderedYaml: imagePreflightYaml,
    runner,
    env,
    registryAvailabilityPoll: options.registryAvailabilityPoll,
  });
  const imagePreflight: LocalKindImagePreflightResult = imageHandoffReadinessMatched
    ? {
      ...verifiedImagePreflight,
      diagnostics: [
        `parent-verified local-kind image handoff matched readiness identity for ${safety.context}; rendered manifest and image refs were still verified`,
        ...verifiedImagePreflight.diagnostics,
      ],
    }
    : verifiedImagePreflight;
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
  const operationsAfterRollout = [...afterApplyEvidence.operations];
  if (rollouts.failures.length === 0) {
    const afscpFunctionalConvergence = await checkAfscpFunctionalConvergence({
      namespace: safety.namespace,
      kubeconfigPath: kubeconfig.path,
      runner,
      env,
      secretValues,
    });
    operationsAfterRollout.push(...afscpFunctionalConvergence.operations);
    if (afscpFunctionalConvergence.failures.length > 0) {
      return finish({
        ...afterApplyEvidence,
        operations: operationsAfterRollout,
        rollouts: rollouts.rollouts,
        failures: afscpFunctionalConvergence.failures,
      }, evidenceDir);
    }
  }
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
  const asbcpImageAdoption = await checkAsbcpImageAdoption({
    siteEnvValues: rendered.siteEnvValues,
    appYaml: rendered.appYaml,
    namespace: safety.namespace,
    kubeconfigPath: kubeconfig.path,
    runner,
    env,
    secretValues,
  });
  const staleResourceAbsence = await checkStaleResourceAbsence({
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
    ...asbcpImageAdoption.failures,
    ...staleResourceAbsence.failures,
    ...routeProbes.failures,
  ];

  return finish({
    ...afterApplyEvidence,
    operations: operationsAfterRollout,
    rollouts: rollouts.rollouts,
    llmup_config_health: llmupConfigHealth.evidence,
    asbcp_image_adoption: asbcpImageAdoption.evidence,
    stale_resource_absence_check: staleResourceAbsence.evidence,
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
