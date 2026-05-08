import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
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
  templatesRoot?: string;
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

export function isPathAtOrUnderRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function isSafeRelativePath(candidatePath: string): boolean {
  if (candidatePath.trim() !== candidatePath || candidatePath.length === 0) {
    return false;
  }
  if (path.isAbsolute(candidatePath) || candidatePath.includes('\\')) {
    return false;
  }

  return candidatePath.split('/').every((segment) =>
    segment.length > 0 && segment !== '.' && segment !== '..',
  );
}

export function resolveContainedTemplatePath(templatesRoot: string, templatePath: string): string {
  if (!isSafeRelativePath(templatePath)) {
    throw new Error(`template path must be a safe relative template path: ${templatePath}`);
  }

  const absoluteTemplatesRoot = path.resolve(templatesRoot);
  const absoluteTemplatePath = path.resolve(absoluteTemplatesRoot, templatePath);
  let realTemplatesRoot: string;
  let realTemplatePath: string;

  try {
    realTemplatesRoot = realpathSync(absoluteTemplatesRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown realpath error';
    throw new Error(`templates root must exist: ${absoluteTemplatesRoot}: ${message}`);
  }

  try {
    realTemplatePath = realpathSync(absoluteTemplatePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown realpath error';
    throw new Error(`template must exist: ${templatePath}: ${message}`);
  }

  if (!isPathAtOrUnderRoot(realTemplatesRoot, realTemplatePath)) {
    throw new Error(`template path must stay under templates root: ${templatePath}`);
  }

  return absoluteTemplatePath;
}

type EvidenceDirEnv = Record<string, string | undefined>;

export type PrepareUnifiedDeployEvidenceDirOptions = {
  evidenceDir: string;
  defaultRoot: string;
  env?: EvidenceDirEnv;
  label?: string;
};

type EvidenceRootCandidate = {
  root: string;
  anchor: string;
};

function nonEmptyEnvPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function releaseEvidenceRoots(env: EvidenceDirEnv): EvidenceRootCandidate[] {
  const roots: EvidenceRootCandidate[] = [];
  const explicitReleaseRoot = nonEmptyEnvPath(env.UNIFIED_DEPLOY_RELEASE_ROOT_DIR);
  const campaignRoot = nonEmptyEnvPath(env.RELEASE_CAMPAIGN_ROOT);

  if (explicitReleaseRoot) {
    const releaseRoot = path.resolve(explicitReleaseRoot);
    const anchorPath = campaignRoot ? path.resolve(campaignRoot) : releaseRoot;
    roots.push({ root: releaseRoot, anchor: symlinkInspectionAnchorFor(anchorPath) });
  }
  if (campaignRoot) {
    const releaseRoot = path.resolve(campaignRoot, 'unified-deploy');
    roots.push({ root: releaseRoot, anchor: symlinkInspectionAnchorFor(path.resolve(campaignRoot)) });
  }

  return roots;
}

function symlinkInspectionAnchorFor(targetPath: string): string {
  const absoluteTarget = path.resolve(targetPath);
  const cwd = path.resolve(process.cwd());
  if (isPathAtOrUnderRoot(REPO_ROOT, absoluteTarget)) {
    return REPO_ROOT;
  }
  if (isPathAtOrUnderRoot(cwd, absoluteTarget)) {
    return cwd;
  }
  return absoluteTarget;
}

function expectedEvidenceRoot(
  evidenceDir: string,
  defaultRoot: string,
  env: EvidenceDirEnv,
  label: string,
): EvidenceRootCandidate {
  const absoluteEvidenceDir = path.resolve(evidenceDir);
  const releaseRoots = releaseEvidenceRoots(env);
  const matchingReleaseRoot = releaseRoots.find((candidate) =>
    isPathAtOrUnderRoot(candidate.root, absoluteEvidenceDir),
  );
  if (matchingReleaseRoot) {
    return matchingReleaseRoot;
  }
  if (releaseRoots.length > 0) {
    throw new Error(`${label} must stay under unified deploy release evidence root: ${absoluteEvidenceDir}`);
  }

  const absoluteDefaultRoot = path.resolve(defaultRoot);
  if (isPathAtOrUnderRoot(absoluteDefaultRoot, absoluteEvidenceDir)) {
    return { root: absoluteDefaultRoot, anchor: symlinkInspectionAnchorFor(absoluteDefaultRoot) };
  }

  return { root: absoluteEvidenceDir, anchor: absoluteEvidenceDir };
}

function directoryStatIfExists(targetPath: string, label: string): ReturnType<typeof lstatSync> | null {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(targetPath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${targetPath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} must be a directory: ${targetPath}`);
  }
  return stat;
}

function assertDirectoryIsNotSymlinkIfExists(targetPath: string, label: string): void {
  directoryStatIfExists(targetPath, label);
}

function assertEvidencePathHasNoSymlinkSegments(rootPath: string, targetPath: string, label: string): void {
  const absoluteRoot = path.resolve(rootPath);
  const absoluteTarget = path.resolve(targetPath);
  if (!isPathAtOrUnderRoot(absoluteRoot, absoluteTarget)) {
    throw new Error(`${label} must stay under expected evidence root: ${absoluteTarget}`);
  }

  assertDirectoryIsNotSymlinkIfExists(absoluteRoot, `${label} root`);
  const relativePath = path.relative(absoluteRoot, absoluteTarget);
  if (relativePath === '') {
    assertDirectoryIsNotSymlinkIfExists(absoluteTarget, label);
    return;
  }

  let currentPath = absoluteRoot;
  for (const segment of relativePath.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    if (!directoryStatIfExists(currentPath, label)) {
      return;
    }
  }
}

export function prepareUnifiedDeployEvidenceDir(options: PrepareUnifiedDeployEvidenceDirOptions): string {
  const label = options.label ?? 'unified deploy evidenceDir';
  const env = options.env ?? process.env;
  const absoluteEvidenceDir = path.resolve(options.evidenceDir);
  const expectedRoot = expectedEvidenceRoot(
    absoluteEvidenceDir,
    options.defaultRoot,
    env,
    label,
  );

  assertEvidencePathHasNoSymlinkSegments(expectedRoot.anchor, absoluteEvidenceDir, label);
  mkdirSync(absoluteEvidenceDir, { recursive: true });
  assertEvidencePathHasNoSymlinkSegments(expectedRoot.anchor, absoluteEvidenceDir, label);

  const realEvidenceRoot = realpathSync(expectedRoot.root);
  const realEvidenceDir = realpathSync(absoluteEvidenceDir);
  if (!isPathAtOrUnderRoot(realEvidenceRoot, realEvidenceDir)) {
    throw new Error(`${label} realpath must stay under expected evidence root: ${absoluteEvidenceDir}`);
  }

  return absoluteEvidenceDir;
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
  const templatesRoot = options.templatesRoot ?? path.join(rootDir, 'infra', 'deploy', 'unified');
  for (const templatePath of templatePaths) {
    if (templatePath.includes('namespace')) {
      addFailure(failures, 'app templates must not include Namespace resources');
    }
    let absoluteTemplatePath: string;
    try {
      absoluteTemplatePath = resolveContainedTemplatePath(templatesRoot, templatePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown template path error';
      addFailure(failures, message);
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
    try {
      resolveContainedTemplatePath(templatesRoot, templatePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown template path error';
      addFailure(failures, message);
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
