import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildBuildManifestAggregate as buildBrokerManifestAggregate,
  buildBuildManifestTarget,
  computeAppImageContentKey,
} from '../build-artifact-broker';
import {
  assembleReleaseContractGeneratorInput,
  type AgentSmithReleaseContractGeneratorInputAssemblyInput,
} from '../release-contract-input';
import {
  generateAgentSmithReleaseContract,
  type AgentSmithReleaseContractGeneratorInput,
} from '../release-contract';
import {
  CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES,
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateDeployTemplatePackage,
  type CurrentDeployTemplatePackage,
  type CurrentReleaseImageSourceProvenanceBinding,
  type CurrentRunnerImageLock,
} from '../current-release-boundary-schema';
import {
  DEPLOY_TEMPLATE_PACKAGE_ARCHIVE_NAME,
  DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME,
  generateDeployTemplatePackage,
  type DeployTemplatePackageGenerationInput,
} from '../deploy-template-package';

const REPO_ROOT = resolve(process.cwd());
const RELEASE_ID = '2026.05.23-p1';
const GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const GENERATED_AT = '2026-05-23T12:00:00.000Z';
const LLMUP_PROVIDER_IMAGE_REPOSITORY = 'ghcr.io/agentsmith-project/llm-universal-proxy';
const AFSCP_PROVIDER_IMAGE_REPOSITORY = 'ghcr.io/agentsmith-project/agentsmith-fs-control-plane';
const ASBCP_PROVIDER_IMAGE_REPOSITORY = 'ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane';
const LLMUP_COMMIT_SHA = '9c8208d3a12e8070c4edb0ee07469d023cfe38ad';
const AFSCP_COMMIT_SHA = '3dd88d885901a300c2a993653ba4da058a294247';
const ASBCP_COMMIT_SHA = '54af68bc4c211d8427b7a5e92fdc102af492a727';
const PACKAGE_URI =
  'gh-artifact://agentsmith/deploy-template-package/10001/agentsmith-deploy-template-package.tgz';
const VALID_REMOTE_ATTESTATION = {
  attestation_uri: 'gh-artifact://agentsmith/deploy-template-package/10001/attestation.intoto.jsonl',
  attestation_sha256: `sha256:${'9'.repeat(64)}`,
} as const;
const APP_DIGEST = `sha256:${'a'.repeat(64)}`;
const LOCKED_DIGEST = `sha256:${'c'.repeat(64)}`;
const REQUIRED_DEPLOY_TEMPLATE_IMAGE_IDS = [
  'afscp',
  'agentsmith_app',
  'asbcp',
  'ingress_nginx_certgen',
  'ingress_nginx_controller',
  'llmup',
  'managed_runner',
] as const;
const BUILD_PRODUCER = {
  name: 'build-artifact-broker',
  version: 'test',
  command: 'npm run build-artifact-broker',
  runtime: 'vitest',
};
const RUNNER_IMAGE_LOCK = {
  schema_version: 'agentsmith.runner-image-lock/v1',
  runner: 'agentsmith-runner',
  release_id: 'locked-safety-35ada93',
  git_sha: '35ada93cbba0102e9f099c3d47eeb8a48bc89e6f',
  runner_contract_version: '0.1.0',
  runner_protocol_version: '1.0',
  image: {
    id: 'agentsmith-runner',
    image:
      'ghcr.io/agentsmith-project/agentsmith-runner:release-locked-safety-35ada93@sha256:435415e9824550161dc1b0ddcb221fbc4a995b33742e0509879c3ff90f8a0efb',
    digest: 'sha256:435415e9824550161dc1b0ddcb221fbc4a995b33742e0509879c3ff90f8a0efb',
  },
  manifest: {
    producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
    subject_sha256: 'sha256:d39893f31f6f67200a2b06fe993473956ebbadce479fe502261d3d4394211672',
    artifact_sha256: 'sha256:d39893f31f6f67200a2b06fe993473956ebbadce479fe502261d3d4394211672',
  },
  handoff: {
    report_artifact_uri:
      'gh-artifact://agentsmith-project/agentsmith-runner/runner-ga-handoff/26714141935/runner-ga-handoff-report.json',
    manifest_input_sha256: `sha256:${'d'.repeat(64)}`,
    report_sha256: `sha256:${'e'.repeat(64)}`,
  },
} as const satisfies CurrentRunnerImageLock;
const DEPLOY_TEMPLATE_PACKAGE_SCRIPT = join(REPO_ROOT, 'scripts/governance/deploy-template-package.ts');
const TSX_LOADER = join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs');

function buildGenerationInput(
  overrides: Partial<DeployTemplatePackageGenerationInput> = {},
): DeployTemplatePackageGenerationInput {
  return {
    package_uri: PACKAGE_URI,
    git_sha: GIT_SHA,
    ci_provenance: {
      workflow_name: 'release-contract',
      run_id: '10001',
      run_attempt: '1',
      job: 'package-deploy-template',
      generated_at: GENERATED_AT,
      generator_command: 'tsx scripts/governance/deploy-template-package.ts',
      generator_version: 'p1',
      attestation: 'none',
    },
    ...overrides,
  };
}

function outputRoot(): string {
  return mkdirTemp('agentsmith-deploy-template-package-output-');
}

function mkdirTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeTempRoot(): string {
  const root = mkdirTemp('agentsmith-deploy-template-package-root-');
  const deployRoot = join(root, 'infra/deploy/unified');
  mkdirSync(join(deployRoot, 'templates/app'), { recursive: true });
  mkdirSync(join(deployRoot, 'templates/local-kind-admin-preflight'), { recursive: true });
  writeFileSync(join(deployRoot, 'templates/app/rbac.yaml.tpl'), 'kind: Pod\nimage: "{{API_IMAGE}}"\n');
  writeFileSync(
    join(deployRoot, 'templates/local-kind-admin-preflight/namespace.yaml.tpl'),
    'kind: Namespace\n',
  );
  writeFileSync(
    join(deployRoot, 'deployment.manifest.json'),
    `${JSON.stringify({
      schema_version: 'agentsmith.unified-deploy.manifest/v1',
      templates: {
        app: ['templates/app/rbac.yaml.tpl'],
        local_kind_admin_preflight: ['templates/local-kind-admin-preflight/namespace.yaml.tpl'],
      },
    }, null, 2)}\n`,
  );

  return root;
}

function archiveList(archivePath: string): string[] {
  return execFileSync('tar', ['-tf', archivePath], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort();
}

function readArchiveMemberBytes(archivePath: string, memberPath: string): Buffer {
  return execFileSync('tar', ['-xOf', archivePath, memberPath]);
}

function readArchiveJson(archivePath: string, memberPath: string): Record<string, unknown> {
  return JSON.parse(readArchiveMemberBytes(archivePath, memberPath).toString('utf8')) as Record<
    string,
    unknown
  >;
}

function sha256FileDigest(path: string): string {
  return sha256BufferDigest(readFileSync(path));
}

function sha256BufferDigest(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function runDeployTemplatePackageCli(
  repoRoot: string,
  args: readonly string[],
): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ['--import', TSX_LOADER, DEPLOY_TEMPLATE_PACKAGE_SCRIPT, ...args],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
}

function deployTemplatePackageCliArgs(
  outputDir: string,
  overrides: Partial<Record<string, string>> = {},
): string[] {
  const values: Record<string, string> = {
    '--package-uri': PACKAGE_URI,
    '--git-sha': GIT_SHA,
    '--source-git-sha': GIT_SHA,
    '--output-dir': outputDir,
    '--ci-workflow-name': 'release-contract',
    '--ci-run-id': '10001',
    '--ci-run-attempt': '1',
    '--ci-job': 'package-deploy-template',
    '--generated-at': GENERATED_AT,
    '--generator-command': 'npm run release:deploy-template-package',
    '--generator-version': 'p1',
    '--attestation': 'none',
    ...overrides,
  };

  return Object.entries(values).flatMap(([key, value]) => [key, value]);
}

function withoutCliArg(args: readonly string[], flag: string): string[] {
  const next: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      index += 1;
      continue;
    }
    next.push(args[index]);
  }
  return next;
}

function expectNoPackageOutputs(outputDir: string): void {
  expect(existsSync(join(outputDir, DEPLOY_TEMPLATE_PACKAGE_ARCHIVE_NAME))).toBe(false);
  expect(existsSync(join(outputDir, DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME))).toBe(false);
}

function descriptorSubject(descriptor: CurrentDeployTemplatePackage): Omit<
  CurrentDeployTemplatePackage,
  'artifact_provenance'
> {
  return {
    schema_version: descriptor.schema_version,
    package_uri: descriptor.package_uri,
    package_sha256: descriptor.package_sha256,
    manifest_sha256: descriptor.manifest_sha256,
    required_image_ids: descriptor.required_image_ids,
  };
}

function readDeploymentManifestAppTemplates(repoRoot: string): string[] {
  const manifest = readJson(join(repoRoot, 'infra/deploy/unified/deployment.manifest.json'));
  const templates = manifest.templates;
  if (templates === null || typeof templates !== 'object' || Array.isArray(templates)) {
    throw new Error('test fixture deployment manifest templates must be an object');
  }
  const appTemplates = (templates as Record<string, unknown>).app;
  if (!Array.isArray(appTemplates)) {
    throw new Error('test fixture deployment manifest templates.app must be an array');
  }

  return appTemplates
    .filter((path): path is string => typeof path === 'string')
    .map((path) => path.endsWith('.tpl') ? path.slice(0, -'.tpl'.length) : path)
    .sort();
}

function expectPackageGenerationFailure(repoRoot: string, expected: string): void {
  const outputDir = outputRoot();

  expect(() => {
    generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot,
      outputDir,
      sourceGitSha: GIT_SHA,
    });
  }).toThrow(expected);
  expect(existsSync(join(outputDir, DEPLOY_TEMPLATE_PACKAGE_ARCHIVE_NAME))).toBe(false);
  expect(existsSync(join(outputDir, DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME))).toBe(false);
}

