import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MANIFEST_PATH,
  REPO_ROOT,
  TARGET_PROFILES,
  assertManifestValid,
  asRecord,
  isUnifiedDeployProfile,
  loadUnifiedDeployManifest,
  manifestRequiredEnv,
  manifestTemplatePaths,
  resolveContainedTemplatePath,
  type UnifiedDeployProfile,
} from './manifest';
import {
  DEFAULT_SUBSTRATE_TRUTH_PATH,
  parseSubstrateTruth,
} from './substrate-truth';
import {
  SUBSTRATE_NATIVE_PORTS,
  substrateKeycloakInternalBaseUrl,
  substrateMinioInternalMountEndpoint,
  substrateServiceFqdn,
} from './substrate-address-roles';
import { parseKubernetesDocuments, resourceKind, resourceName } from './kubernetes';

export const DEFAULT_SITE_ENV_PATH = path.join(REPO_ROOT, 'infra', 'deploy', 'unified', 'env', 'site.env.example');
export const DEFAULT_TEMPLATES_ROOT = path.join(REPO_ROOT, 'infra', 'deploy', 'unified');

type RenderUnifiedDeployOptions = {
  profile?: UnifiedDeployProfile;
  siteEnv?: string;
  siteEnvPath?: string;
  substrateTruth?: string;
  substrateTruthPath?: string;
  manifestPath?: string;
  templatesRoot?: string;
  templateGroup?: 'app' | 'local_kind_admin_preflight';
};

type RenderUnifiedDeployFromFilesOptions = Omit<RenderUnifiedDeployOptions, 'siteEnv'>;

type RenderedUnifiedDeploy = {
  profile: UnifiedDeployProfile;
  output: string;
  manifestPath: string;
  siteEnvPath: string;
  substrateTruthPath: string;
  templatePaths: string[];
};

type RenderContext = Record<string, string>;
export type EndpointSliceAddressType = 'IPv4' | 'IPv6' | 'FQDN';
type RolloutChecksumKey =
  | 'AGENTSMITH_APP_CONFIG_CHECKSUM'
  | 'AGENTSMITH_APP_SECRETS_CHECKSUM'
  | 'AGENTSMITH_LLMUP_CONFIG_CHECKSUM'
  | 'SANDBOX_MANAGER_CONFIG_CHECKSUM'
  | 'AFSCP_RUNTIME_CONFIG_CHECKSUM'
  | 'AFSCP_RUNTIME_SECRETS_CHECKSUM';

const REQUIRED_DEPLOY_ENV = [
  'NAMESPACE',
  'INGRESS_CLASS_NAME',
  'PUBLIC_BASE_URL',
  'PUBLIC_API_BASE_URL',
  'RUNNER_PUBLIC_API_BASE_URL',
  'SANDBOX_SERVICE_KEY',
  'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN',
  'WEB_IMAGE',
  'API_IMAGE',
  'LLMUP_IMAGE',
  'AFSCP_IMAGE',
  'SANDBOX_MANAGER_IMAGE',
  'MANAGED_RUNNER_IMAGE',
  'INGRESS_NGINX_CONTROLLER_IMAGE',
  'INGRESS_NGINX_CERTGEN_IMAGE',
] as const;

const NUMERIC_ENV = new Set([
  'SUBSTRATE_POSTGRES_PORT',
  'SUBSTRATE_MONGODB_PORT',
  'SUBSTRATE_REDIS_PORT',
  'SUBSTRATE_MINIO_PORT',
  'SUBSTRATE_KEYCLOAK_PORT',
]);
const ROLLOUT_CHECKSUM_PLACEHOLDER = `sha256:${'0'.repeat(64)}`;

function resolvePath(targetPath: string | undefined, fallback: string): string {
  if (!targetPath) {
    return fallback;
  }
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(REPO_ROOT, targetPath);
}

export function parseSiteEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = source.split(/\r?\n/u);

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) {
      return;
    }

    const normalizedLine = trimmedLine.startsWith('export ') ? trimmedLine.slice('export '.length).trim() : trimmedLine;
    const separatorIndex = normalizedLine.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`invalid env line ${index + 1}: expected KEY=value`);
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    const rawValue = normalizedLine.slice(separatorIndex + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
      throw new Error(`invalid env key on line ${index + 1}: ${key}`);
    }

    const value = stripEnvQuotes(rawValue);
    if (value.includes('\n')) {
      throw new Error(`invalid env value for ${key}: multiline values are not supported`);
    }
    values[key] = value;
  });

  return values;
}

function stripEnvQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/gu, '"').replace(/\\\\/gu, '\\');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return value;
}

