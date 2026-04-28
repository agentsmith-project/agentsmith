import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CURRENT_BUILD_MANIFEST_MODES,
  buildBuildPrebuildPlanAggregate,
  buildBuildPrebuildPlanTarget,
  buildBuildManifestAggregate,
  buildBuildManifestTarget,
  computeAppImageContentKey,
  computeLlmupRuntimeContentKey,
  parseLockedImageRef,
  validateBuildManifestAggregate,
  validateReleaseIdTruth,
  type BuildArtifactBrokerFileInput,
  type CurrentBuildArtifactTarget,
  type CurrentBuildManifestMode,
  type CurrentBuildManifestProducer,
} from './build-artifact-broker';

export const BUILD_ARTIFACT_BROKER_RELEASE_TRUTH_EXIT_CODE = 42;

const DIAGNOSTIC_REPORT_SCHEMA = 'build-artifact-broker-diagnostic-report.v1' as const;
const DIAGNOSTIC_REPORT_VERSION = 1 as const;
const ROOT_ONLY_EXCLUDED_SOURCE_DIRS = new Set(['.git', '.next', 'node_modules', 'target', 'artifacts', 'dist']);
const MODE_SET = new Set<string>(CURRENT_BUILD_MANIFEST_MODES);
const ARTIFACT_KIND_SET = new Set(['manifest', 'prebuild-plan']);

type BuildArtifactBrokerArtifactKind = 'manifest' | 'prebuild_plan';

interface BuildArtifactBrokerCliOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

interface BuildArtifactBrokerCliConfig {
  releaseRoot: string;
  releaseId?: string;
  appSourceDir: string;
  llmupSourceDir: string;
  appImage?: string;
  llmupImage?: string;
  appBaseImages: readonly string[];
  llmupBaseImages: readonly string[];
  mode: CurrentBuildManifestMode;
  artifactKind: BuildArtifactBrokerArtifactKind;
  manifestPath: string;
  planPath: string;
  reportPath: string;
}

interface BuildArtifactBrokerDiagnostic {
  target?: CurrentBuildArtifactTarget;
  reason_code: string;
  path: string;
  message: string;
}

interface BuildArtifactBrokerDiagnosticReport {
  schema: typeof DIAGNOSTIC_REPORT_SCHEMA;
  version: typeof DIAGNOSTIC_REPORT_VERSION;
  report_kind: 'build_artifact_broker_diagnostic';
  run_id: string;
  release_id: string;
  version_path: string;
  mode: CurrentBuildManifestMode;
  producer: CurrentBuildManifestProducer;
  generated_at: string;
  diagnostics: readonly BuildArtifactBrokerDiagnostic[];
  outputs: {
    manifest_path: string;
    plan_path: string;
    report_path: string;
  };
}

interface BrokerRunContext {
  config: BuildArtifactBrokerCliConfig;
  generatedAt: string;
  producer: CurrentBuildManifestProducer;
  runId: string;
  versionPath: string;
}

interface BrokerRunResult {
  exitCode: number;
  artifactPath: string;
  artifactKind: 'manifest' | 'prebuild_plan' | 'diagnostic_report';
}

type ImageDigestProbeResult =
  | {
      ok: true;
      digest: string;
    }
  | {
      ok: false;
      reason: string;
    };

