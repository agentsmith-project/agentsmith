import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, asRecord, prepareUnifiedDeployEvidenceDir, type CheckFailure } from './manifest';
import { parseKubernetesDocuments, resourceKind, resourceName } from './kubernetes';
import { DEFAULT_SITE_ENV_PATH } from './render';

type ProducerStatus = 'passed' | 'failed';
type StepStatus = 'passed' | 'failed' | 'skipped';

export type LocalKindImageCommandRunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

export type LocalKindImageCommandRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type LocalKindImageCommandRunner = (
  command: string,
  args: string[],
  options?: LocalKindImageCommandRunOptions,
) => Promise<LocalKindImageCommandRunResult>;

export type LlmupImageLock = {
  version: string;
  source_image: string;
  source_digest: string;
  host_image: string;
  k8s_image: string;
};

export type MirroredSourceImageRefs = {
  version: string;
  source_ref: string;
  source_digest: string;
  host_ref: string;
  host_digest_ref?: string;
  k8s_tag_ref?: string;
  k8s_ref: string;
};

export type LocalKindImageRefs = {
  app: {
    base_host_ref: string;
    host_ref: string;
    host_digest_ref?: string;
    k8s_tag_ref?: string;
    k8s_ref: string;
  };
  sandbox_manager: {
    host_ref: string;
    host_digest_ref?: string;
    k8s_tag_ref?: string;
    k8s_ref: string;
  };
  managed_runner: {
    base_host_ref: string;
    host_ref: string;
    host_digest_ref?: string;
    k8s_tag_ref?: string;
    k8s_ref: string;
  };
  afscp: {
    host_ref: string;
    host_digest_ref?: string;
    k8s_tag_ref?: string;
    k8s_ref: string;
  };
  llmup: {
    version: string;
    source_ref: string;
    source_digest: string;
    host_ref: string;
    host_digest_ref?: string;
    k8s_tag_ref?: string;
    k8s_ref: string;
  };
  ingress_nginx_controller: MirroredSourceImageRefs;
  ingress_nginx_certgen: MirroredSourceImageRefs;
};

type ImageOperationEvidence = {
  name: string;
  command: string;
  status: StepStatus;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
};

type LocalKindImagesEvidence = {
  schema_version: 'agentsmith.unified-deploy.local-kind-images.evidence/v1';
  producer: 'local-kind-images';
  status: ProducerStatus;
  generated_at: string;
  registries: {
    host_push: string;
    k8s_pull: string;
    project: string;
  };
  tag: string;
  generated_site_env_path: string;
  images: LocalKindImageRefs;
  operations: ImageOperationEvidence[];
  failures: CheckFailure[];
  paths: {
    report_path: string;
    log_path: string;
  };
};

export type LocalKindImagesProducerOptions = {
  siteEnvPath?: string;
  outputSiteEnvPath?: string;
  evidenceDir?: string;
  sandboxSourceDir?: string;
  afscpSourceDir?: string;
  llmupImageLockPath?: string;
  hostRegistry?: string;
  k8sRegistry?: string;
  registryProject?: string;
  tag?: string;
  env?: Record<string, string | undefined>;
  runner?: LocalKindImageCommandRunner;
};

export type LocalKindImagesProducerResult = {
  status: ProducerStatus;
  failures: CheckFailure[];
  evidence: LocalKindImagesEvidence;
};

export type LocalKindImagePreflightResult = {
  status: StepStatus;
  image_refs: string[];
  host_refs: string[];
  failures: CheckFailure[];
  diagnostics: string[];
};