function buildManifestAggregate() {
  const contentKey = computeAppImageContentKey({
    files: [
      { path: 'package.json', content: '{"name":"agentsmith"}' },
      { path: 'src/app/page.tsx', content: 'export default function Page() { return null; }' },
      { path: 'infra/deploy/Dockerfile.agentsmith-app', content: 'FROM app-base' },
    ],
    env: {
      NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
    },
    baseImages: [`docker.io/library/node:22-bookworm-slim@${LOCKED_DIGEST}`],
  });

  return buildBrokerManifestAggregate({
    runId: 'build-run-20260523',
    releaseId: RELEASE_ID,
    versionPath: '/tmp/release/VERSION',
    mode: 'build',
    producer: BUILD_PRODUCER,
    generatedAt: GENERATED_AT,
    targets: [
      buildBuildManifestTarget({
        target: 'app',
        releaseId: RELEASE_ID,
        imageName: 'ghcr.io/agentsmith-project/agentsmith-app',
        contentKey,
        imageDigest: APP_DIGEST,
        decision: 'built',
        producer: BUILD_PRODUCER,
        generatedAt: GENERATED_AT,
      }),
    ],
  });
}

function buildReleaseContractAssemblyInput(
  deployTemplatePackage: CurrentDeployTemplatePackage,
): AgentSmithReleaseContractGeneratorInputAssemblyInput {
  const openapiSubject = {
    openapi: '3.1.0',
    info: {
      title: 'AgentSmith API',
      version: RELEASE_ID,
    },
    paths: {},
  };
  const asyncapiSubject = {
    asyncapi: '3.0.0',
    info: {
      title: 'AgentSmith AsyncAPI',
      version: RELEASE_ID,
    },
    channels: {},
  };

  return {
    release_id: RELEASE_ID,
    git_sha: GIT_SHA,
    sourceGitSha: GIT_SHA,
    buildManifestAggregate: buildManifestAggregate(),
    deployTemplatePackage,
    openapi_subject: openapiSubject,
    openapi_digest: sha256Digest(canonicalReleaseBoundaryJson(openapiSubject)),
    asyncapi_subject: asyncapiSubject,
    asyncapi_digest: sha256Digest(canonicalReleaseBoundaryJson(asyncapiSubject)),
    adopted_provider_images: [
      {
        id: 'llmup',
        image: `${LLMUP_PROVIDER_IMAGE_REPOSITORY}:${RELEASE_ID}@sha256:${'3'.repeat(64)}`,
        digest: `sha256:${'3'.repeat(64)}`,
      },
      {
        id: 'afscp',
        image: `${AFSCP_PROVIDER_IMAGE_REPOSITORY}:v1.0.19@sha256:${'5'.repeat(64)}`,
        digest: `sha256:${'5'.repeat(64)}`,
      },
      {
        id: 'asbcp',
        image:
          `${ASBCP_PROVIDER_IMAGE_REPOSITORY}:v2.0.20@sha256:752f7c782744fcb74f7c5ac95ed5a47cfea3b2c71f42644709b8dddd5eda2a10`,
        digest: 'sha256:752f7c782744fcb74f7c5ac95ed5a47cfea3b2c71f42644709b8dddd5eda2a10',
      },
    ],
    release_kit_prerequisite_images: [
      {
        id: 'ingress_nginx_controller',
        image: `registry.k8s.io/ingress-nginx/controller:v1.12.1@sha256:${'4'.repeat(64)}`,
        digest: `sha256:${'4'.repeat(64)}`,
      },
      {
        id: 'ingress_nginx_certgen',
        image: `registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9@sha256:${'7'.repeat(64)}`,
        digest: `sha256:${'7'.repeat(64)}`,
      },
    ],
    external_image_source_provenance: buildExternalImageSourceProvenance(),
    runnerImageLock: structuredClone(RUNNER_IMAGE_LOCK),
    target_profiles: structuredClone(CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES),
    min_release_kit_version: '0.1.0',
    ci_provenance: {
      producer_repo: 'github.com/agentsmith-project/agentsmith',
      normalized_remote: 'github.com/agentsmith-project/agentsmith',
      commit_sha: GIT_SHA,
      workflow_name: 'release-contract',
      run_id: '10001',
      run_attempt: '1',
      job: 'generate-release-contract',
      artifact_uri: 'gh-artifact://agentsmith/release-contract/10001/agentsmith-release-contract.json',
      generated_at: GENERATED_AT,
      generator_command: 'npm run release:contract',
      generator_version: 'p1',
      attestation: 'none',
    },
  };
}

