import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CURRENT_BUILD_MANIFEST_AGGREGATE_SCHEMA,
  CURRENT_BUILD_MANIFEST_AGGREGATE_VERSION,
  CURRENT_BUILD_MANIFEST_MODES,
  CURRENT_BUILD_MANIFEST_TARGET_DECISIONS,
  CURRENT_BUILD_SKIP_DECISION_SCHEMA,
  CURRENT_BUILD_SKIP_DECISION_VERSION,
  buildBuildManifestAggregate,
  buildBuildManifestTarget,
  computeAppImageContentKey,
  computeLlmupRuntimeContentKey,
  normalizeReleaseAliasTag,
  parseLockedImageRef,
  validateBuildManifestAggregate,
  validateBuildSkipDecision,
  validateReleaseIdTruth,
} from '../governance/build-artifact-broker';

type PackageJson = {
  scripts?: Record<string, string>;
};

const failures: string[] = [];
const LOCKED_DIGEST_A = `sha256:${'a'.repeat(64)}`;
const LOCKED_DIGEST_B = `sha256:${'b'.repeat(64)}`;
const BUILD_RUN_ID = 'build-run-20260427';
const GENERATED_AT = '2026-04-27T12:00:00.000Z';
const BUILD_PRODUCER = {
  name: 'build-artifact-broker',
  version: 'contract',
  command: 'pure-build-broker',
  runtime: 'tsx',
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failures.push(message);
  }
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(relativePath), 'utf8')) as T;
}

function assertValidationOk(label: string, result: { ok: boolean; failures?: readonly { path: string; reason: string }[] }): void {
  assert(
    result.ok,
    `${label} failed validation: ${result.failures?.map((failure) => `${failure.path}: ${failure.reason}`).join('\n') ?? 'unknown failure'}`,
  );
}

