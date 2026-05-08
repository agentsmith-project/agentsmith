import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOCKER_SUBSTRATE_REQUIRED_ENV } from './substrate-truth';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_MANIFEST_PATH = path.join(
  REPO_ROOT,
  'infra',
  'deploy',
  'unified',
  'deployment.manifest.json',
);

export const TARGET_PROFILES = ['local-kind', 'existing-cluster'] as const;
export type UnifiedDeployProfile = typeof TARGET_PROFILES[number];

const REQUIRED_SUBSTRATE_SERVICES = ['postgresql', 'mongodb', 'redis', 'minio', 'keycloak'] as const;
const REQUIRED_SUBSTRATE_ENV = DOCKER_SUBSTRATE_REQUIRED_ENV;
const REQUIRED_APP_COMPONENTS = ['web', 'api', 'llmup', 'sandbox-manager', 'managed-runner-support'] as const;
const REQUIRED_ROUTES = [
  { path: '/api/v1', service: 'api' },
  { path: '/api/public', service: 'web' },
  { path: '/api/system', service: 'web' },
  { path: '/', service: 'web' },
] as const;
const REQUIRED_AUTOSCALER_FORBIDS = ['HorizontalPodAutoscaler', 'ScaledObject', 'ScaledJob'] as const;

export type CheckFailure = {
  path: string;
  message: string;
};

export type CheckResult = {
  ok: boolean;
  failures: CheckFailure[];
};

export type ManifestOptions = {
  rootDir?: string;
  manifestPath?: string;
};

export type ManifestTemplateGroup = 'app' | 'local_kind_admin_preflight';

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function isUnifiedDeployProfile(value: string): value is UnifiedDeployProfile {
  return TARGET_PROFILES.includes(value as UnifiedDeployProfile);
}

export function resolveManifestPath(options: ManifestOptions = {}): string {
  if (options.manifestPath) {
    return path.isAbsolute(options.manifestPath)
      ? options.manifestPath
      : path.resolve(options.rootDir ?? REPO_ROOT, options.manifestPath);
  }

  return path.join(options.rootDir ?? REPO_ROOT, 'infra', 'deploy', 'unified', 'deployment.manifest.json');
}

function addFailure(failures: CheckFailure[], message: string, failurePath = 'infra/deploy/unified/deployment.manifest.json'): void {
  failures.push({ path: failurePath, message });
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  return sorted(actual).join('\n') === sorted(expected).join('\n');
}

function includesCaseSensitive(values: readonly string[], expected: string): boolean {
  return values.includes(expected);
}

function readManifestJson(manifestPath: string, failures: CheckFailure[]): unknown {
  if (!existsSync(manifestPath)) {
    addFailure(failures, 'unified deploy manifest must exist');
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse error';
    addFailure(failures, `unified deploy manifest must be valid JSON: ${message}`);
    return undefined;
  }
}

function checkProfiles(manifest: Record<string, unknown>, failures: CheckFailure[]): void {
  const profiles = Object.keys(asRecord(manifest.profiles));
  if (!sameSet(profiles, TARGET_PROFILES)) {
    addFailure(failures, 'profiles must be exactly local-kind and existing-cluster');
  }
}

function checkSubstrate(manifest: Record<string, unknown>, failures: CheckFailure[]): void {
  const substrate = asRecord(manifest.substrate);
  if (substrate.implementation !== 'docker-only') {
    addFailure(failures, 'substrate implementation must be docker-only');
  }

  const services = asStringArray(substrate.services);
  if (!sameSet(services, REQUIRED_SUBSTRATE_SERVICES)) {
    addFailure(failures, 'substrate services must be exactly postgresql, mongodb, redis, minio, keycloak');
  }

  for (const forbiddenService of ['llmup', 'universal-proxy']) {
    if (services.includes(forbiddenService)) {
      addFailure(failures, `substrate must not include ${forbiddenService}`);
    }
  }

  const truthSchema = asRecord(substrate.truth_schema);
  if (truthSchema.version !== 'agentsmith.docker-substrate.truth/v1') {
    addFailure(failures, 'substrate truth_schema.version must be agentsmith.docker-substrate.truth/v1');
  }

  const requiredEnv = asStringArray(truthSchema.required_env);
  if (!sameSet(requiredEnv, REQUIRED_SUBSTRATE_ENV)) {
    addFailure(failures, 'substrate truth_schema.required_env must declare the Docker substrate handoff keys');
  }
  for (const forbiddenEnv of ['LLMUP_BASE_URL', 'UNIVERSAL_PROXY_BASE_URL', 'MBOS_UNIVERSAL_PROXY_BASE_URL']) {
    if (requiredEnv.includes(forbiddenEnv)) {
      addFailure(failures, `substrate truth schema must not include ${forbiddenEnv}`);
    }
  }
}

function checkApp(manifest: Record<string, unknown>, failures: CheckFailure[]): void {
  const components = asRecord(asRecord(manifest.app).components);
  const componentNames = Object.keys(components);
  if (!sameSet(componentNames, REQUIRED_APP_COMPONENTS)) {
    addFailure(failures, 'app components must be exactly web, api, llmup, sandbox-manager, managed-runner-support');
  }

  if (componentNames.includes('execution-gateway')) {
    addFailure(failures, 'manifest must not declare execution-gateway');
  }

  const api = asRecord(components.api);
  if (api.replicas !== 1) {
    addFailure(failures, 'api component must declare replicas=1');
  }
  if (api.operator_replicas_setting !== false && api.operator_replicas_setting !== undefined) {
    addFailure(failures, 'api must not expose an operator replicas setting');
  }
}

