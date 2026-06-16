import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TARGET_PROFILES,
  asRecord,
  isUnifiedDeployProfile,
  type CheckFailure,
  type CheckResult,
  type UnifiedDeployProfile,
} from './manifest';
import { checkApiSingleReplica } from './check-api-single-replica';
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
import {
  NODE_SUBSTRATE_CA_BUNDLE_DIR,
  NODE_SUBSTRATE_CA_BUNDLE_PATH,
  SUBSTRATE_CA_BASE_DIR,
  SUBSTRATE_CA_PROJECTED_PATH,
  isKubernetesSecretDataKey,
} from './substrate-ca';

const REQUIRED_COMPONENT_DEPLOYMENTS = new Map([
  ['web', 'agentsmith-web'],
  ['api', 'agentsmith-api'],
  ['llmup', 'agentsmith-llmup'],
  ['afscp-api', 'afscp-api'],
  ['afscp-worker', 'afscp-worker'],
  ['afscp-export-gateway', 'afscp-export-gateway'],
  ['asbcp', 'agentsmith-sandbox-control-plane'],
]);
const REQUIRED_COMPONENT_SERVICES = new Map([
  ['web', 'agentsmith-web'],
  ['api', 'agentsmith-api'],
  ['llmup', 'agentsmith-llmup'],
  ['afscp-api', 'afscp-api'],
  ['afscp-export-gateway', 'afscp-export-gateway'],
  ['asbcp', 'agentsmith-sandbox-control-plane'],
]);
const REQUIRED_SUBSTRATE_SERVICES = ['postgresql', 'mongodb', 'redis', 'minio', 'keycloak'] as const;
const FORBIDDEN_SUBSTRATE_WORKLOADS = ['postgresql', 'mongodb', 'redis', 'minio', 'keycloak'] as const;
const API_ROOT_BUILD_SCRIPT = 'npm run build -w @mbos/api-entry-node';
const API_ROOT_START_SCRIPT = 'npm run start -w @mbos/api-entry-node';
const API_PACKAGE_START_SCRIPT = 'node dist/index.js';
const API_PACKAGE_MAIN = 'dist/index.js';
const AGENTSMITH_APP_SERVICE_ACCOUNT = 'agentsmith-app';
const AGENTSMITH_APP_CONFIG_MAP = 'agentsmith-app-config';
const AGENTSMITH_APP_SECRET = 'agentsmith-app-secrets';
const AGENTSMITH_APP_SECRET_KEYS = [
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
  'SYSTEM_ADMIN_PASSWORD',
] as const;
const PRODUCT_SCHEMA_BOOTSTRAP_JOB = 'agentsmith-product-schema-bootstrap';
const PRODUCT_SCHEMA_BOOTSTRAP_SCRIPT = 'packages/api-entry-node/dist/product-schema-bootstrap.js';
const PRODUCT_SCHEMA_BOOTSTRAP_BACKOFF_LIMIT = 3;
const API_PACKAGE_REQUIRED_BUILD_ARGS = [
  'src/index.ts',
  'src/product-schema-bootstrap.ts',
  'src/deployment-managed-runner-seed.ts',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--outdir=dist',
] as const;
const API_PACKAGE_CREATE_REQUIRE_BANNER_SNIPPETS = [
  '--banner:js=',
  'createRequire',
  'node:module',
  'import.meta.url',
] as const;
const ASBCP_SERVICE_ACCOUNT = 'agentsmith-sandbox-control-plane';
const ASBCP_CONFIG_MAP = 'asbcp-config';
const ASBCP_CONFIG_PATH = '/etc/asbcp/asbcp-config.yaml';
const ASBCP_GHCR_IMAGE_REPOSITORY_PATTERN = /^ghcr\.io\/agentsmith-project\/agentsmith-sandbox-control-plane(?=[:@])/u;
const ASBCP_LOCAL_KIND_IMAGE_REPOSITORY_PATTERN = /^kind-registry:5000\/mbos\/agentsmith-sandbox-control-plane(?=[:@])/u;
const IMAGE_SHA256_DIGEST_PATTERN = /@sha256:[a-f0-9]{64}$/iu;

function isAsbcpCanonicalIdentifier(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === 'asbcp'
    || normalized === ASBCP_SERVICE_ACCOUNT
    || normalized.startsWith(`${ASBCP_SERVICE_ACCOUNT}-`);
}
const LLMUP_CONFIG_MAP = 'agentsmith-llmup-config';
const LLMUP_CONFIG_PATH = '/app/config/config.yaml';
const AFSCP_RUNTIME_SERVICE_ACCOUNT = 'afscp-runtime';
const AFSCP_RUNTIME_CONFIG_MAP = 'afscp-runtime-config';
const AFSCP_RUNTIME_SECRET = 'afscp-runtime-secrets';
const AFSCP_VOLUME_SECRET = 'afscp-default-volume-juicefs';
const AFSCP_RUNTIME_SECRET_KEYS = [
  'AFSCP_DATABASE_URL',
  'AFSCP_POSTGRES_DSN',
  'AFSCP_API_POSTGRES_DSN',
  'AFSCP_EXPORT_GATEWAY_POSTGRES_DSN',
  'AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN',
  'AFSCP_API_SERVICE_TOKENS',
] as const;
const AFSCP_VOLUME_PVC = 'afscp-default-volume';
const AFSCP_SCHEMA_BOOTSTRAP_JOB = 'afscp-schema-bootstrap';
const AFSCP_VOLUME_BOOTSTRAP_JOB = 'afscp-volume-bootstrap';
const AFSCP_SCHEMA_CHECK_INIT_CONTAINER = 'afscp-schema-check';
const AFSCP_POSTGRES_READY_INIT_CONTAINER = 'afscp-postgresql-ready';
const AFSCP_BOOTSTRAP_BACKOFF_LIMIT = 3;
const AFSCP_VOLUME_STORAGE_QUANTITY = '12P';
const AFSCP_VOLUME_ROOT_PATH = '/data/afscp/volumes/default';
const AFSCP_JVS_CWD_VOLUME = 'afscp-jvs-cwd';
const AFSCP_JVS_CWD_PATH = '/data/afscp/jvs-cwd';
const POD_TEMPLATE_OWNERSHIP_LABEL = 'app.kubernetes.io/part-of';
const POD_TEMPLATE_OWNERSHIP_LABEL_VALUE = 'agentsmith-deploy';
const POD_TEMPLATE_RENDERED_BY_ANNOTATION = 'rendered-by';
const POD_TEMPLATE_RENDERED_BY_ANNOTATION_VALUE = 'agentsmith-unified-deploy';
const AFSCP_POD_TEMPLATE_RESOURCES = [
  ['Job', AFSCP_SCHEMA_BOOTSTRAP_JOB],
  ['Job', AFSCP_VOLUME_BOOTSTRAP_JOB],
  ['Deployment', 'afscp-api'],
  ['Deployment', 'afscp-worker'],
  ['Deployment', 'afscp-export-gateway'],
] as const;
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

type RenderCheckOptions = {
  siteEnvPath?: string;
  substrateTruthPath?: string;
  manifestPath?: string;
  templatesRoot?: string;
  profile?: RenderCheckProfile;
};

type RenderedOutputCheckOptions = {
  profile?: UnifiedDeployProfile;
};

type RenderCheckProfile = UnifiedDeployProfile | 'all';