const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, 'artifacts', 'unified-deploy');
export const DEFAULT_LOCAL_KIND_SITE_ENV_PATH = path.join(DEFAULT_EVIDENCE_DIR, 'local-kind-site.env');
const DEFAULT_LLMUP_IMAGE_LOCK_PATH = path.join(REPO_ROOT, 'infra', 'deploy', 'shared', 'llmup-image.lock');
const DEFAULT_HOST_REGISTRY = 'localhost:5001';
const DEFAULT_K8S_REGISTRY = 'kind-registry:5000';
const DEFAULT_REGISTRY_PROJECT = 'mbos';
const DEFAULT_TAG = 'local-kind-dev';
const LOCAL_KIND_CONTROL_PLANE_NODE = 'agentsmith-control-plane';
const AFSCP_SCHEMA_BOOTSTRAP_JOB = 'afscp-schema-bootstrap';
const AFSCP_VOLUME_BOOTSTRAP_JOB = 'afscp-volume-bootstrap';
const AFSCP_SCHEMA_BOOTSTRAP_COMMAND = '/usr/local/bin/afscp-migrate';
const AFSCP_VOLUME_BOOTSTRAP_COMMAND = '/usr/local/bin/afscp-volume-bootstrap';
const DOCKER_TIMEOUT_MS = 20 * 60_000;
const SHORT_DOCKER_TIMEOUT_MS = 30_000;
const SECRET_DIAGNOSTIC_PATTERN = /\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|ACCESS_KEY|API_KEY|CLIENT_SECRET)[A-Z0-9_]*)=([^\s]+)/giu;
const CLI_SECRET_ASSIGNMENT_PATTERN = /((?:--?|\/)?[A-Z0-9_-]*(?:PASSWORD|SECRET|TOKEN|ACCESS[-_]?KEY|API[-_]?KEY|CLIENT[-_]?SECRET)[A-Z0-9_-]*=)([^\s,"]+)/giu;
const COMMAND_SECRET_KEY_PATTERN = /(?:password|secret|token|access[-_]?key|api[-_]?key|client[-_]?secret)/iu;
const SECRET_LIKE_TOKEN_PATTERN = /\b[^\s,"]*(?:password|secret|token)[^\s,"]*/giu;
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addFailure(failures: CheckFailure[], failurePath: string, message: string): void {
  failures.push({ path: failurePath, message });
}

function redactDiagnostic(value: string): string {
  return value
    .replace(CLI_SECRET_ASSIGNMENT_PATTERN, '$1[REDACTED]')
    .replace(SECRET_DIAGNOSTIC_PATTERN, '$1=[REDACTED]')
    .replace(SECRET_LIKE_TOKEN_PATTERN, '[REDACTED]')
    .slice(0, 4000);
}

function dockerCommandText(args: readonly string[]): string {
  return `docker ${args.join(' ')}`;
}

function sanitizedCommandArgs(args: readonly string[]): string[] {
  const sanitized: string[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      sanitized.push('[REDACTED]');
      redactNext = false;
      continue;
    }

    const assignmentIndex = arg.indexOf('=');
    const key = assignmentIndex >= 0 ? arg.slice(0, assignmentIndex) : arg;
    if (COMMAND_SECRET_KEY_PATTERN.test(key)) {
      if (assignmentIndex >= 0) {
        sanitized.push(`${arg.slice(0, assignmentIndex + 1)}[REDACTED]`);
      } else {
        sanitized.push(arg);
        redactNext = true;
      }
      continue;
    }

    sanitized.push(redactDiagnostic(arg));
  }

  return sanitized;
}

function sanitizedDockerCommandText(args: readonly string[]): string {
  return dockerCommandText(sanitizedCommandArgs(args));
}

function commandText(command: string, args: readonly string[]): string {
  return `${command} ${args.join(' ')}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

export async function defaultLocalKindImageCommandRunner(
  command: string,
  args: string[],
  options: LocalKindImageCommandRunOptions = {},
): Promise<LocalKindImageCommandRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs ?? DOCKER_TIMEOUT_MS);

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
          ? `${stderr}${stderr ? '\n' : ''}docker timed out after ${options.timeoutMs ?? DOCKER_TIMEOUT_MS}ms`
          : stderr,
      });
    });
  });
}

function parseKeyValues(source: string, sourceName: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = source.split(/\r?\n/u);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      throw new Error(`${sourceName} line ${index + 1} must be key=value`);
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (values[key] !== undefined) {
      throw new Error(`${sourceName} has duplicate key ${key}`);
    }
    values[key] = value;
  });

  return values;
}

export function parseLlmupImageLock(
  source: string,
  options: {
    sourceName?: string;
    hostRegistry?: string;
    k8sRegistry?: string;
    registryProject?: string;
  } = {},
): LlmupImageLock {
  const sourceName = options.sourceName ?? 'infra/deploy/shared/llmup-image.lock';
  const values = parseKeyValues(source, sourceName);
  const version = values.llmup_version;
  const sourceImage = values.llmup_source_image;

  if (!version) {
    throw new Error(`${sourceName} must include llmup_version`);
  }
  if (!sourceImage) {
    throw new Error(`${sourceName} must include llmup_source_image`);
  }
  const digestMatch = /@sha256:([a-fA-F0-9]{64})$/u.exec(sourceImage);
  if (!digestMatch) {
    throw new Error(`${sourceName} llmup_source_image must include a sha256 digest`);
  }
  const refWithoutDigest = sourceImage.slice(0, sourceImage.length - digestMatch[0].length);
  const tag = refWithoutDigest.slice(refWithoutDigest.lastIndexOf(':') + 1);
  if (tag !== version) {
    throw new Error(`${sourceName} llmup_source_image tag must match llmup_version`);
  }

  const hostRegistry = options.hostRegistry ?? DEFAULT_HOST_REGISTRY;
  const k8sRegistry = options.k8sRegistry ?? DEFAULT_K8S_REGISTRY;
  const registryProject = options.registryProject ?? DEFAULT_REGISTRY_PROJECT;

  return {
    version,
    source_image: sourceImage,
    source_digest: `sha256:${digestMatch[1].toLowerCase()}`,
    host_image: `${hostRegistry}/${registryProject}/llm-universal-proxy:${version}`,
    k8s_image: `${k8sRegistry}/${registryProject}/llm-universal-proxy:${version}`,
  };
}

function imageRefs(options: {
  tag: string;
  hostRegistry: string;
  k8sRegistry: string;
  registryProject: string;
  llmup: LlmupImageLock;
  ingressNginxController: MirroredSourceImageRefs;
  ingressNginxCertgen: MirroredSourceImageRefs;
}): LocalKindImageRefs {
  const prefixHost = `${options.hostRegistry}/${options.registryProject}`;
  const prefixK8s = `${options.k8sRegistry}/${options.registryProject}`;

  return {
    app: {
      base_host_ref: `${prefixHost}/agentsmith-app-base:${options.tag}`,
      host_ref: `${prefixHost}/agentsmith-app:${options.tag}`,
      k8s_tag_ref: `${prefixK8s}/agentsmith-app:${options.tag}`,
      k8s_ref: `${prefixK8s}/agentsmith-app:${options.tag}`,
    },
    sandbox_manager: {
      host_ref: `${prefixHost}/sandbox-manager:${options.tag}`,
      k8s_tag_ref: `${prefixK8s}/sandbox-manager:${options.tag}`,
      k8s_ref: `${prefixK8s}/sandbox-manager:${options.tag}`,
    },
    managed_runner: {
      base_host_ref: `${prefixHost}/agentsmith-managed-runner-base:${options.tag}`,
      host_ref: `${prefixHost}/agentsmith-managed-runner:${options.tag}`,
      k8s_tag_ref: `${prefixK8s}/agentsmith-managed-runner:${options.tag}`,
      k8s_ref: `${prefixK8s}/agentsmith-managed-runner:${options.tag}`,
    },
    afscp: {
      host_ref: `${prefixHost}/agentsmith-fs-control-plane:${options.tag}`,
      k8s_tag_ref: `${prefixK8s}/agentsmith-fs-control-plane:${options.tag}`,
      k8s_ref: `${prefixK8s}/agentsmith-fs-control-plane:${options.tag}`,
    },
    llmup: {
      version: options.llmup.version,
      source_ref: options.llmup.source_image,
      source_digest: options.llmup.source_digest,
      host_ref: options.llmup.host_image,
      k8s_tag_ref: options.llmup.k8s_image,
      k8s_ref: options.llmup.k8s_image,
    },
    ingress_nginx_controller: options.ingressNginxController,
    ingress_nginx_certgen: options.ingressNginxCertgen,
  };
}

function parsePinnedSourceImage(
  sourceRef: string | undefined,
  options: {
    sourceName: string;
    key: string;
    repositoryName: string;
    hostRegistry: string;
    k8sRegistry: string;
    registryProject: string;
  },
): MirroredSourceImageRefs {
  const rawSourceRef = sourceRef?.trim();
  if (!rawSourceRef) {
    throw new Error(`${options.sourceName} must include ${options.key}`);
  }

  const digestMatch = /@sha256:([a-fA-F0-9]{64})$/u.exec(rawSourceRef);
  if (!digestMatch) {
    throw new Error(`${options.sourceName} ${options.key} must include a sha256 digest`);
  }

  const refWithoutDigest = rawSourceRef.slice(0, rawSourceRef.length - digestMatch[0].length);
  const lastSlashIndex = refWithoutDigest.lastIndexOf('/');
  const lastColonIndex = refWithoutDigest.lastIndexOf(':');
  if (lastColonIndex <= lastSlashIndex) {
    throw new Error(`${options.sourceName} ${options.key} must include an image tag`);
  }
  const version = refWithoutDigest.slice(lastColonIndex + 1);
  const imageName = `${options.registryProject}/${options.repositoryName}`;

  return {
    version,
    source_ref: rawSourceRef,
    source_digest: `sha256:${digestMatch[1].toLowerCase()}`,
    host_ref: `${options.hostRegistry}/${imageName}:${version}`,
    k8s_tag_ref: `${options.k8sRegistry}/${imageName}:${version}`,
    k8s_ref: `${options.k8sRegistry}/${imageName}:${version}`,
  };
}

function repositoryRef(imageRef: string): string {
  const withoutDigest = imageRef.split('@')[0] ?? imageRef;
  const lastSlashIndex = withoutDigest.lastIndexOf('/');
  const lastColonIndex = withoutDigest.lastIndexOf(':');

  return lastColonIndex > lastSlashIndex
    ? withoutDigest.slice(0, lastColonIndex)
    : withoutDigest;
}

function digestRef(imageRef: string, digest: string): string {
  return `${repositoryRef(imageRef)}@${digest}`;
}

function parseRegistryDigest(source: string, imageRef: string): string {
  const match = /\bDigest:\s*(sha256:[a-f0-9]{64})\b/iu.exec(source);
  if (!match?.[1]) {
    throw new Error(`registry manifest digest missing for ${imageRef}`);
  }

  return match[1].toLowerCase();
}

function withDigestHandoff(
  refs: LocalKindImageRefs,
  digests: {
    app: string;
    sandboxManager: string;
    managedRunner: string;
    afscp: string;
    llmup: string;
    ingressNginxController: string;
    ingressNginxCertgen: string;
  },
): LocalKindImageRefs {
  return {
    app: {
      ...refs.app,
      host_digest_ref: digestRef(refs.app.host_ref, digests.app),
      k8s_tag_ref: refs.app.k8s_tag_ref ?? refs.app.k8s_ref,
      k8s_ref: digestRef(refs.app.k8s_ref, digests.app),
    },
    sandbox_manager: {
      ...refs.sandbox_manager,
      host_digest_ref: digestRef(refs.sandbox_manager.host_ref, digests.sandboxManager),
      k8s_tag_ref: refs.sandbox_manager.k8s_tag_ref ?? refs.sandbox_manager.k8s_ref,
      k8s_ref: digestRef(refs.sandbox_manager.k8s_ref, digests.sandboxManager),
    },
    managed_runner: {
      ...refs.managed_runner,
      host_digest_ref: digestRef(refs.managed_runner.host_ref, digests.managedRunner),
      k8s_tag_ref: refs.managed_runner.k8s_tag_ref ?? refs.managed_runner.k8s_ref,
      k8s_ref: digestRef(refs.managed_runner.k8s_ref, digests.managedRunner),
    },
    afscp: {
      ...refs.afscp,
      host_digest_ref: digestRef(refs.afscp.host_ref, digests.afscp),
      k8s_tag_ref: refs.afscp.k8s_tag_ref ?? refs.afscp.k8s_ref,
      k8s_ref: digestRef(refs.afscp.k8s_ref, digests.afscp),
    },
    llmup: {
      ...refs.llmup,
      host_digest_ref: digestRef(refs.llmup.host_ref, digests.llmup),
      k8s_tag_ref: refs.llmup.k8s_tag_ref ?? refs.llmup.k8s_ref,
      k8s_ref: digestRef(refs.llmup.k8s_ref, digests.llmup),
    },
    ingress_nginx_controller: {
      ...refs.ingress_nginx_controller,
      host_digest_ref: digestRef(refs.ingress_nginx_controller.host_ref, digests.ingressNginxController),
      k8s_tag_ref: refs.ingress_nginx_controller.k8s_tag_ref ?? refs.ingress_nginx_controller.k8s_ref,
      k8s_ref: digestRef(refs.ingress_nginx_controller.k8s_ref, digests.ingressNginxController),
    },
    ingress_nginx_certgen: {
      ...refs.ingress_nginx_certgen,
      host_digest_ref: digestRef(refs.ingress_nginx_certgen.host_ref, digests.ingressNginxCertgen),
      k8s_tag_ref: refs.ingress_nginx_certgen.k8s_tag_ref ?? refs.ingress_nginx_certgen.k8s_ref,
      k8s_ref: digestRef(refs.ingress_nginx_certgen.k8s_ref, digests.ingressNginxCertgen),
    },
  };
}

function manifestDigestFromOperations(
  operations: readonly ImageOperationEvidence[],
  hostRef: string,
): string {
  const operation = operations.find((item) => item.name === `host-manifest-inspect:${hostRef}`);
  return parseRegistryDigest(`${operation?.stdout ?? ''}\n${operation?.stderr ?? ''}`, hostRef);
}

function replaceEnvValue(source: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}=.*$`, 'mu');
  if (pattern.test(source)) {
    return source.replace(pattern, `${key}=${value}`);
  }

  return `${source.trimEnd()}\n${key}=${value}\n`;
}

