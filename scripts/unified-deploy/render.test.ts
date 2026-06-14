import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SITE_ENV_PATH,
  afscpRevisionedVolumeRef,
  afscpVolumeCredentialRevision,
  parseSiteEnv,
  renderUnifiedDeployPreflightFromFiles,
  renderUnifiedDeployFromFiles,
  renderUnifiedDeployToString,
} from './render';
import { checkApiProductionEntrypointScripts, checkRenderedOutput, checkRenderedProfile } from './check-render';
import { fingerprintRenderedManifest, writeProducerEvidence } from './evidence';
import { DEFAULT_MANIFEST_PATH } from './manifest';

const tempRoots: string[] = [];
const fixturesDir = join(process.cwd(), 'scripts', 'unified-deploy', '__fixtures__');
const asbcpImageLockPath = join(process.cwd(), 'infra', 'deploy', 'shared', 'asbcp-image.lock');
const afscpPodTemplateWorkloads = [
  ['Job', 'afscp-schema-bootstrap'],
  ['Job', 'afscp-volume-bootstrap'],
  ['Deployment', 'afscp-api'],
  ['Deployment', 'afscp-worker'],
  ['Deployment', 'afscp-export-gateway'],
] as const;

function readAsbcpLockSourceRef(): string {
  const match = /^asbcp_source_image=(.+)$/mu.exec(readFileSync(asbcpImageLockPath, 'utf8'));
  if (!match?.[1]) {
    throw new Error('asbcp-image.lock must include asbcp_source_image');
  }
  return match[1];
}

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function writeSafePreflightTemplate(templatesRoot: string): void {
  const preflightDir = join(templatesRoot, 'templates/local-kind-admin-preflight');
  mkdirSync(preflightDir, { recursive: true });
  writeFileSync(
    join(preflightDir, 'safe.yaml.tpl'),
    [
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata:',
      '  name: safe-preflight',
      '  namespace: {{NAMESPACE}}',
      '',
    ].join('\n'),
  );
}

function writeManifestWithAppTemplates(root: string, appTemplates: string[]): string {
  const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST_PATH, 'utf8')) as {
    templates: {
      app: string[];
      local_kind_admin_preflight: string[];
    };
  };
  manifest.templates.app = appTemplates;
  manifest.templates.local_kind_admin_preflight = ['templates/local-kind-admin-preflight/safe.yaml.tpl'];
  const manifestPath = join(root, 'deployment.manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

function parsedDocuments(rendered: string): Record<string, unknown>[] {
  return YAML.parseAllDocuments(rendered)
    .map((document) => document.toJSON())
    .filter((document): document is Record<string, unknown> =>
      document !== null && typeof document === 'object' && !Array.isArray(document),
    );
}

function stringifyDocuments(documents: readonly Record<string, unknown>[]): string {
  return documents.map((document) => YAML.stringify(document).trim()).join('\n---\n') + '\n';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resourceName(resource: Record<string, unknown>): string {
  const metadata = asRecord(resource.metadata);
  return typeof metadata.name === 'string' ? metadata.name : '';
}

function resourceKind(resource: Record<string, unknown>): string {
  return typeof resource.kind === 'string' ? resource.kind : '';
}

function findResource(
  documents: readonly Record<string, unknown>[],
  kind: string,
  name: string,
): Record<string, unknown> {
  return documents.find((document) =>
    resourceKind(document) === kind && resourceName(document) === name,
  ) ?? {};
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJson(nestedValue)]),
    );
  }

  return value;
}

function checksum(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(sortJson(value))).digest('hex')}`;
}

function resourceDataChecksum(
  documents: readonly Record<string, unknown>[],
  kind: string,
  name: string,
  field: 'data' | 'stringData',
): string {
  return checksum(asRecord(findResource(documents, kind, name)[field]));
}

function replaceEnvLine(source: string, key: string, value: string): string {
  return source.replace(new RegExp(`^${key}=.*$`, 'mu'), `${key}=${value}`);
}

function withStrictTlsSubstrateTruth(source: string): string {
  return `${source}
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
  );
}

