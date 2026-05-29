import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  RELEASE_KIT_CANONICAL_REPO,
  canonicalReleaseBoundaryJson,
  sha256Digest,
  type CurrentReleaseBoundaryValidationFailure,
  type CurrentReleaseBoundaryValidationResult,
} from './current-release-boundary-schema';

export const RELEASE_KIT_ONLINE_ADOPTION_HANDOFF_SCHEMA_VERSION =
  'agentsmith.release-kit-online-adoption-handoff/v1' as const;

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const ALLOWED_ARTIFACT_URI_PATTERN = /^(?:gh-artifact|signed-operator-run):\/\/.+/u;

const TOP_LEVEL_KEYS = [
  'schema_version',
  'release_id',
  'git_sha',
  'release_contract',
  'provenance',
  'online_adoption_report',
  'coverage',
] as const;
const RELEASE_CONTRACT_KEYS = ['input_sha256', 'subject_sha256'] as const;
const PROVENANCE_KEYS = ['producer_repo', 'normalized_remote', 'commit_sha'] as const;
const ONLINE_ADOPTION_REPORT_KEYS = ['artifact_uri', 'artifact_sha256', 'subject_sha256'] as const;
const COVERAGE_KEYS = ['strategies'] as const;
const STRATEGY_KEYS = ['name', 'operator_path', 'target_profile'] as const;

const RAW_ONLINE_ADOPTION_REPORT_SHAPE_KEYS = [
  'schema',
  'scope',
  'readiness',
  'status',
  'online_paths',
  'generated_at',
] as const;

const FORBIDDEN_KEYS = new Set<string>([
  'readiness',
  'ready',
  'verdict',
  'release_verdict',
  'deploy_readiness',
  'package_readiness',
  'operator_verdict',
  'status',
  'conclusion',
  'evidence_root',
  'report_path',
  'report_paths',
  'raw_report',
  'raw_evidence',
  'online_paths',
  'kubeconfig',
  'secret',
  'secrets',
  'token',
  'password',
  'apiKey',
  'clientSecret',
] as const);

const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+\S+/iu,
  /\btoken\s*=/iu,
  /\bpassword\s*=/iu,
] as const;

export interface ReleaseKitOnlineAdoptionStrategy {
  name: 'use_existing' | 'install_substrates';
  operator_path: 'online/use_existing' | 'online/install_substrates';
  target_profile:
    | 'existing_kubernetes/external_declared/online'
    | 'existing_kubernetes/kit_installed/online';
}

export interface ReleaseKitOnlineAdoptionHandoffDescriptor {
  schema_version: typeof RELEASE_KIT_ONLINE_ADOPTION_HANDOFF_SCHEMA_VERSION;
  release_id: string;
  git_sha: string;
  release_contract: {
    input_sha256: string;
    subject_sha256: string;
  };
  provenance: {
    producer_repo: typeof RELEASE_KIT_CANONICAL_REPO;
    normalized_remote: typeof RELEASE_KIT_CANONICAL_REPO;
    commit_sha: string;
  };
  online_adoption_report: {
    artifact_uri: string;
    artifact_sha256: string;
    subject_sha256: string;
  };
  coverage: {
    strategies: readonly ReleaseKitOnlineAdoptionStrategy[];
  };
}

export interface ReleaseKitOnlineAdoptionHandoffValidationContext {
  releaseContractRaw: Buffer;
  releaseContractJson: unknown;
  expectReportDigest?: string;
}

export interface ReleaseKitOnlineAdoptionHandoffFileValidationConfig {
  inputPath: string;
  releaseContractPath: string;
  expectReportDigest?: string;
}