const RENDER_CHECK_PROFILE_EXPECTED = 'local-kind, existing-cluster, or all';

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function includesShellArg(command: string, arg: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegExp(arg)}(?:$|\\s)`, 'u').test(command);
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
    !apiBuild.includes('esbuild')
    || !API_PACKAGE_REQUIRED_BUILD_ARGS.every((arg) => includesShellArg(apiBuild, arg))
    || includesShellArg(apiBuild, '--outfile=dist/index.js')
  ) {
    addFailure(
      failures,
      'packages/api-entry-node/package.json:scripts.build',
      'api package build must bundle src/index.ts, src/product-schema-bootstrap.ts, and src/deployment-managed-runner-seed.ts to dist',
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
  if (!hasResource(documents, 'Job', PRODUCT_SCHEMA_BOOTSTRAP_JOB)) {
    addFailure(failures, `Job/${PRODUCT_SCHEMA_BOOTSTRAP_JOB}`, 'product schema bootstrap Job must be rendered');
  }
  for (const [kind, name] of [
    ['ServiceAccount', AFSCP_RUNTIME_SERVICE_ACCOUNT],
    ['ConfigMap', AFSCP_RUNTIME_CONFIG_MAP],
    ['Job', AFSCP_SCHEMA_BOOTSTRAP_JOB],
    ['Job', AFSCP_VOLUME_BOOTSTRAP_JOB],
    ['ServiceAccount', ASBCP_SERVICE_ACCOUNT],
    ['ConfigMap', ASBCP_CONFIG_MAP],
  ] as const) {
    if (!hasResource(documents, kind, name)) {
      addFailure(failures, `${kind}/${name}`, `ASBCP ${kind} ${name} must be rendered`);
    }
  }
}

function checkNoRenderedSecretPayloads(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  for (const document of documents) {
    if (resourceKind(document) !== 'Secret') {
      continue;
    }
    for (const field of ['data', 'stringData', 'binaryData'] as const) {
      if (Object.keys(asRecord(document[field])).length > 0) {
        addFailure(failures, resourceId(document), `rendered Secret manifests must not include ${field}; use existing Secret references`);
      }
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

  for (const document of documents) {
    if (resourceKind(document) !== 'EndpointSlice' || !resourceName(document).startsWith('substrate-')) {
      continue;
    }

    const addressType = document.addressType;
    const expectedIpVersion = addressType === 'IPv4' ? 4 : addressType === 'IPv6' ? 6 : 0;
    if (expectedIpVersion === 0) {
      addFailure(
        failures,
        resourceId(document),
        'selectorless substrate EndpointSlice must use IPv4 or IPv6 IP addresses',
      );
      continue;
    }

    const endpoints = Array.isArray(document.endpoints) ? document.endpoints.map(asRecord) : [];
    for (const endpoint of endpoints) {
      const addresses = Array.isArray(endpoint.addresses) ? endpoint.addresses : [];
      for (const address of addresses) {
        if (typeof address !== 'string' || isIP(address) !== expectedIpVersion) {
          addFailure(
            failures,
            resourceId(document),
            'selectorless substrate EndpointSlice must use IPv4 or IPv6 IP addresses',
          );
        }
      }
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
    if (isAsbcpCanonicalIdentifier(serviceName) || route.includes('asbcp')) {
      addFailure(failures, 'Ingress/agentsmith', 'ASBCP services must remain internal only');
    }
  }
}

function selectorTargetsInternalOnlyComponent(selector: Record<string, unknown>): boolean {
  return Object.entries(selector).some(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    const normalizedValue = typeof value === 'string' ? value.toLowerCase() : '';

    return normalizedValue === 'llmup'
      || normalizedValue.includes('llmup')
      || isAsbcpCanonicalIdentifier(normalizedValue)
      || normalizedValue.includes('afscp')
      || (normalizedKey.includes('component') && (
        normalizedValue === 'llmup'
        || normalizedValue === 'asbcp'
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
    || isAsbcpCanonicalIdentifier(resourceName(document))
    || resourceName(document).toLowerCase().includes('afscp')
    || componentLabel(document) === 'llmup'
    || componentLabel(document) === 'asbcp'
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

function serviceExposesAsbcpComponent(document: Record<string, unknown>): boolean {
  if (resourceKind(document) !== 'Service') {
    return false;
  }

  const selector = asRecord(asRecord(document.spec).selector);
  return isAsbcpCanonicalIdentifier(resourceName(document))
    || componentLabel(document) === 'asbcp'
    || Object.values(selector).some((value) => typeof value === 'string' && (
      isAsbcpCanonicalIdentifier(value)
    ));
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
          : serviceExposesAsbcpComponent(document)
            ? 'ASBCP Service must remain ClusterIP'
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

function ruleAllowsResourceVerbs(
  resource: Record<string, unknown>,
  expectedResource: string,
  requiredVerbs: readonly string[],
): boolean {
  const rules = Array.isArray(resource.rules) ? resource.rules.map(asRecord) : [];
  return rules.some((rule) => {
    const resources = Array.isArray(rule.resources)
      ? rule.resources.filter((item): item is string => typeof item === 'string')
      : [];
    const verbs = Array.isArray(rule.verbs)
      ? rule.verbs.filter((item): item is string => typeof item === 'string')
      : [];
    if (!resources.includes(expectedResource) && !resources.includes('*')) {
      return false;
    }
    return requiredVerbs.every((verb) => verbs.includes(verb) || verbs.includes('*'));
  });
}

function checkAsbcpWorkloadFactRbac(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const role = resourceByKindName(documents, 'Role', ASBCP_SERVICE_ACCOUNT);
  if (!ruleAllowsResourceVerbs(role, 'configmaps', ['get', 'list', 'create', 'update', 'patch', 'delete'])) {
    addFailure(
      failures,
      `Role/${ASBCP_SERVICE_ACCOUNT}`,
      'ASBCP Role must permit workload fact ConfigMap access',
    );
  }
}

function checkAppConfig(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const config = documents.find((document) =>
    resourceKind(document) === 'ConfigMap' && resourceName(document) === 'agentsmith-app-config',
  );
  const data = asRecord(asRecord(config).data);

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
  if (data.MINIO_ENDPOINT !== 'substrate-minio') {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'MINIO_ENDPOINT must be the host name without scheme or port');
  }
  if (typeof data.MINIO_PORT !== 'string' || !/^\d+$/u.test(data.MINIO_PORT)) {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'MINIO_PORT must be rendered for Node API MinIO storage');
  }
  if (data.MINIO_USE_SSL !== 'false' && data.MINIO_USE_SSL !== 'true') {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'MINIO_USE_SSL must be rendered as a boolean string for Node API MinIO storage');
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

function podSpecContainerIndex(
  podSpec: Record<string, unknown>,
  containerListName: 'containers' | 'initContainers',
  containerName: string,
): number {
  const containers = Array.isArray(podSpec[containerListName]) ? podSpec[containerListName] : [];
  return containers.map(asRecord).findIndex((item) => item.name === containerName);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function hasEnvFromRef(envFrom: readonly Record<string, unknown>[], refKind: 'configMapRef' | 'secretRef', name: string): boolean {
  return envFrom.some((entry) => asRecord(entry[refKind]).name === name);
}

function resourceFieldKeys(
  documents: readonly Record<string, unknown>[],
  kind: 'ConfigMap' | 'Secret',
  name: string,
): string[] {
  const field = kind === 'ConfigMap' ? 'data' : 'stringData';
  const renderedKeys = Object.keys(asRecord(resourceByKindName(documents, kind, name)[field]));
  if (kind === 'ConfigMap' || renderedKeys.length > 0) {
    return renderedKeys;
  }
  if (name === appSecretName(documents)) {
    return [...AGENTSMITH_APP_SECRET_KEYS];
  }
  if (name === afscpRuntimeSecretName(documents)) {
    return [...AFSCP_RUNTIME_SECRET_KEYS];
  }
  return [];
}

function projectedEnvKeys(
  documents: readonly Record<string, unknown>[],
  container: Record<string, unknown>,
): Set<string> {
  const keys = new Set<string>();
  const env = Array.isArray(container.env) ? container.env.map(asRecord) : [];
  for (const entry of env) {
    if (typeof entry.name === 'string') {
      keys.add(entry.name);
    }
  }
  const envFrom = Array.isArray(container.envFrom) ? container.envFrom.map(asRecord) : [];
  for (const entry of envFrom) {
    const configMapName = asRecord(entry.configMapRef).name;
    if (typeof configMapName === 'string') {
      for (const key of resourceFieldKeys(documents, 'ConfigMap', configMapName)) {
        keys.add(key);
      }
    }
    const secretName = asRecord(entry.secretRef).name;
    if (typeof secretName === 'string') {
      for (const key of resourceFieldKeys(documents, 'Secret', secretName)) {
        keys.add(key);
      }
    }
  }

  return keys;
}

function projectedEnvNamesAndSourceKeys(
  documents: readonly Record<string, unknown>[],
  container: Record<string, unknown>,
): Set<string> {
  const keys = projectedEnvKeys(documents, container);
  const env = Array.isArray(container.env) ? container.env.map(asRecord) : [];
  for (const entry of env) {
    const valueFrom = asRecord(entry.valueFrom);
    const configMapKey = asRecord(valueFrom.configMapKeyRef).key;
    if (typeof configMapKey === 'string') {
      keys.add(configMapKey);
    }
    const secretKey = asRecord(valueFrom.secretKeyRef).key;
    if (typeof secretKey === 'string') {
      keys.add(secretKey);
    }
  }

  return keys;
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

function containerConfigMapKeyRef(container: Record<string, unknown>, name: string): Record<string, unknown> {
  return asRecord(asRecord(containerEnvEntry(container, name).valueFrom).configMapKeyRef);
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

function workloadPodTemplateMetadata(
  documents: readonly Record<string, unknown>[],
  kind: string,
  name: string,
): Record<string, unknown> {
  const resource = resourceByKindName(documents, kind, name);
  return asRecord(asRecord(asRecord(resource.spec).template).metadata);
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

function firstString(values: readonly unknown[], fallback: string): string {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0) ?? fallback;
}

function appSecretName(documents: readonly Record<string, unknown>[]): string {
  const productSchemaJob = resourceByKindName(documents, 'Job', PRODUCT_SCHEMA_BOOTSTRAP_JOB);
  const productSchemaPodSpec = asRecord(asRecord(asRecord(productSchemaJob.spec).template).spec);
  const productSchemaContainer = podSpecContainer(productSchemaPodSpec, 'containers', PRODUCT_SCHEMA_BOOTSTRAP_JOB);
  const apiEnvFrom = deploymentContainerEnvFrom(documents, 'agentsmith-api', 'api');
  const web = deploymentContainer(documents, 'agentsmith-web', 'web');

  return firstString([
    containerSecretKeyRef(productSchemaContainer, 'DATABASE_URL').name,
    asRecord(apiEnvFrom.find((entry) => asRecord(entry.secretRef).name !== undefined)?.secretRef).name,
    containerSecretKeyRef(web, 'MONGO_URL').name,
  ], AGENTSMITH_APP_SECRET);
}

function afscpRuntimeSecretName(documents: readonly Record<string, unknown>[]): string {
  const apiEnvFrom = deploymentContainerEnvFrom(documents, 'afscp-api', 'afscp-api');
  const schemaJob = resourceByKindName(documents, 'Job', AFSCP_SCHEMA_BOOTSTRAP_JOB);
  const schemaJobPodSpec = asRecord(asRecord(asRecord(schemaJob.spec).template).spec);
  const schemaJobContainer = podSpecContainer(schemaJobPodSpec, 'containers', AFSCP_SCHEMA_BOOTSTRAP_JOB);
  const schemaJobEnvFrom = Array.isArray(schemaJobContainer.envFrom) ? schemaJobContainer.envFrom.map(asRecord) : [];

  return firstString([
    asRecord(apiEnvFrom.find((entry) => asRecord(entry.secretRef).name !== undefined)?.secretRef).name,
    asRecord(schemaJobEnvFrom.find((entry) => asRecord(entry.secretRef).name !== undefined)?.secretRef).name,
  ], AFSCP_RUNTIME_SECRET);
}

function afscpVolumeSecretName(documents: readonly Record<string, unknown>[]): string {
  const apiDeployment = resourceByKindName(documents, 'Deployment', 'afscp-api');
  const namespace = resourceNamespace(apiDeployment) || resourceNamespace(resourceByKindName(documents, 'ConfigMap', AFSCP_RUNTIME_CONFIG_MAP));
  const config = asRecord(resourceByKindName(documents, 'ConfigMap', AFSCP_RUNTIME_CONFIG_MAP).data);
  const mountSecretRef = typeof config.AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS === 'string'
    ? config.AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS.split('=')[1]
    : undefined;
  const mountSecretName = mountSecretRef?.startsWith(`${namespace}/`)
    ? mountSecretRef.slice(`${namespace}/`.length)
    : undefined;
  const expectedPvName = `${namespace}-afscp-default-volume`;
  const pv = resourceByKindName(documents, 'PersistentVolume', expectedPvName);
  const csiSecretName = asRecord(asRecord(asRecord(pv.spec).csi).nodePublishSecretRef).name;

  return firstString([csiSecretName, mountSecretName], AFSCP_VOLUME_SECRET);
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
  return workloadPodTemplateAnnotations(documents, 'Deployment', deploymentName);
}

function resourceStringsFromRules(resource: Record<string, unknown>): Set<string> {
  const rules = Array.isArray(resource.rules) ? resource.rules.map(asRecord) : [];
  return new Set(rules.flatMap((rule) =>
    Array.isArray(rule.resources)
      ? rule.resources.filter((item): item is string => typeof item === 'string')
      : [],
  ));
}

function addMissingEnvValueFailure(
  failures: CheckFailure[],
  container: Record<string, unknown>,
  envName: string,
  expectedValue: string,
  message: string,
): void {
  if (containerEnvValue(container, envName) !== expectedValue) {
    addFailure(failures, `Deployment/${ASBCP_SERVICE_ACCOUNT}`, message);
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
    addFailure(failures, `Deployment/${ASBCP_SERVICE_ACCOUNT}`, message);
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

function checkProductSchemaBootstrapJob(
  documents: readonly Record<string, unknown>[],
  namespace: string,
  apiImage: string,
  failures: CheckFailure[],
): void {
  const job = resourceByKindName(documents, 'Job', PRODUCT_SCHEMA_BOOTSTRAP_JOB);
  if (resourceName(job) !== PRODUCT_SCHEMA_BOOTSTRAP_JOB) {
    return;
  }

  const jobSpec = asRecord(job.spec);
  const podSpec = asRecord(asRecord(jobSpec.template).spec);
  const container = podSpecContainer(podSpec, 'containers', PRODUCT_SCHEMA_BOOTSTRAP_JOB);

  if (resourceNamespace(job) !== namespace) {
    addFailure(failures, `Job/${PRODUCT_SCHEMA_BOOTSTRAP_JOB}`, 'product schema bootstrap Job must be namespace-local');
  }
  if (jobSpec.backoffLimit !== PRODUCT_SCHEMA_BOOTSTRAP_BACKOFF_LIMIT || jobSpec.ttlSecondsAfterFinished !== 86400) {
    addFailure(
      failures,
      `Job/${PRODUCT_SCHEMA_BOOTSTRAP_JOB}`,
      'product schema bootstrap Job must allow bounded substrate retry and retain short-lived completion evidence',
    );
  }
  if (podSpec.restartPolicy !== 'Never') {
    addFailure(failures, `Job/${PRODUCT_SCHEMA_BOOTSTRAP_JOB}`, 'product schema bootstrap Job must leave a failed Pod for diagnostics');
  }
  if (podSpec.serviceAccountName !== AGENTSMITH_APP_SERVICE_ACCOUNT) {
    addFailure(failures, `Job/${PRODUCT_SCHEMA_BOOTSTRAP_JOB}`, 'product schema bootstrap Job must use agentsmith-app ServiceAccount');
  }
  if (container.image !== apiImage) {
    addFailure(failures, `Job/${PRODUCT_SCHEMA_BOOTSTRAP_JOB}`, 'product schema bootstrap Job must use the rendered API image');
  }
  if (
    stringArray(container.command).join('\0') !== 'node'
    || stringArray(container.args).join('\0') !== PRODUCT_SCHEMA_BOOTSTRAP_SCRIPT
  ) {
    addFailure(
      failures,
      `Job/${PRODUCT_SCHEMA_BOOTSTRAP_JOB}`,
      `product schema bootstrap Job must run node ${PRODUCT_SCHEMA_BOOTSTRAP_SCRIPT}`,
    );
  }

  const databaseUrlRef = containerSecretKeyRef(container, 'DATABASE_URL');
  const expectedAppSecret = appSecretName(documents);
  if (databaseUrlRef.name !== expectedAppSecret || databaseUrlRef.key !== 'DATABASE_URL') {
    addFailure(
      failures,
      `Job/${PRODUCT_SCHEMA_BOOTSTRAP_JOB}`,
      `product schema bootstrap Job must project DATABASE_URL from ${expectedAppSecret}/DATABASE_URL`,
    );
  }
  const envFrom = Array.isArray(container.envFrom) ? container.envFrom.map(asRecord) : [];
  if (envFrom.length > 0) {
    addFailure(
      failures,
      `Job/${PRODUCT_SCHEMA_BOOTSTRAP_JOB}`,
      'product schema bootstrap Job must use explicit env key projections instead of envFrom',
    );
  }
  const projectedKeys = projectedEnvNamesAndSourceKeys(documents, container);
  for (const forbiddenKey of ['ASBCP_INTERNAL_BASE_URL', 'ASBCP_SERVICE_KEY']) {
    if (projectedKeys.has(forbiddenKey)) {
      addFailure(
        failures,
        `Job/${PRODUCT_SCHEMA_BOOTSTRAP_JOB}`,
        `product schema bootstrap Job must not project ${forbiddenKey}`,
      );
    }
  }
}

function checkRunnableAppWorkloads(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const web = deploymentContainer(documents, 'agentsmith-web', 'web');
  const api = deploymentContainer(documents, 'agentsmith-api', 'api');
  const apiDeployment = resourceByKindName(documents, 'Deployment', 'agentsmith-api');
  const appConfigMap = resourceByKindName(documents, 'ConfigMap', 'agentsmith-app-config');
  const appConfigData = asRecord(appConfigMap.data);
  const ingressPorts = collectIngressRoutePorts(documents);
  const webImage = typeof web.image === 'string' ? web.image : '';
  const apiImage = typeof api.image === 'string' ? api.image : '';
  const namespace = resourceNamespace(apiDeployment) || resourceNamespace(appConfigMap);

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
  if (typeof appConfigData.SYSTEM_ADMIN_USERNAME !== 'string' || !appConfigData.SYSTEM_ADMIN_USERNAME.trim()) {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'SYSTEM_ADMIN_USERNAME must be rendered for system admin login');
  }
  const systemAdminUsernameRef = containerConfigMapKeyRef(web, 'SYSTEM_ADMIN_USERNAME');
  if (systemAdminUsernameRef.name !== AGENTSMITH_APP_CONFIG_MAP || systemAdminUsernameRef.key !== 'SYSTEM_ADMIN_USERNAME') {
    addFailure(
      failures,
      'Deployment/agentsmith-web',
      'web must project SYSTEM_ADMIN_USERNAME from agentsmith-app-config',
    );
  }
  const systemAdminPasswordRef = containerSecretKeyRef(web, 'SYSTEM_ADMIN_PASSWORD');
  if (systemAdminPasswordRef.name !== appSecretName(documents) || systemAdminPasswordRef.key !== 'SYSTEM_ADMIN_PASSWORD') {
    addFailure(
      failures,
      'Deployment/agentsmith-web',
      'web must project SYSTEM_ADMIN_PASSWORD from the app Secret',
    );
  }
  const systemAdminCookieSecure = containerEnvValue(web, 'SYSTEM_ADMIN_SESSION_COOKIE_SECURE');
  if (systemAdminCookieSecure !== 'true' && systemAdminCookieSecure !== 'false') {
    addFailure(
      failures,
      'Deployment/agentsmith-web',
      'web must set SYSTEM_ADMIN_SESSION_COOKIE_SECURE explicitly',
    );
  }
  if (
    typeof appConfigData.PUBLIC_BASE_URL === 'string'
    && appConfigData.PUBLIC_BASE_URL.startsWith('http://')
    && systemAdminCookieSecure !== 'false'
  ) {
    addFailure(
      failures,
      'Deployment/agentsmith-web',
      'HTTP system admin installs must set SYSTEM_ADMIN_SESSION_COOKIE_SECURE=false',
    );
  }
  if (
    typeof appConfigData.PUBLIC_BASE_URL === 'string'
    && appConfigData.PUBLIC_BASE_URL.startsWith('https://')
    && systemAdminCookieSecure !== 'true'
  ) {
    addFailure(
      failures,
      'Deployment/agentsmith-web',
      'HTTPS system admin installs must set SYSTEM_ADMIN_SESSION_COOKIE_SECURE=true',
    );
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
  const apiEnvFrom = deploymentContainerEnvFrom(documents, 'agentsmith-api', 'api');
  const apiProjectedKeys = projectedEnvKeys(documents, api);
  if (
    !hasEnvFromRef(apiEnvFrom, 'configMapRef', AGENTSMITH_APP_CONFIG_MAP)
    || !hasEnvFromRef(apiEnvFrom, 'secretRef', appSecretName(documents))
    || !apiProjectedKeys.has('ASBCP_INTERNAL_BASE_URL')
    || !apiProjectedKeys.has('ASBCP_SERVICE_KEY')
  ) {
    addFailure(failures, 'Deployment/agentsmith-api', 'api must project ASBCP_INTERNAL_BASE_URL and ASBCP_SERVICE_KEY for server-side ASBCP calls');
  }
  if (appConfigData.AFSCP_CALLER_SERVICE !== 'agentsmith-api') {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'api AFSCP product caller must be agentsmith-api');
  }
  if (appConfigData.AFSCP_BOOTSTRAP_CALLER_SERVICE !== 'agentsmith-bootstrap') {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'api AFSCP bootstrap caller must be agentsmith-bootstrap');
  }
  if (appConfigData.AFSCP_ORCHESTRATOR_CALLER_SERVICE !== ASBCP_SERVICE_ACCOUNT) {
    addFailure(
      failures,
      'ConfigMap/agentsmith-app-config',
      'api AFSCP bootstrap binding must authorize the ASBCP orchestrator caller',
    );
  }
  checkProductSchemaBootstrapJob(documents, namespace, apiImage, failures);
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
  const expectedAppSecret = appSecretName(documents);
  if (adminTokenRef.name !== expectedAppSecret || adminTokenRef.key !== 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN') {
    addFailure(
      failures,
      'Deployment/agentsmith-llmup',
      `llmup admin token must come from ${expectedAppSecret}/MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN`,
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
  const afscpVolume = volumes.find((volume) => volume.name === AFSCP_VOLUME_PVC);
  const jvsCwdVolume = volumes.find((volume) => volume.name === AFSCP_JVS_CWD_VOLUME);

  if (!volumeMounts.some((mount) =>
    mount.name === AFSCP_VOLUME_PVC
    && mount.mountPath === AFSCP_VOLUME_ROOT_PATH,
  )) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must mount the AFSCP default volume root`);
  }
  if (!volumeMounts.some((mount) =>
    mount.name === AFSCP_JVS_CWD_VOLUME
    && mount.mountPath === AFSCP_JVS_CWD_PATH,
  )) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must mount the clean AFSCP_JVS_CWD scratch path`);
  }
  if (asRecord(afscpVolume?.csi).driver === 'csi.juicefs.com') {
    addFailure(
      failures,
      `Deployment/${deploymentName}`,
      `${deploymentName} must not use inline CSI for the AFSCP default volume; JuiceFS CSI requires Persistent volume lifecycle`,
    );
  }
  if (asRecord(afscpVolume?.persistentVolumeClaim).claimName !== AFSCP_VOLUME_PVC) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must mount the AFSCP default PersistentVolumeClaim`);
  }
  if (!Object.prototype.hasOwnProperty.call(jvsCwdVolume ?? {}, 'emptyDir')) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must back AFSCP_JVS_CWD with an emptyDir scratch volume`);
  }
}

function checkAfscpPersistentVolumeResources(
  documents: readonly Record<string, unknown>[],
  namespace: string,
  defaultVolumeId: string,
  failures: CheckFailure[],
): void {
  const expectedPvName = `${namespace}-afscp-default-volume`;
  const pv = resourceByKindName(documents, 'PersistentVolume', expectedPvName);
  const pvc = resourceByKindName(documents, 'PersistentVolumeClaim', AFSCP_VOLUME_PVC);
  const pvSpec = asRecord(pv.spec);
  const pvcSpec = asRecord(pvc.spec);
  const csi = asRecord(pvSpec.csi);
  const claimRef = asRecord(pvSpec.claimRef);
  const nodePublishSecretRef = asRecord(csi.nodePublishSecretRef);
  const pvCapacity = asRecord(pvSpec.capacity);
  const pvcRequests = asRecord(asRecord(pvcSpec.resources).requests);
  const pvAccessModes = Array.isArray(pvSpec.accessModes) ? pvSpec.accessModes : [];
  const pvcAccessModes = Array.isArray(pvcSpec.accessModes) ? pvcSpec.accessModes : [];
  const mountOptions = Array.isArray(pvSpec.mountOptions) ? pvSpec.mountOptions : [];
  const expectedVolumeSecret = afscpVolumeSecretName(documents);

  if (resourceName(pv) !== expectedPvName) {
    addFailure(failures, `PersistentVolume/${expectedPvName}`, 'AFSCP default volume must render a static PersistentVolume');
  }
  if (resourceName(pvc) !== AFSCP_VOLUME_PVC || resourceNamespace(pvc) !== namespace) {
    addFailure(failures, `PersistentVolumeClaim/${AFSCP_VOLUME_PVC}`, 'AFSCP default volume must render a namespace-local PersistentVolumeClaim');
  }
  if (pvSpec.volumeMode !== 'Filesystem' || pvcSpec.volumeMode !== 'Filesystem') {
    addFailure(failures, `PersistentVolume/${expectedPvName}`, 'AFSCP default PV/PVC must use Filesystem volume mode');
  }
  if (!pvAccessModes.includes('ReadWriteMany') || !pvcAccessModes.includes('ReadWriteMany')) {
    addFailure(failures, `PersistentVolume/${expectedPvName}`, 'AFSCP default PV/PVC must allow ReadWriteMany for API, worker, and export gateway');
  }
  if (pvSpec.storageClassName !== '' || pvcSpec.storageClassName !== '') {
    addFailure(failures, `PersistentVolume/${expectedPvName}`, 'AFSCP static JuiceFS PV/PVC must use an empty storageClassName');
  }
  if (pvSpec.persistentVolumeReclaimPolicy !== 'Retain') {
    addFailure(failures, `PersistentVolume/${expectedPvName}`, 'AFSCP default PersistentVolume must retain data on release');
  }
  if (pvcSpec.volumeName !== expectedPvName) {
    addFailure(failures, `PersistentVolumeClaim/${AFSCP_VOLUME_PVC}`, 'AFSCP default PVC must bind to the static JuiceFS PersistentVolume');
  }
  if (claimRef.namespace !== namespace || claimRef.name !== AFSCP_VOLUME_PVC) {
    addFailure(
      failures,
      `PersistentVolume/${expectedPvName}:spec.claimRef`,
      'AFSCP default PersistentVolume claimRef must point to the namespace-local default PersistentVolumeClaim',
    );
  }
  if (pvCapacity.storage !== AFSCP_VOLUME_STORAGE_QUANTITY || pvcRequests.storage !== AFSCP_VOLUME_STORAGE_QUANTITY) {
    addFailure(
      failures,
      `PersistentVolume/${expectedPvName}`,
      `AFSCP default PV/PVC storage quantity must be ${AFSCP_VOLUME_STORAGE_QUANTITY} to avoid Kubernetes fractional-byte quantity warnings and stay above the pre-GA 10Pi baseline`,
    );
  }
  if (
    csi.driver !== 'csi.juicefs.com'
    || csi.volumeHandle !== expectedPvName
    || csi.fsType !== 'juicefs'
    || nodePublishSecretRef.name !== expectedVolumeSecret
    || nodePublishSecretRef.namespace !== namespace
  ) {
    addFailure(
      failures,
      `PersistentVolume/${expectedPvName}`,
      `AFSCP default PersistentVolume must use JuiceFS CSI with the namespace-local volume Secret ${expectedVolumeSecret}`,
    );
  }
  if (!mountOptions.includes(`subdir=/afscp/${defaultVolumeId}`)) {
    addFailure(failures, `PersistentVolume/${expectedPvName}`, 'AFSCP default PersistentVolume must mount the default AFSCP subdirectory');
  }
}

function checkAfscpEnvFrom(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
  containerName: string,
  failures: CheckFailure[],
): void {
  const envFrom = deploymentContainerEnvFrom(documents, deploymentName, containerName);
  const expectedRuntimeSecret = afscpRuntimeSecretName(documents);
  if (!hasEnvFromRef(envFrom, 'configMapRef', AFSCP_RUNTIME_CONFIG_MAP)) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must consume ${AFSCP_RUNTIME_CONFIG_MAP}`);
  }
  if (!hasEnvFromRef(envFrom, 'secretRef', expectedRuntimeSecret)) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must consume ${expectedRuntimeSecret}`);
  }
}

function checkAfscpBootstrapJob(
  documents: readonly Record<string, unknown>[],
  namespace: string,
  afscpImage: unknown,
  jobName: typeof AFSCP_SCHEMA_BOOTSTRAP_JOB | typeof AFSCP_VOLUME_BOOTSTRAP_JOB,
  command: string,
  args: readonly string[],
  label: string,
  failures: CheckFailure[],
): void {
  const job = resourceByKindName(documents, 'Job', jobName);
  const jobSpec = asRecord(job.spec);
  const podSpec = asRecord(asRecord(jobSpec.template).spec);
  const container = podSpecContainer(podSpec, 'containers', jobName);

  if (resourceName(job) !== jobName || resourceNamespace(job) !== namespace) {
    addFailure(failures, `Job/${jobName}`, `${label} Job must be namespace-local`);
  }
  if (jobSpec.backoffLimit !== AFSCP_BOOTSTRAP_BACKOFF_LIMIT || jobSpec.ttlSecondsAfterFinished !== 86400) {
    addFailure(
      failures,
      `Job/${jobName}`,
      `${label} Job must allow bounded substrate retry and retain short-lived completion evidence`,
    );
  }
  if (podSpec.restartPolicy !== 'Never') {
    addFailure(failures, `Job/${jobName}`, `${label} Job must leave a failed Pod for diagnostics`);
  }
  if (podSpec.serviceAccountName !== AFSCP_RUNTIME_SERVICE_ACCOUNT) {
    addFailure(failures, `Job/${jobName}`, `${label} Job must use the dedicated AFSCP ServiceAccount`);
  }
  if (container.image !== afscpImage) {
    addFailure(failures, `Job/${jobName}`, `${label} Job must use the same AFSCP runtime image`);
  }
  if (
    stringArray(container.command).join('\0') !== command
    || stringArray(container.args).join('\0') !== args.join('\0')
  ) {
    addFailure(failures, `Job/${jobName}`, `${label} Job must run ${command} ${args.join(' ')}`);
  }
  const envFrom = Array.isArray(container.envFrom) ? container.envFrom.map(asRecord) : [];
  const expectedRuntimeSecret = afscpRuntimeSecretName(documents);
  if (!hasEnvFromRef(envFrom, 'configMapRef', AFSCP_RUNTIME_CONFIG_MAP) || !hasEnvFromRef(envFrom, 'secretRef', expectedRuntimeSecret)) {
    addFailure(failures, `Job/${jobName}`, `${label} Job must consume the AFSCP runtime config and secrets`);
  }
}

function checkAfscpVolumeBootstrapSchemaBarrier(
  documents: readonly Record<string, unknown>[],
  afscpImage: unknown,
  failures: CheckFailure[],
): void {
  const job = resourceByKindName(documents, 'Job', AFSCP_VOLUME_BOOTSTRAP_JOB);
  const podSpec = asRecord(asRecord(asRecord(job.spec).template).spec);
  const init = podSpecContainer(podSpec, 'initContainers', AFSCP_SCHEMA_BOOTSTRAP_JOB);
  if (init.image !== afscpImage) {
    addFailure(failures, `Job/${AFSCP_VOLUME_BOOTSTRAP_JOB}`, 'AFSCP default volume bootstrap Job must run the schema bootstrap barrier with the same AFSCP runtime image');
  }
  if (
    stringArray(init.command).join('\0') !== '/usr/local/bin/afscp-migrate'
    || stringArray(init.args).join('\0') !== ['--apply', '--check', '--timeout=60s'].join('\0')
  ) {
    addFailure(failures, `Job/${AFSCP_VOLUME_BOOTSTRAP_JOB}`, 'AFSCP default volume bootstrap Job must run afscp-migrate --apply --check before volume ensure');
  }
  const envFrom = Array.isArray(init.envFrom) ? init.envFrom.map(asRecord) : [];
  const expectedRuntimeSecret = afscpRuntimeSecretName(documents);
  if (!hasEnvFromRef(envFrom, 'configMapRef', AFSCP_RUNTIME_CONFIG_MAP) || !hasEnvFromRef(envFrom, 'secretRef', expectedRuntimeSecret)) {
    addFailure(failures, `Job/${AFSCP_VOLUME_BOOTSTRAP_JOB}`, 'AFSCP default volume bootstrap schema barrier must consume the AFSCP runtime config and secrets');
  }
}

function checkAfscpPostgresqlReadyInit(
  input: {
    podSpec: Record<string, unknown>;
    resourcePath: string;
    appImage: unknown;
    namespace: string;
    beforeInitContainer?: string;
    failures: CheckFailure[];
  },
): void {
  const init = podSpecContainer(input.podSpec, 'initContainers', AFSCP_POSTGRES_READY_INIT_CONTAINER);
  if (init.image !== input.appImage) {
    addFailure(
      input.failures,
      input.resourcePath,
      `${input.resourcePath} must wait for PostgreSQL with the rendered AgentSmith app image`,
    );
  }
  if (String(init.image ?? '').toLowerCase().includes('busybox')) {
    addFailure(input.failures, input.resourcePath, `${input.resourcePath} must not use BusyBox for PostgreSQL readiness`);
  }
  if (stringArray(init.command).join('\0') !== 'node') {
    addFailure(input.failures, input.resourcePath, `${input.resourcePath} PostgreSQL readiness init must run node`);
  }
  if (
    !stringArray(init.args).includes('-e')
    || !stringArray(init.args).some((arg) => arg.includes('net.connect'))
  ) {
    addFailure(input.failures, input.resourcePath, `${input.resourcePath} PostgreSQL readiness init must perform a TCP wait`);
  }
  if (containerEnvValue(init, 'AFSCP_POSTGRES_READY_HOST') !== `substrate-postgresql.${input.namespace}.svc.cluster.local`) {
    addFailure(input.failures, input.resourcePath, `${input.resourcePath} PostgreSQL readiness init must target the namespace-local substrate Service`);
  }
  if (containerEnvValue(init, 'AFSCP_POSTGRES_READY_PORT') !== '5432') {
    addFailure(input.failures, input.resourcePath, `${input.resourcePath} PostgreSQL readiness init must target port 5432`);
  }
  if (input.beforeInitContainer) {
    const waitIndex = podSpecContainerIndex(input.podSpec, 'initContainers', AFSCP_POSTGRES_READY_INIT_CONTAINER);
    const migrateIndex = podSpecContainerIndex(input.podSpec, 'initContainers', input.beforeInitContainer);
    if (waitIndex < 0 || migrateIndex < 0 || waitIndex >= migrateIndex) {
      addFailure(
        input.failures,
        input.resourcePath,
        `${input.resourcePath} PostgreSQL readiness init must run before ${input.beforeInitContainer}`,
      );
    }
  }
}

function checkAfscpSchemaInitContainer(
  documents: readonly Record<string, unknown>[],
  deploymentName: string,
  afscpImage: unknown,
  failures: CheckFailure[],
): void {
  const podSpec = deploymentPodSpec(documents, deploymentName);
  const init = podSpecContainer(podSpec, 'initContainers', AFSCP_SCHEMA_CHECK_INIT_CONTAINER);
  if (init.image !== afscpImage) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must run the AFSCP schema check init container with the same image`);
  }
  if (
    stringArray(init.command).join('\0') !== '/usr/local/bin/afscp-migrate'
    || stringArray(init.args).join('\0') !== ['--check', '--timeout=60s'].join('\0')
  ) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} must gate startup on afscp-migrate --check`);
  }
  const envFrom = Array.isArray(init.envFrom) ? init.envFrom.map(asRecord) : [];
  const expectedRuntimeSecret = afscpRuntimeSecretName(documents);
  if (!hasEnvFromRef(envFrom, 'configMapRef', AFSCP_RUNTIME_CONFIG_MAP) || !hasEnvFromRef(envFrom, 'secretRef', expectedRuntimeSecret)) {
    addFailure(failures, `Deployment/${deploymentName}`, `${deploymentName} schema check init container must consume the AFSCP runtime config and secrets`);
  }
}

function checkNonRoot65532SecurityContext(
  context: Record<string, unknown>,
  resource: string,
  label: string,
  failures: CheckFailure[],
): void {
  if (
    context.runAsNonRoot !== true
    || context.runAsUser !== 65532
    || context.runAsGroup !== 65532
  ) {
    addFailure(failures, resource, `${label} must keep the non-root 65532 security context`);
  }
}

function hasImageUserOverride(context: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(context, 'runAsNonRoot')
    || Object.prototype.hasOwnProperty.call(context, 'runAsUser')
    || Object.prototype.hasOwnProperty.call(context, 'runAsGroup')
    || Object.prototype.hasOwnProperty.call(context, 'fsGroup')
    || Object.prototype.hasOwnProperty.call(context, 'fsGroupChangePolicy');
}

function checkAfscpImageUserBoundary(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  checkNonRoot65532SecurityContext(
    asRecord(deploymentPodSpec(documents, 'afscp-api').securityContext),
    'Deployment/afscp-api',
    'afscp-api pod',
    failures,
  );

  for (const deploymentName of ['afscp-worker', 'afscp-export-gateway'] as const) {
    const podSpec = deploymentPodSpec(documents, deploymentName);
    const container = deploymentContainer(documents, deploymentName, deploymentName);
    const init = podSpecContainer(podSpec, 'initContainers', AFSCP_SCHEMA_CHECK_INIT_CONTAINER);
    if (hasImageUserOverride(asRecord(podSpec.securityContext)) || hasImageUserOverride(asRecord(container.securityContext))) {
      addFailure(
        failures,
        `Deployment/${deploymentName}`,
        `${deploymentName} must inherit the AFSCP image user/root for storage tree traversal; do not force runAsUser/runAsNonRoot/runAsGroup/fsGroup in the pod or main container`,
      );
    }
    checkNonRoot65532SecurityContext(
      asRecord(init.securityContext),
      `Deployment/${deploymentName}`,
      `${deploymentName} schema check init container`,
      failures,
    );
  }
}

function checkAfscpDefaultVolumeBootstrapConfig(
  config: Record<string, unknown>,
  defaultVolumeId: string,
  failures: CheckFailure[],
): void {
  const expectedScalarValues = new Map([
    ['AFSCP_DEFAULT_VOLUME_ID', defaultVolumeId],
    ['AFSCP_DEFAULT_VOLUME_BACKEND', 'juicefs'],
    ['AFSCP_DEFAULT_VOLUME_ISOLATION_CLASS', 'shared'],
    ['AFSCP_DEFAULT_VOLUME_STATUS', 'active'],
    ['AFSCP_DEFAULT_VOLUME_ROOT_PATH', AFSCP_VOLUME_ROOT_PATH],
  ]);

  for (const [key, expected] of expectedScalarValues) {
    if (config[key] !== expected) {
      addFailure(
        failures,
        `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`,
        `${key} must explicitly describe the default AFSCP volume bootstrap spec`,
      );
    }
  }

  const rawCapabilities = config.AFSCP_DEFAULT_VOLUME_CAPABILITIES_JSON;
  if (typeof rawCapabilities !== 'string' || !rawCapabilities.trim()) {
    addFailure(
      failures,
      `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`,
      'AFSCP_DEFAULT_VOLUME_CAPABILITIES_JSON must explicitly describe default volume capabilities',
    );
    return;
  }

  let capabilities: Record<string, unknown>;
  try {
    capabilities = asRecord(JSON.parse(rawCapabilities) as unknown);
  } catch {
    addFailure(
      failures,
      `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`,
      'AFSCP_DEFAULT_VOLUME_CAPABILITIES_JSON must be valid JSON',
    );
    return;
  }

  for (const [key, expected] of [
    ['webdav_export', true],
    ['workload_mount', true],
    ['jvs_external_control_root', true],
    ['directory_quota', false],
    ['filtered_mount', false],
    ['csi_driver', 'csi.juicefs.com'],
    ['storage_class', 'static-juicefs-rwx'],
    ['permission_model', 'payload-root-only'],
  ] as const) {
    if (capabilities[key] !== expected) {
      addFailure(
        failures,
        `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`,
        `AFSCP default volume capabilities must set ${key}=${String(expected)}`,
      );
    }
  }
}

function checkAfscpContract(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const apiDeployment = resourceByKindName(documents, 'Deployment', 'afscp-api');
  const config = asRecord(resourceByKindName(documents, 'ConfigMap', AFSCP_RUNTIME_CONFIG_MAP).data);
  const namespace = resourceNamespace(apiDeployment) || resourceNamespace(resourceByKindName(documents, 'ConfigMap', AFSCP_RUNTIME_CONFIG_MAP));
  const afscpImage = deploymentContainer(documents, 'afscp-api', 'afscp-api').image;
  const appImage = deploymentContainer(documents, 'agentsmith-api', 'api').image;
  const expectedRuntimeSecret = afscpRuntimeSecretName(documents);
  const expectedVolumeSecret = afscpVolumeSecretName(documents);

  if (config.AFSCP_API_MODE !== 'internal') {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP API must run in internal mode');
  }
  if (config.AFSCP_API_VOLUME_ROOTS !== `vol_agentsmith_default=${AFSCP_VOLUME_ROOT_PATH}` && !String(config.AFSCP_API_VOLUME_ROOTS ?? '').endsWith(`=${AFSCP_VOLUME_ROOT_PATH}`)) {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP API volume roots must map the default volume to the mounted volume root');
  }
  if (config.AFSCP_VOLUME_ROOTS !== config.AFSCP_API_VOLUME_ROOTS || config.AFSCP_EXPORT_GATEWAY_VOLUME_ROOTS !== config.AFSCP_API_VOLUME_ROOTS) {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP API, worker, and export gateway must share the same volume root map');
  }
  if (config.AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS !== `${config.AFSCP_API_VOLUME_ROOTS}`.split('=')[0] + `=${namespace}/${expectedVolumeSecret}`) {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP workload mount Secret refs must point to the namespace-local JuiceFS CSI Secret');
  }
  if (config.AFSCP_JVS_CWD !== AFSCP_JVS_CWD_PATH) {
    addFailure(
      failures,
      `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`,
      `AFSCP_JVS_CWD must be the clean absolute mounted scratch path ${AFSCP_JVS_CWD_PATH}`,
    );
  }
  for (const key of ['AFSCP_JVS_BINARY_PATH', 'AFSCP_JVS_BINARY_SHA256']) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      addFailure(
        failures,
        `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`,
        `${key} must come from the AFSCP image default instead of the AgentSmith deploy manifest`,
      );
    }
  }
  const defaultVolumeId = `${config.AFSCP_API_VOLUME_ROOTS ?? ''}`.split('=')[0];
  checkAfscpDefaultVolumeBootstrapConfig(config, defaultVolumeId, failures);
  checkAfscpPersistentVolumeResources(documents, namespace, defaultVolumeId, failures);
  checkAfscpImageUserBoundary(documents, failures);
  for (const [key, expected] of [
    ['AFSCP_STORAGE_ENABLED', 'true'],
    ['AFSCP_STORAGE_READY', 'true'],
    ['AFSCP_JVS_ENABLED', 'true'],
    ['AFSCP_JVS_READY', 'true'],
    ['AFSCP_MOUNT_ENABLED', 'true'],
    ['AFSCP_MOUNT_READY', 'true'],
    ['AFSCP_REPO_TEMPLATE_ENABLED', 'true'],
    ['AFSCP_REPO_TEMPLATE_READY', 'true'],
    ['AFSCP_WORKER_OPERATION_RECOVERY_ENABLED', 'true'],
    ['AFSCP_REPO_CREATE_RECOVERY_ENABLED', 'true'],
    ['AFSCP_REPO_LIFECYCLE_RECOVERY_ENABLED', 'true'],
    ['AFSCP_SAVE_POINT_RECOVERY_ENABLED', 'true'],
    ['AFSCP_TEMPLATE_CREATE_RECOVERY_ENABLED', 'true'],
    ['AFSCP_TEMPLATE_CLONE_RECOVERY_ENABLED', 'true'],
    ['AFSCP_RESTORE_RECOVERY_ENABLED', 'true'],
  ] as const) {
    if (config[key] !== expected) {
      addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, `${key} must be ${expected}`);
    }
  }
  const webDAVExportPublicBaseURL = String(config.AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL ?? '');
  if (webDAVExportPublicBaseURL !== `http://afscp-export-gateway.${namespace}.svc.cluster.local:8080`) {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP WebDAV export public base URL must point to the internal export gateway Service origin without the /e gateway prefix');
  }
  if (webDAVExportPublicBaseURL.replace(/\/+$/u, '').endsWith('/e')) {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP WebDAV export public base URL must not include /e; AFSCP API appends /e/{exportId}/ and would render /e/e/ paths');
  }
  if (!expectedRuntimeSecret || !expectedVolumeSecret) {
    addFailure(failures, `ConfigMap/${AFSCP_RUNTIME_CONFIG_MAP}`, 'AFSCP existing Secret names must be available through workload and volume references');
  }

  const api = deploymentContainer(documents, 'afscp-api', 'afscp-api');
  const worker = deploymentContainer(documents, 'afscp-worker', 'afscp-worker');
  const exportGateway = deploymentContainer(documents, 'afscp-export-gateway', 'afscp-export-gateway');
  if (!String(afscpImage ?? '').includes('agentsmith-fs-control-plane') || worker.image !== afscpImage || exportGateway.image !== afscpImage) {
    addFailure(failures, 'Deployment/afscp-api', 'AFSCP API, worker, and export gateway must use the same AFSCP runtime image');
  }
  checkAfscpBootstrapJob(
    documents,
    namespace,
    afscpImage,
    AFSCP_SCHEMA_BOOTSTRAP_JOB,
    '/usr/local/bin/afscp-migrate',
    ['--apply', '--check', '--timeout=60s'],
    'AFSCP schema bootstrap',
    failures,
  );
  checkAfscpBootstrapJob(
    documents,
    namespace,
    afscpImage,
    AFSCP_VOLUME_BOOTSTRAP_JOB,
    '/usr/local/bin/afscp-volume-bootstrap',
    ['--ensure', '--check', '--timeout=60s'],
    'AFSCP default volume bootstrap',
    failures,
  );
  checkAfscpPostgresqlReadyInit({
    podSpec: jobPodSpec(documents, AFSCP_SCHEMA_BOOTSTRAP_JOB),
    resourcePath: `Job/${AFSCP_SCHEMA_BOOTSTRAP_JOB}`,
    appImage,
    namespace,
    failures,
  });
  checkAfscpPostgresqlReadyInit({
    podSpec: jobPodSpec(documents, AFSCP_VOLUME_BOOTSTRAP_JOB),
    resourcePath: `Job/${AFSCP_VOLUME_BOOTSTRAP_JOB}`,
    appImage,
    namespace,
    beforeInitContainer: AFSCP_SCHEMA_BOOTSTRAP_JOB,
    failures,
  });
  checkAfscpVolumeBootstrapSchemaBarrier(documents, afscpImage, failures);
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
    checkAfscpPostgresqlReadyInit({
      podSpec: deploymentPodSpec(documents, deploymentName),
      resourcePath: `Deployment/${deploymentName}`,
      appImage,
      namespace,
      beforeInitContainer: AFSCP_SCHEMA_CHECK_INIT_CONTAINER,
      failures,
    });
    checkAfscpSchemaInitContainer(documents, deploymentName, afscpImage, failures);
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

