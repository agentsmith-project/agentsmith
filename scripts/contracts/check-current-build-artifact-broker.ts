import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

import {
  CURRENT_BUILD_ARTIFACT_TARGETS,
  CURRENT_BUILD_MANIFEST_AGGREGATE_SCHEMA,
  CURRENT_BUILD_MANIFEST_AGGREGATE_VERSION,
  CURRENT_BUILD_MANIFEST_MODES,
  CURRENT_BUILD_MANIFEST_TARGET_DECISIONS,
  CURRENT_BUILD_PRODUCT_IMAGE_IDS,
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

type WorkflowStep = {
  name?: string;
  run?: string;
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
const RUNNER_CONTRACT_BUILD_COMMAND = 'npm run build -w @mbos/agent-runner-contract';
const IMAGE_PUBLISH_WORKFLOW_PATH = '.github/workflows/image-publish.yml';
const IMAGE_PUBLISH_JOB_ID = 'publish-images';
const RELEASE_CONTRACT_ARTIFACT_WORKFLOW_PATH = '.github/workflows/release-contract-artifact.yml';
const RELEASE_CONTRACT_ARTIFACT_JOB_ID = 'generate-release-contract';
const HOST_NODE_OR_TSX_COMMAND_PATTERN =
  /(?:^|\s)(?:node(?:\s|$)|npx\s+tsx\b|tsx\s+scripts\/|npm\s+run\s+release:(?:contract:ci-artifact|deploy-template-package)\b)/u;

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function parseDockerfileBuildContextCopySources(content: string): Array<{ instruction: string; source: string }> {
  return parseDockerfileInstructions(content).flatMap((instruction) => {
    if (!instruction.startsWith('COPY ')) {
      return [];
    }

    const parts = instruction.split(/\s+/u).slice(1);
    const flags: string[] = [];
    while (parts[0]?.startsWith('--')) {
      const flag = parts.shift();
      if (flag !== undefined) {
        flags.push(flag);
      }
    }
    if (flags.some((flag) => flag.startsWith('--from='))) {
      return [];
    }

    return parts.slice(0, -1).map((source) => ({ instruction, source }));
  });
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

function parseWorkflowSteps(content: string, jobId: string): WorkflowStep[] {
  const parsedWorkflow = asRecord(YAML.parse(content) as unknown);
  const job = asRecord(asRecord(parsedWorkflow.jobs)[jobId]);
  const steps = Array.isArray(job.steps) ? job.steps : [];

  return steps.map((step): WorkflowStep => {
    const stepRecord = asRecord(step);
    const name = stepRecord.name;
    const run = stepRecord.run;

    return {
      name: typeof name === 'string' ? name : undefined,
      run: typeof run === 'string' ? run : undefined,
    };
  });
}

function assertWorkflowBuildsRunnerContractBeforeHostNodeScripts(
  workflowContent: string,
  jobId: string,
  workflowLabel: string,
): void {
  const steps = parseWorkflowSteps(workflowContent, jobId);
  const installIndex = steps.findIndex((step) => step.name === 'Install dependencies');
  const runnerContractBuildIndex = steps.findIndex((step) => step.run?.trim() === RUNNER_CONTRACT_BUILD_COMMAND);
  const hostNodeScriptSteps = steps
    .map((step, index) => ({ index, step }))
    .filter(({ step }) => step.run !== undefined && HOST_NODE_OR_TSX_COMMAND_PATTERN.test(step.run));

  assert(installIndex >= 0, `${workflowLabel} workflow must install npm dependencies before host Node/tsx scripts.`);
  assert(
    runnerContractBuildIndex >= 0,
    `${workflowLabel} workflow must run ${RUNNER_CONTRACT_BUILD_COMMAND} on the GitHub runner before host Node/tsx scripts that load workspace package exports.`,
  );
  assert(
    hostNodeScriptSteps.length > 0,
    `${workflowLabel} workflow contract expected at least one host Node/tsx script step.`,
  );
  assert(
    installIndex >= 0 && runnerContractBuildIndex >= 0 && installIndex < runnerContractBuildIndex,
    `${workflowLabel} workflow must run ${RUNNER_CONTRACT_BUILD_COMMAND} after npm ci.`,
  );

  for (const { index, step } of hostNodeScriptSteps) {
    assert(
      runnerContractBuildIndex >= 0 && runnerContractBuildIndex < index,
      `${workflowLabel} workflow must run ${RUNNER_CONTRACT_BUILD_COMMAND} before host Node/tsx step "${step.name ?? step.run ?? '<unnamed>'}" because @mbos/agent-runner-contract resolves to dist on the GitHub runner.`,
    );
  }
}

function assertRootBuildWrapperBuildsRunnerContractBeforeNextBuild(wrapperContent: string): void {
  const runnerContractBuildIndex = wrapperContent.indexOf(RUNNER_CONTRACT_BUILD_COMMAND);
  const nextBuildIndex = wrapperContent.indexOf('info "${BUILD_COMMAND}"');

  assert(
    runnerContractBuildIndex >= 0,
    `scripts/build-next-with-root-finalize.sh must run ${RUNNER_CONTRACT_BUILD_COMMAND} so root npm run build works in a cold checkout.`,
  );
  assert(
    nextBuildIndex >= 0,
    'scripts/build-next-with-root-finalize.sh must still execute the configured Next build command.',
  );
  assert(
    runnerContractBuildIndex >= 0 && nextBuildIndex >= 0 && runnerContractBuildIndex < nextBuildIndex,
    `scripts/build-next-with-root-finalize.sh must run ${RUNNER_CONTRACT_BUILD_COMMAND} before the Next build command.`,
  );
}

function assertNextConfigTurbopackWorkspaceAliases(nextConfigContent: string): void {
  assert(
    nextConfigContent.includes("const apiEntryNodeSource = path.resolve(__dirname, 'packages/api-entry-node/src/index.ts');"),
    'next.config.ts must keep @mbos/api-entry-node source alias target centralized.',
  );
  assert(
    nextConfigContent.includes("const agentRunnerContractSource = path.resolve(__dirname, 'packages/agent-runner-contract/src/index.ts');"),
    'next.config.ts must keep @mbos/agent-runner-contract source alias target centralized.',
  );
  assert(nextConfigContent.includes('turbopack:'), 'next.config.ts must configure Turbopack aliases for default npm run dev.');
  assert(nextConfigContent.includes('resolveAlias:'), 'next.config.ts Turbopack config must use resolveAlias.');
  assert(
    nextConfigContent.includes("'@mbos/api-entry-node': apiEntryNodeSource"),
    'next.config.ts Turbopack aliases must resolve @mbos/api-entry-node to source.',
  );
  assert(
    nextConfigContent.includes("'@mbos/agent-runner-contract': agentRunnerContractSource"),
    'next.config.ts Turbopack aliases must resolve @mbos/agent-runner-contract to source.',
  );
  assert(
    nextConfigContent.includes("'@mbos/agent-runner-contract$': agentRunnerContractSource"),
    'next.config.ts webpack aliases must keep the exact @mbos/agent-runner-contract source alias.',
  );
}

function assertAgentsmithAppDockerfileBuildContextCopySources(dockerfileContent: string): void {
  const copySources = parseDockerfileBuildContextCopySources(dockerfileContent);

  assert(
    copySources.some(({ source }) => source === 'src' || source === './src'),
    'Dockerfile.agentsmith-app must copy src build-context source so src/messages is included.',
  );
  assert(
    copySources.every(({ source }) => source !== 'messages' && source !== './messages' && !source.startsWith('messages/')),
    'Dockerfile.agentsmith-app must not copy removed root messages/ source; i18n truth is src/messages.',
  );

  for (const { instruction, source } of copySources) {
    assert(
      existsSync(resolve(source)),
      `Dockerfile.agentsmith-app build-context COPY source must exist: ${source} in "${instruction}".`,
    );
  }
}

function assertAgentsmithAppBaseDockerfileWorkspaceInstallInventory(dockerfileContent: string): void {
  const copySources = parseDockerfileBuildContextCopySources(dockerfileContent).map(({ source }) => source);

  assert(
    copySources.includes('packages/agent-runner-contract/package.json')
      || copySources.includes('./packages/agent-runner-contract/package.json'),
    'Dockerfile.agentsmith-app-base must copy packages/agent-runner-contract/package.json so npm ci installs the workspace link.',
  );
}

function assertAgentsmithAppDockerfileBuildsRunnerContractBeforeNextBuild(dockerfileContent: string): void {
  const instructions = parseDockerfileInstructions(dockerfileContent);
  const contractBuildIndex = instructions.findIndex(
    (instruction) => instruction.startsWith('RUN ') && instruction.includes(RUNNER_CONTRACT_BUILD_COMMAND),
  );
  const nextBuildIndex = instructions.findIndex(
    (instruction) => instruction.startsWith('RUN ') && instruction.includes(NEXT_BUILD_COMMAND),
  );

  assert(
    contractBuildIndex >= 0,
    `Dockerfile.agentsmith-app must run ${RUNNER_CONTRACT_BUILD_COMMAND} because @mbos/agent-runner-contract resolves to dist inside the image.`,
  );
  assert(
    nextBuildIndex >= 0 && contractBuildIndex >= 0 && contractBuildIndex < nextBuildIndex,
    `Dockerfile.agentsmith-app must run ${RUNNER_CONTRACT_BUILD_COMMAND} before ${NEXT_BUILD_COMMAND}.`,
  );
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
  const buildBrokerCli = readText('scripts/governance/build-artifact-broker-cli.ts');
  const buildBroker = readText('scripts/governance/build-artifact-broker.ts');
  const buildBaseImagesLock = readText('infra/deploy/shared/build-base-images.lock');
  const llmupImageLock = readText('infra/deploy/shared/llmup-image.lock');
  const agentsmithAppDockerfile = readText('infra/deploy/Dockerfile.agentsmith-app');
  const agentsmithAppBaseDockerfile = readText('infra/deploy/Dockerfile.agentsmith-app-base');
  const deployContract = readText('docs/contracts/unified-deploy-contract.md');
  const imagePublishWorkflow = readText(IMAGE_PUBLISH_WORKFLOW_PATH);
  const releaseContractArtifactWorkflow = readText(RELEASE_CONTRACT_ARTIFACT_WORKFLOW_PATH);
  const rootBuildWrapper = readText('scripts/build-next-with-root-finalize.sh');
  const nextConfig = readText('next.config.ts');

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
  assert(
    JSON.stringify(CURRENT_BUILD_PRODUCT_IMAGE_IDS) === JSON.stringify(['agentsmith_app']),
    'current build product image ids must expose only the single shared AgentSmith app image.',
  );
  for (const mode of ['build', 'bundle', 'release-fidelity', 'offline-package'] as const) {
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
  const llmupCouplingScanTargets = [
    ['scripts/governance/build-artifact-broker-cli.ts', buildBrokerCli],
    ['docs/contracts/unified-deploy-contract.md', deployContract],
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
  assertAgentsmithAppNextBuildCacheMount(agentsmithAppDockerfile);
  assertAgentsmithAppDockerfileBuildContextCopySources(agentsmithAppDockerfile);
  assertAgentsmithAppBaseDockerfileWorkspaceInstallInventory(agentsmithAppBaseDockerfile);
  assertAgentsmithAppDockerfileBuildsRunnerContractBeforeNextBuild(agentsmithAppDockerfile);
  assertWorkflowBuildsRunnerContractBeforeHostNodeScripts(imagePublishWorkflow, IMAGE_PUBLISH_JOB_ID, 'Image Publish');
  assertWorkflowBuildsRunnerContractBeforeHostNodeScripts(
    releaseContractArtifactWorkflow,
    RELEASE_CONTRACT_ARTIFACT_JOB_ID,
    'Release Contract Artifact',
  );
  assertRootBuildWrapperBuildsRunnerContractBeforeNextBuild(rootBuildWrapper);
  assertNextConfigTurbopackWorkspaceAliases(nextConfig);

  const appKey = computeAppImageContentKey({
    files: [
      { path: 'package-lock.json', content: 'lock' },
      { path: 'src/app/page.tsx', content: 'page' },
      { path: 'src/messages/en-US.json', content: '{"hello":"Hello"}' },
      { path: 'messages/en-US.json', content: '{"hello":"stale root"}' },
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
    appKey.selected_inputs.some((input) => input.path === 'src/messages/en-US.json'),
    'build artifact broker app key must include src/messages as the Next/i18n truth.',
  );
  assert(
    !appKey.selected_inputs.some((input) => input.path === 'messages/en-US.json' || input.path.startsWith('messages/')),
    'build artifact broker app key must not include removed root messages/ inputs.',
  );
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
  for (const mode of ['build', 'bundle', 'release-fidelity', 'offline-package'] as const) {
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
    validator: 'docker save archive manifest.json single RepoTag, Layers members, OCI blob sha256 or legacy rootfs.diff_ids layer sha256, Config bytes digest, local image identity/config-rootfs proof, archive sha256, and docker image inspect --format {{.Id}}/{{json .}}',
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
