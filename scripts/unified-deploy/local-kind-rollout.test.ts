import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  runLocalKindRolloutProducer as runLocalKindRolloutProducerImpl,
  type LocalKindRolloutProducerOptions,
  type LocalKindCommandRunner,
  type LocalKindHttpProbeRunner,
} from './check-local-kind-rollout';
import { DEFAULT_SITE_ENV_PATH } from './render';

const tempRoots: string[] = [];
const fixturesDir = join(process.cwd(), 'scripts', 'unified-deploy', '__fixtures__');

type CommandCall = {
  command: string;
  args: string[];
  input: string;
};

const APP_DIGEST = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SANDBOX_DIGEST = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const LLMUP_DIGEST = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const INGRESS_CONTROLLER_DIGEST = 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const INGRESS_CERTGEN_DIGEST = 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const MANAGED_RUNNER_DIGEST = 'sha256:9999999999999999999999999999999999999999999999999999999999999999';
const AFSCP_DIGEST = 'sha256:abababababababababababababababababababababababababababababababab';

function dockerInspectContainer(options: {
  id: string;
  name: string;
  project: string;
  service: string;
  image?: string;
  ports: Record<string, string | string[]>;
}): Record<string, unknown> {
  return {
    Id: options.id,
    Name: `/${options.name}`,
    Config: {
      Image: options.image ?? `${options.service}:test`,
      Labels: {
        'com.docker.compose.project': options.project,
        'com.docker.compose.service': options.service,
      },
    },
    State: {
      Status: 'running',
      Running: true,
    },
    NetworkSettings: {
      Ports: Object.fromEntries(
        Object.entries(options.ports).map(([containerPort, hostPorts]) => [
          `${containerPort}/tcp`,
          (Array.isArray(hostPorts) ? hostPorts : [hostPorts]).flatMap((hostPort) => [
            { HostIp: '0.0.0.0', HostPort: hostPort },
            { HostIp: '::', HostPort: hostPort },
          ]),
        ]),
      ),
    },
  };
}

const healthyRuntimeContainers = [
  dockerInspectContainer({
    id: 'postgresql',
    name: 'agentsmith-unified-substrate-postgresql-1',
    project: 'agentsmith-unified-substrate',
    service: 'postgresql',
    ports: { '5432': '15432' },
  }),
  dockerInspectContainer({
    id: 'mongodb',
    name: 'agentsmith-unified-substrate-mongodb-1',
    project: 'agentsmith-unified-substrate',
    service: 'mongodb',
    ports: { '27017': '27027' },
  }),
  dockerInspectContainer({
    id: 'redis',
    name: 'agentsmith-unified-substrate-redis-1',
    project: 'agentsmith-unified-substrate',
    service: 'redis',
    ports: { '6379': '16379' },
  }),
  dockerInspectContainer({
    id: 'minio',
    name: 'agentsmith-unified-substrate-minio-1',
    project: 'agentsmith-unified-substrate',
    service: 'minio',
    ports: { '9000': ['19000', '19100'] },
  }),
  dockerInspectContainer({
    id: 'keycloak',
    name: 'agentsmith-unified-substrate-keycloak-1',
    project: 'agentsmith-unified-substrate',
    service: 'keycloak',
    ports: { '8080': ['18080', '18081'] },
  }),
];

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

function writeSiteEnv(root: string, mutate: (source: string) => string): string {
  const siteEnvPath = join(root, 'site.env');
  writeFileSync(siteEnvPath, mutate(readFileSync(DEFAULT_SITE_ENV_PATH, 'utf8')), 'utf8');
  return siteEnvPath;
}

function writeActualSubstrateTruth(root: string, host = '172.19.0.1'): string {
  const truthPath = join(root, 'connection.env');
  const source = readFileSync(join(fixturesDir, 'substrate-truth.valid.env'), 'utf8')
    .replace(/^SUBSTRATE_POSTGRES_HOST=.*$/mu, `SUBSTRATE_POSTGRES_HOST=${host}`)
    .replace(/^SUBSTRATE_POSTGRES_PORT=.*$/mu, 'SUBSTRATE_POSTGRES_PORT=15432')
    .replace(/^SUBSTRATE_MONGODB_HOST=.*$/mu, `SUBSTRATE_MONGODB_HOST=${host}`)
    .replace(/^SUBSTRATE_MONGODB_PORT=.*$/mu, 'SUBSTRATE_MONGODB_PORT=27027')
    .replace(/^SUBSTRATE_REDIS_HOST=.*$/mu, `SUBSTRATE_REDIS_HOST=${host}`)
    .replace(/^SUBSTRATE_REDIS_PORT=.*$/mu, 'SUBSTRATE_REDIS_PORT=16379')
    .replace(/^SUBSTRATE_MINIO_HOST=.*$/mu, `SUBSTRATE_MINIO_HOST=${host}`)
    .replace(/^SUBSTRATE_MINIO_PORT=.*$/mu, 'SUBSTRATE_MINIO_PORT=19000')
    .replace(/^SUBSTRATE_KEYCLOAK_HOST=.*$/mu, `SUBSTRATE_KEYCLOAK_HOST=${host}`)
    .replace(/^SUBSTRATE_KEYCLOAK_PORT=.*$/mu, 'SUBSTRATE_KEYCLOAK_PORT=18080')
    .replace(/^SUBSTRATE_KEYCLOAK_PUBLIC_ISSUER=.*$/mu, 'SUBSTRATE_KEYCLOAK_PUBLIC_ISSUER=http://localhost:18080/realms/agentsmith')
    .replace(/^SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL=.*$/mu, 'SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL=http://substrate-keycloak:8080');
  writeFileSync(truthPath, source, 'utf8');
  return truthPath;
}

async function runLocalKindRolloutProducer(
  options: LocalKindRolloutProducerOptions = {},
): ReturnType<typeof runLocalKindRolloutProducerImpl> {
  if (!options.substrateTruthPath && !options.localKindSubstrateTruthPath) {
    const root = tempDir('local-kind-actual-substrate-truth-');
    return runLocalKindRolloutProducerImpl({
      ...options,
      localKindSubstrateTruthPath: writeActualSubstrateTruth(root),
    });
  }

  return runLocalKindRolloutProducerImpl(options);
}

