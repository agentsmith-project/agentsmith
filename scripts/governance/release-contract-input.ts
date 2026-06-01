import {
  CURRENT_BUILD_PRODUCT_IMAGE_IDS,
  normalizeReleaseAliasTag,
  validateBuildManifestAggregate,
  type CurrentBuildManifestTarget,
} from './build-artifact-broker';
import {
  validateRunnerImageLock,
  type CurrentDeploymentTargetProfile,
  type CurrentDeployTemplatePackage,
  type CurrentReleaseBoundaryValidationFailure,
  type CurrentReleaseImage,
  type CurrentReleaseImageSourceProvenanceBinding,
  type CurrentRunnerImageLock,
} from './current-release-boundary-schema';
import type {
  AgentSmithReleaseContractCiProvenanceInput,
  AgentSmithReleaseContractGeneratorInput,
} from './release-contract';

const AGENTSMITH_APP_PRODUCT_IMAGE_ID = CURRENT_BUILD_PRODUCT_IMAGE_IDS[0];
const FORBIDDEN_ASSEMBLY_INPUT_FIELDS = [
  'product_images',
  'managed_runner_image',
  'deploy_template_digest',
  'deploy_image_inventory',
  'image_source_provenance',
  'artifact_provenance',
] as const;
const REQUIRED_CI_PROVENANCE_STRING_FIELDS = [
  'producer_repo',
  'normalized_remote',
  'commit_sha',
  'workflow_name',
  'run_id',
  'run_attempt',
  'job',
  'artifact_uri',
  'generated_at',
  'generator_command',
  'generator_version',
] as const satisfies readonly (keyof AgentSmithReleaseContractCiProvenanceInput)[];

export interface BuildProductImagesFromBuildManifestOptions {
  expectedReleaseId: string;
}

export interface AgentSmithReleaseContractGeneratorInputAssemblyInput {
  release_id: string;
  git_sha: string;
  sourceGitSha: string;
  buildManifestAggregate: unknown;
  deployTemplatePackage: CurrentDeployTemplatePackage;
  openapi_subject: unknown;
  openapi_digest?: string;
  asyncapi_subject: unknown;
  asyncapi_digest?: string;
  adopted_provider_images: readonly CurrentReleaseImage[];
  release_kit_prerequisite_images: readonly CurrentReleaseImage[];
  external_image_source_provenance?: readonly CurrentReleaseImageSourceProvenanceBinding[];
  runnerImageLock: CurrentRunnerImageLock;
  required_product_flows?: readonly string[];
  target_profiles: readonly CurrentDeploymentTargetProfile[];
  min_release_kit_version: string;
  ci_provenance: AgentSmithReleaseContractCiProvenanceInput;
}

export function assembleReleaseContractGeneratorInput(
  input: AgentSmithReleaseContractGeneratorInputAssemblyInput,
): AgentSmithReleaseContractGeneratorInput {
  assertAssemblyInputShape(input);
  assertNoGeneratorOwnedInputFields(input);

  const releaseId = requireNonEmptyString(input.release_id, 'release_id');
  const gitSha = requireNonEmptyString(input.git_sha, 'git_sha');
  const sourceGitSha = requireNonEmptyString(input.sourceGitSha, 'sourceGitSha');
  if (gitSha !== sourceGitSha) {
    throw new Error('git_sha must match sourceGitSha.');
  }

  const appTarget = resolveBuildManifestAppTarget(input.buildManifestAggregate, {
    expectedReleaseId: releaseId,
  });
  const appProductImages = buildProductImagesFromAppTarget(appTarget);
  const runnerImageLock = resolveRunnerImageLock(input.runnerImageLock);

  const deployTemplatePackage = input.deployTemplatePackage;
  const deployTemplateDigest = requireNonEmptyString(
    deployTemplatePackage.manifest_sha256,
    'deployTemplatePackage.manifest_sha256',
  );
  const deployTemplatePackageCommitSha = requireNonEmptyString(
    deployTemplatePackage.artifact_provenance.commit_sha,
    'deployTemplatePackage.artifact_provenance.commit_sha',
  );
  if (deployTemplatePackageCommitSha !== gitSha) {
    throw new Error('deployTemplatePackage.artifact_provenance.commit_sha must match git_sha.');
  }

  validateCiProvenanceBinding(input.ci_provenance, gitSha);

  return {
    release_id: releaseId,
    git_sha: gitSha,
    product_images: appProductImages,
    adopted_provider_images: input.adopted_provider_images,
    release_kit_prerequisite_images: input.release_kit_prerequisite_images,
    image_source_provenance: [
      buildAppImageSourceProvenance(appTarget, deployTemplatePackage.artifact_provenance),
      ...resolveExternalImageSourceProvenance(input.external_image_source_provenance),
    ],
    runnerImageLock,
    deploy_template_digest: deployTemplateDigest,
    deploy_template_package: deployTemplatePackage,
    openapi_subject: input.openapi_subject,
    openapi_digest: input.openapi_digest,
    asyncapi_subject: input.asyncapi_subject,
    asyncapi_digest: input.asyncapi_digest,
    required_product_flows: input.required_product_flows,
    target_profiles: input.target_profiles,
    min_release_kit_version: input.min_release_kit_version,
    ci_provenance: input.ci_provenance,
  };
}

