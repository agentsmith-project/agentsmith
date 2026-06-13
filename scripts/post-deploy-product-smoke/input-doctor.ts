import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSiteEnv } from '../unified-deploy/render';
import {
  DOCKER_SUBSTRATE_REQUIRED_ENV,
  SUBSTRATE_TRUTH_SCHEMA_ENV_KEY,
  parseSubstrateTruth,
} from '../unified-deploy/substrate-truth';
import {
  CURRENT_SUBSTRATE_CONNECTION_SCHEMA_VERSION,
  type CurrentAgentSmithReleaseContract,
  type CurrentReleaseBoundaryValidationFailure,
  validateAgentSmithReleaseContract,
  validateNoSecretLeak,
  validateSubstrateConnectionTruth,
} from '../governance/current-release-boundary-schema';

type TargetAxes = {
  target_cluster: string;
  substrate_source: string;
  distribution: string;
};

export type PostDeployProductSmokeInputDoctorOptions = {
  releaseContractPath: string;
  siteEnvPath: string;
  substrateTruthPath: string;
  runtimeSubstrateEnvPath?: string;
  runtimeSubstrateEnvSource?: string;
  env?: Record<string, string | undefined>;
};

export type PostDeployProductSmokeInputDoctorResult = {
  status: 'passed';
  release_id: string;
  git_sha: string;
  target: TargetAxes;
};

type CliOptions = PostDeployProductSmokeInputDoctorOptions;

const DOCKER_SUBSTRATE_SCHEMA_VALUES = new Set([
  'agentsmith.docker-substrate.truth/v1',
  'docker-substrate.truth/v1',
]);
const RUNTIME_SUBSTRATE_ENV_SOURCE_ENV_KEY = 'UNIFIED_DEPLOY_PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV_SOURCE';
const RUNTIME_SUBSTRATE_ENV_PATH_ENV_KEY = 'UNIFIED_DEPLOY_PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV';
export const POST_DEPLOY_PRODUCT_SMOKE_ALLOW_LOCAL_TARGET_ENV_KEY =
  'AGENTSMITH_POST_DEPLOY_PRODUCT_SMOKE_ALLOW_LOCAL_TARGET';

const LOCAL_DEFAULT_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'agentsmith.localtest.me',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function formatValidationFailures(failures: readonly CurrentReleaseBoundaryValidationFailure[]): string {
  return failures.map((failure) => `${failure.path}: ${failure.reason}`).join('; ');
}

export function isPostDeployProductSmokeLocalTargetAllowed(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[POST_DEPLOY_PRODUCT_SMOKE_ALLOW_LOCAL_TARGET_ENV_KEY]?.trim() === '1';
}

export function assertPostDeployProductSmokeUrlNotLocal(
  label: string,
  value: string,
  allowLocalTarget: boolean,
): void {
  let hostname = '';
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (!allowLocalTarget && (LOCAL_DEFAULT_HOSTS.has(hostname) || hostname.endsWith('.localtest.me'))) {
    throw new Error(`${label} must not use local-kind/default local URL for GA handoff.`);
  }
}

function looksLikeDockerSubstrateEnv(source: string): boolean {
  return /^\s*(?:export\s+)?SUBSTRATE_[A-Z0-9_]*=/mu.test(source)
    || /^\s*(?:export\s+)?SUBSTRATE_TRUTH_SCHEMA_VERSION=/mu.test(source);
}