function buildLocalKindSiteEnv(source: string, refs: LocalKindImageRefs): string {
  return [
    ['WEB_IMAGE', refs.app.k8s_ref],
    ['API_IMAGE', refs.app.k8s_ref],
    ['LLMUP_IMAGE', refs.llmup.k8s_ref],
    ['AFSCP_IMAGE', refs.afscp.k8s_ref],
    ['SANDBOX_MANAGER_IMAGE', refs.sandbox_manager.k8s_ref],
    ['MANAGED_RUNNER_IMAGE', refs.managed_runner.k8s_ref],
    ['INGRESS_NGINX_CONTROLLER_IMAGE', refs.ingress_nginx_controller.k8s_ref],
    ['INGRESS_NGINX_CERTGEN_IMAGE', refs.ingress_nginx_certgen.k8s_ref],
  ].reduce((current, [key, value]) => replaceEnvValue(current, key, value), source);
}

async function runDockerOperation(options: {
  name: string;
  args: string[];
  runner: LocalKindImageCommandRunner;
  env: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs?: number;
}): Promise<{ evidence: ImageOperationEvidence; failure?: CheckFailure }> {
  const result = await options.runner('docker', options.args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env,
    timeoutMs: options.timeoutMs,
  });
  const evidence: ImageOperationEvidence = {
    name: options.name,
    command: dockerCommandText(options.args),
    status: result.exitCode === 0 ? 'passed' : 'failed',
    exit_code: result.exitCode,
    stdout: redactDiagnostic(result.stdout),
    stderr: redactDiagnostic(result.stderr),
  };

  return {
    evidence,
    failure: result.exitCode === 0
      ? undefined
      : {
        path: `docker:${options.name}`,
        message: redactDiagnostic(result.stderr || result.stdout || `docker exited ${result.exitCode}`),
      },
  };
}

async function runCommandOperation(options: {
  name: string;
  command: string;
  args: string[];
  runner: LocalKindImageCommandRunner;
  env: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs?: number;
}): Promise<{ evidence: ImageOperationEvidence; failure?: CheckFailure }> {
  const result = await options.runner(options.command, options.args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env,
    timeoutMs: options.timeoutMs,
  });
  const evidence: ImageOperationEvidence = {
    name: options.name,
    command: commandText(options.command, options.args),
    status: result.exitCode === 0 ? 'passed' : 'failed',
    exit_code: result.exitCode,
    stdout: redactDiagnostic(result.stdout),
    stderr: redactDiagnostic(result.stderr),
  };

  return {
    evidence,
    failure: result.exitCode === 0
      ? undefined
      : {
        path: `${options.command}:${options.name}`,
        message: redactDiagnostic(result.stderr || result.stdout || `${options.command} exited ${result.exitCode}`),
      },
  };
}

async function runDockerSequence(options: {
  steps: Array<{ name: string; args: string[]; cwd?: string; timeoutMs?: number; optional?: boolean }>;
  runner: LocalKindImageCommandRunner;
  env: Record<string, string | undefined>;
}): Promise<{ operations: ImageOperationEvidence[]; failures: CheckFailure[] }> {
  const operations: ImageOperationEvidence[] = [];
  const failures: CheckFailure[] = [];

  for (const step of options.steps) {
    const result = await runDockerOperation({
      name: step.name,
      args: step.args,
      runner: options.runner,
      env: options.env,
      cwd: step.cwd,
      timeoutMs: step.timeoutMs,
    });
    operations.push(result.evidence);
    if (result.failure && !step.optional) {
      failures.push(result.failure);
      break;
    }
    if (result.failure && step.optional) {
      failures.push(result.failure);
    }
  }

  return { operations, failures };
}

async function sourceImageExists(options: {
  name: string;
  sourceImage: string;
  runner: LocalKindImageCommandRunner;
  env: Record<string, string | undefined>;
}): Promise<{ exists: boolean; operation: ImageOperationEvidence }> {
  const result = await runDockerOperation({
    name: `${options.name}-source-inspect`,
    args: ['image', 'inspect', options.sourceImage],
    runner: options.runner,
    env: options.env,
    timeoutMs: SHORT_DOCKER_TIMEOUT_MS,
  });

  return {
    exists: result.evidence.status === 'passed',
    operation: result.evidence,
  };
}

