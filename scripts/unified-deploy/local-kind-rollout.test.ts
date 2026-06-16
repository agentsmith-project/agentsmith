import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  runLocalKindRolloutProducer as runLocalKindRolloutProducerImpl,
  type LocalKindRolloutProducerOptions,
  type LocalKindCommandRunner,
  type LocalKindHttpProbeRunner,
} from './check-local-kind-rollout';
import {
  createRunReadinessState,
  updateRunReadinessStateField,
} from '../governance/run-readiness-state';
import { asRecord } from './manifest';
import {
  DEFAULT_SITE_ENV_PATH,
  afscpRevisionedVolumeRef,
  afscpVolumeCredentialRevision,
} from './render';
import { parseKubernetesDocuments, type KubernetesDocument } from './kubernetes';
import {
  LEGACY_ASBCP_CHECKSUM_FRAGMENT,
  LEGACY_ASBCP_CONFIGMAP_NAME,
  LEGACY_ASBCP_KUBERNETES_IDENTITY,
  LEGACY_ASBCP_LOCAL_KIND_CLUSTER_RESOURCE_IDS,
  LEGACY_ASBCP_LOCAL_KIND_PV_RBAC_NAME,
  LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS,
} from './asbcp-legacy-residue-negative-evidence';

const tempRoots: string[] = [];
const fixturesDir = join(process.cwd(), 'scripts', 'unified-deploy', '__fixtures__');
const asbcpImageLockPath = join(process.cwd(), 'infra', 'deploy', 'shared', 'asbcp-image.lock');
const localKindJuicefsCsiManifestPath = join(
  process.cwd(),
  'infra',
  'deploy',
  'unified',
  'local-kind',
  'juicefs-csi',
  'upstream-manifest.yaml',
);

type CommandCall = {
  command: string;
  args: string[];
  input: string;
  timeoutMs?: number;
};

const APP_DIGEST = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ASBCP_DIGEST = readAsbcpLockDigest();
const OLD_ASBCP_DIGEST = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const LLMUP_DIGEST = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const INGRESS_CONTROLLER_DIGEST = 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const INGRESS_CERTGEN_DIGEST = 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const MANAGED_RUNNER_DIGEST = 'sha256:9999999999999999999999999999999999999999999999999999999999999999';
const AFSCP_DIGEST = 'sha256:abababababababababababababababababababababababababababababababab';
const JUICEFS_MOUNT_PRIORITY_CLASS = 'juicefs-mount-priority-nonpreempting';
const SENTINEL_AFSCP_VOLUME_REF = afscpRevisionedVolumeRef(
  'afscp-default-volume-juicefs',
  afscpVolumeCredentialRevision({
    name: 'agentsmith-afscp-default',
    metaurl: 'postgres://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql.agentsmith.svc.cluster.local:5432/sentinel_pg_db?sslmode=disable',
    storage: 'minio',
    bucket: 'http://substrate-minio.agentsmith.svc.cluster.local:9000/sentinel-files',
    accessKey: 'sentinel_minio_access',
    secretKey: 'sentinel_minio_secret',
  }),
);

function readAsbcpLockDigest(): string {
  const match = /^asbcp_source_image=.*@(sha256:[a-f0-9]{64})$/mu.exec(readFileSync(asbcpImageLockPath, 'utf8'));
  if (!match?.[1]) {
    throw new Error('asbcp-image.lock must include asbcp_source_image pinned by sha256 digest');
  }
  return match[1];
}

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

function writeStrictTlsSubstrateTruth(root: string, mutate: (source: string) => string = (source) => source): string {
  const truthPath = join(root, 'strict-tls-connection.env');
  const source = mutate(`${readFileSync(join(fixturesDir, 'substrate-truth.sentinel.env'), 'utf8')}
SUBSTRATE_POSTGRES_TLS_MODE=verify-full
SUBSTRATE_POSTGRES_CA_SECRET_REF=secretRef:agentsmith/postgresql-ca
SUBSTRATE_MONGODB_TLS_MODE=verify-full
SUBSTRATE_MONGODB_CA_SECRET_REF=secretRef:agentsmith/mongodb-ca
SUBSTRATE_REDIS_TLS_MODE=verify-full
SUBSTRATE_REDIS_CA_SECRET_REF=secretRef:agentsmith/redis-ca
SUBSTRATE_OBJECT_STORAGE_TLS_MODE=https
SUBSTRATE_OBJECT_STORAGE_CA_SECRET_REF=secretRef:agentsmith/object-storage-ca
SUBSTRATE_OIDC_TLS_MODE=https
SUBSTRATE_OIDC_CA_SECRET_REF=secretRef:agentsmith/oidc-ca
`.replace(
    /^SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL=.*$/mu,
    'SUBSTRATE_KEYCLOAK_INTERNAL_BASE_URL=https://substrate-keycloak:8080',
  ));
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
    .replace(/^ASBCP_IMAGE=.*$/mu, `ASBCP_IMAGE=kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`)
    .replace(/^MANAGED_RUNNER_IMAGE=.*$/mu, `MANAGED_RUNNER_IMAGE=kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`)
    .replace(/^INGRESS_NGINX_CONTROLLER_IMAGE=.*$/mu, `INGRESS_NGINX_CONTROLLER_IMAGE=kind-registry:5000/mbos/ingress-nginx-controller@${INGRESS_CONTROLLER_DIGEST}`)
    .replace(/^INGRESS_NGINX_CERTGEN_IMAGE=.*$/mu, `INGRESS_NGINX_CERTGEN_IMAGE=kind-registry:5000/mbos/ingress-nginx-kube-webhook-certgen@${INGRESS_CERTGEN_DIGEST}`)));
}