function jobPodSpec(
  documents: readonly Record<string, unknown>[],
  jobName: string,
): Record<string, unknown> {
  const job = resourceByKindName(documents, 'Job', jobName);
  return asRecord(asRecord(asRecord(job.spec).template).spec);
}

function podSpecVolumes(podSpec: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];
}

function containerVolumeMounts(container: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(container.volumeMounts) ? container.volumeMounts.map(asRecord) : [];
}

function substrateCaVolumes(podSpec: Record<string, unknown>): Record<string, unknown>[] {
  return podSpecVolumes(podSpec).filter((volume) =>
    typeof volume.name === 'string' && /^substrate-[a-z0-9-]+-ca$/u.test(volume.name),
  );
}

function hasVolume(podSpec: Record<string, unknown>, volumeName: string): boolean {
  return podSpecVolumes(podSpec).some((volume) => volume.name === volumeName);
}

function hasMountedVolume(container: Record<string, unknown>, volumeName: string): boolean {
  return containerVolumeMounts(container).some((mount) => mount.name === volumeName);
}

function checkSubstrateCaVolumes(
  podSpec: Record<string, unknown>,
  resourcePath: string,
  failures: CheckFailure[],
): void {
  for (const volume of substrateCaVolumes(podSpec)) {
    const secret = asRecord(volume.secret);
    const items = Array.isArray(secret.items) ? secret.items.map(asRecord) : [];
    if (typeof secret.secretName !== 'string' || !secret.secretName) {
      addFailure(failures, resourcePath, `${String(volume.name)} must reference an existing substrate CA Secret`);
    }
    const caItem = items.find((item) => item.path === SUBSTRATE_CA_PROJECTED_PATH);
    const secretKey = typeof caItem?.key === 'string' ? caItem.key : '';
    if (!caItem || !isKubernetesSecretDataKey(secretKey)) {
      addFailure(
        failures,
        resourcePath,
        `${String(volume.name)} must project a valid Kubernetes Secret data key to ${SUBSTRATE_CA_PROJECTED_PATH}`,
      );
    }
  }
}