function writeLocalKindImageSiteEnv(root: string, mutate: (source: string) => string = (source) => source): string {
  return writeSiteEnv(root, (source) => mutate(source
    .replace(/^PUBLIC_BASE_URL=.*$/mu, 'PUBLIC_BASE_URL=http://agentsmith.localtest.me:29180')
    .replace(/^PUBLIC_API_BASE_URL=.*$/mu, 'PUBLIC_API_BASE_URL=http://agentsmith.localtest.me:29180/api/v1')
    .replace(/^RUNNER_PUBLIC_API_BASE_URL=.*$/mu, 'RUNNER_PUBLIC_API_BASE_URL=ws://agentsmith.localtest.me:29180/api/v1')
    .replace(/^WEB_IMAGE=.*$/mu, `WEB_IMAGE=kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`)
    .replace(/^API_IMAGE=.*$/mu, `API_IMAGE=kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`)
    .replace(/^LLMUP_IMAGE=.*$/mu, `LLMUP_IMAGE=kind-registry:5000/mbos/llm-universal-proxy@${LLMUP_DIGEST}`)
    .replace(/^AFSCP_IMAGE=.*$/mu, `AFSCP_IMAGE=kind-registry:5000/mbos/agentsmith-fs-control-plane@${AFSCP_DIGEST}`)
    .replace(/^SANDBOX_MANAGER_IMAGE=.*$/mu, `SANDBOX_MANAGER_IMAGE=kind-registry:5000/mbos/sandbox-manager@${SANDBOX_DIGEST}`)
    .replace(/^MANAGED_RUNNER_IMAGE=.*$/mu, `MANAGED_RUNNER_IMAGE=kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`)
    .replace(/^INGRESS_NGINX_CONTROLLER_IMAGE=.*$/mu, `INGRESS_NGINX_CONTROLLER_IMAGE=kind-registry:5000/mbos/ingress-nginx-controller@${INGRESS_CONTROLLER_DIGEST}`)
    .replace(/^INGRESS_NGINX_CERTGEN_IMAGE=.*$/mu, `INGRESS_NGINX_CERTGEN_IMAGE=kind-registry:5000/mbos/ingress-nginx-kube-webhook-certgen@${INGRESS_CERTGEN_DIGEST}`)));
}

function writeMutableLocalKindImageSiteEnv(root: string): string {
  return writeSiteEnv(root, (source) => source
    .replace(/^WEB_IMAGE=.*$/mu, 'WEB_IMAGE=kind-registry:5000/mbos/agentsmith-app:local-kind-dev')
    .replace(/^API_IMAGE=.*$/mu, 'API_IMAGE=kind-registry:5000/mbos/agentsmith-app:local-kind-dev')
    .replace(/^LLMUP_IMAGE=.*$/mu, 'LLMUP_IMAGE=kind-registry:5000/mbos/llm-universal-proxy:v0.2.27')
    .replace(/^AFSCP_IMAGE=.*$/mu, 'AFSCP_IMAGE=kind-registry:5000/mbos/agentsmith-fs-control-plane:local-kind-dev')
    .replace(/^SANDBOX_MANAGER_IMAGE=.*$/mu, 'SANDBOX_MANAGER_IMAGE=kind-registry:5000/mbos/sandbox-manager:local-kind-dev')
    .replace(/^MANAGED_RUNNER_IMAGE=.*$/mu, 'MANAGED_RUNNER_IMAGE=kind-registry:5000/mbos/agentsmith-managed-runner:local-kind-dev'));
}

function writeTemplatesRootWithInlineAfscpCsi(root: string): string {
  const templatesRoot = join(root, 'unified-templates');
  cpSync(join(process.cwd(), 'infra', 'deploy', 'unified', 'templates'), join(templatesRoot, 'templates'), {
    recursive: true,
  });
  const afscpTemplatePath = join(templatesRoot, 'templates', 'app', 'afscp.yaml.tpl');
  const inlineCsiVolume = [
    'csi:',
    '            driver: csi.juicefs.com',
    '            volumeAttributes:',
    '              subPath: "afscp/{{AFSCP_DEFAULT_VOLUME_ID}}"',
    '            nodePublishSecretRef:',
    '              name: afscp-default-volume-juicefs',
  ].join('\n');
  const source = readFileSync(afscpTemplatePath, 'utf8');
  writeFileSync(
    afscpTemplatePath,
    source.replace(
      [
        'persistentVolumeClaim:',
        '            claimName: afscp-default-volume',
      ].join('\n'),
      inlineCsiVolume,
    ),
    'utf8',
  );
  return templatesRoot;
}

function writeTemplatesRootWithoutAfscpJvsCwd(root: string): string {
  const templatesRoot = join(root, 'unified-templates-missing-jvs-cwd');
  cpSync(join(process.cwd(), 'infra', 'deploy', 'unified', 'templates'), join(templatesRoot, 'templates'), {
    recursive: true,
  });
  const afscpTemplatePath = join(templatesRoot, 'templates', 'app', 'afscp.yaml.tpl');
  const source = readFileSync(afscpTemplatePath, 'utf8');
  writeFileSync(
    afscpTemplatePath,
    source.replace('  AFSCP_JVS_CWD: "{{AFSCP_JVS_CWD_PATH}}"\n', ''),
    'utf8',
  );
  return templatesRoot;
}

function jsonResult(value: unknown): { exitCode: number; stdout: string; stderr: string } {
  return {
    exitCode: 0,
    stdout: JSON.stringify(value),
    stderr: '',
  };
}

