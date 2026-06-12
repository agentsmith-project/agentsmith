import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  runExistingClusterPreApplyPreflight,
  runExistingClusterSmokeProducer,
  type ExistingClusterCommandRunner,
  type ExistingClusterHttpProbeRunner,
  type ExistingClusterSmokeProducerOptions,
} from './check-existing-cluster-smoke';
import { DEFAULT_SITE_ENV_PATH, renderUnifiedDeployFromFiles } from './render';
import {
  LEGACY_ASBCP_CHECKSUM_FRAGMENT,
  LEGACY_ASBCP_CONFIGMAP_NAME,
  LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS,
} from './asbcp-legacy-residue-negative-evidence';

const tempRoots: string[] = [];
const fixturesDir = join(process.cwd(), 'scripts', 'unified-deploy', '__fixtures__');
const asbcpImageLockPath = join(process.cwd(), 'infra', 'deploy', 'shared', 'asbcp-image.lock');

type CommandCall = {
  command: string;
  args: string[];
  input: string;
};

const ASBCP_SOURCE_REF = readAsbcpLockSourceRef();
const ASBCP_DIGEST = readAsbcpLockDigest();
const OLD_ASBCP_DIGEST = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function readAsbcpLockSourceRef(): string {
  const match = /^asbcp_source_image=(.+)$/mu.exec(readFileSync(asbcpImageLockPath, 'utf8'));
  if (!match?.[1]) {
    throw new Error('asbcp-image.lock must include asbcp_source_image');
  }
  return match[1];
}

function readAsbcpLockDigest(): string {
  const match = /@(sha256:[a-f0-9]{64})$/u.exec(ASBCP_SOURCE_REF);
  if (!match?.[1]) {
    throw new Error('asbcp-image.lock ASBCP source image must be pinned by sha256 digest');
  }
  return match[1];
}

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

