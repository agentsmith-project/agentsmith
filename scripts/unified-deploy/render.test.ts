import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SITE_ENV_PATH,
  parseSiteEnv,
  renderUnifiedDeployPreflightFromFiles,
  renderUnifiedDeployFromFiles,
  renderUnifiedDeployToString,
} from './render';
import { checkApiProductionEntrypointScripts, checkRenderedOutput } from './check-render';
import { fingerprintRenderedManifest, writeProducerEvidence } from './evidence';

const tempRoots: string[] = [];
const fixturesDir = join(process.cwd(), 'scripts', 'unified-deploy', '__fixtures__');

function parsedDocuments(rendered: string): Record<string, unknown>[] {
  return YAML.parseAllDocuments(rendered)
    .map((document) => document.toJSON())
    .filter((document): document is Record<string, unknown> =>
      document !== null && typeof document === 'object' && !Array.isArray(document),
    );
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

function deploymentPodSpec(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
): Record<string, unknown> {
  const deployment = findResource(documents, 'Deployment', deploymentName);
  return asRecord(asRecord(asRecord(asRecord(deployment.spec).template).spec));
}

function deploymentPodTemplateAnnotations(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
): Record<string, unknown> {
  const deployment = findResource(documents, 'Deployment', deploymentName);
  return asRecord(asRecord(asRecord(asRecord(deployment.spec).template).metadata).annotations);
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

function resourceStringsFromRules(resource: Record<string, unknown>): Set<string> {
  const rules = Array.isArray(resource.rules) ? resource.rules.map(asRecord) : [];
  return new Set(rules.flatMap((rule) =>
    Array.isArray(rule.resources)
      ? rule.resources.filter((item): item is string => typeof item === 'string')
      : [],
  ));
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

  it('keeps default producer evidence artifacts out of git', () => {
    const result = spawnSync('git', ['check-ignore', '-q', 'artifacts/unified-deploy/example.json'], {
      cwd: process.cwd(),
    });

    expect(result.status).toBe(0);
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
        'Deployment/agentsmith-sandbox-manager',
        'Service/agentsmith-web',
        'Service/agentsmith-api',
        'Service/agentsmith-llmup',
        'Service/agentsmith-sandbox-manager',
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
        'ServiceAccount/agentsmith-sandbox-manager',
        'Role/agentsmith-sandbox-manager',
        'RoleBinding/agentsmith-sandbox-manager',
        'ConfigMap/sandbox-manager-config',
        'ConfigMap/agentsmith-llmup-config',
        'ConfigMap/agentsmith-managed-runner-support',
        'Ingress/agentsmith',
      ]));
      expect(namesByKind).not.toContain('Namespace/agentsmith');
      expect(namesByKind).not.toEqual(expect.arrayContaining([
        'ClusterRole/agentsmith-sandbox-manager-pv',
        'ClusterRoleBinding/agentsmith-sandbox-manager-pv',
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

  it('keeps local-kind namespace creation in a separate admin preflight render', async () => {
    const appRendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const preflightRendered = await renderUnifiedDeployPreflightFromFiles({ profile: 'local-kind' });

    const appNames = parsedDocuments(appRendered.output).map((document) => `${resourceKind(document)}/${resourceName(document)}`);
    const preflightNames = parsedDocuments(preflightRendered.output).map((document) => `${resourceKind(document)}/${resourceName(document)}`);

    expect(appNames).not.toContain('Namespace/agentsmith');
    expect(preflightNames).toContain('Namespace/agentsmith');
    expect(preflightNames).toContain('ClusterRole/agentsmith-sandbox-manager-pv');
    expect(preflightNames).toContain('ClusterRoleBinding/agentsmith-sandbox-manager-pv');

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

  it('gives the Web-owned API routes the app secrets needed by Next.js server routes', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const routes = serviceBackends(rendered.output);
    const envFrom = deploymentContainerEnvFrom(documents, 'agentsmith-web', 'web');

    expect(routes.get('/api/public')).toBe('agentsmith-web');
    expect(routes.get('/api/system')).toBe('agentsmith-web');
    expect(envFrom).toEqual(expect.arrayContaining([
      { configMapRef: { name: 'agentsmith-app-config' } },
      { secretRef: { name: 'agentsmith-app-secrets' } },
    ]));
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
    expect(apiPackage.scripts?.build).toContain('--banner:js=');
    expect(apiPackage.scripts?.build).toContain('createRequire');
    expect(apiPackage.scripts?.build).toContain('node:module');
    expect(apiPackage.scripts?.build).toContain('import.meta.url');
    expect(apiPackage.scripts?.build).toContain('--outfile=dist/index.js');
    expect(apiPackage.scripts?.start).toBe('node dist/index.js');
    expect(apiPackage.scripts?.start).not.toMatch(/\btsx\b|src\/index\.ts|api:node:dev/u);
    expect(dockerfile).toContain('npm run api:node:build');
    expect(checkApiProductionEntrypointScripts().ok).toBe(true);
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
    expect(messages).toContain('api package build must bundle src/index.ts to dist/index.js');
    expect(messages).toContain('api package ESM bundle must inject Node createRequire for bundled CJS dependencies');
    expect(messages).toContain('Dockerfile.agentsmith-app must build the API production entrypoint');
  });

  it('renders service-specific startup commands for the shared app image workloads', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const web = deploymentContainer(documents, 'agentsmith-web', 'web');
    const api = deploymentContainer(documents, 'agentsmith-api', 'api');
    const webPorts = Array.isArray(web.ports) ? web.ports.map(asRecord) : [];
    const apiPorts = Array.isArray(api.ports) ? api.ports.map(asRecord) : [];
    const apiEnv = Array.isArray(api.env) ? api.env.map(asRecord) : [];
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
    ]));
    expect(ingressPorts.get('/api/v1')).toBe(20000);
  });

  it('renders the sandbox-manager startup contract without leaking storage secrets through ConfigMaps', async () => {
    const rendered = await renderUnifiedDeployFromFiles({
      profile: 'local-kind',
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
    });
    const documents = parsedDocuments(rendered.output);
    const configMap = findResource(documents, 'ConfigMap', 'sandbox-manager-config');
    const appConfigMap = findResource(documents, 'ConfigMap', 'agentsmith-app-config');
    const configData = asRecord(configMap.data);
    const appConfigData = asRecord(appConfigMap.data);
    const managerConfig = typeof configData['manager-config.yaml'] === 'string'
      ? configData['manager-config.yaml']
      : '';
    const podSpec = deploymentPodSpec(documents, 'agentsmith-sandbox-manager');
    const sandboxManager = deploymentContainer(documents, 'agentsmith-sandbox-manager', 'sandbox-manager');
    const volumeMounts = Array.isArray(sandboxManager.volumeMounts)
      ? sandboxManager.volumeMounts.map(asRecord)
      : [];
    const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];

    expect(managerConfig).toContain('version: 1');
    expect(managerConfig).toContain('httpPort: 8080');
    expect(managerConfig).toContain('requestIdHeader: X-Request-Id');
    expect(managerConfig).toContain('headerName: X-Service-Key');
    expect(managerConfig).toContain('requestTimeout: 15s');
    expect(managerConfig).toContain('namespace: agentsmith');
    expect(configData.SANDBOX_SERVICE_KEY).toBeUndefined();
    expect(configData.JUICEFS_STORAGE_SECRET_KEY).toBeUndefined();
    expect(appConfigData.MINIO_SECRET_KEY).toBeUndefined();

    expect(podSpec.serviceAccountName).toBe('agentsmith-sandbox-manager');
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-manager', 'sandbox-manager', 'CONFIG_PATH')).toEqual({
      name: 'CONFIG_PATH',
      value: '/etc/sandbox-manager/manager-config.yaml',
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-manager', 'sandbox-manager', 'SERVICE_KEYS')).toEqual({
      name: 'SERVICE_KEYS',
      valueFrom: {
        secretKeyRef: {
          name: 'agentsmith-app-secrets',
          key: 'SANDBOX_SERVICE_KEY',
        },
      },
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-manager', 'sandbox-manager', 'K8S_NAMESPACE')).toEqual({
      name: 'K8S_NAMESPACE',
      value: 'agentsmith',
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-manager', 'sandbox-manager', 'JUICEFS_STORAGE_ENDPOINT')).toEqual({
      name: 'JUICEFS_STORAGE_ENDPOINT',
      value: 'http://substrate-minio.agentsmith.svc.cluster.local:9000',
    });
    expect(appConfigData.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE).toBe('substrate-postgresql.agentsmith.svc.cluster.local');
    expect(appConfigData.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE).toBe('5432');
    expect(appConfigData.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT).toBe('http://substrate-minio.agentsmith.svc.cluster.local:9000');
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-manager', 'sandbox-manager', 'JUICEFS_STORAGE_ACCESS_KEY')).toEqual({
      name: 'JUICEFS_STORAGE_ACCESS_KEY',
      valueFrom: {
        secretKeyRef: {
          name: 'agentsmith-app-secrets',
          key: 'MINIO_ACCESS_KEY',
        },
      },
    });
    expect(containerEnvEntry(documents, 'agentsmith-sandbox-manager', 'sandbox-manager', 'JUICEFS_STORAGE_SECRET_KEY')).toEqual({
      name: 'JUICEFS_STORAGE_SECRET_KEY',
      valueFrom: {
        secretKeyRef: {
          name: 'agentsmith-app-secrets',
          key: 'MINIO_SECRET_KEY',
        },
      },
    });
    expect(volumeMounts).toEqual(expect.arrayContaining([
      {
        name: 'config',
        mountPath: '/etc/sandbox-manager/manager-config.yaml',
        subPath: 'manager-config.yaml',
      },
    ]));
    expect(volumes).toEqual(expect.arrayContaining([
      {
        name: 'config',
        configMap: {
          name: 'sandbox-manager-config',
        },
      },
    ]));
  });

  it('renders a dedicated sandbox-manager runtime identity with only namespaced app permissions', async () => {
    const rendered = await renderUnifiedDeployFromFiles({ profile: 'local-kind' });
    const documents = parsedDocuments(rendered.output);
    const role = findResource(documents, 'Role', 'agentsmith-sandbox-manager');
    const roleBinding = findResource(documents, 'RoleBinding', 'agentsmith-sandbox-manager');
    const clusterRole = findResource(documents, 'ClusterRole', 'agentsmith-sandbox-manager-pv');
    const clusterRoleBinding = findResource(documents, 'ClusterRoleBinding', 'agentsmith-sandbox-manager-pv');
    const roleResources = resourceStringsFromRules(role);
    const roleSubjects = Array.isArray(roleBinding.subjects) ? roleBinding.subjects.map(asRecord) : [];

    for (const expectedResource of [
      'pods',
      'pods/status',
      'pods/exec',
      'persistentvolumeclaims',
      'secrets',
      'events',
    ]) {
      expect(roleResources.has(expectedResource)).toBe(true);
    }
    expect(roleResources.has('persistentvolumes')).toBe(false);
    expect(roleSubjects).toEqual(expect.arrayContaining([
      {
        kind: 'ServiceAccount',
        name: 'agentsmith-sandbox-manager',
        namespace: 'agentsmith',
      },
    ]));
    expect(asRecord(roleBinding.roleRef).name).toBe('agentsmith-sandbox-manager');
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
    const appSecretChecksum = resourceDataChecksum(documents, 'Secret', 'agentsmith-app-secrets', 'stringData');
    const llmupConfigChecksum = resourceDataChecksum(documents, 'ConfigMap', 'agentsmith-llmup-config', 'data');
    const sandboxConfigChecksum = resourceDataChecksum(documents, 'ConfigMap', 'sandbox-manager-config', 'data');

    for (const deploymentName of ['agentsmith-web', 'agentsmith-api']) {
      expect(deploymentPodTemplateAnnotations(documents, deploymentName)).toMatchObject({
        'agentsmith.mbos.dev/checksum-app-config': appConfigChecksum,
        'agentsmith.mbos.dev/checksum-app-secrets': appSecretChecksum,
      });
    }
    expect(deploymentPodTemplateAnnotations(documents, 'agentsmith-llmup')).toMatchObject({
      'agentsmith.mbos.dev/checksum-llmup-config': llmupConfigChecksum,
      'agentsmith.mbos.dev/checksum-app-secrets': appSecretChecksum,
    });
    expect(deploymentPodTemplateAnnotations(documents, 'agentsmith-sandbox-manager')).toMatchObject({
      'agentsmith.mbos.dev/checksum-sandbox-manager-config': sandboxConfigChecksum,
      'agentsmith.mbos.dev/checksum-app-secrets': appSecretChecksum,
    });

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

    const appSecretChanged = await renderUnifiedDeployToString({
      profile: 'local-kind',
      substrateTruth: substrateTruth.replace(
        'SUBSTRATE_POSTGRES_PASSWORD=sentinel_pg_secret',
        'SUBSTRATE_POSTGRES_PASSWORD=sentinel_pg_secret_rotated',
      ),
    });
    const appSecretChangedDocuments = parsedDocuments(appSecretChanged.output);
    for (const deploymentName of ['agentsmith-web', 'agentsmith-api', 'agentsmith-llmup', 'agentsmith-sandbox-manager']) {
      expect(
        deploymentPodTemplateAnnotations(appSecretChangedDocuments, deploymentName)['agentsmith.mbos.dev/checksum-app-secrets'],
      ).not.toBe(appSecretChecksum);
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
    const secret = documents.find((document) =>
      resourceKind(document) === 'Secret' && resourceName(document) === 'agentsmith-app-secrets',
    );
    const config = asRecord(asRecord(configMap).data);
    const stringData = asRecord(asRecord(secret).stringData);

    expect(firstEndpoint.addresses).toEqual(['198.51.100.31']);
    expect(stringData.DATABASE_URL).toBe('postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:5432/sentinel_pg_db');
    expect(stringData.MONGO_URL).toBe('mongodb://sentinel_mongo_user:sentinel_mongo_secret@substrate-mongodb:27017/admin');
    expect(stringData.MONGO_DB_NAME).toBe('sentinel_mongo_db');
    expect(stringData.MONGODB_URI).toBeUndefined();
    expect(stringData.REDIS_URL).toBe('redis://:sentinel_redis_secret@substrate-redis:6379/0');
    expect(config.MINIO_ENDPOINT).toBe('substrate-minio');
    expect(config.MINIO_PORT).toBe('9000');
    expect(config.MINIO_USE_SSL).toBe('false');
    expect(config.MINIO_BUCKET).toBe('sentinel-files');
    expect(config.FILE_LIBRARY_CLIENT_MINIO_ENDPOINT).toBeUndefined();
    expect(config.KEYCLOAK_ISSUER_URL).toBe('https://sentinel-login.example.com/realms/sentinel-realm');
    expect(config.PUBLIC_KEYCLOAK_BASE_URL).toBe('https://sentinel-login.example.com');
    expect(config.INTERNAL_KEYCLOAK_BASE_URL).toBe('http://substrate-keycloak:8080');
    expect(config.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE).toBe('substrate-postgresql.agentsmith.svc.cluster.local');
    expect(config.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE).toBe('5432');
    expect(config.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT).toBe('http://substrate-minio.agentsmith.svc.cluster.local:9000');
    expect(config.KEYCLOAK_REALM).toBe('sentinel-realm');
    expect(config.KEYCLOAK_ADMIN_CLIENT_ID).toBe('admin-cli');
    expect(stringData.KEYCLOAK_ADMIN).toBe('sentinel-admin');
    expect(stringData.KEYCLOAK_ADMIN_PASSWORD).toBe('sentinel-admin-secret');
    expect(rendered.output).not.toContain('agentsmith-substrate-postgresql.local');
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
SANDBOX_SERVICE_KEY=substrate_should_not_override_app_secret
`;

    await expect(renderUnifiedDeployToString({
      profile: 'local-kind',
      siteEnv: await readFile(DEFAULT_SITE_ENV_PATH, 'utf8'),
      substrateTruth,
    })).rejects.toThrow(
      /PUBLIC_BASE_URL is not allowed|PUBLIC_API_BASE_URL is not allowed|SANDBOX_SERVICE_KEY is not allowed/u,
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
    const secret = documents.find((document) =>
      resourceKind(document) === 'Secret' && resourceName(document) === 'agentsmith-app-secrets',
    );
    const config = asRecord(asRecord(configMap).data);
    const stringData = asRecord(asRecord(secret).stringData);

    expect(stringData.DATABASE_URL).toBe('postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:5432/sentinel_pg_db');
    expect(stringData.MONGO_URL).toBe('mongodb://sentinel_mongo_user:sentinel_mongo_secret@substrate-mongodb:27017/admin');
    expect(stringData.MONGO_DB_NAME).toBe('sentinel_mongo_db');
    expect(stringData.REDIS_URL).toBe('redis://:sentinel_redis_secret@substrate-redis:6379/0');
    expect(config.MINIO_ENDPOINT).toBe('substrate-minio');
    expect(config.MINIO_PORT).toBe('9000');
    expect(config.MINIO_USE_SSL).toBe('false');
    expect(config.MINIO_BUCKET).toBe('sentinel-files');
    expect(stringData.MINIO_ACCESS_KEY).toBe('sentinel_minio_access');
    expect(stringData.MINIO_SECRET_KEY).toBe('sentinel_minio_secret');
    expect(config.KEYCLOAK_ISSUER_URL).toBe('https://sentinel-login.example.com/realms/sentinel-realm');
    expect(config.PUBLIC_KEYCLOAK_BASE_URL).toBe('https://sentinel-login.example.com');
    expect(config.INTERNAL_KEYCLOAK_BASE_URL).toBe('http://substrate-keycloak:8080');
    expect(config.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE).toBe('substrate-postgresql.agentsmith.svc.cluster.local');
    expect(config.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE).toBe('5432');
    expect(config.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT).toBe('http://substrate-minio.agentsmith.svc.cluster.local:9000');
    expect(config.KEYCLOAK_REALM).toBe('sentinel-realm');
    expect(config.KEYCLOAK_ADMIN_CLIENT_ID).toBe('admin-cli');
    expect(stringData.KEYCLOAK_ADMIN).toBe('sentinel-admin');
    expect(stringData.KEYCLOAK_ADMIN_PASSWORD).toBe('sentinel-admin-secret');
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
});
