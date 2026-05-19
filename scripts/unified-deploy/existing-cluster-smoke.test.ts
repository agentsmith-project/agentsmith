import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  runExistingClusterSmokeProducer,
  type ExistingClusterCommandRunner,
  type ExistingClusterHttpProbeRunner,
  type ExistingClusterSmokeProducerOptions,
} from './check-existing-cluster-smoke';
import { DEFAULT_SITE_ENV_PATH } from './render';

const tempRoots: string[] = [];
const fixturesDir = join(process.cwd(), 'scripts', 'unified-deploy', '__fixtures__');

type CommandCall = {
  command: string;
  args: string[];
  input: string;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function writeKubeconfig(root: string): string {
  const kubeconfigPath = join(root, 'kubeconfig.yaml');
  writeFileSync(kubeconfigPath, 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\n', 'utf8');
  return kubeconfigPath;
}

function writeExistingClusterSiteEnv(root: string): string {
  const siteEnvPath = join(root, 'site.env');
  writeFileSync(
    siteEnvPath,
    readFileSync(DEFAULT_SITE_ENV_PATH, 'utf8')
      .replace(/^UNIFIED_DEPLOY_PROFILE=.*$/mu, 'UNIFIED_DEPLOY_PROFILE=existing-cluster')
      .replace(/^PUBLIC_BASE_URL=.*$/mu, 'PUBLIC_BASE_URL=https://agentsmith.example.test')
      .replace(/^PUBLIC_API_BASE_URL=.*$/mu, 'PUBLIC_API_BASE_URL=https://agentsmith.example.test/api/v1')
      .replace(/^RUNNER_PUBLIC_API_BASE_URL=.*$/mu, 'RUNNER_PUBLIC_API_BASE_URL=wss://agentsmith.example.test/api/v1'),
    'utf8',
  );
  return siteEnvPath;
}

function jsonResult(value: unknown): { exitCode: number; stdout: string; stderr: string } {
  return {
    exitCode: 0,
    stdout: JSON.stringify(value),
    stderr: '',
  };
}

function completedJob(name: string): Record<string, unknown> {
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name },
    status: {
      conditions: [
        {
          type: 'Complete',
          status: 'True',
          reason: 'Completed',
          message: 'bootstrap completed',
        },
      ],
    },
  };
}

function failedJob(name: string, reason: string, message: string): Record<string, unknown> {
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name },
    status: {
      failed: 1,
      conditions: [
        {
          type: 'Failed',
          status: 'True',
          reason,
          message,
        },
      ],
    },
  };
}

function passingIngress(): Record<string, unknown> {
  return {
    kind: 'Ingress',
    metadata: { name: 'agentsmith' },
    spec: {
      rules: [
        {
          http: {
            paths: [
              { path: '/api/public', backend: { service: { name: 'agentsmith-web' } } },
              { path: '/api/system', backend: { service: { name: 'agentsmith-web' } } },
              { path: '/api/v1', backend: { service: { name: 'agentsmith-api' } } },
              { path: '/', backend: { service: { name: 'agentsmith-web' } } },
            ],
          },
        },
      ],
    },
  };
}

