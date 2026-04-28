import { createHash } from 'node:crypto';

import {
  CURRENT_BUILD_MANIFEST_AGGREGATE_SCHEMA,
  CURRENT_BUILD_MANIFEST_AGGREGATE_VERSION,
  type CurrentBuildArtifactTarget,
  type CurrentBuildManifestAggregate,
  type CurrentBuildManifestMode,
  type CurrentBuildManifestProducer,
  type CurrentBuildManifestTarget,
  type CurrentBuildManifestTargetDecision,
} from './current-build-artifact-broker-schema';

export const BUILD_ARTIFACT_PREBUILD_PLAN_SCHEMA = 'build-artifact-broker-prebuild-plan.v1' as const;
export const BUILD_ARTIFACT_PREBUILD_PLAN_VERSION = 1 as const;

export {
  CURRENT_BUILD_ARTIFACT_TARGETS,
  CURRENT_BUILD_FORBIDDEN_EVIDENCE_TRUTH_FIELDS,
  CURRENT_BUILD_MANIFEST_AGGREGATE_SCHEMA,
  CURRENT_BUILD_MANIFEST_AGGREGATE_VERSION,
  CURRENT_BUILD_MANIFEST_MODES,
  CURRENT_BUILD_MANIFEST_TARGET_DECISIONS,
  CURRENT_BUILD_SKIP_DECISION_SCHEMA,
  CURRENT_BUILD_SKIP_DECISION_VERSION,
  CURRENT_BUILD_SKIP_OPERATIONS,
  validateBuildManifestAggregate,
  validateBuildSkipDecision,
  type CurrentBuildArtifactTarget,
  type CurrentBuildManifestAggregate,
  type CurrentBuildManifestMode,
  type CurrentBuildManifestProducer,
  type CurrentBuildManifestTarget,
  type CurrentBuildManifestTargetDecision,
  type CurrentBuildSkipDecision,
} from './current-build-artifact-broker-schema';

export interface BuildArtifactBrokerFileInput {
  path: string;
  content: string;
}

export interface BuildArtifactBrokerSelectedInput {
  path: string;
  kind: 'file' | 'env' | 'base_image';
  digest: string;
}

export interface BuildArtifactContentKeyResult {
  target: CurrentBuildArtifactTarget;
  content_key: string;
  input_digest: string;
  base_image_digest: string;
  selected_inputs: readonly BuildArtifactBrokerSelectedInput[];
}

export interface ComputeContentKeyArgs {
  files: readonly BuildArtifactBrokerFileInput[];
  env?: Readonly<Record<string, string | undefined>>;
  baseImages?: readonly string[];
  platform?: string;
  releaseProfile?: string;
}

export interface LockedImageRef {
  image: string;
  tag: string | null;
  digest: string;
  ref: string;
}

export interface ParsedBaseDependencyImageLockEntry extends LockedImageRef {
  id: string;
}

export interface BuildArtifactBrokerParseFailure {
  path: string;
  reason: string;
}

export type LockedImageRefParseResult =
  | {
      ok: true;
      value: LockedImageRef;
    }
  | {
      ok: false;
      reason: string;
    };

export type BaseDependencyImageLockParseResult =
  | {
      ok: true;
      entries: readonly ParsedBaseDependencyImageLockEntry[];
    }
  | {
      ok: false;
      failures: readonly BuildArtifactBrokerParseFailure[];
    };

export type ReleaseIdTruthValidationResult =
  | {
      ok: true;
      release_id: string;
      version_path: string;
    }
  | {
      ok: false;
      failures: readonly BuildArtifactBrokerParseFailure[];
    };

export interface BuildArtifactPrebuildPlanTarget {
  target: CurrentBuildArtifactTarget;
  release_id: string;
  content_key: string;
  content_ref: string;
  release_alias_ref: string;
  input_digest: string;
  base_image_digest: string;
  producer: CurrentBuildManifestProducer;
  generated_at: string;
}

export interface BuildArtifactPrebuildPlan {
  schema: typeof BUILD_ARTIFACT_PREBUILD_PLAN_SCHEMA;
  version: typeof BUILD_ARTIFACT_PREBUILD_PLAN_VERSION;
  plan_kind: 'build_prebuild_plan';
  run_id: string;
  release_id: string;
  version_path: string;
  mode: CurrentBuildManifestMode;
  producer: CurrentBuildManifestProducer;
  generated_at: string;
  targets: readonly BuildArtifactPrebuildPlanTarget[];
}