function buildExternalImageSourceProvenance(): CurrentReleaseImageSourceProvenanceBinding[] {
  return [
    {
      image_id: 'llmup',
      producer_repo: 'github.com/agentsmith-project/llm-universal-proxy',
      normalized_remote: 'github.com/agentsmith-project/llm-universal-proxy',
      commit_sha: LLMUP_COMMIT_SHA,
      tag: RELEASE_ID,
      run_id: '30001',
      run_attempt: '1',
      run_url: 'https://github.com/agentsmith-project/llm-universal-proxy/actions/runs/30001/attempts/1',
      subject_name: 'llm-universal-proxy-image',
      artifact_uri: 'gh-artifact://agentsmith-project/llm-universal-proxy/30001/llm-universal-proxy-image.oci',
      artifact_sha256: `sha256:${'3'.repeat(64)}`,
    },
    {
      image_id: 'afscp',
      producer_repo: 'github.com/agentsmith-project/agentsmith-fs-control-plane',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-fs-control-plane',
      commit_sha: AFSCP_COMMIT_SHA,
      tag: 'v1.0.19',
      run_id: '27158437129',
      run_attempt: '1',
      run_url: 'https://github.com/agentsmith-project/agentsmith-fs-control-plane/actions/runs/27158437129/attempts/1',
      subject_name: 'agentsmith-fs-control-plane-image',
      artifact_uri: 'gh-artifact://agentsmith-project/agentsmith-fs-control-plane/27158437129/agentsmith-fs-control-plane-image.oci',
      artifact_sha256: `sha256:${'5'.repeat(64)}`,
    },
    {
      image_id: 'asbcp',
      producer_repo: 'github.com/agentsmith-project/agentsmith-sandbox-control-plane',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-sandbox-control-plane',
      commit_sha: ASBCP_COMMIT_SHA,
      tag: 'v2.0.20',
      run_id: '27479192921',
      run_attempt: '1',
      run_url: 'https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/actions/runs/27479192921/attempts/1',
      subject_name: 'agentsmith-sandbox-control-plane-image',
      artifact_uri:
        'gh-artifact://agentsmith-project/agentsmith-sandbox-control-plane/27479192921/agentsmith-sandbox-control-plane-image.oci',
      artifact_sha256: 'sha256:752f7c782744fcb74f7c5ac95ed5a47cfea3b2c71f42644709b8dddd5eda2a10',
    },
    {
      image_id: 'managed_runner',
      producer_repo: 'github.com/agentsmith-project/agentsmith-runner',
      normalized_remote: 'github.com/agentsmith-project/agentsmith-runner',
      commit_sha: RUNNER_IMAGE_LOCK.git_sha,
      tag: 'release-locked-safety-35ada93',
      run_id: '26714141935',
      run_attempt: '1',
      run_url: 'https://github.com/agentsmith-project/agentsmith-runner/actions/runs/26714141935/attempts/1',
      subject_name: 'agentsmith-managed-runner-image',
      artifact_uri:
        'gh-artifact://agentsmith-project/agentsmith-runner/26714141935/agentsmith-managed-runner-image.oci',
      artifact_sha256: RUNNER_IMAGE_LOCK.image.digest,
      runner_release_manifest_uri:
        'gh-artifact://agentsmith-project/agentsmith-runner/runner-release-manifest/26714141935/runner-release-manifest.json',
      runner_release_manifest_subject_sha256: RUNNER_IMAGE_LOCK.manifest.subject_sha256,
      runner_release_manifest_artifact_sha256: RUNNER_IMAGE_LOCK.manifest.artifact_sha256,
      runner_ga_handoff_uri: RUNNER_IMAGE_LOCK.handoff.report_artifact_uri,
      runner_ga_handoff_manifest_input_sha256: RUNNER_IMAGE_LOCK.handoff.manifest_input_sha256,
      runner_ga_handoff_report_sha256: RUNNER_IMAGE_LOCK.handoff.report_sha256,
    },
  ];
}

