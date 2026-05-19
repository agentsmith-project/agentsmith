import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REPO_ROOT,
  TARGET_PROFILES,
  isUnifiedDeployProfile,
  type CheckFailure,
  type UnifiedDeployProfile,
} from './manifest';
import {
  parseKubernetesDocuments,
  resourceId,
  resourceKind,
} from './kubernetes';
import {
  DEFAULT_SITE_ENV_PATH,
  DEFAULT_TEMPLATES_ROOT,
  renderUnifiedDeployFromFiles,
} from './render';
import { fingerprintRenderedManifest } from './evidence';
import { checkRenderedOutput } from './check-render';
import { DEFAULT_SUBSTRATE_TRUTH_PATH } from './substrate-truth';

type DryRunStatus = 'passed' | 'failed' | 'skipped';
type ProducerStatus = 'passed' | 'failed';

export type KubectlRunOptions = {
  input: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

export type KubectlRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type KubectlRunner = (
  command: string,
  args: string[],
  options: KubectlRunOptions,
) => Promise<KubectlRunResult>;

type ResourceSummary = {
  total: number;
  kinds: Record<string, number>;
  resources: string[];
};

type K8sDryRunProfileEvidence = {
  profile: UnifiedDeployProfile;
  manifest_fingerprint: string;
  manifest_summary: ResourceSummary;
  dry_run: {
    mode: 'server';
    status: DryRunStatus;
    command: string;
    scope_note: string;
    kubeconfig: 'explicit' | 'default' | 'missing';
    exit_code?: number;
    stdout?: string;
    stderr?: string;
  };
  failures: CheckFailure[];
};

type K8sDryRunEvidence = {
  schema_version: 'agentsmith.unified-deploy.k8s-dry-run.evidence/v1';
  producer: 'k8s-dry-run';
  status: ProducerStatus;
  generated_at: string;
  dry_run_scope: {
    manifest_group: 'app';
    mode: 'server';
    requires_existing_namespace: true;
    applies_resources: false;
  };
  profiles: K8sDryRunProfileEvidence[];
  failures: CheckFailure[];
  paths: {
    report_path: string;
    log_path: string;
  };
};

export type K8sDryRunProducerOptions = {
  profiles?: readonly UnifiedDeployProfile[];
  siteEnvPath?: string;
  substrateTruthPath?: string;
  manifestPath?: string;
  templatesRoot?: string;
  evidenceDir?: string;
  kubeconfigPath?: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  runner?: KubectlRunner;
};

export type K8sDryRunProducerResult = {
  status: ProducerStatus;
  failures: CheckFailure[];
  evidence: K8sDryRunEvidence;
};

type KubeconfigResolution = {
  path?: string;
  source: 'explicit' | 'default' | 'missing';
  attempted: string[];
};

type CliOptions = {
  profiles?: UnifiedDeployProfile[];
  siteEnvPath?: string;
  substrateTruthPath?: string;
  manifestPath?: string;
  templatesRoot?: string;
  evidenceDir?: string;
  kubeconfigPath?: string;
};

const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, 'artifacts', 'unified-deploy');
const KUBECTL_TIMEOUT_MS = 60_000;
const KUBECTL_REQUEST_TIMEOUT = '20s';
const DRY_RUN_COMMAND = 'kubectl apply --dry-run=server -f -';
const DRY_RUN_SCOPE_NOTE = 'server-side dry-run for app manifests; target namespace must already exist; default render uses the sample substrate truth unless --substrate-truth is provided and does not validate live substrate routability';
const DRY_RUN_SCOPE = {
  manifest_group: 'app',
  mode: 'server',
  requires_existing_namespace: true,
  applies_resources: false,
} as const;
const SECRET_FIELD_KEY_PATTERN = /(?:PASSWORD|SECRET|TOKEN|PRIVATE|ACCESS[_-]?KEY|API[_-]?KEY|CREDENTIAL|DATABASE_URL|MONGO_URL|MONGODB_URI|REDIS_URL|CLIENT_SECRET|AUTHORIZATION)/iu;
const SECRET_VALUE_PATTERN = /(?:password|secret|token|access[_-]?key|api[_-]?key|credential|client[_-]?secret)/iu;
const PUBLIC_VALUE_DENYLIST = new Set(['agentsmith', 'admin', 'admin-cli', 'public', 'true', 'false']);
const EMPTY_SUMMARY: ResourceSummary = {
  total: 0,
  kinds: {},
  resources: [],
};