interface NormalizedDigestInput {
  path: string;
  kind: BuildArtifactBrokerSelectedInput['kind'];
  digest: string;
}

interface BuildManifestTargetArgs {
  target: CurrentBuildArtifactTarget;
  releaseId: string;
  imageName: string;
  contentKey: BuildArtifactContentKeyResult;
  imageDigest: string;
  decision: CurrentBuildManifestTargetDecision;
  producer: CurrentBuildManifestProducer;
  generatedAt: string;
}

interface BuildPrebuildPlanTargetArgs {
  target: CurrentBuildArtifactTarget;
  releaseId: string;
  imageName: string;
  contentKey: BuildArtifactContentKeyResult;
  producer: CurrentBuildManifestProducer;
  generatedAt: string;
}

interface BuildManifestAggregateArgs {
  runId: string;
  releaseId: string;
  versionPath: string;
  mode: CurrentBuildManifestMode;
  producer: CurrentBuildManifestProducer;
  targets: readonly CurrentBuildManifestTarget[];
  generatedAt: string;
}

interface BuildPrebuildPlanAggregateArgs {
  runId: string;
  releaseId: string;
  versionPath: string;
  mode: CurrentBuildManifestMode;
  producer: CurrentBuildManifestProducer;
  targets: readonly BuildArtifactPrebuildPlanTarget[];
  generatedAt: string;
}

const APP_IMAGE_ROOT_FILES = new Set([
  'package.json',
  'package-lock.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'next-env.d.ts',
  'tailwind.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'postcss.config.mjs',
  'tsconfig.json',
  'components.json',
]);
const LLMUP_RUNTIME_ROOT_FILES = new Set([
  'Cargo.toml',
  'Cargo.lock',
  'rust-toolchain',
  'rust-toolchain.toml',
  'Dockerfile',
]);

export function computeAppImageContentKey(args: ComputeContentKeyArgs): BuildArtifactContentKeyResult {
  return computeContentKey({
    ...args,
    target: 'app',
    fileSelector: isAppImageInputPath,
  });
}

export function computeLlmupRuntimeContentKey(args: ComputeContentKeyArgs): BuildArtifactContentKeyResult {
  return computeContentKey({
    ...args,
    target: 'llmup',
    fileSelector: isLlmupRuntimeInputPath,
  });
}

export function parseLockedImageRef(ref: string): LockedImageRefParseResult {
  const trimmed = ref.trim();

  if (trimmed === '') {
    return {
      ok: false,
      reason: 'image ref must not be empty.',
    };
  }

  const digestMatch = trimmed.match(/@(?<digest>sha256:[a-fA-F0-9]{64})$/);
  if (!digestMatch?.groups?.digest) {
    return {
      ok: false,
      reason: 'image ref must include a sha256 digest.',
    };
  }

  const refWithoutDigest = trimmed.slice(0, trimmed.length - digestMatch[0].length);
  if (refWithoutDigest === '') {
    return {
      ok: false,
      reason: 'image ref must include an image name.',
    };
  }

  const lastSlashIndex = refWithoutDigest.lastIndexOf('/');
  const lastColonIndex = refWithoutDigest.lastIndexOf(':');
  const hasTag = lastColonIndex > lastSlashIndex;
  const tag = hasTag ? refWithoutDigest.slice(lastColonIndex + 1) : null;
  const image = hasTag ? refWithoutDigest.slice(0, lastColonIndex) : refWithoutDigest;

  if (image.trim() === '') {
    return {
      ok: false,
      reason: 'image ref must include an image name.',
    };
  }
  if (tag?.toLowerCase() === 'latest') {
    return {
      ok: false,
      reason: 'latest tag is not allowed in base/dependency image locks.',
    };
  }
  if (tag !== null && tag.trim() === '') {
    return {
      ok: false,
      reason: 'image tag must not be empty when present.',
    };
  }

  return {
    ok: true,
    value: {
      image,
      tag,
      digest: digestMatch.groups.digest.toLowerCase(),
      ref: trimmed,
    },
  };
}

