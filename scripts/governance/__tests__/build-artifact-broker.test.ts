import { describe, expect, it } from 'vitest';

import {
  buildBuildPrebuildPlanAggregate,
  buildBuildPrebuildPlanTarget,
  buildBuildManifestAggregate,
  buildBuildManifestTarget,
  computeAppImageContentKey,
  computeLlmupRuntimeContentKey,
  normalizeReleaseAliasTag,
  parseBaseDependencyImageLock,
  parseLockedImageRef,
  validateBuildManifestAggregate,
  validateBuildSkipDecision,
  validateReleaseIdTruth,
  type BuildArtifactBrokerFileInput,
} from '../build-artifact-broker';

const LOCKED_DIGEST_A = `sha256:${'a'.repeat(64)}`;
const LOCKED_DIGEST_B = `sha256:${'b'.repeat(64)}`;
const BUILD_RUN_ID = 'build-run-20260427';
const GENERATED_AT = '2026-04-27T12:00:00.000Z';
const BUILD_PRODUCER = {
  name: 'build-artifact-broker',
  version: 'test',
  command: 'pure-build-broker',
  runtime: 'vitest',
};

const APP_BASE_FILES: readonly BuildArtifactBrokerFileInput[] = [
  { path: 'package.json', content: '{"name":"agentsmith"}' },
  { path: 'package-lock.json', content: '{"lockfileVersion":3}' },
  { path: 'next.config.ts', content: 'export default {};' },
  { path: 'tailwind.config.js', content: 'module.exports = {};' },
  { path: 'postcss.config.js', content: 'module.exports = {};' },
  { path: 'tsconfig.json', content: '{"compilerOptions":{}}' },
  { path: 'src/app/page.tsx', content: 'export default function Page() { return null; }' },
  { path: 'src/messages/en-US.json', content: '{"hello":"Hello"}' },
  { path: 'public/favicon.ico', content: 'icon' },
  { path: 'assets/models-catalog/logos/deepinfra.svg', content: '<svg />' },
  { path: 'scripts/build-next-with-root-finalize.sh', content: 'npm run build' },
  { path: 'infra/deploy/Dockerfile.agentsmith-app', content: 'FROM app-base' },
  { path: 'docs/readme.md', content: 'not part of the app image key' },
];

const LLMUP_BASE_FILES: readonly BuildArtifactBrokerFileInput[] = [
  { path: 'Cargo.toml', content: '[package]\nname = "llm-universal-proxy"\n' },
  { path: 'Cargo.lock', content: '# lock' },
  { path: 'rust-toolchain.toml', content: '[toolchain]\nchannel = "1.85.0"\n' },
  { path: 'src/main.rs', content: 'fn main() {}' },
  { path: 'tests/proxy.rs', content: '#[test]\nfn proxy_contract() {}' },
  { path: 'README.md', content: 'not part of the runtime key' },
];

function withChangedFile(
  files: readonly BuildArtifactBrokerFileInput[],
  path: string,
  content: string,
): readonly BuildArtifactBrokerFileInput[] {
  return files.map((file) => (file.path === path ? { ...file, content } : file));
}