function prefixedFailure(
  profile: UnifiedDeployProfile,
  failure: CheckFailure,
  secretValues: readonly string[] = [],
): CheckFailure {
  return {
    path: `${profile}:${failure.path}`,
    message: redactDiagnostic(failure.message, secretValues),
  };
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
    // Non-URL secret values are expected here.
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
            // Invalid base64 is ignored; Kubernetes validation will report it separately.
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

function buildKubectlArgs(kubeconfigPath: string): string[] {
  return [
    '--kubeconfig',
    kubeconfigPath,
    `--request-timeout=${KUBECTL_REQUEST_TIMEOUT}`,
    'apply',
    '--dry-run=server',
    '-f',
    '-',
  ];
}

export async function defaultKubectlRunner(
  command: string,
  args: string[],
  options: KubectlRunOptions,
): Promise<KubectlRunResult> {
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
    child.stdin.end(options.input);
  });
}

async function dryRunProfile(options: {
  profile: UnifiedDeployProfile;
  kubeconfig: KubeconfigResolution;
  producerOptions: K8sDryRunProducerOptions;
  runner: KubectlRunner;
  env: Record<string, string | undefined>;
}): Promise<{
  evidence: K8sDryRunProfileEvidence;
  failures: CheckFailure[];
}> {
  const profileFailures: CheckFailure[] = [];
  let manifestFingerprint = 'unavailable';
  let manifestSummary = EMPTY_SUMMARY;
  let dryRun: K8sDryRunProfileEvidence['dry_run'] = {
    mode: 'server',
    status: 'skipped',
    command: DRY_RUN_COMMAND,
    scope_note: DRY_RUN_SCOPE_NOTE,
    kubeconfig: options.kubeconfig.source,
  };
  let renderedSecretValues: string[] = [];

  try {
    const rendered = await renderUnifiedDeployFromFiles({
      profile: options.profile,
      siteEnvPath: options.producerOptions.siteEnvPath ?? DEFAULT_SITE_ENV_PATH,
      substrateTruthPath: options.producerOptions.substrateTruthPath ?? DEFAULT_SUBSTRATE_TRUTH_PATH,
      manifestPath: options.producerOptions.manifestPath,
      templatesRoot: options.producerOptions.templatesRoot ?? DEFAULT_TEMPLATES_ROOT,
    });
    manifestFingerprint = fingerprintRenderedManifest(rendered.output);
    manifestSummary = summarizeRenderedManifest(rendered.output);
    renderedSecretValues = collectRenderedSecretValues(rendered.output);

    const renderCheck = checkRenderedOutput(rendered.output, { profile: options.profile });
    if (!renderCheck.ok) {
      profileFailures.push(...renderCheck.failures.map((failure) =>
        prefixedFailure(options.profile, failure, renderedSecretValues),
      ));
    }

    if (profileFailures.length > 0) {
      dryRun = {
        ...dryRun,
        status: 'skipped',
      };
    } else if (options.kubeconfig.path) {
      const kubectlResult = await options.runner(
        'kubectl',
        buildKubectlArgs(options.kubeconfig.path),
        {
          input: rendered.output,
          cwd: REPO_ROOT,
          env: {
            ...options.env,
            KUBECONFIG: options.kubeconfig.path,
          },
          timeoutMs: KUBECTL_TIMEOUT_MS,
        },
      );
      dryRun = {
        mode: 'server',
        status: kubectlResult.exitCode === 0 ? 'passed' : 'failed',
        command: DRY_RUN_COMMAND,
        scope_note: DRY_RUN_SCOPE_NOTE,
        kubeconfig: options.kubeconfig.source,
        exit_code: kubectlResult.exitCode,
        stdout: redactDiagnostic(kubectlResult.stdout, renderedSecretValues),
        stderr: redactDiagnostic(kubectlResult.stderr, renderedSecretValues),
      };
      if (kubectlResult.exitCode !== 0) {
        profileFailures.push({
          path: `${options.profile}:kubectl`,
          message: redactDiagnostic(
            kubectlResult.stderr || kubectlResult.stdout || `kubectl exited ${kubectlResult.exitCode}`,
            renderedSecretValues,
          ),
        });
      }
    }
  } catch (error) {
    profileFailures.push({
      path: `${options.profile}:render`,
      message: redactDiagnostic(errorMessage(error), renderedSecretValues),
    });
  }

  return {
    evidence: {
      profile: options.profile,
      manifest_fingerprint: manifestFingerprint,
      manifest_summary: manifestSummary,
      dry_run: dryRun,
      failures: profileFailures,
    },
    failures: profileFailures,
  };
}

