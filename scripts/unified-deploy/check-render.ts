import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { asRecord, type CheckFailure, type CheckResult } from './manifest';
import { checkApiSingleReplica } from './check-api-single-replica';
import { substrateMinioInternalMountEndpoint } from './substrate-address-roles';
import {
  componentLabel,
  parseKubernetesDocuments,
  recursivelyContainsString,
  resourceId,
  resourceKind,
  resourceName,
} from './kubernetes';
import { checkAddressTruth } from './check-address-truth';
import { renderUnifiedDeployFromFiles } from './render';
import { writeProducerEvidence } from './evidence';

const REQUIRED_COMPONENT_DEPLOYMENTS = new Map([
  ['web', 'agentsmith-web'],
  ['api', 'agentsmith-api'],
  ['llmup', 'agentsmith-llmup'],
  ['afscp-api', 'afscp-api'],
  ['afscp-worker', 'afscp-worker'],
  ['afscp-export-gateway', 'afscp-export-gateway'],
  ['sandbox-manager', 'agentsmith-sandbox-manager'],
]);
const REQUIRED_COMPONENT_SERVICES = new Map([
  ['web', 'agentsmith-web'],
  ['api', 'agentsmith-api'],
  ['llmup', 'agentsmith-llmup'],
  ['afscp-api', 'afscp-api'],
  ['afscp-export-gateway', 'afscp-export-gateway'],
  ['sandbox-manager', 'agentsmith-sandbox-manager'],
]);
const REQUIRED_SUBSTRATE_SERVICES = ['postgresql', 'mongodb', 'redis', 'minio', 'keycloak'] as const;
const FORBIDDEN_SUBSTRATE_WORKLOADS = ['postgresql', 'mongodb', 'redis', 'minio', 'keycloak'] as const;
const API_ROOT_BUILD_SCRIPT = 'npm run build -w @mbos/api-entry-node';
const API_ROOT_START_SCRIPT = 'npm run start -w @mbos/api-entry-node';
const API_PACKAGE_START_SCRIPT = 'node dist/index.js';
const API_PACKAGE_MAIN = 'dist/index.js';
const API_PACKAGE_CREATE_REQUIRE_BANNER_SNIPPETS = [
  '--banner:js=',
  'createRequire',
  'node:module',
  'import.meta.url',
] as const;
const SANDBOX_MANAGER_SERVICE_ACCOUNT = 'agentsmith-sandbox-manager';
const SANDBOX_MANAGER_CONFIG_MAP = 'sandbox-manager-config';
const SANDBOX_MANAGER_CONFIG_PATH = '/etc/sandbox-manager/manager-config.yaml';
const LLMUP_CONFIG_MAP = 'agentsmith-llmup-config';
const LLMUP_CONFIG_PATH = '/app/config/config.yaml';
const AFSCP_RUNTIME_SERVICE_ACCOUNT = 'afscp-runtime';
const AFSCP_RUNTIME_CONFIG_MAP = 'afscp-runtime-config';
const AFSCP_RUNTIME_SECRET = 'afscp-runtime-secrets';
const AFSCP_VOLUME_SECRET = 'afscp-default-volume-juicefs';
const AFSCP_VOLUME_ROOT_PATH = '/var/lib/afscp/volumes/default';
const ROLLOUT_CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;

type PackageJsonLike = {
  main?: unknown;
  scripts?: unknown;
};

type ApiProductionEntrypointOptions = {
  rootPackage?: PackageJsonLike;
  apiPackage?: PackageJsonLike;
  dockerfileText?: string;
};

function addFailure(failures: CheckFailure[], resourcePath: string, message: string): void {
  failures.push({ path: resourcePath, message });
}

function readPackageJson(relativePath: string): PackageJsonLike {
  return asRecord(JSON.parse(readFileSync(path.join(process.cwd(), relativePath), 'utf8')) as unknown);
}

function packageScripts(packageJson: PackageJsonLike): Record<string, unknown> {
  return asRecord(packageJson.scripts);
}

function includesForbiddenApiStartRuntime(command: string): boolean {
  return /\btsx\b|src\/index\.ts|api:node:dev/u.test(command);
}