interface ReleaseKitOnlineAdoptionHandoffCliOptions {
  argv?: readonly string[];
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

interface ReleaseKitOnlineAdoptionHandoffCliConfig {
  inputPath: string;
  releaseContractPath: string;
  expectReportDigest?: string;
}

const REQUIRED_STRATEGIES = [
  {
    name: 'use_existing',
    operator_path: 'online/use_existing',
    target_profile: 'existing_kubernetes/external_declared/online',
  },
  {
    name: 'install_substrates',
    operator_path: 'online/install_substrates',
    target_profile: 'existing_kubernetes/kit_installed/online',
  },
] as const satisfies readonly ReleaseKitOnlineAdoptionStrategy[];

export function validateReleaseKitOnlineAdoptionHandoffFiles(
  config: ReleaseKitOnlineAdoptionHandoffFileValidationConfig,
): CurrentReleaseBoundaryValidationResult<ReleaseKitOnlineAdoptionHandoffDescriptor> {
  const handoffParseResult = parseJsonBuffer(readFileSync(config.inputPath), 'input');
  if (!handoffParseResult.ok) {
    return handoffParseResult;
  }

  const releaseContractRaw = readFileSync(config.releaseContractPath);
  const releaseContractParseResult = parseJsonBuffer(releaseContractRaw, 'release_contract_file');
  if (!releaseContractParseResult.ok) {
    return releaseContractParseResult;
  }

  return validateReleaseKitOnlineAdoptionHandoffDescriptor(handoffParseResult.value, {
    releaseContractRaw,
    releaseContractJson: releaseContractParseResult.value,
    expectReportDigest: config.expectReportDigest,
  });
}

export function validateReleaseKitOnlineAdoptionHandoffDescriptor(
  value: unknown,
  context: ReleaseKitOnlineAdoptionHandoffValidationContext,
): CurrentReleaseBoundaryValidationResult<ReleaseKitOnlineAdoptionHandoffDescriptor> {
  const descriptorResult = validateDescriptorEnvelope(value);
  if (!descriptorResult.ok) {
    return descriptorResult;
  }

  const releaseContractDigestResult = resolveReleaseContractDigests(context.releaseContractRaw, context.releaseContractJson);
  if (!releaseContractDigestResult.ok) {
    return releaseContractDigestResult;
  }

  const descriptor = descriptorResult.value;
  const releaseContractDigests = releaseContractDigestResult.value;
  if (descriptor.release_contract.input_sha256 !== releaseContractDigests.inputSha256) {
    return invalid(
      'release_contract.input_sha256',
      `release_contract.input_sha256 must match supplied release contract raw digest ${releaseContractDigests.inputSha256}.`,
    );
  }
  if (descriptor.release_contract.subject_sha256 !== releaseContractDigests.subjectSha256) {
    return invalid(
      'release_contract.subject_sha256',
      `release_contract.subject_sha256 must match supplied release contract subject digest ${releaseContractDigests.subjectSha256}.`,
    );
  }

  const releaseContractBindingResult = validateReleaseContractBinding(
    context.releaseContractJson,
    descriptor.release_id,
    descriptor.git_sha,
  );
  if (releaseContractBindingResult) {
    return releaseContractBindingResult;
  }

  if (context.expectReportDigest !== undefined) {
    const expectedDigestResult = validateDigestValue(context.expectReportDigest, 'expect_report_digest');
    if (!expectedDigestResult.ok) {
      return expectedDigestResult;
    }
    if (descriptor.online_adoption_report.artifact_sha256 !== expectedDigestResult.value) {
      return invalid(
        'online_adoption_report.artifact_sha256',
        `online_adoption_report.artifact_sha256 must match expected report digest ${expectedDigestResult.value}.`,
      );
    }
  }

  return {
    ok: true,
    value: descriptor,
  };
}

export function runReleaseKitOnlineAdoptionHandoffCli(
  options: ReleaseKitOnlineAdoptionHandoffCliOptions = {},
): number {
  const argv = options.argv ?? process.argv.slice(2);
  const stdout = options.stdout ?? ((message: string) => console.log(message));
  const stderr = options.stderr ?? ((message: string) => console.error(message));

  try {
    const config = parseCliArgs(argv);
    const result = validateReleaseKitOnlineAdoptionHandoffFiles(config);
    if (!result.ok) {
      stderr(formatFailures('release-kit online adoption handoff validation failed:', result.failures));
      return 1;
    }

    stdout(`release-kit online adoption handoff: ${config.inputPath}`);
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function validateDescriptorEnvelope(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<ReleaseKitOnlineAdoptionHandoffDescriptor> {
  if (!isRecord(value)) {
    return invalid('handoff', 'handoff descriptor must be an object.');
  }

  if (isRawOnlineAdoptionReportShape(value)) {
    return invalid(
      'handoff',
      'raw online-adoption-report.json is not accepted; pass agentsmith.release-kit-online-adoption-handoff/v1.',
    );
  }

  const forbiddenKeyFailure = findForbiddenKey(value, 'handoff');
  if (forbiddenKeyFailure) {
    return invalid(forbiddenKeyFailure.path, forbiddenKeyFailure.reason);
  }

  const forbiddenStringFailure = findForbiddenString(value, 'handoff');
  if (forbiddenStringFailure) {
    return invalid(forbiddenStringFailure.path, forbiddenStringFailure.reason);
  }

  const shapeResult = validateRecordShape(value, TOP_LEVEL_KEYS, 'handoff');
  if (!shapeResult.ok) {
    return shapeResult;
  }

  if (value.schema_version !== RELEASE_KIT_ONLINE_ADOPTION_HANDOFF_SCHEMA_VERSION) {
    return invalid(
      'schema_version',
      `schema_version must be ${RELEASE_KIT_ONLINE_ADOPTION_HANDOFF_SCHEMA_VERSION}.`,
    );
  }

  const releaseIdResult = requireNonEmptyString(value.release_id, 'release_id');
  if (!releaseIdResult.ok) {
    return releaseIdResult;
  }
  const gitShaResult = validateGitShaValue(value.git_sha, 'git_sha');
  if (!gitShaResult.ok) {
    return gitShaResult;
  }
  const releaseContractResult = validateReleaseContractLink(value.release_contract);
  if (!releaseContractResult.ok) {
    return releaseContractResult;
  }
  const provenanceResult = validateProvenance(value.provenance);
  if (!provenanceResult.ok) {
    return provenanceResult;
  }
  const reportResult = validateOnlineAdoptionReport(value.online_adoption_report);
  if (!reportResult.ok) {
    return reportResult;
  }
  const coverageResult = validateCoverage(value.coverage);
  if (!coverageResult.ok) {
    return coverageResult;
  }

  return {
    ok: true,
    value: {
      schema_version: RELEASE_KIT_ONLINE_ADOPTION_HANDOFF_SCHEMA_VERSION,
      release_id: releaseIdResult.value,
      git_sha: gitShaResult.value,
      release_contract: releaseContractResult.value,
      provenance: provenanceResult.value,
      online_adoption_report: reportResult.value,
      coverage: coverageResult.value,
    },
  };
}

function validateReleaseContractLink(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<ReleaseKitOnlineAdoptionHandoffDescriptor['release_contract']> {
  const shapeResult = validateRecordShape(value, RELEASE_CONTRACT_KEYS, 'release_contract');
  if (!shapeResult.ok) {
    return shapeResult;
  }

  const inputDigestResult = validateDigestValue(shapeResult.value.input_sha256, 'release_contract.input_sha256');
  if (!inputDigestResult.ok) {
    return inputDigestResult;
  }
  const subjectDigestResult = validateDigestValue(shapeResult.value.subject_sha256, 'release_contract.subject_sha256');
  if (!subjectDigestResult.ok) {
    return subjectDigestResult;
  }

  return {
    ok: true,
    value: {
      input_sha256: inputDigestResult.value,
      subject_sha256: subjectDigestResult.value,
    },
  };
}

function validateProvenance(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<ReleaseKitOnlineAdoptionHandoffDescriptor['provenance']> {
  const shapeResult = validateRecordShape(value, PROVENANCE_KEYS, 'provenance');
  if (!shapeResult.ok) {
    return shapeResult;
  }

  const producerRepoResult = requireNonEmptyString(shapeResult.value.producer_repo, 'provenance.producer_repo');
  if (!producerRepoResult.ok) {
    return producerRepoResult;
  }
  const normalizedRemoteResult = requireNonEmptyString(shapeResult.value.normalized_remote, 'provenance.normalized_remote');
  if (!normalizedRemoteResult.ok) {
    return normalizedRemoteResult;
  }
  const commitShaResult = validateGitShaValue(shapeResult.value.commit_sha, 'provenance.commit_sha');
  if (!commitShaResult.ok) {
    return commitShaResult;
  }

  if (
    producerRepoResult.value !== RELEASE_KIT_CANONICAL_REPO
    || normalizedRemoteResult.value !== RELEASE_KIT_CANONICAL_REPO
  ) {
    return invalid(
      'provenance',
      `canonical repo identity must be ${RELEASE_KIT_CANONICAL_REPO}.`,
    );
  }

  return {
    ok: true,
    value: {
      producer_repo: RELEASE_KIT_CANONICAL_REPO,
      normalized_remote: RELEASE_KIT_CANONICAL_REPO,
      commit_sha: commitShaResult.value,
    },
  };
}

function validateOnlineAdoptionReport(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<ReleaseKitOnlineAdoptionHandoffDescriptor['online_adoption_report']> {
  const shapeResult = validateRecordShape(value, ONLINE_ADOPTION_REPORT_KEYS, 'online_adoption_report');
  if (!shapeResult.ok) {
    return shapeResult;
  }

  const artifactUriResult = requireNonEmptyString(shapeResult.value.artifact_uri, 'online_adoption_report.artifact_uri');
  if (!artifactUriResult.ok) {
    return artifactUriResult;
  }
  if (!ALLOWED_ARTIFACT_URI_PATTERN.test(artifactUriResult.value)) {
    return invalid(
      'online_adoption_report.artifact_uri',
      'online_adoption_report.artifact_uri must use gh-artifact:// or signed-operator-run://.',
    );
  }

  const artifactDigestResult = validateDigestValue(
    shapeResult.value.artifact_sha256,
    'online_adoption_report.artifact_sha256',
  );
  if (!artifactDigestResult.ok) {
    return artifactDigestResult;
  }
  const subjectDigestResult = validateDigestValue(
    shapeResult.value.subject_sha256,
    'online_adoption_report.subject_sha256',
  );
  if (!subjectDigestResult.ok) {
    return subjectDigestResult;
  }

  return {
    ok: true,
    value: {
      artifact_uri: artifactUriResult.value,
      artifact_sha256: artifactDigestResult.value,
      subject_sha256: subjectDigestResult.value,
    },
  };
}

function validateCoverage(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<ReleaseKitOnlineAdoptionHandoffDescriptor['coverage']> {
  const shapeResult = validateRecordShape(value, COVERAGE_KEYS, 'coverage');
  if (!shapeResult.ok) {
    return shapeResult;
  }
  if (!Array.isArray(shapeResult.value.strategies)) {
    return invalid('coverage.strategies', 'coverage.strategies must be an array.');
  }

  const strategiesResult = validateStrategies(shapeResult.value.strategies);
  if (!strategiesResult.ok) {
    return strategiesResult;
  }

  return {
    ok: true,
    value: {
      strategies: strategiesResult.value,
    },
  };
}

function validateStrategies(
  values: readonly unknown[],
): CurrentReleaseBoundaryValidationResult<readonly ReleaseKitOnlineAdoptionStrategy[]> {
  const strategies: ReleaseKitOnlineAdoptionStrategy[] = [];
  for (const [index, value] of values.entries()) {
    const pathName = `coverage.strategies[${index}]`;
    const shapeResult = validateRecordShape(value, STRATEGY_KEYS, pathName);
    if (!shapeResult.ok) {
      return shapeResult;
    }

    const nameResult = requireNonEmptyString(shapeResult.value.name, `${pathName}.name`);
    if (!nameResult.ok) {
      return nameResult;
    }
    const operatorPathResult = requireNonEmptyString(shapeResult.value.operator_path, `${pathName}.operator_path`);
    if (!operatorPathResult.ok) {
      return operatorPathResult;
    }
    const targetProfileResult = requireNonEmptyString(shapeResult.value.target_profile, `${pathName}.target_profile`);
    if (!targetProfileResult.ok) {
      return targetProfileResult;
    }

    const strategy = REQUIRED_STRATEGIES.find((required) => (
      required.name === nameResult.value
      && required.operator_path === operatorPathResult.value
      && required.target_profile === targetProfileResult.value
    ));
    if (!strategy) {
      return invalid(
        pathName,
        `coverage.strategies must not include extra strategy ${nameResult.value}.`,
      );
    }
    strategies.push(strategy);
  }

  const seenStrategyNames = new Set<string>();
  for (const strategy of strategies) {
    if (seenStrategyNames.has(strategy.name)) {
      return invalid('coverage.strategies', `coverage.strategies contains duplicate strategy ${strategy.name}.`);
    }
    seenStrategyNames.add(strategy.name);
  }

  for (const required of REQUIRED_STRATEGIES) {
    if (!seenStrategyNames.has(required.name)) {
      return invalid('coverage.strategies', `coverage.strategies is missing required strategy ${required.name}.`);
    }
  }

  if (strategies.length !== REQUIRED_STRATEGIES.length) {
    return invalid('coverage.strategies', 'coverage.strategies must contain exactly two strategies.');
  }

  return {
    ok: true,
    value: REQUIRED_STRATEGIES,
  };
}

function resolveReleaseContractDigests(
  raw: Buffer,
  value: unknown,
): CurrentReleaseBoundaryValidationResult<{
  inputSha256: string;
  subjectSha256: string;
}> {
  if (!isRecord(value)) {
    return invalid('release_contract_file', 'supplied release contract must be an object.');
  }

  const subject = { ...value };
  delete subject.artifact_provenance;

  return {
    ok: true,
    value: {
      inputSha256: sha256BufferDigest(raw),
      subjectSha256: sha256Digest(canonicalReleaseBoundaryJson(subject)),
    },
  };
}

function validateReleaseContractBinding(
  value: unknown,
  releaseId: string,
  gitSha: string,
): CurrentReleaseBoundaryValidationResult<never> | null {
  if (!isRecord(value)) {
    return invalid('release_contract_file', 'supplied release contract must be an object.');
  }

  if (typeof value.release_id === 'string' && value.release_id !== releaseId) {
    return invalid('release_id', 'release_id must match supplied release contract release_id.');
  }
  if (typeof value.git_sha === 'string' && value.git_sha !== gitSha) {
    return invalid('git_sha', 'git_sha must match supplied release contract git_sha.');
  }

  return null;
}

function validateRecordShape<const T extends readonly string[]>(
  value: unknown,
  allowedKeys: T,
  pathName: string,
): CurrentReleaseBoundaryValidationResult<Record<T[number], unknown>> {
  if (!isRecord(value)) {
    return invalid(pathName, `${pathName} must be an object.`);
  }

  const allowedKeySet = new Set<string>(allowedKeys);
  const extraKey = Object.keys(value).find((key) => !allowedKeySet.has(key));
  if (extraKey) {
    return invalid(`${pathName}.${extraKey}`, `${pathName} must not include unknown field ${extraKey}.`);
  }

  const missingKey = allowedKeys.find((key) => !Object.hasOwn(value, key));
  if (missingKey) {
    return invalid(`${pathName}.${missingKey}`, `${pathName}.${missingKey} is required.`);
  }

  return {
    ok: true,
    value: value as Record<T[number], unknown>,
  };
}

function parseJsonBuffer(
  source: Buffer,
  pathName: string,
): CurrentReleaseBoundaryValidationResult<unknown> {
  try {
    return {
      ok: true,
      value: JSON.parse(source.toString('utf8')) as unknown,
    };
  } catch {
    return invalid(pathName, `${pathName} must contain valid JSON.`);
  }
}

function validateDigestValue(
  value: unknown,
  pathName: string,
): CurrentReleaseBoundaryValidationResult<string> {
  const stringResult = requireNonEmptyString(value, pathName);
  if (!stringResult.ok) {
    return stringResult;
  }
  if (!DIGEST_PATTERN.test(stringResult.value)) {
    return invalid(pathName, `${pathName} must be sha256:<64 lowercase hex>.`);
  }

  return stringResult;
}

function validateGitShaValue(
  value: unknown,
  pathName: string,
): CurrentReleaseBoundaryValidationResult<string> {
  const stringResult = requireNonEmptyString(value, pathName);
  if (!stringResult.ok) {
    return stringResult;
  }
  if (!GIT_SHA_PATTERN.test(stringResult.value)) {
    return invalid(pathName, `${pathName} must be a 40-character lowercase hex git sha.`);
  }

  return stringResult;
}

function requireNonEmptyString(
  value: unknown,
  pathName: string,
): CurrentReleaseBoundaryValidationResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(pathName, `${pathName} must be a non-empty string.`);
  }

  return {
    ok: true,
    value,
  };
}

function findForbiddenKey(value: unknown, pathName: string): CurrentReleaseBoundaryValidationFailure | null {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const nestedFailure = findForbiddenKey(entry, `${pathName}[${index}]`);
      if (nestedFailure) {
        return nestedFailure;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const keyPath = `${pathName}.${key}`;
    if (FORBIDDEN_KEYS.has(key)) {
      return {
        path: keyPath,
        reason: `forbidden handoff key "${key}" must not be present.`,
      };
    }
    const nestedFailure = findForbiddenKey(nestedValue, keyPath);
    if (nestedFailure) {
      return nestedFailure;
    }
  }

  return null;
}

function findForbiddenString(value: unknown, pathName: string): CurrentReleaseBoundaryValidationFailure | null {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      return {
        path: pathName,
        reason: 'secret-looking value must not be present in release-kit online adoption handoff.',
      };
    }
    if (isForbiddenLocalPathLikeValue(value)) {
      return {
        path: pathName,
        reason: 'raw local paths, file URIs, traversal paths, and home/tmp paths are not allowed.',
      };
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const nestedFailure = findForbiddenString(entry, `${pathName}[${index}]`);
      if (nestedFailure) {
        return nestedFailure;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedFailure = findForbiddenString(nestedValue, `${pathName}.${key}`);
    if (nestedFailure) {
      return nestedFailure;
    }
  }

  return null;
}

function isForbiddenLocalPathLikeValue(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^file:/iu.test(trimmed)
    || trimmed.includes('../')
    || trimmed.includes('..\\')
    || /^[A-Za-z]:[\\/]/u.test(trimmed)
    || trimmed.startsWith('/')
    || trimmed.startsWith('\\')
    || trimmed.startsWith('~/')
    || trimmed.startsWith('~\\')
    || trimmed.startsWith('/home')
    || trimmed.startsWith('/tmp')
  );
}

function isRawOnlineAdoptionReportShape(value: Record<string, unknown>): boolean {
  return RAW_ONLINE_ADOPTION_REPORT_SHAPE_KEYS.every((key) => Object.hasOwn(value, key));
}

function sha256BufferDigest(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function invalid<T = never>(
  pathName: string,
  reason: string,
): CurrentReleaseBoundaryValidationResult<T> {
  return {
    ok: false,
    failures: [
      {
        path: pathName,
        reason,
      },
    ],
  };
}

function parseCliArgs(argv: readonly string[]): ReleaseKitOnlineAdoptionHandoffCliConfig {
  let inputPath: string | undefined;
  let releaseContractPath: string | undefined;
  let expectReportDigest: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--input':
        inputPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--release-contract':
        releaseContractPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--expect-report-digest':
        expectReportDigest = requireArgValue(argv, index);
        index += 1;
        break;
      default:
        throw new Error(`unsupported release-kit online adoption handoff argument: ${arg}`);
    }
  }

  if (!inputPath) {
    throw new Error('--input is required.');
  }
  if (!releaseContractPath) {
    throw new Error('--release-contract is required.');
  }

  return {
    inputPath: path.resolve(inputPath),
    releaseContractPath: path.resolve(releaseContractPath),
    expectReportDigest,
  };
}

function requireArgValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for ${argv[index]}.`);
  }
  return value;
}

function formatFailures(
  heading: string,
  failures: readonly CurrentReleaseBoundaryValidationFailure[],
): string {
  return [
    heading,
    ...failures.map((failure) => `- ${failure.path}: ${failure.reason}`),
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runReleaseKitOnlineAdoptionHandoffCli());
}