describe('deploy template package generator', () => {
  it('runs as a CLI and writes a validated archive and descriptor', () => {
    const repoRoot = makeTempRoot();
    const outputDir = outputRoot();
    const result = runDeployTemplatePackageCli(
      repoRoot,
      deployTemplatePackageCliArgs(outputDir),
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(join(outputDir, DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME));

    const archivePath = join(outputDir, DEPLOY_TEMPLATE_PACKAGE_ARCHIVE_NAME);
    const descriptorPath = join(outputDir, DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME);
    expect(existsSync(archivePath)).toBe(true);
    expect(existsSync(descriptorPath)).toBe(true);

    const descriptor = readJson(descriptorPath) as unknown as CurrentDeployTemplatePackage;
    expect(validateDeployTemplatePackage(descriptor).ok).toBe(true);
    expect(descriptor.package_uri).toBe(PACKAGE_URI);
    expect(descriptor.package_sha256).toBe(sha256FileDigest(archivePath));
    expect(descriptor.artifact_provenance.run_url)
      .toBe('https://github.com/agentsmith-project/agentsmith/actions/runs/10001/attempts/1');
    expect(descriptor.artifact_provenance.artifact_uri).toBe(descriptor.package_uri);
    expect(descriptor.artifact_provenance.artifact_sha256).toBe(descriptor.package_sha256);
  });

  it('accepts legal remote attestation JSON through the CLI', () => {
    const repoRoot = makeTempRoot();
    const outputDir = outputRoot();
    const result = runDeployTemplatePackageCli(
      repoRoot,
      deployTemplatePackageCliArgs(outputDir, {
        '--attestation': JSON.stringify(VALID_REMOTE_ATTESTATION),
      }),
    );

    expect(result.status, result.stderr).toBe(0);
    const descriptor = readJson(
      join(outputDir, DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME),
    ) as unknown as CurrentDeployTemplatePackage;

    expect(validateDeployTemplatePackage(descriptor).ok).toBe(true);
    expect(descriptor.artifact_provenance.attestation).toEqual(VALID_REMOTE_ATTESTATION);
  });

  it.each([
    ['unknown argument', ['--unknown', 'value'], 'unsupported deploy template package argument: --unknown'],
    [
      'missing argument value',
      ['--package-uri'],
      'missing value for --package-uri',
    ],
  ])('fails fast for CLI %s', (_name, extraArgs, expected) => {
    const repoRoot = makeTempRoot();
    const result = runDeployTemplatePackageCli(repoRoot, extraArgs);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expected);
    expect(result.stderr).not.toContain('deployment.manifest.json');
  });

  it.each([
    '--package-uri',
    '--git-sha',
    '--source-git-sha',
    '--output-dir',
    '--ci-workflow-name',
    '--ci-run-id',
    '--ci-run-attempt',
    '--ci-job',
    '--generated-at',
    '--generator-command',
    '--generator-version',
    '--attestation',
    '--subject-uri',
  ])('fails fast when CLI flag %s is duplicated', (flag) => {
    const repoRoot = makeTempRoot();
    const outputDir = outputRoot();
    const baseArgs = deployTemplatePackageCliArgs(outputDir, {
      '--subject-uri': 'deploy-template-package.json',
    });
    const value = flag === '--attestation' ? JSON.stringify(VALID_REMOTE_ATTESTATION) : 'duplicate-value';
    const result = runDeployTemplatePackageCli(repoRoot, [...baseArgs, flag, value]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`duplicate deploy template package argument: ${flag}`);
    expect(result.stderr).not.toContain('deployment.manifest.json');
    expectNoPackageOutputs(outputDir);
  });

  it('fails fast when a required CLI argument is missing', () => {
    const repoRoot = makeTempRoot();
    const result = runDeployTemplatePackageCli(
      repoRoot,
      withoutCliArg(deployTemplatePackageCliArgs(outputRoot()), '--git-sha'),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--git-sha is required');
    expect(result.stderr).not.toContain('deployment.manifest.json');
  });

  it('fails fast when the CLI package_uri is local or relative', () => {
    const repoRoot = makeTempRoot();
    const outputDir = outputRoot();
    const result = runDeployTemplatePackageCli(
      repoRoot,
      deployTemplatePackageCliArgs(outputDir, {
        '--package-uri': './agentsmith-deploy-template-package.tgz',
      }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package_uri must be a remote/CI artifact URI');
    expectNoPackageOutputs(outputDir);
  });

  it('fails fast when the CLI git_sha differs from sourceGitSha', () => {
    const repoRoot = makeTempRoot();
    const outputDir = outputRoot();
    const result = runDeployTemplatePackageCli(
      repoRoot,
      deployTemplatePackageCliArgs(outputDir, {
        '--source-git-sha': 'ffffffffffffffffffffffffffffffffffffffff',
      }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('git_sha must match sourceGitSha');
    expectNoPackageOutputs(outputDir);
  });

  it('fails fast when CLI attestation_uri is local or source-backed', () => {
    const repoRoot = makeTempRoot();
    const outputDir = outputRoot();
    const result = runDeployTemplatePackageCli(
      repoRoot,
      deployTemplatePackageCliArgs(outputDir, {
        '--attestation': JSON.stringify({
          ...VALID_REMOTE_ATTESTATION,
          attestation_uri: 'file:///home/percy/works/mbos-v1/agentsmith/attestation.intoto.jsonl',
        }),
      }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'artifact_provenance.attestation.attestation_uri must be a remote/CI artifact URI',
    );
    expect(result.stderr).not.toContain('deployment.manifest.json');
    expectNoPackageOutputs(outputDir);
  });

  it('fails fast when CLI attestation digest is invalid', () => {
    const repoRoot = makeTempRoot();
    const outputDir = outputRoot();
    const result = runDeployTemplatePackageCli(
      repoRoot,
      deployTemplatePackageCliArgs(outputDir, {
        '--attestation': JSON.stringify({
          ...VALID_REMOTE_ATTESTATION,
          attestation_sha256: 'sha256:not-a-digest',
        }),
      }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('artifact_provenance.attestation.attestation_sha256');
    expect(result.stderr).not.toContain('deployment.manifest.json');
    expectNoPackageOutputs(outputDir);
  });

  it.each([
    'file:///home/percy/works/mbos-v1/agentsmith/src/deploy-template-package.json',
    'local://deploy-template-package/subject.json',
    'http://localhost/subject.json',
    'http://127.0.0.1/subject.json',
  ])('fails fast when CLI subject_uri is local or source-backed: %s', (subjectUri) => {
    const repoRoot = makeTempRoot();
    const outputDir = outputRoot();
    const result = runDeployTemplatePackageCli(
      repoRoot,
      deployTemplatePackageCliArgs(outputDir, {
        '--subject-uri': subjectUri,
      }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'artifact_provenance.subject_uri must not point at local AgentSmith product source',
    );
    expect(result.stderr).not.toContain('deployment.manifest.json');
    expectNoPackageOutputs(outputDir);
  });

  it('fails fast when CLI subject_uri equals package_uri', () => {
    const repoRoot = makeTempRoot();
    const outputDir = outputRoot();
    const result = runDeployTemplatePackageCli(
      repoRoot,
      deployTemplatePackageCliArgs(outputDir, {
        '--subject-uri': PACKAGE_URI,
      }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('subject_sha256 must hash the subject without artifact_provenance');
    expect(result.stderr).not.toContain('deployment.manifest.json');
    expectNoPackageOutputs(outputDir);
  });

  it('generates a validated descriptor and deterministic archive with non-self-referential provenance', () => {
    const outputDir = outputRoot();
    const result = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir,
      sourceGitSha: GIT_SHA,
    });

    expect(result.archivePath).toBe(join(outputDir, DEPLOY_TEMPLATE_PACKAGE_ARCHIVE_NAME));
    expect(result.descriptorPath).toBe(join(outputDir, DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME));
    expect(validateDeployTemplatePackage(result.descriptor).ok).toBe(true);

    const manifestJson = canonicalReleaseBoundaryJson(result.manifest);
    const archivedManifestBytes = readArchiveMemberBytes(result.archivePath, 'manifest.json');
    expect(archivedManifestBytes.toString('utf8')).toBe(`${manifestJson}\n`);
    expect(result.descriptor.manifest_sha256).toBe(sha256BufferDigest(archivedManifestBytes));
    expect(result.descriptor.package_sha256).toBe(sha256FileDigest(result.archivePath));
    expect(readArchiveJson(result.archivePath, 'manifest.json')).toEqual(result.manifest);
    expect(readJson(result.descriptorPath)).toEqual(result.descriptor);
    expect(result.manifest.schema_version).toBe('agentsmith.deploy-template-manifest/v1');
    expect(result.manifest.required_image_ids).toEqual(REQUIRED_DEPLOY_TEMPLATE_IMAGE_IDS);
    expect(result.descriptor.required_image_ids).toEqual(REQUIRED_DEPLOY_TEMPLATE_IMAGE_IDS);
    expect(result.manifest.templates.every((template) => template.kind === 'kubernetes')).toBe(true);
    expect(new Set(result.manifest.templates.map((template) => template.path)).size).toBe(
      result.manifest.templates.length,
    );
    expect(result.manifest.templates.some((template) => template.path.endsWith('.tpl'))).toBe(false);

    const subject = descriptorSubject(result.descriptor);
    expect(result.descriptor.artifact_provenance.subject_sha256).toBe(
      sha256Digest(canonicalReleaseBoundaryJson(subject)),
    );
    expect(result.descriptor.artifact_provenance.subject_sha256).not.toBe(
      sha256Digest(canonicalReleaseBoundaryJson(result.descriptor)),
    );
    expect(result.descriptor.artifact_provenance.artifact_uri).toBe(result.descriptor.package_uri);
    expect(result.descriptor.artifact_provenance.artifact_sha256).toBe(result.descriptor.package_sha256);
    expect(result.descriptor.artifact_provenance.commit_sha).toBe(GIT_SHA);
    expect(result.descriptor.artifact_provenance.producer_repo).toBe(
      'github.com/agentsmith-project/agentsmith',
    );
  });

  it('binds manifest_sha256 to the exact manifest.json archive member bytes', () => {
    const result = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const archivedManifestBytes = readArchiveMemberBytes(result.archivePath, 'manifest.json');

    expect(result.descriptor.manifest_sha256).toBe(sha256BufferDigest(archivedManifestBytes));
  });

  it('archives only manifest.json and deployment manifest app templates in release-kit paths', () => {
    const result = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const templates = readDeploymentManifestAppTemplates(REPO_ROOT);
    const entries = archiveList(result.archivePath);

    expect(entries).toEqual([
      'manifest.json',
      ...templates,
    ].sort());
    for (const forbidden of [
      'env/site.env.example',
      'deployment.manifest.json',
      'substrate/connection.env',
      'substrate/docker-compose.yml',
      'package.json',
    ]) {
      expect(entries).not.toContain(forbidden);
    }
    expect(entries.some((entry) => entry.startsWith('templates/local-kind-admin-preflight/'))).toBe(false);
    expect(entries).toContain('templates/app/workloads.yaml');
    expect(entries.some((entry) => entry.startsWith('scripts/'))).toBe(false);
    expect(entries.some((entry) => entry.includes('node_modules'))).toBe(false);
  });

  it('does not collect image placeholders from local-kind admin preflight templates', () => {
    const repoRoot = makeTempRoot();
    writeFileSync(
      join(repoRoot, 'infra/deploy/unified/templates/local-kind-admin-preflight/namespace.yaml.tpl'),
      'kind: Pod\nimage: "{{MYSTERY_IMAGE}}"\n',
    );
    const result = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const entries = archiveList(result.archivePath);

    expect(result.manifest.required_image_ids).toEqual([
      'agentsmith_app',
      'ingress_nginx_certgen',
      'ingress_nginx_controller',
    ]);
    expect(entries.some((entry) => entry.startsWith('templates/local-kind-admin-preflight/'))).toBe(false);
  });

  it('stages release-kit canonical placeholders for product image handoff', () => {
    const result = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const workloads = readArchiveMemberBytes(result.archivePath, 'templates/app/workloads.yaml').toString('utf8');
    const config = readArchiveMemberBytes(result.archivePath, 'templates/app/config.yaml').toString('utf8');

    expect(workloads).toContain('${{ images.agentsmith_app.image }}');
    expect(workloads).toContain('${{ images.managed_runner.image }}');
    expect(config).toContain('${{ images.managed_runner.image }}');
    expect(workloads).not.toContain('{{API_IMAGE}}');
    expect(workloads).not.toContain('{{WEB_IMAGE}}');
    expect(workloads).not.toContain('${{ values.MANAGED_RUNNER_IMAGE }}');
    expect(config).not.toContain('${{ values.MANAGED_RUNNER_IMAGE }}');
    expect(workloads).not.toContain('{{NAMESPACE}}');
  });

  it('stages ingress rules with the release-kit ingress host value placeholder', () => {
    const result = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const ingress = readArchiveMemberBytes(result.archivePath, 'templates/app/ingress.yaml').toString('utf8');

    expect(ingress).toContain('host: "${{ values.INGRESS_HOST }}"');
    expect(ingress).not.toContain('- http:');
    expect(ingress).not.toContain('{{INGRESS_HOST}}');
  });

  it('packages AFSCP volume bootstrap with an in-pod schema bootstrap barrier', () => {
    const result = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const afscp = readArchiveMemberBytes(result.archivePath, 'templates/app/afscp.yaml').toString('utf8');

    expect(afscp.match(/backoffLimit: 3/gu)).toHaveLength(2);
    expect(afscp).not.toContain('backoffLimit: 0');
    expect(afscp).toMatch(
      /name: afscp-volume-bootstrap[\s\S]*?initContainers:\s*\n\s*- name: afscp-schema-bootstrap[\s\S]*?command:\s*\n\s*- \/usr\/local\/bin\/afscp-migrate[\s\S]*?- --apply[\s\S]*?- --check[\s\S]*?containers:\s*\n\s*- name: afscp-volume-bootstrap[\s\S]*?command:\s*\n\s*- \/usr\/local\/bin\/afscp-volume-bootstrap/u,
    );
  });

  it('packages deploy templates without raw Secret payload manifests', () => {
    const result = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const entries = archiveList(result.archivePath).filter((entry) => entry.startsWith('templates/') && entry.endsWith('.yaml'));

    for (const entry of entries) {
      const content = readArchiveMemberBytes(result.archivePath, entry).toString('utf8');
      expect(content).not.toMatch(/kind:\s*Secret[\s\S]*?\n(?:data|stringData|binaryData):/u);
    }

    const workloads = readArchiveMemberBytes(result.archivePath, 'templates/app/workloads.yaml').toString('utf8');
    const afscp = readArchiveMemberBytes(result.archivePath, 'templates/app/afscp.yaml').toString('utf8');
    expect(workloads).toContain('secretKeyRef:');
    expect(workloads).toContain('secretRef:');
    expect(afscp).toContain('secretRef:');
    expect(afscp).toContain('nodePublishSecretRef:');
  });

  it('fails fast when a template adds an undeclared image placeholder', () => {
    const repoRoot = makeTempRoot();
    writeFileSync(
      join(repoRoot, 'infra/deploy/unified/templates/app/rbac.yaml.tpl'),
      'kind: Pod\nimage: "{{MYSTERY_IMAGE}}"\n',
    );

    expectPackageGenerationFailure(repoRoot, 'template image placeholder "{{MYSTERY_IMAGE}}" is not declared');
  });

  it('repeats the same manifest and archive digests for identical input', () => {
    const first = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const second = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });

    expect(second.descriptor.manifest_sha256).toBe(first.descriptor.manifest_sha256);
    expect(second.descriptor.package_sha256).toBe(first.descriptor.package_sha256);
  });

  it('changes package_sha256 when a declared template changes', () => {
    const repoRoot = makeTempRoot();
    const first = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });

    writeFileSync(
      join(repoRoot, 'infra/deploy/unified/templates/app/rbac.yaml.tpl'),
      'kind: Pod\nmetadata:\n  name: changed\nimage: "{{API_IMAGE}}"\n',
    );
    const second = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });

    expect(second.descriptor.package_sha256).not.toBe(first.descriptor.package_sha256);
    expect(second.descriptor.manifest_sha256).toBe(first.descriptor.manifest_sha256);
  });

  it.each([
    ['absolute path', ['/tmp/rbac.yaml.tpl'], 'safe relative path'],
    ['parent traversal', ['templates/../rbac.yaml.tpl'], 'safe relative path'],
    ['backslash path', ['templates\\app\\rbac.yaml.tpl'], 'safe relative path'],
    [
      'duplicate path',
      ['templates/app/rbac.yaml.tpl', 'templates/app/rbac.yaml.tpl'],
      'declared more than once',
    ],
    ['reserved package manifest path', ['manifest.json'], 'reserved package path'],
    ['reserved deployment manifest path', ['deployment.manifest.json'], 'reserved package path'],
    ['non-template env example', ['env/site.env.example'], 'must start with templates/ and end with .tpl'],
    [
      'non-template connection env',
      ['substrate/connection.env'],
      'must start with templates/ and end with .tpl',
    ],
    ['missing file', ['templates/app/missing.yaml.tpl'], 'does not exist'],
  ])('rejects unsafe template manifest entries: %s', (_name, paths, expected) => {
    const repoRoot = makeTempRoot();
    const deployRoot = join(repoRoot, 'infra/deploy/unified');
    writeFileSync(
      join(deployRoot, 'deployment.manifest.json'),
      `${JSON.stringify({
        schema_version: 'agentsmith.unified-deploy.manifest/v1',
        templates: {
          app: paths,
        },
      }, null, 2)}\n`,
    );

    expect(() => {
      generateDeployTemplatePackage(buildGenerationInput(), {
        repoRoot,
        outputDir: outputRoot(),
        sourceGitSha: GIT_SHA,
      });
    }).toThrow(expected);
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects prototype-polluting template group name %s before packaging',
    (templateGroupName) => {
      const repoRoot = makeTempRoot();
      const deployRoot = join(repoRoot, 'infra/deploy/unified');
      writeFileSync(
        join(deployRoot, 'deployment.manifest.json'),
        `${JSON.stringify({
          schema_version: 'agentsmith.unified-deploy.manifest/v1',
          templates: Object.fromEntries([[templateGroupName, ['templates/app/rbac.yaml.tpl']]]),
        })}\n`,
      );

      expectPackageGenerationFailure(repoRoot, 'template group name');
    },
  );

  it('rejects template paths whose parent directory is a symlink escape', () => {
    const repoRoot = makeTempRoot();
    const deployRoot = join(repoRoot, 'infra/deploy/unified');
    const outsideRoot = mkdirTemp('agentsmith-deploy-template-package-outside-');
    mkdirSync(join(outsideRoot, 'escaped'), { recursive: true });
    writeFileSync(join(outsideRoot, 'escaped/rbac.yaml.tpl'), 'kind: Escaped\n');
    symlinkSync(join(outsideRoot, 'escaped'), join(deployRoot, 'templates/escaped'), 'dir');
    writeFileSync(
      join(deployRoot, 'deployment.manifest.json'),
      `${JSON.stringify({
        schema_version: 'agentsmith.unified-deploy.manifest/v1',
        templates: {
          app: ['templates/escaped/rbac.yaml.tpl'],
        },
      }, null, 2)}\n`,
    );

    expectPackageGenerationFailure(repoRoot, 'symlink');
  });

  it('rejects template paths whose final file component is a symlink', () => {
    const repoRoot = makeTempRoot();
    const deployRoot = join(repoRoot, 'infra/deploy/unified');
    const outsideRoot = mkdirTemp('agentsmith-deploy-template-package-final-symlink-outside-');
    const outsideTemplate = join(outsideRoot, 'rbac.yaml.tpl');
    writeFileSync(outsideTemplate, 'kind: Escaped\n');
    rmSync(join(deployRoot, 'templates/app/rbac.yaml.tpl'), { force: true });
    symlinkSync(outsideTemplate, join(deployRoot, 'templates/app/rbac.yaml.tpl'), 'file');

    expectPackageGenerationFailure(repoRoot, 'symlink');
  });

  it('rejects deploy root path segments that are symlink escapes', () => {
    const repoRoot = mkdirTemp('agentsmith-deploy-template-package-root-symlink-');
    const outsideDeployRoot = makeTempRoot();
    mkdirSync(join(repoRoot, 'infra/deploy'), { recursive: true });
    symlinkSync(
      join(outsideDeployRoot, 'infra/deploy/unified'),
      join(repoRoot, 'infra/deploy/unified'),
      'dir',
    );

    expectPackageGenerationFailure(repoRoot, 'symlink');
  });

  it('rejects deployment.manifest.json when it is a symlink escape', () => {
    const repoRoot = makeTempRoot();
    const deployRoot = join(repoRoot, 'infra/deploy/unified');
    const outsideRoot = mkdirTemp('agentsmith-deploy-template-package-manifest-outside-');
    const outsideManifest = join(outsideRoot, 'deployment.manifest.json');
    writeFileSync(
      outsideManifest,
      `${JSON.stringify({
        schema_version: 'agentsmith.unified-deploy.manifest/v1',
        templates: {
          app: ['templates/app/rbac.yaml.tpl'],
        },
      }, null, 2)}\n`,
    );
    rmSync(join(deployRoot, 'deployment.manifest.json'), { force: true });
    symlinkSync(outsideManifest, join(deployRoot, 'deployment.manifest.json'), 'file');

    expectPackageGenerationFailure(repoRoot, 'symlink');
  });

  it.each([
    'file:///home/percy/works/mbos-v1/agentsmith/agentsmith-deploy-template-package.tgz',
    './agentsmith-deploy-template-package.tgz',
    'local://deploy-template-package/agentsmith-deploy-template-package.tgz',
  ])('rejects local, relative, or file package_uri %s', (packageUri) => {
    expect(() => {
      generateDeployTemplatePackage(buildGenerationInput({ package_uri: packageUri }), {
        repoRoot: REPO_ROOT,
        outputDir: outputRoot(),
        sourceGitSha: GIT_SHA,
      });
    }).toThrow('package_uri must be a remote/CI artifact URI');
  });

  it('keeps release contract assembly bound to the generated deploy template manifest digest', () => {
    const packageResult = generateDeployTemplatePackage(buildGenerationInput(), {
      repoRoot: REPO_ROOT,
      outputDir: outputRoot(),
      sourceGitSha: GIT_SHA,
    });
    const generatorInput = assembleReleaseContractGeneratorInput(
      buildReleaseContractAssemblyInput(packageResult.descriptor),
    );
    const contract = generateAgentSmithReleaseContract(generatorInput, {
      sourceGitSha: GIT_SHA,
    });

    expect((generatorInput as AgentSmithReleaseContractGeneratorInput).deploy_template_digest).toBe(
      packageResult.descriptor.manifest_sha256,
    );
    expect(contract.deploy_template_digest).toBe(packageResult.descriptor.manifest_sha256);
  });
});
