import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TARGET_PROFILES, asRecord, type CheckFailure, type CheckResult, type UnifiedDeployProfile } from './manifest';
import {
  parseKubernetesDocuments,
  resourceKind,
  resourceName,
} from './kubernetes';
import { endpointSliceAddressTypeForHost, renderUnifiedDeployFromFiles } from './render';
import {
  SUBSTRATE_NATIVE_PORTS,
  substrateKeycloakInternalBaseUrl,
  substrateServiceName,
} from './substrate-address-roles';
import {
  writeProducerEvidence,
  type UnifiedDeployEvidence,
  type UnifiedDeployEvidenceStatus,
} from './evidence';

const APP_CONFIG = 'ConfigMap/agentsmith-app-config';
const APP_SECRET = 'Secret/agentsmith-app-secrets';
const INGRESS = 'Ingress/agentsmith';
const LLMUP_BASE_URL = 'http://agentsmith-llmup:8080';
const ASBCP_INTERNAL_BASE_URL = 'http://agentsmith-sandbox-control-plane:8080';
const INTERNAL_API_HTTP_BASE = 'http://agentsmith-api:20000/api/v1';
const INTERNAL_API_WS_BASE = 'ws://agentsmith-api:20000';
const SUBSTRATE_SERVICES = ['postgresql', 'mongodb', 'redis', 'minio', 'keycloak'] as const;

type IngressRoute = {
  serviceName: string;
  port?: number;
};

type AddressTruthRenderOptions = {
  siteEnvPath?: string;
  substrateTruthPath?: string;
  manifestPath?: string;
  templatesRoot?: string;
};

type RenderProfile = (
  profile: UnifiedDeployProfile,
  options: AddressTruthRenderOptions,
) => Promise<string>;

type AddressTruthProducerOptions = AddressTruthRenderOptions & {
  profiles?: readonly UnifiedDeployProfile[];
  evidenceDir?: string;
  renderProfile?: RenderProfile;
};

type AddressTruthProducerResult = {
  status: UnifiedDeployEvidenceStatus;
  failures: CheckFailure[];
  evidence: UnifiedDeployEvidence;
};