export function checkApiProductionEntrypointScripts(
  options: ApiProductionEntrypointOptions = {},
): CheckResult {
  const failures: CheckFailure[] = [];
  const rootPackage = options.rootPackage ?? readPackageJson('package.json');
  const apiPackage = options.apiPackage ?? readPackageJson('packages/api-entry-node/package.json');
  const dockerfileText = options.dockerfileText
    ?? readFileSync(path.join(process.cwd(), 'infra', 'deploy', 'Dockerfile.agentsmith-app'), 'utf8');
  const rootScripts = packageScripts(rootPackage);
  const apiScripts = packageScripts(apiPackage);
  const rootBuild = typeof rootScripts['api:node:build'] === 'string' ? rootScripts['api:node:build'] : '';
  const rootStart = typeof rootScripts['api:node:start'] === 'string' ? rootScripts['api:node:start'] : '';
  const apiBuild = typeof apiScripts.build === 'string' ? apiScripts.build : '';
  const apiStart = typeof apiScripts.start === 'string' ? apiScripts.start : '';

  if (rootBuild !== API_ROOT_BUILD_SCRIPT) {
    addFailure(failures, 'package.json:scripts.api:node:build', 'api:node:build must delegate to @mbos/api-entry-node build');
  }
  if (rootStart !== API_ROOT_START_SCRIPT || includesForbiddenApiStartRuntime(rootStart)) {
    addFailure(failures, 'package.json:scripts.api:node:start', 'api:node:start must delegate to @mbos/api-entry-node start');
  }
  if (apiPackage.main !== API_PACKAGE_MAIN) {
    addFailure(failures, 'packages/api-entry-node/package.json:main', 'api package main must point to dist/index.js');
  }
  if (
    !apiBuild.includes('esbuild src/index.ts')
    || !apiBuild.includes('--bundle')
    || !apiBuild.includes('--platform=node')
    || !apiBuild.includes('--format=esm')
    || !apiBuild.includes('--outfile=dist/index.js')
  ) {
    addFailure(
      failures,
      'packages/api-entry-node/package.json:scripts.build',
      'api package build must bundle src/index.ts to dist/index.js',
    );
  }
  if (!API_PACKAGE_CREATE_REQUIRE_BANNER_SNIPPETS.every((snippet) => apiBuild.includes(snippet))) {
    addFailure(
      failures,
      'packages/api-entry-node/package.json:scripts.build',
      'api package ESM bundle must inject Node createRequire for bundled CJS dependencies',
    );
  }
  if (apiStart !== API_PACKAGE_START_SCRIPT || includesForbiddenApiStartRuntime(apiStart)) {
    addFailure(
      failures,
      'packages/api-entry-node/package.json:scripts.start',
      'api package start must run node dist/index.js',
    );
  }
  if (!dockerfileText.includes('npm run api:node:build')) {
    addFailure(
      failures,
      'infra/deploy/Dockerfile.agentsmith-app',
      'Dockerfile.agentsmith-app must build the API production entrypoint',
    );
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function hasResource(
  documents: readonly Record<string, unknown>[],
  kind: string,
  name: string,
): boolean {
  return documents.some((document) => resourceKind(document) === kind && resourceName(document) === name);
}

function checkRequiredResources(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  for (const [component, deploymentName] of REQUIRED_COMPONENT_DEPLOYMENTS) {
    if (!hasResource(documents, 'Deployment', deploymentName)) {
      addFailure(failures, `Deployment/${deploymentName}`, `${component} Deployment must be rendered`);
    }
  }

  for (const [component, serviceName] of REQUIRED_COMPONENT_SERVICES) {
    if (!hasResource(documents, 'Service', serviceName)) {
      addFailure(failures, `Service/${serviceName}`, `${component} Service must be rendered`);
    }
  }

  for (const substrateService of REQUIRED_SUBSTRATE_SERVICES) {
    const serviceName = `substrate-${substrateService}`;
    if (!hasResource(documents, 'Service', serviceName)) {
      addFailure(failures, `Service/${serviceName}`, `${substrateService} substrate Service binding must be rendered`);
    }
    if (!hasResource(documents, 'EndpointSlice', serviceName) && !hasResource(documents, 'Endpoints', serviceName)) {
      addFailure(failures, `EndpointSlice/${serviceName}`, `${substrateService} substrate endpoint binding must be rendered`);
    }
  }

  if (!hasResource(documents, 'ConfigMap', 'agentsmith-managed-runner-support')) {
    addFailure(failures, 'ConfigMap/agentsmith-managed-runner-support', 'managed runner support configuration must be rendered');
  }
  if (!hasResource(documents, 'ConfigMap', LLMUP_CONFIG_MAP)) {
    addFailure(failures, `ConfigMap/${LLMUP_CONFIG_MAP}`, 'llmup app-owned configuration must be rendered');
  }
  for (const [kind, name] of [
    ['ServiceAccount', AFSCP_RUNTIME_SERVICE_ACCOUNT],
    ['ConfigMap', AFSCP_RUNTIME_CONFIG_MAP],
    ['Secret', AFSCP_RUNTIME_SECRET],
    ['Secret', AFSCP_VOLUME_SECRET],
    ['ServiceAccount', SANDBOX_MANAGER_SERVICE_ACCOUNT],
    ['Role', SANDBOX_MANAGER_SERVICE_ACCOUNT],
    ['RoleBinding', SANDBOX_MANAGER_SERVICE_ACCOUNT],
    ['ConfigMap', SANDBOX_MANAGER_CONFIG_MAP],
  ] as const) {
    if (!hasResource(documents, kind, name)) {
      addFailure(failures, `${kind}/${name}`, `sandbox-manager ${kind} ${name} must be rendered`);
    }
  }
}

function checkSubstrateBoundary(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const workloadKinds = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob']);

  for (const document of documents) {
    if (!workloadKinds.has(resourceKind(document))) {
      continue;
    }

    const name = resourceName(document);
    const component = componentLabel(document);
    for (const forbidden of FORBIDDEN_SUBSTRATE_WORKLOADS) {
      if (name.includes(forbidden) || component === forbidden) {
        addFailure(failures, resourceId(document), `${forbidden} must remain substrate and must not render as an app workload`);
      }
    }
  }

  for (const document of documents) {
    if (resourceKind(document) !== 'Service' || !resourceName(document).startsWith('substrate-')) {
      continue;
    }

    const selector = asRecord(asRecord(document.spec).selector);
    if (Object.keys(selector).length > 0) {
      addFailure(failures, resourceId(document), 'substrate Service binding must be selectorless');
    }
  }
}

function collectIngressRoutes(documents: readonly Record<string, unknown>[]): Map<string, string> {
  const routes = new Map<string, string>();

  for (const document of documents) {
    if (resourceKind(document) !== 'Ingress') {
      continue;
    }

    const rules = Array.isArray(asRecord(document.spec).rules) ? asRecord(document.spec).rules as unknown[] : [];
    for (const rule of rules) {
      const paths = Array.isArray(asRecord(asRecord(rule).http).paths) ? asRecord(asRecord(rule).http).paths as unknown[] : [];
      for (const pathEntry of paths) {
        const pathRecord = asRecord(pathEntry);
        const pathValue = pathRecord.path;
        const serviceName = asRecord(asRecord(pathRecord.backend).service).name;
        if (typeof pathValue === 'string' && typeof serviceName === 'string') {
          routes.set(pathValue, serviceName);
        }
      }
    }
  }

  return routes;
}

function collectIngressRoutePorts(documents: readonly Record<string, unknown>[]): Map<string, number> {
  const routes = new Map<string, number>();

  for (const document of documents) {
    if (resourceKind(document) !== 'Ingress') {
      continue;
    }

    const rules = Array.isArray(asRecord(document.spec).rules) ? asRecord(document.spec).rules as unknown[] : [];
    for (const rule of rules) {
      const paths = Array.isArray(asRecord(asRecord(rule).http).paths) ? asRecord(asRecord(rule).http).paths as unknown[] : [];
      for (const pathEntry of paths) {
        const pathRecord = asRecord(pathEntry);
        const pathValue = pathRecord.path;
        const portNumber = asRecord(asRecord(asRecord(pathRecord.backend).service).port).number;
        if (typeof pathValue === 'string' && typeof portNumber === 'number') {
          routes.set(pathValue, portNumber);
        }
      }
    }
  }

  return routes;
}

function checkIngressRoutes(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const routes = collectIngressRoutes(documents);
  const expectedRoutes = new Map([
    ['/api/v1', 'agentsmith-api'],
    ['/api/public', 'agentsmith-web'],
    ['/api/system', 'agentsmith-web'],
    ['/', 'agentsmith-web'],
  ]);

  for (const [route, serviceName] of expectedRoutes) {
    if (routes.get(route) !== serviceName) {
      addFailure(failures, 'Ingress/agentsmith', `${route} must route to ${serviceName}`);
    }
  }

  for (const [route, serviceName] of routes) {
    if (serviceName === 'agentsmith-llmup' || route.includes('llmup')) {
      addFailure(failures, 'Ingress/agentsmith', 'llmup must remain internal only');
    }
    if (serviceName.includes('afscp') || route.includes('afscp')) {
      addFailure(failures, 'Ingress/agentsmith', 'AFSCP services must remain internal only');
    }
  }
}

function selectorTargetsInternalOnlyComponent(selector: Record<string, unknown>): boolean {
  return Object.entries(selector).some(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    const normalizedValue = typeof value === 'string' ? value.toLowerCase() : '';

    return normalizedValue === 'llmup'
      || normalizedValue.includes('llmup')
      || normalizedValue.includes('afscp')
      || (normalizedKey.includes('component') && (
        normalizedValue === 'llmup'
        || normalizedValue === 'afscp-api'
        || normalizedValue === 'afscp-export-gateway'
      ));
  });
}

function serviceExposesInternalOnlyComponent(document: Record<string, unknown>): boolean {
  if (resourceKind(document) !== 'Service') {
    return false;
  }

  const selector = asRecord(asRecord(document.spec).selector);
  return resourceName(document).toLowerCase().includes('llmup')
    || resourceName(document).toLowerCase().includes('afscp')
    || componentLabel(document) === 'llmup'
    || componentLabel(document).startsWith('afscp')
    || selectorTargetsInternalOnlyComponent(selector);
}

function serviceExposesLlmupComponent(document: Record<string, unknown>): boolean {
  if (resourceKind(document) !== 'Service') {
    return false;
  }

  const selector = asRecord(asRecord(document.spec).selector);
  return resourceName(document).toLowerCase().includes('llmup')
    || componentLabel(document) === 'llmup'
    || Object.values(selector).some((value) => typeof value === 'string' && value.toLowerCase().includes('llmup'));
}

function checkInternalServiceTypes(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  for (const document of documents) {
    if (!serviceExposesInternalOnlyComponent(document)) {
      continue;
    }

    const serviceType = asRecord(document.spec).type;
    if (serviceType === 'NodePort' || serviceType === 'LoadBalancer') {
      addFailure(
        failures,
        resourceId(document),
        serviceExposesLlmupComponent(document)
          ? 'llmup Service must remain ClusterIP'
          : 'AFSCP Service must remain ClusterIP',
      );
    }
  }
}

function checkNamespacedAppBoundary(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  for (const document of documents) {
    const kind = resourceKind(document);
    if (kind === 'ClusterRole' || kind === 'ClusterRoleBinding') {
      addFailure(failures, resourceId(document), 'app manifest must not render cluster-scoped RBAC resources');
    }
    if (kind === 'Role' && resourceStringsFromRules(document).has('persistentvolumes')) {
      addFailure(failures, resourceId(document), 'app Role must not request persistentvolumes cluster permissions');
    }
  }
}

function checkAppConfig(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const config = documents.find((document) =>
    resourceKind(document) === 'ConfigMap' && resourceName(document) === 'agentsmith-app-config',
  );
  const data = asRecord(asRecord(config).data);
  const secret = documents.find((document) =>
    resourceKind(document) === 'Secret' && resourceName(document) === 'agentsmith-app-secrets',
  );
  const stringData = asRecord(asRecord(secret).stringData);

  if (data.MBOS_UNIVERSAL_PROXY_BASE_URL !== 'http://agentsmith-llmup:8080') {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'MBOS_UNIVERSAL_PROXY_BASE_URL must point to internal llmup service');
  }
  if (data.LLMUP_INTERNAL_BASE_URL !== 'http://agentsmith-llmup:8080') {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'LLMUP_INTERNAL_BASE_URL must point to internal llmup service');
  }
  if (typeof data.AFSCP_BASE_URL !== 'string' || !/^http:\/\/afscp-api\.[a-z0-9-]+\.svc\.cluster\.local:8080$/u.test(data.AFSCP_BASE_URL)) {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'AFSCP_BASE_URL must be derived from the internal afscp-api Service');
  }
  for (const key of ['KEYCLOAK_ISSUER_URL', 'PUBLIC_KEYCLOAK_BASE_URL', 'INTERNAL_KEYCLOAK_BASE_URL', 'KEYCLOAK_REALM']) {
    if (typeof data[key] !== 'string' || !data[key]) {
      addFailure(failures, 'ConfigMap/agentsmith-app-config', `${key} must be rendered for API auth`);
    }
  }
  if (typeof stringData.MONGO_URL !== 'string' || !stringData.MONGO_URL) {
    addFailure(failures, 'Secret/agentsmith-app-secrets', 'MONGO_URL must be rendered for Node API Mongo storage');
  } else {
    try {
      const mongoUrl = new URL(stringData.MONGO_URL);
      if (mongoUrl.pathname !== '/admin') {
        addFailure(failures, 'Secret/agentsmith-app-secrets', 'MONGO_URL must use admin as the Mongo auth database');
      }
    } catch {
      addFailure(failures, 'Secret/agentsmith-app-secrets', 'MONGO_URL must be a valid Mongo connection URL');
    }
  }
  if (typeof stringData.MONGO_DB_NAME !== 'string' || !stringData.MONGO_DB_NAME) {
    addFailure(failures, 'Secret/agentsmith-app-secrets', 'MONGO_DB_NAME must be rendered for Node API Mongo storage');
  }
  if (typeof stringData.MONGODB_URI === 'string' && !stringData.MONGO_URL) {
    addFailure(failures, 'Secret/agentsmith-app-secrets', 'MONGODB_URI alone is not consumed by the Node API; render MONGO_URL and MONGO_DB_NAME');
  }
  if (data.MINIO_ENDPOINT !== 'substrate-minio') {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'MINIO_ENDPOINT must be the host name without scheme or port');
  }
  if (typeof data.MINIO_PORT !== 'string' || !/^\d+$/u.test(data.MINIO_PORT)) {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'MINIO_PORT must be rendered for Node API MinIO storage');
  }
  if (data.MINIO_USE_SSL !== 'false') {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'MINIO_USE_SSL must be false for the Docker substrate MinIO binding');
  }

  for (const document of documents) {
    if (recursivelyContainsString(document, 'execution-gateway')) {
      addFailure(failures, resourceId(document), 'execution-gateway must not be rendered');
    }
  }
}