async function configureKindRegistryNoProxy(options: {
  runner: LocalKindImageCommandRunner;
  env: Record<string, string | undefined>;
  k8sRegistry: string;
}): Promise<{ evidence: ImageOperationEvidence; failure?: CheckFailure }> {
  const [registryHost, registryPort = '5000'] = options.k8sRegistry.split(':');
  const script = [
    'source scripts/lib/kind-cluster-bootstrap.sh',
    `kind_configure_registry_no_proxy_for_containerd ${shellQuote(LOCAL_KIND_CONTROL_PLANE_NODE)} ${shellQuote(registryHost ?? 'kind-registry')} ${shellQuote(registryPort)}`,
  ].join('; ');

  return runCommandOperation({
    name: 'kind-registry-no-proxy-reconcile',
    command: 'bash',
    args: ['-lc', script],
    runner: options.runner,
    env: options.env,
    timeoutMs: SHORT_DOCKER_TIMEOUT_MS,
  });
}

function registryBaseUrl(k8sRegistry: string): string {
  return `http://${k8sRegistry}/v2/`;
}

function classifyRegistryProbeFailure(details: string): string {
  if (/service unavailable|proxy|http\/1\.[01]\s+503|status\s*503|\berror:\s*503\b|\b503\b/iu.test(details)) {
    return 'proxy/NO_PROXY mismatch: kind node default environment must bypass proxy for kind-registry and kind-registry:5000';
  }
  if (/could not resolve|name or service not known|no such host|temporary failure in name resolution/iu.test(details)) {
    return 'hostname resolution missing: kind node must resolve kind-registry on the kind network';
  }
  if (/network .*not found|not connected|connection refused|failed to connect|connection timed out|no route to host/iu.test(details)) {
    return 'network missing: kind-registry must be connected to the kind Docker network';
  }

  return 'kind node registry availability check failed';
}

async function checkRegistryAvailability(options: {
  runner: LocalKindImageCommandRunner;
  env: Record<string, string | undefined>;
  k8sRegistry: string;
  failurePrefix: string;
  pullImages?: string[];
}): Promise<{ operations: ImageOperationEvidence[]; failures: CheckFailure[]; diagnostics: string[] }> {
  const operations: ImageOperationEvidence[] = [];
  const failures: CheckFailure[] = [];
  const diagnostics: string[] = [];
  const pullImages = [...new Set((options.pullImages ?? [])
    .filter((imageRef) => imageRef.startsWith(`${options.k8sRegistry}/`)))];
  const registry = await runDockerOperation({
    name: 'local-registry-check',
    args: ['ps', '--filter', 'name=^/kind-registry$', '--format', '{{.Names}}'],
    runner: options.runner,
    env: options.env,
    timeoutMs: SHORT_DOCKER_TIMEOUT_MS,
  });
  operations.push(registry.evidence);
  diagnostics.push(registry.evidence.stderr || registry.evidence.stdout || '');
  if (registry.failure || !registry.evidence.stdout?.includes('kind-registry')) {
    addFailure(
      failures,
      `${options.failurePrefix}:local-registry`,
      'kind local registry must be running as kind-registry and reachable at localhost:5001',
    );
  }

  const network = await runDockerOperation({
    name: 'kind-network-registry-check',
    args: ['network', 'inspect', 'kind', '--format', '{{range .Containers}}{{println .Name}}{{end}}'],
    runner: options.runner,
    env: options.env,
    timeoutMs: SHORT_DOCKER_TIMEOUT_MS,
  });
  operations.push(network.evidence);
  diagnostics.push(network.evidence.stderr || network.evidence.stdout || '');
  if (network.failure || !network.evidence.stdout?.includes('kind-registry')) {
    addFailure(
      failures,
      `${options.failurePrefix}:registry-network`,
      'network missing: kind-registry must be attached to the kind network before local-kind image pull checks can pass',
    );
  }

  const nodeProbe = await runDockerOperation({
    name: 'kind-node-registry-base-curl-diagnostic',
    args: [
      'exec',
      LOCAL_KIND_CONTROL_PLANE_NODE,
      'curl',
      '-fsS',
      registryBaseUrl(options.k8sRegistry),
    ],
    runner: options.runner,
    env: options.env,
    timeoutMs: SHORT_DOCKER_TIMEOUT_MS,
  });
  operations.push(nodeProbe.evidence);
  diagnostics.push(nodeProbe.evidence.stderr || nodeProbe.evidence.stdout || '');
  if (nodeProbe.failure) {
    diagnostics.push(`${classifyRegistryProbeFailure(`${nodeProbe.evidence.stderr ?? ''}\n${nodeProbe.evidence.stdout ?? ''}`)}; docker exec curl is diagnostic only for ${registryBaseUrl(options.k8sRegistry)}`);
  }

  for (const imageRef of pullImages) {
    const pull = await runDockerOperation({
      name: `kind-node-cri-pull:${imageRef}`,
      args: [
        'exec',
        LOCAL_KIND_CONTROL_PLANE_NODE,
        'crictl',
        'pull',
        imageRef,
      ],
      runner: options.runner,
      env: options.env,
      timeoutMs: SHORT_DOCKER_TIMEOUT_MS,
    });
    operations.push(pull.evidence);
    diagnostics.push(pull.evidence.stderr || pull.evidence.stdout || '');
    if (pull.failure) {
      addFailure(
        failures,
        `${options.failurePrefix}:registry-pull-path:${imageRef}`,
        `${classifyRegistryProbeFailure(`${pull.evidence.stderr ?? ''}\n${pull.evidence.stdout ?? ''}`)}; kind node CRI/containerd pull must succeed for ${imageRef}`,
      );
    }
  }

  return {
    operations,
    failures,
    diagnostics: diagnostics.filter(Boolean).map(redactDiagnostic),
  };
}