function parseJsonRecord(source: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error: unknown) {
    if (looksLikeDockerSubstrateEnv(source)) {
      throw new Error(
        `${label} must be neutral ${CURRENT_SUBSTRATE_CONNECTION_SCHEMA_VERSION} JSON; Docker substrate env is not accepted for GA handoff.`,
      );
    }
    throw new Error(`${label} must be a JSON object: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

async function readReleaseContract(filePath: string): Promise<CurrentAgentSmithReleaseContract> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = parseJsonRecord(raw, 'release_contract');
  const validation = validateAgentSmithReleaseContract(parsed);
  if (!validation.ok) {
    throw new Error(
      `release_contract failed validation: ${formatValidationFailures(validation.failures)}`,
    );
  }
  return validation.value;
}

async function readSubstrateTruth(filePath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = parseJsonRecord(raw, 'substrate_truth');
  const schemaVersion = stringValue(parsed, 'schema_version');
  const sourceTruthSchema = stringValue(parsed, 'source_truth_schema');
  const kitTruthSource = stringValue(parsed, 'kit_truth_source');
  if (
    DOCKER_SUBSTRATE_SCHEMA_VALUES.has(schemaVersion)
    || DOCKER_SUBSTRATE_SCHEMA_VALUES.has(sourceTruthSchema)
    || DOCKER_SUBSTRATE_SCHEMA_VALUES.has(kitTruthSource)
  ) {
    throw new Error('substrate_truth must be neutral JSON; Docker substrate schema is not accepted for GA handoff.');
  }

  const validation = validateSubstrateConnectionTruth(parsed);
  if (!validation.ok) {
    throw new Error(
      `substrate_truth failed neutral substrate connection truth validation: ${
        formatValidationFailures(validation.failures)
      }`,
    );
  }

  return validation.value;
}

async function readSiteEnv(filePath: string): Promise<Record<string, string>> {
  const raw = await readFile(filePath, 'utf8');
  const siteEnv = parseSiteEnv(raw);
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(siteEnv, 'site_env', failures);
  if (failures.length > 0) {
    throw new Error(
      `site_env must not persist raw secret env values: ${formatValidationFailures(failures)}`,
    );
  }
  return siteEnv;
}

function buildRuntimeSubstrateEnvSourceFromEnv(env: Record<string, string | undefined>): {
  source: string | null;
  missing: string[];
} {
  const requiredKeys = [SUBSTRATE_TRUTH_SCHEMA_ENV_KEY, ...DOCKER_SUBSTRATE_REQUIRED_ENV];
  const missing = requiredKeys.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    return { source: null, missing };
  }

  return {
    source: `${requiredKeys.map((key) => `${key}=${env[key]?.trim() ?? ''}`).join('\n')}\n`,
    missing: [],
  };
}

function runtimeSubstrateProjectionError(missing: readonly string[]): Error {
  const missingText = missing.length > 0
    ? ` Missing request env values: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}.`
    : '';
  return new Error(
    `product-flow runtime substrate env projection is required for neutral GA handoff; provide --runtime-substrate-env, ${RUNTIME_SUBSTRATE_ENV_SOURCE_ENV_KEY}, ${RUNTIME_SUBSTRATE_ENV_PATH_ENV_KEY}, or SUBSTRATE_* request env.${missingText}`,
  );
}

async function validateRuntimeSubstrateProjection(
  options: PostDeployProductSmokeInputDoctorOptions,
): Promise<void> {
  const env = options.env ?? process.env;
  let runtimeSource = options.runtimeSubstrateEnvSource
    ?? env[RUNTIME_SUBSTRATE_ENV_SOURCE_ENV_KEY];
  let runtimeSourcePath = RUNTIME_SUBSTRATE_ENV_SOURCE_ENV_KEY;
  const runtimePath = options.runtimeSubstrateEnvPath
    ?? env[RUNTIME_SUBSTRATE_ENV_PATH_ENV_KEY];

  if (runtimePath?.trim()) {
    runtimeSourcePath = path.resolve(runtimePath);
    runtimeSource = await readFile(runtimeSourcePath, 'utf8');
  }

  if (!runtimeSource?.trim()) {
    const runtimeFromEnv = buildRuntimeSubstrateEnvSourceFromEnv(env);
    if (!runtimeFromEnv.source) {
      throw runtimeSubstrateProjectionError(runtimeFromEnv.missing);
    }
    runtimeSource = runtimeFromEnv.source;
    runtimeSourcePath = 'SUBSTRATE_* request env';
  }

  parseSubstrateTruth(runtimeSource, { sourcePath: runtimeSourcePath });
}

function parseProfileAxes(siteEnv: Record<string, string>): TargetAxes {
  const profile = siteEnv.UNIFIED_DEPLOY_PROFILE?.trim() ?? '';
  if (!profile) {
    throw new Error('site_env.UNIFIED_DEPLOY_PROFILE is required for GA handoff target binding.');
  }
  if (profile === 'local-kind') {
    throw new Error('local-kind defaults are not accepted for GA post-deploy product smoke handoff.');
  }
  if (profile === 'existing-cluster') {
    throw new Error(
      'site_env.UNIFIED_DEPLOY_PROFILE must use target_cluster/substrate_source/distribution; existing-cluster is a transition-only diagnostic profile.',
    );
  }

  const [targetCluster, substrateSource, distribution, extra] = profile.split('/');
  if (!targetCluster || !substrateSource || !distribution || extra !== undefined) {
    throw new Error(
      'site_env.UNIFIED_DEPLOY_PROFILE must use target_cluster/substrate_source/distribution for GA handoff target binding.',
    );
  }

  return {
    target_cluster: targetCluster,
    substrate_source: substrateSource,
    distribution,
  };
}

function assertNoLocalDefaultUrls(siteEnv: Record<string, string>, allowLocalTarget: boolean): void {
  if (!siteEnv.PUBLIC_BASE_URL?.trim()) {
    throw new Error('site_env.PUBLIC_BASE_URL is required for GA handoff target identity.');
  }
  for (const key of ['PUBLIC_BASE_URL', 'PUBLIC_API_BASE_URL', 'RUNNER_PUBLIC_API_BASE_URL']) {
    const value = siteEnv[key]?.trim();
    if (!value) {
      continue;
    }

    assertPostDeployProductSmokeUrlNotLocal(`site_env.${key}`, value, allowLocalTarget);
  }
}

function assertTargetAxesMatch(left: TargetAxes, right: TargetAxes, rightLabel: string): void {
  if (
    left.target_cluster !== right.target_cluster
    || left.substrate_source !== right.substrate_source
    || left.distribution !== right.distribution
  ) {
    throw new Error(
      `site_env target axes must match ${rightLabel}: `
        + `${left.target_cluster}/${left.substrate_source}/${left.distribution} != `
        + `${right.target_cluster}/${right.substrate_source}/${right.distribution}.`,
    );
  }
}

function axesFromRecord(record: Record<string, unknown>, label: string): TargetAxes {
  const axes = {
    target_cluster: stringValue(record, 'target_cluster'),
    substrate_source: stringValue(record, 'substrate_source'),
    distribution: stringValue(record, 'distribution'),
  };
  if (!axes.target_cluster || !axes.substrate_source || !axes.distribution) {
    throw new Error(`${label} must include target_cluster, substrate_source, and distribution.`);
  }
  return axes;
}

function releaseContractIncludesTarget(
  releaseContract: CurrentAgentSmithReleaseContract,
  target: TargetAxes,
): boolean {
  return releaseContract.target_profiles.some((profile) => (
    profile.target_cluster === target.target_cluster
    && profile.substrate_source === target.substrate_source
    && profile.distribution === target.distribution
  ));
}

function assertReleaseContractTarget(
  releaseContract: CurrentAgentSmithReleaseContract,
  target: TargetAxes,
): void {
  if (!releaseContractIncludesTarget(releaseContract, target)) {
    throw new Error(
      `release_contract.target_profiles must include selected handoff target `
        + `${target.target_cluster}/${target.substrate_source}/${target.distribution}.`,
    );
  }
}

export async function runPostDeployProductSmokeInputDoctor(
  options: PostDeployProductSmokeInputDoctorOptions,
): Promise<PostDeployProductSmokeInputDoctorResult> {
  const env = options.env ?? process.env;
  const releaseContract = await readReleaseContract(options.releaseContractPath);
  const siteEnv = await readSiteEnv(options.siteEnvPath);
  const substrateTruth = await readSubstrateTruth(options.substrateTruthPath);
  await validateRuntimeSubstrateProjection(options);
  const siteTarget = parseProfileAxes(siteEnv);
  assertNoLocalDefaultUrls(siteEnv, isPostDeployProductSmokeLocalTargetAllowed(env));
  assertTargetAxesMatch(siteTarget, axesFromRecord(substrateTruth, 'substrate_truth'), 'substrate_truth target axes');
  assertReleaseContractTarget(releaseContract, siteTarget);

  return {
    status: 'passed',
    release_id: releaseContract.release_id,
    git_sha: releaseContract.git_sha,
    target: siteTarget,
  };
}

function requireArgValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function parsePostDeployProductSmokeInputDoctorCliOptions(argv: readonly string[]): CliOptions {
  const options: Partial<CliOptions> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--release-contract') {
      options.releaseContractPath = requireArgValue(argv, index, '--release-contract');
      index += 1;
    } else if (arg.startsWith('--release-contract=')) {
      options.releaseContractPath = arg.slice('--release-contract='.length);
    } else if (arg === '--site-env') {
      options.siteEnvPath = requireArgValue(argv, index, '--site-env');
      index += 1;
    } else if (arg.startsWith('--site-env=')) {
      options.siteEnvPath = arg.slice('--site-env='.length);
    } else if (arg === '--substrate-truth') {
      options.substrateTruthPath = requireArgValue(argv, index, '--substrate-truth');
      index += 1;
    } else if (arg.startsWith('--substrate-truth=')) {
      options.substrateTruthPath = arg.slice('--substrate-truth='.length);
    } else if (arg === '--runtime-substrate-env') {
      options.runtimeSubstrateEnvPath = requireArgValue(argv, index, '--runtime-substrate-env');
      index += 1;
    } else if (arg.startsWith('--runtime-substrate-env=')) {
      options.runtimeSubstrateEnvPath = arg.slice('--runtime-substrate-env='.length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!options.releaseContractPath || options.releaseContractPath.trim().length === 0) {
    throw new Error('--release-contract is required.');
  }
  if (!options.siteEnvPath || options.siteEnvPath.trim().length === 0) {
    throw new Error('--site-env is required.');
  }
  if (!options.substrateTruthPath || options.substrateTruthPath.trim().length === 0) {
    throw new Error('--substrate-truth is required.');
  }

  return {
    releaseContractPath: options.releaseContractPath,
    siteEnvPath: options.siteEnvPath,
    substrateTruthPath: options.substrateTruthPath,
    ...(options.runtimeSubstrateEnvPath ? { runtimeSubstrateEnvPath: options.runtimeSubstrateEnvPath } : {}),
  };
}

async function main(): Promise<void> {
  const options = parsePostDeployProductSmokeInputDoctorCliOptions(process.argv.slice(2));
  const result = await runPostDeployProductSmokeInputDoctor(options);
  process.stdout.write(
    `[post-deploy-product-smoke] input doctor passed\n`
      + `[post-deploy-product-smoke] target: ${
        result.target.target_cluster
      }/${result.target.substrate_source}/${result.target.distribution}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