export function runBuildArtifactBrokerCli(options: BuildArtifactBrokerCliOptions = {}): number {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((message: string) => console.log(message));
  const stderr = options.stderr ?? ((message: string) => console.error(message));

  try {
    const config = parseCliConfig(argv);
    const result = writeBuildArtifactBrokerArtifact(config, env);

    if (result.artifactKind === 'manifest') {
      stdout(`build artifact broker manifest: ${result.artifactPath}`);
    } else if (result.artifactKind === 'prebuild_plan') {
      stdout(`build artifact broker prebuild plan: ${result.artifactPath}`);
    } else {
      stdout(`build artifact broker diagnostic report: ${result.artifactPath}`);
    }

    return result.exitCode;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function scanBuildArtifactSourceFiles(sourceDir: string): readonly BuildArtifactBrokerFileInput[] {
  const absoluteSourceDir = path.resolve(sourceDir);
  const files: BuildArtifactBrokerFileInput[] = [];

  visitSourceDir(absoluteSourceDir, '', files);

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function writeBuildArtifactBrokerArtifact(
  config: BuildArtifactBrokerCliConfig,
  env: NodeJS.ProcessEnv,
): BrokerRunResult {
  mkdirSync(config.releaseRoot, { recursive: true });

  const generatedAt = env.BUILD_ARTIFACT_BROKER_GENERATED_AT ?? new Date().toISOString();
  const runId = env.BUILD_ARTIFACT_BROKER_RUN_ID ?? `build-artifact-broker-${generatedAt}`;
  const producer = buildProducer(env);
  const versionPath = path.join(config.releaseRoot, 'VERSION');
  const context: BrokerRunContext = {
    config,
    generatedAt,
    producer,
    runId,
    versionPath,
  };

  let versionValues: ReadonlyMap<string, string> = new Map();
  let releaseId = config.releaseId ?? '';

  if (existsSync(versionPath)) {
    const versionContent = readFileSync(versionPath, 'utf8');
    const releaseTruth = validateReleaseIdTruth({
      versionContent,
      envReleaseId: config.releaseId,
      versionPath,
    });
    versionValues = parseVersionValues(versionContent);
    const versionReleaseId = versionValues.get('release_id') ?? config.releaseId ?? '';

    if (!releaseTruth.ok) {
      return writeDiagnosticReport(
        context,
        versionReleaseId,
        releaseTruth.failures.map((failure) => ({
          reason_code: 'release_id_truth_failure',
          path: failure.path,
          message: failure.reason,
        })),
        BUILD_ARTIFACT_BROKER_RELEASE_TRUTH_EXIT_CODE,
      );
    }

    releaseId = releaseTruth.release_id;
  } else if (config.artifactKind === 'manifest' || !config.releaseId) {
    return writeDiagnosticReport(context, config.releaseId ?? '', [
      {
        reason_code: 'release_id_truth_failure',
        path: versionPath,
        message: 'VERSION is required for build artifact broker release truth.',
      },
    ], BUILD_ARTIFACT_BROKER_RELEASE_TRUTH_EXIT_CODE);
  }

  const diagnostics: BuildArtifactBrokerDiagnostic[] = [];
  const appImage = config.appImage ?? versionValues.get('agentsmith_app_image');
  const llmupImage = config.llmupImage ?? versionValues.get('llm_universal_proxy_image');
  const appFiles = scanSourceOrDiagnostic('app', config.appSourceDir, diagnostics);
  const llmupFiles = scanSourceOrDiagnostic('llmup', config.llmupSourceDir, diagnostics);

  appendLlmupRuntimeKeyModelDiagnostics(config.llmupSourceDir, diagnostics);

  if (!appImage) {
    diagnostics.push({
      target: 'app',
      reason_code: 'missing_image_ref',
      path: 'VERSION.agentsmith_app_image',
      message: 'agentsmith app image ref is required.',
    });
  }
  if (!llmupImage) {
    diagnostics.push({
      target: 'llmup',
      reason_code: 'missing_image_ref',
      path: 'VERSION.llm_universal_proxy_image',
      message: 'llm universal proxy image ref is required.',
    });
  }

  validateBaseImageLocks('app', config.appBaseImages, diagnostics);
  validateBaseImageLocks('llmup', config.llmupBaseImages, diagnostics);

  if (config.artifactKind === 'prebuild_plan') {
    if (diagnostics.length > 0 || !appImage || !llmupImage) {
      return writeDiagnosticReport(context, releaseId, diagnostics, 1);
    }

    const appContentKey = computeAppImageContentKey({
      files: appFiles,
      env,
      baseImages: config.appBaseImages,
    });
    const llmupContentKey = computeLlmupRuntimeContentKey({
      files: llmupFiles,
      env,
      baseImages: config.llmupBaseImages,
    });
    const plan = buildBuildPrebuildPlanAggregate({
      runId,
      releaseId,
      versionPath,
      mode: config.mode,
      producer,
      generatedAt,
      targets: [
        buildBuildPrebuildPlanTarget({
          target: 'app',
          releaseId,
          imageName: imageRepositoryFromRef(appImage),
          contentKey: appContentKey,
          producer,
          generatedAt,
        }),
        buildBuildPrebuildPlanTarget({
          target: 'llmup',
          releaseId,
          imageName: imageRepositoryFromRef(llmupImage),
          contentKey: llmupContentKey,
          producer,
          generatedAt,
        }),
      ],
    });

    rmSync(config.reportPath, { force: true });
    rmSync(config.manifestPath, { force: true });
    writeJson(config.planPath, plan);

    return {
      exitCode: 0,
      artifactPath: config.planPath,
      artifactKind: 'prebuild_plan',
    };
  }

  const appImageDigest = appImage ? probeImageDigest(appImage, env) : undefined;
  const llmupImageDigest = llmupImage ? probeImageDigest(llmupImage, env) : undefined;

  if (appImageDigest && !appImageDigest.ok) {
    diagnostics.push({
      target: 'app',
      reason_code: 'missing_image_digest',
      path: `image:${appImage}`,
      message: appImageDigest.reason,
    });
  }
  if (llmupImageDigest && !llmupImageDigest.ok) {
    diagnostics.push({
      target: 'llmup',
      reason_code: 'missing_image_digest',
      path: `image:${llmupImage}`,
      message: llmupImageDigest.reason,
    });
  }

  if (diagnostics.length > 0 || !appImage || !llmupImage || !appImageDigest?.ok || !llmupImageDigest?.ok) {
    return writeDiagnosticReport(context, releaseId, diagnostics, 1);
  }

  const appContentKey = computeAppImageContentKey({
    files: appFiles,
    env,
    baseImages: config.appBaseImages,
  });
  const llmupContentKey = computeLlmupRuntimeContentKey({
    files: llmupFiles,
    env,
    baseImages: config.llmupBaseImages,
  });
  const targets = [
    buildBuildManifestTarget({
      target: 'app',
      releaseId,
      imageName: imageRepositoryFromRef(appImage),
      contentKey: appContentKey,
      imageDigest: appImageDigest.digest,
      decision: 'built',
      producer,
      generatedAt,
    }),
    buildBuildManifestTarget({
      target: 'llmup',
      releaseId,
      imageName: imageRepositoryFromRef(llmupImage),
      contentKey: llmupContentKey,
      imageDigest: llmupImageDigest.digest,
      decision: 'built',
      producer,
      generatedAt,
    }),
  ];
  const aggregate = buildBuildManifestAggregate({
    runId,
    releaseId,
    versionPath,
    mode: config.mode,
    producer,
    targets,
    generatedAt,
  });
  const validation = validateBuildManifestAggregate(aggregate);

  if (!validation.ok) {
    return writeDiagnosticReport(
      context,
      releaseId,
      validation.failures.map((failure) => ({
        reason_code: 'manifest_validation_failure',
        path: failure.path,
        message: failure.reason,
      })),
      1,
    );
  }

  rmSync(config.reportPath, { force: true });
  writeJson(config.manifestPath, aggregate);

  return {
    exitCode: 0,
    artifactPath: config.manifestPath,
    artifactKind: 'manifest',
  };
}

function parseCliConfig(argv: readonly string[]): BuildArtifactBrokerCliConfig {
  const rawConfig: {
    releaseRoot?: string;
    releaseId?: string;
    appSourceDir?: string;
    llmupSourceDir?: string;
    appImage?: string;
    llmupImage?: string;
    appBaseImages: string[];
    llmupBaseImages: string[];
    mode?: string;
    artifactKind?: string;
    manifestPath?: string;
    planPath?: string;
    reportPath?: string;
  } = {
    appBaseImages: [],
    llmupBaseImages: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--release-root':
        rawConfig.releaseRoot = requireArgValue(argv, index);
        index += 1;
        break;
      case '--release-id':
        rawConfig.releaseId = requireArgValue(argv, index);
        index += 1;
        break;
      case '--app-source-dir':
        rawConfig.appSourceDir = requireArgValue(argv, index);
        index += 1;
        break;
      case '--llmup-source-dir':
        rawConfig.llmupSourceDir = requireArgValue(argv, index);
        index += 1;
        break;
      case '--app-image':
        rawConfig.appImage = requireArgValue(argv, index);
        index += 1;
        break;
      case '--llmup-image':
        rawConfig.llmupImage = requireArgValue(argv, index);
        index += 1;
        break;
      case '--app-base-image':
        rawConfig.appBaseImages.push(requireArgValue(argv, index));
        index += 1;
        break;
      case '--llmup-base-image':
        rawConfig.llmupBaseImages.push(requireArgValue(argv, index));
        index += 1;
        break;
      case '--mode':
        rawConfig.mode = requireArgValue(argv, index);
        index += 1;
        break;
      case '--artifact-kind':
        rawConfig.artifactKind = requireArgValue(argv, index);
        index += 1;
        break;
      case '--manifest-path':
        rawConfig.manifestPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--plan-path':
        rawConfig.planPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--report-path':
        rawConfig.reportPath = requireArgValue(argv, index);
        index += 1;
        break;
      default:
        throw new Error(`unsupported build artifact broker adapter argument: ${arg}`);
    }
  }

  const releaseRoot = rawConfig.releaseRoot ? path.resolve(rawConfig.releaseRoot) : undefined;
  if (!releaseRoot) {
    throw new Error('--release-root is required.');
  }

  const mode = rawConfig.mode ?? 'build';
  if (!MODE_SET.has(mode)) {
    throw new Error(`unsupported build artifact broker mode: ${mode}`);
  }
  const artifactKind = rawConfig.artifactKind ?? 'manifest';
  if (!ARTIFACT_KIND_SET.has(artifactKind)) {
    throw new Error(`unsupported build artifact broker artifact kind: ${artifactKind}`);
  }

  return {
    releaseRoot,
    releaseId: rawConfig.releaseId,
    appSourceDir: path.resolve(rawConfig.appSourceDir ?? path.join(releaseRoot, 'sources', 'agentsmith')),
    llmupSourceDir: path.resolve(rawConfig.llmupSourceDir ?? path.join(releaseRoot, 'sources', 'llm-universal-proxy')),
    appImage: rawConfig.appImage,
    llmupImage: rawConfig.llmupImage,
    appBaseImages: rawConfig.appBaseImages,
    llmupBaseImages: rawConfig.llmupBaseImages,
    mode: mode as CurrentBuildManifestMode,
    artifactKind: artifactKind === 'prebuild-plan' ? 'prebuild_plan' : 'manifest',
    manifestPath: path.resolve(rawConfig.manifestPath ?? path.join(releaseRoot, 'build-manifest.json')),
    planPath: path.resolve(rawConfig.planPath ?? path.join(releaseRoot, 'build-artifact-broker-plan.json')),
    reportPath: path.resolve(rawConfig.reportPath ?? path.join(releaseRoot, 'build-artifact-broker-report.json')),
  };
}

function requireArgValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];

  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for ${argv[index]}.`);
  }

  return value;
}

function scanSourceOrDiagnostic(
  target: CurrentBuildArtifactTarget,
  sourceDir: string,
  diagnostics: BuildArtifactBrokerDiagnostic[],
): readonly BuildArtifactBrokerFileInput[] {
  if (!existsSync(sourceDir)) {
    diagnostics.push({
      target,
      reason_code: 'missing_source_dir',
      path: sourceDir,
      message: 'source directory is required.',
    });
    return [];
  }

  try {
    return scanBuildArtifactSourceFiles(sourceDir);
  } catch (error) {
    diagnostics.push({
      target,
      reason_code: 'source_scan_failure',
      path: sourceDir,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function visitSourceDir(
  absoluteDir: string,
  relativeDir: string,
  files: BuildArtifactBrokerFileInput[],
): void {
  const entries = readdirSync(absoluteDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.isDirectory() && shouldExcludeSourceDir(entry.name, relativeDir)) {
      continue;
    }

    const relativePath = normalizeRelativePath(path.join(relativeDir, entry.name));
    const absolutePath = path.join(absoluteDir, entry.name);

    if (entry.isDirectory()) {
      visitSourceDir(absolutePath, relativePath, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    files.push({
      path: relativePath,
      content: readFileSync(absolutePath).toString('base64'),
    });
  }
}

function shouldExcludeSourceDir(name: string, relativeDir: string): boolean {
  return relativeDir === '' && ROOT_ONLY_EXCLUDED_SOURCE_DIRS.has(name);
}

function validateBaseImageLocks(
  target: CurrentBuildArtifactTarget,
  baseImages: readonly string[],
  diagnostics: BuildArtifactBrokerDiagnostic[],
): void {
  if (baseImages.length === 0) {
    diagnostics.push({
      target,
      reason_code: 'missing_base_image_digest_lock',
      path: `base_image:${target}`,
      message: 'at least one pinned base image digest lock is required.',
    });
    return;
  }

  for (const baseImage of baseImages) {
    const parsed = parseLockedImageRef(baseImage);

    if (!parsed.ok) {
      diagnostics.push({
        target,
        reason_code: 'missing_base_image_digest_lock',
        path: `base_image:${baseImage}`,
        message: parsed.reason,
      });
    }
  }
}

function appendLlmupRuntimeKeyModelDiagnostics(
  llmupSourceDir: string,
  diagnostics: BuildArtifactBrokerDiagnostic[],
): void {
  const dockerfilePath = path.join(llmupSourceDir, 'Dockerfile');

  if (!existsSync(dockerfilePath)) {
    return;
  }

  const dockerfileContent = readFileSync(dockerfilePath, 'utf8');
  const copyTestsLine = findDockerfileCopyTestsLine(dockerfileContent);

  if (!copyTestsLine) {
    return;
  }

  diagnostics.push({
    target: 'llmup',
    reason_code: 'llmup_runtime_tests_copy_present',
    path: `${dockerfilePath}:${copyTestsLine.lineNumber}`,
    message: 'llmup Dockerfile copies tests, but the current llmup runtime key model excludes tests.',
  });
}

function findDockerfileCopyTestsLine(content: string): { lineNumber: number } | null {
  const lines = content.split(/\r?\n/u);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();

    if (line === '' || line.startsWith('#')) {
      continue;
    }
    if (/^COPY\s+(?:--\S+\s+)*(?:"tests"|'tests'|tests)(?:\s|\/|$)/iu.test(line)) {
      return {
        lineNumber: index + 1,
      };
    }
  }

  return null;
}

function probeImageDigest(imageRef: string, env: NodeJS.ProcessEnv): ImageDigestProbeResult {
  const overrideCommand = env.BUILD_ARTIFACT_BROKER_IMAGE_DIGEST_COMMAND?.trim();

  try {
    const output = overrideCommand
      ? execFileSync(overrideCommand, [imageRef], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
      : execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', imageRef], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    const digest = normalizeDigestOutput(output);

    if (!digest) {
      return {
        ok: false,
        reason: `image digest probe returned an invalid digest for ${imageRef}.`,
      };
    }

    return {
      ok: true,
      digest,
    };
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';

    return {
      ok: false,
      reason: `local image digest is missing for ${imageRef}.${detail}`.trim(),
    };
  }
}

function normalizeDigestOutput(output: string): string | null {
  const firstLine = output.trim().split(/\r?\n/u)[0]?.trim() ?? '';
  const digestMatch = firstLine.match(/^(?:sha256:)?(?<hex>[a-fA-F0-9]{64})$/u);

  if (!digestMatch?.groups?.hex) {
    return null;
  }

  return `sha256:${digestMatch.groups.hex.toLowerCase()}`;
}

function writeDiagnosticReport(
  context: BrokerRunContext,
  releaseId: string,
  diagnostics: readonly BuildArtifactBrokerDiagnostic[],
  exitCode: number,
): BrokerRunResult {
  const report: BuildArtifactBrokerDiagnosticReport = {
    schema: DIAGNOSTIC_REPORT_SCHEMA,
    version: DIAGNOSTIC_REPORT_VERSION,
    report_kind: 'build_artifact_broker_diagnostic',
    run_id: context.runId,
    release_id: releaseId,
    version_path: context.versionPath,
    mode: context.config.mode,
    producer: context.producer,
    generated_at: context.generatedAt,
    diagnostics,
    outputs: {
      manifest_path: context.config.manifestPath,
      plan_path: context.config.planPath,
      report_path: context.config.reportPath,
    },
  };

  rmSync(context.config.manifestPath, { force: true });
  rmSync(context.config.planPath, { force: true });
  writeJson(context.config.reportPath, report);

  return {
    exitCode,
    artifactPath: context.config.reportPath,
    artifactKind: 'diagnostic_report',
  };
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildProducer(env: NodeJS.ProcessEnv): CurrentBuildManifestProducer {
  return {
    name: 'build-artifact-broker',
    version: env.BUILD_ARTIFACT_BROKER_PRODUCER_VERSION ?? 'p2-build-artifact-broker',
    command: 'scripts/governance/build-artifact-broker-cli.ts',
    runtime: `node ${process.version}`,
  };
}

function parseVersionValues(text: string): ReadonlyMap<string, string> {
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

function imageRepositoryFromRef(ref: string): string {
  const refWithoutDigest = ref.split('@')[0] ?? ref;
  const lastSlashIndex = refWithoutDigest.lastIndexOf('/');
  const lastColonIndex = refWithoutDigest.lastIndexOf(':');

  if (lastColonIndex > lastSlashIndex) {
    return refWithoutDigest.slice(0, lastColonIndex);
  }

  return refWithoutDigest;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll(path.sep, '/').replace(/^\.\//u, '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runBuildArtifactBrokerCli());
}
