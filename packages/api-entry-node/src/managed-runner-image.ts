const MANAGED_RUNNER_IMAGE_ENV_KEYS = [
  'INTERNAL_AGENT_IMAGE',
  'INTEGRATION_INTERNAL_AGENT_IMAGE',
  'MANAGED_RUNNER_IMAGE',
] as const;

const SHA256_DIGEST_RE = /sha256:[a-f0-9]{64}/i;
const IMAGE_REF_DIGEST_RE = /@sha256:[a-f0-9]{64}$/i;

export type ManagedRunnerImageEnvKey = typeof MANAGED_RUNNER_IMAGE_ENV_KEYS[number];
export type ManagedRunnerImageErrorCode =
  | 'AGENT_RUNNER_IMAGE_UNCONFIGURED'
  | 'AGENT_RUNNER_IMAGE_INVALID';

export interface ManagedRunnerImageResolution {
  image: string;
  digest: string;
  source: string;
  localKind: boolean;
}

export class ManagedRunnerImageError extends Error {
  code: ManagedRunnerImageErrorCode;
  reason: string;
  source?: string;
  image?: string;

  constructor(input: {
    code: ManagedRunnerImageErrorCode;
    reason: string;
    message: string;
    source?: string;
    image?: string;
  }) {
    super(input.message);
    this.name = 'ManagedRunnerImageError';
    this.code = input.code;
    this.reason = input.reason;
    if (input.source) this.source = input.source;
    if (input.image) this.image = input.image;
  }
}

function managedRunnerImageEnvList(): string {
  return MANAGED_RUNNER_IMAGE_ENV_KEYS.join(', ');
}

function imageRefBeforeDigest(image: string): string {
  return image.split('@')[0] ?? image;
}

function imageRefTag(image: string): string | null {
  const beforeDigest = imageRefBeforeDigest(image);
  const slashIndex = beforeDigest.lastIndexOf('/');
  const colonIndex = beforeDigest.lastIndexOf(':');
  if (colonIndex <= slashIndex) {
    return null;
  }
  return beforeDigest.slice(colonIndex + 1);
}

function isLocalKindImage(image: string): boolean {
  const beforeDigest = imageRefBeforeDigest(image).toLowerCase();
  return beforeDigest.startsWith('localhost:')
    || beforeDigest.startsWith('127.0.0.1:')
    || beforeDigest.startsWith('kind-registry:')
    || beforeDigest.includes('/kind-registry:');
}

function buildInvalidImageError(input: {
  reason: string;
  source: string;
  image: string;
  detail: string;
}): ManagedRunnerImageError {
  return new ManagedRunnerImageError({
    code: 'AGENT_RUNNER_IMAGE_INVALID',
    reason: input.reason,
    source: input.source,
    image: input.image,
    message: `${input.reason}: ${input.source} ${input.detail}: ${input.image}`,
  });
}

export function extractImageDigest(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.match(SHA256_DIGEST_RE)?.[0].toLowerCase() ?? null;
}

export function resolveManagedRunnerImageRef(
  imageRef: string | undefined | null,
  source = 'managed_runner_image',
): ManagedRunnerImageResolution {
  const rawImage = imageRef ?? '';
  const image = rawImage.trim();
  if (!image) {
    throw new ManagedRunnerImageError({
      code: 'AGENT_RUNNER_IMAGE_UNCONFIGURED',
      reason: 'managed_runner_image_unconfigured',
      source,
      message: `managed_runner_image_unconfigured: set ${managedRunnerImageEnvList()} to a digest-pinned managed runner image`,
    });
  }

  const imageBeforeDigest = imageRefBeforeDigest(image);
  if (/\s/.test(rawImage) || imageBeforeDigest.length === 0 || image.startsWith('@')) {
    throw buildInvalidImageError({
      reason: 'managed_runner_image_ref_invalid',
      source,
      image,
      detail: 'must have a repository before @sha256 and contain no whitespace',
    });
  }

  if (image.toLowerCase().includes('agent-task-runner')) {
    throw buildInvalidImageError({
      reason: 'managed_runner_image_legacy_ref_rejected',
      source,
      image,
      detail: 'must not reference the legacy agent-task-runner image',
    });
  }

  const tag = imageRefTag(image);
  if (tag?.toLowerCase() === 'latest') {
    throw buildInvalidImageError({
      reason: 'managed_runner_image_latest_rejected',
      source,
      image,
      detail: 'must not use :latest',
    });
  }

  const digest = image.match(IMAGE_REF_DIGEST_RE)?.[0].slice(1).toLowerCase();
  if (!digest) {
    throw buildInvalidImageError({
      reason: 'managed_runner_image_digest_required',
      source,
      image,
      detail: 'must be pinned with @sha256:<digest>',
    });
  }

  return {
    image,
    digest,
    source,
    localKind: isLocalKindImage(image),
  };
}

export function resolveManagedRunnerImageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ManagedRunnerImageResolution {
  for (const key of MANAGED_RUNNER_IMAGE_ENV_KEYS) {
    const value = env[key];
    if (value?.trim()) {
      return resolveManagedRunnerImageRef(value, key);
    }
  }
  throw new ManagedRunnerImageError({
    code: 'AGENT_RUNNER_IMAGE_UNCONFIGURED',
    reason: 'managed_runner_image_unconfigured',
    message: `managed_runner_image_unconfigured: set ${managedRunnerImageEnvList()} to a digest-pinned managed runner image`,
  });
}