function writeExistingClusterSiteEnv(root: string, asbcpImage: string = ASBCP_SOURCE_REF): string {
  const siteEnvPath = join(root, 'site.env');
  writeFileSync(
    siteEnvPath,
    readFileSync(DEFAULT_SITE_ENV_PATH, 'utf8')
      .replace(/^UNIFIED_DEPLOY_PROFILE=.*$/mu, 'UNIFIED_DEPLOY_PROFILE=existing-cluster')
      .replace(/^PUBLIC_BASE_URL=.*$/mu, 'PUBLIC_BASE_URL=https://agentsmith.example.test')
      .replace(/^PUBLIC_API_BASE_URL=.*$/mu, 'PUBLIC_API_BASE_URL=https://agentsmith.example.test/api/v1')
      .replace(/^RUNNER_PUBLIC_API_BASE_URL=.*$/mu, 'RUNNER_PUBLIC_API_BASE_URL=wss://agentsmith.example.test/api/v1')
      .replace(/^ASBCP_IMAGE=.*$/mu, `ASBCP_IMAGE=${asbcpImage}`),
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

    if (joined.includes('get secret agentsmith-app-secrets') || joined.includes('get secret custom-app-secrets')) {
      return {
        exitCode: 0,
        stdout: [
          'DATABASE_URL',
          'MONGO_URL',
          'MONGO_DB_NAME',
          'REDIS_URL',
          'MINIO_ACCESS_KEY',
          'MINIO_SECRET_KEY',
          'AFSCP_SERVICE_TOKEN',
          'AFSCP_BOOTSTRAP_SERVICE_TOKEN',
          'AFSCP_ORCHESTRATOR_SERVICE_TOKEN',
          'KEYCLOAK_ADMIN',
          'KEYCLOAK_ADMIN_PASSWORD',
          'ASBCP_SERVICE_KEY',
          'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN',
        ].join('\n'),
        stderr: '',
      };
    }
    if (joined.includes('get secret afscp-runtime-secrets') || joined.includes('get secret custom-afscp-runtime-secrets')) {
      return {
        exitCode: 0,
        stdout: [
          'AFSCP_DATABASE_URL',
          'AFSCP_POSTGRES_DSN',
          'AFSCP_API_POSTGRES_DSN',
          'AFSCP_EXPORT_GATEWAY_POSTGRES_DSN',
          'AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN',
          'AFSCP_API_SERVICE_TOKENS',
        ].join('\n'),
        stderr: '',
      };
    }
    if (joined.includes('get secret afscp-default-volume-juicefs') || joined.includes('get secret custom-afscp-volume-juicefs')) {
      return {
        exitCode: 0,
        stdout: ['name', 'metaurl', 'storage', 'bucket', 'access-key', 'secret-key'].join('\n'),
        stderr: '',
      };
    }
    if (joined.includes('auth can-i')) {
      return { exitCode: 0, stdout: 'yes\n', stderr: '' };
    }
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
    if (joined.includes('get pods -l app.kubernetes.io/name=agentsmith,app.kubernetes.io/component=asbcp -o json')) {
      return jsonResult({
        kind: 'PodList',
        items: [
          {
            kind: 'Pod',
            metadata: { name: 'agentsmith-sandbox-control-plane-test-pod' },
            status: {
              phase: 'Running',
              containerStatuses: [
                {
                  name: 'asbcp',
                  image: ASBCP_SOURCE_REF,
                  imageID: `docker-pullable://${ASBCP_SOURCE_REF}`,
                  ready: true,
                },
              ],
            },
          },
        ],
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
    if (joined.includes('get deployment,service,configmap,serviceaccount,role,rolebinding')) {
      return jsonResult({ kind: 'List', items: [] });
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
  it('fails ASBCP pre-apply RBAC preflight before apply and redacts operator diagnostics', async () => {
    const root = tempDir('existing-cluster-preflight-rbac-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeExistingClusterSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      if (args.join(' ').includes('auth can-i get persistentvolumes')) {
        return {
          exitCode: 1,
          stdout: 'no\n',
          stderr: 'Forbidden: sentinel_pg_secret sentinel_minio_secret cannot get persistentvolumes',
        };
      }
      return createPassingRunner([])(command, args, options);
    };

    const result = await runSmoke({
      siteEnvPath,
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner,
      probeRunner: passingProbeRunner,
    });
    const report = readFileSync(result.evidence.paths.report_path, 'utf8');

    expect(result.status).toBe('failed');
    expect(calls.some((call) => call.args.includes('apply'))).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'preflight:rbac:asbcp:persistentvolumes:get',
        message: expect.stringContaining('operator preflight'),
      }),
    ]));
    expect(result.evidence.pre_apply_preflight.status).toBe('failed');
    expect(report).toContain('[REDACTED]');
    expect(report).not.toContain('sentinel_pg_secret');
    expect(report).not.toContain('sentinel_minio_secret');
  });

  it('checks ASBCP Secret projection, AFSCP caller role, and public ingress before apply', async () => {
    const root = tempDir('existing-cluster-preflight-static-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeExistingClusterSiteEnv(root);
    const rendered = await renderUnifiedDeployFromFiles({
      profile: 'existing-cluster',
      siteEnvPath,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const runner = createPassingRunner([]);

    const missingProjection = await runExistingClusterPreApplyPreflight({
      appYaml: rendered.output.replace(
        /\n            - name: ASBCP_AFSCP_ORCHESTRATOR_TOKEN\n              valueFrom:\n                secretKeyRef:\n                  name: agentsmith-app-secrets\n                  key: AFSCP_ORCHESTRATOR_SERVICE_TOKEN/u,
        '',
      ),
      namespace: 'agentsmith',
      kubeconfigPath,
      runner,
      env: {},
      secretValues: [],
    });
    const missingRole = await runExistingClusterPreApplyPreflight({
      appYaml: rendered.output.replace(
        'agentsmith-sandbox-control-plane:orchestrator:orchestrator_mount',
        'agentsmith-sandbox-control-plane:orchestrator:operation_inspector',
      ),
      namespace: 'agentsmith',
      kubeconfigPath,
      runner,
      env: {},
      secretValues: [],
    });
    const publicAsbcpIngress = await runExistingClusterPreApplyPreflight({
      appYaml: rendered.output.replace(
        '          - path: /api/v1\n',
        [
          '          - path: /asbcp',
          '            pathType: Prefix',
          '            backend:',
          '              service:',
          '                name: agentsmith-sandbox-control-plane',
          '                port:',
          '                  number: 8080',
          '          - path: /api/v1',
          '',
        ].join('\n'),
      ),
      namespace: 'agentsmith',
      kubeconfigPath,
      runner,
      env: {},
      secretValues: [],
    });

    expect(missingProjection.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'preflight:Deployment/agentsmith-sandbox-control-plane:ASBCP_AFSCP_ORCHESTRATOR_TOKEN',
        message: expect.stringContaining('agentsmith-app-secrets/AFSCP_ORCHESTRATOR_SERVICE_TOKEN'),
      }),
    ]));
    expect(missingRole.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'preflight:ConfigMap/afscp-runtime-config:allowed-callers',
        message: expect.stringContaining('orchestrator_mount'),
      }),
    ]));
    expect(publicAsbcpIngress.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'preflight:Ingress/agentsmith:no-public-ingress',
        message: expect.stringContaining('ASBCP'),
      }),
    ]));
  });

  it('fails before apply when an expected existing Secret key is missing', async () => {
    const root = tempDir('existing-cluster-missing-secret-key-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: CommandCall[] = [];
    const passing = createPassingRunner(calls);
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      if (args.join(' ').includes('get secret afscp-runtime-secrets')) {
        calls.push({ command, args, input: options.input ?? '' });
        return {
          exitCode: 0,
          stdout: [
            'AFSCP_DATABASE_URL',
            'AFSCP_POSTGRES_DSN',
            'AFSCP_API_POSTGRES_DSN',
            'AFSCP_EXPORT_GATEWAY_POSTGRES_DSN',
            'AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN',
          ].join('\n'),
          stderr: '',
        };
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
    const report = readFileSync(result.evidence.paths.report_path, 'utf8');

    expect(result.status).toBe('failed');
    expect(calls.some((call) => call.args.includes('apply'))).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'preflight:Secret/afscp-runtime-secrets',
        message: expect.stringContaining('AFSCP_API_SERVICE_TOKENS'),
      }),
    ]));
    expect(report).not.toContain('sentinel_pg_secret');
    expect(report).not.toContain('sentinel_minio_secret');
  });

  it('checks custom existing Secret refs before apply and reports LLMUP health with the custom app ref', async () => {
    const root = tempDir('existing-cluster-custom-secret-refs-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeExistingClusterSiteEnv(root);
    writeFileSync(
      siteEnvPath,
      readFileSync(siteEnvPath, 'utf8')
        .replace(/^AGENTSMITH_APP_REF=.*$/mu, 'AGENTSMITH_APP_REF=custom-app-secrets')
        .replace(/^AFSCP_RUNTIME_REF=.*$/mu, 'AFSCP_RUNTIME_REF=custom-afscp-runtime-secrets')
        .replace(/^AFSCP_VOLUME_REF=.*$/mu, 'AFSCP_VOLUME_REF=custom-afscp-volume-juicefs'),
      'utf8',
    );
    const calls: CommandCall[] = [];

    const result = await runSmoke({
      siteEnvPath,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });

    expect(result.status, JSON.stringify(result.failures, null, 2)).toBe('passed');
    expect(calls.some((call) => call.args.join(' ').includes('get secret custom-app-secrets'))).toBe(true);
    expect(calls.some((call) => call.args.join(' ').includes('get secret custom-afscp-runtime-secrets'))).toBe(true);
    expect(calls.some((call) => call.args.join(' ').includes('get secret custom-afscp-volume-juicefs'))).toBe(true);
    expect(result.evidence.llmup_config_health.admin_token_secret).toBe('custom-app-secrets/MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
  });

  it('does not live-check namespace RBAC that the app manifest creates for a fresh namespace', async () => {
    const root = tempDir('existing-cluster-preflight-fresh-namespace-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeExistingClusterSiteEnv(root);
    const rendered = await renderUnifiedDeployFromFiles({
      profile: 'existing-cluster',
      siteEnvPath,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const calls: CommandCall[] = [];
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (joined.includes('auth can-i') && joined.includes('-n agentsmith')) {
        return {
          exitCode: 1,
          stdout: 'no\n',
          stderr: 'namespace Role is not present until app apply',
        };
      }
      if (joined.includes('auth can-i')) {
        return { exitCode: 0, stdout: 'yes\n', stderr: '' };
      }
      return createPassingRunner([])(command, args, options);
    };

    const result = await runExistingClusterPreApplyPreflight({
      appYaml: rendered.output,
      namespace: 'agentsmith',
      kubeconfigPath,
      runner,
      env: {},
      secretValues: [],
    });

    expect(result.failures).toEqual([]);
    expect(calls.filter((call) => call.args.includes('can-i')).map((call) => call.args.join(' ')))
      .not.toEqual(expect.arrayContaining([expect.stringContaining('-n agentsmith')]));
  });

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

  it('fails static validation before apply when existing-cluster render uses a local-kind ASBCP image', async () => {
    const root = tempDir('existing-cluster-local-kind-image-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: CommandCall[] = [];

    const result = await runSmoke({
      siteEnvPath: writeExistingClusterSiteEnv(
        root,
        `kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`,
      ),
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'static:Deployment/agentsmith-sandbox-control-plane',
        message: 'ASBCP local-kind registry image is only allowed for local-kind renders',
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
    expect(applyCalls[0]?.input).toContain('secretKeyRef:');
    expect(applyCalls[0]?.input).toContain('key: DATABASE_URL');
    expect(applyCalls[0]?.input).not.toContain('DATABASE_URL: postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:5432/sentinel_pg_db');
    expect(applyCalls[0]?.input).not.toContain('MONGO_URL: mongodb://sentinel_mongo_user:sentinel_mongo_secret@substrate-mongodb:27017/admin');
    expect(applyCalls[0]?.input).not.toContain('REDIS_URL: redis://:sentinel_redis_secret@substrate-redis:6379/0');
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
    expect(applyCalls[2]?.input).not.toMatch(/kind:\s*Secret[\s\S]*?\n(?:data|stringData|binaryData):/u);
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
    expect(applyCalls[4]?.input).toMatch(
      /name: afscp-volume-bootstrap[\s\S]*?initContainers:\s*\n\s*- name: afscp-schema-bootstrap[\s\S]*?command:\s*\n\s*- \/usr\/local\/bin\/afscp-migrate[\s\S]*?- --apply[\s\S]*?- --check[\s\S]*?containers:\s*\n\s*- name: afscp-volume-bootstrap[\s\S]*?command:\s*\n\s*- \/usr\/local\/bin\/afscp-volume-bootstrap/u,
    );
    expect(applyCalls[4]?.input).not.toContain('kind: Deployment');
    expect(applyCalls[4]?.input).not.toContain('kind: PersistentVolume');
    expect(applyCalls[4]?.input).not.toContain('kind: PersistentVolumeClaim');
    expect(applyCalls[5]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[5]?.input).toContain('name: afscp-volume-bootstrap');
    expect(applyCalls[5]?.input).toContain('name: afscp-schema-bootstrap');
    expect(volumeJobPollIndex).toBeGreaterThan(volumeBootstrapApplyIndex);
    expect(appDryRunIndex).toBeGreaterThan(volumeJobPollIndex);
    expect(applyCalls[6]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[6]?.input).toContain('kind: Deployment');
    expect(applyCalls[6]?.input).toContain('name: agentsmith-api');
    expect(applyCalls[6]?.input).toContain('name: INTERNAL_AGENT_IMAGE');
    expect(applyCalls[6]?.input).toContain(
      'value: ghcr.io/mbos/agentsmith-managed-runner@sha256:0000000000000000000000000000000000000000000000000000000000000000',
    );
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
    expect(result.evidence.asbcp_image_adoption).toMatchObject({
      status: 'passed',
      source_ref: ASBCP_SOURCE_REF,
      source_digest: ASBCP_DIGEST,
      target_digest: ASBCP_DIGEST,
      site_env_ref: ASBCP_SOURCE_REF,
      rendered_ref: ASBCP_SOURCE_REF,
      running_image_ids: [`docker-pullable://${ASBCP_SOURCE_REF}`],
    });
    expect(result.evidence.stale_resource_absence_check).toMatchObject({
      status: 'passed',
      scope: 'absence_only',
      absent: expect.arrayContaining([
        LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS[0],
        LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS[1],
        LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS[2],
        LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS[4],
        LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS[5],
      ]),
    });
    expect(result.evidence.llmup_config_health.status).toBe('passed');
    expect(result.evidence.route_probes.map((probe) => probe.status)).toEqual(['passed', 'passed', 'passed', 'passed']);
  });

  it('fails ASBCP image adoption when running Pods are mixed old and target digests', async () => {
    const root = tempDir('existing-cluster-mixed-asbcp-image-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      const joined = args.join(' ');
      if (joined.includes('get pods -l app.kubernetes.io/name=agentsmith,app.kubernetes.io/component=asbcp -o json')) {
        return jsonResult({
          kind: 'PodList',
          items: [
            {
              kind: 'Pod',
              metadata: { name: 'agentsmith-sandbox-control-plane-new' },
              status: {
                phase: 'Running',
                containerStatuses: [
                  {
                    name: 'asbcp',
                    imageID: `docker-pullable://${ASBCP_SOURCE_REF}`,
                  },
                ],
              },
            },
            {
              kind: 'Pod',
              metadata: { name: 'agentsmith-sandbox-control-plane-old' },
              status: {
                phase: 'Running',
                containerStatuses: [
                  {
                    name: 'asbcp',
                    imageID: `docker-pullable://ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v0.9.0@${OLD_ASBCP_DIGEST}`,
                  },
                ],
              },
            },
          ],
        });
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
        path: 'live:Pod/agentsmith-sandbox-control-plane:imageID',
        message: expect.stringContaining('all running ASBCP Pod imageID digests must match target digest'),
      }),
    ]));
    expect(result.evidence.asbcp_image_adoption).toMatchObject({
      status: 'failed',
      target_digest: ASBCP_DIGEST,
      running_image_ids: expect.arrayContaining([
        `docker-pullable://${ASBCP_SOURCE_REF}`,
        `docker-pullable://ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v0.9.0@${OLD_ASBCP_DIGEST}`,
      ]),
    });
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

  it('fails stale legacy ASBCP absence-only check when old resources are present', async () => {
    const root = tempDir('existing-cluster-stale-legacy-asbcp-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      const joined = args.join(' ');
      if (joined.includes('get deployment,service,configmap,serviceaccount,role,rolebinding')) {
        return jsonResult({
          kind: 'List',
          items: [
            {
              kind: 'ConfigMap',
              metadata: {
                name: LEGACY_ASBCP_CONFIGMAP_NAME,
                annotations: {
                  [`agentsmith.mbos.dev/${LEGACY_ASBCP_CHECKSUM_FRAGMENT}-config`]: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                },
              },
            },
          ],
        });
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
        path: `live:ConfigMap/${LEGACY_ASBCP_CONFIGMAP_NAME}`,
        message: expect.stringContaining('absence-only'),
      }),
    ]));
    expect(result.evidence.stale_resource_absence_check).toMatchObject({
      status: 'failed',
      scope: 'absence_only',
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

  it('redacts input secret values from kubectl diagnostics in evidence', async () => {
    const root = tempDir('existing-cluster-redaction-');
    const evidenceDir = tempDir('existing-cluster-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: CommandCall[] = [];
    const runner: ExistingClusterCommandRunner = async (command, args, options = {}) => {
      const result = await createPassingRunner(calls)(command, args, options);
      if (args.join(' ').includes('apply --dry-run=server')) {
        return {
          exitCode: 1,
          stdout: 'server echoed sentinel_pg_secret and sentinel_minio_secret',
          stderr: 'validation echoed sentinel_mongo_secret and sentinel_redis_secret',
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
    expect(report).not.toContain('sentinel_pg_secret');
    expect(report).not.toContain('sentinel_minio_secret');
    expect(report).not.toContain('sentinel_mongo_secret');
    expect(report).not.toContain('sentinel_redis_secret');
    expect(report).toContain('[REDACTED]');
  });
});