function checkContainerMountsSubstrateCaVolumes(
  container: Record<string, unknown>,
  caVolumes: readonly Record<string, unknown>[],
  resourcePath: string,
  containerLabel: string,
  failures: CheckFailure[],
): void {
  const mounts = containerVolumeMounts(container);
  for (const volume of caVolumes) {
    const volumeName = typeof volume.name === 'string' ? volume.name : '';
    const mount = mounts.find((item) => item.name === volumeName);
    if (
      !mount
      || typeof mount.mountPath !== 'string'
      || !mount.mountPath.startsWith(`${SUBSTRATE_CA_BASE_DIR}/`)
      || mount.readOnly !== true
    ) {
      addFailure(
        failures,
        resourcePath,
        `${containerLabel} must mount ${volumeName} read-only under ${SUBSTRATE_CA_BASE_DIR}`,
      );
    }
  }
}

function checkNodeSubstrateCaProjection(
  podSpec: Record<string, unknown>,
  resourcePath: string,
  containerName: string,
  failures: CheckFailure[],
): void {
  const caVolumes = substrateCaVolumes(podSpec);
  if (caVolumes.length === 0) {
    addFailure(failures, resourcePath, `${resourcePath} substrate client must project substrate CA Secret volumes`);
    return;
  }
  checkSubstrateCaVolumes(podSpec, resourcePath, failures);
  const container = podSpecContainer(podSpec, 'containers', containerName);
  const init = podSpecContainer(podSpec, 'initContainers', 'substrate-ca-bundle');
  if (!hasVolume(podSpec, 'substrate-ca-bundle')) {
    addFailure(failures, resourcePath, `${resourcePath} must define substrate-ca-bundle emptyDir`);
  }
  if (containerEnvValue(container, 'NODE_EXTRA_CA_CERTS') !== NODE_SUBSTRATE_CA_BUNDLE_PATH) {
    addFailure(failures, resourcePath, `${containerName} must set NODE_EXTRA_CA_CERTS to the rendered substrate CA bundle`);
  }
  if (stringArray(init.command).join('\0') !== 'node' || !stringArray(init.args).includes('-e')) {
    addFailure(failures, resourcePath, `${resourcePath} must build NODE_EXTRA_CA_CERTS with a node initContainer`);
  }
  for (const checkedContainer of [
    { value: container, label: containerName },
    { value: init, label: 'substrate-ca-bundle initContainer' },
  ]) {
    if (!hasMountedVolume(checkedContainer.value, 'substrate-ca-bundle')) {
      addFailure(failures, resourcePath, `${checkedContainer.label} must mount ${NODE_SUBSTRATE_CA_BUNDLE_DIR}`);
    }
    checkContainerMountsSubstrateCaVolumes(
      checkedContainer.value,
      caVolumes,
      resourcePath,
      checkedContainer.label,
      failures,
    );
  }
}