export function parseBaseDependencyImageLock(text: string): BaseDependencyImageLockParseResult {
  const failures: BuildArtifactBrokerParseFailure[] = [];
  const entries: ParsedBaseDependencyImageLockEntry[] = [];
  const seenIds = new Set<string>();

  text.split(/\r?\n/u).forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();

    if (line === '' || line.startsWith('#')) {
      return;
    }

    const parsedLine = parseImageLockLine(line, lineIndex + 1);
    if (seenIds.has(parsedLine.id)) {
      failures.push({
        path: `line ${lineIndex + 1}`,
        reason: `duplicate base/dependency image lock id: ${parsedLine.id}.`,
      });
      return;
    }
    seenIds.add(parsedLine.id);

    const parsedRef = parseLockedImageRef(parsedLine.ref);

    if (!parsedRef.ok) {
      failures.push({
        path: `line ${lineIndex + 1}`,
        reason: parsedRef.reason,
      });
      return;
    }

    entries.push({
      id: parsedLine.id,
      ...parsedRef.value,
    });
  });

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    entries: entries.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function validateReleaseIdTruth(args: {
  versionContent: string;
  envReleaseId?: string;
  stateReleaseId?: string;
  versionPath?: string;
}): ReleaseIdTruthValidationResult {
  const failures: BuildArtifactBrokerParseFailure[] = [];
  const versionPath = args.versionPath ?? 'VERSION';
  const versionValues = parseVersionKeyValue(args.versionContent);
  const releaseId = versionValues.get('release_id')?.trim();

  if (!releaseId) {
    failures.push({
      path: `${versionPath}.release_id`,
      reason: 'VERSION.release_id is required.',
    });
  }
  if (releaseId && args.envReleaseId !== undefined && args.envReleaseId !== releaseId) {
    failures.push({
      path: 'env.RELEASE_ID',
      reason: 'RELEASE_ID must match VERSION.release_id.',
    });
  }
  if (releaseId && args.stateReleaseId !== undefined && args.stateReleaseId !== releaseId) {
    failures.push({
      path: 'state.release.id',
      reason: 'state.release.id must match VERSION.release_id.',
    });
  }

  if (failures.length > 0 || !releaseId) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    release_id: releaseId,
    version_path: versionPath,
  };
}

export function normalizeReleaseAliasTag(releaseId: string): string {
  const normalizedReleaseId = releaseId.trim();

  return normalizedReleaseId.startsWith('release-') ? normalizedReleaseId : `release-${normalizedReleaseId}`;
}

export function buildBuildManifestTarget(args: BuildManifestTargetArgs): CurrentBuildManifestTarget {
  const releaseAliasTag = normalizeReleaseAliasTag(args.releaseId);

  return {
    target: args.target,
    release_id: args.releaseId,
    content_ref: `${args.imageName}:${args.contentKey.content_key}`,
    release_alias_ref: `${args.imageName}:${releaseAliasTag}`,
    image_digest: args.imageDigest,
    input_digest: args.contentKey.input_digest,
    base_image_digest: args.contentKey.base_image_digest,
    decision: args.decision,
    producer: args.producer,
    generated_at: args.generatedAt,
  };
}

export function buildBuildPrebuildPlanTarget(args: BuildPrebuildPlanTargetArgs): BuildArtifactPrebuildPlanTarget {
  const releaseAliasTag = normalizeReleaseAliasTag(args.releaseId);

  return {
    target: args.target,
    release_id: args.releaseId,
    content_key: args.contentKey.content_key,
    content_ref: `${args.imageName}:${args.contentKey.content_key}`,
    release_alias_ref: `${args.imageName}:${releaseAliasTag}`,
    input_digest: args.contentKey.input_digest,
    base_image_digest: args.contentKey.base_image_digest,
    producer: args.producer,
    generated_at: args.generatedAt,
  };
}

export function buildBuildManifestAggregate(args: BuildManifestAggregateArgs): CurrentBuildManifestAggregate {
  return {
    schema: CURRENT_BUILD_MANIFEST_AGGREGATE_SCHEMA,
    version: CURRENT_BUILD_MANIFEST_AGGREGATE_VERSION,
    manifest_kind: 'build_manifest_aggregate',
    run_id: args.runId,
    release_id: args.releaseId,
    version_path: args.versionPath,
    mode: args.mode,
    producer: args.producer,
    generated_at: args.generatedAt,
    targets: args.targets,
  };
}