async function writeImagesEvidence(
  evidence: Omit<LocalKindImagesEvidence, 'status' | 'generated_at' | 'paths'>,
  evidenceDir: string,
): Promise<LocalKindImagesEvidence> {
  const resolvedEvidenceDir = prepareUnifiedDeployEvidenceDir({
    evidenceDir,
    defaultRoot: DEFAULT_EVIDENCE_DIR,
    label: 'local-kind images evidenceDir',
  });

  const status: ProducerStatus = evidence.failures.length === 0 ? 'passed' : 'failed';
  const basename = `local-kind-images-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
  const reportPath = path.join(resolvedEvidenceDir, `${basename}.json`);
  const logPath = path.join(resolvedEvidenceDir, `${basename}.log`);
  const evidenceWithPaths: LocalKindImagesEvidence = {
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
      'producer=local-kind-images',
      `status=${status}`,
      `generated_site_env_path=${evidence.generated_site_env_path}`,
      `failures=${evidence.failures.length}`,
      `report_path=${reportPath}`,
    ].join('\n') + '\n',
    'utf8',
  );

  return evidenceWithPaths;
}

async function finishImages(
  evidence: Omit<LocalKindImagesEvidence, 'status' | 'generated_at' | 'paths'>,
  evidenceDir: string,
): Promise<LocalKindImagesProducerResult> {
  const written = await writeImagesEvidence(evidence, evidenceDir);

  return {
    status: written.status,
    failures: written.failures,
    evidence: written,
  };
}

function siblingSandboxSourceDir(): string {
  return path.resolve(REPO_ROOT, '..', 'mbos-sandbox-v1', 'manager-service');
}

function siblingAfscpSourceDir(): string {
  return path.resolve(REPO_ROOT, '..', 'agentsmith-fs-control-plane');
}

export async function runLocalKindImagesProducer(
  options: LocalKindImagesProducerOptions = {},
): Promise<LocalKindImagesProducerResult> {
  const hostRegistry = options.hostRegistry ?? DEFAULT_HOST_REGISTRY;
  const k8sRegistry = options.k8sRegistry ?? DEFAULT_K8S_REGISTRY;
  const registryProject = options.registryProject ?? DEFAULT_REGISTRY_PROJECT;
  const tag = options.tag ?? DEFAULT_TAG;
  const env = options.env ?? process.env;
  const evidenceDir = options.evidenceDir ?? DEFAULT_EVIDENCE_DIR;
  const siteEnvPath = path.resolve(options.siteEnvPath ?? DEFAULT_SITE_ENV_PATH);
  const generatedSiteEnvPath = path.resolve(options.outputSiteEnvPath ?? DEFAULT_LOCAL_KIND_SITE_ENV_PATH);
  const sandboxSourceDir = path.resolve(options.sandboxSourceDir ?? env.SANDBOX_SOURCE_DIR ?? siblingSandboxSourceDir());
  const sandboxDockerfile = path.join(sandboxSourceDir, 'Dockerfile');
  const afscpSourceDir = path.resolve(options.afscpSourceDir ?? env.AFSCP_SOURCE_DIR ?? siblingAfscpSourceDir());
  const afscpDockerfile = path.join(afscpSourceDir, 'Dockerfile');
  const llmupLockPath = path.resolve(options.llmupImageLockPath ?? DEFAULT_LLMUP_IMAGE_LOCK_PATH);
  const runner = options.runner ?? defaultLocalKindImageCommandRunner;
  const failures: CheckFailure[] = [];
  const operations: ImageOperationEvidence[] = [];
  const siteEnvSource = await readFile(siteEnvPath, 'utf8');
  const siteEnv = parseKeyValues(siteEnvSource, siteEnvPath);
  const llmup = parseLlmupImageLock(await readFile(llmupLockPath, 'utf8'), {
    sourceName: llmupLockPath,
    hostRegistry,
    k8sRegistry,
    registryProject,
  });
  const ingressNginxController = parsePinnedSourceImage(siteEnv.INGRESS_NGINX_CONTROLLER_IMAGE, {
    sourceName: siteEnvPath,
    key: 'INGRESS_NGINX_CONTROLLER_IMAGE',
    repositoryName: 'ingress-nginx-controller',
    hostRegistry,
    k8sRegistry,
    registryProject,
  });
  const ingressNginxCertgen = parsePinnedSourceImage(siteEnv.INGRESS_NGINX_CERTGEN_IMAGE, {
    sourceName: siteEnvPath,
    key: 'INGRESS_NGINX_CERTGEN_IMAGE',
    repositoryName: 'ingress-nginx-kube-webhook-certgen',
    hostRegistry,
    k8sRegistry,
    registryProject,
  });
  const refs = imageRefs({
    tag,
    hostRegistry,
    k8sRegistry,
    registryProject,
    llmup,
    ingressNginxController,
    ingressNginxCertgen,
  });
  if (generatedSiteEnvPath !== siteEnvPath) {
    await rm(generatedSiteEnvPath, { force: true });
  }

  if (!existsSync(sandboxSourceDir) || !existsSync(sandboxDockerfile)) {
    addFailure(
      failures,
      'sandbox-source',
      `missing sandbox manager source at ${sandboxSourceDir}; set SANDBOX_SOURCE_DIR or --sandbox-source-dir to ../mbos-sandbox-v1/manager-service`,
    );
  }
  if (!existsSync(afscpSourceDir) || !existsSync(afscpDockerfile)) {
    addFailure(
      failures,
      'afscp-source',
      `missing AFSCP source at ${afscpSourceDir}; set AFSCP_SOURCE_DIR or --afscp-source-dir to ../agentsmith-fs-control-plane`,
    );
  }

  const baseEvidence: Omit<LocalKindImagesEvidence, 'status' | 'generated_at' | 'paths'> = {
    schema_version: 'agentsmith.unified-deploy.local-kind-images.evidence/v1',
    producer: 'local-kind-images',
    registries: {
      host_push: hostRegistry,
      k8s_pull: k8sRegistry,
      project: registryProject,
    },
    tag,
    generated_site_env_path: generatedSiteEnvPath,
    images: refs,
    operations,
    failures,
  };

  if (failures.length > 0) {
    return finishImages(baseEvidence, evidenceDir);
  }

  const registry = await runDockerOperation({
    name: 'local-registry-check',
    args: ['ps', '--filter', 'name=^/kind-registry$', '--format', '{{.Names}}'],
    runner,
    env,
    timeoutMs: SHORT_DOCKER_TIMEOUT_MS,
  });
  operations.push(registry.evidence);
  if (registry.failure || !registry.evidence.stdout?.includes('kind-registry')) {
    addFailure(
      failures,
      'local-registry',
      'kind local registry must be running as kind-registry and reachable at localhost:5001 before image prep',
    );
    return finishImages({ ...baseEvidence, failures }, evidenceDir);
  }

  const noProxy = await configureKindRegistryNoProxy({ runner, env, k8sRegistry });
  operations.push(noProxy.evidence);
  if (noProxy.failure) {
    failures.push({
      path: 'kind-registry-no-proxy',
      message: `${noProxy.failure.message}; unable to reconcile kind control-plane containerd NO_PROXY for ${k8sRegistry}`,
    });
    return finishImages({ ...baseEvidence, failures }, evidenceDir);
  }

  const appAndSandbox = await runDockerSequence({
    runner,
    env,
    steps: [
      {
        name: 'app-base-build',
        args: ['build', '-t', refs.app.base_host_ref, '-f', 'infra/deploy/Dockerfile.agentsmith-app-base', '.'],
      },
      {
        name: 'app-build',
        args: [
          'build',
          '--build-arg',
          `APP_BASE_IMAGE=${refs.app.base_host_ref}`,
          '-t',
          refs.app.host_ref,
          '-f',
          'infra/deploy/Dockerfile.agentsmith-app',
          '.',
        ],
      },
      {
        name: 'app-push',
        args: ['push', refs.app.host_ref],
      },
      {
        name: 'sandbox-build',
        args: ['build', '-t', refs.sandbox_manager.host_ref, '-f', sandboxDockerfile, sandboxSourceDir],
      },
      {
        name: 'sandbox-push',
        args: ['push', refs.sandbox_manager.host_ref],
      },
      {
        name: 'afscp-build',
        args: ['build', '-t', refs.afscp.host_ref, '-f', afscpDockerfile, afscpSourceDir],
      },
      {
        name: 'afscp-push',
        args: ['push', refs.afscp.host_ref],
      },
      {
        name: 'managed-runner-base-build',
        args: ['build', '-t', refs.managed_runner.base_host_ref, '-f', 'infra/runner/Dockerfile.agent-task-runner-base', '.'],
      },
      {
        name: 'managed-runner-build',
        args: [
          'build',
          '--build-arg',
          `RUNNER_BASE_IMAGE=${refs.managed_runner.base_host_ref}`,
          '-t',
          refs.managed_runner.host_ref,
          '-f',
          'infra/runner/Dockerfile.agent-task-runner',
          '.',
        ],
      },
      {
        name: 'managed-runner-push',
        args: ['push', refs.managed_runner.host_ref],
      },
    ],
  });
  operations.push(...appAndSandbox.operations);
  failures.push(...appAndSandbox.failures);
  if (failures.length > 0) {
    return finishImages({ ...baseEvidence, failures }, evidenceDir);
  }

  const mirroredSourceImages = [
    {
      name: 'llmup',
      sourceRef: refs.llmup.source_ref,
      hostRef: refs.llmup.host_ref,
    },
    {
      name: 'ingress-nginx-controller',
      sourceRef: refs.ingress_nginx_controller.source_ref,
      hostRef: refs.ingress_nginx_controller.host_ref,
    },
    {
      name: 'ingress-nginx-certgen',
      sourceRef: refs.ingress_nginx_certgen.source_ref,
      hostRef: refs.ingress_nginx_certgen.host_ref,
    },
  ];

  for (const image of mirroredSourceImages) {
    const inspected = await sourceImageExists({
      name: image.name,
      sourceImage: image.sourceRef,
      runner,
      env,
    });
    operations.push(inspected.operation);
    if (!inspected.exists) {
      const pull = await runDockerOperation({
        name: `${image.name}-source-pull`,
        args: ['pull', '--platform', 'linux/amd64', image.sourceRef],
        runner,
        env,
      });
      operations.push(pull.evidence);
      if (pull.failure) {
        failures.push({
          path: `${image.name}-source-image`,
          message: `${pull.failure.message}; unable to pull locked source image ${image.sourceRef}`,
        });
        return finishImages({ ...baseEvidence, failures }, evidenceDir);
      }
    }
  }

  const sourceTagPush = await runDockerSequence({
    runner,
    env,
    steps: mirroredSourceImages.flatMap((image) => [
      {
        name: `${image.name}-tag`,
        args: ['tag', image.sourceRef, image.hostRef],
      },
      {
        name: `${image.name}-push`,
        args: ['push', image.hostRef],
      },
    ]),
  });
  operations.push(...sourceTagPush.operations);
  failures.push(...sourceTagPush.failures);
  if (failures.length > 0) {
    return finishImages({ ...baseEvidence, failures }, evidenceDir);
  }

  const manifests = await runDockerSequence({
    runner,
    env,
    steps: [
      refs.app.host_ref,
      refs.sandbox_manager.host_ref,
      refs.managed_runner.host_ref,
      refs.afscp.host_ref,
      refs.llmup.host_ref,
      refs.ingress_nginx_controller.host_ref,
      refs.ingress_nginx_certgen.host_ref,
    ].map((hostRef) => ({
      name: `host-manifest-inspect:${hostRef}`,
      args: ['buildx', 'imagetools', 'inspect', hostRef],
      timeoutMs: SHORT_DOCKER_TIMEOUT_MS,
    })),
  });
  operations.push(...manifests.operations);
  failures.push(...manifests.failures.map((failure) => ({
    path: 'host-manifest',
    message: `host registry manifest must exist after image prep: ${failure.message}`,
  })));
  if (failures.length > 0) {
    return finishImages({ ...baseEvidence, failures }, evidenceDir);
  }

  let digestRefs: LocalKindImageRefs;
  try {
    digestRefs = withDigestHandoff(refs, {
      app: manifestDigestFromOperations(manifests.operations, refs.app.host_ref),
      sandboxManager: manifestDigestFromOperations(manifests.operations, refs.sandbox_manager.host_ref),
      managedRunner: manifestDigestFromOperations(manifests.operations, refs.managed_runner.host_ref),
      afscp: manifestDigestFromOperations(manifests.operations, refs.afscp.host_ref),
      llmup: manifestDigestFromOperations(manifests.operations, refs.llmup.host_ref),
      ingressNginxController: manifestDigestFromOperations(manifests.operations, refs.ingress_nginx_controller.host_ref),
      ingressNginxCertgen: manifestDigestFromOperations(manifests.operations, refs.ingress_nginx_certgen.host_ref),
    });
  } catch (error: unknown) {
    addFailure(failures, 'host-manifest', errorMessage(error));
    return finishImages({ ...baseEvidence, operations, failures }, evidenceDir);
  }

  const registryAvailability = await checkRegistryAvailability({
    runner,
    env,
    k8sRegistry,
    failurePrefix: 'registry-availability',
    pullImages: [
      digestRefs.app.k8s_ref,
      digestRefs.sandbox_manager.k8s_ref,
      digestRefs.managed_runner.k8s_ref,
      digestRefs.afscp.k8s_ref,
      digestRefs.llmup.k8s_ref,
      digestRefs.ingress_nginx_controller.k8s_ref,
      digestRefs.ingress_nginx_certgen.k8s_ref,
    ],
  });
  operations.push(...registryAvailability.operations);
  failures.push(...registryAvailability.failures);
  if (failures.length > 0) {
    return finishImages({ ...baseEvidence, images: digestRefs, failures }, evidenceDir);
  }

  await mkdir(path.dirname(generatedSiteEnvPath), { recursive: true });
  await writeFile(
    generatedSiteEnvPath,
    buildLocalKindSiteEnv(siteEnvSource, digestRefs),
    'utf8',
  );

  return finishImages({ ...baseEvidence, images: digestRefs, failures }, evidenceDir);
}

function podSpecImages(podSpec: Record<string, unknown>): string[] {
  const images = new Set<string>();
  for (const field of ['initContainers', 'containers']) {
    const containers = Array.isArray(podSpec[field]) ? podSpec[field] as unknown[] : [];
    for (const container of containers) {
      const image = asRecord(container).image;
      if (typeof image === 'string') {
        images.add(image);
      }
    }
  }

  return [...images];
}

function renderedImageRefs(renderedYaml: string): string[] {
  const parsed = parseKubernetesDocuments(renderedYaml);
  const images = new Set<string>();

  for (const document of parsed.documents) {
    const kind = resourceKind(document);
    if (kind === 'Deployment' || kind === 'Job') {
      const podSpec = asRecord(asRecord(asRecord(document.spec).template).spec);
      for (const image of podSpecImages(podSpec)) {
        images.add(image);
      }
      continue;
    }

    if (kind === 'ConfigMap' && asRecord(document.metadata).name === 'agentsmith-managed-runner-support') {
      const managedRunnerImage = asRecord(document.data).DEFAULT_MANAGED_RUNNER_IMAGE;
      if (typeof managedRunnerImage === 'string') {
        images.add(managedRunnerImage);
      }
    }
  }

  return [...images].sort();
}

function hostRefForK8sRef(imageRef: string, hostRegistry: string, k8sRegistry: string): string {
  return imageRef.startsWith(`${k8sRegistry}/`)
    ? `${hostRegistry}/${imageRef.slice(k8sRegistry.length + 1)}`
    : imageRef;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

type AfscpBootstrapCommandContract = {
  jobName: typeof AFSCP_SCHEMA_BOOTSTRAP_JOB | typeof AFSCP_VOLUME_BOOTSTRAP_JOB;
  image: string;
  command: string;
  commandVector: string[];
  args: string[];
  renderedArgs: string[];
  expectedCommand: string;
  expectedArgs: string[];
  actionFlags: string[];
};

function afscpBootstrapContractSpec(jobName: AfscpBootstrapCommandContract['jobName']): {
  expectedCommand: string;
  expectedArgs: string[];
  actionFlags: string[];
} {
  if (jobName === AFSCP_SCHEMA_BOOTSTRAP_JOB) {
    return {
      expectedCommand: AFSCP_SCHEMA_BOOTSTRAP_COMMAND,
      expectedArgs: ['--apply', '--check', '--timeout=60s'],
      actionFlags: ['--apply', '--check'],
    };
  }

  return {
    expectedCommand: AFSCP_VOLUME_BOOTSTRAP_COMMAND,
    expectedArgs: ['--ensure', '--check', '--timeout=60s'],
    actionFlags: ['--ensure', '--check'],
  };
}

function renderedAfscpBootstrapCommandContracts(renderedYaml: string): {
  contracts: AfscpBootstrapCommandContract[];
  failures: CheckFailure[];
} {
  const parsed = parseKubernetesDocuments(renderedYaml);
  const failures: CheckFailure[] = parsed.failures.map((failure) => ({
    path: `afscp-command-contract:${failure.path}`,
    message: failure.message,
  }));
  const jobNames = [AFSCP_SCHEMA_BOOTSTRAP_JOB, AFSCP_VOLUME_BOOTSTRAP_JOB] as const;
  const hasAnyAfscpBootstrapJob = parsed.documents.some((document) =>
    resourceKind(document) === 'Job' && jobNames.includes(resourceName(document) as typeof jobNames[number]));
  if (!hasAnyAfscpBootstrapJob) {
    return { contracts: [], failures };
  }

  const contracts: AfscpBootstrapCommandContract[] = [];
  for (const jobName of jobNames) {
    const spec = afscpBootstrapContractSpec(jobName);
    const job = parsed.documents.find((document) => resourceKind(document) === 'Job' && resourceName(document) === jobName);
    if (!job) {
      addFailure(failures, `afscp-command-contract:Job/${jobName}`, 'rendered AFSCP bootstrap command contract requires both schema and volume bootstrap Jobs');
      continue;
    }
    const podSpec = asRecord(asRecord(asRecord(job.spec).template).spec);
    const containers = Array.isArray(podSpec.containers) ? podSpec.containers.map(asRecord) : [];
    const container = containers.find((item) => item.name === jobName) ?? containers[0] ?? {};
    const image = typeof container.image === 'string' ? container.image : '';
    const commandVector = stringArray(container.command);
    const command = commandVector[0] ?? '';
    const args = stringArray(container.args);
    const renderedArgs = [...commandVector.slice(1), ...args];
    if (!image || !command) {
      addFailure(failures, `afscp-command-contract:Job/${jobName}`, 'rendered AFSCP bootstrap Job must include image and command');
      continue;
    }
    if (command !== spec.expectedCommand) {
      addFailure(
        failures,
        `afscp-command-contract:Job/${jobName}`,
        `rendered AFSCP bootstrap Job must run ${spec.expectedCommand}`,
      );
    }
    if (!spec.actionFlags.some((flag) => renderedArgs.includes(flag))) {
      addFailure(
        failures,
        `afscp-command-contract:Job/${jobName}`,
        `rendered AFSCP bootstrap Job must include an action flag (${spec.actionFlags.join(' or ')})`,
      );
    }
    if (renderedArgs.join('\0') !== spec.expectedArgs.join('\0')) {
      addFailure(
        failures,
        `afscp-command-contract:Job/${jobName}`,
        `rendered AFSCP bootstrap Job command contract must be ${spec.expectedCommand} ${spec.expectedArgs.join(' ')}`,
      );
    }
    contracts.push({
      jobName,
      image,
      command,
      commandVector,
      args,
      renderedArgs,
      expectedCommand: spec.expectedCommand,
      expectedArgs: spec.expectedArgs,
      actionFlags: spec.actionFlags,
    });
  }

  return { contracts, failures };
}

function acceptsPositiveAfscpContractSmoke(contract: AfscpBootstrapCommandContract, result: LocalKindImageCommandRunResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode === 0) {
    return true;
  }
  if (/flag provided but not defined|unknown flag|unexpected argument/iu.test(output)) {
    return false;
  }
  if (contract.jobName === AFSCP_SCHEMA_BOOTSTRAP_JOB) {
    return result.exitCode === 2 && /AFSCP_MIGRATION_POSTGRES_DSN|AFSCP_POSTGRES_DSN|AFSCP_DATABASE_URL/u.test(output);
  }
  return result.exitCode === 2 && /AFSCP_VOLUME_BOOTSTRAP_POSTGRES_DSN|AFSCP_POSTGRES_DSN|AFSCP_DATABASE_URL/u.test(output);
}

function acceptsMissingActionAfscpContractSmoke(contract: AfscpBootstrapCommandContract, result: LocalKindImageCommandRunResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`;
  return result.exitCode !== 0 && contract.actionFlags.every((flag) => output.includes(flag));
}