export function buildProductImagesFromBuildManifest(
  buildManifestAggregate: unknown,
  options: BuildProductImagesFromBuildManifestOptions,
): CurrentReleaseImage[] {
  return buildProductImagesFromAppTarget(resolveBuildManifestAppTarget(buildManifestAggregate, options));
}

function resolveBuildManifestAppTarget(
  buildManifestAggregate: unknown,
  options: BuildProductImagesFromBuildManifestOptions,
): CurrentBuildManifestTarget {
  const expectedReleaseId = resolveExpectedReleaseId(options);
  const appTargetCandidates = findRawAppTargets(buildManifestAggregate);
  if (appTargetCandidates && appTargetCandidates.length !== 1) {
    throw new Error('build manifest must contain exactly one app target.');
  }

  const rawAppTarget = appTargetCandidates?.[0];
  if (
    rawAppTarget
    && typeof rawAppTarget.release_alias_ref === 'string'
    && containsDigest(rawAppTarget.release_alias_ref)
  ) {
    throw new Error('build manifest app target release_alias_ref must not include a digest.');
  }

  const validation = validateBuildManifestAggregate(buildManifestAggregate);
  if (!validation.ok) {
    throw new Error(formatBuildManifestValidationError(validation.failures));
  }

  const appTargets = validation.value.targets.filter((target) => target.target === 'app');
  if (appTargets.length !== 1) {
    throw new Error('build manifest must contain exactly one app target.');
  }
  const appTarget = appTargets[0];
  if (!appTarget) {
    throw new Error('build manifest must contain exactly one app target.');
  }
  if (appTarget.release_id !== expectedReleaseId) {
    throw new Error('build manifest app target release_id must match expected release_id.');
  }
  if (extractImageReferenceTag(appTarget.release_alias_ref) !== normalizeReleaseAliasTag(expectedReleaseId)) {
    throw new Error('build manifest app target release_alias_ref must match expected release_id.');
  }

  return appTarget;
}

function buildProductImagesFromAppTarget(target: CurrentBuildManifestTarget): CurrentReleaseImage[] {
  const image = `${target.release_alias_ref}@${target.image_digest}`;

  return [{
    id: AGENTSMITH_APP_PRODUCT_IMAGE_ID,
    image,
    digest: target.image_digest,
  }];
}

function assertAssemblyInputShape(
  input: AgentSmithReleaseContractGeneratorInputAssemblyInput,
): asserts input is AgentSmithReleaseContractGeneratorInputAssemblyInput {
  if (!isRecord(input)) {
    throw new Error('release contract generator input assembly input must be an object.');
  }
  if (!isRecord(input.deployTemplatePackage)) {
    throw new Error('deployTemplatePackage must be an object.');
  }
  if (!isRecord(input.deployTemplatePackage.artifact_provenance)) {
    throw new Error('deployTemplatePackage.artifact_provenance must be an object.');
  }
  if (!Object.hasOwn(input, 'runnerImageLock')) {
    throw new Error('runnerImageLock is required.');
  }
  if (!isRecord(input.runnerImageLock)) {
    throw new Error('runnerImageLock must be an object.');
  }
  if (!isRecord(input.ci_provenance)) {
    throw new Error('ci_provenance must be an object.');
  }
}

function assertNoGeneratorOwnedInputFields(
  input: AgentSmithReleaseContractGeneratorInputAssemblyInput,
): void {
  const record = input as unknown as Record<string, unknown>;
  for (const field of FORBIDDEN_ASSEMBLY_INPUT_FIELDS) {
    if (!Object.hasOwn(record, field)) {
      continue;
    }

    switch (field) {
      case 'product_images':
        throw new Error('product_images must be assembled from buildManifestAggregate.');
      case 'managed_runner_image':
        throw new Error('managed_runner_image must be assembled from runnerImageLock.');
      case 'deploy_template_digest':
        throw new Error('deploy_template_digest must be assembled from deployTemplatePackage.manifest_sha256.');
      case 'deploy_image_inventory':
        throw new Error('deploy_image_inventory must be generated by release contract generator.');
      case 'image_source_provenance':
        throw new Error('image_source_provenance must be assembled from release source receipts.');
      case 'artifact_provenance':
        throw new Error('artifact_provenance must be generated by release contract generator.');
    }
  }
}

