import { validateBuildManifestAggregate, type CurrentBuildManifestTarget } from './build-artifact-broker';
import type { CurrentReleaseImage } from './current-release-boundary-schema';

const PRODUCT_IMAGE_IDS = ['web', 'api', 'product_schema_bootstrap'] as const;

export function buildProductImagesFromBuildManifest(buildManifestAggregate: unknown): CurrentReleaseImage[] {
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

  return buildProductImagesFromAppTarget(appTarget);
}

function buildProductImagesFromAppTarget(target: CurrentBuildManifestTarget): CurrentReleaseImage[] {
  const image = `${target.release_alias_ref}@${target.image_digest}`;

  return PRODUCT_IMAGE_IDS.map((id) => ({
    id,
    image,
    digest: target.image_digest,
  }));
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