function deploymentContainerEnvFrom(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
  containerName: string,
): Record<string, unknown>[] {
  const container = deploymentContainer(documents, deploymentName, containerName);
  const envFrom = asRecord(container).envFrom;

  return Array.isArray(envFrom) ? envFrom.map(asRecord) : [];
}

function deploymentContainer(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
  containerName: string,
): Record<string, unknown> {
  const deployment = documents.find((document) =>
    resourceKind(document) === 'Deployment' && resourceName(document) === deploymentName,
  );
  const podSpec = asRecord(asRecord(asRecord(asRecord(deployment).spec).template).spec);
  const containers = Array.isArray(podSpec.containers) ? podSpec.containers : [];
  return containers
    .map(asRecord)
    .find((item) => item.name === containerName) ?? {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function hasEnvFromRef(envFrom: readonly Record<string, unknown>[], refKind: 'configMapRef' | 'secretRef', name: string): boolean {
  return envFrom.some((entry) => asRecord(entry[refKind]).name === name);
}

function containerPorts(container: Record<string, unknown>): number[] {
  const ports = Array.isArray(container.ports) ? container.ports : [];
  return ports
    .map(asRecord)
    .map((port) => port.containerPort)
    .filter((port): port is number => typeof port === 'number');
}

function containerEnvValue(container: Record<string, unknown>, name: string): string | undefined {
  const env = Array.isArray(container.env) ? container.env : [];
  const match = env.map(asRecord).find((entry) => entry.name === name);
  return typeof match?.value === 'string' ? match.value : undefined;
}

function containerEnvEntry(container: Record<string, unknown>, name: string): Record<string, unknown> {
  const env = Array.isArray(container.env) ? container.env : [];
  return env.map(asRecord).find((entry) => entry.name === name) ?? {};
}

function containerSecretKeyRef(container: Record<string, unknown>, name: string): Record<string, unknown> {
  return asRecord(asRecord(containerEnvEntry(container, name).valueFrom).secretKeyRef);
}

function resourceNamespace(resource: Record<string, unknown>): string {
  const namespace = asRecord(resource.metadata).namespace;
  return typeof namespace === 'string' ? namespace : '';
}

function resourceByKindName(
  documents: readonly Record<string, unknown>[],
  kind: string,
  name: string,
): Record<string, unknown> {
  return documents.find((document) => resourceKind(document) === kind && resourceName(document) === name) ?? {};
}

function deploymentPodSpec(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
): Record<string, unknown> {
  const deployment = resourceByKindName(documents, 'Deployment', deploymentName);
  return asRecord(asRecord(asRecord(asRecord(deployment.spec).template).spec));
}

function deploymentPodTemplateAnnotations(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
): Record<string, unknown> {
  const deployment = resourceByKindName(documents, 'Deployment', deploymentName);
  return asRecord(asRecord(asRecord(asRecord(deployment.spec).template).metadata).annotations);
}

function resourceStringsFromRules(resource: Record<string, unknown>): Set<string> {
  const rules = Array.isArray(resource.rules) ? resource.rules.map(asRecord) : [];
  return new Set(rules.flatMap((rule) =>
    Array.isArray(rule.resources)
      ? rule.resources.filter((item): item is string => typeof item === 'string')
      : [],
  ));
}

function bindingSubjects(resource: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(resource.subjects) ? resource.subjects.map(asRecord) : [];
}

function hasServiceAccountSubject(
  resource: Record<string, unknown>,
  serviceAccountName: string,
  namespace: string,
): boolean {
  return bindingSubjects(resource).some((subject) =>
    subject.kind === 'ServiceAccount'
    && subject.name === serviceAccountName
    && subject.namespace === namespace,
  );
}

function addMissingEnvValueFailure(
  failures: CheckFailure[],
  container: Record<string, unknown>,
  envName: string,
  expectedValue: string,
  message: string,
): void {
  if (containerEnvValue(container, envName) !== expectedValue) {
    addFailure(failures, 'Deployment/agentsmith-sandbox-manager', message);
  }
}

function addMissingSecretEnvFailure(
  failures: CheckFailure[],
  container: Record<string, unknown>,
  envName: string,
  secretName: string,
  key: string,
  message: string,
): void {
  const secretKeyRef = containerSecretKeyRef(container, envName);
  if (secretKeyRef.name !== secretName || secretKeyRef.key !== key) {
    addFailure(failures, 'Deployment/agentsmith-sandbox-manager', message);
  }
}

function servicePort(documents: readonly Record<string, unknown>[], serviceName: string): number | undefined {
  const service = documents.find((document) =>
    resourceKind(document) === 'Service' && resourceName(document) === serviceName,
  );
  const ports = Array.isArray(asRecord(asRecord(service).spec).ports) ? asRecord(asRecord(service).spec).ports as unknown[] : [];
  const firstPort = asRecord(ports[0]).port;
  return typeof firstPort === 'number' ? firstPort : undefined;
}

function checkRunnableAppWorkloads(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const web = deploymentContainer(documents, 'agentsmith-web', 'web');
  const api = deploymentContainer(documents, 'agentsmith-api', 'api');
  const appConfigMap = resourceByKindName(documents, 'ConfigMap', 'agentsmith-app-config');
  const appConfigData = asRecord(appConfigMap.data);
  const ingressPorts = collectIngressRoutePorts(documents);
  const webImage = typeof web.image === 'string' ? web.image : '';
  const apiImage = typeof api.image === 'string' ? api.image : '';

  if (webImage !== apiImage || !/\/agentsmith-app(?::|@sha256:)/u.test(webImage)) {
    addFailure(failures, 'Deployment/agentsmith-web', 'web and api must default to the shared agentsmith-app image');
  }

  if (stringArray(web.command).join('\0') !== 'npm') {
    addFailure(failures, 'Deployment/agentsmith-web', 'web must override the shared app image sleep command');
  }
  if (stringArray(web.args).join('\0') !== ['run', 'start', '--', '--hostname', '0.0.0.0', '--port', '3001'].join('\0')) {
    addFailure(failures, 'Deployment/agentsmith-web', 'web must start Next.js on 0.0.0.0:3001');
  }
  if (!containerPorts(web).includes(3001) || servicePort(documents, 'agentsmith-web') !== 3001) {
    addFailure(failures, 'Service/agentsmith-web', 'web container and Service must expose port 3001');
  }
  for (const route of ['/api/public', '/api/system', '/']) {
    if (ingressPorts.get(route) !== 3001) {
      addFailure(failures, 'Ingress/agentsmith', `${route} must route to agentsmith-web port 3001`);
    }
  }

  if (stringArray(api.command).join('\0') !== 'npm') {
    addFailure(failures, 'Deployment/agentsmith-api', 'api must override the shared app image sleep command');
  }
  if (stringArray(api.args).join('\0') !== ['run', 'api:node:start'].join('\0')) {
    addFailure(failures, 'Deployment/agentsmith-api', 'api must start the Node API entrypoint through the production start script');
  }
  if (containerEnvValue(api, 'PORT') !== '20000') {
    addFailure(failures, 'Deployment/agentsmith-api', 'api must set PORT=20000 to match its Service');
  }
  if (!containerPorts(api).includes(20000) || servicePort(documents, 'agentsmith-api') !== 20000 || ingressPorts.get('/api/v1') !== 20000) {
    addFailure(failures, 'Service/agentsmith-api', 'api container, Service, and ingress must expose port 20000');
  }
  if (appConfigData.AFSCP_CALLER_SERVICE !== 'agentsmith-api') {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'api AFSCP product caller must be agentsmith-api');
  }
  if (appConfigData.AFSCP_BOOTSTRAP_CALLER_SERVICE !== 'agentsmith-bootstrap') {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'api AFSCP bootstrap caller must be agentsmith-bootstrap');
  }
  if (appConfigData.AFSCP_ORCHESTRATOR_CALLER_SERVICE !== 'agentsmith-sandbox-manager') {
    addFailure(
      failures,
      'ConfigMap/agentsmith-app-config',
      'api AFSCP bootstrap binding must authorize the sandbox manager orchestrator caller',
    );
  }
}