async function writeK8sDryRunEvidence(
  evidence: Omit<K8sDryRunEvidence, 'paths'>,
  evidenceDir: string,
): Promise<K8sDryRunEvidence> {
  const resolvedEvidenceDir = path.resolve(evidenceDir);
  await mkdir(resolvedEvidenceDir, { recursive: true });

  const basename = `k8s-dry-run-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
  const reportPath = path.join(resolvedEvidenceDir, `${basename}.json`);
  const logPath = path.join(resolvedEvidenceDir, `${basename}.log`);
  const evidenceWithPaths: K8sDryRunEvidence = {
    ...evidence,
    paths: {
      report_path: reportPath,
      log_path: logPath,
    },
  };

  await writeFile(reportPath, `${JSON.stringify(evidenceWithPaths, null, 2)}\n`, 'utf8');
  await writeFile(
    logPath,
    [
      'producer=k8s-dry-run',
      `status=${evidence.status}`,
      'dry_run_mode=server',
      'dry_run_scope=app-manifest-after-namespace-preflight',
      'requires_existing_namespace=true',
      'applies_resources=false',
      `profiles=${evidence.profiles.map((profile) => profile.profile).join(',')}`,
      `failures=${evidence.failures.length}`,
      `report_path=${reportPath}`,
    ].join('\n') + '\n',
    'utf8',
  );

  return evidenceWithPaths;
}

export async function runK8sDryRunProducer(
  options: K8sDryRunProducerOptions = {},
): Promise<K8sDryRunProducerResult> {
  const env = options.env ?? process.env;
  const kubeconfig = resolveKubeconfig({
    kubeconfigPath: options.kubeconfigPath,
    env,
    homeDir: options.homeDir ?? homedir(),
  });
  const failures: CheckFailure[] = [];
  const profiles = options.profiles ?? TARGET_PROFILES;

  if (!kubeconfig.path) {
    failures.push({
      path: 'kubeconfig',
      message: `server-side dry-run requires KUBECONFIG or ${path.join(options.homeDir ?? homedir(), '.kube', 'config')}; attempted: ${kubeconfig.attempted.join(', ')}`,
    });
  }

  const profileResults = await Promise.all(profiles.map((profile) => dryRunProfile({
    profile,
    kubeconfig,
    producerOptions: options,
    runner: options.runner ?? defaultKubectlRunner,
    env,
  })));
  failures.push(...profileResults.flatMap((result) => result.failures));
  const status: ProducerStatus = failures.length === 0 ? 'passed' : 'failed';
  const evidence = await writeK8sDryRunEvidence({
    schema_version: 'agentsmith.unified-deploy.k8s-dry-run.evidence/v1',
    producer: 'k8s-dry-run',
    status,
    generated_at: new Date().toISOString(),
    dry_run_scope: DRY_RUN_SCOPE,
    profiles: profileResults.map((result) => result.evidence),
    failures,
  }, options.evidenceDir ?? DEFAULT_EVIDENCE_DIR);

  return {
    status,
    failures,
    evidence,
  };
}

function parseProfiles(value: string): UnifiedDeployProfile[] {
  const profiles = value.split(',').map((profile) => profile.trim()).filter(Boolean);
  for (const profile of profiles) {
    if (!isUnifiedDeployProfile(profile)) {
      throw new Error(`unknown unified deploy profile: ${profile}; expected ${TARGET_PROFILES.join(' or ')}`);
    }
  }
  if (profiles.length === 0) {
    throw new Error('at least one profile is required');
  }

  return profiles as UnifiedDeployProfile[];
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};

  for (const arg of argv) {
    if (arg.startsWith('--profile=')) {
      options.profiles = parseProfiles(arg.slice('--profile='.length));
    } else if (arg.startsWith('--profiles=')) {
      options.profiles = parseProfiles(arg.slice('--profiles='.length));
    } else if (arg.startsWith('--site-env=')) {
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
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return options;
}

async function main(): Promise<void> {
  const result = await runK8sDryRunProducer(parseCliOptions(process.argv.slice(2)));
  if (result.status === 'passed') {
    process.stdout.write(`[unified-deploy] k8s app manifest server-side dry-run passed (namespace must already exist; no resources applied)\n[unified-deploy] evidence: ${result.evidence.paths.report_path}\n`);
    return;
  }

  process.stderr.write(`${result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n')}\n`);
  process.stderr.write(`[unified-deploy] k8s app manifest server-side dry-run failed (namespace must already exist; no resources applied)\n[unified-deploy] evidence: ${result.evidence.paths.report_path}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