function main(): void {
  const packageJson = readJson<PackageJson>('package.json');
  const contractsCheck = packageJson.scripts?.['contracts:check'] ?? '';

  assert(
    packageJson.scripts?.['contracts:check-current-build-artifact-broker']
      === 'tsx scripts/contracts/check-current-build-artifact-broker.ts',
    'package.json must expose contracts:check-current-build-artifact-broker.',
  );
  assert(
    contractsCheck.includes('npm run contracts:check-current-build-artifact-broker'),
    'contracts:check must include current build artifact broker checker.',
  );
  assert(
    CURRENT_BUILD_MANIFEST_AGGREGATE_SCHEMA === 'current-build-manifest-aggregate.v1',
    'unexpected build manifest aggregate schema id.',
  );
  assert(
    CURRENT_BUILD_MANIFEST_AGGREGATE_VERSION === 1,
    'unexpected build manifest aggregate schema version.',
  );
  for (const mode of ['build', 'bundle', 'rehearsal', 'release-fidelity', 'offline-package'] as const) {
    assert(CURRENT_BUILD_MANIFEST_MODES.includes(mode), `build manifest aggregate mode ${mode} must be supported.`);
  }
  for (const decision of ['built', 'reused', 'skipped'] as const) {
    assert(
      CURRENT_BUILD_MANIFEST_TARGET_DECISIONS.includes(decision),
      `build manifest target decision ${decision} must be supported.`,
    );
  }
  assert(
    CURRENT_BUILD_SKIP_DECISION_SCHEMA === 'current-build-skip-decision.v1',
    'unexpected build skip decision schema id.',
  );
  assert(
    CURRENT_BUILD_SKIP_DECISION_VERSION === 1,
    'unexpected build skip decision schema version.',
  );

  const appKey = computeAppImageContentKey({
    files: [
      { path: 'package-lock.json', content: 'lock' },
      { path: 'src/app/page.tsx', content: 'page' },
      { path: 'src/messages/en-US.json', content: '{"hello":"Hello"}' },
      { path: 'infra/deploy/Dockerfile.agentsmith-app', content: 'FROM base' },
      { path: 'scripts/build-next-with-root-finalize.sh', content: 'npm run build' },
      { path: 'docs/notes.md', content: 'not keyed' },
    ],
    env: {
      NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
      INTERNAL_SECRET: 'not-keyed',
    },
    baseImages: ['docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A],
  });
  const llmupKey = computeLlmupRuntimeContentKey({
    files: [
      { path: 'Cargo.toml', content: '[package]\nname = "llm-universal-proxy"\n' },
      { path: 'Cargo.lock', content: 'lock' },
      { path: 'rust-toolchain.toml', content: 'channel = "1.85.0"\n' },
      { path: 'src/main.rs', content: 'fn main() {}' },
      { path: 'tests/proxy.rs', content: '#[test]\nfn proxy_contract() {}' },
    ],
    baseImages: [
      'docker.io/library/rust:1.85-bookworm@' + LOCKED_DIGEST_A,
      'gcr.io/distroless/cc-debian12:nonroot@' + LOCKED_DIGEST_B,
    ],
  });
  assert(
    normalizeReleaseAliasTag('release-20260427') === 'release-20260427',
    'release alias normalization must not duplicate an existing release- prefix.',
  );
  assert(
    normalizeReleaseAliasTag('20260427') === 'release-20260427',
    'release alias normalization must add release- when the release id has no prefix.',
  );
  const aggregate = buildBuildManifestAggregate({
    runId: BUILD_RUN_ID,
    releaseId: 'release-20260427',
    versionPath: '/tmp/release/VERSION',
    mode: 'build',
    producer: BUILD_PRODUCER,
    generatedAt: GENERATED_AT,
    targets: [
      buildBuildManifestTarget({
        target: 'app',
        releaseId: 'release-20260427',
        imageName: 'agentsmith-app',
        contentKey: appKey,
        imageDigest: LOCKED_DIGEST_A,
        decision: 'built',
        producer: BUILD_PRODUCER,
        generatedAt: GENERATED_AT,
      }),
      buildBuildManifestTarget({
        target: 'llmup',
        releaseId: 'release-20260427',
        imageName: 'llm-universal-proxy',
        contentKey: llmupKey,
        imageDigest: LOCKED_DIGEST_B,
        decision: 'built',
        producer: BUILD_PRODUCER,
        generatedAt: GENERATED_AT,
      }),
    ],
  });

  assertValidationOk('build manifest aggregate', validateBuildManifestAggregate(aggregate));
  assert(Array.isArray(aggregate.targets), 'build manifest aggregate must use targets[].');
  assert(!('target' in aggregate), 'build manifest aggregate must not use singular top-level target.');
  for (const field of ['run_id', 'mode', 'producer', 'targets'] as const) {
    assert(field in aggregate, `build manifest aggregate is missing required field ${field}.`);
  }
  assert(aggregate.run_id === BUILD_RUN_ID, 'build manifest aggregate must record run_id.');
  assert(aggregate.mode === 'build', 'build manifest aggregate must record mode.');
  assert(aggregate.producer.name === BUILD_PRODUCER.name, 'build manifest aggregate must record producer identity.');
  assert(
    aggregate.targets[0]?.release_alias_ref === 'agentsmith-app:release-20260427',
    'release alias refs must use the normalized release alias tag.',
  );
  assert(
    buildBuildManifestTarget({
      target: 'app',
      releaseId: '20260427',
      imageName: 'agentsmith-app',
      contentKey: appKey,
      imageDigest: LOCKED_DIGEST_A,
      decision: 'built',
      producer: BUILD_PRODUCER,
      generatedAt: GENERATED_AT,
    }).release_alias_ref === 'agentsmith-app:release-20260427',
    'release alias refs must add release- only when the release id has no prefix.',
  );
  for (const mode of ['build', 'bundle', 'rehearsal', 'release-fidelity', 'offline-package'] as const) {
    assert(
      validateBuildManifestAggregate({ ...aggregate, mode }).ok,
      `build manifest aggregate must accept mode ${mode}.`,
    );
  }
  assert(
    validateBuildManifestAggregate({ ...aggregate, mode: 'fast' }).ok === false,
    'build manifest aggregate must reject unsupported modes.',
  );
  for (const field of ['run_id', 'mode', 'producer'] as const) {
    assert(
      validateBuildManifestAggregate(Object.fromEntries(Object.entries(aggregate).filter(([key]) => key !== field)))
        .ok === false,
      `build manifest aggregate must reject missing ${field}.`,
    );
  }

  for (const target of aggregate.targets) {
    for (const field of [
      'release_id',
      'content_ref',
      'release_alias_ref',
      'input_digest',
      'base_image_digest',
      'decision',
      'producer',
      'generated_at',
    ]) {
      assert(field in target, `target ${target.target} is missing required field ${field}.`);
    }
  }
  for (const decision of ['built', 'reused', 'skipped'] as const) {
    assert(
      validateBuildManifestAggregate({
        ...aggregate,
        targets: [{ ...aggregate.targets[0], decision }],
      }).ok,
      `build manifest target must accept decision ${decision}.`,
    );
  }
  assert(
    validateBuildManifestAggregate({
      ...aggregate,
      targets: [{ ...aggregate.targets[0], decision: 'unknown' }],
    }).ok === false,
    'build manifest target must reject unsupported decisions.',
  );
  assert(
    validateBuildManifestAggregate({
      ...aggregate,
      targets: [Object.fromEntries(Object.entries(aggregate.targets[0]).filter(([key]) => key !== 'decision'))],
    }).ok === false,
    'build manifest target must reject missing decision.',
  );

  for (const field of ['verdict', 'claim_id', 'reusable']) {
    assert(
      validateBuildManifestAggregate({
        ...aggregate,
        [field]: 'forbidden',
      }).ok === false,
      `build manifest aggregate must reject evidence truth field ${field}.`,
    );
    assert(
      validateBuildSkipDecision({
        schema: CURRENT_BUILD_SKIP_DECISION_SCHEMA,
        version: CURRENT_BUILD_SKIP_DECISION_VERSION,
        target: 'app',
        operation: 'docker_build',
        input_digest: appKey.input_digest,
        existing_artifact_digest: LOCKED_DIGEST_A,
        skip_reason: 'content_ref_digest_matches',
        validator: 'contract-check',
        generated_at: GENERATED_AT,
        [field]: 'forbidden',
      }).ok === false,
      `build skip decision must reject evidence truth field ${field}.`,
    );
  }

  assert(
    validateReleaseIdTruth({
      versionContent: 'release_id=release-20260427\n',
      envReleaseId: 'release-20260427',
      stateReleaseId: 'release-20260427',
    }).ok,
    'VERSION.release_id truth should pass when VERSION/env/state agree.',
  );
  assert(
    validateReleaseIdTruth({
      versionContent: 'release_id=release-20260427\n',
      envReleaseId: 'release-drift',
      stateReleaseId: 'release-20260427',
    }).ok === false,
    'VERSION.release_id truth must fail closed on env drift.',
  );
  assert(
    parseLockedImageRef('docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A).ok,
    'locked tag@sha256 image refs must be accepted.',
  );
  assert(
    parseLockedImageRef('docker.io/library/node@' + LOCKED_DIGEST_A).ok,
    'locked digest image refs must be accepted.',
  );
  assert(
    parseLockedImageRef('docker.io/library/node:latest@' + LOCKED_DIGEST_A).ok === false,
    'latest tags must be rejected even when a digest is present.',
  );
  assert(
    parseLockedImageRef('docker.io/library/node:22-bookworm-slim').ok === false,
    'base/dependency image refs without digests must be rejected.',
  );

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

main();