function checkLlmupContract(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const podSpec = deploymentPodSpec(documents, 'agentsmith-llmup');
  const container = deploymentContainer(documents, 'agentsmith-llmup', 'llmup');
  const configMap = resourceByKindName(documents, 'ConfigMap', LLMUP_CONFIG_MAP);
  const configData = asRecord(configMap.data);
  const llmupConfig = typeof configData['config.yaml'] === 'string'
    ? configData['config.yaml']
    : '';

  for (const expected of [
    'listen: 0.0.0.0:8080',
    'upstream_timeout_secs: 120',
    'data_auth:',
    'mode: client_provider_key',
    'upstreams: {}',
    'model_aliases: {}',
  ]) {
    if (!llmupConfig.includes(expected)) {
      addFailure(failures, `ConfigMap/${LLMUP_CONFIG_MAP}`, `llmup config must include ${expected}`);
    }
  }

  if (stringArray(container.args).join('\0') !== ['--config', LLMUP_CONFIG_PATH].join('\0')) {
    addFailure(failures, 'Deployment/agentsmith-llmup', `llmup must start with --config ${LLMUP_CONFIG_PATH}`);
  }
  if (containerEnvValue(container, 'LLM_UNIVERSAL_PROXY_AUTH_MODE') !== 'client_provider_key') {
    addFailure(failures, 'Deployment/agentsmith-llmup', 'llmup must use client_provider_key auth mode');
  }
  const adminTokenRef = containerSecretKeyRef(container, 'LLM_UNIVERSAL_PROXY_ADMIN_TOKEN');
  if (adminTokenRef.name !== 'agentsmith-app-secrets' || adminTokenRef.key !== 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN') {
    addFailure(
      failures,
      'Deployment/agentsmith-llmup',
      'llmup admin token must come from agentsmith-app-secrets/MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN',
    );
  }

  for (const [probeName, probeValue] of [
    ['readinessProbe', container.readinessProbe],
    ['livenessProbe', container.livenessProbe],
  ] as const) {
    const httpGet = asRecord(asRecord(probeValue).httpGet);
    if (httpGet.path !== '/health' || httpGet.port !== 'http') {
      addFailure(failures, 'Deployment/agentsmith-llmup', `llmup ${probeName} must probe /health on the http port`);
    }
  }

  const volumeMounts = Array.isArray(container.volumeMounts) ? container.volumeMounts.map(asRecord) : [];
  const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];
  if (!volumeMounts.some((mount) =>
    mount.name === 'llmup-config'
    && mount.mountPath === LLMUP_CONFIG_PATH
    && mount.subPath === 'config.yaml'
    && mount.readOnly === true,
  )) {
    addFailure(failures, 'Deployment/agentsmith-llmup', 'llmup must mount config.yaml read-only by subPath');
  }
  if (!volumes.some((volume) =>
    volume.name === 'llmup-config'
    && asRecord(volume.configMap).name === LLMUP_CONFIG_MAP,
  )) {
    addFailure(failures, 'Deployment/agentsmith-llmup', `llmup must mount ${LLMUP_CONFIG_MAP} as config volume`);
  }
}

