import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
  CURRENT_RELEASE_CONTRACT_SCHEMA_VERSION,
  CURRENT_REQUIRED_PRODUCT_FLOWS,
  CURRENT_SUBSTRATE_CONNECTION_SCHEMA_VERSION,
  CURRENT_MANAGED_RUNNER_RELEASE_INVENTORY_IMAGE_ID,
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateAgentSmithReleaseContract,
  validateRunnerImageLock,
  type CurrentAgentSmithReleaseContract,
  type CurrentArtifactProvenance,
  type CurrentDeployTemplatePackage,
  type CurrentDeploymentTargetProfile,
  type CurrentReleaseBoundaryValidationFailure,
  type CurrentReleaseImage,
  type CurrentReleaseInventoryImage,
  type CurrentRunnerImageLock,
} from './current-release-boundary-schema';

const GENERATOR_ARTIFACT_SHA256_OMITTED = Symbol('generator artifact sha256 omitted');
const REQUIRED_GENERATOR_ARRAY_FIELDS = [
  'product_images',
  'adopted_provider_images',
  'release_kit_prerequisite_images',
  'target_profiles',
] as const;

export interface AgentSmithReleaseContractCiProvenanceInput {
  producer_repo: string;
  normalized_remote: string;
  commit_sha: string;
  subject_uri?: string;
  workflow_name: string;
  run_id: string;
  run_attempt: string;
  job: string;
  artifact_uri: string;
  generated_at: string;
  generator_command: string;
  generator_version: string;
  attestation: CurrentArtifactProvenance['attestation'];
}

export interface AgentSmithReleaseContractGeneratorInput {
  release_id: string;
  git_sha: string;
  product_images: readonly CurrentReleaseImage[];
  adopted_provider_images: readonly CurrentReleaseImage[];
  release_kit_prerequisite_images: readonly CurrentReleaseImage[];
  runnerImageLock: CurrentRunnerImageLock;
  deploy_template_digest: string;
  deploy_template_package: CurrentDeployTemplatePackage;
  openapi_digest?: string;
  openapi_subject?: unknown;
  asyncapi_digest?: string;
  asyncapi_subject?: unknown;
  required_product_flows?: readonly string[];
  target_profiles: readonly CurrentDeploymentTargetProfile[];
  min_release_kit_version: string;
  ci_provenance: AgentSmithReleaseContractCiProvenanceInput;
}

export interface AgentSmithReleaseContractGenerationOptions {
  sourceGitSha: string;
}