function validateEnv(values: Record<string, string>): void {
  if (Object.prototype.hasOwnProperty.call(values, 'API_REPLICAS')) {
    throw new Error('API_REPLICAS is not supported; api replicas are fixed to 1');
  }

  const missing = REQUIRED_DEPLOY_ENV.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`missing deploy env values: ${missing.join(', ')}`);
  }

  for (const key of NUMERIC_ENV) {
    const value = values[key];
    if (value !== undefined && !/^\d+$/u.test(value)) {
      throw new Error(`${key} must be numeric`);
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (value.includes('"')) {
      throw new Error(`${key} contains a double quote; template-safe env values are required`);
    }
  }
}

function resolveProfile(optionsProfile: UnifiedDeployProfile | undefined, envProfile: string | undefined): UnifiedDeployProfile {
  const rawProfile = optionsProfile ?? envProfile ?? 'local-kind';
  if (!isUnifiedDeployProfile(rawProfile)) {
    throw new Error(`unknown unified deploy profile: ${rawProfile}; expected ${TARGET_PROFILES.join(' or ')}`);
  }

  return rawProfile;
}

function deriveKeycloakPublicBaseUrl(publicIssuer: string, realm: string): string {
  const normalizedIssuer = publicIssuer.trim().replace(/\/+$/u, '');
  const normalizedRealm = realm.trim().replace(/^\/+|\/+$/gu, '');
  if (!normalizedIssuer || !normalizedRealm) {
    return normalizedIssuer;
  }

  const realmSuffix = `/realms/${normalizedRealm}`;
  if (normalizedIssuer.endsWith(realmSuffix)) {
    return normalizedIssuer.slice(0, -realmSuffix.length);
  }

  const realmsIndex = normalizedIssuer.indexOf('/realms/');
  return realmsIndex >= 0 ? normalizedIssuer.slice(0, realmsIndex) : normalizedIssuer;
}