function createPassingRunner(calls: CommandCall[]): ExistingClusterCommandRunner {
  return async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input ?? '' });
    const joined = args.join(' ');

    if (joined.includes('get namespace agentsmith')) {
      return jsonResult({ kind: 'Namespace', metadata: { name: 'agentsmith' } });
    }
    if (joined.includes('get job/agentsmith-product-schema-bootstrap -o json')) {
      return jsonResult(completedJob('agentsmith-product-schema-bootstrap'));
    }
    if (joined.includes('get job/afscp-schema-bootstrap -o json')) {
      return jsonResult(completedJob('afscp-schema-bootstrap'));
    }
    if (joined.includes('get job/afscp-volume-bootstrap -o json')) {
      return jsonResult(completedJob('afscp-volume-bootstrap'));
    }
    if (joined.includes('rollout status')) {
      return { exitCode: 0, stdout: 'deployment successfully rolled out', stderr: '' };
    }
    if (joined.includes('get deployment agentsmith-api')) {
      return jsonResult({
        kind: 'Deployment',
        metadata: { name: 'agentsmith-api' },
        spec: { replicas: 1 },
        status: { readyReplicas: 1, availableReplicas: 1 },
      });
    }
    if (joined.includes('get deployment,service,configmap,ingress,horizontalpodautoscaler')) {
      return jsonResult({
        kind: 'List',
        items: [
          { kind: 'Deployment', metadata: { name: 'agentsmith-api' }, spec: { replicas: 1 } },
          { kind: 'Deployment', metadata: { name: 'agentsmith-web' }, spec: { replicas: 1 } },
          { kind: 'Deployment', metadata: { name: 'agentsmith-llmup' }, spec: { replicas: 1 } },
          { kind: 'Deployment', metadata: { name: 'agentsmith-sandbox-control-plane' }, spec: { replicas: 1 } },
        ],
      });
    }
    if (joined.includes('get scaledobjects.keda.sh') || joined.includes('get scaledjobs.keda.sh')) {
      return jsonResult({ kind: 'List', items: [] });
    }
    if (joined.includes('get ingress agentsmith')) {
      return jsonResult(passingIngress());
    }

    return { exitCode: 0, stdout: 'ok', stderr: '' };
  };
}

const passingProbeRunner: ExistingClusterHttpProbeRunner = async (url, options) => {
  if (url.includes('/api/public/workspaces')) {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"items":[]}',
      request_headers: options.headers ?? {},
    };
  }
  if (url.includes('/api/v1/me/profile')) {
    const authenticated = typeof options.headers?.Authorization === 'string';
    return {
      status: authenticated ? 200 : 401,
      headers: { 'content-type': 'application/json' },
      body: authenticated ? '{"id":"user-1"}' : '{"error":"unauthorized"}',
      request_headers: options.headers ?? {},
    };
  }
  if (url.includes('/api/v1/agent-execution/ws')) {
    return {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: '{"error":"missing runner"}',
      request_headers: options.headers ?? {},
    };
  }

  return {
    status: 404,
    headers: { 'content-type': 'text/plain' },
    body: 'not found',
    request_headers: options.headers ?? {},
  };
};

async function runSmoke(
  options: ExistingClusterSmokeProducerOptions = {},
): ReturnType<typeof runExistingClusterSmokeProducer> {
  const root = tempDir('existing-cluster-smoke-defaults-');
  return runExistingClusterSmokeProducer({
    siteEnvPath: writeExistingClusterSiteEnv(root),
    substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    ...options,
  });
}