function checkAfscpSubstrateCaProjectionForContainer(
  podSpec: Record<string, unknown>,
  resourcePath: string,
  containerListName: 'containers' | 'initContainers',
  containerName: string,
  failures: CheckFailure[],
): void {
  const caVolumes = substrateCaVolumes(podSpec);
  if (caVolumes.length === 0) {
    return;
  }
  const container = podSpecContainer(podSpec, containerListName, containerName);
  const sslCertDir = containerEnvValue(container, 'SSL_CERT_DIR') ?? '';
  if (!sslCertDir.includes(SUBSTRATE_CA_BASE_DIR)) {
    addFailure(failures, resourcePath, `${containerName} must set SSL_CERT_DIR for substrate CA trust`);
  }
  checkContainerMountsSubstrateCaVolumes(container, caVolumes, resourcePath, containerName, failures);
}

function checkAfscpSubstrateCaProjection(
  podSpec: Record<string, unknown>,
  resourcePath: string,
  containers: readonly { list: 'containers' | 'initContainers'; name: string }[],
  failures: CheckFailure[],
): void {
  if (substrateCaVolumes(podSpec).length === 0) {
    addFailure(failures, resourcePath, `${resourcePath} substrate client must project substrate CA Secret volumes`);
    return;
  }
  checkSubstrateCaVolumes(podSpec, resourcePath, failures);
  for (const container of containers) {
    checkAfscpSubstrateCaProjectionForContainer(
      podSpec,
      resourcePath,
      container.list,
      container.name,
      failures,
    );
  }
}