function createPassingRunner(calls: CommandCall[], context = 'kind-agentsmith'): LocalKindCommandRunner {
  return async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input ?? '' });
    const joined = args.join(' ');

    if (command === 'docker') {
      if (joined.includes('port agentsmith-control-plane 30080/tcp')) {
        return { exitCode: 0, stdout: '0.0.0.0:29180\n', stderr: '' };
      }
      if (joined === 'ps -q') {
        return {
          exitCode: 0,
          stdout: healthyRuntimeContainers.map((container) => String(container.Id ?? '')).join('\n'),
          stderr: '',
        };
      }
      if (args[0] === 'inspect') {
        return {
          exitCode: 0,
          stdout: JSON.stringify(healthyRuntimeContainers),
          stderr: '',
        };
      }
      if (joined.includes('ps')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }
      if (joined.includes('network inspect kind')) {
        return { exitCode: 0, stdout: 'kind-registry\n', stderr: '' };
      }
      if (joined.includes('manifest inspect') || joined.includes('buildx imagetools inspect')) {
        return { exitCode: 0, stdout: 'Name: local-kind-image\nDigest: sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\n', stderr: '' };
      }

      return { exitCode: 0, stdout: 'docker ok', stderr: '' };
    }
    if (joined.includes('config current-context')) {
      return { exitCode: 0, stdout: `${context}\n`, stderr: '' };
    }
    if (joined.includes('rollout status')) {
      return { exitCode: 0, stdout: 'deployment successfully rolled out', stderr: '' };
    }
    if (joined.includes('get ingressclass nginx')) {
      return jsonResult({
        apiVersion: 'networking.k8s.io/v1',
        kind: 'IngressClass',
        metadata: { name: 'nginx' },
        spec: { controller: 'k8s.io/ingress-nginx' },
      });
    }
    if (joined.includes('get job/ingress-nginx-admission-create') || joined.includes('get job/ingress-nginx-admission-patch')) {
      return { exitCode: 0, stdout: 'job.batch/ingress-nginx-admission ok', stderr: '' };
    }
    if (joined.includes('wait --for=condition=complete job/ingress-nginx-admission-create') || joined.includes('wait --for=condition=complete job/ingress-nginx-admission-patch')) {
      return { exitCode: 0, stdout: 'job completed', stderr: '' };
    }
    if (joined.includes('get deployment agentsmith-api')) {
      return jsonResult({
        apiVersion: 'apps/v1',
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
          {
            kind: 'Deployment',
            metadata: { name: 'agentsmith-api' },
            spec: { replicas: 1 },
          },
          {
            kind: 'Deployment',
            metadata: { name: 'agentsmith-web' },
            spec: { replicas: 1 },
          },
        ],
      });
    }
    if (joined.includes('get scaledobjects.keda.sh,scaledjobs.keda.sh')) {
      return jsonResult({ kind: 'List', items: [] });
    }
    if (joined.includes('get ingress agentsmith')) {
      return jsonResult({
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
      });
    }
    if (joined.includes('get endpointslices')) {
      return jsonResult({ kind: 'EndpointSliceList', items: [] });
    }
    if (joined.includes('get pvc afscp-default-volume') || joined.includes('get pv agentsmith-afscp-default-volume')) {
      return { exitCode: 0, stdout: '', stderr: '' };
    }

    return { exitCode: 0, stdout: 'ok', stderr: '' };
  };
}

const passingProbeRunner: LocalKindHttpProbeRunner = async (url) => {
  if (url.includes('/api/public/workspaces')) {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '[]',
    };
  }
  if (url.includes('/api/v1/me/profile')) {
    return {
      status: 401,
      headers: { 'content-type': 'application/json' },
      body: '{"error":"unauthorized"}',
    };
  }
  if (url.includes('/api/v1/agent-execution/ws')) {
    return {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: '{"error":"missing runner"}',
    };
  }

  return {
    status: 404,
    headers: { 'content-type': 'text/plain' },
    body: 'not found',
  };
};

function ownedAfscpPersistentVolumeClaim(storage = '10Pi'): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name: 'afscp-default-volume',
      namespace: 'agentsmith',
      labels: {
        'app.kubernetes.io/name': 'agentsmith',
        'app.kubernetes.io/component': 'afscp-runtime',
        'app.kubernetes.io/part-of': 'agentsmith-deploy',
      },
      annotations: {
        'rendered-by': 'agentsmith-unified-deploy',
      },
    },
    spec: {
      accessModes: ['ReadWriteMany'],
      resources: {
        requests: {
          storage,
        },
      },
      storageClassName: '',
      volumeMode: 'Filesystem',
      volumeName: 'agentsmith-afscp-default-volume',
    },
    status: {
      capacity: {
        storage,
      },
      phase: 'Bound',
    },
  };
}

function ownedAfscpPersistentVolume(storage = '10Pi'): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolume',
    metadata: {
      name: 'agentsmith-afscp-default-volume',
      labels: {
        'app.kubernetes.io/name': 'agentsmith',
        'app.kubernetes.io/component': 'afscp-runtime',
        'app.kubernetes.io/part-of': 'agentsmith-deploy',
      },
      annotations: {
        'rendered-by': 'agentsmith-unified-deploy',
      },
    },
    spec: {
      accessModes: ['ReadWriteMany'],
      capacity: {
        storage,
      },
      persistentVolumeReclaimPolicy: 'Retain',
      storageClassName: '',
      volumeMode: 'Filesystem',
      claimRef: {
        name: 'afscp-default-volume',
        namespace: 'agentsmith',
      },
    },
    status: {
      phase: 'Bound',
    },
  };
}