function acceptsVolumeWrongApplySmoke(result: LocalKindImageCommandRunResult): boolean {
  return result.exitCode !== 0 && /apply/iu.test(`${result.stdout}\n${result.stderr}`) && /flag|unknown|defined/iu.test(`${result.stdout}\n${result.stderr}`);
}

async function runAfscpCommandContractSmoke(args: {
  name: string;
  contract: AfscpBootstrapCommandContract;
  imageRef: string;
  commandArgs: string[];
  runner: LocalKindImageCommandRunner;
  env: Record<string, string | undefined>;
  accept: (result: LocalKindImageCommandRunResult) => boolean;
  successDiagnostic: string;
  failureDiagnostic: string;
}): Promise<{ diagnostics: string[]; failure?: CheckFailure }> {
  const dockerArgs = [
    'run',
    '--rm',
    '--network=none',
    '--entrypoint',
    args.contract.command,
    args.imageRef,
    ...args.commandArgs,
  ];
  const commandForDiagnostics = sanitizedDockerCommandText(dockerArgs);
  const result = await args.runner('docker', dockerArgs, {
    cwd: REPO_ROOT,
    env: args.env,
    timeoutMs: SHORT_DOCKER_TIMEOUT_MS,
  });
  const output = redactDiagnostic(`${result.stdout}\n${result.stderr}`.trim());
  if (args.accept(result)) {
    return {
      diagnostics: [
        `${args.successDiagnostic}: ${commandForDiagnostics}; AFSCP command contract smoke only, not full bootstrap readiness`,
      ],
    };
  }

  return {
    diagnostics: [
      `${args.failureDiagnostic}: ${commandForDiagnostics}; AFSCP command contract smoke only, not full bootstrap readiness`,
      output,
    ].filter(Boolean),
    failure: {
      path: `afscp-command-contract:Job/${args.contract.jobName}`,
      message: redactDiagnostic(`${args.failureDiagnostic}; ${commandForDiagnostics} exited ${result.exitCode}${output ? `: ${output}` : ''}`),
    },
  };
}