export function endpointSliceAddressTypeForHost(host: string): EndpointSliceAddressType {
  const trimmed = host.trim();
  const unbracketed = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;
  const ipVersion = isIP(unbracketed);

  if (ipVersion === 4) {
    return 'IPv4';
  }
  if (ipVersion === 6) {
    return 'IPv6';
  }

  return 'FQDN';
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

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(sortJson(value))).digest('hex')}`;
}

function withRolloutChecksumPlaceholders(context: RenderContext): RenderContext {
  return {
    ...context,
    AGENTSMITH_APP_CONFIG_CHECKSUM: ROLLOUT_CHECKSUM_PLACEHOLDER,
    AGENTSMITH_APP_SECRETS_CHECKSUM: ROLLOUT_CHECKSUM_PLACEHOLDER,
    AGENTSMITH_LLMUP_CONFIG_CHECKSUM: ROLLOUT_CHECKSUM_PLACEHOLDER,
    SANDBOX_MANAGER_CONFIG_CHECKSUM: ROLLOUT_CHECKSUM_PLACEHOLDER,
    AFSCP_RUNTIME_CONFIG_CHECKSUM: ROLLOUT_CHECKSUM_PLACEHOLDER,
    AFSCP_RUNTIME_SECRETS_CHECKSUM: ROLLOUT_CHECKSUM_PLACEHOLDER,
  };
}

function resourceFieldChecksum(
  documents: readonly Record<string, unknown>[],
  kind: string,
  name: string,
  field: 'data' | 'stringData',
): string {
  const resource = documents.find((document) =>
    resourceKind(document) === kind && resourceName(document) === name,
  );
  if (!resource) {
    throw new Error(`${kind}/${name} must render before computing rollout checksums`);
  }

  return sha256(asRecord(resource[field]));
}

function computeRolloutChecksums(renderedYaml: string): Record<RolloutChecksumKey, string> {
  const parsed = parseKubernetesDocuments(renderedYaml);
  if (!parsed.ok) {
    throw new Error(parsed.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n'));
  }

  return {
    AGENTSMITH_APP_CONFIG_CHECKSUM: resourceFieldChecksum(parsed.documents, 'ConfigMap', 'agentsmith-app-config', 'data'),
    AGENTSMITH_APP_SECRETS_CHECKSUM: resourceFieldChecksum(parsed.documents, 'Secret', 'agentsmith-app-secrets', 'stringData'),
    AGENTSMITH_LLMUP_CONFIG_CHECKSUM: resourceFieldChecksum(parsed.documents, 'ConfigMap', 'agentsmith-llmup-config', 'data'),
    SANDBOX_MANAGER_CONFIG_CHECKSUM: resourceFieldChecksum(parsed.documents, 'ConfigMap', 'sandbox-manager-config', 'data'),
    AFSCP_RUNTIME_CONFIG_CHECKSUM: resourceFieldChecksum(parsed.documents, 'ConfigMap', 'afscp-runtime-config', 'data'),
    AFSCP_RUNTIME_SECRETS_CHECKSUM: resourceFieldChecksum(parsed.documents, 'Secret', 'afscp-runtime-secrets', 'stringData'),
  };
}

function buildContext(profile: UnifiedDeployProfile, env: Record<string, string>): RenderContext {
  const publicKeycloakBaseUrl = deriveKeycloakPublicBaseUrl(
    env.SUBSTRATE_KEYCLOAK_PUBLIC_ISSUER ?? '',
    env.SUBSTRATE_KEYCLOAK_REALM ?? '',
  );
  const namespace = env.NAMESPACE ?? '';

  return {
    ...env,
    PROFILE: profile,
    LLMUP_INTERNAL_BASE_URL: 'http://agentsmith-llmup:8080',
    AFSCP_BASE_URL: `http://afscp-api.${namespace}.svc.cluster.local:8080`,
    AFSCP_EXPORT_GATEWAY_INTERNAL_BASE_URL: `http://afscp-export-gateway.${namespace}.svc.cluster.local:8080`,
    AFSCP_DEFAULT_VOLUME_JUICEFS_NAME: `${namespace}-afscp-default`,
    AFSCP_DEFAULT_VOLUME_PV_NAME: `${namespace}-afscp-default-volume`,
    AFSCP_DEFAULT_VOLUME_STORAGE_QUANTITY: '12P',
    AFSCP_VOLUME_ROOT_PATH: '/var/lib/afscp/volumes/default',
    AFSCP_JVS_CWD_PATH: '/var/lib/afscp/jvs-cwd',
    SUBSTRATE_KEYCLOAK_PUBLIC_BASE_URL: publicKeycloakBaseUrl,
    SUBSTRATE_KEYCLOAK_PUBLIC_REALMS_BASE_URL: `${publicKeycloakBaseUrl}/realms`,
    SUBSTRATE_POSTGRES_SERVICE_PORT: SUBSTRATE_NATIVE_PORTS.postgresql,
    SUBSTRATE_MONGODB_SERVICE_PORT: SUBSTRATE_NATIVE_PORTS.mongodb,
    SUBSTRATE_REDIS_SERVICE_PORT: SUBSTRATE_NATIVE_PORTS.redis,
    SUBSTRATE_MINIO_SERVICE_PORT: SUBSTRATE_NATIVE_PORTS.minio,
    SUBSTRATE_KEYCLOAK_SERVICE_PORT: SUBSTRATE_NATIVE_PORTS.keycloak,
    SUBSTRATE_POSTGRES_SERVICE_FQDN: substrateServiceFqdn('postgresql', namespace),
    SUBSTRATE_MINIO_SERVICE_FQDN: substrateServiceFqdn('minio', namespace),
    SUBSTRATE_KEYCLOAK_INTERNAL_SERVICE_BASE_URL: substrateKeycloakInternalBaseUrl(),
    AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT: substrateMinioInternalMountEndpoint(namespace),
    SUBSTRATE_POSTGRES_ADDRESS_TYPE: endpointSliceAddressTypeForHost(env.SUBSTRATE_POSTGRES_HOST ?? ''),
    SUBSTRATE_MONGODB_ADDRESS_TYPE: endpointSliceAddressTypeForHost(env.SUBSTRATE_MONGODB_HOST ?? ''),
    SUBSTRATE_REDIS_ADDRESS_TYPE: endpointSliceAddressTypeForHost(env.SUBSTRATE_REDIS_HOST ?? ''),
    SUBSTRATE_MINIO_ADDRESS_TYPE: endpointSliceAddressTypeForHost(env.SUBSTRATE_MINIO_HOST ?? ''),
    SUBSTRATE_KEYCLOAK_ADDRESS_TYPE: endpointSliceAddressTypeForHost(env.SUBSTRATE_KEYCLOAK_HOST ?? ''),
  };
}

function substituteTemplate(template: string, context: RenderContext, templatePath: string): string {
  return template.replace(/\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/gu, (fullMatch, key: string) => {
    const value = context[key];
    if (value === undefined) {
      throw new Error(`${templatePath} references missing render value ${key}`);
    }

    return value;
  });
}

async function renderTemplates(templatePaths: readonly string[], templatesRoot: string, context: RenderContext): Promise<{
  output: string;
  absoluteTemplatePaths: string[];
}> {
  const renderedDocuments: string[] = [];
  const absoluteTemplatePaths: string[] = [];

  for (const templatePath of templatePaths) {
    const absoluteTemplatePath = resolveContainedTemplatePath(templatesRoot, templatePath);
    absoluteTemplatePaths.push(absoluteTemplatePath);
    const template = await readFile(absoluteTemplatePath, 'utf8');
    renderedDocuments.push(`# Source: ${path.relative(REPO_ROOT, absoluteTemplatePath)}\n${substituteTemplate(template, context, templatePath).trim()}`);
  }

  return {
    output: `${renderedDocuments.join('\n---\n')}\n`,
    absoluteTemplatePaths,
  };
}