function checkAfscpVolumeMount(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
  containerName: string,
  failures: CheckFailure[],
): void {
  const podSpec = deploymentPodSpec(documents, deploymentName);
  const container = deploymentContainer(documents, deploymentName, containerName);
  const volumeMounts = Array.isArray(container.volumeMounts) ? container.volumeMounts.map(asRecord) : [];
  const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];
  const csiVolume = volumes.find((volume) => volume.name === 'afscp-default-volume');
  const csi = asRecord(csiVolume?.csi);
  const nodePublishSecretRef = asRecord(csi.nodePublishSecretRef);

  if (!volumeMounts.some((mount) =>
    mount.name === 'afscp-default-volume'
    && mount.mountPath === AFSCP_VOLUME_ROOT_PATH,
  )) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must mount the AFSCP default volume root`);
  }
  if (csi.driver !== 'csi.juicefs.com' || nodePublishSecretRef.name !== AFSCP_VOLUME_SECRET) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must mount the default AFSCP volume through the JuiceFS CSI Secret`);
  }
}

function checkAfscpEnvFrom(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
  containerName: string,
  failures: CheckFailure[],
): void {
  const envFrom = deploymentContainerEnvFrom(documents, deploymentName, containerName);
  if (!hasEnvFromRef(envFrom, 'configMapRef', AFSCP_RUNTIME_CONFIG_MAP)) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must consume ${AFSCP_RUNTIME_CONFIG_MAP}`);
  }
  if (!hasEnvFromRef(envFrom, 'secretRef', AFSCP_RUNTIME_SECRET)) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must consume ${AFSCP_RUNTIME_SECRET}`);
  }
}