function addFailure(failures: CheckFailure[], failurePath: string, message: string): void {
  failures.push({ path: failurePath, message });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function collectSecret(documents: readonly Record<string, unknown>[]): Record<string, unknown> {
  return asRecord(findResource(documents, 'Secret', 'agentsmith-app-secrets').stringData);
}

function collectIngressRoutes(documents: readonly Record<string, unknown>[]): Map<string, IngressRoute> {
  const routes = new Map<string, IngressRoute>();

  for (const document of documents) {
    if (resourceKind(document) !== 'Ingress') {
      continue;
    }
    const rules = Array.isArray(asRecord(document.spec).rules) ? asRecord(document.spec).rules as unknown[] : [];
    for (const rule of rules) {
      const paths = Array.isArray(asRecord(asRecord(rule).http).paths)
        ? asRecord(asRecord(rule).http).paths as unknown[]
        : [];
      for (const pathEntry of paths) {
        const pathRecord = asRecord(pathEntry);
        const routePath = typeof pathRecord.path === 'string' ? pathRecord.path : '';
        const service = asRecord(asRecord(pathRecord.backend).service);
        const port = asRecord(service.port).number;
        if (routePath && typeof service.name === 'string') {
          routes.set(routePath, {
            serviceName: service.name,
            port: typeof port === 'number' ? port : undefined,
          });
        }
      }
    }
  }

  return routes;
}

function collectServicePorts(documents: readonly Record<string, unknown>[], serviceName: string): number[] {
  const service = findResource(documents, 'Service', serviceName);
  const ports = Array.isArray(asRecord(service.spec).ports) ? asRecord(service.spec).ports as unknown[] : [];
  return ports
    .map(asRecord)
    .map((port) => port.port)
    .filter((port): port is number => typeof port === 'number');
}

function collectEndpointSlicePorts(documents: readonly Record<string, unknown>[], endpointSliceName: string): number[] {
  const endpointSlice = findResource(documents, 'EndpointSlice', endpointSliceName);
  const ports = Array.isArray(endpointSlice.ports) ? endpointSlice.ports as unknown[] : [];
  return ports
    .map(asRecord)
    .map((port) => port.port)
    .filter((port): port is number => typeof port === 'number');
}

function resourceNamespace(resource: Record<string, unknown>): string {
  const namespace = asRecord(resource.metadata).namespace;
  return typeof namespace === 'string' && namespace.trim() ? namespace.trim() : 'agentsmith';
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function requireConfigValue(
  failures: CheckFailure[],
  config: Record<string, unknown>,
  key: string,
  expected: string,
): void {
  const actual = stringValue(config, key);
  if (actual !== expected) {
    addFailure(failures, APP_CONFIG, `${key} must be ${expected}`);
  }
}

function requireSecretValue(
  failures: CheckFailure[],
  secret: Record<string, unknown>,
  key: string,
): void {
  const actual = stringValue(secret, key);
  if (!actual) {
    addFailure(failures, APP_SECRET, `${key} must be rendered in app Secret`);
  }
}

function requireSecretUrl(
  failures: CheckFailure[],
  secret: Record<string, unknown>,
  key: string,
  expectedHost: string,
  expectedPort: string,
): void {
  const actual = stringValue(secret, key);
  if (!actual) {
    addFailure(failures, APP_SECRET, `${key} must be rendered in app Secret`);
    return;
  }

  try {
    const parsed = new URL(actual);
    if (parsed.hostname !== expectedHost || parsed.port !== expectedPort) {
      addFailure(failures, APP_SECRET, `${key} must use ${expectedHost}:${expectedPort}`);
    }
  } catch {
    addFailure(failures, APP_SECRET, `${key} must be a valid URL`);
  }
}

function isApiV1HttpBase(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.pathname.replace(/\/+$/u, '') === '/api/v1';
  } catch {
    return false;
  }
}

function isInternalWsOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'ws:'
      && parsed.hostname === 'agentsmith-api'
      && parsed.port === '20000'
      && (parsed.pathname === '' || parsed.pathname === '/');
  } catch {
    return false;
  }
}

function checkIngressAddressTruth(
  documents: readonly Record<string, unknown>[],
  failures: CheckFailure[],
): void {
  const routes = collectIngressRoutes(documents);
  const apiRoute = routes.get('/api/v1');
  if (apiRoute?.serviceName !== 'agentsmith-api' || apiRoute.port !== 20000) {
    addFailure(failures, INGRESS, '/api/v1 must route to agentsmith-api:20000');
  }
  for (const [route, backend] of routes) {
    if (backend.serviceName === 'agentsmith-llmup' || backend.serviceName === 'agentsmith-sandbox-control-plane') {
      addFailure(failures, INGRESS, `${backend.serviceName} must not be exposed through ingress (${route})`);
    }
  }
}

function checkInternalServices(
  documents: readonly Record<string, unknown>[],
  failures: CheckFailure[],
): void {
  if (!collectServicePorts(documents, 'agentsmith-api').includes(20000)) {
    addFailure(failures, 'Service/agentsmith-api', 'agentsmith-api Service must expose port 20000');
  }
  if (!collectServicePorts(documents, 'agentsmith-llmup').includes(8080)) {
    addFailure(failures, 'Service/agentsmith-llmup', 'agentsmith-llmup Service must expose internal port 8080');
  }
  if (!collectServicePorts(documents, 'agentsmith-sandbox-control-plane').includes(8080)) {
    addFailure(failures, 'Service/agentsmith-sandbox-control-plane', 'agentsmith-sandbox-control-plane Service must expose internal port 8080');
  }
  for (const service of SUBSTRATE_SERVICES) {
    const serviceName = substrateServiceName(service);
    const nativePort = Number(SUBSTRATE_NATIVE_PORTS[service]);
    if (!collectServicePorts(documents, serviceName).includes(nativePort)) {
      addFailure(failures, `Service/${serviceName}`, `${serviceName} Service must expose native port ${nativePort}`);
    }
    if (collectEndpointSlicePorts(documents, serviceName).length === 0) {
      addFailure(failures, `EndpointSlice/${serviceName}`, `${serviceName} EndpointSlice must render the Docker substrate target port`);
    }
  }
}