export async function renderUnifiedDeployToString(options: RenderUnifiedDeployOptions = {}): Promise<RenderedUnifiedDeploy> {
  const manifestPath = resolvePath(options.manifestPath, DEFAULT_MANIFEST_PATH);
  const templatesRoot = resolvePath(options.templatesRoot, DEFAULT_TEMPLATES_ROOT);
  assertManifestValid({ manifestPath, rootDir: REPO_ROOT, templatesRoot });
  const manifest = loadUnifiedDeployManifest({ manifestPath, rootDir: REPO_ROOT, templatesRoot });
  const siteEnvPath = resolvePath(options.siteEnvPath, DEFAULT_SITE_ENV_PATH);
  const substrateTruthPath = resolvePath(options.substrateTruthPath, DEFAULT_SUBSTRATE_TRUTH_PATH);
  const siteEnv = options.siteEnv ?? await readFile(siteEnvPath, 'utf8');
  const deployEnv = parseSiteEnv(siteEnv);
  const substrateTruthSource = options.substrateTruth ?? await readFile(substrateTruthPath, 'utf8');
  const substrateTruth = parseSubstrateTruth(substrateTruthSource, {
    sourcePath: substrateTruthPath,
    requiredEnv: manifestRequiredEnv(manifest),
  });
  const env = {
    ...deployEnv,
    ...substrateTruth.values,
  };
  const profile = resolveProfile(options.profile, env.UNIFIED_DEPLOY_PROFILE);
  if (options.templateGroup === 'local_kind_admin_preflight' && profile !== 'local-kind') {
    throw new Error('local-kind admin preflight render is only available for the local-kind profile');
  }
  validateEnv(env);

  const templateGroup = options.templateGroup ?? 'app';
  const templatePaths = manifestTemplatePaths(manifest, templateGroup);
  const baseContext = buildContext(profile, env);
  if (templateGroup !== 'app') {
    const rendered = await renderTemplates(templatePaths, templatesRoot, baseContext);

    return {
      profile,
      output: rendered.output,
      manifestPath,
      siteEnvPath,
      substrateTruthPath,
      templatePaths: rendered.absoluteTemplatePaths,
    };
  }

  const initialRendered = await renderTemplates(
    templatePaths,
    templatesRoot,
    withRolloutChecksumPlaceholders(baseContext),
  );
  const rendered = await renderTemplates(templatePaths, templatesRoot, {
    ...baseContext,
    ...computeRolloutChecksums(initialRendered.output),
  });

  return {
    profile,
    output: rendered.output,
    manifestPath,
    siteEnvPath,
    substrateTruthPath,
    templatePaths: rendered.absoluteTemplatePaths,
  };
}

export async function renderUnifiedDeployFromFiles(options: RenderUnifiedDeployFromFilesOptions = {}): Promise<RenderedUnifiedDeploy> {
  return renderUnifiedDeployToString(options);
}

export async function renderUnifiedDeployPreflightFromFiles(
  options: Omit<RenderUnifiedDeployFromFilesOptions, 'templateGroup'> & { profile: 'local-kind' },
): Promise<RenderedUnifiedDeploy> {
  return renderUnifiedDeployToString({
    ...options,
    templateGroup: 'local_kind_admin_preflight',
  });
}

type CliOptions = {
  profile?: UnifiedDeployProfile;
  siteEnvPath?: string;
  substrateTruthPath?: string;
  manifestPath?: string;
  templatesRoot?: string;
  outPath?: string;
  templateGroup?: 'app' | 'local_kind_admin_preflight';
};

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};

  for (const arg of argv) {
    if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length);
      if (!isUnifiedDeployProfile(value)) {
        throw new Error(`unknown --profile value: ${value}`);
      }
      options.profile = value;
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
    if (arg.startsWith('--out=')) {
      options.outPath = arg.slice('--out='.length);
      continue;
    }
    if (arg === '--local-kind-admin-preflight') {
      options.templateGroup = 'local_kind_admin_preflight';
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const rendered = await renderUnifiedDeployFromFiles({
    profile: options.profile,
    siteEnvPath: options.siteEnvPath,
    substrateTruthPath: options.substrateTruthPath,
    manifestPath: options.manifestPath,
    templatesRoot: options.templatesRoot,
    templateGroup: options.templateGroup,
  });

  if (options.outPath) {
    await writeFile(resolvePath(options.outPath, options.outPath), rendered.output, 'utf8');
    process.stdout.write(`[unified-deploy] rendered ${rendered.profile} to ${options.outPath}\n`);
    return;
  }

  process.stdout.write(rendered.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