describe('unified deploy local-kind live rollout producer', () => {
  it('fails closed and writes evidence when kubeconfig is missing', async () => {
    const home = tempDir('local-kind-home-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const runner: LocalKindCommandRunner = async () => {
      throw new Error('kubectl must not be called without kubeconfig');
    };

    const result = await runLocalKindRolloutProducer({
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
        message: expect.stringContaining('local-kind rollout requires KUBECONFIG'),
      }),
    ]));
    expect(report).toContain('agentsmith.unified-deploy.local-kind-rollout.evidence/v1');
    expect(report).toContain('"status": "failed"');
  });

  it.each(['prod-us-west', 'kind-prod', 'prod-local-kind'])(
    'fails closed on non-agentsmith kube context %s and does not apply manifests',
    async (context) => {
    const root = tempDir('local-kind-context-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner = createPassingRunner(calls, context);

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'safety:kube-context',
        message: expect.stringContaining('kind-agentsmith'),
      }),
    ]));
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('fails closed when site env points at a non-controlled namespace or existing-cluster profile', async () => {
    const root = tempDir('local-kind-namespace-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeSiteEnv(root, (source) =>
      source
        .replace(/^NAMESPACE=.*$/mu, 'NAMESPACE=production')
        .replace(/^UNIFIED_DEPLOY_PROFILE=.*$/mu, 'UNIFIED_DEPLOY_PROFILE=existing-cluster'),
    );
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'safety:namespace',
        message: expect.stringContaining('agentsmith'),
      }),
      expect.objectContaining({
        path: 'safety:profile',
        message: expect.stringContaining('local-kind'),
      }),
    ]));
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('fails closed when the public probe URL is not a local-kind local entrypoint', async () => {
    const root = tempDir('local-kind-probe-url-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root, (source) =>
      source.replace(/^PUBLIC_BASE_URL=.*$/mu, 'PUBLIC_BASE_URL=https://prod.example.com'),
    );
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'safety:probe-url',
        message: expect.stringContaining('local-kind local entrypoint'),
      }),
    ]));
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('fails closed when the local-kind probe URL does not include the mapped host ingress port', async () => {
    const root = tempDir('local-kind-probe-url-port-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root, (source) =>
      source.replace(/^PUBLIC_BASE_URL=.*$/mu, 'PUBLIC_BASE_URL=http://agentsmith.localtest.me'),
    );
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'safety:probe-url',
        message: expect.stringContaining('29180'),
      }),
    ]));
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('fails closed when the kind control-plane does not expose ingress nodePort 30080 on host port 29180', async () => {
    const root = tempDir('local-kind-port-mapping-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      if (command === 'docker' && args.join(' ').includes('port agentsmith-control-plane 30080/tcp')) {
        return { exitCode: 0, stdout: '0.0.0.0:30080\n', stderr: '' };
      }

      return createPassingRunner([])(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'safety:kind-ingress-port',
        message: expect.stringContaining('30080/tcp -> 29180'),
      }),
    ]));
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('defaults to the generated local-kind site env when present and no explicit site env is provided', async () => {
    const root = tempDir('local-kind-generated-site-env-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const generatedSiteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      localKindSiteEnvPath: generatedSiteEnvPath,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });

    expect(result.status).toBe('passed');
    expect(result.evidence.image_refs['agentsmith-api/api']).toBe(`kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(true);
  });

  it('defaults live rollout substrate truth to the actual lifecycle connection env instead of the example', async () => {
    const root = tempDir('local-kind-actual-truth-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const actualTruthPath = writeActualSubstrateTruth(root, '172.19.0.1');
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      localKindSubstrateTruthPath: actualTruthPath,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });
    const appApply = calls.find((call) =>
      call.args.includes('apply') && call.input.includes('name: substrate-mongodb'),
    );

    expect(result.status).toBe('passed');
    expect(appApply?.input).toContain('- "172.19.0.1"');
    expect(appApply?.input).not.toContain('192.0.2.10');
  });

  it('fails fast when the actual local-kind substrate lifecycle truth is missing', async () => {
    const root = tempDir('local-kind-missing-actual-truth-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      localKindSubstrateTruthPath: join(root, 'missing', 'connection.env'),
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'substrate-truth:connection.env',
        message: expect.stringContaining('npm run test:unified-deploy:substrate-lifecycle'),
      }),
    ]));
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('fails before apply when Docker substrate published ports do not match connection truth', async () => {
    const root = tempDir('local-kind-substrate-live-port-drift-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const substrateTruthPath = writeActualSubstrateTruth(root);
    const calls: CommandCall[] = [];
    const driftedContainers = healthyRuntimeContainers.map((container) =>
      container.Id === 'mongodb'
        ? dockerInspectContainer({
          id: 'mongodb',
          name: 'agentsmith-unified-substrate-mongodb-1',
          project: 'agentsmith-unified-substrate',
          service: 'mongodb',
          ports: { '27017': '17017' },
        })
        : container,
    );
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      if (command === 'docker' && args.join(' ') === 'ps -q') {
        return {
          exitCode: 0,
          stdout: driftedContainers.map((container) => String(container.Id ?? '')).join('\n'),
          stderr: '',
        };
      }
      if (command === 'docker' && args[0] === 'inspect') {
        return {
          exitCode: 0,
          stdout: JSON.stringify(driftedContainers),
          stderr: '',
        };
      }

      return createPassingRunner([])(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      substrateTruthPath,
      runner,
      probeRunner: passingProbeRunner,
    });
    const failureText = result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n');

    expect(result.status).toBe('failed');
    expect(result.evidence.substrate_live_check.status).toBe('failed');
    expect(failureText).toContain('npm run test:unified-deploy:substrate-lifecycle');
    expect(failureText).toContain('agentsmith-unified-substrate/mongodb');
    expect(failureText).toContain('27027');
    expect(failureText).toContain('17017');
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('fails with a clear image-prep handoff when the generated local-kind site env is missing', async () => {
    const root = tempDir('local-kind-image-preflight-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      localKindSiteEnvPath: join(root, 'artifacts', 'unified-deploy', 'local-kind-site.env'),
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'image-handoff:site-env',
        message: expect.stringContaining('npm run test:unified-deploy:local-kind:images'),
      }),
    ]));
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('continues rollout preflight when docker exec curl sees proxy 503 but CRI/containerd pull succeeds', async () => {
    const root = tempDir('local-kind-image-curl-diagnostic-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      const joined = args.join(' ');
      if (command === 'docker' && joined.includes('curl')) {
        calls.push({ command, args, input: options.input ?? '' });
        return { exitCode: 22, stdout: '', stderr: 'HTTP/1.1 503 Service Unavailable' };
      }

      return createPassingRunner(calls)(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });

    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');
    expect(result.status).toBe('passed');
    expect(commandText).toContain('docker exec agentsmith-control-plane curl -fsS http://kind-registry:5000/v2/');
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/llm-universal-proxy@${LLMUP_DIGEST}`);
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`);
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(true);
  });

  it('fails before apply when the local-kind handoff still uses mutable tags', async () => {
    const root = tempDir('local-kind-mutable-image-handoff-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeMutableLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'image-preflight:kind-registry:5000/mbos/agentsmith-app:local-kind-dev',
        message: expect.stringContaining('npm run test:unified-deploy:local-kind:images'),
      }),
    ]));
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('fails image preflight before apply when CRI/containerd cannot pull from kind-registry', async () => {
    const root = tempDir('local-kind-image-cri-preflight-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      if (
        command === 'docker'
        && args.includes('exec')
        && args.includes('agentsmith-control-plane')
        && args.join(' ').includes('crictl pull')
      ) {
        calls.push({ command, args, input: options.input ?? '' });
        return { exitCode: 1, stdout: '', stderr: 'rpc error: code = Unknown desc = failed to pull: 503 Service Unavailable' };
      }

      return createPassingRunner(calls)(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: expect.stringContaining('image-preflight'),
        message: expect.stringContaining('proxy/NO_PROXY mismatch'),
      }),
    ]));
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('fails after admin preflight apply but before app apply when ingress-nginx is not ready', async () => {
    const root = tempDir('local-kind-ingress-wait-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      if (command === 'kubectl' && args.join(' ').includes('get ingressclass nginx')) {
        return { exitCode: 1, stdout: '', stderr: 'Error from server (NotFound): ingressclasses.networking.k8s.io "nginx" not found' };
      }

      return createPassingRunner([])(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: async () => {
        throw new Error('route probes must not run before ingress-nginx is ready');
      },
    });
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'ingress-preflight:class',
        message: expect.stringContaining('IngressClass/nginx'),
      }),
    ]));
    expect(commandText).toContain('kubectl --kubeconfig');
    expect(commandText).toContain('apply -f -');
    expect(commandText).toContain('get ingressclass nginx');
    expect(commandText).not.toContain('rollout status deployment/agentsmith-web');
    expect(calls.some((call) => call.input.includes('name: agentsmith-api'))).toBe(false);
  });

  it('keeps server dry-run Namespace resources in a separate batch from ingress-nginx namespaced resources', async () => {
    const root = tempDir('local-kind-admin-preflight-split-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      if (
        command === 'kubectl'
        && args.includes('apply')
        && args.includes('--dry-run=server')
        && (options.input ?? '').includes('kind: Namespace')
        && (options.input ?? '').includes('namespace: ingress-nginx')
      ) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'Error from server (NotFound): namespaces "ingress-nginx" not found',
        };
      }

      return createPassingRunner([])(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const applyCalls = calls.filter((call) => call.args.includes('apply'));

    expect(result.status).toBe('passed');
    expect(applyCalls.every((call) =>
      !(call.input.includes('kind: Namespace') && call.input.includes('namespace: ingress-nginx')),
    )).toBe(true);
    expect(applyCalls[0]?.input).toContain('kind: Namespace');
    expect(applyCalls[0]?.input).toContain('name: ingress-nginx');
    expect(applyCalls[2]?.input).not.toContain('kind: Namespace');
    expect(applyCalls[2]?.input).toContain('namespace: ingress-nginx');
    expect(applyCalls[2]?.input).toContain('name: ingress-nginx-controller');
  });

  it('dry-runs and applies namespace preflight before app manifests, then rolls out and probes routes', async () => {
    const root = tempDir('local-kind-rollout-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });

    const applyCalls = calls.filter((call) => call.args.includes('apply'));
    const rolloutCalls = calls.filter((call) => call.args.includes('rollout'));
    const ingressClassIndex = calls.findIndex((call) => call.args.join(' ').includes('get ingressclass nginx'));
    const ingressRolloutIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('rollout status deployment/ingress-nginx-controller'),
    );
    const appDryRunIndex = calls.indexOf(applyCalls[4] as CommandCall);

    expect(result.status).toBe('passed');
    expect(applyCalls).toHaveLength(6);
    expect(applyCalls[0]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[0]?.input).toContain('kind: Namespace');
    expect(applyCalls[0]?.input).toContain('name: agentsmith');
    expect(applyCalls[0]?.input).toContain('name: ingress-nginx');
    expect(applyCalls[0]?.input).not.toContain('namespace: ingress-nginx');
    expect(applyCalls[0]?.input).not.toContain('name: ingress-nginx-controller');
    expect(applyCalls[0]?.input).not.toContain('name: agentsmith-api');
    expect(applyCalls[1]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[1]?.input).toContain('kind: Namespace');
    expect(applyCalls[1]?.input).not.toContain('namespace: ingress-nginx');
    expect(applyCalls[2]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[2]?.input).not.toContain('kind: Namespace');
    expect(applyCalls[2]?.input).toContain('kind: IngressClass');
    expect(applyCalls[2]?.input).toContain('name: ingress-nginx-controller');
    expect(applyCalls[3]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[3]?.input).not.toContain('kind: Namespace');
    expect(applyCalls[3]?.input).toContain('namespace: ingress-nginx');
    expect(ingressClassIndex).toBeGreaterThan(calls.indexOf(applyCalls[3] as CommandCall));
    expect(ingressRolloutIndex).toBeGreaterThan(ingressClassIndex);
    expect(appDryRunIndex).toBeGreaterThan(ingressRolloutIndex);
    expect(applyCalls[4]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[4]?.input).toContain('Deployment');
    expect(applyCalls[4]?.input).toContain('name: agentsmith-api');
    expect(applyCalls[4]?.input).toContain('DATABASE_URL: "postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:5432/sentinel_pg_db"');
    expect(applyCalls[4]?.input).toContain('MONGO_URL: "mongodb://sentinel_mongo_user:sentinel_mongo_secret@substrate-mongodb:27017/admin"');
    expect(applyCalls[4]?.input).toContain('REDIS_URL: "redis://:sentinel_redis_secret@substrate-redis:6379/0"');
    expect(applyCalls[4]?.input).toContain('MINIO_PORT: "9000"');
    expect(applyCalls[4]?.input).toContain('INTERNAL_KEYCLOAK_BASE_URL: "http://substrate-keycloak:8080"');
    expect(applyCalls[4]?.input).not.toContain('INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE');
    expect(applyCalls[4]?.input).not.toContain('INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE');
    expect(applyCalls[4]?.input).not.toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT');
    expect(applyCalls[4]?.input).toContain('value: "http://substrate-minio.agentsmith.svc.cluster.local:9000"');
    expect(applyCalls[4]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-app-config: "sha256:[a-f0-9]{64}"/u);
    expect(applyCalls[4]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-app-secrets: "sha256:[a-f0-9]{64}"/u);
    expect(applyCalls[4]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-llmup-config: "sha256:[a-f0-9]{64}"/u);
    expect(applyCalls[4]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-sandbox-manager-config: "sha256:[a-f0-9]{64}"/u);
    expect(applyCalls[4]?.input).toContain('metaurl: "postgres://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql.agentsmith.svc.cluster.local:5432/sentinel_pg_db?sslmode=disable"');
    expect(applyCalls[4]?.input).not.toContain('metaurl: "postgres://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:5432/sentinel_pg_db?sslmode=disable"');
    expect(applyCalls[4]?.input).toContain('bucket: "http://substrate-minio.agentsmith.svc.cluster.local:9000/sentinel-files"');
    expect(applyCalls[4]?.input).toContain('kind: PersistentVolume');
    expect(applyCalls[4]?.input).toContain('name: agentsmith-afscp-default-volume');
    expect(applyCalls[4]?.input).toContain('kind: PersistentVolumeClaim');
    expect(applyCalls[4]?.input).toContain('claimName: afscp-default-volume');
    expect(applyCalls[4]?.input).toContain('storage: 12P');
    expect(applyCalls[4]?.input).toContain('AFSCP_JVS_ENABLED: "true"');
    expect(applyCalls[4]?.input).toContain('AFSCP_JVS_READY: "true"');
    expect(applyCalls[4]?.input).toContain('AFSCP_JVS_CWD: "/var/lib/afscp/jvs-cwd"');
    expect(applyCalls[4]?.input).toContain('name: afscp-jvs-cwd');
    expect(applyCalls[4]?.input).toContain('mountPath: "/var/lib/afscp/jvs-cwd"');
    expect(applyCalls[4]?.input).toContain('emptyDir: {}');
    expect(applyCalls[4]?.input).not.toContain('AFSCP_JVS_BINARY_PATH');
    expect(applyCalls[4]?.input).not.toContain('AFSCP_JVS_BINARY_SHA256');
    expect(applyCalls[4]?.input).not.toContain('storage: 8Pi');
    expect(applyCalls[4]?.input).not.toContain('storage: 10Pi');
    expect(applyCalls[4]?.input).not.toContain('volumeAttributes:\n              subPath: "afscp/vol_agentsmith_default"');
    expect(applyCalls[4]?.input).not.toContain('@substrate-postgresql:15432/');
    expect(applyCalls[4]?.input).not.toContain('@substrate-mongodb:27027/');
    expect(applyCalls[4]?.input).not.toContain('@substrate-redis:16379/');
    expect(applyCalls[4]?.input).not.toContain('kind: ClusterRole');
    expect(applyCalls[4]?.input).not.toContain('persistentvolumes');
    expect(applyCalls[4]?.input).not.toContain('execution-gateway');
    expect(applyCalls[5]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[5]?.input).not.toContain('kind: ClusterRole');
    expect(applyCalls[5]?.input).not.toContain('persistentvolumes');
    expect(rolloutCalls.map((call) => call.args.join(' '))).toEqual(expect.arrayContaining([
      expect.stringContaining('rollout status deployment/agentsmith-web'),
      expect.stringContaining('rollout status deployment/agentsmith-api'),
      expect.stringContaining('rollout status deployment/agentsmith-llmup'),
      expect.stringContaining('rollout status deployment/agentsmith-sandbox-manager'),
    ]));
    expect(result.evidence.rendered_manifest_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.evidence.substrate_truth_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.evidence.substrate_live_check.status).toBe('passed');
    expect(result.evidence.manifest_summary.resources).toEqual(expect.arrayContaining([
      'PersistentVolume/agentsmith-afscp-default-volume',
      'PersistentVolumeClaim/afscp-default-volume',
    ]));
    expect(result.evidence.image_preflight.status).toBe('passed');
    expect(result.evidence.image_preflight.image_refs).toContain(`kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`);
    expect(result.evidence.llmup_config_health).toMatchObject({
      status: 'passed',
      config_map: 'agentsmith-llmup-config',
      admin_token_secret: 'agentsmith-app-secrets/MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN',
      readiness_path: '/health',
      liveness_path: '/health',
      rollout_status: 'passed',
    });
    expect(result.evidence.live_api_replica_check.ready_replicas).toBe(1);
    expect(result.evidence.route_probes.map((probe) => probe.status)).toEqual(['passed', 'passed', 'passed', 'passed']);
  });

  it('resets owned stale AFSCP static PV/PVC storage drift before app dry-run', async () => {
    const root = tempDir('local-kind-afscp-volume-reset-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (command === 'kubectl' && joined.includes('get pvc afscp-default-volume')) {
        return jsonResult(ownedAfscpPersistentVolumeClaim('10Pi'));
      }
      if (command === 'kubectl' && joined.includes('get pv agentsmith-afscp-default-volume')) {
        return jsonResult(ownedAfscpPersistentVolume('10Pi'));
      }

      return createPassingRunner([])(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const commandText = calls.map((call) => call.args.join(' '));
    const appDryRunIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('apply --dry-run=server') && call.input.includes('name: agentsmith-api'),
    );
    const workloadDeleteIndex = commandText.findIndex((commandLine) =>
      commandLine.includes('delete deployment afscp-api afscp-worker afscp-export-gateway'),
    );
    const pvcDeleteIndex = commandText.findIndex((commandLine) =>
      commandLine.includes('delete pvc afscp-default-volume'),
    );
    const pvDeleteIndex = commandText.findIndex((commandLine) =>
      commandLine.includes('delete pv agentsmith-afscp-default-volume'),
    );

    expect(result.status).toBe('passed');
    expect(workloadDeleteIndex).toBeGreaterThan(-1);
    expect(pvcDeleteIndex).toBeGreaterThan(workloadDeleteIndex);
    expect(pvDeleteIndex).toBeGreaterThan(pvcDeleteIndex);
    expect(appDryRunIndex).toBeGreaterThan(pvDeleteIndex);
    expect(result.evidence.operations.map((operation) => operation.name)).toEqual(expect.arrayContaining([
      'afscp-static-volume-reset-check-pvc',
      'afscp-static-volume-reset-check-pv',
      'afscp-static-volume-reset-delete-workloads',
      'afscp-static-volume-reset-delete-pvc',
      'afscp-static-volume-reset-delete-pv',
    ]));
  });

  it('refuses to reset non-owned AFSCP static PV/PVC resources', async () => {
    const root = tempDir('local-kind-afscp-volume-non-owned-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (command === 'kubectl' && joined.includes('get pvc afscp-default-volume')) {
        const resource = ownedAfscpPersistentVolumeClaim('10Pi');
        const metadata = resource.metadata as Record<string, unknown>;
        delete metadata.annotations;
        return jsonResult(resource);
      }
      if (command === 'kubectl' && joined.includes('get pv agentsmith-afscp-default-volume')) {
        return { exitCode: 0, stdout: '', stderr: '' };
      }

      return createPassingRunner([])(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const failureText = result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n');

    expect(result.status).toBe('failed');
    expect(failureText).toContain('not owned by agentsmith-unified-deploy');
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes('delete pvc afscp-default-volume'))).toBe(false);
    expect(calls.some((call) =>
      call.args.join(' ').includes('apply --dry-run=server') && call.input.includes('name: agentsmith-api'),
    )).toBe(false);
  });

  it('fails before app apply when rendered AFSCP pods use inline CSI instead of the PVC', async () => {
    const root = tempDir('local-kind-inline-csi-guard-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const templatesRoot = writeTemplatesRootWithInlineAfscpCsi(root);
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      templatesRoot,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const failureText = result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n');

    expect(result.status).toBe('failed');
    expect(failureText).toContain('inline CSI');
    expect(failureText).toContain('Persistent volume lifecycle');
    expect(failureText).toContain('PersistentVolumeClaim');
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('fails before app apply when AFSCP recovery is missing its JVS cwd runtime contract', async () => {
    const root = tempDir('local-kind-missing-jvs-cwd-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const templatesRoot = writeTemplatesRootWithoutAfscpJvsCwd(root);
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      templatesRoot,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const failureText = result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n');

    expect(result.status).toBe('failed');
    expect(failureText).toContain('AFSCP_JVS_CWD must be the clean absolute mounted scratch path');
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
  });

  it('deletes owned substrate EndpointSlices with immutable addressType drift before app dry-run', async () => {
    const root = tempDir('local-kind-endpointslice-reconcile-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const substrateTruthPath = writeActualSubstrateTruth(root, '172.19.0.1');
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      if (command === 'kubectl' && args.join(' ').includes('get endpointslices')) {
        return jsonResult({
          kind: 'EndpointSliceList',
          items: [
            {
              kind: 'EndpointSlice',
              metadata: {
                name: 'substrate-mongodb',
                labels: {
                  'app.kubernetes.io/component': 'substrate-binding',
                  'kubernetes.io/service-name': 'substrate-mongodb',
                },
                annotations: {
                  'rendered-by': 'agentsmith-unified-deploy',
                },
              },
              addressType: 'FQDN',
            },
          ],
        });
      }

      return createPassingRunner([])(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      substrateTruthPath,
      runner,
      probeRunner: passingProbeRunner,
    });
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');
    const deleteIndex = calls.findIndex((call) =>
      call.args.includes('delete') && call.args.includes('endpointslice') && call.args.includes('substrate-mongodb'),
    );
    const appDryRunIndex = calls.findIndex((call) => call.args.join(' ').includes('apply --dry-run=server') && call.input.includes('name: substrate-mongodb'));

    expect(result.status).toBe('passed');
    expect(commandText).toContain('get endpointslices');
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(appDryRunIndex).toBeGreaterThan(deleteIndex);
    expect(result.evidence.operations.map((operation) => operation.name)).toEqual(expect.arrayContaining([
      'substrate-endpointslice-reconcile-check',
      'substrate-endpointslice-reconcile-delete',
      'app-dry-run',
    ]));
  });

  it('treats an empty successful EndpointSlice check as no live substrate EndpointSlices', async () => {
    const root = tempDir('local-kind-empty-endpointslice-check-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const substrateTruthPath = writeActualSubstrateTruth(root, '172.19.0.1');
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      if (command === 'kubectl' && args.join(' ').includes('get endpointslices')) {
        return { exitCode: 0, stdout: '', stderr: '' };
      }

      return createPassingRunner([])(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      substrateTruthPath,
      runner,
      probeRunner: passingProbeRunner,
    });
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');

    expect(result.status).toBe('passed');
    expect(commandText).toContain('get endpointslices');
    expect(commandText).not.toContain('delete endpointslice');
    expect(calls.some((call) => call.args.join(' ').includes('apply --dry-run=server') && call.input.includes('name: substrate-mongodb'))).toBe(true);
  });

  it('fails before app dry-run instead of deleting non-owned substrate EndpointSlice addressType drift', async () => {
    const root = tempDir('local-kind-endpointslice-non-owned-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const substrateTruthPath = writeActualSubstrateTruth(root, '172.19.0.1');
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      if (command === 'kubectl' && args.join(' ').includes('get endpointslices')) {
        return jsonResult({
          kind: 'EndpointSliceList',
          items: [
            {
              kind: 'EndpointSlice',
              metadata: {
                name: 'substrate-mongodb',
                labels: {
                  'kubernetes.io/service-name': 'substrate-mongodb',
                },
                annotations: {},
              },
              addressType: 'FQDN',
            },
          ],
        });
      }

      return createPassingRunner([])(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      substrateTruthPath,
      runner,
      probeRunner: passingProbeRunner,
    });
    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'substrate-endpointslice:substrate-mongodb',
        message: expect.stringContaining('non-owned'),
      }),
    ]));
    expect(commandText).not.toContain('delete endpointslice substrate-mongodb');
    expect(calls.some((call) => call.args.join(' ').includes('apply --dry-run=server') && call.input.includes('name: substrate-mongodb'))).toBe(false);
  });

  it('fails when live API replicas drift from the fixed single-replica boundary', async () => {
    const root = tempDir('local-kind-replicas-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      const result = await createPassingRunner(calls)(command, args, options);
      if (args.join(' ').includes('get deployment agentsmith-api')) {
        return jsonResult({
          kind: 'Deployment',
          metadata: { name: 'agentsmith-api' },
          spec: { replicas: 2 },
          status: { readyReplicas: 2, availableReplicas: 2 },
        });
      }

      return result;
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'live:Deployment/agentsmith-api',
        message: expect.stringContaining('replicas=1'),
      }),
    ]));
  });

  it.each([
    {
      name: 'service',
      item: {
        kind: 'Service',
        metadata: { name: 'execution-gateway' },
        spec: { ports: [{ port: 8080 }] },
      },
    },
    {
      name: 'ingress route',
      item: {
        kind: 'Ingress',
        metadata: { name: 'agentsmith-execution-route' },
        spec: {
          rules: [
            {
              http: {
                paths: [
                  { path: '/execution-gateway', backend: { service: { name: 'execution-gateway' } } },
                ],
              },
            },
          ],
        },
      },
    },
    {
      name: 'configmap',
      item: {
        kind: 'ConfigMap',
        metadata: { name: 'agentsmith-legacy-execution-config' },
        data: { EXECUTION_GATEWAY_URL: 'http://execution-gateway:8080' },
      },
    },
    {
      name: 'deployment env',
      item: {
        kind: 'Deployment',
        metadata: { name: 'agentsmith-web' },
        spec: {
          template: {
            spec: {
              containers: [
                {
                  name: 'web',
                  env: [{ name: 'EXECUTION_GATEWAY_URL', value: 'http://execution-gateway:8080' }],
                },
              ],
            },
          },
        },
      },
    },
  ])('fails live forbidden-resource guard on execution-gateway $name drift', async ({ item }) => {
    const root = tempDir('local-kind-execution-gateway-drift-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      if (args.join(' ').includes('get deployment,service,configmap,ingress,horizontalpodautoscaler')) {
        calls.push({ command, args, input: options.input ?? '' });
        return jsonResult({
          kind: 'List',
          items: [
            {
              kind: 'Deployment',
              metadata: { name: 'agentsmith-api' },
              spec: { replicas: 1 },
            },
            item,
          ],
        });
      }

      return createPassingRunner(calls)(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: expect.stringContaining(`live:${item.kind}/`),
        message: expect.stringContaining('execution-gateway'),
      }),
    ]));
  });

  it('fails live forbidden-resource guard when an autoscaler targets agentsmith-api', async () => {
    const root = tempDir('local-kind-api-hpa-drift-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      if (args.join(' ').includes('get deployment,service,configmap,ingress,horizontalpodautoscaler')) {
        calls.push({ command, args, input: options.input ?? '' });
        return jsonResult({
          kind: 'List',
          items: [
            {
              kind: 'HorizontalPodAutoscaler',
              metadata: { name: 'api-hpa' },
              spec: {
                scaleTargetRef: {
                  kind: 'Deployment',
                  name: 'agentsmith-api',
                },
              },
            },
          ],
        });
      }

      return createPassingRunner(calls)(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'live:HorizontalPodAutoscaler/api-hpa',
        message: expect.stringContaining('autoscaler must not target api'),
      }),
    ]));
  });

  it('fails route probes when web/api/ws ingress routing does not match the expected status class', async () => {
    const root = tempDir('local-kind-probes-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner: createPassingRunner([]),
      probeRunner: async (url) => ({
        status: url.includes('/api/public/workspaces') ? 404 : 200,
        headers: { 'content-type': 'text/html' },
        body: '<html></html>',
      }),
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'probe:web-public-workspaces',
        message: expect.stringContaining('200 JSON'),
      }),
      expect.objectContaining({
        path: 'probe:api-profile',
        message: expect.stringContaining('401'),
      }),
      expect.objectContaining({
        path: 'probe:api-agent-execution-ws',
        message: expect.stringContaining('400 or 401'),
      }),
    ]));
  });

  it('fails when live ingress path ownership drifts even if weak status probes respond', async () => {
    const root = tempDir('local-kind-ingress-routes-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
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
                    { path: '/api/public', backend: { service: { name: 'agentsmith-api' } } },
                    { path: '/api/system', backend: { service: { name: 'agentsmith-web' } } },
                    { path: '/api/v1', backend: { service: { name: 'agentsmith-api' } } },
                    { path: '/', backend: { service: { name: 'agentsmith-web' } } },
                  ],
                },
              },
            ],
          },
        });
      }

      return result;
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'probe:ingress-routes',
        message: expect.stringContaining('/api/public must route to agentsmith-web'),
      }),
    ]));
  });

  it('redacts rendered secret values from kubectl diagnostics in evidence', async () => {
    const root = tempDir('local-kind-redaction-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      const result = await createPassingRunner(calls)(command, args, options);
      if (args.join(' ').includes('apply --dry-run=server')) {
        return {
          exitCode: 1,
          stdout: 'server echoed sentinel_pg_secret',
          stderr: 'validation echoed postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:15432/sentinel_pg_db',
        };
      }

      return result;
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: passingProbeRunner,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const report = readFileSync(result.evidence.paths.report_path, 'utf8');

    expect(result.status).toBe('failed');
    expect(report).not.toContain('sentinel_pg_secret');
    expect(report).toContain('[REDACTED]');
  });
});