describe('unified deploy existing-cluster smoke producer', () => {
  it('fails closed and writes evidence when kubeconfig is missing', async () => {
    const home = tempDir('existing-cluster-home-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const runner: ExistingClusterCommandRunner = async () => {
      throw new Error('kubectl must not be called without kubeconfig');
    };

    const result = await runSmoke({
      evidenceDir,
      env: {},
      homeDir: home,
      runner,
      probeRunner: passingProbeRunner,
    });
    const report = readFileSync(result.evidence.paths.report_path, 'utf8');

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'kubeconfig',
        message: expect.stringContaining('existing-cluster smoke requires KUBECONFIG'),
      }),
    ]));
    expect(report).toContain('agentsmith.unified-deploy.existing-cluster-smoke.evidence/v1');
  });

  it('requires the target namespace before applying namespaced app resources', async () => {
    const root = tempDir('existing-cluster-namespace-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: CommandCall[] = [];
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      if (args.join(' ').includes('get namespace agentsmith')) {
        return { exitCode: 1, stdout: '', stderr: 'Error from server (NotFound): namespaces "agentsmith" not found' };
      }
      return createPassingRunner([])(command, args, options);
    };

    const result = await runSmoke({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner,
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'namespace:agentsmith',
        message: expect.stringContaining('must already exist'),
      }),
    ]));
    expect(calls.some((call) => call.args.includes('apply'))).toBe(false);
  });

  it('applies existing-cluster app manifests without cluster-admin preflight, rolls out workloads, and probes ingress ownership', async () => {
    const root = tempDir('existing-cluster-smoke-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: CommandCall[] = [];

    const result = await runSmoke({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });

    const applyCalls = calls.filter((call) => call.args.includes('apply'));
    const rolloutCalls = calls.filter((call) => call.args.includes('rollout'));
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');
    const productJobDeleteIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('delete job agentsmith-product-schema-bootstrap'),
    );
    const schemaJobDeleteIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('delete job afscp-schema-bootstrap'),
    );
    const volumeJobDeleteIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('delete job afscp-volume-bootstrap'),
    );
    const productBootstrapDryRunIndex = calls.indexOf(applyCalls[0] as CommandCall);
    const productBootstrapApplyIndex = calls.indexOf(applyCalls[1] as CommandCall);
    const schemaBootstrapDryRunIndex = calls.indexOf(applyCalls[2] as CommandCall);
    const schemaBootstrapApplyIndex = calls.indexOf(applyCalls[3] as CommandCall);
    const volumeBootstrapDryRunIndex = calls.indexOf(applyCalls[4] as CommandCall);
    const volumeBootstrapApplyIndex = calls.indexOf(applyCalls[5] as CommandCall);
    const productJobPollIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('get job/agentsmith-product-schema-bootstrap -o json'),
    );
    const schemaJobPollIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('get job/afscp-schema-bootstrap -o json'),
    );
    const volumeJobPollIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('get job/afscp-volume-bootstrap -o json'),
    );
    const appDryRunIndex = calls.indexOf(applyCalls[6] as CommandCall);
    const appApplyIndex = calls.indexOf(applyCalls[7] as CommandCall);
    const firstRolloutIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('rollout status deployment/agentsmith-web'),
    );

    expect(result.status).toBe('passed');
    expect(applyCalls).toHaveLength(8);
    expect(productJobDeleteIndex).toBeGreaterThan(-1);
    expect(productBootstrapDryRunIndex).toBeGreaterThan(productJobDeleteIndex);
    expect(applyCalls[0]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[0]?.input).toContain('kind: Job');
    expect(applyCalls[0]?.input).toContain('name: agentsmith-product-schema-bootstrap');
    expect(applyCalls[0]?.input).toContain('packages/api-entry-node/dist/product-schema-bootstrap.js');
    expect(applyCalls[0]?.input).toContain('name: agentsmith-app-config');
    expect(applyCalls[0]?.input).toContain('name: agentsmith-app-secrets');
    expect(applyCalls[0]?.input).toContain('name: substrate-postgresql');
    expect(applyCalls[0]?.input).toContain('DATABASE_URL: postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:5432/sentinel_pg_db');
    expect(applyCalls[0]?.input).toContain('MONGO_URL: mongodb://sentinel_mongo_user:sentinel_mongo_secret@substrate-mongodb:27017/admin');
    expect(applyCalls[0]?.input).toContain('REDIS_URL: redis://:sentinel_redis_secret@substrate-redis:6379/0');
    expect(applyCalls[0]?.input).not.toContain('name: afscp-schema-bootstrap');
    expect(applyCalls[0]?.input).not.toContain('name: afscp-volume-bootstrap');
    expect(applyCalls[0]?.input).not.toContain('name: afscp-runtime-config');
    expect(applyCalls[0]?.input).not.toContain('name: afscp-runtime-secrets');
    expect(applyCalls[0]?.input).not.toContain('kind: PersistentVolume');
    expect(applyCalls[0]?.input).not.toContain('kind: PersistentVolumeClaim');
    expect(applyCalls[0]?.input).not.toContain('kind: Deployment');
    expect(applyCalls[0]?.input).not.toContain('name: agentsmith-api');
    expect(applyCalls[1]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[1]?.input).toContain('name: agentsmith-product-schema-bootstrap');
    expect(applyCalls[1]?.input).not.toContain('name: afscp-schema-bootstrap');
    expect(productJobPollIndex).toBeGreaterThan(productBootstrapApplyIndex);
    expect(schemaJobDeleteIndex).toBeGreaterThan(productJobPollIndex);
    expect(volumeJobDeleteIndex).toBeGreaterThan(schemaJobDeleteIndex);
    expect(schemaBootstrapDryRunIndex).toBeGreaterThan(volumeJobDeleteIndex);
    expect(applyCalls[2]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[2]?.input).toContain('kind: Job');
    expect(applyCalls[2]?.input).toContain('name: afscp-schema-bootstrap');
    expect(applyCalls[2]?.input).not.toContain('name: agentsmith-product-schema-bootstrap');
    expect(applyCalls[2]?.input).not.toContain('name: afscp-volume-bootstrap');
    expect(applyCalls[2]?.input).toContain('name: afscp-runtime-config');
    expect(applyCalls[2]?.input).toContain('name: afscp-runtime-secrets');
    expect(applyCalls[2]?.input).toContain('name: afscp-default-volume-juicefs');
    expect(applyCalls[2]?.input).toContain('kind: PersistentVolume');
    expect(applyCalls[2]?.input).toContain('kind: PersistentVolumeClaim');
    expect(applyCalls[2]?.input).not.toContain('kind: Deployment');
    expect(applyCalls[2]?.input).not.toContain('name: agentsmith-api');
    expect(applyCalls[3]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[3]?.input).not.toContain('name: agentsmith-product-schema-bootstrap');
    expect(applyCalls[3]?.input).not.toContain('name: afscp-volume-bootstrap');
    expect(schemaJobPollIndex).toBeGreaterThan(schemaBootstrapApplyIndex);
    expect(volumeBootstrapDryRunIndex).toBeGreaterThan(schemaJobPollIndex);
    expect(applyCalls[4]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[4]?.input).toContain('kind: Job');
    expect(applyCalls[4]?.input).toContain('name: afscp-volume-bootstrap');
    expect(applyCalls[4]?.input).toContain('/usr/local/bin/afscp-volume-bootstrap');
    expect(applyCalls[4]?.input).not.toContain('name: afscp-schema-bootstrap');
    expect(applyCalls[4]?.input).not.toContain('/usr/local/bin/afscp-migrate');
    expect(applyCalls[4]?.input).not.toContain('kind: Deployment');
    expect(applyCalls[4]?.input).not.toContain('kind: PersistentVolume');
    expect(applyCalls[4]?.input).not.toContain('kind: PersistentVolumeClaim');
    expect(applyCalls[5]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[5]?.input).toContain('name: afscp-volume-bootstrap');
    expect(applyCalls[5]?.input).not.toContain('name: afscp-schema-bootstrap');
    expect(volumeJobPollIndex).toBeGreaterThan(volumeBootstrapApplyIndex);
    expect(appDryRunIndex).toBeGreaterThan(volumeJobPollIndex);
    expect(applyCalls[6]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[6]?.input).toContain('kind: Deployment');
    expect(applyCalls[6]?.input).toContain('name: agentsmith-api');
    expect(applyCalls[6]?.input).toContain('name: INTERNAL_AGENT_IMAGE');
    expect(applyCalls[6]?.input).toContain('value: ghcr.io/mbos/agentsmith-managed-runner:dev');
    expect(applyCalls[6]?.input).not.toContain('name: agentsmith-web-secrets');
    expect(applyCalls[6]?.input).not.toContain('DATABASE_URL: postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:5432/sentinel_pg_db');
    expect(applyCalls[6]?.input).not.toContain('MONGO_URL: mongodb://sentinel_mongo_user:sentinel_mongo_secret@substrate-mongodb:27017/admin');
    expect(applyCalls[6]?.input).not.toContain('REDIS_URL: redis://:sentinel_redis_secret@substrate-redis:6379/0');
    expect(applyCalls[6]?.input).not.toContain('sentinel_minio_secret');
    expect(applyCalls[6]?.input).not.toContain('INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE');
    expect(applyCalls[6]?.input).not.toContain('INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE');
    expect(applyCalls[6]?.input).not.toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT');
    expect(applyCalls[6]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-app-config: sha256:[a-f0-9]{64}/u);
    expect(applyCalls[6]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-app-secrets: sha256:[a-f0-9]{64}/u);
    expect(applyCalls[6]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-llmup-config: sha256:[a-f0-9]{64}/u);
    expect(applyCalls[6]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-asbcp-config: sha256:[a-f0-9]{64}/u);
    expect(applyCalls[6]?.input).not.toContain('name: agentsmith-product-schema-bootstrap');
    expect(applyCalls[6]?.input).not.toContain('name: afscp-schema-bootstrap');
    expect(applyCalls[6]?.input).not.toContain('name: afscp-volume-bootstrap');
    expect(applyCalls[6]?.input).not.toContain('@substrate-postgresql:15432/');
    expect(applyCalls[6]?.input).not.toContain('@substrate-mongodb:27027/');
    expect(applyCalls[6]?.input).not.toContain('@substrate-redis:16379/');
    expect(applyCalls[7]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[7]?.input).not.toContain('name: agentsmith-product-schema-bootstrap');
    expect(applyCalls[7]?.input).not.toContain('name: afscp-schema-bootstrap');
    expect(applyCalls[7]?.input).not.toContain('name: afscp-volume-bootstrap');
    for (const call of applyCalls) {
      expect(call.input).not.toContain('kind: Namespace');
      expect(call.input).not.toContain('kind: ClusterRole');
      expect(call.input).not.toContain('kind: ClusterRoleBinding');
      expect(call.input).not.toContain('persistentvolumes');
      expect(call.input).not.toContain('execution-gateway');
    }
    expect(commandText).not.toContain('local-kind-admin-preflight');
    expect(firstRolloutIndex).toBeGreaterThan(appApplyIndex);
    expect(rolloutCalls.map((call) => call.args.join(' '))).toEqual(expect.arrayContaining([
      expect.stringContaining('rollout status deployment/agentsmith-web'),
      expect.stringContaining('rollout status deployment/agentsmith-api'),
      expect.stringContaining('rollout status deployment/agentsmith-llmup'),
      expect.stringContaining('rollout status deployment/agentsmith-sandbox-control-plane'),
    ]));
    expect(result.evidence.profile).toBe('existing-cluster');
    expect(result.evidence.rendered_config_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.evidence.substrate_truth_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.evidence.manifest_summary.resources).toContain('Job/agentsmith-product-schema-bootstrap');
    expect(result.evidence.manifest_summary.resources).toContain('Deployment/agentsmith-api');
    expect(result.evidence.operations.map((operation) => operation.name)).toEqual(expect.arrayContaining([
      'product-schema-bootstrap-delete-previous',
      'product-schema-bootstrap-dry-run',
      'product-schema-bootstrap-apply',
      'product-schema-bootstrap-wait',
    ]));
    expect(result.evidence.live_api_replica_check).toMatchObject({
      status: 'passed',
      desired_replicas: 1,
      ready_replicas: 1,
    });
    expect(result.evidence.forbidden_resource_check.status).toBe('passed');
    expect(result.evidence.llmup_config_health.status).toBe('passed');
    expect(result.evidence.route_probes.map((probe) => probe.status)).toEqual(['passed', 'passed', 'passed', 'passed']);
  });

  it('fails fast on a failed product schema bootstrap Job before AFSCP and Deployment controllers', async () => {
    const root = tempDir('existing-cluster-product-schema-failed-job-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: CommandCall[] = [];
    const passing = createPassingRunner(calls);
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      const joined = args.join(' ');
      if (joined.includes('get job/agentsmith-product-schema-bootstrap -o json')) {
        calls.push({ command, args, input: options.input ?? '' });
        return jsonResult(failedJob(
          'agentsmith-product-schema-bootstrap',
          'BackoffLimitExceeded',
          'product schema migration exited before completing',
        ));
      }

      return passing(command, args, options);
    };

    const result = await runSmoke({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner,
      probeRunner: passingProbeRunner,
    });
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');

    expect(result.status).toBe('failed');
    expect(commandText).toContain('get job/agentsmith-product-schema-bootstrap -o json');
    expect(commandText).not.toContain('delete job afscp-schema-bootstrap');
    expect(commandText).not.toContain('get job/afscp-schema-bootstrap -o json');
    expect(commandText).not.toContain('rollout status deployment/agentsmith-web');
    expect(calls.some((call) =>
      call.args.includes('apply') && call.input.includes('name: agentsmith-api'),
    )).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'product-schema-bootstrap:wait',
        message: expect.stringContaining('BackoffLimitExceeded'),
      }),
    ]));
  });

  it('fails fast on a failed AFSCP bootstrap Job before applying Deployment controllers', async () => {
    const root = tempDir('existing-cluster-afscp-failed-job-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: CommandCall[] = [];
    const passing = createPassingRunner(calls);
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      const joined = args.join(' ');
      if (joined.includes('get job/afscp-schema-bootstrap -o json')) {
        calls.push({ command, args, input: options.input ?? '' });
        return jsonResult(failedJob(
          'afscp-schema-bootstrap',
          'BackoffLimitExceeded',
          'schema migration exited before completing',
        ));
      }

      return passing(command, args, options);
    };

    const result = await runSmoke({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner,
      probeRunner: passingProbeRunner,
    });
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');

    expect(result.status).toBe('failed');
    expect(commandText).toContain('get job/afscp-schema-bootstrap -o json');
    expect(commandText).not.toContain('rollout status deployment/agentsmith-web');
    expect(calls.some((call) =>
      call.args.includes('apply') && call.input.includes('name: agentsmith-api'),
    )).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'afscp-schema-bootstrap:wait',
        message: expect.stringContaining('BackoffLimitExceeded'),
      }),
    ]));
  });

  it('uses an optional bearer token for the profile smoke instead of accepting route smoke as login proof', async () => {
    const root = tempDir('existing-cluster-auth-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const profileHeaders: Record<string, string>[] = [];
    const probeRunner: ExistingClusterHttpProbeRunner = async (url, options) => {
      if (url.includes('/api/v1/me/profile')) {
        profileHeaders.push(options.headers ?? {});
      }
      return passingProbeRunner(url, options);
    };

    const result = await runSmoke({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath, AGENTSMITH_EXISTING_CLUSTER_SMOKE_TOKEN: 'profile-token' },
      homeDir: root,
      runner: createPassingRunner([]),
      probeRunner,
    });

    expect(result.status).toBe('passed');
    expect(profileHeaders[0]?.Authorization).toBe('Bearer profile-token');
    expect(result.evidence.route_probes.find((probe) => probe.name === 'api-profile')?.expected).toContain('authenticated');
    expect(result.evidence.product_verification_matrix.login_profile.status).toBe('not_claimed');
  });

  it('passes route probes when public workspaces returns an empty directory', async () => {
    const root = tempDir('existing-cluster-public-workspaces-empty-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);

    const result = await runSmoke({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner: createPassingRunner([]),
      probeRunner: async (url, options) => {
        if (url.includes('/api/public/workspaces')) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: '{"items":[]}',
            request_headers: options.headers ?? {},
          };
        }
        return passingProbeRunner(url, options);
      },
    });

    expect(result.status).toBe('passed');
    expect(result.failures).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'probe:web-public-workspaces',
      }),
    ]));
  });

  it.each([
    ['non-object payload', '[]'],
    ['missing items array', '{}'],
    ['item without string id', '{"items":[{"name":"Alpha"}]}'],
    ['item with non-string id', '{"items":[{"id":123}]}'],
  ])('fails route probes when public workspaces returns %s', async (_caseName, body) => {
    const root = tempDir('existing-cluster-public-workspaces-shape-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);

    const result = await runSmoke({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner: createPassingRunner([]),
      probeRunner: async (url, options) => {
        if (url.includes('/api/public/workspaces')) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body,
            request_headers: options.headers ?? {},
          };
        }
        return passingProbeRunner(url, options);
      },
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'probe:web-public-workspaces',
        message: expect.stringContaining('JSON shape'),
      }),
    ]));
  });

  it('passes forbidden autoscaler drift check when the target cluster has no KEDA API resources', async () => {
    const root = tempDir('existing-cluster-no-keda-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: CommandCall[] = [];
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      if (args.join(' ').includes('get scaledobjects.keda.sh') || args.join(' ').includes('get scaledjobs.keda.sh')) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'error: the server doesn\'t have a resource type "scaledobjects"',
        };
      }
      return createPassingRunner([])(command, args, options);
    };

    const result = await runSmoke({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner,
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('passed');
    expect(result.failures).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'live:keda-autoscalers' }),
    ]));
    expect(result.evidence.forbidden_resource_check.keda_api).toMatchObject({
      status: 'no-api',
      checked: false,
    });
  });

  it('fails forbidden autoscaler drift check when a live KEDA resource targets api', async () => {
    const root = tempDir('existing-cluster-keda-drift-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      const joined = args.join(' ');
      if (joined.includes('get scaledobjects.keda.sh')) {
        return jsonResult({
          kind: 'List',
          items: [
            {
              kind: 'ScaledObject',
              metadata: { name: 'api-autoscaler' },
              spec: { scaleTargetRef: { name: 'agentsmith-api' } },
            },
          ],
        });
      }
      if (joined.includes('get scaledjobs.keda.sh')) {
        return jsonResult({ kind: 'List', items: [] });
      }
      return createPassingRunner([])(command, args, options);
    };

    const result = await runSmoke({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner,
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.evidence.forbidden_resource_check.keda_api).toMatchObject({
      status: 'checked',
      checked: true,
    });
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'live:ScaledObject/api-autoscaler',
        message: 'autoscaler must not target api',
      }),
    ]));
  });

  it('fails when ingress route ownership exposes llmup or ASBCP', async () => {
    const root = tempDir('existing-cluster-ingress-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: CommandCall[] = [];
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      const result = await createPassingRunner(calls)(command, args, options);
      if (args.join(' ').includes('get ingress agentsmith')) {
        return jsonResult({
          kind: 'Ingress',
          metadata: { name: 'agentsmith' },
          spec: {
            rules: [
              {
                http: {
                  paths: [
                    { path: '/api/v1', backend: { service: { name: 'agentsmith-api' } } },
                    { path: '/llmup', backend: { service: { name: 'agentsmith-llmup' } } },
                    { path: '/asbcp', backend: { service: { name: 'agentsmith-sandbox-control-plane' } } },
                  ],
                },
              },
            ],
          },
        });
      }

      return result;
    };

    const result = await runSmoke({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner,
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'probe:ingress-routes',
        message: expect.stringContaining('/api/public must route to agentsmith-web'),
      }),
      expect.objectContaining({
        path: 'probe:internal-services-not-exposed',
        message: expect.stringContaining('agentsmith-llmup'),
      }),
    ]));
  });

  it('redacts individual tokens from the composite AFSCP service token secret in diagnostics', async () => {
    const root = tempDir('existing-cluster-redaction-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: CommandCall[] = [];
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      const result = await createPassingRunner(calls)(command, args, options);
      if (args.join(' ').includes('apply --dry-run=server')) {
        return {
          exitCode: 1,
          stdout: 'server echoed agentsmith_dev_afscp_product_token',
          stderr: 'validation echoed agentsmith_dev_afscp_bootstrap_token and agentsmith_dev_afscp_orchestrator_token',
        };
      }

      return result;
    };

    const result = await runSmoke({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner,
      probeRunner: passingProbeRunner,
    });
    const report = readFileSync(result.evidence.paths.report_path, 'utf8');

    expect(result.status).toBe('failed');
    expect(report).not.toContain('agentsmith_dev_afscp_product_token');
    expect(report).not.toContain('agentsmith_dev_afscp_bootstrap_token');
    expect(report).not.toContain('agentsmith_dev_afscp_orchestrator_token');
    expect(report).toContain('[REDACTED]');
  });
});