function checkIngress(manifest: Record<string, unknown>, failures: CheckFailure[]): void {
  const ingress = asRecord(manifest.ingress);
  const routes = Array.isArray(ingress.routes) ? ingress.routes.map(asRecord) : [];

  for (const requiredRoute of REQUIRED_ROUTES) {
    const match = routes.some((route) => route.path === requiredRoute.path && route.service === requiredRoute.service);
    if (!match) {
      addFailure(failures, `${requiredRoute.path} must route to ${requiredRoute.service}`);
    }
  }

  for (const route of routes) {
    if (route.service === 'execution-gateway') {
      addFailure(failures, 'manifest must not declare execution-gateway');
    }
    if (route.service === 'llmup') {
      addFailure(failures, 'llmup must be internal only');
    }
  }

  const internalOnly = asStringArray(ingress.internal_only_services);
  if (!includesCaseSensitive(internalOnly, 'llmup')) {
    addFailure(failures, 'llmup must be internal only');
  }
}

function checkGuards(manifest: Record<string, unknown>, failures: CheckFailure[]): void {
  const guards = asRecord(manifest.guards);
  const guardApi = asRecord(guards.api);
  if (guardApi.replicas !== 1) {
    addFailure(failures, 'guards must require api replicas=1');
  }
  if (guardApi.operator_replicas_setting !== false) {
    addFailure(failures, 'guards must reject an api operator replicas setting');
  }

  const forbiddenEnv = asStringArray(guards.forbidden_env);
  if (!forbiddenEnv.includes('API_REPLICAS')) {
    addFailure(failures, 'guards must forbid API_REPLICAS');
  }

  const forbiddenResources = asStringArray(guards.forbidden_resource_names);
  if (!forbiddenResources.includes('execution-gateway')) {
    addFailure(failures, 'guards must forbid execution-gateway resources');
  }

  const forbiddenAutoscalers = asStringArray(guards.forbidden_autoscaler_kinds);
  for (const autoscalerKind of REQUIRED_AUTOSCALER_FORBIDS) {
    if (!forbiddenAutoscalers.includes(autoscalerKind)) {
      addFailure(failures, `guards must forbid ${autoscalerKind}`);
    }
  }
}

function checkTemplates(manifest: Record<string, unknown>, options: ManifestOptions, failures: CheckFailure[]): void {
  const templates = asRecord(manifest.templates);
  const templatePaths = asStringArray(templates.app);
  if (templatePaths.length === 0) {
    addFailure(failures, 'manifest must list app templates');
  }

  const rootDir = options.rootDir ?? REPO_ROOT;
  for (const templatePath of templatePaths) {
    const absoluteTemplatePath = path.resolve(rootDir, 'infra', 'deploy', 'unified', templatePath);
    if (templatePath.includes('namespace')) {
      addFailure(failures, 'app templates must not include Namespace resources');
    }
    if (!existsSync(absoluteTemplatePath)) {
      addFailure(failures, `template must exist: ${templatePath}`);
      continue;
    }
    const templateText = readFileSync(absoluteTemplatePath, 'utf8');
    if (/\bkind:\s*Namespace\b/u.test(templateText)) {
      addFailure(failures, 'app templates must not include Namespace resources');
    }
    if (/\bkind:\s*ClusterRole(?:Binding)?\b/u.test(templateText)) {
      addFailure(failures, 'app templates must not include cluster-scoped RBAC resources');
    }
    if (/\bpersistentvolumes\b/u.test(templateText)) {
      addFailure(failures, 'app templates must not include persistentvolumes cluster permissions');
    }
  }

  const preflightTemplatePaths = asStringArray(templates.local_kind_admin_preflight);
  if (preflightTemplatePaths.length === 0) {
    addFailure(failures, 'manifest must list local-kind admin preflight templates');
  }

  for (const templatePath of preflightTemplatePaths) {
    const absoluteTemplatePath = path.resolve(rootDir, 'infra', 'deploy', 'unified', templatePath);
    if (!existsSync(absoluteTemplatePath)) {
      addFailure(failures, `template must exist: ${templatePath}`);
    }
  }
}

export function checkUnifiedDeployManifest(options: ManifestOptions = {}): CheckResult {
  const failures: CheckFailure[] = [];
  const rawManifest = readManifestJson(resolveManifestPath(options), failures);
  const manifest = asRecord(rawManifest);

  if (rawManifest === undefined) {
    return { ok: false, failures };
  }

  if (manifest.schema_version !== 'agentsmith.unified-deploy.manifest/v1') {
    addFailure(failures, 'schema_version must be agentsmith.unified-deploy.manifest/v1');
  }
  if (manifest.deploy_model !== 'AgentSmith deploy') {
    addFailure(failures, 'deploy_model must be AgentSmith deploy');
  }

  checkProfiles(manifest, failures);
  checkSubstrate(manifest, failures);
  checkApp(manifest, failures);
  checkIngress(manifest, failures);
  checkGuards(manifest, failures);
  checkTemplates(manifest, options, failures);

  return {
    ok: failures.length === 0,
    failures,
  };
}

export function assertManifestValid(options: ManifestOptions = {}): void {
  const result = checkUnifiedDeployManifest(options);
  if (!result.ok) {
    throw new Error(result.failures.map((failure) => failure.message).join('\n'));
  }
}

export function loadUnifiedDeployManifest(options: ManifestOptions = {}): Record<string, unknown> {
  assertManifestValid(options);
  const manifestPath = resolveManifestPath(options);
  return asRecord(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown);
}

export function manifestTemplatePaths(
  manifest: Record<string, unknown>,
  group: ManifestTemplateGroup = 'app',
): string[] {
  return asStringArray(asRecord(manifest.templates)[group]);
}

export function manifestRequiredEnv(manifest: Record<string, unknown>): string[] {
  return asStringArray(asRecord(asRecord(manifest.substrate).truth_schema).required_env);
}