export function buildBuildPrebuildPlanAggregate(args: BuildPrebuildPlanAggregateArgs): BuildArtifactPrebuildPlan {
  return {
    schema: BUILD_ARTIFACT_PREBUILD_PLAN_SCHEMA,
    version: BUILD_ARTIFACT_PREBUILD_PLAN_VERSION,
    plan_kind: 'build_prebuild_plan',
    run_id: args.runId,
    release_id: args.releaseId,
    version_path: args.versionPath,
    mode: args.mode,
    producer: args.producer,
    generated_at: args.generatedAt,
    targets: args.targets,
  };
}

function computeContentKey(args: ComputeContentKeyArgs & {
  target: CurrentBuildArtifactTarget;
  fileSelector: (path: string) => boolean;
}): BuildArtifactContentKeyResult {
  const fileInputs = args.files
    .map((file) => ({
      path: normalizeInputPath(file.path),
      kind: 'file' as const,
      digest: digestForValue(file.content),
    }))
    .filter((file) => args.fileSelector(file.path));
  const envInputs = Object.entries(args.env ?? {})
    .filter(([key, value]) => key.startsWith('NEXT_PUBLIC_') && value !== undefined)
    .map(([key, value]) => ({
      path: `env:${key}`,
      kind: 'env' as const,
      digest: digestForValue(value ?? ''),
    }));
  const baseImageInputs = normalizeBaseImageInputs(args.baseImages ?? []);
  const selectedInputs = [...fileInputs, ...envInputs, ...baseImageInputs].sort(compareSelectedInputs);
  const digestPayload = {
    target: args.target,
    platform: args.platform ?? 'linux/amd64',
    release_profile: args.releaseProfile ?? 'release',
    inputs: selectedInputs,
  };
  const inputDigest = digestForValue(stableStringify(digestPayload));

  return {
    target: args.target,
    content_key: `ck-${inputDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`,
    input_digest: inputDigest,
    base_image_digest: digestForValue(stableStringify(baseImageInputs)),
    selected_inputs: selectedInputs,
  };
}

function normalizeBaseImageInputs(baseImages: readonly string[]): readonly NormalizedDigestInput[] {
  return baseImages.map((ref) => {
    const parsed = parseLockedImageRef(ref);

    if (!parsed.ok) {
      throw new Error(`Fail-closed base/dependency image lock: ${parsed.reason}`);
    }

    return {
      path: `image:${parsed.value.image}`,
      kind: 'base_image' as const,
      digest: digestForValue(stableStringify(parsed.value)),
    };
  });
}

function isAppImageInputPath(path: string): boolean {
  return APP_IMAGE_ROOT_FILES.has(path)
    || path.startsWith('src/')
    || path.startsWith('messages/')
    || path.startsWith('config/')
    || path.startsWith('public/')
    || path.startsWith('packages/')
    || path.startsWith('assets/')
    || path.startsWith('scripts/')
    || path.startsWith('infra/');
}

function isLlmupRuntimeInputPath(path: string): boolean {
  return LLMUP_RUNTIME_ROOT_FILES.has(path) || path.startsWith('src/');
}

function normalizeInputPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function compareSelectedInputs(left: NormalizedDigestInput, right: NormalizedDigestInput): number {
  const pathCompare = left.path.localeCompare(right.path);

  if (pathCompare !== 0) {
    return pathCompare;
  }

  return left.digest.localeCompare(right.digest);
}

function parseImageLockLine(line: string, oneBasedLineNumber: number): { id: string; ref: string } {
  const equalsIndex = line.indexOf('=');

  if (equalsIndex > 0) {
    return {
      id: line.slice(0, equalsIndex).trim(),
      ref: line.slice(equalsIndex + 1).trim(),
    };
  }

  const fields = line.split(/\s+/u);

  if (fields.length >= 2) {
    return {
      id: fields[0],
      ref: fields.slice(1).join(' '),
    };
  }

  return {
    id: `image-${oneBasedLineNumber}`,
    ref: line,
  };
}

function parseVersionKeyValue(text: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();

  text.split(/\r?\n/u).forEach((rawLine) => {
    const line = rawLine.trim();

    if (line === '' || line.startsWith('#')) {
      return;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      return;
    }

    values.set(line.slice(0, equalsIndex).trim(), line.slice(equalsIndex + 1).trim());
  });

  return values;
}

function digestForValue(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJsonValue(value[key])]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