async function checkAfscpCommandContracts(options: {
  renderedYaml: string;
  runner: LocalKindImageCommandRunner;
  env: Record<string, string | undefined>;
  hostRegistry: string;
  k8sRegistry: string;
}): Promise<{ failures: CheckFailure[]; diagnostics: string[] }> {
  const rendered = renderedAfscpBootstrapCommandContracts(options.renderedYaml);
  const failures = [...rendered.failures];
  const diagnostics: string[] = [];

  for (const contract of rendered.contracts) {
    const imageRef = hostRefForK8sRef(contract.image, options.hostRegistry, options.k8sRegistry);
    const positive = await runAfscpCommandContractSmoke({
      name: `${contract.jobName}:rendered`,
      contract,
      imageRef,
      commandArgs: contract.renderedArgs,
      runner: options.runner,
      env: options.env,
      accept: (result) => acceptsPositiveAfscpContractSmoke(contract, result),
      successDiagnostic: `AFSCP command contract smoke passed for rendered Job/${contract.jobName}`,
      failureDiagnostic: `rendered AFSCP command did not satisfy the ${contract.expectedCommand} argument contract`,
    });
    diagnostics.push(...positive.diagnostics);
    if (positive.failure) {
      failures.push(positive.failure);
    }

    const missingActionArgs = contract.renderedArgs.filter((arg) => !contract.actionFlags.includes(arg));
    const missingAction = await runAfscpCommandContractSmoke({
      name: `${contract.jobName}:missing-action`,
      contract,
      imageRef,
      commandArgs: missingActionArgs,
      runner: options.runner,
      env: options.env,
      accept: (result) => acceptsMissingActionAfscpContractSmoke(contract, result),
      successDiagnostic: `AFSCP command contract smoke passed for missing action negative Job/${contract.jobName}`,
      failureDiagnostic: `AFSCP command must reject missing action flag (${contract.actionFlags.join(' or ')})`,
    });
    diagnostics.push(...missingAction.diagnostics);
    if (missingAction.failure) {
      failures.push(missingAction.failure);
    }

    if (contract.jobName === AFSCP_VOLUME_BOOTSTRAP_JOB) {
      const nonActionArgs = contract.renderedArgs.filter((arg) => !['--ensure', '--check', '--apply'].includes(arg));
      const wrongApply = await runAfscpCommandContractSmoke({
        name: `${contract.jobName}:wrong-apply`,
        contract,
        imageRef,
        commandArgs: ['--apply', '--check', ...nonActionArgs],
        runner: options.runner,
        env: options.env,
        accept: acceptsVolumeWrongApplySmoke,
        successDiagnostic: `AFSCP command contract smoke passed for volume --apply negative Job/${contract.jobName}`,
        failureDiagnostic: 'AFSCP volume bootstrap must reject the schema --apply flag and require --ensure for apply-like behavior',
      });
      diagnostics.push(...wrongApply.diagnostics);
      if (wrongApply.failure) {
        failures.push(wrongApply.failure);
      }
    }
  }

  return {
    failures,
    diagnostics: diagnostics.filter(Boolean).map(redactDiagnostic),
  };
}