function resolveRunnerImageLock(value: CurrentRunnerImageLock): CurrentRunnerImageLock {
  const validation = validateRunnerImageLock(value);
  if (!validation.ok) {
    throw new Error(formatReleaseBoundaryValidationFailures('runnerImageLock', validation.failures));
  }

  return validation.value;
}

function buildAppImageSourceProvenance(
  appTarget: CurrentBuildManifestTarget,
  provenance: CurrentDeployTemplatePackage['artifact_provenance'],
): CurrentReleaseImageSourceProvenanceBinding {
  return {
    image_id: AGENTSMITH_APP_PRODUCT_IMAGE_ID,
    producer_repo: requireNonEmptyString(provenance.producer_repo, 'deployTemplatePackage.artifact_provenance.producer_repo'),
    normalized_remote: requireNonEmptyString(
      provenance.normalized_remote,
      'deployTemplatePackage.artifact_provenance.normalized_remote',
    ),
    commit_sha: requireNonEmptyString(provenance.commit_sha, 'deployTemplatePackage.artifact_provenance.commit_sha'),
    tag: requireNonEmptyString(
      extractImageReferenceTag(appTarget.release_alias_ref),
      'build manifest app target release_alias_ref tag',
    ),
    run_id: requireNonEmptyString(provenance.run_id, 'deployTemplatePackage.artifact_provenance.run_id'),
    run_attempt: requireNonEmptyString(
      provenance.run_attempt,
      'deployTemplatePackage.artifact_provenance.run_attempt',
    ),
    artifact_sha256: appTarget.image_digest,
  };
}

function resolveExternalImageSourceProvenance(
  value: readonly CurrentReleaseImageSourceProvenanceBinding[] | undefined,
): readonly CurrentReleaseImageSourceProvenanceBinding[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('external_image_source_provenance must be an array.');
  }

  return value;
}

function formatReleaseBoundaryValidationFailures(
  prefix: string,
  failures: readonly CurrentReleaseBoundaryValidationFailure[],
): string {
  return failures
    .map((failure) => `${prefix}.${failure.path}: ${failure.reason}`)
    .join('\n');
}

function validateCiProvenanceBinding(
  ciProvenance: AgentSmithReleaseContractCiProvenanceInput,
  gitSha: string,
): void {
  for (const field of REQUIRED_CI_PROVENANCE_STRING_FIELDS) {
    if (!Object.hasOwn(ciProvenance, field)) {
      throw new Error(`ci_provenance.${field} must be a non-empty string.`);
    }
    requireNonEmptyString(ciProvenance[field], `ci_provenance.${field}`);
  }
  if (!Object.hasOwn(ciProvenance, 'attestation') || ciProvenance.attestation === undefined) {
    throw new Error('ci_provenance.attestation is required.');
  }
  if (ciProvenance.commit_sha !== gitSha) {
    throw new Error('ci_provenance.commit_sha must match git_sha.');
  }
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }

  return value;
}

function resolveExpectedReleaseId(options: BuildProductImagesFromBuildManifestOptions): string {
  if (!isRecord(options)) {
    throw new Error('build manifest expected release_id binding is required.');
  }

  return requireNonEmptyString(options.expectedReleaseId, 'expected release_id');
}

function findRawAppTargets(value: unknown): readonly Record<string, unknown>[] | null {
  if (!isRecord(value) || !Array.isArray(value.targets)) {
    return null;
  }

  return value.targets.filter((target): target is Record<string, unknown> => {
    return isRecord(target) && target.target === 'app';
  });
}

function containsDigest(value: string): boolean {
  return value.includes('@sha256:');
}

function extractImageReferenceTag(value: string): string | null {
  const lastSlashIndex = value.lastIndexOf('/');
  const lastColonIndex = value.lastIndexOf(':');

  if (lastColonIndex <= lastSlashIndex) {
    return null;
  }

  return value.slice(lastColonIndex + 1);
}

function formatBuildManifestValidationError(
  failures: readonly { path: string; reason: string }[],
): string {
  return [
    'build manifest aggregate is invalid:',
    ...failures.map((failure) => `- ${failure.path}: ${failure.reason}`),
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
