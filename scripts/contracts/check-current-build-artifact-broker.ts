import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CURRENT_BUILD_ARTIFACT_TARGETS,
  CURRENT_BUILD_MANIFEST_AGGREGATE_SCHEMA,
  CURRENT_BUILD_MANIFEST_AGGREGATE_VERSION,
  CURRENT_BUILD_MANIFEST_MODES,
  CURRENT_BUILD_MANIFEST_TARGET_DECISIONS,
  CURRENT_BUILD_SKIP_DECISION_SCHEMA,
  CURRENT_BUILD_SKIP_DECISION_VERSION,
  CURRENT_BUILD_SKIP_OPERATIONS,
  buildBuildPrebuildPlanAggregate,
  buildBuildPrebuildPlanTarget,
  buildBuildManifestAggregate,
  buildBuildManifestTarget,
  computeAppImageContentKey,
  normalizeReleaseAliasTag,
  parseBaseDependencyImageLock,
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
const NEXT_BUILD_COMMAND = 'npx next build --no-lint';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failures.push(message);
  }
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(relativePath), 'utf8')) as T;
}

function readText(relativePath: string): string {
  return readFileSync(resolve(relativePath), 'utf8');
}

function parseKeyValueText(text: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    values.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }

  return values;
}

function normalizeInstructionWhitespace(instruction: string): string {
  return instruction.replace(/\s+/gu, ' ').trim();
}

function parseDockerfileInstructions(content: string): string[] {
  const instructions: string[] = [];
  let currentInstruction = '';

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    if (line.length === 0 && currentInstruction.length === 0) {
      continue;
    }

    if (line.endsWith('\\')) {
      currentInstruction += `${line.slice(0, -1)} `;
      continue;
    }

    currentInstruction += line;
    const normalizedInstruction = normalizeInstructionWhitespace(currentInstruction);
    if (normalizedInstruction.length > 0) {
      instructions.push(normalizedInstruction);
    }
    currentInstruction = '';
  }

  const normalizedTrailingInstruction = normalizeInstructionWhitespace(currentInstruction);
  if (normalizedTrailingInstruction.length > 0) {
    instructions.push(normalizedTrailingInstruction);
  }

  return instructions;
}

function parseDockerfileMountOption(mountOption: string): Map<string, string> | null {
  if (!mountOption.startsWith('--mount=')) {
    return null;
  }

  const attributes = new Map<string, string>();
  for (const attribute of mountOption.slice('--mount='.length).split(',')) {
    const separatorIndex = attribute.indexOf('=');
    if (separatorIndex <= 0) {
      return null;
    }

    attributes.set(attribute.slice(0, separatorIndex), attribute.slice(separatorIndex + 1));
  }

  return attributes;
}