function checkSubstrateEndpointAddressTypes(
  documents: readonly Record<string, unknown>[],
  failures: CheckFailure[],
): void {
  for (const document of documents) {
    if (resourceKind(document) !== 'EndpointSlice' || !resourceName(document).startsWith('substrate-')) {
      continue;
    }
    const endpointSliceName = resourceName(document);
    const addressType = stringValue(document, 'addressType');
    const endpoints = Array.isArray(document.endpoints) ? document.endpoints : [];
    const addresses = endpoints
      .flatMap((endpoint) => {
        const endpointAddresses = asRecord(endpoint).addresses;
        return Array.isArray(endpointAddresses) ? endpointAddresses : [];
      })
      .filter((address): address is string => typeof address === 'string');

    if (addresses.length === 0) {
      addFailure(failures, `EndpointSlice/${endpointSliceName}`, `${endpointSliceName} must render at least one substrate address`);
      continue;
    }

    for (const address of addresses) {
      const expectedAddressType = endpointSliceAddressTypeForHost(address);
      if (expectedAddressType === 'FQDN' || addressType === 'FQDN') {
        addFailure(
          failures,
          `EndpointSlice/${endpointSliceName}`,
          'FQDN substrate EndpointSlice is not supported in v1; provide a routable IPv4/IPv6 substrate host',
        );
        continue;
      }
      if (addressType !== expectedAddressType) {
        addFailure(
          failures,
          `EndpointSlice/${endpointSliceName}`,
          `${endpointSliceName} addressType must be ${expectedAddressType} for substrate address ${address}`,
        );
      }
    }
  }
}