function checkAfscpContract(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const apiDeployment = resourceByKindName(documents, 'Deployment', 'afscp-api');
  const config = asRecord(resourceByKindName(documents, 'ConfigMap', AFSCP_RUNTIME_CONFIG_MAP).data);
  const secrets = asRecord(resourceByKindName(documents, 'Secret', AFSCP_RUNTIME_SECRET).stringData);
  const volumeSecret = asRecord(resourceByKindName(documents, 'Secret', AFSCP_VOLUME_SECRET).stringData);
  const namespace = resourceNamespace(apiDeployment) || resourceNamespace(resourceByKindName(documents, 'ConfigMap', AFSCP_RUNTIME_CONFIG_MAP));
  const afscpImage = deploymentContainer(documents, 'afscp-api', 'afscp-api').image;

  if (config.AFSCP_API_MODE !== 'internal') {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP API must run in internal mode');
  }
  if (config.AFSCP_API_VOLUME_ROOTS !== `vol_agentsmith_default=${AFSCP_VOLUME_ROOT_PATH}` && !String(config.AFSCP_API_VOLUME_ROOTS ?? '').endsWith(`=${AFSCP_VOLUME_ROOT_PATH}`)) {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP API volume roots must map the default volume to the mounted volume root');
  }
  if (config.AFSCP_VOLUME_ROOTS !== config.AFSCP_API_VOLUME_ROOTS || config.AFSCP_EXPORT_GATEWAY_VOLUME_ROOTS !== config.AFSCP_API_VOLUME_ROOTS) {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP API, worker, and export gateway must share the same volume root map');
  }
  if (config.AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS !== `${config.AFSCP_API_VOLUME_ROOTS}`.split('=')[0] + `=${namespace}/${AFSCP_VOLUME_SECRET}`) {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP workload mount Secret refs must point to the namespace-local JuiceFS CSI Secret');
  }
  for (const [key, expected] of [
    ['AFSCP_STORAGE_ENABLED', 'true'],
    ['AFSCP_STORAGE_READY', 'true'],
    ['AFSCP_MOUNT_ENABLED', 'true'],
    ['AFSCP_MOUNT_READY', 'true'],
    ['AFSCP_REPO_TEMPLATE_ENABLED', 'true'],
    ['AFSCP_REPO_TEMPLATE_READY', 'true'],
    ['AFSCP_WORKER_OPERATION_RECOVERY_ENABLED', 'true'],
    ['AFSCP_SAVE_POINT_RECOVERY_ENABLED', 'true'],
    ['AFSCP_RESTORE_PREVIEW_RECOVERY_ENABLED', 'true'],
    ['AFSCP_RESTORE_RUN_RECOVERY_ENABLED', 'true'],
  ] as const) {
    if (config[key] !== expected) {
      addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, `${key} must be ${expected}`);
    }
  }
  if (config.AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL !== `http://afscp-export-gateway.${namespace}.svc.cluster.local:8080/e`) {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP WebDAV export URL must point to the internal export gateway Service');
  }
  for (const key of [
    'AFSCP_DATABASE_URL',
    'AFSCP_POSTGRES_DSN',
    'AFSCP_API_POSTGRES_DSN',
    'AFSCP_EXPORT_GATEWAY_POSTGRES_DSN',
    'AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN',
    'AFSCP_API_SERVICE_TOKENS',
  ]) {
    if (typeof secrets[key] !== 'string' || !secrets[key]) {
      addFailure(failures, `Secret/${AFSCP_RUNTIME_SECRET}`, `${key} must be rendered for AFSCP runtime`);
    }
  }
  if (!String(secrets.AFSCP_API_SERVICE_TOKENS ?? '').includes('agentsmith-api=') || !String(secrets.AFSCP_API_SERVICE_TOKENS ?? '').includes('agentsmith-sandbox-manager=')) {
    addFailure(failures, `Secret/${AFSCP_RUNTIME_SECRET}`, 'AFSCP service tokens must authorize product, bootstrap, and sandbox-manager callers');
  }
  for (const key of ['name', 'metaurl', 'storage', 'bucket', 'access-key', 'secret-key']) {
    if (typeof volumeSecret[key] !== 'string' || !volumeSecret[key]) {
      addFailure(failures, `Secret/${AFSCP_VOLUME_SECRET}`, `JuiceFS CSI Secret must include ${key}`);
    }
  }
  if (volumeSecret.storage !== 'minio' || !String(volumeSecret.bucket ?? '').startsWith(`http://substrate-minio.${namespace}.svc.cluster.local:9000/`)) {
    addFailure(failures, `Secret/${AFSCP_VOLUME_SECRET}`, 'AFSCP JuiceFS CSI Secret must bind to internal substrate MinIO');
  }
  if (!String(volumeSecret.metaurl ?? '').includes('@substrate-postgresql:5432/')) {
    addFailure(failures, `Secret/${AFSCP_VOLUME_SECRET}`, 'AFSCP JuiceFS CSI Secret must bind to internal substrate PostgreSQL metadata');
  }

  const api = deploymentContainer(documents, 'afscp-api', 'afscp-api');
  const worker = deploymentContainer(documents, 'afscp-worker', 'afscp-worker');
  const exportGateway = deploymentContainer(documents, 'afscp-export-gateway', 'afscp-export-gateway');
  if (!String(afscpImage ?? '').includes('agentsmith-fs-control-plane') || worker.image !== afscpImage || exportGateway.image !== afscpImage) {
    addFailure(failures, 'Deployment/afscp-api', 'AFSCP API, worker, and export gateway must use the same AFSCP runtime image');
  }
  if (stringArray(api.command).join('\0') !== '/usr/local/bin/afscp-api' || stringArray(api.args).join('\0') !== ['--serve', '--listen', '0.0.0.0:8080'].join('\0')) {
    addFailure(failures, 'Deployment/afscp-api', 'afscp-api must run the internal API server on 0.0.0.0:8080');
  }
  if (stringArray(worker.command).join('\0') !== '/usr/local/bin/afscp-worker' || stringArray(worker.args).join('\0') !== ['--loop', '--interval=2s'].join('\0')) {
    addFailure(failures, 'Deployment/afscp-worker', 'afscp-worker must run as a long-running loop, not a run-once pod');
  }
  if (stringArray(exportGateway.command).join('\0') !== '/usr/local/bin/afscp-export-gateway' || stringArray(exportGateway.args).join('\0') !== ['--serve', '--listen-addr', '0.0.0.0:8080'].join('\0')) {
    addFailure(failures, 'Deployment/afscp-export-gateway', 'afscp-export-gateway must serve on 0.0.0.0:8080');
  }
  for (const [deploymentName, containerName] of [
    ['afscp-api', 'afscp-api'],
    ['afscp-worker', 'afscp-worker'],
    ['afscp-export-gateway', 'afscp-export-gateway'],
  ] as const) {
    if (asRecord(deploymentPodSpec(documents, deploymentName)).serviceAccountName !== AFSCP_RUNTIME_SERVICE_ACCOUNT) {
      addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must use the dedicated AFSCP ServiceAccount`);
    }
    checkAfscpEnvFrom(documents, deploymentName, containerName, failures);
    checkAfscpVolumeMount(documents, deploymentName, containerName, failures);
  }
  if (!containerPorts(api).includes(8080) || servicePort(documents, 'afscp-api') !== 8080) {
    addFailure(failures, 'Service/afscp-api', 'afscp-api container and Service must expose port 8080');
  }
  if (!containerPorts(exportGateway).includes(8080) || servicePort(documents, 'afscp-export-gateway') !== 8080) {
    addFailure(failures, 'Service/afscp-export-gateway', 'afscp-export-gateway container and Service must expose port 8080');
  }
}

function checkRolloutChecksumAnnotations(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  for (const [deploymentName, checksumKeys] of [
    ['agentsmith-web', ['agentsmith.mbos.dev/checksum-app-config', 'agentsmith.mbos.dev/checksum-app-secrets']],
    ['agentsmith-api', ['agentsmith.mbos.dev/checksum-app-config', 'agentsmith.mbos.dev/checksum-app-secrets']],
    ['agentsmith-llmup', ['agentsmith.mbos.dev/checksum-llmup-config', 'agentsmith.mbos.dev/checksum-app-secrets']],
    ['afscp-api', ['agentsmith.mbos.dev/checksum-afscp-config', 'agentsmith.mbos.dev/checksum-afscp-secrets']],
    ['afscp-worker', ['agentsmith.mbos.dev/checksum-afscp-config', 'agentsmith.mbos.dev/checksum-afscp-secrets']],
    ['afscp-export-gateway', ['agentsmith.mbos.dev/checksum-afscp-config', 'agentsmith.mbos.dev/checksum-afscp-secrets']],
    ['agentsmith-sandbox-manager', ['agentsmith.mbos.dev/checksum-sandbox-manager-config', 'agentsmith.mbos.dev/checksum-app-secrets']],
  ] as const) {
    const annotations = deploymentPodTemplateAnnotations(documents, deploymentName);
    for (const checksumKey of checksumKeys) {
      if (typeof annotations[checksumKey] !== 'string' || !ROLLOUT_CHECKSUM_PATTERN.test(annotations[checksumKey])) {
        addFailure(
          failures,
          `Deployment/${deploymentName}`,
          `${deploymentName} pod template must include ${checksumKey} rollout checksum`,
        );
      }
    }
  }
}

function checkSandboxManagerContract(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const deployment = resourceByKindName(documents, 'Deployment', 'agentsmith-sandbox-manager');
  const podSpec = deploymentPodSpec(documents, 'agentsmith-sandbox-manager');
  const container = deploymentContainer(documents, 'agentsmith-sandbox-manager', 'sandbox-manager');
  const configMap = resourceByKindName(documents, 'ConfigMap', SANDBOX_MANAGER_CONFIG_MAP);
  const appConfigMap = resourceByKindName(documents, 'ConfigMap', 'agentsmith-app-config');
  const namespace = resourceNamespace(deployment) || resourceNamespace(configMap);
  const configData = asRecord(configMap.data);
  const appConfigData = asRecord(appConfigMap.data);
  const managerConfig = typeof configData['manager-config.yaml'] === 'string'
    ? configData['manager-config.yaml']
    : '';

  for (const expected of [
    'version: 1',
    'httpPort: 8080',
    'requestIdHeader: X-Request-Id',
    'headerName: X-Service-Key',
    'requestTimeout: 15s',
    `namespace: ${namespace}`,
  ]) {
    if (!managerConfig.includes(expected)) {
      addFailure(failures, `ConfigMap/${SANDBOX_MANAGER_CONFIG_MAP}`, `sandbox-manager config must include ${expected}`);
    }
  }
  if (/^afscp:\s*$/mu.test(managerConfig)) {
    addFailure(
      failures,
      `ConfigMap/${SANDBOX_MANAGER_CONFIG_MAP}`,
      'sandbox-manager config must not render inert afscp YAML; AFSCP truth source is the container env contract',
    );
  }
  for (const forbiddenKey of ['SANDBOX_SERVICE_KEY', 'JUICEFS_STORAGE_ACCESS_KEY', 'JUICEFS_STORAGE_SECRET_KEY', 'MINIO_SECRET_KEY']) {
    if (Object.prototype.hasOwnProperty.call(configData, forbiddenKey)) {
      addFailure(failures, `ConfigMap/${SANDBOX_MANAGER_CONFIG_MAP}`, `${forbiddenKey} must not be rendered in sandbox-manager ConfigMap`);
    }
    if (Object.prototype.hasOwnProperty.call(appConfigData, forbiddenKey)) {
      addFailure(failures, 'ConfigMap/agentsmith-app-config', `${forbiddenKey} must not be rendered in agentsmith-app-config`);
    }
  }
  for (const forbiddenKey of [
    'INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE',
    'INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE',
    'JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT',
    'FILE_LIBRARY_GATEWAY_ROOT_PASSWORD_SEED',
  ]) {
    if (Object.prototype.hasOwnProperty.call(appConfigData, forbiddenKey)) {
      addFailure(failures, 'ConfigMap/agentsmith-app-config', `${forbiddenKey} must not be rendered in agentsmith-app-config`);
    }
  }

  if (podSpec.serviceAccountName !== SANDBOX_MANAGER_SERVICE_ACCOUNT) {
    addFailure(failures, 'Deployment/agentsmith-sandbox-manager', 'sandbox-manager must use its dedicated ServiceAccount');
  }
  addMissingEnvValueFailure(
    failures,
    container,
    'CONFIG_PATH',
    SANDBOX_MANAGER_CONFIG_PATH,
    'sandbox-manager must set CONFIG_PATH to the mounted manager-config.yaml',
  );
  addMissingEnvValueFailure(
    failures,
    container,
    'K8S_NAMESPACE',
    namespace,
    'sandbox-manager K8S_NAMESPACE must match the unified render namespace',
  );
  addMissingEnvValueFailure(
    failures,
    container,
    'AFSCP_INTERNAL_BASE_URL',
    typeof appConfigData.AFSCP_BASE_URL === 'string' ? appConfigData.AFSCP_BASE_URL : '',
    'sandbox-manager AFSCP internal base URL must use the manager env contract',
  );
  addMissingSecretEnvFailure(
    failures,
    container,
    'AFSCP_ORCHESTRATOR_TOKEN',
    'agentsmith-app-secrets',
    'AFSCP_ORCHESTRATOR_SERVICE_TOKEN',
    'sandbox-manager AFSCP orchestrator token must come from agentsmith-app-secrets/AFSCP_ORCHESTRATOR_SERVICE_TOKEN',
  );
  addMissingEnvValueFailure(
    failures,
    container,
    'AFSCP_CALLER_SERVICE',
    'agentsmith-sandbox-manager',
    'sandbox-manager AFSCP caller service must use the manager env contract',
  );
  addMissingEnvValueFailure(
    failures,
    container,
    'AFSCP_ACTOR_TYPE',
    'system',
    'sandbox-manager AFSCP actor type must use the manager env contract',
  );
  addMissingEnvValueFailure(
    failures,
    container,
    'AFSCP_ACTOR_ID',
    'agentsmith-sandbox-manager',
    'sandbox-manager AFSCP actor id must use the manager env contract',
  );
  for (const deprecatedEnvName of [
    'AFSCP_BASE_URL',
    'AFSCP_ORCHESTRATOR_CALLER_SERVICE',
    'AFSCP_ORCHESTRATOR_ACTOR_TYPE',
    'AFSCP_ORCHESTRATOR_ACTOR_ID',
    'AFSCP_ORCHESTRATOR_SERVICE_TOKEN',
  ]) {
    if (Object.prototype.hasOwnProperty.call(containerEnvEntry(container, deprecatedEnvName), 'name')) {
      addFailure(
        failures,
        'Deployment/agentsmith-sandbox-manager',
        `sandbox-manager must not use deprecated AFSCP env ${deprecatedEnvName}`,
      );
    }
  }
  addMissingSecretEnvFailure(
    failures,
    container,
    'SERVICE_KEYS',
    'agentsmith-app-secrets',
    'SANDBOX_SERVICE_KEY',
    'sandbox-manager SERVICE_KEYS must come from agentsmith-app-secrets/SANDBOX_SERVICE_KEY',
  );
  addMissingSecretEnvFailure(
    failures,
    container,
    'JUICEFS_STORAGE_ACCESS_KEY',
    'agentsmith-app-secrets',
    'MINIO_ACCESS_KEY',
    'sandbox-manager storage access key must come from agentsmith-app-secrets/MINIO_ACCESS_KEY',
  );
  addMissingSecretEnvFailure(
    failures,
    container,
    'JUICEFS_STORAGE_SECRET_KEY',
    'agentsmith-app-secrets',
    'MINIO_SECRET_KEY',
    'sandbox-manager storage secret key must come from agentsmith-app-secrets/MINIO_SECRET_KEY',
  );

  const expectedStorageEndpoint = namespace ? substrateMinioInternalMountEndpoint(namespace) : '';
  if (expectedStorageEndpoint) {
    addMissingEnvValueFailure(
      failures,
      container,
      'JUICEFS_STORAGE_ENDPOINT',
      expectedStorageEndpoint,
      'sandbox-manager storage endpoint must point to the substrate-minio namespace FQDN and native port',
    );
  } else if (!/^http:\/\/substrate-minio\.[a-z0-9.-]+\.svc\.cluster\.local:9000$/u.test(containerEnvValue(container, 'JUICEFS_STORAGE_ENDPOINT') ?? '')) {
    addFailure(failures, 'Deployment/agentsmith-sandbox-manager', 'sandbox-manager storage endpoint must point to substrate-minio namespace FQDN');
  }

  const volumeMounts = Array.isArray(container.volumeMounts) ? container.volumeMounts.map(asRecord) : [];
  const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];
  if (!volumeMounts.some((mount) =>
    mount.name === 'config'
    && mount.mountPath === SANDBOX_MANAGER_CONFIG_PATH
    && mount.subPath === 'manager-config.yaml',
  )) {
    addFailure(failures, 'Deployment/agentsmith-sandbox-manager', 'sandbox-manager must mount manager-config.yaml by subPath');
  }
  if (!volumes.some((volume) =>
    volume.name === 'config'
    && asRecord(volume.configMap).name === SANDBOX_MANAGER_CONFIG_MAP,
  )) {
    addFailure(failures, 'Deployment/agentsmith-sandbox-manager', 'sandbox-manager must mount sandbox-manager-config as config volume');
  }

  const role = resourceByKindName(documents, 'Role', SANDBOX_MANAGER_SERVICE_ACCOUNT);
  const roleBinding = resourceByKindName(documents, 'RoleBinding', SANDBOX_MANAGER_SERVICE_ACCOUNT);
  const roleResources = resourceStringsFromRules(role);

  for (const expectedResource of ['pods', 'pods/status', 'pods/exec', 'persistentvolumeclaims', 'secrets', 'events']) {
    if (!roleResources.has(expectedResource)) {
      addFailure(failures, `Role/${SANDBOX_MANAGER_SERVICE_ACCOUNT}`, `sandbox-manager Role must permit ${expectedResource}`);
    }
  }
  if (roleResources.has('persistentvolumes')) {
    addFailure(failures, `Role/${SANDBOX_MANAGER_SERVICE_ACCOUNT}`, 'sandbox-manager app Role must not permit persistentvolumes');
  }
  if (!hasServiceAccountSubject(roleBinding, SANDBOX_MANAGER_SERVICE_ACCOUNT, namespace)
    || asRecord(roleBinding.roleRef).name !== SANDBOX_MANAGER_SERVICE_ACCOUNT) {
    addFailure(failures, `RoleBinding/${SANDBOX_MANAGER_SERVICE_ACCOUNT}`, 'sandbox-manager RoleBinding must bind the dedicated ServiceAccount');
  }
}

function checkWebServerRouteEnv(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const routes = collectIngressRoutes(documents);
  if (routes.get('/api/public') !== 'agentsmith-web' || routes.get('/api/system') !== 'agentsmith-web') {
    return;
  }

  const envFrom = deploymentContainerEnvFrom(documents, 'agentsmith-web', 'web');
  if (!hasEnvFromRef(envFrom, 'configMapRef', 'agentsmith-app-config')) {
    addFailure(failures, 'Deployment/agentsmith-web', 'web must consume agentsmith-app-config for Web-owned API routes');
  }
  if (!hasEnvFromRef(envFrom, 'secretRef', 'agentsmith-app-secrets')) {
    addFailure(failures, 'Deployment/agentsmith-web', 'web must consume agentsmith-app-secrets for Web-owned API routes');
  }
}

export function checkRenderedOutput(renderedYaml: string): CheckResult {
  const parsed = parseKubernetesDocuments(renderedYaml);
  const failures = [...parsed.failures, ...checkApiSingleReplica(renderedYaml).failures];

  if (parsed.ok) {
    failures.push(...checkAddressTruth(renderedYaml).failures);
    checkRequiredResources(parsed.documents, failures);
    checkSubstrateBoundary(parsed.documents, failures);
    checkIngressRoutes(parsed.documents, failures);
    checkInternalServiceTypes(parsed.documents, failures);
    checkNamespacedAppBoundary(parsed.documents, failures);
    checkAppConfig(parsed.documents, failures);
    checkWebServerRouteEnv(parsed.documents, failures);
    checkRunnableAppWorkloads(parsed.documents, failures);
    checkLlmupContract(parsed.documents, failures);
    checkAfscpContract(parsed.documents, failures);
    checkRolloutChecksumAnnotations(parsed.documents, failures);
    checkSandboxManagerContract(parsed.documents, failures);
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

async function checkRenderedProfile(profile: 'local-kind' | 'existing-cluster'): Promise<CheckFailure[]> {
  const rendered = await renderUnifiedDeployFromFiles({ profile });
  return checkRenderedOutput(rendered.output).failures.map((failure) => ({
    path: `${profile}:${failure.path}`,
    message: failure.message,
  }));
}

async function main(): Promise<void> {
  const failures = [
    ...checkApiProductionEntrypointScripts().failures,
    ...await checkRenderedProfile('local-kind'),
    ...await checkRenderedProfile('existing-cluster'),
  ];

  if (failures.length > 0) {
    const evidence = await writeProducerEvidence({
      producer: 'render',
      status: 'failed',
      failures,
    });
    process.stderr.write(`${failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n')}\n`);
    process.stderr.write(`[unified-deploy] evidence: ${evidence.paths.report_path}\n`);
    process.exitCode = 1;
    return;
  }

  const evidence = await writeProducerEvidence({
    producer: 'render',
    status: 'passed',
    failures: [],
  });

  process.stdout.write(`[unified-deploy] render check passed for local-kind, existing-cluster\n[unified-deploy] evidence: ${evidence.paths.report_path}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