function assertAgentsmithAppNextBuildCacheMount(dockerfileContent: string): void {
  const nextBuildRuns = parseDockerfileInstructions(dockerfileContent).filter(
    (instruction) => instruction.startsWith('RUN ') && instruction.includes(NEXT_BUILD_COMMAND),
  );

  assert(
    nextBuildRuns.length === 1,
    `Dockerfile.agentsmith-app must execute exactly one RUN step containing ${NEXT_BUILD_COMMAND}.`,
  );

  const nextBuildRun = nextBuildRuns[0];
  assert(nextBuildRun !== undefined, 'Dockerfile.agentsmith-app Next build RUN step must be present.');
  if (nextBuildRun === undefined) {
    return;
  }

  const nextBuildRunCommand = nextBuildRun.slice('RUN '.length);
  assert(
    nextBuildRunCommand.endsWith(NEXT_BUILD_COMMAND),
    `Dockerfile.agentsmith-app Next build RUN step must directly execute ${NEXT_BUILD_COMMAND}.`,
  );

  const mountOptions = nextBuildRunCommand
    .slice(0, -NEXT_BUILD_COMMAND.length)
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  assert(
    mountOptions.length > 0 && mountOptions.every((mountOption) => mountOption.startsWith('--mount=')),
    'Dockerfile.agentsmith-app Next build RUN step must use only BuildKit mount options before the Next command.',
  );

  const parsedMountOptions = mountOptions
    .map((mountOption) => parseDockerfileMountOption(mountOption))
    .filter((attributes): attributes is Map<string, string> => attributes !== null);
  assert(
    parsedMountOptions.some(
      (attributes) => attributes.get('type') === 'cache' && attributes.get('target') === '/app/.next/cache',
    ),
    'Dockerfile.agentsmith-app Next build RUN step must mount BuildKit cache at /app/.next/cache.',
  );
  assert(
    !parsedMountOptions.some(
      (attributes) => attributes.get('type') === 'cache' && attributes.get('target') === '/app/.next',
    ),
    'Dockerfile.agentsmith-app Next build RUN step must not mount the whole /app/.next directory.',
  );
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
  const buildImagesScript = readText('scripts/cluster-deploy/build-images.sh');
  const clusterBuildBundleScript = readText('scripts/cluster-deploy/build-bundle.sh');
  const demoBuildBundleScript = readText('scripts/demo-deploy/build-offline-bundle.sh');
  const buildBrokerCli = readText('scripts/governance/build-artifact-broker-cli.ts');
  const buildBroker = readText('scripts/governance/build-artifact-broker.ts');
  const buildBaseImagesLock = readText('infra/deploy/shared/build-base-images.lock');
  const llmupImageLock = readText('infra/deploy/shared/llmup-image.lock');
  const agentsmithAppDockerfile = readText('infra/deploy/Dockerfile.agentsmith-app');
  const deploymentSpec = readText('docs/contracts/deployment-spec-v1.md');
  const clusterDeploymentSpec = readText('docs/contracts/cluster-deployment-spec-v1.md');
  const buildGovernanceDoc = readText('docs/engineering/governance-developer-flow-optimization-v2.md');

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
  assert(
    JSON.stringify(CURRENT_BUILD_ARTIFACT_TARGETS) === JSON.stringify(['app']),
    'current build artifact broker targets must be limited to AgentSmith-owned app.',
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
  assert(
    CURRENT_BUILD_SKIP_OPERATIONS.includes('docker_load'),
    'build skip decisions must support docker_load audit operations.',
  );
  assert(
    CURRENT_BUILD_SKIP_OPERATIONS.includes('registry_push'),
    'build skip decisions must support registry_push audit operations.',
  );
  assert(
    CURRENT_BUILD_SKIP_OPERATIONS.includes('kind_preload'),
    'build skip decisions must support kind_preload audit operations.',
  );
  assert(
    buildImagesScript.includes('run_build_artifact_broker_manifest_gate'),
    'build-images.sh must run the post-build build artifact broker as a manifest gate.',
  );
  assert(
    buildImagesScript.includes('build artifact broker manifest gate failed with exit'),
    'build-images.sh must fail closed when the post-build broker exits nonzero.',
  );
  assert(
    buildImagesScript.includes('wrote diagnostic report instead of trusted manifest'),
    'build-images.sh must reject post-build diagnostic reports on the mandatory manifest path.',
  );
  assert(
    buildImagesScript.includes('did not write ${manifest_path}'),
    'build-images.sh must require build-manifest.json after the post-build broker completes.',
  );
  assert(
    !/broker_exit[^\n;]*-eq 42/u.test(buildImagesScript),
    'build-images.sh must not special-case release-truth exit 42 on the post-build mandatory path.',
  );
  assert(
    !buildImagesScript.includes('build artifact broker diagnostic warning')
      && !buildImagesScript.includes('build artifact broker diagnostic skipped'),
    'build-images.sh must not downgrade post-build broker failures to diagnostics or warnings.',
  );
  const llmupCouplingScanTargets = [
    ['scripts/cluster-deploy/build-images.sh', buildImagesScript],
    ['scripts/cluster-deploy/build-bundle.sh', clusterBuildBundleScript],
    ['scripts/demo-deploy/build-offline-bundle.sh', demoBuildBundleScript],
    ['scripts/governance/build-artifact-broker-cli.ts', buildBrokerCli],
    ['docs/contracts/deployment-spec-v1.md', deploymentSpec],
    ['docs/contracts/cluster-deployment-spec-v1.md', clusterDeploymentSpec],
    ['docs/engineering/governance-developer-flow-optimization-v2.md', buildGovernanceDoc],
  ] as const;
  const deprecatedLlmupBuildCouplings = [
    ['sources', 'llm-universal-proxy'].join('/'),
    ['UNIVERSAL', 'PROXY', 'SOURCE', 'DIR'].join('_'),
    ['UNIVERSAL', 'PROXY', 'ROOT', 'OVERRIDE'].join('_'),
    ['UNIVERSAL', 'PROXY', 'RUST', 'BASE', 'IMAGE'].join('_'),
    ['UNIVERSAL', 'PROXY', 'RUNTIME', 'BASE', 'IMAGE'].join('_'),
    `--${'llmup'}-source-dir`,
    `--${'llmup'}-base-image`,
    ['llmup', 'rust', 'base', 'image'].join('_'),
    ['llmup', 'runtime', 'base', 'image'].join('_'),
  ];
  for (const [targetPath, content] of llmupCouplingScanTargets) {
    for (const forbidden of deprecatedLlmupBuildCouplings) {
      assert(!content.includes(forbidden), `${targetPath} must not contain deprecated llmup build coupling: ${forbidden}.`);
    }
  }
  assert(
    !buildBroker.includes(['compute', 'Llmup', 'Runtime', 'Content', 'Key'].join('')),
    'build artifact broker must not expose an AgentSmith-owned llmup runtime content key.',
  );
  assert(
    !buildBaseImagesLock.includes(['llmup', 'rust', 'base', 'image'].join('_'))
      && !buildBaseImagesLock.includes(['llmup', 'runtime', 'base', 'image'].join('_')),
    'build base image lock must not require llmup Rust/runtime base images.',
  );
  const llmupLockValues = parseKeyValueText(llmupImageLock);
  const llmupVersion = llmupLockValues.get('llmup_version');
  const llmupSourceImage = llmupLockValues.get('llmup_source_image');
  assert(typeof llmupVersion === 'string' && llmupVersion.length > 0, 'llmup image lock must include llmup_version.');
  assert(
    typeof llmupSourceImage === 'string' && llmupSourceImage.length > 0,
    'llmup image lock must include llmup_source_image.',
  );
  if (typeof llmupVersion === 'string' && typeof llmupSourceImage === 'string') {
    const parsedLlmupSourceImage = parseLockedImageRef(llmupSourceImage);
    assert(
      parsedLlmupSourceImage.ok,
      `llmup image lock source image failed validation: ${parsedLlmupSourceImage.ok ? '' : parsedLlmupSourceImage.reason}`,
    );
    if (parsedLlmupSourceImage.ok) {
      assert(
        parsedLlmupSourceImage.value.tag === llmupVersion,
        'llmup image lock source image tag must match llmup_version.',
      );
    }
  }
  for (const [targetPath, content] of [
    ['scripts/cluster-deploy/build-images.sh', buildImagesScript],
    ['scripts/demo-deploy/build-offline-bundle.sh', demoBuildBundleScript],
  ] as const) {
    assert(content.includes('LLMUP_IMAGE_LOCK'), `${targetPath} must resolve llmup defaults from the image lock.`);
    assert(content.includes('llmup_source_image_digest='), `${targetPath} must write llmup_source_image_digest to VERSION.`);
    assert(
      !content.includes('ghcr.io/agentsmith-project/llm-universal-proxy:${LLMUP_VERSION}'),
      `${targetPath} must not default llmup source image from a mutable tag-only ref.`,
    );
  }
  assertAgentsmithAppNextBuildCacheMount(agentsmithAppDockerfile);

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
  const prebuildPlan = buildBuildPrebuildPlanAggregate({
    runId: BUILD_RUN_ID,
    releaseId: '20260427',
    versionPath: '/tmp/release/VERSION',
    mode: 'build',
    producer: BUILD_PRODUCER,
    generatedAt: GENERATED_AT,
    targets: [
      buildBuildPrebuildPlanTarget({
        target: 'app',
        releaseId: '20260427',
        imageName: 'agentsmith-app',
        contentKey: appKey,
        producer: BUILD_PRODUCER,
        generatedAt: GENERATED_AT,
      }),
    ],
  });
  assert(
    prebuildPlan.targets[0]?.content_ref === aggregate.targets[0]?.content_ref,
    'prebuild plan content_ref must match manifest target content_ref.',
  );
  assert(
    prebuildPlan.targets[0]?.release_alias_ref === aggregate.targets[0]?.release_alias_ref,
    'prebuild plan release_alias_ref must match manifest target release_alias_ref.',
  );
  assert(
    !('image_digest' in prebuildPlan.targets[0]),
    'prebuild plan target must not require or claim an image digest.',
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
  assert(
    validateBuildManifestAggregate({
      ...aggregate,
      targets: [{ ...aggregate.targets[0], target: 'image:registry.test/mbos/agentsmith-app:release-20260427' }],
    }).ok === false,
    'build manifest target schema must remain limited to build artifact targets.',
  );
  assert(
    validateBuildManifestAggregate({
      ...aggregate,
      targets: [{ ...aggregate.targets[0], target: ['llm', 'up'].join('') }],
    }).ok === false,
    'build manifest target schema must reject llmup as an AgentSmith-owned target.',
  );

  const registryPushSkipDecision = {
    schema: CURRENT_BUILD_SKIP_DECISION_SCHEMA,
    version: CURRENT_BUILD_SKIP_DECISION_VERSION,
    target: 'image:registry.test/mbos/agentsmith-runner:release-20260427',
    operation: 'registry_push',
    input_digest: LOCKED_DIGEST_A,
    existing_artifact_digest: LOCKED_DIGEST_A,
    skip_reason: 'remote_manifest_digest_matches',
    validator: 'registry manifest digest probe via docker buildx imagetools inspect',
    generated_at: GENERATED_AT,
  };
  assertValidationOk('registry_push skip decision', validateBuildSkipDecision(registryPushSkipDecision));
  const dockerSaveSkipDecision = {
    schema: CURRENT_BUILD_SKIP_DECISION_SCHEMA,
    version: CURRENT_BUILD_SKIP_DECISION_VERSION,
    target: 'image:registry.test/mbos/agentsmith-app:release-20260427',
    operation: 'docker_save',
    input_digest: LOCKED_DIGEST_A,
    existing_artifact_digest: LOCKED_DIGEST_B,
    skip_reason: 'image_archive_cache_verified',
    validator: 'docker save archive manifest.json single RepoTag, Layers members, Config rootfs.diff_ids layer sha256, Config bytes digest, archive sha256, and docker image inspect --format {{.Id}}',
    generated_at: GENERATED_AT,
  };
  assertValidationOk('docker_save skip decision', validateBuildSkipDecision(dockerSaveSkipDecision));
  const dockerLoadSkipDecision = {
    schema: CURRENT_BUILD_SKIP_DECISION_SCHEMA,
    version: CURRENT_BUILD_SKIP_DECISION_VERSION,
    target: 'image:registry.test/mbos/agentsmith-app:release-20260427',
    operation: 'docker_load',
    input_digest: LOCKED_DIGEST_A,
    existing_artifact_digest: LOCKED_DIGEST_A,
    skip_reason: 'local_docker_image_config_digest_matches_archive_config_digest',
    validator: 'docker save archive manifest Config digest and docker image inspect --format {{.Id}}',
    generated_at: GENERATED_AT,
  };
  assertValidationOk('docker_load skip decision', validateBuildSkipDecision(dockerLoadSkipDecision));
  const kindPreloadSkipDecision = {
    schema: CURRENT_BUILD_SKIP_DECISION_SCHEMA,
    version: CURRENT_BUILD_SKIP_DECISION_VERSION,
    target: 'image:kind-registry:5000/mbos/agentsmith-runner:release-20260427',
    operation: 'kind_preload',
    input_digest: LOCKED_DIGEST_A,
    existing_artifact_digest: LOCKED_DIGEST_A,
    skip_reason: 'kind_containerd_target_digest_matches_local_manifest_digest',
    validator: 'local docker image inspect RepoDigests and kind containerd ctr images inspect target digest',
    generated_at: GENERATED_AT,
  };
  assertValidationOk('kind_preload skip decision', validateBuildSkipDecision(kindPreloadSkipDecision));

  for (const field of ['verdict', 'claim_id', 'reusable', 'passed', 'status', 'result_status']) {
    assert(
      validateBuildManifestAggregate({
        ...aggregate,
        [field]: 'forbidden',
      }).ok === false,
      `build manifest aggregate must reject evidence truth field ${field}.`,
    );
    assert(
      validateBuildSkipDecision({
        ...registryPushSkipDecision,
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

  const baseImageLock = parseBaseDependencyImageLock(
    readFileSync(resolve('infra/deploy/shared/build-base-images.lock'), 'utf8'),
  );
  assertValidationOk('build base image lock', baseImageLock);
  if (baseImageLock.ok) {
    const lockedIds = new Set(baseImageLock.entries.map((entry) => entry.id));
    for (const id of [
      'app_node_base_image',
      'app_mc_image',
    ]) {
      assert(lockedIds.has(id), `build base image lock must include ${id}.`);
    }
    assert(!lockedIds.has(['llmup', 'rust', 'base', 'image'].join('_')), 'build base image lock must not include llmup Rust base image.');
    assert(!lockedIds.has(['llmup', 'runtime', 'base', 'image'].join('_')), 'build base image lock must not include llmup runtime base image.');
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

main();