function expectAppKeyToChange(path: string): void {
  const base = computeAppImageContentKey({
    files: APP_BASE_FILES,
    env: { NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1' },
    baseImages: ['docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A],
  });
  const changed = computeAppImageContentKey({
    files: withChangedFile(APP_BASE_FILES, path, `changed ${path}`),
    env: { NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1' },
    baseImages: ['docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A],
  });

  expect(changed.content_key).not.toBe(base.content_key);
  expect(changed.input_digest).not.toBe(base.input_digest);
}

describe('build artifact broker', () => {
  it('calculates deterministic content keys with stable input sorting', () => {
    const first = computeAppImageContentKey({
      files: [
        { path: 'src/app/page.tsx', content: 'page' },
        { path: 'package-lock.json', content: 'lock' },
        { path: 'infra/deploy/Dockerfile.agentsmith-app', content: 'dockerfile' },
      ],
      env: {
        NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
        NEXT_PUBLIC_KEYCLOAK_REALM: 'mbos',
      },
      baseImages: [
        'docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A,
        'docker.io/library/caddy:2.8@' + LOCKED_DIGEST_B,
      ],
    });
    const second = computeAppImageContentKey({
      files: [
        { path: 'infra/deploy/Dockerfile.agentsmith-app', content: 'dockerfile' },
        { path: 'package-lock.json', content: 'lock' },
        { path: 'src/app/page.tsx', content: 'page' },
      ],
      env: {
        NEXT_PUBLIC_KEYCLOAK_REALM: 'mbos',
        NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
      },
      baseImages: [
        'docker.io/library/caddy:2.8@' + LOCKED_DIGEST_B,
        'docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A,
      ],
    });

    expect(second.content_key).toBe(first.content_key);
    expect(second.input_digest).toBe(first.input_digest);
    expect(second.selected_inputs.map((input) => input.path)).toEqual([
      'env:NEXT_PUBLIC_API_BASE',
      'env:NEXT_PUBLIC_KEYCLOAK_REALM',
      'image:docker.io/library/caddy',
      'image:docker.io/library/node',
      'infra/deploy/Dockerfile.agentsmith-app',
      'package-lock.json',
      'src/app/page.tsx',
    ]);
  });

  it('includes app source, messages, config, NEXT_PUBLIC env, and final image copied assets/scripts/infra in the app key', () => {
    expectAppKeyToChange('src/app/page.tsx');
    expectAppKeyToChange('src/messages/en-US.json');
    expectAppKeyToChange('next.config.ts');
    expectAppKeyToChange('assets/models-catalog/logos/deepinfra.svg');
    expectAppKeyToChange('scripts/build-next-with-root-finalize.sh');
    expectAppKeyToChange('infra/deploy/Dockerfile.agentsmith-app');

    const base = computeAppImageContentKey({
      files: APP_BASE_FILES,
      env: { NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1', INTERNAL_SECRET: 'not-keyed' },
      baseImages: ['docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A],
    });
    const changedPublicEnv = computeAppImageContentKey({
      files: APP_BASE_FILES,
      env: { NEXT_PUBLIC_API_BASE: 'http://localhost:3000/api/v1', INTERNAL_SECRET: 'not-keyed' },
      baseImages: ['docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A],
    });
    const changedPrivateEnv = computeAppImageContentKey({
      files: APP_BASE_FILES,
      env: { NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1', INTERNAL_SECRET: 'changed' },
      baseImages: ['docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A],
    });
    const unrelatedDocsChange = computeAppImageContentKey({
      files: withChangedFile(APP_BASE_FILES, 'docs/readme.md', 'changed docs'),
      env: { NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1', INTERNAL_SECRET: 'not-keyed' },
      baseImages: ['docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A],
    });

    expect(changedPublicEnv.content_key).not.toBe(base.content_key);
    expect(changedPrivateEnv.content_key).toBe(base.content_key);
    expect(unrelatedDocsChange.content_key).toBe(base.content_key);
  });

  it('keeps llmup runtime keys sensitive to runtime Rust inputs but insensitive to tests', () => {
    const base = computeLlmupRuntimeContentKey({
      files: LLMUP_BASE_FILES,
      baseImages: [
        'docker.io/library/rust:1.85-bookworm@' + LOCKED_DIGEST_A,
        'gcr.io/distroless/cc-debian12:nonroot@' + LOCKED_DIGEST_B,
      ],
    });
    const changedTest = computeLlmupRuntimeContentKey({
      files: withChangedFile(LLMUP_BASE_FILES, 'tests/proxy.rs', 'changed test'),
      baseImages: [
        'docker.io/library/rust:1.85-bookworm@' + LOCKED_DIGEST_A,
        'gcr.io/distroless/cc-debian12:nonroot@' + LOCKED_DIGEST_B,
      ],
    });

    expect(changedTest.content_key).toBe(base.content_key);

    for (const path of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'src/main.rs']) {
      const changedRuntimeInput = computeLlmupRuntimeContentKey({
        files: withChangedFile(LLMUP_BASE_FILES, path, `changed ${path}`),
        baseImages: [
          'docker.io/library/rust:1.85-bookworm@' + LOCKED_DIGEST_A,
          'gcr.io/distroless/cc-debian12:nonroot@' + LOCKED_DIGEST_B,
        ],
      });

      expect(changedRuntimeInput.content_key).not.toBe(base.content_key);
    }
  });

  it('treats VERSION.release_id as truth and fails closed on env or state drift', () => {
    expect(
      validateReleaseIdTruth({
        versionContent: 'release_id=release-20260427\nagentsmith_app_image=agentsmith-app:release-20260427\n',
        envReleaseId: 'release-20260427',
        stateReleaseId: 'release-20260427',
        versionPath: '/tmp/release/VERSION',
      }),
    ).toMatchObject({
      ok: true,
      release_id: 'release-20260427',
      version_path: '/tmp/release/VERSION',
    });

    expect(
      validateReleaseIdTruth({
        versionContent: 'release_id=release-20260427\n',
        envReleaseId: 'other-release',
        stateReleaseId: 'release-20260427',
      }).ok,
    ).toBe(false);
    expect(
      validateReleaseIdTruth({
        versionContent: 'release_id=release-20260427\n',
        envReleaseId: 'release-20260427',
        stateReleaseId: 'other-release',
      }).ok,
    ).toBe(false);
  });

  it('normalizes release alias tags without duplicating the release prefix', () => {
    const appKey = computeAppImageContentKey({
      files: APP_BASE_FILES,
      env: { NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1' },
      baseImages: ['docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A],
    });

    expect(normalizeReleaseAliasTag('release-20260427')).toBe('release-20260427');
    expect(normalizeReleaseAliasTag('20260427')).toBe('release-20260427');

    expect(
      buildBuildManifestTarget({
        target: 'app',
        releaseId: 'release-20260427',
        imageName: 'agentsmith-app',
        contentKey: appKey,
        imageDigest: LOCKED_DIGEST_B,
        decision: 'built',
        producer: BUILD_PRODUCER,
        generatedAt: GENERATED_AT,
      }).release_alias_ref,
    ).toBe('agentsmith-app:release-20260427');
    expect(
      buildBuildManifestTarget({
        target: 'app',
        releaseId: '20260427',
        imageName: 'agentsmith-app',
        contentKey: appKey,
        imageDigest: LOCKED_DIGEST_B,
        decision: 'built',
        producer: BUILD_PRODUCER,
        generatedAt: GENERATED_AT,
      }).release_alias_ref,
    ).toBe('agentsmith-app:release-20260427');
  });

  it('builds prebuild plan refs with the same content and release alias semantics as manifest targets', () => {
    const appKey = computeAppImageContentKey({
      files: APP_BASE_FILES,
      env: { NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1' },
      baseImages: ['docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A],
    });
    const planTarget = buildBuildPrebuildPlanTarget({
      target: 'app',
      releaseId: 'test-release',
      imageName: 'localhost:5001/mbos/agentsmith-app',
      contentKey: appKey,
      producer: BUILD_PRODUCER,
      generatedAt: GENERATED_AT,
    });
    const manifestTarget = buildBuildManifestTarget({
      target: 'app',
      releaseId: 'test-release',
      imageName: 'localhost:5001/mbos/agentsmith-app',
      contentKey: appKey,
      imageDigest: LOCKED_DIGEST_B,
      decision: 'built',
      producer: BUILD_PRODUCER,
      generatedAt: GENERATED_AT,
    });
    const plan = buildBuildPrebuildPlanAggregate({
      runId: BUILD_RUN_ID,
      releaseId: 'test-release',
      versionPath: '/tmp/release/VERSION',
      mode: 'build',
      producer: BUILD_PRODUCER,
      targets: [planTarget],
      generatedAt: GENERATED_AT,
    });

    expect(planTarget.content_ref).toMatch(/^localhost:5001\/mbos\/agentsmith-app:ck-[a-f0-9]{32}$/u);
    expect(planTarget.release_alias_ref).toBe('localhost:5001/mbos/agentsmith-app:release-test-release');
    expect(planTarget.content_ref).toBe(manifestTarget.content_ref);
    expect(planTarget.release_alias_ref).toBe(manifestTarget.release_alias_ref);
    expect(planTarget).not.toHaveProperty('image_digest');
    expect(plan.targets[0]).toBe(planTarget);
  });

  it('validates build-manifest aggregate targets and keeps evidence truth fields out of manifests and skip decisions', () => {
    const appKey = computeAppImageContentKey({
      files: APP_BASE_FILES,
      env: { NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1' },
      baseImages: ['docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A],
    });
    const target = buildBuildManifestTarget({
      target: 'app',
      releaseId: 'release-20260427',
      imageName: 'agentsmith-app',
      contentKey: appKey,
      imageDigest: LOCKED_DIGEST_B,
      decision: 'built',
      producer: BUILD_PRODUCER,
      generatedAt: GENERATED_AT,
    });
    const aggregate = buildBuildManifestAggregate({
      runId: BUILD_RUN_ID,
      releaseId: 'release-20260427',
      versionPath: '/tmp/release/VERSION',
      mode: 'build',
      producer: BUILD_PRODUCER,
      targets: [target],
      generatedAt: GENERATED_AT,
    });

    expect(Object.keys(aggregate).sort()).toEqual([
      'generated_at',
      'manifest_kind',
      'mode',
      'producer',
      'release_id',
      'run_id',
      'schema',
      'targets',
      'version',
      'version_path',
    ]);
    expect(aggregate.targets).toHaveLength(1);
    expect(Object.keys(aggregate.targets[0]).sort()).toEqual([
      'base_image_digest',
      'content_ref',
      'decision',
      'generated_at',
      'image_digest',
      'input_digest',
      'producer',
      'release_alias_ref',
      'release_id',
      'target',
    ]);
    expect(validateBuildManifestAggregate(aggregate).ok).toBe(true);

    for (const field of ['run_id', 'mode', 'producer'] as const) {
      expect(
        validateBuildManifestAggregate(Object.fromEntries(Object.entries(aggregate).filter(([key]) => key !== field)))
          .ok,
      ).toBe(false);
    }
    expect(validateBuildManifestAggregate({ ...aggregate, mode: 'fast' }).ok).toBe(false);
    expect(
      validateBuildManifestAggregate({
        ...aggregate,
        targets: [{ ...target, decision: 'unknown' }],
      }).ok,
    ).toBe(false);
    expect(
      validateBuildManifestAggregate({
        ...aggregate,
        targets: [Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'decision'))],
      }).ok,
    ).toBe(false);

    expect(
      validateBuildManifestAggregate({
        ...aggregate,
        targets: undefined,
        target: aggregate.targets[0],
      }).ok,
    ).toBe(false);

    for (const field of ['verdict', 'claim_id', 'reusable']) {
      expect(
        validateBuildManifestAggregate({
          ...aggregate,
          [field]: 'forbidden',
        }).ok,
      ).toBe(false);
      expect(
        validateBuildSkipDecision({
          schema: 'current-build-skip-decision.v1',
          version: 1,
          target: 'app',
          operation: 'docker_build',
          input_digest: appKey.input_digest,
          existing_artifact_digest: LOCKED_DIGEST_B,
          skip_reason: 'content_ref_digest_matches',
          validator: 'unit-test',
          generated_at: GENERATED_AT,
          [field]: 'forbidden',
        }).ok,
      ).toBe(false);
    }
  });

  it('fails closed for base and dependency image locks without pinned digests or with latest tags', () => {
    expect(parseLockedImageRef('docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A)).toMatchObject({
      ok: true,
      value: {
        image: 'docker.io/library/node',
        tag: '22-bookworm-slim',
        digest: LOCKED_DIGEST_A,
      },
    });
    expect(parseLockedImageRef('docker.io/library/node@' + LOCKED_DIGEST_A).ok).toBe(true);
    expect(parseLockedImageRef('docker.io/library/node:latest@' + LOCKED_DIGEST_A).ok).toBe(false);
    expect(parseLockedImageRef('docker.io/library/node:22-bookworm-slim').ok).toBe(false);
    expect(parseLockedImageRef('docker.io/library/node:latest').ok).toBe(false);

    expect(
      parseBaseDependencyImageLock([
        '# base/dependency images',
        'node=docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A,
        'runtime gcr.io/distroless/cc-debian12:nonroot@' + LOCKED_DIGEST_B,
      ].join('\n')).ok,
    ).toBe(true);
    expect(
      parseBaseDependencyImageLock('node=docker.io/library/node:latest@' + LOCKED_DIGEST_A).ok,
    ).toBe(false);
    expect(
      parseBaseDependencyImageLock([
        'node=docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_A,
        'node docker.io/library/node:22-bookworm-slim@' + LOCKED_DIGEST_B,
      ].join('\n')),
    ).toMatchObject({
      ok: false,
      failures: [
        {
          path: 'line 2',
          reason: 'duplicate base/dependency image lock id: node.',
        },
      ],
    });
  });
});