function checkConfigAddressTruth(config: Record<string, unknown>, failures: CheckFailure[], namespace: string): void {
  const publicApiBase = stringValue(config, 'PUBLIC_API_BASE_URL');
  if (!isApiV1HttpBase(publicApiBase)) {
    addFailure(failures, APP_CONFIG, 'PUBLIC_API_BASE_URL must be an http(s) /api/v1 API base');
  }

  requireConfigValue(failures, config, 'INTERNAL_API_BASE_URL', INTERNAL_API_HTTP_BASE);
  requireConfigValue(failures, config, 'AGENT_EXECUTION_HTTP_BASE_URL', INTERNAL_API_HTTP_BASE);
  requireConfigValue(failures, config, 'ASBCP_INTERNAL_BASE_URL', ASBCP_INTERNAL_BASE_URL);
  requireConfigValue(failures, config, 'MBOS_UNIVERSAL_PROXY_BASE_URL', LLMUP_BASE_URL);
  requireConfigValue(failures, config, 'LLMUP_INTERNAL_BASE_URL', LLMUP_BASE_URL);
  requireConfigValue(failures, config, 'INTERNAL_KEYCLOAK_BASE_URL', substrateKeycloakInternalBaseUrl());
  requireConfigValue(failures, config, 'MINIO_ENDPOINT', substrateServiceName('minio'));
  requireConfigValue(failures, config, 'MINIO_PORT', SUBSTRATE_NATIVE_PORTS.minio);

  const wsBase = stringValue(config, 'AGENT_EXECUTION_WS_BASE_URL');
  if (!isInternalWsOrigin(wsBase)) {
    addFailure(failures, APP_CONFIG, `AGENT_EXECUTION_WS_BASE_URL must be ${INTERNAL_API_WS_BASE}`);
  }
  const agentExecutionWsUrl = `${wsBase.replace(/\/+$/u, '')}/api/v1/agent-execution/ws`;
  if (agentExecutionWsUrl !== `${INTERNAL_API_WS_BASE}/api/v1/agent-execution/ws`) {
    addFailure(failures, APP_CONFIG, 'AGENT_EXECUTION_WS_BASE_URL must generate /api/v1/agent-execution/ws on agentsmith-api');
  }

  if (Object.prototype.hasOwnProperty.call(config, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN')) {
    addFailure(failures, APP_CONFIG, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN must be in app Secret, not ConfigMap');
  }
}

function checkSecretAddressTruth(secret: Record<string, unknown>, failures: CheckFailure[]): void {
  requireSecretValue(failures, secret, 'ASBCP_SERVICE_KEY');
  requireSecretValue(failures, secret, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
  requireSecretUrl(failures, secret, 'DATABASE_URL', 'substrate-postgresql', SUBSTRATE_NATIVE_PORTS.postgresql);
  requireSecretUrl(failures, secret, 'MONGO_URL', 'substrate-mongodb', SUBSTRATE_NATIVE_PORTS.mongodb);
  requireSecretUrl(failures, secret, 'REDIS_URL', 'substrate-redis', SUBSTRATE_NATIVE_PORTS.redis);
}

export function checkAddressTruth(renderedYaml: string): CheckResult {
  const parsed = parseKubernetesDocuments(renderedYaml);
  const failures = [...parsed.failures];

  if (parsed.ok) {
    const configResource = findResource(parsed.documents, 'ConfigMap', 'agentsmith-app-config');
    const config = asRecord(configResource.data);
    const secret = collectSecret(parsed.documents);
    checkConfigAddressTruth(config, failures, resourceNamespace(configResource));
    checkSecretAddressTruth(secret, failures);
    checkIngressAddressTruth(parsed.documents, failures);
    checkInternalServices(parsed.documents, failures);
    checkSubstrateEndpointAddressTypes(parsed.documents, failures);
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

const defaultRenderProfile: RenderProfile = async (profile, options) => {
  const rendered = await renderUnifiedDeployFromFiles({
    profile,
    siteEnvPath: options.siteEnvPath,
    substrateTruthPath: options.substrateTruthPath,
    manifestPath: options.manifestPath,
    templatesRoot: options.templatesRoot,
  });

  return rendered.output;
};

async function checkRenderedProfile(
  profile: UnifiedDeployProfile,
  renderProfile: RenderProfile,
  renderOptions: AddressTruthRenderOptions,
): Promise<CheckFailure[]> {
  try {
    const renderedYaml = await renderProfile(profile, renderOptions);
    return checkAddressTruth(renderedYaml).failures.map((failure) => ({
      path: `${profile}:${failure.path}`,
      message: failure.message,
    }));
  } catch (error: unknown) {
    return [{
      path: `${profile}:render`,
      message: `address truth render failed: ${errorMessage(error)}`,
    }];
  }
}

export async function runAddressTruthProducer(
  options: AddressTruthProducerOptions = {},
): Promise<AddressTruthProducerResult> {
  const renderOptions: AddressTruthRenderOptions = {
    siteEnvPath: options.siteEnvPath,
    substrateTruthPath: options.substrateTruthPath,
    manifestPath: options.manifestPath,
    templatesRoot: options.templatesRoot,
  };
  const renderProfile = options.renderProfile ?? defaultRenderProfile;
  const profiles = options.profiles ?? TARGET_PROFILES;
  const failures = (
    await Promise.all(profiles.map((profile) => checkRenderedProfile(profile, renderProfile, renderOptions)))
  ).flat();
  const status: UnifiedDeployEvidenceStatus = failures.length > 0 ? 'failed' : 'passed';
  const evidence = await writeProducerEvidence({
    producer: 'address-truth',
    status,
    failures,
    evidenceDir: options.evidenceDir,
  });

  return {
    status,
    failures,
    evidence,
  };
}

async function main(): Promise<void> {
  const result = await runAddressTruthProducer();
  const failures = result.failures;

  if (failures.length > 0) {
    process.stderr.write(`${failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n')}\n`);
    process.stderr.write(`[unified-deploy] evidence: ${result.evidence.paths.report_path}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`[unified-deploy] address truth check passed for local-kind, existing-cluster\n[unified-deploy] evidence: ${result.evidence.paths.report_path}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