interface ReleaseContractCliOptions {
  argv?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

interface ReleaseContractCliConfig {
  inputPath: string;
  outputPath: string;
}

class ReleaseContractGenerationError extends Error {
  constructor(readonly failures: readonly CurrentReleaseBoundaryValidationFailure[]) {
    super(formatReleaseContractValidationError(failures));
    this.name = 'ReleaseContractGenerationError';
  }
}

export function generateAgentSmithReleaseContract(
  input: AgentSmithReleaseContractGeneratorInput,
  options: AgentSmithReleaseContractGenerationOptions,
): CurrentAgentSmithReleaseContract {
  const sourceGitSha = resolveRequiredSourceGitSha(options);
  const earlyFailures = validateGeneratorInput(input, sourceGitSha);
  if (earlyFailures.length > 0) {
    throw new ReleaseContractGenerationError(earlyFailures);
  }

  const openapiDigest = resolveSubjectDigest(input, 'openapi');
  const asyncapiDigest = resolveSubjectDigest(input, 'asyncapi');
  const contractSubject = buildReleaseContractSubject(input, openapiDigest, asyncapiDigest);
  const subjectSha256 = sha256Digest(canonicalReleaseBoundaryJson(contractSubject));
  const contractWithProvenanceForArtifactHash = {
    ...contractSubject,
    artifact_provenance: buildArtifactProvenance(input, subjectSha256, GENERATOR_ARTIFACT_SHA256_OMITTED),
  };
  const artifactSha256 = digestOmitArtifactShaProjection(contractWithProvenanceForArtifactHash);
  const contract: CurrentAgentSmithReleaseContract = {
    ...contractSubject,
    artifact_provenance: buildArtifactProvenance(input, subjectSha256, artifactSha256),
  };

  const validation = validateAgentSmithReleaseContract(contract);
  if (!validation.ok) {
    throw new ReleaseContractGenerationError(validation.failures);
  }

  return validation.value;
}

export function runReleaseContractCli(options: ReleaseContractCliOptions = {}): number {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((message: string) => console.log(message));
  const stderr = options.stderr ?? ((message: string) => console.error(message));

  try {
    const config = parseCliArgs(argv);
    const input = readInput(config.inputPath);
    const contract = generateAgentSmithReleaseContract(input, {
      sourceGitSha: resolveCliSourceGitSha(env),
    });
    writeJsonAtomically(config.outputPath, contract);
    stdout(`release contract: ${config.outputPath}`);
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function buildReleaseContractSubject(
  input: AgentSmithReleaseContractGeneratorInput,
  openapiDigest: string,
  asyncapiDigest: string,
): Omit<CurrentAgentSmithReleaseContract, 'artifact_provenance'> {
  return {
    schema_version: CURRENT_RELEASE_CONTRACT_SCHEMA_VERSION,
    product: 'agentsmith',
    release_id: input.release_id,
    git_sha: input.git_sha,
    product_images: input.product_images,
    adopted_provider_images: input.adopted_provider_images,
    release_kit_prerequisite_images: input.release_kit_prerequisite_images,
    managed_runner_image: { ...input.runnerImageLock.image },
    deploy_image_inventory: buildDeployImageInventory(input),
    deploy_template_digest: input.deploy_template_digest,
    deploy_template_package: input.deploy_template_package,
    openapi_digest: openapiDigest,
    asyncapi_digest: asyncapiDigest,
    required_product_flows: input.required_product_flows ?? [...CURRENT_REQUIRED_PRODUCT_FLOWS],
    target_profiles: input.target_profiles,
    substrate_connection_schema: CURRENT_SUBSTRATE_CONNECTION_SCHEMA_VERSION,
    min_release_kit_version: input.min_release_kit_version,
  };
}

function buildDeployImageInventory(
  input: Pick<
    AgentSmithReleaseContractGeneratorInput,
    'product_images' | 'adopted_provider_images' | 'release_kit_prerequisite_images' | 'runnerImageLock'
  >,
): CurrentReleaseInventoryImage[] {
  return [
    ...input.product_images.map((image) => ({ ...image, source: 'product_images' as const })),
    ...input.adopted_provider_images.map((image) => ({ ...image, source: 'adopted_provider_images' as const })),
    ...input.release_kit_prerequisite_images.map((image) => ({
      ...image,
      source: 'release_kit_prerequisite_images' as const,
    })),
    {
      id: CURRENT_MANAGED_RUNNER_RELEASE_INVENTORY_IMAGE_ID,
      image: input.runnerImageLock.image.image,
      digest: input.runnerImageLock.image.digest,
      source: 'managed_runner_image',
    },
  ];
}

function buildArtifactProvenance(
  input: AgentSmithReleaseContractGeneratorInput,
  subjectSha256: string,
  artifactSha256: string | typeof GENERATOR_ARTIFACT_SHA256_OMITTED,
): CurrentArtifactProvenance {
  return {
    schema_version: CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
    provenance_kind: 'ci_artifact',
    producer_repo: input.ci_provenance.producer_repo,
    normalized_remote: input.ci_provenance.normalized_remote,
    commit_sha: input.ci_provenance.commit_sha,
    subject_name: 'agentsmith-release-contract',
    subject_sha256: subjectSha256,
    subject_uri: input.ci_provenance.subject_uri ?? 'release-contract.json',
    workflow_name: input.ci_provenance.workflow_name,
    run_id: input.ci_provenance.run_id,
    run_attempt: input.ci_provenance.run_attempt,
    job: input.ci_provenance.job,
    artifact_uri: input.ci_provenance.artifact_uri,
    artifact_sha256: artifactSha256 === GENERATOR_ARTIFACT_SHA256_OMITTED
      ? `sha256:${'0'.repeat(64)}`
      : artifactSha256,
    generated_at: input.ci_provenance.generated_at,
    generator_command: input.ci_provenance.generator_command,
    generator_version: input.ci_provenance.generator_version,
    attestation: input.ci_provenance.attestation,
  };
}

function resolveSubjectDigest(
  input: AgentSmithReleaseContractGeneratorInput,
  subjectName: 'openapi' | 'asyncapi',
): string {
  const digestKey = `${subjectName}_digest` as const;
  const subjectKey = `${subjectName}_subject` as const;
  const digest = input[digestKey];
  const subject = input[subjectKey];

  if (subject === undefined) {
    throw new ReleaseContractGenerationError([
      {
        path: subjectKey,
        reason: `${subjectKey} is required.`,
      },
    ]);
  }

  const subjectDigest = sha256Digest(canonicalReleaseBoundaryJson(subject));
  if (digest !== undefined && digest !== subjectDigest) {
    throw new ReleaseContractGenerationError([
      {
        path: digestKey,
        reason: `${digestKey} must match ${subjectKey} canonical digest ${subjectDigest}.`,
      },
    ]);
  }

  return subjectDigest;
}

function validateGeneratorInput(
  input: AgentSmithReleaseContractGeneratorInput,
  sourceGitSha: string,
): CurrentReleaseBoundaryValidationFailure[] {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  const record = isRecord(input) ? input : null;
  if (!record) {
    return [
      {
        path: 'input',
        reason: 'release contract generator input must be an object.',
      },
    ];
  }

  if ('deploy_image_inventory' in record) {
    failures.push({
      path: 'deploy_image_inventory',
      reason: 'deploy_image_inventory must be generated, not provided by input.',
    });
  }
  if ('managed_runner_image' in record) {
    failures.push({
      path: 'managed_runner_image',
      reason: 'managed_runner_image must be assembled from runnerImageLock.',
    });
  }
  if ('artifact_provenance' in record) {
    failures.push({
      path: 'artifact_provenance',
      reason: 'artifact_provenance must be generated, not provided by input.',
    });
  }

  for (const field of REQUIRED_GENERATOR_ARRAY_FIELDS) {
    if (!Array.isArray(record[field])) {
      failures.push({
        path: field,
        reason: `${field} must be an array.`,
      });
    }
  }

  if (!isRecord(input.ci_provenance)) {
    failures.push({
      path: 'ci_provenance',
      reason: 'ci_provenance is required.',
    });
    return failures;
  }
  const gitSha = typeof record.git_sha === 'string' ? record.git_sha : undefined;
  if (gitSha && gitSha !== sourceGitSha) {
    failures.push({
      path: 'git_sha',
      reason: 'git_sha must match source git sha.',
    });
  }
  const ciCommitSha = input.ci_provenance.commit_sha;
  if (typeof ciCommitSha !== 'string' || ciCommitSha.trim().length === 0) {
    failures.push({
      path: 'ci_provenance.commit_sha',
      reason: 'ci_provenance.commit_sha must be a non-empty string.',
    });
  } else if (gitSha && ciCommitSha !== gitSha) {
    failures.push({
      path: 'ci_provenance.commit_sha',
      reason: 'ci_provenance.commit_sha must match git_sha.',
    });
  }
  const deployTemplatePackage = record.deploy_template_package;
  if (isRecord(deployTemplatePackage)) {
    const manifestSha256 = deployTemplatePackage.manifest_sha256;
    if (typeof manifestSha256 === 'string' && input.deploy_template_digest !== manifestSha256) {
      failures.push({
        path: 'deploy_template_package.manifest_sha256',
        reason: 'deploy_template_digest must match deploy_template_package.manifest_sha256.',
      });
    }

    const artifactProvenance = deployTemplatePackage.artifact_provenance;
    if (isRecord(artifactProvenance)) {
      const packageCommitSha = artifactProvenance.commit_sha;
      if (typeof packageCommitSha === 'string' && gitSha && packageCommitSha !== gitSha) {
        failures.push({
          path: 'deploy_template_package.artifact_provenance.commit_sha',
          reason: 'deploy_template_package.artifact_provenance.commit_sha must match git_sha.',
        });
      }
    }
  }

  if (!hasOwn(record, 'runnerImageLock')) {
    failures.push({
      path: 'runnerImageLock',
      reason: 'runnerImageLock is required.',
    });
  } else {
    const runnerImageLockValidation = validateRunnerImageLock(input.runnerImageLock);
    if (!runnerImageLockValidation.ok) {
      failures.push(...prefixValidationFailures('runnerImageLock', runnerImageLockValidation.failures));
    }
  }

  return failures;
}

function prefixValidationFailures(
  prefix: string,
  failures: readonly CurrentReleaseBoundaryValidationFailure[],
): CurrentReleaseBoundaryValidationFailure[] {
  return failures.map((failure) => ({
    path: failure.path === prefix ? prefix : `${prefix}.${failure.path}`,
    reason: failure.reason,
  }));
}

function resolveRequiredSourceGitSha(options: AgentSmithReleaseContractGenerationOptions): string {
  if (!isRecord(options) || typeof options.sourceGitSha !== 'string' || options.sourceGitSha.trim().length === 0) {
    throw new ReleaseContractGenerationError([
      {
        path: 'sourceGitSha',
        reason: 'sourceGitSha is required.',
      },
    ]);
  }

  return options.sourceGitSha.trim();
}

function resolveCliSourceGitSha(env: Readonly<Record<string, string | undefined>>): string {
  const envSourceGitSha = firstNonEmptyString(
    env.AGENTSMITH_RELEASE_CONTRACT_SOURCE_GIT_SHA,
    env.GITHUB_SHA,
  );
  if (envSourceGitSha) {
    return envSourceGitSha;
  }

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new Error('sourceGitSha is required; set AGENTSMITH_RELEASE_CONTRACT_SOURCE_GIT_SHA or GITHUB_SHA.');
  }
}

function firstNonEmptyString(...values: readonly (string | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function digestOmitArtifactShaProjection(value: CurrentAgentSmithReleaseContract): string {
  // artifact_sha256 is a deterministic projection digest: canonical JSON of the
  // final contract with artifact_provenance.artifact_sha256 omitted, avoiding a self-reference.
  return sha256Digest(canonicalReleaseBoundaryJson(omitArtifactSha256ForProjection(value)));
}

function omitArtifactSha256ForProjection(value: CurrentAgentSmithReleaseContract): unknown {
  const clone = structuredClone(value) as unknown as Record<string, unknown>;
  const provenance = clone.artifact_provenance;
  if (isRecord(provenance)) {
    delete provenance.artifact_sha256;
  }
  return clone;
}

function readInput(inputPath: string): AgentSmithReleaseContractGeneratorInput {
  return JSON.parse(readFileSync(inputPath, 'utf8')) as AgentSmithReleaseContractGeneratorInput;
}

function parseCliArgs(argv: readonly string[]): ReleaseContractCliConfig {
  let inputPath: string | undefined;
  let outputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--input':
        inputPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--output':
        outputPath = requireArgValue(argv, index);
        index += 1;
        break;
      default:
        throw new Error(`unsupported release contract argument: ${arg}`);
    }
  }

  if (!inputPath) {
    throw new Error('--input is required.');
  }
  if (!outputPath) {
    throw new Error('--output is required.');
  }

  return {
    inputPath: path.resolve(inputPath),
    outputPath: path.resolve(outputPath),
  };
}

function requireArgValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for ${argv[index]}.`);
  }
  return value;
}

function writeJsonAtomically(outputPath: string, value: unknown): void {
  const outputDir = path.dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });
  const tempPath = path.join(outputDir, `.${path.basename(outputPath)}.${process.pid}.tmp`);

  try {
    writeFileSync(tempPath, `${canonicalReleaseBoundaryJson(value)}\n`);
    renameSync(tempPath, outputPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function formatReleaseContractValidationError(
  failures: readonly CurrentReleaseBoundaryValidationFailure[],
): string {
  return [
    'release contract generation failed:',
    ...failures.map((failure) => `- ${failure.path}: ${failure.reason}`),
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runReleaseContractCli());
}