function writeMutableLocalKindImageSiteEnv(root: string): string {
  return writeLocalKindImageSiteEnv(root, (source) => source
    .replace(/^WEB_IMAGE=.*$/mu, 'WEB_IMAGE=kind-registry:5000/mbos/agentsmith-app:local-kind-dev')
    .replace(/^API_IMAGE=.*$/mu, 'API_IMAGE=kind-registry:5000/mbos/agentsmith-app:local-kind-dev'));
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function createReadyLocalKindImageImportEnv(options: {
  root: string;
  siteEnvPath: string;
  context?: string;
  clusterUid?: string;
}): Record<string, string | undefined> {
  const readiness = createRunReadinessState({
    scope: 'release',
    root: options.root,
    gitSha: 'local-kind-rollout-test',
    input: {
      campaign_root: options.root,
      run_id: 'local-kind-rollout-test',
    },
    env: {
      NEXT_PUBLIC_API_BASE: 'http://localhost:29180/api/v1',
    },
    invocationId: 'local-kind-rollout-invocation',
    processNonce: 'local-kind-rollout-process-nonce',
  });
  updateRunReadinessStateField({
    statePath: readiness.statePath,
    invocationId: readiness.state.invocation_id,
    processNonce: readiness.state.process_nonce,
    inputDigest: readiness.state.input_digest,
    envDigest: readiness.state.env_digest.digest,
    gitSha: readiness.state.git_sha,
    writerToken: readiness.writerToken,
    field: 'local_kind_image_import_completed',
    status: 'ready',
    identity: {
      local_kind_context: options.context ?? 'kind-agentsmith',
      local_kind_cluster_uid: options.clusterUid ?? 'cluster-uid-local-kind',
      local_kind_site_env_digest: sha256(readFileSync(options.siteEnvPath, 'utf8')),
    },
  });

  return readiness.env;
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
    '              name: {{AFSCP_VOLUME_REF}}',
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

function createPassingRunner(
  calls: CommandCall[],
  context = 'kind-agentsmith',
  caSecretData: Record<string, string> = {},
): LocalKindCommandRunner {
  const caSecrets = {
    'postgresql-ca': 'c2VudGluZWwtcG9zdGdyZXMtY2E=',
    'object-storage-ca': 'c2VudGluZWwtb2JqZWN0LXN0b3JhZ2UtY2E=',
    ...caSecretData,
  };

  return async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input ?? '', timeoutMs: options.timeoutMs });
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
      if (args[0] === 'run' && joined.includes('--entrypoint /usr/local/bin/afscp-migrate')) {
        const isValid = args.includes('--apply') && args.includes('--check');
        return isValid
          ? { exitCode: 0, stdout: 'migration ok', stderr: '' }
          : { exitCode: 2, stdout: '', stderr: 'missing action flag: --apply or --check' };
      }
      if (args[0] === 'run' && joined.includes('--entrypoint /usr/local/bin/afscp-volume-bootstrap')) {
        const isValid = args.includes('--ensure') && args.includes('--check');
        return isValid
          ? { exitCode: 0, stdout: 'volume bootstrap ok', stderr: '' }
          : { exitCode: 2, stdout: '', stderr: args.includes('--apply') ? 'unknown flag: --apply' : 'missing action flag: --ensure or --check' };
      }

      return { exitCode: 0, stdout: 'docker ok', stderr: '' };
    }
    if (joined.includes('config current-context')) {
      return { exitCode: 0, stdout: `${context}\n`, stderr: '' };
    }
    if (joined.includes('get namespace kube-system') && joined.includes('jsonpath')) {
      return { exitCode: 0, stdout: 'cluster-uid-local-kind\n', stderr: '' };
    }
    const secretArgIndex = args.findIndex((arg, index) => arg === 'secret' && args[index - 1] === 'get');
    const caSecretName = secretArgIndex >= 0 ? args[secretArgIndex + 1] : undefined;
    const caData = caSecretName ? caSecrets[caSecretName] : undefined;
    if (caSecretName && caData && args.includes('-o') && args.includes('json')) {
      const namespaceArgIndex = args.findIndex((arg) => arg === '-n');
      const namespace = namespaceArgIndex >= 0 ? args[namespaceArgIndex + 1] ?? 'agentsmith' : 'agentsmith';
      return jsonResult({
        kind: 'Secret',
        metadata: {
          name: caSecretName,
          namespace,
        },
        type: 'Opaque',
        data: {
          'ca.crt': caData,
        },
      });
    }
    if (joined.includes('rollout status')) {
      return { exitCode: 0, stdout: 'deployment successfully rolled out', stderr: '' };
    }
    if (joined.includes('exec deployment/agentsmith-api') && (options.input ?? '').includes('afscp-functional-convergence')) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          status: 'passed',
          marker: 'afscp-functional-convergence',
          namespace_id: 'ns_rollout_probe',
          namespace_operation_state: 'succeeded',
          volume_binding_operation_state: 'succeeded',
        }),
        stderr: '',
      };
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
    if (joined.includes('get job/agentsmith-product-schema-bootstrap -o json')) {
      return jsonResult(completedJob('agentsmith-product-schema-bootstrap'));
    }
    if (joined.includes('get job/afscp-schema-bootstrap -o json')) {
      return jsonResult(completedJob('afscp-schema-bootstrap'));
    }
    if (joined.includes('get job/afscp-volume-bootstrap -o json')) {
      return jsonResult(completedJob('afscp-volume-bootstrap'));
    }
    if (
      joined.includes('get pods -l app.kubernetes.io/name=juicefs-mount,volume-id=agentsmith-afscp-default-volume')
      || joined.includes('get secrets -l juicefs/secret')
    ) {
      return { exitCode: 0, stdout: '', stderr: '' };
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
                  image: `kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`,
                  imageID: `docker-pullable://kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`,
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
    if (joined.includes('get deployment,service,configmap,serviceaccount,role,rolebinding')) {
      return jsonResult({ kind: 'List', items: [] });
    }
    if (joined.includes('get clusterrole,clusterrolebinding')) {
      return jsonResult({ kind: 'List', items: [] });
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
      body: '{"items":[{"id":"ws_default","name":"Default Workspace"}]}',
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

function ownedAfscpPersistentVolume(
  storage = '10Pi',
  volumeSecretName = SENTINEL_AFSCP_VOLUME_REF,
): Record<string, unknown> {
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
      mountOptions: ['subdir=/afscp/vol_agentsmith_default'],
      csi: {
        driver: 'csi.juicefs.com',
        volumeHandle: 'agentsmith-afscp-default-volume',
        fsType: 'juicefs',
        nodePublishSecretRef: {
          name: volumeSecretName,
          namespace: 'agentsmith',
        },
      },
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

function requireManifestResource(
  documents: readonly KubernetesDocument[],
  kind: string,
  name: string,
): KubernetesDocument {
  const resource = documents.find((document) =>
    document.kind === kind && asRecord(document.metadata).name === name,
  );
  if (!resource) {
    throw new Error(`expected ${kind}/${name} in local-kind JuiceFS CSI manifest`);
  }
  return resource;
}

function requirePodTemplateContainer(resource: KubernetesDocument, containerName: string): Record<string, unknown> {
  const templateSpec = asRecord(asRecord(asRecord(resource.spec).template).spec);
  const containers = Array.isArray(templateSpec.containers) ? templateSpec.containers : [];
  const container = containers.map(asRecord).find((candidate) => candidate.name === containerName);
  if (!container) {
    throw new Error(`expected ${String(asRecord(resource.metadata).name)}/${containerName} container`);
  }
  return container;
}

function containerEnvValue(container: Record<string, unknown>, name: string): string | undefined {
  const env = Array.isArray(container.env) ? container.env : [];
  const match = env.map(asRecord).find((entry) => entry.name === name);
  return typeof match?.value === 'string' ? match.value : undefined;
}

function parseConfigMapYaml(configMap: KubernetesDocument, key: string): Record<string, unknown> {
  const value = asRecord(configMap.data)[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`expected non-empty ConfigMap data.${key}`);
  }
  return asRecord(YAML.parse(value) as unknown);
}

describe('local-kind JuiceFS CSI manifest contract', () => {
  it('requires fsGroupPolicy File for RWX JuiceFS PVs and restricted non-root workloads', () => {
    const parsed = parseKubernetesDocuments(readFileSync(localKindJuicefsCsiManifestPath, 'utf8'));
    const csiDriver = parsed.documents.find((document) =>
      document.kind === 'CSIDriver' && asRecord(document.metadata).name === 'csi.juicefs.com',
    );
    const spec = asRecord(csiDriver?.spec);

    expect(parsed.failures).toEqual([]);
    expect(csiDriver).toBeDefined();
    expect(
      spec.fsGroupPolicy,
      'local-kind JuiceFS RWX PVs must apply fsGroup to root-owned payload mounts so non-root workspace-init can create workspace/.artifacts',
    ).toBe('File');
  });

  it('sets Mount Pods to non-preempting priority with explicit local-kind resource requests', () => {
    const parsed = parseKubernetesDocuments(readFileSync(localKindJuicefsCsiManifestPath, 'utf8'));

    expect(parsed.failures).toEqual([]);

    const priorityClass = requireManifestResource(parsed.documents, 'PriorityClass', JUICEFS_MOUNT_PRIORITY_CLASS);
    expect(priorityClass.apiVersion).toBe('scheduling.k8s.io/v1');
    expect(priorityClass.value).toBe(1000000000);
    expect(priorityClass.preemptionPolicy).toBe('Never');
    expect(priorityClass.globalDefault).toBe(false);

    for (const [kind, name] of [
      ['StatefulSet', 'juicefs-csi-controller'],
      ['DaemonSet', 'juicefs-csi-node'],
    ] as const) {
      const resource = requireManifestResource(parsed.documents, kind, name);
      const plugin = requirePodTemplateContainer(resource, 'juicefs-plugin');

      expect(containerEnvValue(plugin, 'JUICEFS_MOUNT_PRIORITY_NAME')).toBe(JUICEFS_MOUNT_PRIORITY_CLASS);
      expect(containerEnvValue(plugin, 'JUICEFS_MOUNT_PREEMPTION_POLICY')).toBe('Never');
    }

    const configMap = requireManifestResource(parsed.documents, 'ConfigMap', 'juicefs-csi-driver-config');
    const config = parseConfigMapYaml(configMap, 'config.yaml');
    const mountPodPatch = config.mountPodPatch;
    const mountPodPatches = Array.isArray(mountPodPatch) ? mountPodPatch : [];
    const resourcePatch = mountPodPatches.map(asRecord).find((patch) => {
      const requests = asRecord(asRecord(patch.resources).requests);
      return typeof requests.cpu === 'string' && typeof requests.memory === 'string';
    });
    const requests = asRecord(asRecord(resourcePatch?.resources).requests);

    expect(mountPodPatches.length).toBeGreaterThan(0);
    expect(resourcePatch).toBeDefined();
    expect('pvcSelector' in asRecord(resourcePatch)).toBe(false);
    expect(requests).toEqual(expect.objectContaining({
      cpu: '100m',
      memory: '128Mi',
    }));
  });

  it('projects the local-kind Postgres CA into the JuiceFS node plugin for strict TLS metadata checks', () => {
    const parsed = parseKubernetesDocuments(readFileSync(localKindJuicefsCsiManifestPath, 'utf8'));
    const node = requireManifestResource(parsed.documents, 'DaemonSet', 'juicefs-csi-node');
    const plugin = requirePodTemplateContainer(node, 'juicefs-plugin');
    const podSpec = asRecord(asRecord(asRecord(node.spec).template).spec);
    const volumeMounts = Array.isArray(plugin.volumeMounts) ? plugin.volumeMounts.map(asRecord) : [];
    const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];
    const caMount = volumeMounts.find((mount) => mount.name === 'agentsmith-substrate-postgresql-ca');
    const caVolume = volumes.find((volume) => volume.name === 'agentsmith-substrate-postgresql-ca');
    const caSecret = asRecord(caVolume?.secret);

    expect(parsed.failures).toEqual([]);
    expect(caMount).toEqual(expect.objectContaining({
      mountPath: '/etc/agentsmith/substrate-ca/postgresql',
      readOnly: true,
    }));
    expect(caSecret.secretName).toBe('postgresql-ca');
    expect(caSecret.optional).toBe(true);
    expect(caSecret.items).toEqual([
      {
        key: 'ca.crt',
        path: 'ca.crt',
      },
    ]);
  });
});

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
    expect(appApply?.input).toContain('- 172.19.0.1');
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

  it('still runs image preflight contract checks when parent image handoff readiness matches', async () => {
    const root = tempDir('local-kind-image-preflight-reuse-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const readinessEnv = createReadyLocalKindImageImportEnv({ root, siteEnvPath });

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: {
        ...readinessEnv,
        KUBECONFIG: kubeconfigPath,
      },
      homeDir: root,
      siteEnvPath,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });

    const commandText = calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n');
    expect(result.status).toBe('passed');
    expect(result.evidence.image_preflight.status).toBe('passed');
    expect(result.evidence.image_preflight.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining('parent-verified local-kind image handoff matched readiness identity'),
    ]));
    expect(commandText).toContain(`docker exec agentsmith-control-plane crictl pull kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(commandText).toContain(`docker buildx imagetools inspect localhost:5001/mbos/agentsmith-app@${APP_DIGEST}`);
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(true);
  });

  it('fails image preflight despite ready image handoff readiness when rendered image refs are mutable', async () => {
    const root = tempDir('local-kind-ready-mutable-image-handoff-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeMutableLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const readinessEnv = createReadyLocalKindImageImportEnv({ root, siteEnvPath });

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: {
        ...readinessEnv,
        KUBECONFIG: kubeconfigPath,
      },
      homeDir: root,
      siteEnvPath,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'render',
        message: expect.stringContaining('WEB_IMAGE must be pinned by sha256 digest'),
      }),
    ]));
    expect(calls.map((call) => call.args.join(' ')).some((args) => args.includes(' apply '))).toBe(false);
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
        path: 'render',
        message: expect.stringContaining('WEB_IMAGE must be pinned by sha256 digest'),
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
      registryAvailabilityPoll: { timeoutMs: 0 },
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
    const csiApplyIndex = calls.indexOf(applyCalls[4] as CommandCall);
    const csiControllerScaleIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('scale statefulset/juicefs-csi-controller --replicas=1'),
    );
    const csiControllerRolloutIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('rollout status statefulset/juicefs-csi-controller'),
    );
    const csiNodeRolloutIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('rollout status daemonset/juicefs-csi-node'),
    );
    const secretMaterializeDryRunIndex = calls.indexOf(applyCalls[5] as CommandCall);
    const secretMaterializeApplyIndex = calls.indexOf(applyCalls[6] as CommandCall);
    const productBootstrapDryRunIndex = calls.indexOf(applyCalls[7] as CommandCall);
    const productBootstrapApplyIndex = calls.indexOf(applyCalls[8] as CommandCall);
    const schemaBootstrapDryRunIndex = calls.indexOf(applyCalls[9] as CommandCall);
    const schemaBootstrapApplyIndex = calls.indexOf(applyCalls[10] as CommandCall);
    const volumeBootstrapDryRunIndex = calls.indexOf(applyCalls[11] as CommandCall);
    const volumeBootstrapApplyIndex = calls.indexOf(applyCalls[12] as CommandCall);
    const appDryRunIndex = calls.indexOf(applyCalls[13] as CommandCall);
    const productJobDeleteIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('delete job agentsmith-product-schema-bootstrap'),
    );
    const schemaJobDeleteIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('delete job afscp-schema-bootstrap'),
    );
    const volumeJobDeleteIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('delete job afscp-volume-bootstrap'),
    );
    const appApplyIndex = calls.indexOf(applyCalls[14] as CommandCall);
    const productJobPollIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('get job/agentsmith-product-schema-bootstrap -o json'),
    );
    const schemaJobPollIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('get job/afscp-schema-bootstrap -o json'),
    );
    const volumeJobPollIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('get job/afscp-volume-bootstrap -o json'),
    );
    const firstAppRolloutIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('rollout status deployment/agentsmith-web'),
    );

    expect(result.status, JSON.stringify(result.failures, null, 2)).toBe('passed');
    expect(applyCalls).toHaveLength(15);
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
    expect(csiApplyIndex).toBeGreaterThan(ingressRolloutIndex);
    expect(applyCalls[4]?.args).toEqual(expect.arrayContaining(['apply', '--validate=false', '-f']));
    expect(applyCalls[4]?.args.join(' ')).toContain('local-kind/juicefs-csi/upstream-manifest.yaml');
    expect(applyCalls[4]?.input).toBe('');
    expect(csiControllerScaleIndex).toBeGreaterThan(csiApplyIndex);
    expect(csiControllerRolloutIndex).toBeGreaterThan(csiControllerScaleIndex);
    expect(csiNodeRolloutIndex).toBeGreaterThan(csiControllerRolloutIndex);
    expect(secretMaterializeDryRunIndex).toBeGreaterThan(csiNodeRolloutIndex);
    expect(applyCalls[5]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[5]?.input).toContain('kind: Secret');
    expect(applyCalls[5]?.input).toContain('name: agentsmith-app-secrets');
    expect(applyCalls[5]?.input).toContain('name: afscp-runtime-secrets');
    expect(applyCalls[5]?.input).toContain(`name: ${SENTINEL_AFSCP_VOLUME_REF}`);
    expect(SENTINEL_AFSCP_VOLUME_REF).toMatch(/^afscp-default-volume-juicefs-[a-f0-9]{12}$/u);
    expect(applyCalls[5]?.input).toContain('DATABASE_URL: "postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:5432/sentinel_pg_db"');
    expect(applyCalls[5]?.input).toContain('AFSCP_API_SERVICE_TOKENS: "agentsmith-api=agentsmith-dev-afscp-product-token,agentsmith-bootstrap=agentsmith-dev-afscp-bootstrap-token,agentsmith-sandbox-control-plane=agentsmith-dev-afscp-orchestrator-token"');
    expect(applyCalls[5]?.input).toContain('metaurl: "postgres://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql.agentsmith.svc.cluster.local:5432/sentinel_pg_db?sslmode=disable"');
    expect(secretMaterializeApplyIndex).toBeGreaterThan(secretMaterializeDryRunIndex);
    expect(applyCalls[6]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[6]?.input).toBe(applyCalls[5]?.input);
    expect(productJobDeleteIndex).toBeGreaterThan(secretMaterializeApplyIndex);
    expect(productBootstrapDryRunIndex).toBeGreaterThan(productJobDeleteIndex);
    expect(applyCalls[7]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[7]?.input).not.toContain('kind: Deployment');
    expect(applyCalls[7]?.input).not.toContain('name: agentsmith-api');
    expect(applyCalls[7]?.input).not.toContain('name: afscp-api');
    expect(applyCalls[7]?.input).toContain('kind: ServiceAccount');
    expect(applyCalls[7]?.input).toContain('name: agentsmith-app');
    expect(applyCalls[7]?.input).toContain('name: agentsmith-app-config');
    expect(applyCalls[7]?.input).toContain('name: agentsmith-app-secrets');
    expect(applyCalls[7]?.input).toContain('name: substrate-postgresql');
    expect(applyCalls[7]?.input).toContain('name: substrate-minio');
    expect(applyCalls[7]?.input).toContain('kubernetes.io/service-name: substrate-postgresql');
    expect(applyCalls[7]?.input).toContain('kubernetes.io/service-name: substrate-minio');
    expect(applyCalls[7]?.input).toContain('kind: Job');
    expect(applyCalls[7]?.input).toContain('name: agentsmith-product-schema-bootstrap');
    expect(applyCalls[7]?.input).toContain('packages/api-entry-node/dist/product-schema-bootstrap.js');
    expect(applyCalls[7]?.input).toContain(`image: ${`kind-registry:5000/mbos/agentsmith-app@${APP_DIGEST}`}`);
    expect(applyCalls[7]?.input).toContain('secretKeyRef:');
    expect(applyCalls[7]?.input).toContain('key: DATABASE_URL');
    expect(applyCalls[7]?.input).not.toContain('postgresql://sentinel_pg_user:sentinel_pg_secret');
    expect(applyCalls[7]?.input).not.toContain('mongodb://sentinel_mongo_user:sentinel_mongo_secret');
    expect(applyCalls[7]?.input).not.toContain('redis://:sentinel_redis_secret');
    expect(applyCalls[7]?.input).toContain('MINIO_PORT: "9000"');
    expect(applyCalls[7]?.input).toContain('INTERNAL_KEYCLOAK_BASE_URL: http://substrate-keycloak:8080');
    expect(applyCalls[7]?.input).not.toContain('name: afscp-schema-bootstrap');
    expect(applyCalls[7]?.input).not.toContain('name: afscp-volume-bootstrap');
    expect(applyCalls[7]?.input).not.toContain('name: afscp-runtime-config');
    expect(applyCalls[7]?.input).not.toContain('name: afscp-runtime-secrets');
    expect(applyCalls[7]?.input).not.toContain('/usr/local/bin/afscp-volume-bootstrap');
    expect(applyCalls[7]?.input).not.toContain('/usr/local/bin/afscp-migrate');
    expect(applyCalls[7]?.input).not.toContain('kind: PersistentVolume');
    expect(applyCalls[7]?.input).not.toContain('kind: PersistentVolumeClaim');
    expect(applyCalls[8]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[8]?.input).toContain('name: agentsmith-product-schema-bootstrap');
    expect(applyCalls[8]?.input).not.toContain('name: afscp-schema-bootstrap');
    expect(productJobPollIndex).toBeGreaterThan(productBootstrapApplyIndex);
    expect(schemaJobDeleteIndex).toBeGreaterThan(productJobPollIndex);
    expect(volumeJobDeleteIndex).toBeGreaterThan(schemaJobDeleteIndex);
    expect(schemaBootstrapDryRunIndex).toBeGreaterThan(volumeJobDeleteIndex);
    expect(applyCalls[9]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[9]?.input).not.toContain('kind: Deployment');
    expect(applyCalls[9]?.input).not.toContain('name: agentsmith-api');
    expect(applyCalls[9]?.input).not.toContain('name: afscp-api');
    expect(applyCalls[9]?.input).toContain('kind: ServiceAccount');
    expect(applyCalls[9]?.input).toContain('name: afscp-runtime');
    expect(applyCalls[9]?.input).toContain('name: afscp-runtime-config');
    expect(applyCalls[9]?.input).toContain('name: afscp-runtime-secrets');
    expect(applyCalls[9]?.input).toContain(`name: ${SENTINEL_AFSCP_VOLUME_REF}`);
    expect(applyCalls[9]?.input).toContain('kind: Job');
    expect(applyCalls[9]?.input).toContain('name: afscp-schema-bootstrap');
    expect(applyCalls[9]?.input).toContain('/usr/local/bin/afscp-migrate');
    expect(applyCalls[9]?.input).toContain('--apply');
    expect(applyCalls[9]?.input).toContain('--check');
    expect(applyCalls[9]?.input).not.toContain('name: agentsmith-product-schema-bootstrap');
    expect(applyCalls[9]?.input).not.toContain('name: afscp-volume-bootstrap');
    expect(applyCalls[9]?.input).not.toContain('/usr/local/bin/afscp-volume-bootstrap');
    expect(applyCalls[9]?.input).not.toContain('kubernetes.io/service-name: substrate-postgresql');
    expect(applyCalls[9]?.input).toContain('AFSCP_DEFAULT_VOLUME_ID: vol_agentsmith_default');
    expect(applyCalls[9]?.input).toContain('AFSCP_DEFAULT_VOLUME_BACKEND: juicefs');
    expect(applyCalls[9]?.input).toContain('AFSCP_DEFAULT_VOLUME_STATUS: active');
    expect(applyCalls[9]?.input).toContain('AFSCP_DEFAULT_VOLUME_CAPABILITIES_JSON:');
    expect(applyCalls[9]?.input).toContain('"jvs_external_control_root":true');
    expect(applyCalls[9]?.input).toContain(`AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS: vol_agentsmith_default=agentsmith/${SENTINEL_AFSCP_VOLUME_REF}`);
    expect(applyCalls[9]?.input).toContain('nodePublishSecretRef:');
    expect(applyCalls[9]?.input).not.toContain('metaurl: postgres://sentinel_pg_user:sentinel_pg_secret');
    expect(applyCalls[9]?.input).not.toContain('bucket: http://substrate-minio.agentsmith.svc.cluster.local:9000/sentinel-files');
    expect(applyCalls[9]?.input).toContain('kind: PersistentVolume');
    expect(applyCalls[9]?.input).toContain('name: agentsmith-afscp-default-volume');
    expect(applyCalls[9]?.input).toContain('kind: PersistentVolumeClaim');
    expect(applyCalls[9]?.input).toContain('storage: 12P');
    expect(applyCalls[9]?.input).toContain('AFSCP_JVS_ENABLED: "true"');
    expect(applyCalls[9]?.input).toContain('AFSCP_JVS_READY: "true"');
    expect(applyCalls[9]?.input).toContain('AFSCP_JVS_CWD: /data/afscp/jvs-cwd');
    expect(applyCalls[9]?.input).not.toContain('AFSCP_JVS_BINARY_PATH');
    expect(applyCalls[9]?.input).not.toContain('AFSCP_JVS_BINARY_SHA256');
    expect(applyCalls[9]?.input).not.toContain('storage: 8Pi');
    expect(applyCalls[9]?.input).not.toContain('storage: 10Pi');
    expect(applyCalls[9]?.input).not.toContain('volumeAttributes:\n              subPath: "afscp/vol_agentsmith_default"');
    expect(applyCalls[9]?.input).not.toMatch(/name: afscp-volume-bootstrap[\s\S]*\/usr\/local\/bin\/afscp-volume-bootstrap/u);
    expect(applyCalls[9]?.input).not.toContain('@substrate-postgresql:15432/');
    expect(applyCalls[9]?.input).not.toContain('@substrate-mongodb:27027/');
    expect(applyCalls[9]?.input).not.toContain('@substrate-redis:16379/');
    expect(applyCalls[9]?.input).not.toContain('kind: ClusterRole');
    expect(applyCalls[9]?.input).not.toContain('persistentvolumes');
    expect(applyCalls[9]?.input).not.toContain('execution-gateway');
    expect(applyCalls[10]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[10]?.input).not.toContain('kind: Deployment');
    expect(applyCalls[10]?.input).not.toContain('name: afscp-volume-bootstrap');
    expect(schemaJobPollIndex).toBeGreaterThan(schemaBootstrapApplyIndex);
    expect(volumeBootstrapDryRunIndex).toBeGreaterThan(schemaJobPollIndex);
    expect(applyCalls[11]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[11]?.input).toContain('kind: Job');
    expect(applyCalls[11]?.input).toContain('name: afscp-volume-bootstrap');
    expect(applyCalls[11]?.input).toContain('/usr/local/bin/afscp-volume-bootstrap');
    expect(applyCalls[11]?.input).toContain('--ensure');
    expect(applyCalls[11]?.input).toContain('--check');
    expect(applyCalls[11]?.input).toMatch(
      /name: afscp-volume-bootstrap[\s\S]*?initContainers:\s*\n\s*- name: afscp-postgresql-ready[\s\S]*?- name: afscp-schema-bootstrap[\s\S]*?command:\s*\n\s*- \/usr\/local\/bin\/afscp-migrate[\s\S]*?- --apply[\s\S]*?- --check[\s\S]*?containers:\s*\n\s*- name: afscp-volume-bootstrap/u,
    );
    expect(applyCalls[11]?.input).toMatch(
      /name: afscp-volume-bootstrap[\s\S]*?command:\s*\n\s*- \/usr\/local\/bin\/afscp-volume-bootstrap\s*\n\s*args:\s*\n\s*- --ensure\s*\n\s*- --check\s*\n\s*- --timeout=60s/u,
    );
    expect(applyCalls[11]?.input).not.toContain('kind: Deployment');
    expect(applyCalls[11]?.input).not.toContain('kind: PersistentVolume');
    expect(applyCalls[11]?.input).not.toContain('kind: PersistentVolumeClaim');
    expect(applyCalls[11]?.input).not.toContain('kind: ServiceAccount');
    expect(applyCalls[11]?.input).not.toMatch(/name: afscp-volume-bootstrap[\s\S]*\/usr\/local\/bin\/afscp-volume-bootstrap[\s\S]*- --apply/u);
    expect(applyCalls[12]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[12]?.input).toContain('name: afscp-volume-bootstrap');
    expect(applyCalls[12]?.input).toContain('name: afscp-schema-bootstrap');
    expect(volumeJobPollIndex).toBeGreaterThan(volumeBootstrapApplyIndex);
    expect(appDryRunIndex).toBeGreaterThan(volumeJobPollIndex);
    expect(applyCalls[13]?.args).toEqual(expect.arrayContaining(['apply', '--dry-run=server', '-f', '-']));
    expect(applyCalls[13]?.input).toContain('Deployment');
    expect(applyCalls[13]?.input).toContain('name: agentsmith-api');
    expect(applyCalls[13]?.input).toContain('name: afscp-api');
    expect(applyCalls[13]?.input).toContain('name: afscp-schema-check');
    expect(applyCalls[13]?.input).toContain('name: INTERNAL_AGENT_IMAGE');
    expect(applyCalls[13]?.input).toContain(`value: ${`kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`}`);
    expect(applyCalls[13]?.input).not.toContain('name: agentsmith-web-secrets');
    expect(applyCalls[13]?.input).not.toContain('DATABASE_URL: postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:5432/sentinel_pg_db');
    expect(applyCalls[13]?.input).not.toContain('MONGO_URL: mongodb://sentinel_mongo_user:sentinel_mongo_secret@substrate-mongodb:27017/admin');
    expect(applyCalls[13]?.input).not.toContain('REDIS_URL: redis://:sentinel_redis_secret@substrate-redis:6379/0');
    expect(applyCalls[13]?.input).not.toContain('sentinel_minio_secret');
    expect(applyCalls[13]?.input).not.toContain('MINIO_PORT: "9000"');
    expect(applyCalls[13]?.input).not.toContain('INTERNAL_KEYCLOAK_BASE_URL: http://substrate-keycloak:8080');
    expect(applyCalls[13]?.input).not.toContain('INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE');
    expect(applyCalls[13]?.input).not.toContain('INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE');
    expect(applyCalls[13]?.input).not.toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT');
    expect(applyCalls[13]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-app-config: sha256:[a-f0-9]{64}/u);
    expect(applyCalls[13]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-app-secrets: sha256:[a-f0-9]{64}/u);
    expect(applyCalls[13]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-llmup-config: sha256:[a-f0-9]{64}/u);
    expect(applyCalls[13]?.input).toMatch(/agentsmith\.mbos\.dev\/checksum-asbcp-config: sha256:[a-f0-9]{64}/u);
    expect(applyCalls[13]?.input).toContain('name: afscp-jvs-cwd');
    expect(applyCalls[13]?.input).toContain('mountPath: /data/afscp/jvs-cwd');
    expect(applyCalls[13]?.input).toContain('claimName: afscp-default-volume');
    expect(applyCalls[13]?.input).toContain('emptyDir: {}');
    expect(applyCalls[13]?.input).not.toContain('name: agentsmith-product-schema-bootstrap');
    expect(applyCalls[13]?.input).not.toContain('name: afscp-schema-bootstrap');
    expect(applyCalls[13]?.input).not.toContain('name: afscp-volume-bootstrap');
    expect(applyCalls[13]?.input).not.toContain('kind: PersistentVolume');
    expect(applyCalls[13]?.input).not.toContain('kind: PersistentVolumeClaim');
    expect(applyCalls[13]?.input).not.toContain('@substrate-postgresql:15432/');
    expect(applyCalls[13]?.input).not.toContain('@substrate-mongodb:27027/');
    expect(applyCalls[13]?.input).not.toContain('@substrate-redis:16379/');
    expect(applyCalls[13]?.input).not.toContain('kind: ClusterRole');
    expect(applyCalls[13]?.input).not.toContain('persistentvolumes');
    expect(applyCalls[13]?.input).not.toContain('execution-gateway');
    expect(applyCalls[14]?.args).toEqual(expect.arrayContaining(['apply', '-f', '-']));
    expect(applyCalls[14]?.input).not.toContain('name: agentsmith-product-schema-bootstrap');
    expect(applyCalls[14]?.input).not.toContain('name: afscp-schema-bootstrap');
    expect(applyCalls[14]?.input).not.toContain('name: afscp-volume-bootstrap');
    expect(firstAppRolloutIndex).toBeGreaterThan(appApplyIndex);
    expect(rolloutCalls.map((call) => call.args.join(' '))).toEqual(expect.arrayContaining([
      expect.stringContaining('rollout status deployment/agentsmith-web'),
      expect.stringContaining('rollout status deployment/agentsmith-api'),
      expect.stringContaining('rollout status deployment/agentsmith-llmup'),
      expect.stringContaining('rollout status deployment/agentsmith-sandbox-control-plane'),
    ]));
    const rolloutCommands = rolloutCalls.map((call) => call.args.join(' '));
    expect(rolloutCommands.some((command) =>
      command.includes('rollout status deployment/agentsmith-web')
      && command.includes('--timeout=30s'),
    )).toBe(true);
    expect(rolloutCommands.some((command) =>
      command.includes('rollout status deployment/afscp-api')
      && command.includes('--timeout=180s'),
    )).toBe(true);
    expect(rolloutCalls.find((call) =>
      call.args.join(' ').includes('rollout status deployment/afscp-api'),
    )?.timeoutMs).toBeGreaterThanOrEqual(180_000);
    expect(rolloutCommands.some((command) =>
      command.includes('rollout status deployment/afscp-worker')
      && command.includes('--timeout=180s'),
    )).toBe(true);
    expect(rolloutCommands.some((command) =>
      command.includes('rollout status deployment/afscp-export-gateway')
      && command.includes('--timeout=180s'),
    )).toBe(true);
    expect(result.evidence.rendered_manifest_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.evidence.substrate_truth_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.evidence.substrate_live_check.status).toBe('passed');
    expect(result.evidence.manifest_summary.resources).toEqual(expect.arrayContaining([
      'Job/agentsmith-product-schema-bootstrap',
      'Job/afscp-schema-bootstrap',
      'Job/afscp-volume-bootstrap',
      'PersistentVolume/agentsmith-afscp-default-volume',
      'PersistentVolumeClaim/afscp-default-volume',
    ]));
    expect(result.evidence.operations.map((operation) => operation.name)).toEqual(expect.arrayContaining([
      'afscp-storage-csi-apply',
      'afscp-storage-csi-controller-scale',
      'afscp-storage-csi-controller-rollout',
      'afscp-storage-csi-node-rollout',
      'product-schema-bootstrap-delete-previous',
      'product-schema-bootstrap-dry-run',
      'product-schema-bootstrap-apply',
      'product-schema-bootstrap-wait',
      'afscp-schema-bootstrap-delete-previous',
      'afscp-schema-bootstrap-wait',
      'afscp-volume-bootstrap-delete-previous',
      'afscp-volume-bootstrap-wait',
      'afscp-functional-convergence-check',
    ]));
    expect(result.evidence.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'afscp-functional-convergence-check',
        status: 'passed',
        stdout: expect.stringContaining('afscp-functional-convergence'),
      }),
    ]));
    expect(result.evidence.image_preflight.status).toBe('passed');
    expect(result.evidence.image_preflight.image_refs).toContain(`kind-registry:5000/mbos/agentsmith-managed-runner@${MANAGED_RUNNER_DIGEST}`);
    expect(result.evidence.asbcp_image_adoption).toMatchObject({
      status: 'passed',
      source_digest: ASBCP_DIGEST,
      target_digest: ASBCP_DIGEST,
      site_env_ref: `kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`,
      rendered_ref: `kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`,
      running_image_ids: [
        `docker-pullable://kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`,
      ],
    });
    expect(result.evidence.stale_resource_absence_check).toMatchObject({
      status: 'passed',
      scope: 'absence_only',
      absent: expect.arrayContaining([
        LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS[0],
        LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS[1],
        LEGACY_ASBCP_NAMESPACED_RESOURCE_IDS[2],
        LEGACY_ASBCP_LOCAL_KIND_CLUSTER_RESOURCE_IDS[0],
        LEGACY_ASBCP_LOCAL_KIND_CLUSTER_RESOURCE_IDS[1],
      ]),
    });
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

  it('materializes CA-aware runtime Secrets when local-kind substrate truth declares strict TLS', async () => {
    const root = tempDir('local-kind-strict-tls-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const substrateTruthPath = writeStrictTlsSubstrateTruth(root);
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: {
        KUBECONFIG: kubeconfigPath,
        ...createReadyLocalKindImageImportEnv({ root, siteEnvPath }),
      },
      homeDir: root,
      siteEnvPath,
      substrateTruthPath,
      runner: createPassingRunner(calls),
      probeRunner: passingProbeRunner,
    });
    const secretMaterializeDryRun = calls
      .filter((call) => call.args.includes('apply'))
      .find((call) =>
        call.args.includes('--dry-run=server')
        && call.input.includes('name: agentsmith-app-secrets')
        && call.input.includes('name: afscp-runtime-secrets'),
      );
    const productBootstrapDryRun = calls
      .filter((call) => call.args.includes('apply'))
      .find((call) =>
        call.args.includes('--dry-run=server')
        && call.input.includes('name: agentsmith-product-schema-bootstrap')
        && call.input.includes('MINIO_USE_SSL: "true"'),
      );
    const appDryRun = calls
      .filter((call) => call.args.includes('apply'))
      .find((call) =>
        call.args.includes('--dry-run=server')
        && call.input.includes('name: agentsmith-api')
        && call.input.includes('name: NODE_EXTRA_CA_CERTS'),
      );
    const postgresCaMirrorApply = calls
      .filter((call) => call.args.includes('apply'))
      .find((call) =>
        !call.args.includes('--dry-run=server')
        && call.input.includes('agentsmith.mbos.dev/secret-role: juicefs-csi-postgresql-ca-mirror')
        && call.input.includes('namespace: kube-system'),
      );
    const objectStorageCaMirrorApply = calls
      .filter((call) => call.args.includes('apply'))
      .find((call) =>
        !call.args.includes('--dry-run=server')
        && call.input.includes('agentsmith.mbos.dev/secret-role: juicefs-csi-object-storage-ca-mirror')
        && call.input.includes('namespace: kube-system'),
      );
    const csiNodeRolloutIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('rollout status daemonset/juicefs-csi-node'),
    );
    const postgresCaMirrorApplyIndex = calls.indexOf(postgresCaMirrorApply as CommandCall);
    const objectStorageCaMirrorApplyIndex = calls.indexOf(objectStorageCaMirrorApply as CommandCall);
    const secretDocuments = parseKubernetesDocuments(secretMaterializeDryRun?.input ?? '').documents;
    const volumeSecret = secretDocuments.find((document) =>
      document.kind === 'Secret'
      && String(asRecord(document.metadata).name).startsWith('afscp-default-volume-juicefs-'),
    );
    if (!volumeSecret) {
      throw new Error('expected revisioned AFSCP volume Secret in local-kind existing secrets');
    }
    const volumeSecretData = asRecord(volumeSecret.stringData);

    expect(result.status, JSON.stringify(result.failures, null, 2)).toBe('passed');
    expect(secretMaterializeDryRun?.input).toContain('DATABASE_URL: "postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:5432/sentinel_pg_db?sslmode=verify-full&sslrootcert=/etc/agentsmith/substrate-ca/postgresql/ca.crt"');
    expect(secretMaterializeDryRun?.input).toContain('MONGO_URL: "mongodb://sentinel_mongo_user:sentinel_mongo_secret@substrate-mongodb:27017/admin?tls=true&tlsCAFile=/etc/agentsmith/substrate-ca/mongodb/ca.crt"');
    expect(secretMaterializeDryRun?.input).toContain('REDIS_URL: "rediss://:sentinel_redis_secret@substrate-redis:6379/0"');
    expect(secretMaterializeDryRun?.input).toContain('AFSCP_POSTGRES_DSN: "postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:5432/sentinel_pg_db?sslmode=verify-full&sslrootcert=/etc/agentsmith/substrate-ca/postgresql/ca.crt"');
    expect(secretMaterializeDryRun?.input).toContain('metaurl: "postgres://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql.agentsmith.svc.cluster.local:5432/sentinel_pg_db?sslmode=verify-full&sslrootcert=/etc/agentsmith/substrate-ca/postgresql/ca.crt"');
    expect(volumeSecretData.configs).toBe('{"postgresql-ca":"/etc/agentsmith/substrate-ca/postgresql","object-storage-ca":"/etc/agentsmith/substrate-ca/object-storage"}');
    expect(volumeSecretData.envs).toBe('{"SSL_CERT_DIR":"/etc/agentsmith/substrate-ca/object-storage"}');
    expect(postgresCaMirrorApply?.input).toContain('name: postgresql-ca');
    expect(postgresCaMirrorApply?.input).toContain('namespace: kube-system');
    expect(postgresCaMirrorApply?.input).toContain('agentsmith.mbos.dev/mirrored-from: agentsmith/postgresql-ca');
    expect(postgresCaMirrorApply?.input).toContain('ca.crt: ');
    expect(objectStorageCaMirrorApply?.input).toContain('name: object-storage-ca');
    expect(objectStorageCaMirrorApply?.input).toContain('namespace: kube-system');
    expect(objectStorageCaMirrorApply?.input).toContain('agentsmith.mbos.dev/mirrored-from: agentsmith/object-storage-ca');
    expect(objectStorageCaMirrorApply?.input).toContain('ca.crt: ');
    expect(postgresCaMirrorApplyIndex).toBeGreaterThanOrEqual(0);
    expect(objectStorageCaMirrorApplyIndex).toBeGreaterThanOrEqual(0);
    expect(csiNodeRolloutIndex).toBeGreaterThan(postgresCaMirrorApplyIndex);
    expect(csiNodeRolloutIndex).toBeGreaterThan(objectStorageCaMirrorApplyIndex);
    expect(secretMaterializeDryRun?.input).toContain('bucket: "https://substrate-minio.agentsmith.svc.cluster.local:9000/sentinel-files"');
    expect(productBootstrapDryRun?.input).toContain('MINIO_USE_SSL: "true"');
    expect(productBootstrapDryRun?.input).toContain('INTERNAL_KEYCLOAK_BASE_URL: https://substrate-keycloak:8080');
    expect(appDryRun?.input).toContain('name: substrate-postgresql-ca');
    expect(appDryRun?.input).toContain('secretName: postgresql-ca');
    expect(appDryRun?.input).toContain('name: substrate-object-storage-ca');
    expect(appDryRun?.input).toContain('secretName: object-storage-ca');
    expect(appDryRun?.input).toContain('name: NODE_EXTRA_CA_CERTS');
    expect(appDryRun?.input).toContain('value: /etc/agentsmith/substrate-ca-bundle/ca-bundle.crt');
    expect(appDryRun?.input).toContain('name: SSL_CERT_DIR');
  });

  it('mirrors a custom Postgres CA source Secret into the stable JuiceFS CSI alias', async () => {
    const root = tempDir('local-kind-custom-postgres-ca-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const substrateTruthPath = writeStrictTlsSubstrateTruth(root, (source) => source.replace(
      /^SUBSTRATE_POSTGRES_CA_SECRET_REF=.*$/mu,
      'SUBSTRATE_POSTGRES_CA_SECRET_REF=secretRef:agentsmith/custom-postgres-ca',
    ));
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: {
        KUBECONFIG: kubeconfigPath,
        ...createReadyLocalKindImageImportEnv({ root, siteEnvPath }),
      },
      homeDir: root,
      siteEnvPath,
      substrateTruthPath,
      runner: createPassingRunner(calls, 'kind-agentsmith', {
        'custom-postgres-ca': 'Y3VzdG9tLXBvc3RncmVzLWNh',
      }),
      probeRunner: passingProbeRunner,
    });
    const secretMaterializeDryRun = calls
      .filter((call) => call.args.includes('apply'))
      .find((call) =>
        call.args.includes('--dry-run=server')
        && call.input.includes('name: agentsmith-app-secrets')
        && call.input.includes('name: afscp-runtime-secrets'),
      );
    const secretDocuments = parseKubernetesDocuments(secretMaterializeDryRun?.input ?? '').documents;
    const volumeSecret = secretDocuments.find((document) =>
      document.kind === 'Secret'
      && String(asRecord(document.metadata).name).startsWith('afscp-default-volume-juicefs-'),
    );
    if (!volumeSecret) {
      throw new Error('expected revisioned AFSCP volume Secret in local-kind existing secrets');
    }
    const volumeSecretData = asRecord(volumeSecret.stringData);
    const postgresCaMirrorApply = calls
      .filter((call) => call.args.includes('apply'))
      .find((call) =>
        !call.args.includes('--dry-run=server')
        && call.input.includes('agentsmith.mbos.dev/secret-role: juicefs-csi-postgresql-ca-mirror')
        && call.input.includes('namespace: kube-system'),
      );

    expect(result.status, JSON.stringify(result.failures, null, 2)).toBe('passed');
    expect(calls.some((call) => call.args.join(' ').includes('get secret custom-postgres-ca -o json'))).toBe(true);
    expect(volumeSecretData.configs).toBe('{"postgresql-ca":"/etc/agentsmith/substrate-ca/postgresql","object-storage-ca":"/etc/agentsmith/substrate-ca/object-storage"}');
    expect(postgresCaMirrorApply?.input).toContain('name: postgresql-ca');
    expect(postgresCaMirrorApply?.input).toContain('agentsmith.mbos.dev/mirrored-from: agentsmith/custom-postgres-ca');
  });

  it('keeps distinct JuiceFS CA configs when Postgres and object storage share a source Secret name', async () => {
    const root = tempDir('local-kind-shared-ca-source-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const substrateTruthPath = writeStrictTlsSubstrateTruth(root, (source) => source
      .replace(
        /^SUBSTRATE_POSTGRES_CA_SECRET_REF=.*$/mu,
        'SUBSTRATE_POSTGRES_CA_SECRET_REF=secretRef:agentsmith/shared-substrate-ca',
      )
      .replace(
        /^SUBSTRATE_OBJECT_STORAGE_CA_SECRET_REF=.*$/mu,
        'SUBSTRATE_OBJECT_STORAGE_CA_SECRET_REF=secretRef:agentsmith/shared-substrate-ca',
      ));
    const calls: CommandCall[] = [];

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: {
        KUBECONFIG: kubeconfigPath,
        ...createReadyLocalKindImageImportEnv({ root, siteEnvPath }),
      },
      homeDir: root,
      siteEnvPath,
      substrateTruthPath,
      runner: createPassingRunner(calls, 'kind-agentsmith', {
        'shared-substrate-ca': 'c2hhcmVkLXN1YnN0cmF0ZS1jYQ==',
      }),
      probeRunner: passingProbeRunner,
    });
    const secretMaterializeDryRun = calls
      .filter((call) => call.args.includes('apply'))
      .find((call) =>
        call.args.includes('--dry-run=server')
        && call.input.includes('name: agentsmith-app-secrets')
        && call.input.includes('name: afscp-runtime-secrets'),
      );
    const secretDocuments = parseKubernetesDocuments(secretMaterializeDryRun?.input ?? '').documents;
    const volumeSecret = secretDocuments.find((document) =>
      document.kind === 'Secret'
      && String(asRecord(document.metadata).name).startsWith('afscp-default-volume-juicefs-'),
    );
    if (!volumeSecret) {
      throw new Error('expected revisioned AFSCP volume Secret in local-kind existing secrets');
    }
    const volumeSecretData = asRecord(volumeSecret.stringData);
    const postgresCaMirrorApply = calls
      .filter((call) => call.args.includes('apply'))
      .find((call) =>
        !call.args.includes('--dry-run=server')
        && call.input.includes('agentsmith.mbos.dev/secret-role: juicefs-csi-postgresql-ca-mirror')
        && call.input.includes('namespace: kube-system'),
      );
    const objectStorageCaMirrorApply = calls
      .filter((call) => call.args.includes('apply'))
      .find((call) =>
        !call.args.includes('--dry-run=server')
        && call.input.includes('agentsmith.mbos.dev/secret-role: juicefs-csi-object-storage-ca-mirror')
        && call.input.includes('namespace: kube-system'),
      );

    expect(result.status, JSON.stringify(result.failures, null, 2)).toBe('passed');
    expect(calls.filter((call) => call.args.join(' ').includes('get secret shared-substrate-ca -o json'))).toHaveLength(2);
    expect(volumeSecretData.configs).toBe('{"postgresql-ca":"/etc/agentsmith/substrate-ca/postgresql","object-storage-ca":"/etc/agentsmith/substrate-ca/object-storage"}');
    expect(volumeSecretData.envs).toBe('{"SSL_CERT_DIR":"/etc/agentsmith/substrate-ca/object-storage"}');
    expect(postgresCaMirrorApply?.input).toContain('name: postgresql-ca');
    expect(postgresCaMirrorApply?.input).toContain('agentsmith.mbos.dev/mirrored-from: agentsmith/shared-substrate-ca');
    expect(objectStorageCaMirrorApply?.input).toContain('name: object-storage-ca');
    expect(objectStorageCaMirrorApply?.input).toContain('agentsmith.mbos.dev/mirrored-from: agentsmith/shared-substrate-ca');
  });

  it('fails ASBCP image adoption when running Pods are mixed old and target digests', async () => {
    const root = tempDir('local-kind-mixed-asbcp-image-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
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
                    imageID: `docker-pullable://kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`,
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
                    imageID: `docker-pullable://kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${OLD_ASBCP_DIGEST}`,
                  },
                ],
              },
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
        `docker-pullable://kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${ASBCP_DIGEST}`,
        `docker-pullable://kind-registry:5000/mbos/agentsmith-sandbox-control-plane@${OLD_ASBCP_DIGEST}`,
      ]),
    });
  });

  it('runs an AFSCP functional convergence check after workload rollouts and captures runtime diagnostics when it fails', async () => {
    const root = tempDir('local-kind-afscp-functional-convergence-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const passing = createPassingRunner(calls);
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      const joined = args.join(' ');
      const recordCall = () => calls.push({ command, args, input: options.input ?? '', timeoutMs: options.timeoutMs });

      if (joined.includes('exec deployment/agentsmith-api') && (options.input ?? '').includes('afscp-functional-convergence')) {
        recordCall();
        return {
          exitCode: 1,
          stdout: '{"stage":"volume_binding","operation_state":"pending"}',
          stderr: 'timed out waiting for AFSCP volume binding operation',
        };
      }

      for (const component of ['afscp-api', 'afscp-worker', 'afscp-export-gateway']) {
        if (joined.includes(`get pods -l app.kubernetes.io/component=${component}`)) {
          recordCall();
          return jsonResult({
            kind: 'List',
            items: [
              {
                kind: 'Pod',
                metadata: { name: `${component}-test-pod` },
              },
            ],
          });
        }
      }

      if (joined.includes('logs pod/afscp-worker-test-pod') && !joined.includes('--previous')) {
        recordCall();
        return { exitCode: 0, stdout: 'worker log: volume binding operation still pending', stderr: '' };
      }
      if (joined.includes('logs pod/afscp-api-test-pod') && !joined.includes('--previous')) {
        recordCall();
        return { exitCode: 0, stdout: 'api log: accepted namespace operation', stderr: '' };
      }
      if (joined.includes('logs pod/afscp-export-gateway-test-pod') && !joined.includes('--previous')) {
        recordCall();
        return { exitCode: 0, stdout: 'export gateway log: listener ready', stderr: '' };
      }
      if (joined.includes('logs pod/') && joined.includes('--previous')) {
        recordCall();
        return { exitCode: 0, stdout: 'previous runtime log: none', stderr: '' };
      }
      if (joined.includes('describe pod/')) {
        recordCall();
        return { exitCode: 0, stdout: 'pod describe: containers are running', stderr: '' };
      }
      if (joined.includes('get events') && joined.includes('afscp-')) {
        recordCall();
        return { exitCode: 0, stdout: 'runtime event: no recent warnings', stderr: '' };
      }
      if (joined.includes('describe deployment/afscp-')) {
        recordCall();
        return { exitCode: 0, stdout: 'deployment describe: available', stderr: '' };
      }

      return passing(command, args, options);
    };

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner,
      probeRunner: async () => {
        throw new Error('route probes must not run after AFSCP functional convergence fails');
      },
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });

    const commandText = calls.map((call) => call.args.join(' ')).join('\n');
    const afscpExportGatewayRolloutIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('rollout status deployment/afscp-export-gateway'),
    );
    const functionalCheckIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('exec deployment/agentsmith-api'),
    );

    expect(result.status).toBe('failed');
    expect(functionalCheckIndex).toBeGreaterThan(afscpExportGatewayRolloutIndex);
    expect(commandText).toContain('logs pod/afscp-worker-test-pod --all-containers=true');
    expect(commandText).toContain('logs pod/afscp-api-test-pod --all-containers=true');
    expect(commandText).toContain('logs pod/afscp-export-gateway-test-pod --all-containers=true');
    expect(commandText).toContain('describe pod/afscp-api-test-pod');
    expect(commandText).toContain('get events --field-selector=involvedObject.kind=Pod,involvedObject.name=afscp-export-gateway-test-pod');
    expect(result.evidence.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'afscp-functional-convergence-check',
        status: 'failed',
        stderr: expect.stringContaining('volume binding operation'),
      }),
      expect.objectContaining({
        name: 'afscp-functional-diagnostics-pod-logs',
        stdout: expect.stringContaining('worker log'),
      }),
      expect.objectContaining({
        name: 'afscp-functional-diagnostics-deployment-describe',
        stdout: expect.stringContaining('available'),
      }),
    ]));
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'afscp-functional-convergence:check',
        message: expect.stringContaining('volume binding operation'),
      }),
    ]));
    expect(result.evidence.route_probes).toEqual([]);
  });

  it('waits for product schema bootstrap before AFSCP and app rollouts and fails closed when it does not complete', async () => {
    const root = tempDir('local-kind-product-schema-bootstrap-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const passing = createPassingRunner(calls);
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      const joined = args.join(' ');
      const recordCall = () => calls.push({ command, args, input: options.input ?? '' });
      if (joined.includes('get pods -l job-name=agentsmith-product-schema-bootstrap')) {
        recordCall();
        return jsonResult({
          kind: 'List',
          items: [
            {
              kind: 'Pod',
              metadata: { name: 'agentsmith-product-schema-bootstrap-test-pod' },
            },
          ],
        });
      }
      if (joined.includes('logs pod/agentsmith-product-schema-bootstrap-test-pod') && joined.includes('--previous')) {
        recordCall();
        return { exitCode: 0, stdout: 'previous product schema log: no previous container', stderr: '' };
      }
      if (joined.includes('logs pod/agentsmith-product-schema-bootstrap-test-pod')) {
        recordCall();
        return { exitCode: 0, stdout: 'current product schema log: relation check failed', stderr: '' };
      }
      if (joined.includes('describe pod/agentsmith-product-schema-bootstrap-test-pod')) {
        recordCall();
        return { exitCode: 0, stdout: 'pod describe: product schema container terminated with Error', stderr: '' };
      }
      if (joined.includes('get events') && joined.includes('agentsmith-product-schema-bootstrap-test-pod')) {
        recordCall();
        return { exitCode: 0, stdout: 'pod event: product schema BackOff', stderr: '' };
      }
      if (joined.includes('get job/agentsmith-product-schema-bootstrap -o yaml')) {
        recordCall();
        return { exitCode: 0, stdout: 'kind: Job\nmetadata:\n  name: agentsmith-product-schema-bootstrap\n', stderr: '' };
      }
      if (joined.includes('describe job/agentsmith-product-schema-bootstrap')) {
        recordCall();
        return { exitCode: 0, stdout: 'job describe: BackoffLimitExceeded', stderr: '' };
      }
      if (joined.includes('get events') && joined.includes('agentsmith-product-schema-bootstrap')) {
        recordCall();
        return { exitCode: 0, stdout: 'job event: Job has reached the specified backoff limit', stderr: '' };
      }
      if (joined.includes('get job/agentsmith-product-schema-bootstrap -o json')) {
        recordCall();
        return jsonResult(failedJob(
          'agentsmith-product-schema-bootstrap',
          'BackoffLimitExceeded',
          'product schema migration exited before completing',
        ));
      }
      return passing(command, args, options);
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

    const commandText = calls.map((call) => call.args.join(' ')).join('\n');
    expect(result.status).toBe('failed');
    expect(commandText).toContain('get job/agentsmith-product-schema-bootstrap -o json');
    expect(commandText).toContain('get pods -l job-name=agentsmith-product-schema-bootstrap -o json');
    expect(commandText).toContain('logs pod/agentsmith-product-schema-bootstrap-test-pod --all-containers=true');
    expect(commandText).toContain('get job/agentsmith-product-schema-bootstrap -o yaml');
    expect(commandText).toContain('describe job/agentsmith-product-schema-bootstrap');
    expect(commandText).not.toContain('delete job afscp-schema-bootstrap');
    expect(commandText).not.toContain('get job/afscp-schema-bootstrap -o json');
    expect(commandText).not.toContain('rollout status deployment/agentsmith-web');
    expect(result.evidence.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'product-schema-bootstrap-diagnostics-pods-json',
      }),
      expect.objectContaining({
        name: 'product-schema-bootstrap-diagnostics-pod-logs',
        stdout: expect.stringContaining('current product schema log'),
      }),
      expect.objectContaining({
        name: 'product-schema-bootstrap-diagnostics-job-yaml',
        stdout: expect.stringContaining('agentsmith-product-schema-bootstrap'),
      }),
      expect.objectContaining({
        name: 'product-schema-bootstrap-diagnostics-job-describe',
        stdout: expect.stringContaining('BackoffLimitExceeded'),
      }),
    ]));
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'product-schema-bootstrap:wait',
        message: expect.stringContaining('BackoffLimitExceeded'),
      }),
    ]));
  });

  it('waits for AFSCP schema bootstrap before app rollouts and fails closed when it does not complete', async () => {
    const root = tempDir('local-kind-afscp-schema-bootstrap-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const passing = createPassingRunner(calls);
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      const joined = args.join(' ');
      const recordCall = () => calls.push({ command, args, input: options.input ?? '' });
      if (joined.includes('get pods -l job-name=afscp-schema-bootstrap')) {
        recordCall();
        return jsonResult({
          kind: 'List',
          items: [
            {
              kind: 'Pod',
              metadata: { name: 'afscp-schema-bootstrap-test-pod' },
            },
          ],
        });
      }
      if (joined.includes('logs pod/afscp-schema-bootstrap-test-pod') && joined.includes('--previous')) {
        recordCall();
        return { exitCode: 0, stdout: 'previous migrate log: missing relation export_runtime_requests', stderr: '' };
      }
      if (joined.includes('logs pod/afscp-schema-bootstrap-test-pod')) {
        recordCall();
        return { exitCode: 0, stdout: 'current migrate log: retrying schema check', stderr: '' };
      }
      if (joined.includes('describe pod/afscp-schema-bootstrap-test-pod')) {
        recordCall();
        return { exitCode: 0, stdout: 'pod describe: container terminated with Error', stderr: '' };
      }
      if (joined.includes('get events') && joined.includes('afscp-schema-bootstrap-test-pod')) {
        recordCall();
        return { exitCode: 0, stdout: 'pod event: BackOff restarting failed container', stderr: '' };
      }
      if (joined.includes('get job/afscp-schema-bootstrap -o yaml')) {
        recordCall();
        return { exitCode: 0, stdout: 'kind: Job\nmetadata:\n  name: afscp-schema-bootstrap\n', stderr: '' };
      }
      if (joined.includes('describe job/afscp-schema-bootstrap')) {
        recordCall();
        return { exitCode: 0, stdout: 'job describe: BackoffLimitExceeded', stderr: '' };
      }
      if (joined.includes('get events') && joined.includes('afscp-schema-bootstrap')) {
        recordCall();
        return { exitCode: 0, stdout: 'job event: Job has reached the specified backoff limit', stderr: '' };
      }
      if (joined.includes('get job/afscp-schema-bootstrap -o json')) {
        recordCall();
        return jsonResult(failedJob(
          'afscp-schema-bootstrap',
          'BackoffLimitExceeded',
          'missing relation export_runtime_requests',
        ));
      }
      return passing(command, args, options);
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

    const commandText = calls.map((call) => call.args.join(' ')).join('\n');
    expect(result.status).toBe('failed');
    expect(commandText).toContain('get job/afscp-schema-bootstrap -o json');
    expect(commandText).not.toContain('wait --for=condition=complete job/afscp-schema-bootstrap');
    expect(commandText).toContain('get pods -l job-name=afscp-schema-bootstrap -o json');
    expect(commandText).toContain('logs pod/afscp-schema-bootstrap-test-pod --all-containers=true');
    expect(commandText).toContain('logs pod/afscp-schema-bootstrap-test-pod --all-containers=true --prefix=true --timestamps=true --previous');
    expect(commandText).toContain('describe pod/afscp-schema-bootstrap-test-pod');
    expect(commandText).toContain('get job/afscp-schema-bootstrap -o yaml');
    expect(commandText).toContain('describe job/afscp-schema-bootstrap');
    expect(commandText).toContain('get events');
    expect(commandText).not.toContain('rollout status deployment/agentsmith-web');
    expect(result.evidence.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'afscp-schema-bootstrap-diagnostics-pods-json',
      }),
      expect.objectContaining({
        name: 'afscp-schema-bootstrap-diagnostics-pod-logs',
        stdout: expect.stringContaining('current migrate log'),
      }),
      expect.objectContaining({
        name: 'afscp-schema-bootstrap-diagnostics-pod-previous-logs',
        stdout: expect.stringContaining('previous migrate log'),
      }),
      expect.objectContaining({
        name: 'afscp-schema-bootstrap-diagnostics-job-yaml',
        stdout: expect.stringContaining('afscp-schema-bootstrap'),
      }),
      expect.objectContaining({
        name: 'afscp-schema-bootstrap-diagnostics-job-describe',
        stdout: expect.stringContaining('BackoffLimitExceeded'),
      }),
    ]));
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'afscp-schema-bootstrap:wait',
        message: expect.stringContaining('BackoffLimitExceeded'),
      }),
    ]));
  });

  it('waits for AFSCP volume bootstrap after schema bootstrap and captures diagnostics when it fails', async () => {
    const root = tempDir('local-kind-afscp-volume-bootstrap-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const passing = createPassingRunner(calls);
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      const joined = args.join(' ');
      const recordCall = () => calls.push({ command, args, input: options.input ?? '' });
      if (joined.includes('get pods -l job-name=afscp-volume-bootstrap')) {
        recordCall();
        return jsonResult({
          kind: 'List',
          items: [
            {
              kind: 'Pod',
              metadata: { name: 'afscp-volume-bootstrap-test-pod' },
            },
          ],
        });
      }
      if (joined.includes('logs pod/afscp-volume-bootstrap-test-pod') && joined.includes('--previous')) {
        recordCall();
        return { exitCode: 0, stdout: 'previous volume bootstrap log: missing active volume metadata', stderr: '' };
      }
      if (joined.includes('logs pod/afscp-volume-bootstrap-test-pod')) {
        recordCall();
        return { exitCode: 0, stdout: 'current volume bootstrap log: checking default volume', stderr: '' };
      }
      if (joined.includes('describe pod/afscp-volume-bootstrap-test-pod')) {
        recordCall();
        return { exitCode: 0, stdout: 'pod describe: volume bootstrap terminated with Error', stderr: '' };
      }
      if (joined.includes('get events') && joined.includes('afscp-volume-bootstrap-test-pod')) {
        recordCall();
        return { exitCode: 0, stdout: 'pod event: BackOff failed volume bootstrap', stderr: '' };
      }
      if (joined.includes('get job/afscp-volume-bootstrap -o yaml')) {
        recordCall();
        return { exitCode: 0, stdout: 'kind: Job\nmetadata:\n  name: afscp-volume-bootstrap\n', stderr: '' };
      }
      if (joined.includes('describe job/afscp-volume-bootstrap')) {
        recordCall();
        return { exitCode: 0, stdout: 'job describe: BackoffLimitExceeded', stderr: '' };
      }
      if (joined.includes('get events') && joined.includes('afscp-volume-bootstrap')) {
        recordCall();
        return { exitCode: 0, stdout: 'job event: Job has reached the specified backoff limit', stderr: '' };
      }
      if (joined.includes('get job/afscp-volume-bootstrap -o json')) {
        recordCall();
        return jsonResult(failedJob(
          'afscp-volume-bootstrap',
          'BackoffLimitExceeded',
          'default volume metadata not active',
        ));
      }
      return passing(command, args, options);
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

    const commandText = calls.map((call) => call.args.join(' ')).join('\n');
    const schemaWaitIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('get job/afscp-schema-bootstrap -o json'),
    );
    const volumeWaitIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('get job/afscp-volume-bootstrap -o json'),
    );

    expect(result.status).toBe('failed');
    expect(volumeWaitIndex).toBeGreaterThan(schemaWaitIndex);
    expect(commandText).toContain('get job/afscp-volume-bootstrap -o json');
    expect(commandText).not.toContain('wait --for=condition=complete job/afscp-volume-bootstrap');
    expect(commandText).toContain('get pods -l job-name=afscp-volume-bootstrap -o json');
    expect(commandText).toContain('logs pod/afscp-volume-bootstrap-test-pod --all-containers=true');
    expect(commandText).toContain('logs pod/afscp-volume-bootstrap-test-pod --all-containers=true --prefix=true --timestamps=true --previous');
    expect(commandText).toContain('describe pod/afscp-volume-bootstrap-test-pod');
    expect(commandText).toContain('get job/afscp-volume-bootstrap -o yaml');
    expect(commandText).toContain('describe job/afscp-volume-bootstrap');
    expect(commandText).not.toContain('rollout status deployment/agentsmith-web');
    expect(result.evidence.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'afscp-volume-bootstrap-diagnostics-pods-json',
      }),
      expect.objectContaining({
        name: 'afscp-volume-bootstrap-diagnostics-pod-logs',
        stdout: expect.stringContaining('current volume bootstrap log'),
      }),
      expect.objectContaining({
        name: 'afscp-volume-bootstrap-diagnostics-pod-previous-logs',
        stdout: expect.stringContaining('previous volume bootstrap log'),
      }),
      expect.objectContaining({
        name: 'afscp-volume-bootstrap-diagnostics-job-yaml',
        stdout: expect.stringContaining('afscp-volume-bootstrap'),
      }),
      expect.objectContaining({
        name: 'afscp-volume-bootstrap-diagnostics-job-describe',
        stdout: expect.stringContaining('BackoffLimitExceeded'),
      }),
    ]));
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'afscp-volume-bootstrap:wait',
        message: expect.stringContaining('BackoffLimitExceeded'),
      }),
    ]));
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
      'afscp-static-volume-reset-diff',
      'afscp-static-volume-reset-delete-workloads',
      'afscp-static-volume-reset-delete-pvc',
      'afscp-static-volume-reset-delete-pv',
    ]));
    expect(result.evidence.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'afscp-static-volume-reset-diff',
        stdout: expect.stringContaining('spec.resources.requests.storage'),
      }),
    ]));
  });

  it('resets owned AFSCP static PVC immutable spec drift with the same storage before bootstrap dry-run', async () => {
    const root = tempDir('local-kind-afscp-pvc-spec-reset-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (command === 'kubectl' && joined.includes('get pvc afscp-default-volume')) {
        const resource = ownedAfscpPersistentVolumeClaim('12P');
        const spec = resource.spec as Record<string, unknown>;
        spec.storageClassName = 'stale-static-class';
        return jsonResult(resource);
      }
      if (command === 'kubectl' && joined.includes('get pv agentsmith-afscp-default-volume')) {
        return jsonResult(ownedAfscpPersistentVolume('12P'));
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
    const bootstrapDryRunIndex = calls.findIndex((call) =>
      call.args.join(' ').includes('apply --dry-run=server') && call.input.includes('name: afscp-schema-bootstrap'),
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
    expect(bootstrapDryRunIndex).toBeGreaterThan(pvDeleteIndex);
  });

  it('fails closed without deleting when AFSCP static PVC is bound to an unexpected PV name', async () => {
    const root = tempDir('local-kind-afscp-pvc-bound-pv-fail-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (command === 'kubectl' && joined.includes('get pvc afscp-default-volume')) {
        const resource = ownedAfscpPersistentVolumeClaim('12P');
        const spec = resource.spec as Record<string, unknown>;
        spec.volumeName = 'stale-afscp-pv';
        return jsonResult(resource);
      }
      if (command === 'kubectl' && joined.includes('get pv agentsmith-afscp-default-volume')) {
        return jsonResult(ownedAfscpPersistentVolume('12P'));
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
    const commandText = calls.map((call) => call.args.join(' '));

    expect(result.status).toBe('failed');
    expect(failureText).toContain('spec.volumeName');
    expect(failureText).toContain('stale-afscp-pv');
    expect(failureText).toContain('agentsmith-afscp-default-volume');
    expect(failureText).toContain('refusing to delete');
    expect(commandText.some((commandLine) =>
      commandLine.includes('delete deployment afscp-api afscp-worker afscp-export-gateway'),
    )).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pvc afscp-default-volume'))).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pv agentsmith-afscp-default-volume'))).toBe(false);
  });

  it('resets owned AFSCP static PV CSI and mount spec drift with the same storage', async () => {
    const root = tempDir('local-kind-afscp-pv-spec-reset-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (command === 'kubectl' && joined.includes('get pvc afscp-default-volume')) {
        return jsonResult(ownedAfscpPersistentVolumeClaim('12P'));
      }
      if (command === 'kubectl' && joined.includes('get pv agentsmith-afscp-default-volume')) {
        const resource = ownedAfscpPersistentVolume('12P');
        const spec = resource.spec as Record<string, unknown>;
        spec.mountOptions = ['subdir=/afscp/stale-volume-root'];
        const csi = spec.csi as Record<string, unknown>;
        const secretRef = csi.nodePublishSecretRef as Record<string, unknown>;
        secretRef.namespace = 'stale-namespace';
        return jsonResult(resource);
      }
      if (command === 'kubectl' && joined.includes('get pods -l app.kubernetes.io/name=juicefs-mount,volume-id=agentsmith-afscp-default-volume')) {
        return {
          exitCode: 0,
          stdout: 'juicefs-agentsmith-afscp-default-volume-abcd\tmount-pod-uid\tjuicefs-mount\tagentsmith-afscp-default-volume\tagentsmith-afscp-default-volume\t\t\n',
          stderr: '',
        };
      }
      if (command === 'kubectl' && joined.includes('get secrets -l juicefs/secret')) {
        return {
          exitCode: 0,
          stdout: [
            'juicefs-generated-afscp-secret\tgenerated-secret-uid\t\tagentsmith-afscp-default-volume\tagentsmith-afscp-default-volume\ttrue\tPod/juicefs-agentsmith-afscp-default-volume-abcd/mount-pod-uid;',
            'juicefs-generated-other-secret\tother-secret-uid\t\tother-volume\tother-volume\ttrue\tPod/juicefs-other-volume-abcd/other-pod-uid;',
            '',
          ].join('\n'),
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
      runner,
      probeRunner: passingProbeRunner,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const commandText = calls.map((call) => call.args.join(' '));

    expect(result.status).toBe('passed');
    expect(commandText.some((commandLine) =>
      commandLine.includes('delete deployment afscp-api afscp-worker afscp-export-gateway'),
    )).toBe(true);
    expect(commandText.some((commandLine) =>
      commandLine.includes('delete pod juicefs-agentsmith-afscp-default-volume-abcd'),
    )).toBe(true);
    expect(commandText.some((commandLine) =>
      commandLine.includes('delete secret juicefs-generated-afscp-secret'),
    )).toBe(true);
    expect(commandText.some((commandLine) =>
      commandLine.includes('delete secret juicefs-generated-other-secret'),
    )).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pvc afscp-default-volume'))).toBe(true);
    expect(commandText.some((commandLine) => commandLine.includes('delete pv agentsmith-afscp-default-volume'))).toBe(true);
  });

  it('resets owned AFSCP static PV when live CSI placement fields are extra', async () => {
    const root = tempDir('local-kind-afscp-pv-source-extra-reset-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (command === 'kubectl' && joined.includes('get pvc afscp-default-volume')) {
        return jsonResult(ownedAfscpPersistentVolumeClaim('12P'));
      }
      if (command === 'kubectl' && joined.includes('get pv agentsmith-afscp-default-volume')) {
        const resource = ownedAfscpPersistentVolume('12P');
        const spec = resource.spec as Record<string, unknown>;
        spec.nodeAffinity = {
          required: {
            nodeSelectorTerms: [{
              matchExpressions: [{
                key: 'kubernetes.io/hostname',
                operator: 'In',
                values: ['stale-kind-node'],
              }],
            }],
          },
        };
        const csi = spec.csi as Record<string, unknown>;
        csi.readOnly = true;
        csi.nodeStageSecretRef = {
          name: 'stale-stage-secret',
          namespace: 'agentsmith',
        };
        return jsonResult(resource);
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

    expect(result.status).toBe('passed');
    expect(commandText.some((commandLine) =>
      commandLine.includes('delete deployment afscp-api afscp-worker afscp-export-gateway'),
    )).toBe(true);
    expect(commandText.some((commandLine) => commandLine.includes('delete pvc afscp-default-volume'))).toBe(true);
    expect(commandText.some((commandLine) => commandLine.includes('delete pv agentsmith-afscp-default-volume'))).toBe(true);
    expect(result.evidence.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'afscp-static-volume-reset-diff',
        stdout: expect.stringContaining('spec.nodeAffinity'),
      }),
      expect.objectContaining({
        name: 'afscp-static-volume-reset-diff',
        stdout: expect.stringContaining('spec.csi.nodeStageSecretRef.name'),
      }),
      expect.objectContaining({
        name: 'afscp-static-volume-reset-diff',
        stdout: expect.stringContaining('spec.csi.readOnly'),
      }),
    ]));
  });

  it('fails closed without deleting when AFSCP static PV reset drift is paired with reclaim policy drift', async () => {
    const root = tempDir('local-kind-afscp-pv-reclaim-policy-fail-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (command === 'kubectl' && joined.includes('get pvc afscp-default-volume')) {
        return jsonResult(ownedAfscpPersistentVolumeClaim('12P'));
      }
      if (command === 'kubectl' && joined.includes('get pv agentsmith-afscp-default-volume')) {
        const resource = ownedAfscpPersistentVolume('12P');
        const spec = resource.spec as Record<string, unknown>;
        spec.persistentVolumeReclaimPolicy = 'Delete';
        spec.mountOptions = ['subdir=/afscp/stale-volume-root'];
        const csi = spec.csi as Record<string, unknown>;
        const secretRef = csi.nodePublishSecretRef as Record<string, unknown>;
        secretRef.namespace = 'stale-namespace';
        return jsonResult(resource);
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
    const commandText = calls.map((call) => call.args.join(' '));

    expect(result.status).toBe('failed');
    expect(failureText).toContain('persistentVolumeReclaimPolicy');
    expect(failureText).toContain('Delete');
    expect(failureText).toContain('Retain');
    expect(failureText).toContain('refusing to delete');
    expect(commandText.some((commandLine) =>
      commandLine.includes('delete deployment afscp-api afscp-worker afscp-export-gateway'),
    )).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pvc afscp-default-volume'))).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pv agentsmith-afscp-default-volume'))).toBe(false);
  });

  it('does not reset AFSCP static PV/PVC when only reclaim policy drifts', async () => {
    const root = tempDir('local-kind-afscp-reclaim-policy-only-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (command === 'kubectl' && joined.includes('get pvc afscp-default-volume')) {
        return jsonResult(ownedAfscpPersistentVolumeClaim('12P'));
      }
      if (command === 'kubectl' && joined.includes('get pv agentsmith-afscp-default-volume')) {
        const resource = ownedAfscpPersistentVolume('12P');
        const spec = resource.spec as Record<string, unknown>;
        spec.persistentVolumeReclaimPolicy = 'Delete';
        return jsonResult(resource);
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

    expect(result.status).toBe('passed');
    expect(commandText.some((commandLine) =>
      commandLine.includes('delete deployment afscp-api afscp-worker afscp-export-gateway'),
    )).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pvc afscp-default-volume'))).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pv agentsmith-afscp-default-volume'))).toBe(false);
  });

  it('does not reset AFSCP static PV/PVC when only runtime fields drift', async () => {
    const root = tempDir('local-kind-afscp-runtime-field-ignore-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (command === 'kubectl' && joined.includes('get pvc afscp-default-volume')) {
        const resource = ownedAfscpPersistentVolumeClaim('12P');
        resource.metadata = {
          ...(resource.metadata as Record<string, unknown>),
          uid: 'runtime-pvc-uid',
          resourceVersion: '12345',
          generation: 7,
          creationTimestamp: '2026-01-01T00:00:00Z',
          managedFields: [{ manager: 'kube-controller-manager' }],
          finalizers: ['kubernetes.io/pvc-protection'],
        };
        resource.status = {
          ...(resource.status as Record<string, unknown>),
          phase: 'Bound',
          conditions: [{ type: 'FileSystemResizePending', status: 'False' }],
        };
        return jsonResult(resource);
      }
      if (command === 'kubectl' && joined.includes('get pv agentsmith-afscp-default-volume')) {
        const resource = ownedAfscpPersistentVolume('12P');
        const spec = resource.spec as Record<string, unknown>;
        spec.claimRef = {
          ...(spec.claimRef as Record<string, unknown>),
          uid: 'runtime-pvc-uid',
          resourceVersion: '12345',
        };
        resource.metadata = {
          ...(resource.metadata as Record<string, unknown>),
          uid: 'runtime-pv-uid',
          resourceVersion: '67890',
          generation: 4,
          creationTimestamp: '2026-01-01T00:00:00Z',
          managedFields: [{ manager: 'kube-controller-manager' }],
          finalizers: ['kubernetes.io/pv-protection'],
        };
        resource.status = {
          phase: 'Released',
          conditions: [{ type: 'Available', status: 'False' }],
        };
        return jsonResult(resource);
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

    expect(result.status).toBe('passed');
    expect(commandText.some((commandLine) =>
      commandLine.includes('delete deployment afscp-api afscp-worker afscp-export-gateway'),
    )).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pvc afscp-default-volume'))).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pv agentsmith-afscp-default-volume'))).toBe(false);
  });

  it('does not reset AFSCP static PV/PVC when only PVC status capacity drifts', async () => {
    const root = tempDir('local-kind-afscp-status-capacity-ignore-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (command === 'kubectl' && joined.includes('get pvc afscp-default-volume')) {
        const resource = ownedAfscpPersistentVolumeClaim('12P');
        resource.status = {
          ...(resource.status as Record<string, unknown>),
          capacity: {
            storage: '11P',
          },
        };
        return jsonResult(resource);
      }
      if (command === 'kubectl' && joined.includes('get pv agentsmith-afscp-default-volume')) {
        return jsonResult(ownedAfscpPersistentVolume('12P'));
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

    expect(result.status).toBe('passed');
    expect(commandText.some((commandLine) =>
      commandLine.includes('delete deployment afscp-api afscp-worker afscp-export-gateway'),
    )).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pvc afscp-default-volume'))).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pv agentsmith-afscp-default-volume'))).toBe(false);
  });

  it('fails closed without deleting when the AFSCP static PV claimRef points outside the desired PVC', async () => {
    const root = tempDir('local-kind-afscp-claimref-fail-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      calls.push({ command, args, input: options.input ?? '' });
      const joined = args.join(' ');
      if (command === 'kubectl' && joined.includes('get pvc afscp-default-volume')) {
        return jsonResult(ownedAfscpPersistentVolumeClaim('12P'));
      }
      if (command === 'kubectl' && joined.includes('get pv agentsmith-afscp-default-volume')) {
        const resource = ownedAfscpPersistentVolume('12P');
        const spec = resource.spec as Record<string, unknown>;
        spec.claimRef = {
          name: 'someone-elses-pvc',
          namespace: 'other-namespace',
          uid: 'foreign-uid',
        };
        return jsonResult(resource);
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
    const commandText = calls.map((call) => call.args.join(' '));

    expect(result.status).toBe('failed');
    expect(failureText).toContain('claimRef');
    expect(failureText).toContain('afscp-default-volume');
    expect(failureText).toContain('agentsmith');
    expect(commandText.some((commandLine) =>
      commandLine.includes('delete deployment afscp-api afscp-worker afscp-export-gateway'),
    )).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pvc afscp-default-volume'))).toBe(false);
    expect(commandText.some((commandLine) => commandLine.includes('delete pv agentsmith-afscp-default-volume'))).toBe(false);
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

  it.each([
    {
      name: 'Deployment',
      query: 'namespaced',
      item: {
        kind: 'Deployment',
        metadata: { name: LEGACY_ASBCP_KUBERNETES_IDENTITY },
        spec: { replicas: 1 },
      },
    },
    {
      name: 'checksum annotation',
      query: 'namespaced',
      item: {
        kind: 'ConfigMap',
        metadata: {
          name: LEGACY_ASBCP_CONFIGMAP_NAME,
          annotations: {
            [`agentsmith.mbos.dev/${LEGACY_ASBCP_CHECKSUM_FRAGMENT}-config`]: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        },
      },
    },
    {
      name: 'local-kind PV ClusterRole',
      query: 'cluster',
      item: {
        kind: 'ClusterRole',
        metadata: { name: LEGACY_ASBCP_LOCAL_KIND_PV_RBAC_NAME },
      },
    },
  ])('fails live stale legacy ASBCP absence-only check on $name residue', async ({ query, item }) => {
    const root = tempDir('local-kind-stale-legacy-asbcp-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      const joined = args.join(' ');
      if (query === 'namespaced' && joined.includes('get deployment,service,configmap,serviceaccount,role,rolebinding')) {
        return jsonResult({ kind: 'List', items: [item] });
      }
      if (query === 'cluster' && joined.includes('get clusterrole,clusterrolebinding')) {
        return jsonResult({ kind: 'List', items: [item] });
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
        path: `live:${item.kind}/${item.metadata.name}`,
        message: expect.stringContaining('absence-only'),
      }),
    ]));
    expect(result.evidence.stale_resource_absence_check).toMatchObject({
      status: 'failed',
      scope: 'absence_only',
    });
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

  it('passes route probes when public workspaces returns an empty directory', async () => {
    const root = tempDir('local-kind-public-workspaces-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner: createPassingRunner([]),
      probeRunner: async (url, options) => {
        if (url.includes('/api/public/workspaces')) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: '{"items":[]}',
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

  it('fails route probes when public workspaces returns an invalid directory shape', async () => {
    const root = tempDir('local-kind-public-workspaces-shape-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);

    const result = await runLocalKindRolloutProducer({
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath,
      runner: createPassingRunner([]),
      probeRunner: async (url, options) => {
        if (url.includes('/api/public/workspaces')) {
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: '{"items":{"id":"ws_alpha"}}',
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

  it('redacts input secret values from kubectl diagnostics in evidence', async () => {
    const root = tempDir('local-kind-redaction-');
    const evidenceDir = tempDir('local-kind-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const siteEnvPath = writeLocalKindImageSiteEnv(root);
    const calls: CommandCall[] = [];
    const runner: LocalKindCommandRunner = async (command, args, options = {}) => {
      const result = await createPassingRunner(calls)(command, args, options);
      if (args.join(' ').includes('apply --dry-run=server') && (options.input ?? '').includes('kind: Secret')) {
        return {
          exitCode: 1,
          stdout: 'server echoed sentinel_pg_secret and sentinel_minio_secret',
          stderr: 'validation echoed agentsmith-dev-asbcp-service-key plus agentsmith-dev-afscp-orchestrator-token and sentinel_mongo_secret',
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
    expect(report).not.toContain('sentinel_minio_secret');
    expect(report).not.toContain('sentinel_mongo_secret');
    expect(report).not.toContain('agentsmith-dev-asbcp-service-key');
    expect(report).not.toContain('agentsmith-dev-afscp-orchestrator-token');
    expect(report).toContain('[REDACTED]');
  });
});