export async function checkLocalKindImagePreflight(options: {
  renderedYaml: string;
  runner: LocalKindImageCommandRunner;
  env?: Record<string, string | undefined>;
  hostRegistry?: string;
  k8sRegistry?: string;
}): Promise<LocalKindImagePreflightResult> {
  const hostRegistry = options.hostRegistry ?? DEFAULT_HOST_REGISTRY;
  const k8sRegistry = options.k8sRegistry ?? DEFAULT_K8S_REGISTRY;
  const env = options.env ?? process.env;
  const imageRefs = renderedImageRefs(options.renderedYaml);
  const hostRefs = imageRefs.map((imageRef) => hostRefForK8sRef(imageRef, hostRegistry, k8sRegistry));
  const failures: CheckFailure[] = [];
  const diagnostics: string[] = [];

  for (const imageRef of imageRefs) {
    if (/^ghcr\.io\/mbos\/.+:dev$/u.test(imageRef)) {
      addFailure(
        failures,
        `image-preflight:${imageRef}`,
        'local-kind image prep is required; rendered workload still points at private ghcr.io/mbos/*:dev image',
      );
    }
    if (!imageRef.startsWith(`${k8sRegistry}/mbos/`)) {
      addFailure(
        failures,
        `image-preflight:${imageRef}`,
        `local-kind workload image must use ${k8sRegistry}/mbos/... generated by local-kind image prep`,
      );
    }
    const digest = imageRef.split('@')[1] ?? '';
    if (!SHA256_DIGEST_PATTERN.test(digest)) {
      addFailure(
        failures,
        `image-preflight:${imageRef}`,
        `local-kind image handoff must use immutable ${k8sRegistry}/mbos/...@sha256 refs generated by npm run test:unified-deploy:local-kind:images`,
      );
    }
  }
  if (failures.length > 0) {
    return {
      status: 'failed',
      image_refs: imageRefs,
      host_refs: hostRefs,
      failures,
      diagnostics,
    };
  }

  const registryAvailability = await checkRegistryAvailability({
    runner: options.runner,
    env,
    k8sRegistry,
    failurePrefix: 'image-preflight',
    pullImages: imageRefs,
  });
  diagnostics.push(...registryAvailability.diagnostics);
  failures.push(...registryAvailability.failures);

  for (const hostRef of hostRefs) {
    const inspected = await runDockerOperation({
      name: `manifest-inspect:${hostRef}`,
      args: ['buildx', 'imagetools', 'inspect', hostRef],
      runner: options.runner,
      env,
      timeoutMs: SHORT_DOCKER_TIMEOUT_MS,
    });
    diagnostics.push(inspected.evidence.stderr || inspected.evidence.stdout || '');
    if (inspected.failure) {
      addFailure(
        failures,
        `image-preflight:${hostRef}`,
        `local-kind image prep is required; host registry does not have ${hostRef}`,
      );
    }
  }

  if (failures.length === 0) {
    const afscpCommandContracts = await checkAfscpCommandContracts({
      renderedYaml: options.renderedYaml,
      runner: options.runner,
      env,
      hostRegistry,
      k8sRegistry,
    });
    diagnostics.push(...afscpCommandContracts.diagnostics);
    failures.push(...afscpCommandContracts.failures);
  }

  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    image_refs: imageRefs,
    host_refs: hostRefs,
    failures,
    diagnostics: diagnostics.filter(Boolean).map(redactDiagnostic),
  };
}

type CliOptions = LocalKindImagesProducerOptions;

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};

  for (const arg of argv) {
    if (arg.startsWith('--site-env=')) {
      options.siteEnvPath = arg.slice('--site-env='.length);
    } else if (arg.startsWith('--out-site-env=')) {
      options.outputSiteEnvPath = arg.slice('--out-site-env='.length);
    } else if (arg.startsWith('--evidence-dir=')) {
      options.evidenceDir = arg.slice('--evidence-dir='.length);
    } else if (arg.startsWith('--sandbox-source-dir=')) {
      options.sandboxSourceDir = arg.slice('--sandbox-source-dir='.length);
    } else if (arg.startsWith('--afscp-source-dir=')) {
      options.afscpSourceDir = arg.slice('--afscp-source-dir='.length);
    } else if (arg.startsWith('--llmup-image-lock=')) {
      options.llmupImageLockPath = arg.slice('--llmup-image-lock='.length);
    } else if (arg.startsWith('--host-registry=')) {
      options.hostRegistry = arg.slice('--host-registry='.length);
    } else if (arg.startsWith('--k8s-registry=')) {
      options.k8sRegistry = arg.slice('--k8s-registry='.length);
    } else if (arg.startsWith('--registry-project=')) {
      options.registryProject = arg.slice('--registry-project='.length);
    } else if (arg.startsWith('--tag=')) {
      options.tag = arg.slice('--tag='.length);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const result = await runLocalKindImagesProducer(parseCliOptions(process.argv.slice(2)));
  if (result.status === 'passed') {
    process.stdout.write(`[unified-deploy] local-kind images prepared\n[unified-deploy] site env: ${result.evidence.generated_site_env_path}\n[unified-deploy] evidence: ${result.evidence.paths.report_path}\n`);
    return;
  }

  process.stderr.write(`${result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n')}\n`);
  process.stderr.write(`[unified-deploy] local-kind image prep failed\n[unified-deploy] evidence: ${result.evidence.paths.report_path}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