function checkSubstrateCaProjection(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const appConfig = asRecord(resourceByKindName(documents, 'ConfigMap', AGENTSMITH_APP_CONFIG_MAP).data);
  const podSpecs = [
    jobPodSpec(documents, PRODUCT_SCHEMA_BOOTSTRAP_JOB),
    deploymentPodSpec(documents, 'agentsmith-web'),
    deploymentPodSpec(documents, 'agentsmith-api'),
    jobPodSpec(documents, AFSCP_SCHEMA_BOOTSTRAP_JOB),
    jobPodSpec(documents, AFSCP_VOLUME_BOOTSTRAP_JOB),
    deploymentPodSpec(documents, 'afscp-api'),
    deploymentPodSpec(documents, 'afscp-worker'),
    deploymentPodSpec(documents, 'afscp-export-gateway'),
  ];
  const caProjectionEnabled = podSpecs.some((podSpec) => substrateCaVolumes(podSpec).length > 0);
  const objectStorageCaProjected = podSpecs.some((podSpec) =>
    hasVolume(podSpec, 'substrate-object-storage-ca'),
  );

  if (appConfig.MINIO_USE_SSL === 'true' && !objectStorageCaProjected) {
    addFailure(
      failures,
      `ConfigMap/${AGENTSMITH_APP_CONFIG_MAP}`,
      'MINIO_USE_SSL=true requires object-storage CA projection into substrate clients',
    );
  }
  if (objectStorageCaProjected && appConfig.MINIO_USE_SSL !== 'true') {
    addFailure(
      failures,
      `ConfigMap/${AGENTSMITH_APP_CONFIG_MAP}`,
      'object-storage CA projection requires MINIO_USE_SSL=true',
    );
  }
  if (!caProjectionEnabled) {
    return;
  }

  checkNodeSubstrateCaProjection(
    jobPodSpec(documents, PRODUCT_SCHEMA_BOOTSTRAP_JOB),
    `Job/${PRODUCT_SCHEMA_BOOTSTRAP_JOB}`,
    PRODUCT_SCHEMA_BOOTSTRAP_JOB,
    failures,
  );
  checkNodeSubstrateCaProjection(
    deploymentPodSpec(documents, 'agentsmith-web'),
    'Deployment/agentsmith-web',
    'web',
    failures,
  );
  checkNodeSubstrateCaProjection(
    deploymentPodSpec(documents, 'agentsmith-api'),
    'Deployment/agentsmith-api',
    'api',
    failures,
  );
  checkAfscpSubstrateCaProjection(
    jobPodSpec(documents, AFSCP_SCHEMA_BOOTSTRAP_JOB),
    `Job/${AFSCP_SCHEMA_BOOTSTRAP_JOB}`,
    [{ list: 'containers', name: AFSCP_SCHEMA_BOOTSTRAP_JOB }],
    failures,
  );
  checkAfscpSubstrateCaProjection(
    jobPodSpec(documents, AFSCP_VOLUME_BOOTSTRAP_JOB),
    `Job/${AFSCP_VOLUME_BOOTSTRAP_JOB}`,
    [
      { list: 'initContainers', name: AFSCP_SCHEMA_BOOTSTRAP_JOB },
      { list: 'containers', name: AFSCP_VOLUME_BOOTSTRAP_JOB },
    ],
    failures,
  );
  for (const [deploymentName, containerName] of [
    ['afscp-api', 'afscp-api'],
    ['afscp-worker', 'afscp-worker'],
    ['afscp-export-gateway', 'afscp-export-gateway'],
  ] as const) {
    checkAfscpSubstrateCaProjection(
      deploymentPodSpec(documents, deploymentName),
      `Deployment/${deploymentName}`,
      [
        { list: 'initContainers', name: AFSCP_SCHEMA_CHECK_INIT_CONTAINER },
        { list: 'containers', name: containerName },
      ],
      failures,
    );
  }
}