function runCheckRenderCli(args: readonly string[]) {
  const tsxCli = join(process.cwd(), 'node_modules', '.bin', 'tsx');
  return spawnSync(tsxCli, ['scripts/unified-deploy/check-render.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });
}

function deploymentPodSpec(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
): Record<string, unknown> {
  const deployment = findResource(documents, 'Deployment', deploymentName);
  return asRecord(asRecord(asRecord(asRecord(deployment.spec).template).spec));
}

function jobPodSpec(
  documents: readonly Record<string, unknown>[],
  jobName: string,
): Record<string, unknown> {
  const job = findResource(documents, 'Job', jobName);
  return asRecord(asRecord(asRecord(job.spec).template).spec);
}

function deploymentPodTemplateAnnotations(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
): Record<string, unknown> {
  return workloadPodTemplateAnnotations(documents, 'Deployment', deploymentName);
}

function workloadPodTemplateMetadata(
  documents: readonly Record<string, unknown>[],
  kind: string,
  name: string,
): Record<string, unknown> {
  const workload = findResource(documents, kind, name);
  return asRecord(asRecord(asRecord(workload.spec).template).metadata);
}

function workloadPodTemplateLabels(
  documents: readonly Record<string, unknown>[],
  kind: string,
  name: string,
): Record<string, unknown> {
  return asRecord(workloadPodTemplateMetadata(documents, kind, name).labels);
}

function workloadPodTemplateAnnotations(
  documents: readonly Record<string, unknown>[],
  kind: string,
  name: string,
): Record<string, unknown> {
  return asRecord(workloadPodTemplateMetadata(documents, kind, name).annotations);
}

function deploymentContainerEnv(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
  containerName: string,
): Record<string, unknown>[] {
  const container = deploymentContainer(documents, deploymentName, containerName);
  return Array.isArray(container.env) ? container.env.map(asRecord) : [];
}

function containerEnvEntry(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
  containerName: string,
  envName: string,
): Record<string, unknown> {
  return deploymentContainerEnv(documents, deploymentName, containerName)
    .find((entry) => entry.name === envName) ?? {};
}

function serviceBackends(rendered: string): Map<string, string> {
  const routes = new Map<string, string>();
  for (const document of parsedDocuments(rendered)) {
    if (resourceKind(document) !== 'Ingress') {
      continue;
    }
    const spec = asRecord(document.spec);
    const rules = Array.isArray(spec.rules) ? spec.rules : [];
    for (const rule of rules) {
      const http = asRecord(asRecord(rule).http);
      const paths = Array.isArray(http.paths) ? http.paths : [];
      for (const pathEntry of paths) {
        const pathRecord = asRecord(pathEntry);
        const path = typeof pathRecord.path === 'string' ? pathRecord.path : '';
        const backend = asRecord(pathRecord.backend);
        const service = asRecord(backend.service);
        const serviceName = typeof service.name === 'string' ? service.name : '';
        routes.set(path, serviceName);
      }
    }
  }

  return routes;
}

function ingressBackendPorts(rendered: string): Map<string, number> {
  const routes = new Map<string, number>();
  for (const document of parsedDocuments(rendered)) {
    if (resourceKind(document) !== 'Ingress') {
      continue;
    }
    const spec = asRecord(document.spec);
    const rules = Array.isArray(spec.rules) ? spec.rules : [];
    for (const rule of rules) {
      const http = asRecord(asRecord(rule).http);
      const paths = Array.isArray(http.paths) ? http.paths : [];
      for (const pathEntry of paths) {
        const pathRecord = asRecord(pathEntry);
        const path = typeof pathRecord.path === 'string' ? pathRecord.path : '';
        const backend = asRecord(pathRecord.backend);
        const service = asRecord(backend.service);
        const port = asRecord(service.port);
        if (typeof port.number === 'number') {
          routes.set(path, port.number);
        }
      }
    }
  }

  return routes;
}

function deploymentContainer(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
  containerName: string,
): Record<string, unknown> {
  const deployment = documents.find((document) =>
    resourceKind(document) === 'Deployment' && resourceName(document) === deploymentName,
  );
  const spec = asRecord(asRecord(asRecord(deployment).spec).template);
  const containers = Array.isArray(asRecord(spec.spec).containers) ? asRecord(spec.spec).containers as unknown[] : [];

  return containers
    .map(asRecord)
    .find((item) => item.name === containerName) ?? {};
}

function podSpecContainer(
  podSpec: Record<string, unknown>,
  containerListName: 'containers' | 'initContainers',
  containerName: string,
): Record<string, unknown> {
  const containers = Array.isArray(podSpec[containerListName]) ? podSpec[containerListName] : [];
  return containers
    .map(asRecord)
    .find((item) => item.name === containerName) ?? {};
}

function deploymentContainerEnvFrom(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
  containerName: string,
): Record<string, unknown>[] {
  const deployment = documents.find((document) =>
    resourceKind(document) === 'Deployment' && resourceName(document) === deploymentName,
  );
  const spec = asRecord(asRecord(asRecord(deployment).spec).template);
  const containers = Array.isArray(asRecord(spec.spec).containers) ? asRecord(spec.spec).containers as unknown[] : [];
  const container = containers
    .map(asRecord)
    .find((item) => item.name === containerName);

  return Array.isArray(asRecord(container).envFrom)
    ? asRecord(container).envFrom as Record<string, unknown>[]
    : [];
}

function resourceFieldKeys(
  documents: readonly Record<string, unknown>[],
  kind: 'ConfigMap' | 'Secret',
  name: string,
): string[] {
  const field = kind === 'ConfigMap' ? 'data' : 'stringData';
  return Object.keys(asRecord(findResource(documents, kind, name)[field]));
}

function projectedEnvKeys(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
  containerName: string,
): Set<string> {
  const keys = new Set<string>();
  for (const env of deploymentContainerEnv(documents, deploymentName, containerName)) {
    if (typeof env.name === 'string') {
      keys.add(env.name);
    }
  }
  for (const envFrom of deploymentContainerEnvFrom(documents, deploymentName, containerName)) {
    const configMapName = asRecord(envFrom.configMapRef).name;
    if (typeof configMapName === 'string') {
      for (const key of resourceFieldKeys(documents, 'ConfigMap', configMapName)) {
        keys.add(key);
      }
    }
    const secretName = asRecord(envFrom.secretRef).name;
    if (typeof secretName === 'string') {
      for (const key of resourceFieldKeys(documents, 'Secret', secretName)) {
        keys.add(key);
      }
    }
  }

  return keys;
}

function servicePort(
  documents: readonly Record<string, unknown>[],
  serviceName: string,
): number | undefined {
  const service = documents.find((document) =>
    resourceKind(document) === 'Service' && resourceName(document) === serviceName,
  );
  const ports = Array.isArray(asRecord(asRecord(service).spec).ports)
    ? asRecord(asRecord(service).spec).ports as unknown[]
    : [];
  const firstPort = asRecord(ports[0]);
  return typeof firstPort.port === 'number' ? firstPort.port : undefined;
}

function serviceTargetPort(
  documents: readonly Record<string, unknown>[],
  serviceName: string,
): number | string | undefined {
  const service = documents.find((document) =>
    resourceKind(document) === 'Service' && resourceName(document) === serviceName,
  );
  const ports = Array.isArray(asRecord(asRecord(service).spec).ports)
    ? asRecord(asRecord(service).spec).ports as unknown[]
    : [];
  const firstPort = asRecord(ports[0]);
  return typeof firstPort.targetPort === 'number' || typeof firstPort.targetPort === 'string'
    ? firstPort.targetPort
    : undefined;
}

function endpointSlicePort(
  documents: readonly Record<string, unknown>[],
  endpointSliceName: string,
): number | undefined {
  const endpointSlice = documents.find((document) =>
    resourceKind(document) === 'EndpointSlice' && resourceName(document) === endpointSliceName,
  );
  const ports = Array.isArray(asRecord(endpointSlice).ports) ? asRecord(endpointSlice).ports as unknown[] : [];
  const firstPort = asRecord(ports[0]);
  return typeof firstPort.port === 'number' ? firstPort.port : undefined;
}

function containerImagesForKind(
  documents: readonly Record<string, unknown>[],
  kind: string,
  name: string,
): string[] {
  const resource = findResource(documents, kind, name);
  const podSpec = asRecord(asRecord(asRecord(resource.spec).template).spec);
  const containers = Array.isArray(podSpec.containers) ? podSpec.containers.map(asRecord) : [];

  return containers
    .map((container) => container.image)
    .filter((image): image is string => typeof image === 'string');
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('unified deploy render producer', () => {
  it('keeps the default site env example trackable for clean checkout producers', () => {
    const result = spawnSync('git', ['check-ignore', '-q', DEFAULT_SITE_ENV_PATH], {
      cwd: process.cwd(),
    });

    expect(result.status).not.toBe(0);
  });

  it('keeps tracked site env example focused on existing Secret refs instead of raw tokens', async () => {
    const siteEnv = await readFile(DEFAULT_SITE_ENV_PATH, 'utf8');

    expect(siteEnv).toMatch(/^AGENTSMITH_APP_REF=agentsmith-app-secrets$/mu);
    expect(siteEnv).toMatch(/^AGENTSMITH_APP_REF_REVISION=stable$/mu);
    expect(siteEnv).toMatch(/^AFSCP_RUNTIME_REF=afscp-runtime-secrets$/mu);
    expect(siteEnv).toMatch(/^AFSCP_RUNTIME_REF_REVISION=stable$/mu);
    expect(siteEnv).toMatch(/^AFSCP_VOLUME_REF=afscp-default-volume-juicefs$/mu);
    expect(siteEnv).toMatch(/^AFSCP_VOLUME_REF_REVISION=stable$/mu);
    expect(siteEnv).not.toMatch(/^ASBCP_SERVICE_KEY=/mu);
    expect(siteEnv).not.toMatch(/^MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=/mu);
    expect(siteEnv).not.toMatch(/^AFSCP_(?:SERVICE|BOOTSTRAP_SERVICE|ORCHESTRATOR_SERVICE)_TOKEN=/mu);
  });

  it('renders existing Secret references without Secret payload manifests', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const secretResources = documents.filter((document) => resourceKind(document) === 'Secret');

    expect(secretResources).toEqual([]);
    expect(rendered.output).not.toMatch(/\nkind: Secret\n/u);
    expect(rendered.output).not.toMatch(/\nkind: Secret\n[\s\S]*\n(?:data|stringData|binaryData):\n/u);
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_SERVICE_KEYS')).toEqual({
      name: 'ASBCP_SERVICE_KEYS',
      valueFrom: {
        secretKeyRef: {
          name: 'agentsmith-app-secrets',
          key: 'ASBCP_SERVICE_KEY',
        },
      },
    });
  });

  it('renders custom existing Secret names through workload and volume references', async () => {
    const baseSiteEnv = await readFile(DEFAULT_SITE_ENV_PATH, 'utf8');
    const siteEnv = [
      ['AGENTSMITH_APP_REF', 'custom-app-secrets'],
      ['AFSCP_RUNTIME_REF', 'custom-afscp-runtime-secrets'],
      ['AFSCP_VOLUME_REF', 'custom-afscp-volume-juicefs'],
    ].reduce((source, [key, value]) => replaceEnvLine(source, key, value), baseSiteEnv);
    const rendered = await renderUnifiedDeployToString({
      profile: 'local-kind',
      siteEnv,
    });
    const documents = parsedDocuments(rendered.output);
    const afscpConfig = asRecord(findResource(documents, 'ConfigMap', 'afscp-runtime-config').data);
    const pv = findResource(documents, 'PersistentVolume', 'agentsmith-afscp-default-volume');

    expect(checkRenderedOutput(rendered.output).ok).toBe(true);
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_SERVICE_KEYS')).toEqual({
      name: 'ASBCP_SERVICE_KEYS',
      valueFrom: {
        secretKeyRef: {
          name: 'custom-app-secrets',
          key: 'ASBCP_SERVICE_KEY',
        },
      },
    });
    expect(deploymentContainerEnvFrom(documents, 'afscp-api', 'afscp-api')).toEqual(expect.arrayContaining([
      { secretRef: { name: 'custom-afscp-runtime-secrets' } },
    ]));
    expect(asRecord(asRecord(asRecord(pv.spec).csi).nodePublishSecretRef).name).toBe('custom-afscp-volume-juicefs');
    expect(afscpConfig.AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS).toBe('vol_agentsmith_default=agentsmith/custom-afscp-volume-juicefs');
  });

  it('uses AFSCP volume credential revision as the rendered Secret identity', async () => {
    const baseSiteEnv = await readFile(DEFAULT_SITE_ENV_PATH, 'utf8');
    const revision = 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const siteEnv = [
      ['AFSCP_VOLUME_REF', 'custom-afscp-volume-juicefs'],
      ['AFSCP_VOLUME_REF_REVISION', revision],
    ].reduce((source, [key, value]) => replaceEnvLine(source, key, value), baseSiteEnv);
    const rendered = await renderUnifiedDeployToString({
      profile: 'local-kind',
      siteEnv,
    });
    const documents = parsedDocuments(rendered.output);
    const afscpConfig = asRecord(findResource(documents, 'ConfigMap', 'afscp-runtime-config').data);
    const pv = findResource(documents, 'PersistentVolume', 'agentsmith-afscp-default-volume');
    const expectedVolumeRef = afscpRevisionedVolumeRef('custom-afscp-volume-juicefs', revision);

    expect(expectedVolumeRef).toBe('custom-afscp-volume-juicefs-1234567890ab');
    expect(checkRenderedOutput(rendered.output).ok).toBe(true);
    expect(asRecord(asRecord(asRecord(pv.spec).csi).nodePublishSecretRef).name).toBe(expectedVolumeRef);
    expect(afscpConfig.AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS).toBe(`vol_agentsmith_default=agentsmith/${expectedVolumeRef}`);
  });

  it('includes JuiceFS mount pod envs in the AFSCP volume credential revision', () => {
    const base = {
      name: 'agentsmith-afscp-default',
      metaurl: 'postgres://user:secret@substrate-postgresql.agentsmith.svc.cluster.local:5432/db?sslmode=verify-full&sslrootcert=/etc/agentsmith/substrate-ca/postgresql/ca.crt',
      storage: 'minio',
      bucket: 'https://substrate-minio.agentsmith.svc.cluster.local:9000/files',
      accessKey: 'minio-access',
      secretKey: 'minio-secret',
      configs: '{"postgresql-ca":"/etc/agentsmith/substrate-ca/postgresql","object-storage-ca":"/etc/agentsmith/substrate-ca/object-storage"}',
    };
    const withoutEnvs = afscpVolumeCredentialRevision(base);
    const withEnvs = afscpVolumeCredentialRevision({
      ...base,
      envs: '{"SSL_CERT_DIR":"/etc/agentsmith/substrate-ca/object-storage"}',
    });

    expect(withEnvs).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(withEnvs).not.toBe(withoutEnvs);
  });

  it('derives ASBCP_IMAGE from the shared lock when site env leaves it unset', async () => {
    const root = tempDir('agentsmith-render-lock-asbcp-image-');
    const siteEnvPath = join(root, 'site.env');
    const siteEnv = replaceEnvLine(
      await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'),
      'ASBCP_IMAGE',
      '',
    );
    writeFileSync(siteEnvPath, siteEnv, 'utf8');

    const rendered = await renderUnifiedDeployFromFiles({
      profile: 'existing-cluster',
      siteEnvPath,
    });
    const documents = parsedDocuments(rendered.output);
    const asbcp = deploymentContainer(documents, 'agentsmith-sandbox-control-plane', 'asbcp');

    expect(asbcp.image).toBe(readAsbcpLockSourceRef());
  });

  it('keeps default producer evidence artifacts out of git', () => {
    const result = spawnSync('git', ['check-ignore', '-q', 'artifacts/unified-deploy/example.json'], {
      cwd: process.cwd(),
    });

    expect(result.status).toBe(0);
  });

  it('can check a rendered profile against an explicit generated site env fixture', async () => {
    const root = tempDir('agentsmith-render-site-env-');
    const siteEnvPath = join(root, 'generated-site.env');
    const siteEnv = replaceEnvLine(
      await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'),
      'ASBCP_IMAGE',
      `ghcr.io/example/agentsmith-sandbox-control-plane:v2.0.3@sha256:${'a'.repeat(64)}`,
    );
    writeFileSync(siteEnvPath, siteEnv, 'utf8');

    const failures = await checkRenderedProfile('local-kind', { siteEnvPath });

    expect(failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'local-kind:Deployment/agentsmith-sandbox-control-plane',
        message: 'ASBCP image must use the canonical agentsmith-sandbox-control-plane repository',
      }),
    ]));
  });

  it('rejects local-kind internal ASBCP registry refs for existing-cluster site env checks', async () => {
    const root = tempDir('agentsmith-render-site-env-kind-registry-');
    const siteEnvPath = join(root, 'generated-site.env');
    const siteEnv = replaceEnvLine(
      await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'),
      'ASBCP_IMAGE',
      `kind-registry:5000/mbos/agentsmith-sandbox-control-plane@sha256:${'a'.repeat(64)}`,
    );
    writeFileSync(siteEnvPath, siteEnv, 'utf8');

    const existingClusterFailures = await checkRenderedProfile('existing-cluster', { siteEnvPath });
    const localKindFailures = await checkRenderedProfile('local-kind', { siteEnvPath });

    expect(existingClusterFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'existing-cluster:Deployment/agentsmith-sandbox-control-plane',
        message: 'ASBCP local-kind registry image is only allowed for local-kind renders',
      }),
    ]));
    expect(localKindFailures.filter((failure) => failure.message.includes('ASBCP image'))).toEqual([]);
  });

  it('can focus the render CLI on local-kind generated site env checks', async () => {
    const root = tempDir('agentsmith-render-cli-kind-registry-');
    const siteEnvPath = join(root, 'generated-site.env');
    const siteEnv = replaceEnvLine(
      await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'),
      'ASBCP_IMAGE',
      `kind-registry:5000/mbos/agentsmith-sandbox-control-plane@sha256:${'a'.repeat(64)}`,
    );
    writeFileSync(siteEnvPath, siteEnv, 'utf8');

    const allResult = runCheckRenderCli([`--site-env=${siteEnvPath}`]);
    expect(allResult.status).toBe(1);
    expect(allResult.stderr).toContain('existing-cluster:Deployment/agentsmith-sandbox-control-plane');
    expect(allResult.stderr).toContain('ASBCP local-kind registry image is only allowed for local-kind renders');

    const localKindResult = runCheckRenderCli(['--profile=local-kind', `--site-env=${siteEnvPath}`]);
    expect(localKindResult.status).toBe(0);
    expect(localKindResult.stdout).toContain('[unified-deploy] render check passed for local-kind');
    expect(`${localKindResult.stdout}\n${localKindResult.stderr}`).not.toContain('existing-cluster:');
  });

  it('rejects unknown render CLI profile values', () => {
    const result = runCheckRenderCli(['--profile=staging']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown --profile value: staging');
    expect(result.stderr).toContain('expected local-kind, existing-cluster, or all');
  });

  it('accepts canonical GHCR ASBCP digest refs for existing-cluster site env checks', async () => {
    const root = tempDir('agentsmith-render-site-env-ghcr-');
    const siteEnvPath = join(root, 'generated-site.env');
    const siteEnv = replaceEnvLine(
      await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'),
      'ASBCP_IMAGE',
      `ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v2.0.3@sha256:${'b'.repeat(64)}`,
    );
    writeFileSync(siteEnvPath, siteEnv, 'utf8');

    const failures = await checkRenderedProfile('existing-cluster', { siteEnvPath });

    expect(failures.filter((failure) => failure.message.includes('ASBCP image'))).toEqual([]);
  });

  it('rejects absolute and parent-traversal template paths before rendering', async () => {
    const root = tempDir('agentsmith-render-template-escape-');
    const templatesRoot = join(root, 'templates-root');
    writeSafePreflightTemplate(templatesRoot);
    const outsideTemplate = join(root, 'outside.yaml.tpl');
    writeFileSync(
      outsideTemplate,
      'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: escaped-template\n',
    );

    const absoluteManifestPath = writeManifestWithAppTemplates(root, [outsideTemplate]);
    await expect(renderUnifiedDeployToString({
      manifestPath: absoluteManifestPath,
      templatesRoot,
    })).rejects.toThrow(/safe relative template path/i);

    const traversalManifestPath = writeManifestWithAppTemplates(root, ['../outside.yaml.tpl']);
    await expect(renderUnifiedDeployToString({
      manifestPath: traversalManifestPath,
      templatesRoot,
    })).rejects.toThrow(/safe relative template path/i);
  });

  it('rejects symlink template paths that escape the templates root', async () => {
    const root = tempDir('agentsmith-render-template-symlink-');
    const templatesRoot = join(root, 'templates-root');
    writeSafePreflightTemplate(templatesRoot);
    const appTemplateDir = join(templatesRoot, 'templates/app');
    mkdirSync(appTemplateDir, { recursive: true });
    const outsideTemplate = join(root, 'outside.yaml.tpl');
    writeFileSync(
      outsideTemplate,
      'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: escaped-template\n',
    );
    symlinkSync(outsideTemplate, join(appTemplateDir, 'escape.yaml.tpl'));

    const manifestPath = writeManifestWithAppTemplates(root, ['templates/app/escape.yaml.tpl']);
    await expect(renderUnifiedDeployToString({
      manifestPath,
      templatesRoot,
    })).rejects.toThrow(/template path must stay under templates root/i);
  });

  it.each(['local-kind', 'existing-cluster'] as const)(
    'renders a complete app topology for %s without deploying anything',
    async (profile) => {
      const rendered = await renderUnifiedDeployFromFiles({ profile });
      const documents = parsedDocuments(rendered.output);
      const namesByKind = documents.map((document) => `${resourceKind(document)}/${resourceName(document)}`);

      expect(rendered.profile).toBe(profile);
      expect(rendered.output).toContain('rendered-by: agentsmith-unified-deploy');
      expect(namesByKind).toEqual(expect.arrayContaining([
        'Deployment/agentsmith-web',
        'Deployment/agentsmith-api',
        'Deployment/agentsmith-llmup',
        'Deployment/agentsmith-sandbox-control-plane',
        'Service/agentsmith-web',
        'Service/agentsmith-api',
        'Service/agentsmith-llmup',
        'Service/agentsmith-sandbox-control-plane',
        'Service/substrate-postgresql',
        'Service/substrate-mongodb',
        'Service/substrate-redis',
        'Service/substrate-minio',
        'Service/substrate-keycloak',
        'EndpointSlice/substrate-postgresql',
        'EndpointSlice/substrate-mongodb',
        'EndpointSlice/substrate-redis',
        'EndpointSlice/substrate-minio',
        'EndpointSlice/substrate-keycloak',
        'ServiceAccount/agentsmith-sandbox-control-plane',
        'Role/agentsmith-sandbox-control-plane',
        'RoleBinding/agentsmith-sandbox-control-plane',
        'ConfigMap/asbcp-config',
        'Job/agentsmith-product-schema-bootstrap',
        'Job/afscp-schema-bootstrap',
        'Job/afscp-volume-bootstrap',
        'PersistentVolume/agentsmith-afscp-default-volume',
        'PersistentVolumeClaim/afscp-default-volume',
        'ConfigMap/agentsmith-llmup-config',
        'ConfigMap/agentsmith-managed-runner-support',
        'Ingress/agentsmith',
      ]));
      expect(namesByKind).not.toContain('Namespace/agentsmith');
      expect(namesByKind).not.toEqual(expect.arrayContaining([
        'ClusterRole/agentsmith-sandbox-control-plane-pv',
        'ClusterRoleBinding/agentsmith-sandbox-control-plane-pv',
      ]));
      expect(namesByKind.some((name) => name.startsWith('ClusterRole/'))).toBe(false);
      expect(namesByKind.some((name) => name.startsWith('ClusterRoleBinding/'))).toBe(false);
      expect(namesByKind).not.toEqual(expect.arrayContaining([
        'Deployment/substrate-keycloak',
        'Deployment/agentsmith-keycloak',
        'Deployment/agentsmith-postgresql',
        'Deployment/agentsmith-minio',
      ]));

      expect(checkRenderedOutput(rendered.output).ok).toBe(true);
    },
  );

  it('renders AFSCP pod-template ownership markers for Jobs and Deployments', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);

    for (const [kind, name] of afscpPodTemplateWorkloads) {
      expect(workloadPodTemplateLabels(documents, kind, name)).toMatchObject({
        'app.kubernetes.io/part-of': 'agentsmith-deploy',
      });
      expect(workloadPodTemplateAnnotations(documents, kind, name)).toMatchObject({
        'rendered-by': 'agentsmith-unified-deploy',
      });
    }

    expect(checkRenderedOutput(rendered.output).ok).toBe(true);
  });

  it('rejects AFSCP pod templates without ownership markers', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);

    delete workloadPodTemplateLabels(documents, 'Job', 'afscp-schema-bootstrap')['app.kubernetes.io/part-of'];
    delete workloadPodTemplateAnnotations(documents, 'Deployment', 'afscp-export-gateway')['rendered-by'];

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('Job/afscp-schema-bootstrap pod template must include app.kubernetes.io/part-of=agentsmith-deploy');
    expect(text).toContain('Deployment/afscp-export-gateway pod template must include rendered-by=agentsmith-unified-deploy');
  });

  it('keeps local-kind namespace creation in a separate admin preflight render', async () => {
    const appRendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const preflightRendered = await renderUnifiedDeployPreflightFromFiles({ profile: 'local-kind' });

    const appNames = parsedDocuments(appRendered.output).map((document) => `${resourceKind(document)}/${resourceName(document)}`);
    const preflightNames = parsedDocuments(preflightRendered.output).map((document) => `${resourceKind(document)}/${resourceName(document)}`);

    expect(appNames).not.toContain('Namespace/agentsmith');
    expect(preflightNames).toContain('Namespace/agentsmith');
    expect(preflightNames).toContain('ClusterRole/agentsmith-sandbox-control-plane-pv');
    expect(preflightNames).toContain('ClusterRoleBinding/agentsmith-sandbox-control-plane-pv');

    await expect(renderUnifiedDeployToString({
      profile: 'existing-cluster',
      templateGroup: 'local_kind_admin_preflight',
    })).rejects.toThrow(/local-kind admin preflight/u);
  });

  it('renders local-kind ingress-nginx admin preflight with NodePort exposure and image env refs', async () => {
    const siteEnv = parseSiteEnv(await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'));
    const preflightRendered = await renderUnifiedDeployPreflightFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(preflightRendered.output);
    const namesByKind = documents.map((document) => `${resourceKind(document)}/${resourceName(document)}`);
    const service = findResource(documents, 'Service', 'ingress-nginx-controller');
    const createJob = findResource(documents, 'Job', 'ingress-nginx-admission-create');
    const patchJob = findResource(documents, 'Job', 'ingress-nginx-admission-patch');
    const serviceSpec = asRecord(service.spec);
    const ports = Array.isArray(serviceSpec.ports) ? serviceSpec.ports.map(asRecord) : [];
    const httpPort = ports.find((port) => port.name === 'http') ?? {};
    const httpsPort = ports.find((port) => port.name === 'https') ?? {};

    expect(namesByKind).toEqual(expect.arrayContaining([
      'Namespace/agentsmith',
      'Namespace/ingress-nginx',
      'Service/ingress-nginx-controller',
      'Deployment/ingress-nginx-controller',
      'Job/ingress-nginx-admission-create',
      'Job/ingress-nginx-admission-patch',
      'IngressClass/nginx',
    ]));
    expect(serviceSpec.type).toBe('NodePort');
    expect(httpPort.port).toBe(80);
    expect(httpPort.nodePort).toBe(30080);
    expect(httpsPort.port).toBe(443);
    expect(httpsPort.nodePort).toBe(30443);
    expect(containerImagesForKind(documents, 'Deployment', 'ingress-nginx-controller')).toContain(
      siteEnv.INGRESS_NGINX_CONTROLLER_IMAGE,
    );
    expect(containerImagesForKind(documents, 'Job', 'ingress-nginx-admission-create')).toContain(
      siteEnv.INGRESS_NGINX_CERTGEN_IMAGE,
    );
    expect(containerImagesForKind(documents, 'Job', 'ingress-nginx-admission-patch')).toContain(
      siteEnv.INGRESS_NGINX_CERTGEN_IMAGE,
    );
    expect(asRecord(createJob.spec).ttlSecondsAfterFinished).toBe(300);
    expect(asRecord(patchJob.spec).ttlSecondsAfterFinished).toBe(300);
  });

  it('renders the required ingress route ownership with llmup kept internal', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const routes = serviceBackends(rendered.output);

    expect(routes.get('/api/v1')).toBe('agentsmith-api');
    expect(routes.get('/api/public')).toBe('agentsmith-web');
    expect(routes.get('/api/system')).toBe('agentsmith-web');
    expect(routes.get('/')).toBe('agentsmith-web');
    expect([...routes.values()]).not.toContain('agentsmith-llmup');
  });

  it('renders ingress rules with the host derived from PUBLIC_BASE_URL', async () => {
    const siteEnv = replaceEnvLine(
      await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'),
      'PUBLIC_BASE_URL',
      'http://agentsmith-ingress.example.test:29180',
    );
    const rendered = await renderUnifiedDeployToString({
      profile: 'local-kind',
      siteEnv,
    });
    const documents = parsedDocuments(rendered.output);
    const ingress = findResource(documents, 'Ingress', 'agentsmith');
    const rawRules = asRecord(ingress.spec).rules;
    const rules = Array.isArray(rawRules) ? rawRules.map(asRecord) : [];

    expect(rules).not.toHaveLength(0);
    expect(rules.every((rule) => rule.host === 'agentsmith-ingress.example.test')).toBe(true);
    expect(rules.every((rule) => typeof rule.host === 'string' && rule.host.length > 0)).toBe(true);
  });

  it('projects only web-safe config and secrets into the Web-owned API routes', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const routes = serviceBackends(rendered.output);
    const envFrom = deploymentContainerEnvFrom(documents, 'agentsmith-web', 'web');
    const apiEnvFrom = deploymentContainerEnvFrom(documents, 'agentsmith-api', 'api');
    const webKeys = projectedEnvKeys(documents, 'agentsmith-web', 'web');

    expect(routes.get('/api/public')).toBe('agentsmith-web');
    expect(routes.get('/api/system')).toBe('agentsmith-web');
    expect(envFrom).toEqual([]);
    for (const key of [
      'NEXT_PUBLIC_API_BASE',
      'NEXT_PUBLIC_KEYCLOAK_URL',
      'NEXT_PUBLIC_KEYCLOAK_REALM',
      'NEXT_PUBLIC_KEYCLOAK_CLIENT_ID',
      'PUBLIC_KEYCLOAK_BASE_URL',
      'INTERNAL_KEYCLOAK_BASE_URL',
    ]) {
      expect(containerEnvEntry(documents, 'agentsmith-web', 'web', key)).toEqual({
        name: key,
        valueFrom: {
          configMapKeyRef: {
            name: 'agentsmith-app-config',
            key,
          },
        },
      });
    }
    for (const key of ['MONGO_URL', 'MONGO_DB_NAME']) {
      expect(containerEnvEntry(documents, 'agentsmith-web', 'web', key)).toEqual({
        name: key,
        valueFrom: {
          secretKeyRef: {
            name: 'agentsmith-app-secrets',
            key,
          },
        },
      });
    }
    expect(webKeys.has('ASBCP_INTERNAL_BASE_URL')).toBe(false);
    expect(webKeys.has('ASBCP_SERVICE_KEY')).toBe(false);
    expect(webKeys.has('DATABASE_URL')).toBe(false);
    expect(webKeys.has('REDIS_URL')).toBe(false);
    expect(webKeys.has('MINIO_ACCESS_KEY')).toBe(false);
    expect(webKeys.has('MINIO_SECRET_KEY')).toBe(false);
    expect(apiEnvFrom).toEqual(expect.arrayContaining([
      { configMapRef: { name: 'agentsmith-app-config' } },
      { secretRef: { name: 'agentsmith-app-secrets' } },
    ]));
  });

  it('rejects Web env projections that reintroduce ASBCP internal URL or service key', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const web = deploymentContainer(documents, 'agentsmith-web', 'web');
    web.envFrom = [
      { configMapRef: { name: 'agentsmith-app-config' } },
      { secretRef: { name: 'agentsmith-app-secrets' } },
    ];

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('web must use explicit env key projections instead of envFrom');
    expect(text).toContain('web must not project ASBCP_INTERNAL_BASE_URL');
    expect(text).toContain('web must not project ASBCP_SERVICE_KEY');
  });

  it('keeps default web and api images aligned to the shared app image build output', async () => {
    const siteEnv = parseSiteEnv(await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'));
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const web = deploymentContainer(documents, 'agentsmith-web', 'web');
    const api = deploymentContainer(documents, 'agentsmith-api', 'api');

    expect(siteEnv.WEB_IMAGE).toBe(siteEnv.API_IMAGE);
    expect(siteEnv.WEB_IMAGE).toMatch(/agentsmith-app:/u);
    expect(siteEnv.WEB_IMAGE).not.toMatch(/agentsmith-web|agentsmith-api/u);
    expect(web.image).toBe(siteEnv.WEB_IMAGE);
    expect(api.image).toBe(siteEnv.API_IMAGE);
  });

  it('declares a non-dev Node API start script for the app deployment entrypoint', () => {
    const rootPackage = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      main?: string;
      scripts?: Record<string, string>;
    };
    const apiPackage = JSON.parse(readFileSync(join(process.cwd(), 'packages', 'api-entry-node', 'package.json'), 'utf8')) as {
      main?: string;
      scripts?: Record<string, string>;
    };
    const dockerfile = readFileSync(join(process.cwd(), 'infra', 'deploy', 'Dockerfile.agentsmith-app'), 'utf8');

    expect(rootPackage.scripts?.['api:node:build']).toBe('npm run build -w @mbos/api-entry-node');
    expect(rootPackage.scripts?.['api:node:start']).toBe('npm run start -w @mbos/api-entry-node');
    expect(apiPackage.main).toBe('dist/index.js');
    expect(apiPackage.scripts?.build).toContain('esbuild src/index.ts');
    expect(apiPackage.scripts?.build).toContain('src/product-schema-bootstrap.ts');
    expect(apiPackage.scripts?.build).toContain('--banner:js=');
    expect(apiPackage.scripts?.build).toContain('createRequire');
    expect(apiPackage.scripts?.build).toContain('node:module');
    expect(apiPackage.scripts?.build).toContain('import.meta.url');
    expect(apiPackage.scripts?.build).toContain('--outdir=dist');
    expect(apiPackage.scripts?.build).toContain('--entry-names=[name]');
    expect(apiPackage.scripts?.start).toBe('node dist/index.js');
    expect(apiPackage.scripts?.start).not.toMatch(/\btsx\b|src\/index\.ts|api:node:dev/u);
    expect(dockerfile).toContain('npm run api:node:build');
    expect(checkApiProductionEntrypointScripts()).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects API production entrypoint scripts that fall back to tsx or dev commands', () => {
    const result = checkApiProductionEntrypointScripts({
      rootPackage: {
        scripts: {
          'api:node:build': 'npm run build -w @mbos/api-entry-node',
          'api:node:start': 'npm run api:node:dev',
        },
      },
      apiPackage: {
        main: 'src/index.ts',
        scripts: {
          build: 'tsc -p tsconfig.json',
          start: 'tsx src/index.ts',
        },
      },
      dockerfileText: 'RUN npx next build --no-lint',
    });
    const messages = result.failures.map((failure) => failure.message).join('\n');

    expect(result.ok).toBe(false);
    expect(messages).toContain('api:node:start must delegate to @mbos/api-entry-node start');
    expect(messages).toContain('api package start must run node dist/index.js');
    expect(messages).toContain('api package main must point to dist/index.js');
    expect(messages).toContain('api package build must bundle src/index.ts and src/product-schema-bootstrap.ts to dist');
    expect(messages).toContain('api package ESM bundle must inject Node createRequire for bundled CJS dependencies');
    expect(messages).toContain('Dockerfile.agentsmith-app must build the API production entrypoint');
  });

  it('rejects API production entrypoint builds that omit the product schema bootstrap entry or dist outdir', () => {
    const baseOptions = {
      rootPackage: {
        scripts: {
          'api:node:build': 'npm run build -w @mbos/api-entry-node',
          'api:node:start': 'npm run start -w @mbos/api-entry-node',
        },
      },
      dockerfileText: 'RUN npm run api:node:build',
    };
    const validBuild = 'esbuild src/index.ts src/product-schema-bootstrap.ts --bundle --platform=node --format=esm --target=node24 --banner:js="import { createRequire } from \'node:module\';const require = createRequire(import.meta.url);" --outdir=dist --entry-names=[name] --log-level=warning';

    const missingBootstrap = checkApiProductionEntrypointScripts({
      ...baseOptions,
      apiPackage: {
        main: 'dist/index.js',
        scripts: {
          build: validBuild.replace(' src/product-schema-bootstrap.ts', ''),
          start: 'node dist/index.js',
        },
      },
    });
    const wrongOutdir = checkApiProductionEntrypointScripts({
      ...baseOptions,
      apiPackage: {
        main: 'dist/index.js',
        scripts: {
          build: validBuild.replace('--outdir=dist', '--outdir=build'),
          start: 'node dist/index.js',
        },
      },
    });

    expect(missingBootstrap.ok).toBe(false);
    expect(missingBootstrap.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'packages/api-entry-node/package.json:scripts.build',
        message: expect.stringContaining('src/product-schema-bootstrap.ts'),
      }),
    ]));
    expect(wrongOutdir.ok).toBe(false);
    expect(wrongOutdir.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'packages/api-entry-node/package.json:scripts.build',
        message: expect.stringContaining('to dist'),
      }),
    ]));
  });

  it('renders service-specific startup commands for the shared app image workloads', async () => {
    const siteEnv = parseSiteEnv(await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'));
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const web = deploymentContainer(documents, 'agentsmith-web', 'web');
    const api = deploymentContainer(documents, 'agentsmith-api', 'api');
    const webPorts = Array.isArray(web.ports) ? web.ports.map(asRecord) : [];
    const apiPorts = Array.isArray(api.ports) ? api.ports.map(asRecord) : [];
    const apiEnv = Array.isArray(api.env) ? api.env.map(asRecord) : [];
    const productSchemaJob = findResource(documents, 'Job', 'agentsmith-product-schema-bootstrap');
    const productSchemaJobSpec = asRecord(productSchemaJob.spec);
    const productSchemaJobPodSpec = asRecord(asRecord(productSchemaJobSpec.template).spec);
    const productSchemaJobContainer = podSpecContainer(
      productSchemaJobPodSpec,
      'containers',
      'agentsmith-product-schema-bootstrap',
    );
    const ingressPorts = ingressBackendPorts(rendered.output);

    expect(web.command).toEqual(['npm']);
    expect(web.args).toEqual(['run', 'start', '--', '--hostname', '0.0.0.0', '--port', '3001']);
    expect(webPorts[0]?.containerPort).toBe(3001);
    expect(servicePort(documents, 'agentsmith-web')).toBe(3001);
    expect(ingressPorts.get('/api/public')).toBe(3001);
    expect(ingressPorts.get('/api/system')).toBe(3001);
    expect(ingressPorts.get('/')).toBe(3001);

    expect(api.command).toEqual(['npm']);
    expect(api.args).toEqual(['run', 'api:node:start']);
    expect(apiPorts[0]?.containerPort).toBe(20000);
    expect(apiEnv).toEqual(expect.arrayContaining([
      { name: 'PORT', value: '20000' },
      { name: 'INTERNAL_AGENT_IMAGE', value: siteEnv.MANAGED_RUNNER_IMAGE },
    ]));
    expect(productSchemaJobSpec.backoffLimit).toBe(3);
    expect(productSchemaJobSpec.ttlSecondsAfterFinished).toBe(86400);
    expect(productSchemaJobPodSpec.restartPolicy).toBe('Never');
    expect(productSchemaJobPodSpec.serviceAccountName).toBe('agentsmith-app');
    expect(productSchemaJobContainer.image).toBe(siteEnv.API_IMAGE);
    expect(productSchemaJobContainer.command).toEqual(['node']);
    expect(productSchemaJobContainer.args).toEqual(['packages/api-entry-node/dist/product-schema-bootstrap.js']);
    expect(productSchemaJobContainer.envFrom ?? []).toEqual([]);
    expect(productSchemaJobContainer.env).toEqual([
      {
        name: 'DATABASE_URL',
        valueFrom: {
          secretKeyRef: {
            name: 'agentsmith-app-secrets',
            key: 'DATABASE_URL',
          },
        },
      },
    ]);
    expect(productSchemaJobContainer.env).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'ASBCP_INTERNAL_BASE_URL' }),
      expect.objectContaining({ name: 'ASBCP_SERVICE_KEY' }),
    ]));
    expect(ingressPorts.get('/api/v1')).toBe(20000);
  });

  it('rejects rendered output without the product schema bootstrap Job', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output).filter((document) =>
      !(resourceKind(document) === 'Job' && resourceName(document) === 'agentsmith-product-schema-bootstrap'),
    );

    const result = checkRenderedOutput(stringifyDocuments(documents));

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'Job/agentsmith-product-schema-bootstrap',
        message: expect.stringContaining('product schema bootstrap Job must be rendered'),
      }),
    ]));
  });

  it('rejects product schema bootstrap Jobs with a broken runtime contract', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const productSchemaJob = findResource(documents, 'Job', 'agentsmith-product-schema-bootstrap');
    const productSchemaJobSpec = asRecord(productSchemaJob.spec);
    const productSchemaJobPodSpec = asRecord(asRecord(productSchemaJobSpec.template).spec);
    const productSchemaJobContainer = podSpecContainer(
      productSchemaJobPodSpec,
      'containers',
      'agentsmith-product-schema-bootstrap',
    );
    asRecord(productSchemaJob.metadata).namespace = 'wrong-namespace';
    productSchemaJobSpec.backoffLimit = 0;
    productSchemaJobPodSpec.serviceAccountName = 'default';
    productSchemaJobContainer.image = 'ghcr.io/mbos/agentsmith-app:wrong';
    productSchemaJobContainer.command = ['npm'];
    productSchemaJobContainer.args = ['run', 'api:node:start'];
    productSchemaJobContainer.env = [];
    productSchemaJobContainer.envFrom = [
      { configMapRef: { name: 'agentsmith-app-config' } },
      { secretRef: { name: 'agentsmith-app-secrets' } },
    ];

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('product schema bootstrap Job must be namespace-local');
    expect(text).toContain(
      'product schema bootstrap Job must allow bounded substrate retry and retain short-lived completion evidence',
    );
    expect(text).toContain('product schema bootstrap Job must use agentsmith-app ServiceAccount');
    expect(text).toContain('product schema bootstrap Job must use the rendered API image');
    expect(text).toContain('product schema bootstrap Job must run node packages/api-entry-node/dist/product-schema-bootstrap.js');
    expect(text).toContain('product schema bootstrap Job must project DATABASE_URL from agentsmith-app-secrets/DATABASE_URL');
    expect(text).toContain('product schema bootstrap Job must use explicit env key projections instead of envFrom');
    expect(text).toContain('product schema bootstrap Job must not project ASBCP_INTERNAL_BASE_URL');
    expect(text).toContain('product schema bootstrap Job must not project ASBCP_SERVICE_KEY');
  });

  it('rejects product schema bootstrap Jobs that alias ASBCP config or secret keys', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const productSchemaJob = findResource(documents, 'Job', 'agentsmith-product-schema-bootstrap');
    const productSchemaJobSpec = asRecord(productSchemaJob.spec);
    const productSchemaJobPodSpec = asRecord(asRecord(productSchemaJobSpec.template).spec);
    const productSchemaJobContainer = podSpecContainer(
      productSchemaJobPodSpec,
      'containers',
      'agentsmith-product-schema-bootstrap',
    );

    productSchemaJobContainer.env = [
      {
        name: 'DATABASE_URL',
        valueFrom: {
          secretKeyRef: {
            name: 'agentsmith-app-secrets',
            key: 'DATABASE_URL',
          },
        },
      },
      {
        name: 'BOOTSTRAP_INTERNAL_URL_ALIAS',
        valueFrom: {
          configMapKeyRef: {
            name: 'agentsmith-app-config',
            key: 'ASBCP_INTERNAL_BASE_URL',
          },
        },
      },
      {
        name: 'BOOTSTRAP_SERVICE_KEY_ALIAS',
        valueFrom: {
          secretKeyRef: {
            name: 'agentsmith-app-secrets',
            key: 'ASBCP_SERVICE_KEY',
          },
        },
      },
    ];

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('product schema bootstrap Job must not project ASBCP_INTERNAL_BASE_URL');
    expect(text).toContain('product schema bootstrap Job must not project ASBCP_SERVICE_KEY');
  });

  it('renders AFSCP runtime components with the bounded internal JVS runtime contract', async () => {
    const rendered = await renderUnifiedDeployFromFiles({
      profile: 'local-kind',
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const documents = parsedDocuments(rendered.output);
    const config = asRecord(findResource(documents, 'ConfigMap', 'afscp-runtime-config').data);
    const afscpApi = deploymentContainer(documents, 'afscp-api', 'afscp-api');
    const afscpWorker = deploymentContainer(documents, 'afscp-worker', 'afscp-worker');
    const exportGateway = deploymentContainer(documents, 'afscp-export-gateway', 'afscp-export-gateway');
    const schemaJob = findResource(documents, 'Job', 'afscp-schema-bootstrap');
    const schemaJobSpec = asRecord(schemaJob.spec);
    const schemaJobPodSpec = asRecord(asRecord(schemaJobSpec.template).spec);
    const schemaJobContainer = podSpecContainer(schemaJobPodSpec, 'containers', 'afscp-schema-bootstrap');
    const volumeJob = findResource(documents, 'Job', 'afscp-volume-bootstrap');
    const volumeJobSpec = asRecord(volumeJob.spec);
    const volumeJobPodSpec = asRecord(asRecord(volumeJobSpec.template).spec);
    const volumeJobSchemaBootstrap = podSpecContainer(volumeJobPodSpec, 'initContainers', 'afscp-schema-bootstrap');
    const volumeJobContainer = podSpecContainer(volumeJobPodSpec, 'containers', 'afscp-volume-bootstrap');
    const persistentVolume = findResource(documents, 'PersistentVolume', 'agentsmith-afscp-default-volume');
    const persistentVolumeClaim = findResource(documents, 'PersistentVolumeClaim', 'afscp-default-volume');
    const persistentVolumeSpec = asRecord(persistentVolume.spec);
    const persistentVolumeCsi = asRecord(persistentVolumeSpec.csi);
    const persistentVolumeSecret = asRecord(persistentVolumeCsi.nodePublishSecretRef);
    const persistentVolumeClaimSpec = asRecord(persistentVolumeClaim.spec);
    const afscpApiPodSpec = deploymentPodSpec(documents, 'afscp-api');
    const afscpWorkerPodSpec = deploymentPodSpec(documents, 'afscp-worker');
    const exportGatewayPodSpec = deploymentPodSpec(documents, 'afscp-export-gateway');
    const afscpWorkerSchemaCheck = podSpecContainer(afscpWorkerPodSpec, 'initContainers', 'afscp-schema-check');
    const exportGatewaySchemaCheck = podSpecContainer(exportGatewayPodSpec, 'initContainers', 'afscp-schema-check');

    expect(config.AFSCP_STORAGE_ENABLED).toBe('true');
    expect(config.AFSCP_JVS_ENABLED).toBe('true');
    expect(config.AFSCP_JVS_READY).toBe('true');
    expect(config.AFSCP_JVS_CWD).toBe('/data/afscp/jvs-cwd');
    expect(config).not.toHaveProperty('AFSCP_JVS_BINARY_PATH');
    expect(config).not.toHaveProperty('AFSCP_JVS_BINARY_SHA256');
    expect(findResource(documents, 'Secret', 'afscp-runtime-secrets')).toEqual({});
    expect(findResource(documents, 'Secret', 'afscp-default-volume-juicefs')).toEqual({});
    expect(config.AFSCP_MOUNT_ENABLED).toBe('true');
    expect(config.AFSCP_REPO_TEMPLATE_ENABLED).toBe('true');
    expect(config.AFSCP_REPO_CREATE_RECOVERY_ENABLED).toBe('true');
    expect(config.AFSCP_REPO_LIFECYCLE_RECOVERY_ENABLED).toBe('true');
    expect(config.AFSCP_SAVE_POINT_RECOVERY_ENABLED).toBe('true');
    expect(config.AFSCP_TEMPLATE_CREATE_RECOVERY_ENABLED).toBe('true');
    expect(config.AFSCP_TEMPLATE_CLONE_RECOVERY_ENABLED).toBe('true');
    expect(config.AFSCP_RESTORE_RECOVERY_ENABLED).toBe('true');
    expect(config).not.toHaveProperty('AFSCP_RESTORE_PREVIEW_RECOVERY_ENABLED');
    expect(config).not.toHaveProperty('AFSCP_RESTORE_PREVIEW_DISCARD_RECOVERY_ENABLED');
    expect(config).not.toHaveProperty('AFSCP_RESTORE_RUN_RECOVERY_ENABLED');
    expect(config.AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL).toBe('http://afscp-export-gateway.agentsmith.svc.cluster.local:8080');
    expect(`${config.AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL}/e/export_render_regression/`).not.toContain('/e/e/');
    expect(config.AFSCP_DEFAULT_VOLUME_ID).toBe('vol_agentsmith_default');
    expect(config.AFSCP_DEFAULT_VOLUME_BACKEND).toBe('juicefs');
    expect(config.AFSCP_DEFAULT_VOLUME_ISOLATION_CLASS).toBe('shared');
    expect(config.AFSCP_DEFAULT_VOLUME_STATUS).toBe('active');
    expect(config.AFSCP_DEFAULT_VOLUME_ROOT_PATH).toBe('/data/afscp/volumes/default');
    expect(config.AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS).toBe('vol_agentsmith_default=agentsmith/afscp-default-volume-juicefs');
    expect(JSON.parse(String(config.AFSCP_DEFAULT_VOLUME_CAPABILITIES_JSON))).toEqual({
      webdav_export: true,
      workload_mount: true,
      jvs_external_control_root: true,
      directory_quota: false,
      filtered_mount: false,
      csi_driver: 'csi.juicefs.com',
      storage_class: 'static-juicefs-rwx',
      permission_model: 'payload-root-only',
    });
    expect(afscpApi.image).toBe(afscpWorker.image);
    expect(exportGateway.image).toBe(afscpApi.image);
    expect(schemaJobSpec.backoffLimit).toBe(3);
    expect(schemaJobSpec.ttlSecondsAfterFinished).toBe(86400);
    expect(schemaJobPodSpec.restartPolicy).toBe('Never');
    expect(schemaJobPodSpec.serviceAccountName).toBe('afscp-runtime');
    expect(asRecord(schemaJobPodSpec.securityContext)).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 65532,
      runAsGroup: 65532,
      fsGroup: 65532,
    });
    expect(schemaJobContainer.image).toBe(afscpApi.image);
    expect(schemaJobContainer.command).toEqual(['/usr/local/bin/afscp-migrate']);
    expect(schemaJobContainer.args).toEqual(['--apply', '--check', '--timeout=60s']);
    expect(schemaJobContainer.envFrom).toEqual(expect.arrayContaining([
      { configMapRef: { name: 'afscp-runtime-config' } },
      { secretRef: { name: 'afscp-runtime-secrets' } },
    ]));
    expect(volumeJobSpec.backoffLimit).toBe(3);
    expect(volumeJobSpec.ttlSecondsAfterFinished).toBe(86400);
    expect(volumeJobPodSpec.restartPolicy).toBe('Never');
    expect(volumeJobPodSpec.serviceAccountName).toBe('afscp-runtime');
    expect(asRecord(volumeJobPodSpec.securityContext)).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 65532,
      runAsGroup: 65532,
      fsGroup: 65532,
    });
    expect(volumeJobSchemaBootstrap.image).toBe(afscpApi.image);
    expect(volumeJobSchemaBootstrap.command).toEqual(['/usr/local/bin/afscp-migrate']);
    expect(volumeJobSchemaBootstrap.args).toEqual(['--apply', '--check', '--timeout=60s']);
    expect(volumeJobSchemaBootstrap.envFrom).toEqual(expect.arrayContaining([
      { configMapRef: { name: 'afscp-runtime-config' } },
      { secretRef: { name: 'afscp-runtime-secrets' } },
    ]));
    expect(volumeJobContainer.image).toBe(afscpApi.image);
    expect(volumeJobContainer.command).toEqual(['/usr/local/bin/afscp-volume-bootstrap']);
    expect(volumeJobContainer.args).toEqual(['--ensure', '--check', '--timeout=60s']);
    expect(volumeJobContainer.envFrom).toEqual(expect.arrayContaining([
      { configMapRef: { name: 'afscp-runtime-config' } },
      { secretRef: { name: 'afscp-runtime-secrets' } },
    ]));
    expect(afscpApi.command).toEqual(['/usr/local/bin/afscp-api']);
    expect(afscpApi.args).toEqual(['--serve', '--listen', '0.0.0.0:8080']);
    expect(afscpWorker.command).toEqual(['/usr/local/bin/afscp-worker']);
    expect(afscpWorker.args).toEqual(['--loop', '--interval=2s']);
    expect(exportGateway.command).toEqual(['/usr/local/bin/afscp-export-gateway']);
    expect(exportGateway.args).toEqual(['--serve', '--listen-addr', '0.0.0.0:8080']);
    expect(asRecord(afscpApiPodSpec.securityContext)).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 65532,
      runAsGroup: 65532,
      fsGroup: 65532,
    });
    expect(asRecord(afscpWorkerPodSpec.securityContext)).toEqual({});
    expect(asRecord(exportGatewayPodSpec.securityContext)).toEqual({});
    expect(asRecord(afscpWorker.securityContext)).toEqual({});
    expect(asRecord(exportGateway.securityContext)).toEqual({});
    expect(asRecord(afscpWorkerSchemaCheck.securityContext)).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 65532,
      runAsGroup: 65532,
    });
    expect(asRecord(exportGatewaySchemaCheck.securityContext)).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 65532,
      runAsGroup: 65532,
    });
    expect(persistentVolumeSpec).toMatchObject({
      claimRef: {
        namespace: 'agentsmith',
        name: 'afscp-default-volume',
      },
      volumeMode: 'Filesystem',
      accessModes: ['ReadWriteMany'],
      persistentVolumeReclaimPolicy: 'Retain',
      storageClassName: '',
      capacity: {
        storage: '12P',
      },
      mountOptions: ['subdir=/afscp/vol_agentsmith_default'],
    });
    expect(persistentVolumeCsi).toMatchObject({
      driver: 'csi.juicefs.com',
      volumeHandle: 'agentsmith-afscp-default-volume',
      fsType: 'juicefs',
    });
    expect(persistentVolumeSecret).toEqual({
      name: 'afscp-default-volume-juicefs',
      namespace: 'agentsmith',
    });
    expect(persistentVolumeClaimSpec).toMatchObject({
      accessModes: ['ReadWriteMany'],
      volumeMode: 'Filesystem',
      storageClassName: '',
      volumeName: 'agentsmith-afscp-default-volume',
      resources: {
        requests: {
          storage: '12P',
        },
      },
    });

    for (const deploymentName of ['afscp-api', 'afscp-worker', 'afscp-export-gateway']) {
      const podSpec = deploymentPodSpec(documents, deploymentName);
      const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];
      const container = deploymentContainer(documents, deploymentName, deploymentName);
      const initContainer = podSpecContainer(podSpec, 'initContainers', 'afscp-schema-check');
      const volumeMounts = Array.isArray(container.volumeMounts) ? container.volumeMounts.map(asRecord) : [];
      expect(initContainer.image).toBe(afscpApi.image);
      expect(initContainer.command).toEqual(['/usr/local/bin/afscp-migrate']);
      expect(initContainer.args).toEqual(['--check', '--timeout=60s']);
      expect(initContainer.envFrom).toEqual(expect.arrayContaining([
        { configMapRef: { name: 'afscp-runtime-config' } },
        { secretRef: { name: 'afscp-runtime-secrets' } },
      ]));
      expect(volumes).toEqual(expect.arrayContaining([
        {
          name: 'afscp-default-volume',
          persistentVolumeClaim: {
            claimName: 'afscp-default-volume',
          },
        },
        {
          name: 'afscp-jvs-cwd',
          emptyDir: {},
        },
      ]));
      expect(volumeMounts).toEqual(expect.arrayContaining([
        {
          name: 'afscp-default-volume',
          mountPath: '/data/afscp/volumes/default',
        },
        {
          name: 'afscp-jvs-cwd',
          mountPath: '/data/afscp/jvs-cwd',
        },
      ]));
      expect(volumes.some((volume) => asRecord(volume.csi).driver === 'csi.juicefs.com')).toBe(false);
    }
  });

  it('rejects AFSCP recovery config without a mounted clean JVS cwd', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const config = asRecord(findResource(documents, 'ConfigMap', 'afscp-runtime-config').data);
    config.AFSCP_JVS_CWD = 'relative-jvs-cwd';

    for (const deploymentName of ['afscp-api', 'afscp-worker', 'afscp-export-gateway']) {
      const podSpec = deploymentPodSpec(documents, deploymentName);
      const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];
      const container = deploymentContainer(documents, deploymentName, deploymentName);
      const volumeMounts = Array.isArray(container.volumeMounts) ? container.volumeMounts.map(asRecord) : [];
      podSpec.volumes = volumes.filter((volume) => volume.name !== 'afscp-jvs-cwd');
      container.volumeMounts = volumeMounts.filter((mount) => mount.name !== 'afscp-jvs-cwd');
    }

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('AFSCP_JVS_CWD must be the clean absolute mounted scratch path');
    expect(text).toContain('must mount the clean AFSCP_JVS_CWD scratch path');
    expect(text).toContain('must back AFSCP_JVS_CWD with an emptyDir scratch volume');
  });

  it('rejects AFSCP manifests that override image-owned JVS binary pins', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const config = asRecord(findResource(documents, 'ConfigMap', 'afscp-runtime-config').data);
    config.AFSCP_JVS_BINARY_PATH = '/usr/local/bin/jvs';
    config.AFSCP_JVS_BINARY_SHA256 = '0a1c6896cecf85ec2ac4e15e1c29f6e3f8cf09b9a4db48a516559604f0e7e944';

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('AFSCP_JVS_BINARY_PATH must come from the AFSCP image default');
    expect(text).toContain('AFSCP_JVS_BINARY_SHA256 must come from the AFSCP image default');
  });

  it('rejects AFSCP storage-reader pods that override the image user', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    deploymentPodSpec(documents, 'afscp-worker').securityContext = {
      runAsNonRoot: true,
      runAsUser: 65532,
      runAsGroup: 65532,
    };
    deploymentContainer(documents, 'afscp-export-gateway', 'afscp-export-gateway').securityContext = {
      runAsNonRoot: true,
      runAsUser: 65532,
      runAsGroup: 65532,
    };

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('afscp-worker must inherit the AFSCP image user/root');
    expect(text).toContain('afscp-export-gateway must inherit the AFSCP image user/root');
  });

  it('rejects AFSCP API manifests that drop the non-root boundary', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    deploymentPodSpec(documents, 'afscp-api').securityContext = {
      runAsNonRoot: false,
      runAsUser: 0,
      runAsGroup: 0,
    };

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('afscp-api pod must keep the non-root 65532 security context');
  });

  it('rejects AFSCP WebDAV export public base URLs that include the gateway prefix', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const config = asRecord(findResource(documents, 'ConfigMap', 'afscp-runtime-config').data);
    config.AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL = 'http://afscp-export-gateway.agentsmith.svc.cluster.local:8080/e';

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('without the /e gateway prefix');
    expect(text).toContain('/e/e/');
  });

  it('rejects AFSCP pods that use unsupported inline JuiceFS CSI volumes', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);

    for (const deploymentName of ['afscp-api', 'afscp-worker', 'afscp-export-gateway']) {
      const podSpec = deploymentPodSpec(documents, deploymentName);
      podSpec.volumes = [{
        name: 'afscp-default-volume',
        csi: {
          driver: 'csi.juicefs.com',
          volumeAttributes: {
            subPath: 'afscp/vol_agentsmith_default',
          },
          nodePublishSecretRef: {
            name: 'afscp-default-volume-juicefs',
          },
        },
      }];
    }

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('must not use inline CSI');
    expect(text).toContain('Persistent volume lifecycle');
    expect(text).toContain('PersistentVolumeClaim');
  });

  it('rejects AFSCP volume Secret reference drift', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const config = asRecord(findResource(documents, 'ConfigMap', 'afscp-runtime-config').data);
    const persistentVolume = findResource(documents, 'PersistentVolume', 'agentsmith-afscp-default-volume');
    const csi = asRecord(asRecord(persistentVolume.spec).csi);
    config.AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS = 'vol_agentsmith_default=agentsmith/wrong-volume-secret';
    asRecord(csi.nodePublishSecretRef).namespace = 'wrong-namespace';

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('AFSCP workload mount Secret refs must point to the namespace-local JuiceFS CSI Secret');
    expect(text).toContain('AFSCP default PersistentVolume must use JuiceFS CSI with the namespace-local volume Secret');
  });

  it('rejects AFSCP PersistentVolume claimRef drift', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const persistentVolume = findResource(documents, 'PersistentVolume', 'agentsmith-afscp-default-volume');
    delete asRecord(persistentVolume.spec).claimRef;

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('PersistentVolume claimRef must point to the namespace-local default PersistentVolumeClaim');
  });

  it('rejects AFSCP PV/PVC storage quantities that trigger Kubernetes fractional-byte warnings', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const persistentVolume = findResource(documents, 'PersistentVolume', 'agentsmith-afscp-default-volume');
    const persistentVolumeClaim = findResource(documents, 'PersistentVolumeClaim', 'afscp-default-volume');
    asRecord(asRecord(persistentVolume.spec).capacity).storage = '10Pi';
    asRecord(asRecord(asRecord(persistentVolumeClaim.spec).resources).requests).storage = '10Pi';

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('storage quantity must be 12P');
    expect(text).toContain('Kubernetes fractional-byte quantity warnings');
  });

  it('rejects AFSCP PV/PVC storage quantities below the pre-GA 10Pi baseline', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const persistentVolume = findResource(documents, 'PersistentVolume', 'agentsmith-afscp-default-volume');
    const persistentVolumeClaim = findResource(documents, 'PersistentVolumeClaim', 'afscp-default-volume');
    asRecord(asRecord(persistentVolume.spec).capacity).storage = '8Pi';
    asRecord(asRecord(asRecord(persistentVolumeClaim.spec).resources).requests).storage = '8Pi';

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('storage quantity must be 12P');
    expect(text).toContain('pre-GA 10Pi baseline');
  });

  it('rejects AFSCP default volume bootstrap jobs without the schema bootstrap barrier', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const volumeJob = findResource(documents, 'Job', 'afscp-volume-bootstrap');
    const volumeJobSpec = asRecord(volumeJob.spec);
    const volumeJobPodSpec = asRecord(asRecord(volumeJobSpec.template).spec);
    delete volumeJobPodSpec.initContainers;

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('AFSCP default volume bootstrap Job must run afscp-migrate --apply --check before volume ensure');
  });

  it('rejects AFSCP default volume bootstrap jobs that use the nonexistent apply flag', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const volumeJob = findResource(documents, 'Job', 'afscp-volume-bootstrap');
    const volumeJobSpec = asRecord(volumeJob.spec);
    const volumeJobPodSpec = asRecord(asRecord(volumeJobSpec.template).spec);
    const volumeJobContainer = podSpecContainer(volumeJobPodSpec, 'containers', 'afscp-volume-bootstrap');
    volumeJobContainer.args = ['--apply', '--check', '--timeout=60s'];

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('/usr/local/bin/afscp-volume-bootstrap --ensure --check --timeout=60s');
  });

  it('renders the ASBCP startup contract without leaking raw storage env into the ASBCP runtime', async () => {
    const rendered = await renderUnifiedDeployFromFiles({
      profile: 'local-kind',
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const documents = parsedDocuments(rendered.output);
    const configMap = findResource(documents, 'ConfigMap', 'asbcp-config');
    const appConfigMap = findResource(documents, 'ConfigMap', 'agentsmith-app-config');
    const configData = asRecord(configMap.data);
    const appConfigData = asRecord(appConfigMap.data);
    const asbcpConfig = typeof configData['config.yaml'] === 'string'
      ? configData['config.yaml']
      : '';
    const podSpec = deploymentPodSpec(documents, 'agentsmith-sandbox-control-plane');
    const asbcp = deploymentContainer(documents, 'agentsmith-sandbox-control-plane', 'asbcp');
    const volumeMounts = Array.isArray(asbcp.volumeMounts)
      ? asbcp.volumeMounts.map(asRecord)
      : [];
    const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];

    expect(asbcpConfig).toContain('version: 1');
    expect(asbcpConfig).toContain('httpPort: 8080');
    expect(asbcpConfig).not.toMatch(/^afscp:\s*$/mu);
    expect(asbcpConfig).not.toContain(appConfigData.AFSCP_BASE_URL);
    expect(asbcpConfig).not.toContain('tokenEnv:');
    expect(appConfigData.ASBCP_INTERNAL_BASE_URL).toBe('http://agentsmith-sandbox-control-plane:8080');
    expect(appConfigData.AFSCP_CALLER_SERVICE).toBe('agentsmith-api');
    expect(appConfigData.AFSCP_BOOTSTRAP_CALLER_SERVICE).toBe('agentsmith-bootstrap');
    expect(appConfigData.AFSCP_ORCHESTRATOR_CALLER_SERVICE).toBe('agentsmith-sandbox-control-plane');
    expect(configData.ASBCP_SERVICE_KEY).toBeUndefined();
    expect(configData.JUICEFS_STORAGE_SECRET_KEY).toBeUndefined();
    expect(appConfigData.MINIO_SECRET_KEY).toBeUndefined();

    expect(podSpec.serviceAccountName).toBe('agentsmith-sandbox-control-plane');
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_CONFIG_PATH')).toEqual({
      name: 'ASBCP_CONFIG_PATH',
      value: '/etc/asbcp/asbcp-config.yaml',
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_SERVICE_KEYS')).toEqual({
      name: 'ASBCP_SERVICE_KEYS',
      valueFrom: {
        secretKeyRef: {
          name: 'agentsmith-app-secrets',
          key: 'ASBCP_SERVICE_KEY',
        },
      },
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_WORKLOAD_NAMESPACE')).toEqual({
      name: 'ASBCP_WORKLOAD_NAMESPACE',
      value: 'agentsmith',
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_AFSCP_INTERNAL_BASE_URL')).toEqual({
      name: 'ASBCP_AFSCP_INTERNAL_BASE_URL',
      value: appConfigData.AFSCP_BASE_URL,
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_AFSCP_ORCHESTRATOR_TOKEN')).toEqual({
      name: 'ASBCP_AFSCP_ORCHESTRATOR_TOKEN',
      valueFrom: {
        secretKeyRef: {
          name: 'agentsmith-app-secrets',
          key: 'AFSCP_ORCHESTRATOR_SERVICE_TOKEN',
        },
      },
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_AFSCP_CALLER_SERVICE')).toEqual({
      name: 'ASBCP_AFSCP_CALLER_SERVICE',
      value: 'agentsmith-sandbox-control-plane',
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_AFSCP_ACTOR_TYPE')).toEqual({
      name: 'ASBCP_AFSCP_ACTOR_TYPE',
      value: 'system',
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_AFSCP_ACTOR_ID')).toEqual({
      name: 'ASBCP_AFSCP_ACTOR_ID',
      value: 'agentsmith-sandbox-control-plane',
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'AFSCP_BASE_URL')).toEqual({});
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'AFSCP_ORCHESTRATOR_SERVICE_TOKEN')).toEqual({});
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'AFSCP_ORCHESTRATOR_CALLER_SERVICE')).toEqual({});
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'JUICEFS_STORAGE_ENDPOINT')).toEqual({});
    expect(appConfigData.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE).toBeUndefined();
    expect(appConfigData.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE).toBeUndefined();
    expect(appConfigData.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT).toBeUndefined();
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'JUICEFS_STORAGE_ACCESS_KEY')).toEqual({});
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'JUICEFS_STORAGE_SECRET_KEY')).toEqual({});
    expect(volumeMounts).toEqual(expect.arrayContaining([
      {
        name: 'config',
        mountPath: '/etc/asbcp/asbcp-config.yaml',
        subPath: 'config.yaml',
      },
    ]));
    const legacyAsbcpConfigPath = ['/etc/asbcp', 'config.yaml'].join('/');
    expect(rendered.output).not.toContain(legacyAsbcpConfigPath);
    expect(volumes).toEqual(expect.arrayContaining([
      {
        name: 'config',
        configMap: {
          name: 'asbcp-config',
        },
      },
    ]));
  });

  it('keeps ASBCP render validation at the consumer boundary instead of provider schema details', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const configMap = findResource(documents, 'ConfigMap', 'asbcp-config');

    asRecord(configMap.data)['config.yaml'] = 'provider_owned_schema: true\n';

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).not.toContain('ASBCP config must include');
    expect(text).not.toContain('ASBCP app Role must not permit');
  });

  it('renders ASBCP workload fact ConfigMap permissions required by the provider contract', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const role = findResource(documents, 'Role', 'agentsmith-sandbox-control-plane');
    const rules = Array.isArray(role.rules) ? role.rules.map(asRecord) : [];
    const configMapRule = rules.find((rule) =>
      Array.isArray(rule.resources) && rule.resources.includes('configmaps'),
    ) ?? {};
    const verbs = Array.isArray(configMapRule.verbs) ? configMapRule.verbs : [];

    expect(verbs).toEqual(expect.arrayContaining(['get', 'list', 'create', 'update', 'patch', 'delete']));
    expect(checkRenderedOutput(rendered.output).failures).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'Role/agentsmith-sandbox-control-plane',
        message: expect.stringContaining('workload fact ConfigMap'),
      }),
    ]));
  });

  it('rejects ASBCP Role drift that removes workload fact ConfigMap access', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const role = findResource(documents, 'Role', 'agentsmith-sandbox-control-plane');

    role.rules = [
      {
        apiGroups: [''],
        resources: ['pods'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
    ];

    expect(checkRenderedOutput(stringifyDocuments(documents)).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'Role/agentsmith-sandbox-control-plane',
        message: expect.stringContaining('workload fact ConfigMap'),
      }),
    ]));
  });

  it('rejects ASBCP consumer boundary drift in image, URL, key, and config path', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const asbcp = deploymentContainer(documents, 'agentsmith-sandbox-control-plane', 'asbcp');
    const appConfigMap = findResource(documents, 'ConfigMap', 'agentsmith-app-config');

    asbcp.image = 'ghcr.io/example/asbcp:dev';
    containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_CONFIG_PATH').value = ['/etc/asbcp', 'config.yaml'].join('/');
    asRecord(appConfigMap.data).ASBCP_INTERNAL_BASE_URL = 'https://public.example.com/asbcp';
    asRecord(asRecord(containerEnvEntry(documents, 'agentsmith-sandbox-control-plane', 'asbcp', 'ASBCP_SERVICE_KEYS').valueFrom).secretKeyRef).key = 'WRONG_SERVICE_KEY';

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('ASBCP image must use the canonical agentsmith-sandbox-control-plane repository');
    expect(text).toContain('ASBCP_INTERNAL_BASE_URL must point to the internal ASBCP Service');
    expect(text).toContain('ASBCP service keys must come from agentsmith-app-secrets/ASBCP_SERVICE_KEY');
    expect(text).toContain('ASBCP must set ASBCP_CONFIG_PATH to the canonical asbcp-config.yaml path');
  });

  it('rejects ASBCP canonical tag-only image refs in rendered Deployment', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const asbcp = deploymentContainer(documents, 'agentsmith-sandbox-control-plane', 'asbcp');

    asbcp.image = 'ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v2.0.3';

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('ASBCP image must be pinned by sha256 digest');
  });

  it('rejects same-tail ASBCP image refs from non-canonical registries in rendered Deployment', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const asbcp = deploymentContainer(documents, 'agentsmith-sandbox-control-plane', 'asbcp');

    asbcp.image = `ghcr.io/example/agentsmith-sandbox-control-plane:v2.0.3@sha256:${'a'.repeat(64)}`;

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('ASBCP image must use the canonical agentsmith-sandbox-control-plane repository');
  });

  it('accepts ASBCP local-kind registry image refs pinned by sha256 digest', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const asbcp = deploymentContainer(documents, 'agentsmith-sandbox-control-plane', 'asbcp');

    asbcp.image = `kind-registry:5000/mbos/agentsmith-sandbox-control-plane@sha256:${'a'.repeat(64)}`;

    const failures = checkRenderedOutput(stringifyDocuments(documents)).failures
      .filter((failure) => failure.message.includes('ASBCP image'));

    expect(failures).toEqual([]);
  });

  it('renders a dedicated ASBCP runtime identity without public PV preflight RBAC', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const clusterRole = findResource(documents, 'ClusterRole', 'agentsmith-sandbox-control-plane-pv');
    const clusterRoleBinding = findResource(documents, 'ClusterRoleBinding', 'agentsmith-sandbox-control-plane-pv');
    const podSpec = deploymentPodSpec(documents, 'agentsmith-sandbox-control-plane');

    expect(podSpec.serviceAccountName).toBe('agentsmith-sandbox-control-plane');
    expect(clusterRole).toEqual({});
    expect(clusterRoleBinding).toEqual({});
  });

  it('separates substrate Service native ports from EndpointSlice Docker target ports', async () => {
    const rendered = await renderUnifiedDeployFromFiles({
      profile: 'local-kind',
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const documents = parsedDocuments(rendered.output);

    for (const [name, nativePort, endpointPort] of [
      ['substrate-postgresql', 5432, 15432],
      ['substrate-mongodb', 27017, 27027],
      ['substrate-redis', 6379, 16379],
      ['substrate-minio', 9000, 19100],
      ['substrate-keycloak', 8080, 18081],
    ] as const) {
      expect(servicePort(documents, name)).toBe(nativePort);
      expect(serviceTargetPort(documents, name)).toBe(nativePort);
      expect(endpointSlicePort(documents, name)).toBe(endpointPort);
    }
  });

  it('renders api replicas as a fixed value and does not accept API_REPLICAS input', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'existing-cluster' });
    const apiDeployment = parsedDocuments(rendered.output).find((document) =>
      resourceKind(document) === 'Deployment' && resourceName(document) === 'agentsmith-api',
    );

    expect(asRecord(asRecord(apiDeployment).spec).replicas).toBe(1);
    expect(rendered.output).not.toContain('API_REPLICAS');

    await expect(renderUnifiedDeployToString({
      profile: 'local-kind',
      siteEnv: `${await readFile(DEFAULT_SITE_ENV_PATH, 'utf8')}
API_REPLICAS=2
`,
    })).rejects.toThrow(/API_REPLICAS/u);
  });

  it('routes the compatibility llmup env key to the internal app-owned service', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const configMap = parsedDocuments(rendered.output).find((document) =>
      resourceKind(document) === 'ConfigMap' && resourceName(document) === 'agentsmith-app-config',
    );
    const data = asRecord(asRecord(configMap).data);

    expect(data.MBOS_UNIVERSAL_PROXY_BASE_URL).toBe('http://agentsmith-llmup:8080');
    expect(data.LLMUP_INTERNAL_BASE_URL).toBe('http://agentsmith-llmup:8080');
  });

  it('renders llmup as an app-owned workload with config, secret, and health probes', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'existing-cluster' });
    const documents = parsedDocuments(rendered.output);
    const llmupConfig = findResource(documents, 'ConfigMap', 'agentsmith-llmup-config');
    const llmup = deploymentContainer(documents, 'agentsmith-llmup', 'llmup');
    const podSpec = deploymentPodSpec(documents, 'agentsmith-llmup');
    const env = Array.isArray(llmup.env) ? llmup.env.map(asRecord) : [];
    const volumeMounts = Array.isArray(llmup.volumeMounts) ? llmup.volumeMounts.map(asRecord) : [];
    const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];

    expect(asRecord(llmupConfig.data)['config.yaml']).toContain('listen: 0.0.0.0:8080');
    expect(asRecord(llmupConfig.data)['config.yaml']).toContain('data_auth:\n  mode: client_provider_key');
    expect(llmup.args).toEqual(['--config', '/app/config/config.yaml']);
    expect(env).toEqual(expect.arrayContaining([
      { name: 'LLM_UNIVERSAL_PROXY_AUTH_MODE', value: 'client_provider_key' },
      {
        name: 'LLM_UNIVERSAL_PROXY_ADMIN_TOKEN',
        valueFrom: {
          secretKeyRef: {
            name: 'agentsmith-app-secrets',
            key: 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN',
          },
        },
      },
    ]));
    expect(volumeMounts).toEqual(expect.arrayContaining([
      {
        name: 'llmup-config',
        mountPath: '/app/config/config.yaml',
        subPath: 'config.yaml',
        readOnly: true,
      },
    ]));
    expect(volumes).toEqual(expect.arrayContaining([
      {
        name: 'llmup-config',
        configMap: {
          name: 'agentsmith-llmup-config',
        },
      },
    ]));
    expect(asRecord(asRecord(llmup.readinessProbe).httpGet)).toEqual({
      path: '/health',
      port: 'http',
    });
    expect(asRecord(asRecord(llmup.livenessProbe).httpGet)).toEqual({
      path: '/health',
      port: 'http',
    });
  });

  it('renders pod-template config checksums so config and secret changes trigger workload rollouts', async () => {
    const substrateTruth = readFileSync(join(fixturesDir, 'substrate-truth.sentinel.env'), 'utf8');
    const rendered = await renderUnifiedDeployToString({
      profile: 'local-kind',
      substrateTruth,
    });
    const documents = parsedDocuments(rendered.output);
    const appConfigChecksum = resourceDataChecksum(documents, 'ConfigMap', 'agentsmith-app-config', 'data');
    const appSecretChecksum = checksum({
      secretName: 'agentsmith-app-secrets',
      revision: 'stable',
    });
    const llmupConfigChecksum = resourceDataChecksum(documents, 'ConfigMap', 'agentsmith-llmup-config', 'data');
    const asbcpConfigChecksum = resourceDataChecksum(documents, 'ConfigMap', 'asbcp-config', 'data');
    const afscpConfigChecksum = resourceDataChecksum(documents, 'ConfigMap', 'afscp-runtime-config', 'data');
    const afscpSecretChecksum = checksum({
      runtimeSecretName: 'afscp-runtime-secrets',
      runtimeRevision: 'stable',
      volumeSecretName: 'afscp-default-volume-juicefs',
      volumeRevision: 'stable',
    });

    expect(deploymentPodTemplateAnnotations(documents, 'agentsmith-web')).toMatchObject({
      'agentsmith.mbos.dev/checksum-app-config': appConfigChecksum,
      'agentsmith.mbos.dev/checksum-app-secrets': appSecretChecksum,
    });
    expect(deploymentPodTemplateAnnotations(documents, 'agentsmith-api')).toMatchObject({
      'agentsmith.mbos.dev/checksum-app-config': appConfigChecksum,
      'agentsmith.mbos.dev/checksum-app-secrets': appSecretChecksum,
    });
    expect(deploymentPodTemplateAnnotations(documents, 'agentsmith-llmup')).toMatchObject({
      'agentsmith.mbos.dev/checksum-llmup-config': llmupConfigChecksum,
      'agentsmith.mbos.dev/checksum-app-secrets': appSecretChecksum,
    });
    expect(deploymentPodTemplateAnnotations(documents, 'agentsmith-sandbox-control-plane')).toMatchObject({
      'agentsmith.mbos.dev/checksum-asbcp-config': asbcpConfigChecksum,
      'agentsmith.mbos.dev/checksum-app-secrets': appSecretChecksum,
    });
    for (const deploymentName of ['afscp-api', 'afscp-worker', 'afscp-export-gateway']) {
      expect(deploymentPodTemplateAnnotations(documents, deploymentName)).toMatchObject({
        'agentsmith.mbos.dev/checksum-afscp-config': afscpConfigChecksum,
        'agentsmith.mbos.dev/checksum-afscp-secrets': afscpSecretChecksum,
      });
    }

    const siteEnv = replaceEnvLine(
      await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'),
      'PUBLIC_BASE_URL',
      'http://agentsmith-rollout.localtest.me:29180',
    );
    const appConfigChanged = await renderUnifiedDeployToString({
      profile: 'local-kind',
      siteEnv,
      substrateTruth,
    });
    const appConfigChangedDocuments = parsedDocuments(appConfigChanged.output);
    expect(
      deploymentPodTemplateAnnotations(appConfigChangedDocuments, 'agentsmith-web')['agentsmith.mbos.dev/checksum-app-config'],
    ).not.toBe(appConfigChecksum);
    expect(
      deploymentPodTemplateAnnotations(appConfigChangedDocuments, 'agentsmith-api')['agentsmith.mbos.dev/checksum-app-config'],
    ).not.toBe(appConfigChecksum);
    expect(
      deploymentPodTemplateAnnotations(appConfigChangedDocuments, 'agentsmith-web')['agentsmith.mbos.dev/checksum-app-secrets'],
    ).toBe(appSecretChecksum);

    const appSecretChangedSiteEnv = replaceEnvLine(
      await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'),
      'AGENTSMITH_APP_REF_REVISION',
      'rotated-20260610',
    );
    const appSecretChanged = await renderUnifiedDeployToString({
      profile: 'local-kind',
      siteEnv: appSecretChangedSiteEnv,
      substrateTruth,
    });
    const appSecretChangedDocuments = parsedDocuments(appSecretChanged.output);
    expect(
      deploymentPodTemplateAnnotations(appSecretChangedDocuments, 'agentsmith-web')['agentsmith.mbos.dev/checksum-app-secrets'],
    ).not.toBe(appSecretChecksum);
    for (const deploymentName of ['agentsmith-api', 'agentsmith-llmup', 'agentsmith-sandbox-control-plane']) {
      expect(
        deploymentPodTemplateAnnotations(appSecretChangedDocuments, deploymentName)['agentsmith.mbos.dev/checksum-app-secrets'],
      ).not.toBe(appSecretChecksum);
    }

    const afscpSecretChangedSiteEnv = replaceEnvLine(
      await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'),
      'AFSCP_RUNTIME_REF_REVISION',
      'rotated-20260610',
    );
    const afscpSecretChanged = await renderUnifiedDeployToString({
      profile: 'local-kind',
      siteEnv: afscpSecretChangedSiteEnv,
      substrateTruth,
    });
    const afscpSecretChangedDocuments = parsedDocuments(afscpSecretChanged.output);
    for (const deploymentName of ['afscp-api', 'afscp-worker', 'afscp-export-gateway']) {
      expect(
        deploymentPodTemplateAnnotations(afscpSecretChangedDocuments, deploymentName)['agentsmith.mbos.dev/checksum-afscp-secrets'],
      ).not.toBe(afscpSecretChecksum);
    }
  });

  it('renders substrate bindings and real API env names from explicit substrate truth', async () => {
    const rendered = await renderUnifiedDeployFromFiles({
      profile: 'local-kind',
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const documents = parsedDocuments(rendered.output);
    const postgresqlEndpoint = documents.find((document) =>
      resourceKind(document) === 'EndpointSlice' && resourceName(document) === 'substrate-postgresql',
    );
    const endpoints = Array.isArray(asRecord(postgresqlEndpoint).endpoints)
      ? asRecord(postgresqlEndpoint).endpoints as unknown[]
      : [];
    const firstEndpoint = asRecord(endpoints[0]);
    const configMap = documents.find((document) =>
      resourceKind(document) === 'ConfigMap' && resourceName(document) === 'agentsmith-app-config',
    );
    const config = asRecord(asRecord(configMap).data);
    const web = deploymentContainer(documents, 'agentsmith-web', 'web');
    const productSchemaJob = findResource(documents, 'Job', 'agentsmith-product-schema-bootstrap');
    const productSchemaJobPodSpec = asRecord(asRecord(asRecord(productSchemaJob.spec).template).spec);
    const productSchemaJobContainer = podSpecContainer(
      productSchemaJobPodSpec,
      'containers',
      'agentsmith-product-schema-bootstrap',
    );

    expect(firstEndpoint.addresses).toEqual(['198.51.100.31']);
    expect(productSchemaJobContainer.env).toEqual([
      {
        name: 'DATABASE_URL',
        valueFrom: {
          secretKeyRef: {
            name: 'agentsmith-app-secrets',
            key: 'DATABASE_URL',
          },
        },
      },
    ]);
    expect(containerEnvEntry(documents, 'agentsmith-web', 'web', 'MONGO_URL')).toEqual({
      name: 'MONGO_URL',
      valueFrom: {
        secretKeyRef: {
          name: 'agentsmith-app-secrets',
          key: 'MONGO_URL',
        },
      },
    });
    expect(containerEnvEntry(documents, 'agentsmith-web', 'web', 'MONGO_DB_NAME')).toEqual({
      name: 'MONGO_DB_NAME',
      valueFrom: {
        secretKeyRef: {
          name: 'agentsmith-app-secrets',
          key: 'MONGO_DB_NAME',
        },
      },
    });
    expect(web.envFrom ?? []).toEqual([]);
    expect(config.MINIO_ENDPOINT).toBe('substrate-minio');
    expect(config.MINIO_PORT).toBe('9000');
    expect(config.MINIO_USE_SSL).toBe('false');
    expect(config.MINIO_BUCKET).toBe('sentinel-files');
    expect(config.FILE_LIBRARY_CLIENT_MINIO_ENDPOINT).toBeUndefined();
    expect(config.KEYCLOAK_ISSUER_URL).toBe('https://sentinel-login.example.com/realms/sentinel-realm');
    expect(config.PUBLIC_KEYCLOAK_BASE_URL).toBe('https://sentinel-login.example.com');
    expect(config.INTERNAL_KEYCLOAK_BASE_URL).toBe('http://substrate-keycloak:8080');
    expect(config.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE).toBeUndefined();
    expect(config.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE).toBeUndefined();
    expect(config.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT).toBeUndefined();
    expect(config.KEYCLOAK_REALM).toBe('sentinel-realm');
    expect(config.KEYCLOAK_ADMIN_CLIENT_ID).toBe('admin-cli');
    expect(rendered.output).not.toContain('agentsmith-substrate-postgresql.local');
  });

  it('mounts substrate CA Secrets and trust env for substrate clients when substrate truth declares strict TLS', async () => {
    const substrateTruth = withStrictTlsSubstrateTruth(
      readFileSync(join(fixturesDir, 'substrate-truth.sentinel.env'), 'utf8'),
    );
    const rendered = await renderUnifiedDeployToString({
      profile: 'existing-cluster',
      substrateTruth,
    });
    const documents = parsedDocuments(rendered.output);
    const config = asRecord(findResource(documents, 'ConfigMap', 'agentsmith-app-config').data);
    const apiPodSpec = deploymentPodSpec(documents, 'agentsmith-api');
    const api = deploymentContainer(documents, 'agentsmith-api', 'api');
    const apiInit = podSpecContainer(apiPodSpec, 'initContainers', 'substrate-ca-bundle');
    const apiVolumes = Array.isArray(apiPodSpec.volumes) ? apiPodSpec.volumes.map(asRecord) : [];
    const apiVolumeMounts = Array.isArray(api.volumeMounts) ? api.volumeMounts.map(asRecord) : [];
    const afscpSchemaPodSpec = jobPodSpec(documents, 'afscp-schema-bootstrap');
    const afscpSchemaContainer = podSpecContainer(afscpSchemaPodSpec, 'containers', 'afscp-schema-bootstrap');
    const afscpSchemaMounts = Array.isArray(afscpSchemaContainer.volumeMounts)
      ? afscpSchemaContainer.volumeMounts.map(asRecord)
      : [];
    const envValue = (container: Record<string, unknown>, name: string): string | undefined => {
      const env = Array.isArray(container.env) ? container.env.map(asRecord) : [];
      const entry = env.find((item) => item.name === name);
      return typeof entry?.value === 'string' ? entry.value : undefined;
    };
    const assertNoSubstrateCaProjection = (deploymentName: string, containerName: string): void => {
      const podSpec = deploymentPodSpec(documents, deploymentName);
      const container = deploymentContainer(documents, deploymentName, containerName);
      const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];
      const mounts = Array.isArray(container.volumeMounts) ? container.volumeMounts.map(asRecord) : [];
      expect(volumes.filter((volume) =>
        volume.name === 'substrate-ca-bundle'
        || (typeof volume.name === 'string' && /^substrate-[a-z0-9-]+-ca$/u.test(volume.name)),
      )).toEqual([]);
      expect(mounts.filter((mount) =>
        mount.name === 'substrate-ca-bundle'
        || (typeof mount.mountPath === 'string' && mount.mountPath.startsWith('/etc/agentsmith/substrate-ca')),
      )).toEqual([]);
      expect(envValue(container, 'NODE_EXTRA_CA_CERTS')).toBeUndefined();
      expect(envValue(container, 'SSL_CERT_DIR')).toBeUndefined();
    };

    expect(checkRenderedOutput(rendered.output).ok).toBe(true);
    expect(config.MINIO_USE_SSL).toBe('true');
    expect(config.INTERNAL_KEYCLOAK_BASE_URL).toBe('https://substrate-keycloak:8080');

    for (const [volumeName, secretName] of [
      ['substrate-postgresql-ca', 'postgresql-ca'],
      ['substrate-mongodb-ca', 'mongodb-ca'],
      ['substrate-redis-ca', 'redis-ca'],
      ['substrate-object-storage-ca', 'object-storage-ca'],
      ['substrate-oidc-ca', 'oidc-ca'],
    ] as const) {
      const volume = apiVolumes.find((item) => item.name === volumeName);
      expect(asRecord(volume?.secret).secretName).toBe(secretName);
      expect(asRecord((asRecord(volume?.secret).items as Record<string, unknown>[] | undefined)?.[0])).toEqual({
        key: 'ca.crt',
        path: 'ca.crt',
      });
      expect(apiVolumeMounts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: volumeName,
          mountPath: expect.stringContaining('/etc/agentsmith/substrate-ca/'),
          readOnly: true,
        }),
      ]));
    }

    expect(envValue(api, 'NODE_EXTRA_CA_CERTS')).toBe('/etc/agentsmith/substrate-ca-bundle/ca-bundle.crt');
    expect(apiVolumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'substrate-ca-bundle', emptyDir: {} }),
    ]));
    expect(apiVolumeMounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'substrate-ca-bundle',
        mountPath: '/etc/agentsmith/substrate-ca-bundle',
        readOnly: true,
      }),
    ]));
    expect(apiInit.image).toBe(asRecord(api).image);
    expect(String(apiInit.args)).toContain('/etc/agentsmith/substrate-ca/postgresql/ca.crt');
    expect(String(apiInit.args)).toContain('/etc/agentsmith/substrate-ca/object-storage/ca.crt');

    expect(envValue(afscpSchemaContainer, 'SSL_CERT_DIR')).toContain('/etc/agentsmith/substrate-ca/postgresql');
    expect(envValue(afscpSchemaContainer, 'SSL_CERT_DIR')).toContain('/etc/agentsmith/substrate-ca/object-storage');
    expect(afscpSchemaMounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'substrate-postgresql-ca',
        mountPath: '/etc/agentsmith/substrate-ca/postgresql',
        readOnly: true,
      }),
      expect.objectContaining({
        name: 'substrate-object-storage-ca',
        mountPath: '/etc/agentsmith/substrate-ca/object-storage',
        readOnly: true,
      }),
    ]));
    assertNoSubstrateCaProjection('agentsmith-llmup', 'llmup');
    assertNoSubstrateCaProjection('agentsmith-sandbox-control-plane', 'asbcp');
  });

  it('projects non-default substrate CA Secret keys to the canonical ca.crt path', async () => {
    const substrateTruth = `${withStrictTlsSubstrateTruth(
      readFileSync(join(fixturesDir, 'substrate-truth.sentinel.env'), 'utf8'),
    )}
SUBSTRATE_POSTGRES_CA_SECRET_KEY=tls-ca.pem
`;
    const rendered = await renderUnifiedDeployToString({
      profile: 'existing-cluster',
      substrateTruth,
    });
    const documents = parsedDocuments(rendered.output);
    const apiPodSpec = deploymentPodSpec(documents, 'agentsmith-api');
    const apiVolumes = Array.isArray(apiPodSpec.volumes) ? apiPodSpec.volumes.map(asRecord) : [];
    const postgresCaVolume = apiVolumes.find((volume) => volume.name === 'substrate-postgresql-ca');

    expect(asRecord((asRecord(postgresCaVolume?.secret).items as Record<string, unknown>[] | undefined)?.[0])).toEqual({
      key: 'tls-ca.pem',
      path: 'ca.crt',
    });
    expect(rendered.output).toContain('key: "tls-ca.pem"');
    expect(checkRenderedOutput(rendered.output).ok).toBe(true);
  });

  it('rejects unsafe substrate CA Secret keys before rendering YAML', async () => {
    const substrateTruth = `${withStrictTlsSubstrateTruth(
      readFileSync(join(fixturesDir, 'substrate-truth.sentinel.env'), 'utf8'),
    )}
SUBSTRATE_POSTGRES_CA_SECRET_KEY=ca.crt: {}
`;

    await expect(renderUnifiedDeployToString({
      profile: 'existing-cluster',
      substrateTruth,
    })).rejects.toThrow(/SUBSTRATE_POSTGRES_CA_SECRET_KEY must be a Kubernetes Secret data key/u);
  });

  it('renders IPv4 EndpointSlice addressType for local-kind substrate gateway truth', async () => {
    const substrateTruth = readFileSync(join(fixturesDir, 'substrate-truth.sentinel.env'), 'utf8')
      .replace(/^SUBSTRATE_POSTGRES_HOST=.*$/mu, 'SUBSTRATE_POSTGRES_HOST=172.19.0.1')
      .replace(/^SUBSTRATE_MONGODB_HOST=.*$/mu, 'SUBSTRATE_MONGODB_HOST=172.19.0.1')
      .replace(/^SUBSTRATE_REDIS_HOST=.*$/mu, 'SUBSTRATE_REDIS_HOST=172.19.0.1')
      .replace(/^SUBSTRATE_MINIO_HOST=.*$/mu, 'SUBSTRATE_MINIO_HOST=172.19.0.1')
      .replace(/^SUBSTRATE_KEYCLOAK_HOST=.*$/mu, 'SUBSTRATE_KEYCLOAK_HOST=172.19.0.1');
    const rendered = await renderUnifiedDeployToString({
      profile: 'local-kind',
      substrateTruth,
    });
    const documents = parsedDocuments(rendered.output);
    const mongodbEndpoint = findResource(documents, 'EndpointSlice', 'substrate-mongodb');
    const endpoints = Array.isArray(asRecord(mongodbEndpoint).endpoints)
      ? asRecord(mongodbEndpoint).endpoints as unknown[]
      : [];

    expect(mongodbEndpoint.addressType).toBe('IPv4');
    expect(asRecord(endpoints[0]).addresses).toEqual(['172.19.0.1']);
  });

  it('renders IPv6 EndpointSlice addressType for IPv6 substrate truth', async () => {
    const substrateTruth = readFileSync(join(fixturesDir, 'substrate-truth.sentinel.env'), 'utf8')
      .replace(/^SUBSTRATE_POSTGRES_HOST=.*$/mu, 'SUBSTRATE_POSTGRES_HOST=fd00:10::31')
      .replace(/^SUBSTRATE_MONGODB_HOST=.*$/mu, 'SUBSTRATE_MONGODB_HOST=fd00:10::32')
      .replace(/^SUBSTRATE_REDIS_HOST=.*$/mu, 'SUBSTRATE_REDIS_HOST=fd00:10::33')
      .replace(/^SUBSTRATE_MINIO_HOST=.*$/mu, 'SUBSTRATE_MINIO_HOST=fd00:10::34')
      .replace(/^SUBSTRATE_KEYCLOAK_HOST=.*$/mu, 'SUBSTRATE_KEYCLOAK_HOST=fd00:10::35');
    const rendered = await renderUnifiedDeployToString({
      profile: 'existing-cluster',
      substrateTruth,
    });
    const documents = parsedDocuments(rendered.output);
    const mongodbEndpoint = findResource(documents, 'EndpointSlice', 'substrate-mongodb');
    const endpoints = Array.isArray(asRecord(mongodbEndpoint).endpoints)
      ? asRecord(mongodbEndpoint).endpoints as unknown[]
      : [];

    expect(mongodbEndpoint.addressType).toBe('IPv6');
    expect(asRecord(endpoints[0]).addresses).toEqual(['fd00:10::32']);
  });

  it('rejects FQDN substrate hosts until DNS-backed bindings are explicitly supported', async () => {
    const substrateTruth = readFileSync(join(fixturesDir, 'substrate-truth.sentinel.env'), 'utf8')
      .replace(/^SUBSTRATE_MONGODB_HOST=.*$/mu, 'SUBSTRATE_MONGODB_HOST=sentinel-mongodb.truth.example');

    await expect(renderUnifiedDeployToString({
      profile: 'existing-cluster',
      substrateTruth,
    })).rejects.toThrow(/SUBSTRATE_MONGODB_HOST.*IPv4 or IPv6/u);
  });

  it('rejects app-owned keys in substrate truth before they can override deploy env', async () => {
    const substrateTruth = `${await readFile(join(fixturesDir, 'substrate-truth.valid.env'), 'utf8')}
PUBLIC_BASE_URL=http://wrong.example.test
PUBLIC_API_BASE_URL=http://wrong.example.test/api/v1
ASBCP_SERVICE_KEY=substrate_should_not_override_app_secret
`;

    await expect(renderUnifiedDeployToString({
      profile: 'local-kind',
      siteEnv: await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'),
      substrateTruth,
    })).rejects.toThrow(
      /PUBLIC_BASE_URL is not allowed|PUBLIC_API_BASE_URL is not allowed|ASBCP_SERVICE_KEY is not allowed/u,
    );
  });

  it('keeps API dependency env names aligned with the Node entrypoint reads', async () => {
    const rendered = await renderUnifiedDeployFromFiles({
      profile: 'existing-cluster',
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const documents = parsedDocuments(rendered.output);
    const configMap = documents.find((document) =>
      resourceKind(document) === 'ConfigMap' && resourceName(document) === 'agentsmith-app-config',
    );
    const config = asRecord(asRecord(configMap).data);
    const apiEnvFrom = deploymentContainerEnvFrom(documents, 'agentsmith-api', 'api');
    const web = deploymentContainer(documents, 'agentsmith-web', 'web');

    expect(apiEnvFrom).toEqual(expect.arrayContaining([
      { configMapRef: { name: 'agentsmith-app-config' } },
      { secretRef: { name: 'agentsmith-app-secrets' } },
    ]));
    expect(containerEnvEntry(documents, 'agentsmith-web', 'web', 'MONGO_URL')).toEqual({
      name: 'MONGO_URL',
      valueFrom: {
        secretKeyRef: {
          name: 'agentsmith-app-secrets',
          key: 'MONGO_URL',
        },
      },
    });
    expect(containerEnvEntry(documents, 'agentsmith-web', 'web', 'MONGO_DB_NAME')).toEqual({
      name: 'MONGO_DB_NAME',
      valueFrom: {
        secretKeyRef: {
          name: 'agentsmith-app-secrets',
          key: 'MONGO_DB_NAME',
        },
      },
    });
    expect(web.envFrom ?? []).toEqual([]);
    expect(config.MINIO_ENDPOINT).toBe('substrate-minio');
    expect(config.MINIO_PORT).toBe('9000');
    expect(config.MINIO_USE_SSL).toBe('false');
    expect(config.MINIO_BUCKET).toBe('sentinel-files');
    expect(config.KEYCLOAK_ISSUER_URL).toBe('https://sentinel-login.example.com/realms/sentinel-realm');
    expect(config.PUBLIC_KEYCLOAK_BASE_URL).toBe('https://sentinel-login.example.com');
    expect(config.INTERNAL_KEYCLOAK_BASE_URL).toBe('http://substrate-keycloak:8080');
    expect(config.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE).toBeUndefined();
    expect(config.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE).toBeUndefined();
    expect(config.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT).toBeUndefined();
    expect(config.KEYCLOAK_REALM).toBe('sentinel-realm');
    expect(config.KEYCLOAK_ADMIN_CLIENT_ID).toBe('admin-cli');
  });

  it('rejects llmup Service exposure through NodePort or LoadBalancer', () => {
    const rendered = readFileSync(join(fixturesDir, 'llmup-public-service.yaml'), 'utf8');
    const text = checkRenderedOutput(rendered).failures.map((failure) => failure.message).join('\n');

    expect(text).toContain('llmup Service must remain ClusterIP');
  });

  it('rejects alternate public Services that expose llmup by name or selector', () => {
    const rendered = readFileSync(join(fixturesDir, 'llmup-public-selector-service.yaml'), 'utf8');
    const text = checkRenderedOutput(rendered).failures.map((failure) => failure.message).join('\n');

    expect(text).toContain('llmup Service must remain ClusterIP');
  });

  it('rejects public exposure of ASBCP through Service type or ingress route', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const service = findResource(documents, 'Service', 'agentsmith-sandbox-control-plane');
    const ingress = findResource(documents, 'Ingress', 'agentsmith');
    const rules = Array.isArray(asRecord(ingress.spec).rules) ? asRecord(ingress.spec).rules as unknown[] : [];
    const paths = Array.isArray(asRecord(asRecord(rules[0]).http).paths)
      ? asRecord(asRecord(rules[0]).http).paths as unknown[]
      : [];
    const firstPath = asRecord(paths[0]);

    asRecord(service.spec).type = 'LoadBalancer';
    firstPath.path = '/asbcp';
    asRecord(asRecord(firstPath.backend).service).name = 'agentsmith-sandbox-control-plane';

    const text = checkRenderedOutput(stringifyDocuments(documents)).failures
      .map((failure) => failure.message)
      .join('\n');

    expect(text).toContain('ASBCP Service must remain ClusterIP');
    expect(text).toContain('ASBCP services must remain internal only');
  });

  it('fingerprints redacted rendered manifests so secret value changes do not change evidence', () => {
    const baseManifest = `apiVersion: v1
kind: Secret
metadata:
  name: agentsmith-app-secrets
stringData:
  DATABASE_URL: postgresql://user:first-password@postgres:5432/agentsmith
  CUSTOM_API_KEY: first-key
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: agentsmith-app-config
data:
  PUBLIC_BASE_URL: http://agentsmith.localtest.me
  NORMAL_SETTING: stable
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentsmith-api
spec:
  template:
    spec:
      containers:
        - name: api
          env:
            - name: CUSTOM_TOKEN
              value: first-token
`;
    const secretChanged = baseManifest
      .replace('first-password', 'second-password')
      .replace('first-key', 'second-key')
      .replace('first-token', 'second-token');
    const configChanged = baseManifest.replace('NORMAL_SETTING: stable', 'NORMAL_SETTING: changed');

    expect(fingerprintRenderedManifest(secretChanged)).toBe(fingerprintRenderedManifest(baseManifest));
    expect(fingerprintRenderedManifest(configChanged)).not.toBe(fingerprintRenderedManifest(baseManifest));
  });

  it('writes machine-readable producer evidence without leaking substrate secrets', async () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), 'unified-deploy-evidence-'));
    tempRoots.push(evidenceDir);

    const evidence = await writeProducerEvidence({
      producer: 'render',
      status: 'passed',
      failures: [],
      evidenceDir,
    });

    expect(evidence.schema_version).toBe('agentsmith.unified-deploy.evidence/v1');
    expect(evidence.producer).toBe('render');
    expect(evidence.status).toBe('passed');
    expect(evidence.profiles.map((profile) => profile.profile)).toEqual(['local-kind', 'existing-cluster']);
    expect(evidence.profiles[0].rendered_config_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(evidence.profiles[0].redacted_substrate_truth_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(evidence.profiles[0].resource_summary.kinds.Deployment).toBeGreaterThan(0);
    expect(evidence.paths.report_path).toContain('unified-deploy');
    expect(evidence.paths.log_path).toContain('unified-deploy');

    const reportText = readFileSync(evidence.paths.report_path, 'utf8');
    expect(reportText).not.toContain('agentsmith_dev_password');
    expect(reportText).not.toContain('SUBSTRATE_POSTGRES_PASSWORD=agentsmith_dev_password');
    expect(reportText).not.toContain('postgresql://agentsmith:agentsmith_dev_password');
  });

  it('defaults producer evidence to the release campaign unified-deploy root when release env is present', async () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'unified-deploy-release-campaign-'));
    tempRoots.push(campaignRoot);
    const previousCampaignRoot = process.env.RELEASE_CAMPAIGN_ROOT;
    const previousReleaseRoot = process.env.UNIFIED_DEPLOY_RELEASE_ROOT_DIR;

    try {
      process.env.RELEASE_CAMPAIGN_ROOT = campaignRoot;
      delete process.env.UNIFIED_DEPLOY_RELEASE_ROOT_DIR;

      const evidence = await writeProducerEvidence({
        producer: 'render',
        status: 'passed',
        failures: [],
      });

      expect(evidence.paths.report_path).toContain(join(campaignRoot, 'unified-deploy'));
      expect(evidence.paths.log_path).toContain(join(campaignRoot, 'unified-deploy'));
    } finally {
      if (previousCampaignRoot === undefined) {
        delete process.env.RELEASE_CAMPAIGN_ROOT;
      } else {
        process.env.RELEASE_CAMPAIGN_ROOT = previousCampaignRoot;
      }
      if (previousReleaseRoot === undefined) {
        delete process.env.UNIFIED_DEPLOY_RELEASE_ROOT_DIR;
      } else {
        process.env.UNIFIED_DEPLOY_RELEASE_ROOT_DIR = previousReleaseRoot;
      }
    }
  });
});