function checkAfscpPodTemplateOwnershipMarkers(
  documents: readonly Record<string, unknown>[],
  failures: CheckFailure[],
): void {
  for (const [kind, name] of AFSCP_POD_TEMPLATE_RESOURCES) {
    const resourcePath = `${kind}/${name}`;
    const labels = workloadPodTemplateLabels(documents, kind, name);
    const annotations = workloadPodTemplateAnnotations(documents, kind, name);

    if (labels[POD_TEMPLATE_OWNERSHIP_LABEL] !== POD_TEMPLATE_OWNERSHIP_LABEL_VALUE) {
      addFailure(
        failures,
        resourcePath,
        `${resourcePath} pod template must include ${POD_TEMPLATE_OWNERSHIP_LABEL}=${POD_TEMPLATE_OWNERSHIP_LABEL_VALUE}`,
      );
    }
    if (annotations[POD_TEMPLATE_RENDERED_BY_ANNOTATION] !== POD_TEMPLATE_RENDERED_BY_ANNOTATION_VALUE) {
      addFailure(
        failures,
        resourcePath,
        `${resourcePath} pod template must include ${POD_TEMPLATE_RENDERED_BY_ANNOTATION}=${POD_TEMPLATE_RENDERED_BY_ANNOTATION_VALUE}`,
      );
    }
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
    [ASBCP_SERVICE_ACCOUNT, ['agentsmith.mbos.dev/checksum-asbcp-config', 'agentsmith.mbos.dev/checksum-app-secrets']],
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

function checkAsbcpContract(
  documents: readonly Record<string, unknown>[],
  failures: CheckFailure[],
  options: RenderedOutputCheckOptions,
): void {
  const deployment = resourceByKindName(documents, 'Deployment', ASBCP_SERVICE_ACCOUNT);
  const podSpec = deploymentPodSpec(documents, ASBCP_SERVICE_ACCOUNT);
  const container = deploymentContainer(documents, ASBCP_SERVICE_ACCOUNT, 'asbcp');
  const configMap = resourceByKindName(documents, 'ConfigMap', ASBCP_CONFIG_MAP);
  const appConfigMap = resourceByKindName(documents, 'ConfigMap', 'agentsmith-app-config');
  const namespace = resourceNamespace(deployment) || resourceNamespace(configMap);
  const appConfigData = asRecord(appConfigMap.data);
  const expectedAppSecret = appSecretName(documents);
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

  if (podSpec.serviceAccountName !== ASBCP_SERVICE_ACCOUNT) {
    addFailure(failures, `Deployment/${ASBCP_SERVICE_ACCOUNT}`, 'ASBCP must use its dedicated ServiceAccount');
  }
  const asbcpImage = typeof container.image === 'string' ? container.image : '';
  const isGhcrImage = ASBCP_GHCR_IMAGE_REPOSITORY_PATTERN.test(asbcpImage);
  const isLocalKindImage = ASBCP_LOCAL_KIND_IMAGE_REPOSITORY_PATTERN.test(asbcpImage);
  if (!isGhcrImage && !isLocalKindImage) {
    addFailure(failures, `Deployment/${ASBCP_SERVICE_ACCOUNT}`, 'ASBCP image must use the canonical agentsmith-sandbox-control-plane repository');
  } else if (isLocalKindImage && options.profile !== undefined && options.profile !== 'local-kind') {
    addFailure(failures, `Deployment/${ASBCP_SERVICE_ACCOUNT}`, 'ASBCP local-kind registry image is only allowed for local-kind renders');
  } else if (!IMAGE_SHA256_DIGEST_PATTERN.test(asbcpImage)) {
    addFailure(failures, `Deployment/${ASBCP_SERVICE_ACCOUNT}`, 'ASBCP image must be pinned by sha256 digest');
  }
  if (appConfigData.ASBCP_INTERNAL_BASE_URL !== 'http://agentsmith-sandbox-control-plane:8080') {
    addFailure(failures, 'ConfigMap/agentsmith-app-config', 'ASBCP_INTERNAL_BASE_URL must point to the internal ASBCP Service');
  }
  addMissingEnvValueFailure(
    failures,
    container,
    'ASBCP_CONFIG_PATH',
    ASBCP_CONFIG_PATH,
    'ASBCP must set ASBCP_CONFIG_PATH to the canonical asbcp-config.yaml path',
  );
  addMissingEnvValueFailure(
    failures,
    container,
    'ASBCP_WORKLOAD_NAMESPACE',
    namespace,
    'ASBCP workload namespace must match the unified render namespace',
  );
  addMissingEnvValueFailure(
    failures,
    container,
    'ASBCP_AFSCP_INTERNAL_BASE_URL',
    typeof appConfigData.AFSCP_BASE_URL === 'string' ? appConfigData.AFSCP_BASE_URL : '',
    'ASBCP AFSCP internal base URL must use the ASBCP env contract',
  );
  addMissingSecretEnvFailure(
    failures,
    container,
    'ASBCP_AFSCP_ORCHESTRATOR_TOKEN',
    expectedAppSecret,
    'AFSCP_ORCHESTRATOR_SERVICE_TOKEN',
    `ASBCP AFSCP orchestrator token must come from ${expectedAppSecret}/AFSCP_ORCHESTRATOR_SERVICE_TOKEN`,
  );
  addMissingEnvValueFailure(
    failures,
    container,
    'ASBCP_AFSCP_CALLER_SERVICE',
    ASBCP_SERVICE_ACCOUNT,
    'ASBCP AFSCP caller service must use the ASBCP env contract',
  );
  for (const forbiddenEnvName of [
    'AFSCP_BASE_URL',
    'AFSCP_INTERNAL_BASE_URL',
    'AFSCP_CALLER_SERVICE',
    'AFSCP_ACTOR_TYPE',
    'AFSCP_ACTOR_ID',
    'AFSCP_ORCHESTRATOR_CALLER_SERVICE',
    'AFSCP_ORCHESTRATOR_ACTOR_TYPE',
    'AFSCP_ORCHESTRATOR_ACTOR_ID',
    'AFSCP_ORCHESTRATOR_SERVICE_TOKEN',
    'JUICEFS_STORAGE_ENDPOINT',
    'JUICEFS_STORAGE_ACCESS_KEY',
    'JUICEFS_STORAGE_SECRET_KEY',
    'MINIO_ACCESS_KEY',
    'MINIO_SECRET_KEY',
  ]) {
    if (Object.prototype.hasOwnProperty.call(containerEnvEntry(container, forbiddenEnvName), 'name')) {
      addFailure(
        failures,
        `Deployment/${ASBCP_SERVICE_ACCOUNT}`,
        `ASBCP must not use deprecated or raw storage env ${forbiddenEnvName}`,
      );
    }
  }
  addMissingSecretEnvFailure(
    failures,
    container,
    'ASBCP_SERVICE_KEYS',
    expectedAppSecret,
    'ASBCP_SERVICE_KEY',
    `ASBCP service keys must come from ${expectedAppSecret}/ASBCP_SERVICE_KEY`,
  );

  const volumeMounts = Array.isArray(container.volumeMounts) ? container.volumeMounts.map(asRecord) : [];
  const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asRecord) : [];
  if (!volumeMounts.some((mount) =>
    mount.name === 'config'
    && mount.mountPath === ASBCP_CONFIG_PATH
    && mount.subPath === 'config.yaml',
  )) {
    addFailure(failures, `Deployment/${ASBCP_SERVICE_ACCOUNT}`, 'ASBCP must mount config.yaml at the canonical asbcp-config.yaml path');
  }
  if (!volumes.some((volume) =>
    volume.name === 'config'
    && asRecord(volume.configMap).name === ASBCP_CONFIG_MAP,
  )) {
    addFailure(failures, `Deployment/${ASBCP_SERVICE_ACCOUNT}`, 'ASBCP must mount asbcp-config as config volume');
  }
}

function checkWebServerRouteEnv(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const routes = collectIngressRoutes(documents);
  if (routes.get('/api/public') !== 'agentsmith-web' || routes.get('/api/system') !== 'agentsmith-web') {
    return;
  }

  const web = deploymentContainer(documents, 'agentsmith-web', 'web');
  const envFrom = deploymentContainerEnvFrom(documents, 'agentsmith-web', 'web');
  if (envFrom.length > 0) {
    addFailure(failures, 'Deployment/agentsmith-web', 'web must use explicit env key projections instead of envFrom');
  }
  for (const key of [
    'NEXT_PUBLIC_API_BASE',
    'NEXT_PUBLIC_KEYCLOAK_URL',
    'NEXT_PUBLIC_KEYCLOAK_REALM',
    'NEXT_PUBLIC_KEYCLOAK_CLIENT_ID',
    'PUBLIC_KEYCLOAK_BASE_URL',
    'INTERNAL_KEYCLOAK_BASE_URL',
  ]) {
    const ref = containerConfigMapKeyRef(web, key);
    if (ref.name !== AGENTSMITH_APP_CONFIG_MAP || ref.key !== key) {
      addFailure(
        failures,
        'Deployment/agentsmith-web',
        `web must project ${key} from ${AGENTSMITH_APP_CONFIG_MAP}/${key}`,
      );
    }
  }
  for (const key of ['MONGO_URL', 'MONGO_DB_NAME']) {
    const ref = containerSecretKeyRef(web, key);
    const expectedAppSecret = appSecretName(documents);
    if (ref.name !== expectedAppSecret || ref.key !== key) {
      addFailure(
        failures,
        'Deployment/agentsmith-web',
        `web must project ${key} from ${expectedAppSecret}/${key}`,
      );
    }
  }
  const projectedKeys = projectedEnvNamesAndSourceKeys(documents, web);
  for (const forbiddenKey of [
    'ASBCP_INTERNAL_BASE_URL',
    'ASBCP_SERVICE_KEY',
    'DATABASE_URL',
    'REDIS_URL',
    'MINIO_ENDPOINT',
    'MINIO_PORT',
    'MINIO_USE_SSL',
    'MINIO_BUCKET',
    'MINIO_ACCESS_KEY',
    'MINIO_SECRET_KEY',
    'AFSCP_SERVICE_TOKEN',
    'AFSCP_BOOTSTRAP_SERVICE_TOKEN',
    'AFSCP_ORCHESTRATOR_SERVICE_TOKEN',
    'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN',
  ]) {
    if (projectedKeys.has(forbiddenKey)) {
      addFailure(failures, 'Deployment/agentsmith-web', `web must not project ${forbiddenKey}`);
    }
  }
}

export function checkRenderedOutput(
  renderedYaml: string,
  options: RenderedOutputCheckOptions = {},
): CheckResult {
  const parsed = parseKubernetesDocuments(renderedYaml);
  const failures = [...parsed.failures, ...checkApiSingleReplica(renderedYaml).failures];

  if (parsed.ok) {
    failures.push(...checkAddressTruth(renderedYaml).failures);
    checkRequiredResources(parsed.documents, failures);
    checkNoRenderedSecretPayloads(parsed.documents, failures);
    checkSubstrateBoundary(parsed.documents, failures);
    checkIngressRoutes(parsed.documents, failures);
    checkInternalServiceTypes(parsed.documents, failures);
    checkNamespacedAppBoundary(parsed.documents, failures);
    checkAsbcpWorkloadFactRbac(parsed.documents, failures);
    checkAppConfig(parsed.documents, failures);
    checkWebServerRouteEnv(parsed.documents, failures);
    checkRunnableAppWorkloads(parsed.documents, failures);
    checkLlmupContract(parsed.documents, failures);
    checkAfscpContract(parsed.documents, failures);
    checkAfscpPodTemplateOwnershipMarkers(parsed.documents, failures);
    checkSubstrateCaProjection(parsed.documents, failures);
    checkRolloutChecksumAnnotations(parsed.documents, failures);
    checkAsbcpContract(parsed.documents, failures, options);
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

export async function checkRenderedProfile(
  profile: UnifiedDeployProfile,
  options: RenderCheckOptions = {},
): Promise<CheckFailure[]> {
  const rendered = await renderUnifiedDeployFromFiles({
    profile,
    siteEnvPath: options.siteEnvPath,
    substrateTruthPath: options.substrateTruthPath,
    manifestPath: options.manifestPath,
    templatesRoot: options.templatesRoot,
  });
  return checkRenderedOutput(rendered.output, { profile }).failures.map((failure) => ({
    path: `${profile}:${failure.path}`,
    message: failure.message,
  }));
}

function parseRenderCheckProfile(value: string): RenderCheckProfile {
  if (value === 'all' || isUnifiedDeployProfile(value)) {
    return value;
  }

  throw new Error(`unknown --profile value: ${value}; expected ${RENDER_CHECK_PROFILE_EXPECTED}`);
}

function selectedRenderProfiles(profile: RenderCheckProfile | undefined): UnifiedDeployProfile[] {
  if (profile === undefined || profile === 'all') {
    return [...TARGET_PROFILES];
  }

  return [profile];
}

function parseCliOptions(argv: readonly string[]): RenderCheckOptions {
  const options: RenderCheckOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--profile') {
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.startsWith('--')) {
        throw new Error(`--profile requires a value; expected ${RENDER_CHECK_PROFILE_EXPECTED}`);
      }
      options.profile = parseRenderCheckProfile(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--profile=')) {
      options.profile = parseRenderCheckProfile(arg.slice('--profile='.length));
      continue;
    }
    if (arg.startsWith('--site-env=')) {
      options.siteEnvPath = arg.slice('--site-env='.length);
      continue;
    }
    if (arg.startsWith('--substrate-truth=')) {
      options.substrateTruthPath = arg.slice('--substrate-truth='.length);
      continue;
    }
    if (arg.startsWith('--manifest=')) {
      options.manifestPath = arg.slice('--manifest='.length);
      continue;
    }
    if (arg.startsWith('--templates-root=')) {
      options.templatesRoot = arg.slice('--templates-root='.length);
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const profiles = selectedRenderProfiles(options.profile);
  const profileFailures = (await Promise.all(
    profiles.map((profile) => checkRenderedProfile(profile, options)),
  )).flat();
  const failures = [
    ...checkApiProductionEntrypointScripts().failures,
    ...profileFailures,
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

  process.stdout.write(`[unified-deploy] render check passed for ${profiles.join(', ')}\n[unified-deploy] evidence: ${evidence.paths.report_path}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
