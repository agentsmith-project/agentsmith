import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  AGENTSMITH_CANONICAL_REPO,
  CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
  CURRENT_RUNNER_CONTRACT_ARTIFACT_SCHEMA_VERSION,
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateRunnerContractArtifactDescriptor,
  type CurrentRunnerContractArtifactDescriptor,
} from './current-release-boundary-schema';

export const RUNNER_CONTRACT_ARTIFACT_DESCRIPTOR_NAME = 'runner-contract-artifact.json' as const;
export const RUNNER_CONTRACT_ARTIFACT_GENERATOR_COMMAND =
  'npx tsx scripts/governance/runner-contract-artifact.ts' as const;
export const RUNNER_CONTRACT_ARTIFACT_GENERATOR_VERSION = 'p4-runner-contract-artifact' as const;

const DEFAULT_OUTPUT_DIR = 'artifacts/runner-contract';
const PACKAGE_NAME = '@mbos/agent-runner-contract';
const PACKAGE_MANIFEST_SCHEMA_VERSION = 'agentsmith.runner-contract-package-manifest/v1';
const PACKAGE_MANIFEST_METADATA_KIND = 'runner_contract_package_manifest';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const PACKAGE_DIR = path.join(REPO_ROOT, 'packages/agent-runner-contract');
const PACKAGE_JSON_PATH = path.join(PACKAGE_DIR, 'package.json');
const ARTIFACT_MANIFEST_PATH = path.join(PACKAGE_DIR, 'contract-artifact.json');
const PACKAGE_MANIFEST_RELEASE_PROVENANCE = {
  kind: 'external_descriptor',
  descriptor_name: RUNNER_CONTRACT_ARTIFACT_DESCRIPTOR_NAME,
} as const;
const PACKAGE_MANIFEST_FORBIDDEN_ROOT_FIELDS = [
  'name',
  'version',
  'artifact_kind',
  'formal_release_provenance',
  'provenance_note',
  'artifact',
  'artifact_provenance',
  'provenance',
  'sha256',
  'integrity',
] as const;
const REQUIRED_DIST_FILE_PATHS = [
  'dist/artifact.d.ts',
  'dist/artifact.js',
  'dist/contract-schema.d.ts',
  'dist/contract-schema.js',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/protocol.d.ts',
  'dist/protocol.js',
  'dist/runner-spec.d.ts',
  'dist/runner-spec.js',
] as const;

type JsonObject = Record<string, unknown>;

export interface RunnerContractArtifactCiInput {
  producerRepo: typeof AGENTSMITH_CANONICAL_REPO;
  commitSha: string;
  workflowName: string;
  runId: string;
  runAttempt: string;
  job: string;
  generatedAt: string;
}

export interface CreateRunnerContractArtifactDescriptorInput {
  packageName: '@mbos/agent-runner-contract';
  packageVersion: string;
  artifactFilename: string;
  artifactUri: string;
  artifactSha256: string;
  artifactIntegrity: string;
  entrypoints: CurrentRunnerContractArtifactDescriptor['entrypoints'];
  ci: RunnerContractArtifactCiInput;
}

interface RunnerContractArtifactCliOptions {
  argv?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

interface RunnerContractArtifactCliConfig {
  outputDir: string;
  artifactUri?: string;
}

type RequiredGitHubEnvKey =
  | 'GITHUB_REPOSITORY'
  | 'GITHUB_SHA'
  | 'GITHUB_WORKFLOW'
  | 'GITHUB_RUN_ID'
  | 'GITHUB_RUN_ATTEMPT'
  | 'GITHUB_JOB';

type NpmPackResult = {
  filename?: unknown;
};

const REQUIRED_GITHUB_ENV_KEYS = [
  'GITHUB_REPOSITORY',
  'GITHUB_SHA',
  'GITHUB_WORKFLOW',
  'GITHUB_RUN_ID',
  'GITHUB_RUN_ATTEMPT',
  'GITHUB_JOB',
] as const satisfies readonly RequiredGitHubEnvKey[];

export function createRunnerContractArtifactDescriptor(
  input: CreateRunnerContractArtifactDescriptorInput,
): CurrentRunnerContractArtifactDescriptor {
  const descriptorSubject: Omit<CurrentRunnerContractArtifactDescriptor, 'artifact_provenance'> = {
    schema_version: CURRENT_RUNNER_CONTRACT_ARTIFACT_SCHEMA_VERSION,
    package: {
      name: input.packageName,
      version: input.packageVersion,
    },
    artifact: {
      filename: input.artifactFilename,
      uri: input.artifactUri,
      sha256: input.artifactSha256,
      integrity: input.artifactIntegrity,
    },
    entrypoints: input.entrypoints,
  };

  return {
    ...descriptorSubject,
    artifact_provenance: {
      schema_version: CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
      provenance_kind: 'ci_artifact',
      producer_repo: input.ci.producerRepo,
      normalized_remote: input.ci.producerRepo,
      commit_sha: input.ci.commitSha,
      subject_name: 'runner-contract-artifact',
      subject_sha256: sha256Digest(canonicalReleaseBoundaryJson(descriptorSubject)),
      subject_uri: RUNNER_CONTRACT_ARTIFACT_DESCRIPTOR_NAME,
      workflow_name: input.ci.workflowName,
      run_id: input.ci.runId,
      run_attempt: input.ci.runAttempt,
      job: input.ci.job,
      artifact_uri: input.artifactUri,
      artifact_sha256: input.artifactSha256,
      generated_at: input.ci.generatedAt,
      generator_command: RUNNER_CONTRACT_ARTIFACT_GENERATOR_COMMAND,
      generator_version: RUNNER_CONTRACT_ARTIFACT_GENERATOR_VERSION,
      attestation: 'none',
    },
  };
}

export function runRunnerContractArtifactCli(options: RunnerContractArtifactCliOptions = {}): number {
  const argv = options.argv ?? process.argv.slice(2);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((message: string) => console.log(message));
  const stderr = options.stderr ?? ((message: string) => console.error(message));

  try {
    const config = parseCliArgs(argv, cwd);
    const ci = resolveCiInput(env);
    mkdirSync(config.outputDir, { recursive: true });

    const packageJson = readJsonObject(PACKAGE_JSON_PATH);
    const packageManifest = readJsonObject(ARTIFACT_MANIFEST_PATH);
    const packageName = readPackageName(packageJson);
    const packageVersion = readPackageVersion(packageJson);
    const entrypoints = readRunnerContractPackageManifestEntrypoints(packageManifest, packageName, packageVersion);

    const stagingRoot = createRunnerContractArtifactStagingPackage(packageJson);
    let artifactFilename = '';
    try {
      const stagingPackageDir = path.join(stagingRoot, 'package');
      const packOutput = runNpm(['pack', '--json', stagingPackageDir, '--pack-destination', config.outputDir], REPO_ROOT);
      const packResult = parseNpmPackResult(packOutput);
      if (typeof packResult.filename !== 'string' || packResult.filename.trim().length === 0) {
        throw new Error('npm pack must report a tgz filename.');
      }
      artifactFilename = packResult.filename;
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }

    const artifactPath = path.join(config.outputDir, artifactFilename);
    if (!existsSync(artifactPath)) {
      throw new Error(`npm pack did not write ${artifactPath}.`);
    }

    const artifactBytes = readFileSync(artifactPath);
    const artifactSha256 = sha256BufferDigest(artifactBytes);
    const artifactIntegrity = npmSha512Integrity(artifactBytes);
    const artifactUri = config.artifactUri ?? defaultArtifactUri(ci, artifactFilename);
    const descriptor = createRunnerContractArtifactDescriptor({
      packageName,
      packageVersion,
      artifactFilename,
      artifactUri,
      artifactSha256,
      artifactIntegrity,
      entrypoints,
      ci,
    });

    const validation = validateRunnerContractArtifactDescriptor(descriptor);
    if (!validation.ok) {
      throw new Error([
        'runner contract artifact descriptor failed validation:',
        ...validation.failures.map((failure) => `- ${failure.path}: ${failure.reason}`),
      ].join('\n'));
    }

    const descriptorPath = path.join(config.outputDir, RUNNER_CONTRACT_ARTIFACT_DESCRIPTOR_NAME);
    writeJsonAtomically(descriptorPath, descriptor);
    stdout(`runner contract artifact descriptor: ${descriptorPath}`);
    stdout(`runner contract artifact tgz: ${artifactPath}`);
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function createSanitizedRunnerContractPackageJson(sourcePackageJson: JsonObject): JsonObject {
  return {
    name: readPackageName(sourcePackageJson),
    version: readPackageVersion(sourcePackageJson),
    type: readPackageStringField(sourcePackageJson, 'type'),
    main: readPackageStringField(sourcePackageJson, 'main'),
    types: readPackageStringField(sourcePackageJson, 'types'),
    exports: cloneJsonField(sourcePackageJson, 'exports'),
    files: cloneJsonField(sourcePackageJson, 'files'),
  };
}

function createRunnerContractArtifactStagingPackage(sourcePackageJson: JsonObject): string {
  const stagingRoot = mkdtempSync(path.join(tmpdir(), 'agent-runner-contract-artifact-'));
  const stagingPackageDir = path.join(stagingRoot, 'package');

  try {
    mkdirSync(path.join(stagingPackageDir, 'dist'), { recursive: true });
    for (const relativePath of REQUIRED_DIST_FILE_PATHS) {
      copyRequiredPackageFile(relativePath, stagingPackageDir);
    }
    copyRequiredPackageFile('contract-artifact.json', stagingPackageDir);
    writeFileSync(
      path.join(stagingPackageDir, 'package.json'),
      `${JSON.stringify(createSanitizedRunnerContractPackageJson(sourcePackageJson), null, 2)}\n`,
    );
    return stagingRoot;
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function copyRequiredPackageFile(relativePath: string, stagingPackageDir: string): void {
  const sourcePath = path.join(PACKAGE_DIR, relativePath);
  if (!existsSync(sourcePath)) {
    throw new Error(
      `packages/agent-runner-contract/${relativePath} must exist before producing the runner contract artifact. Run npm run build -w @mbos/agent-runner-contract first.`,
    );
  }
  const outputPath = path.join(stagingPackageDir, relativePath);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  copyFileSync(sourcePath, outputPath);
}

function parseCliArgs(argv: readonly string[], cwd: string): RunnerContractArtifactCliConfig {
  let outputDir: string | undefined;
  let artifactUri: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--output-dir':
        outputDir = requireArgValue(argv, index);
        index += 1;
        break;
      case '--artifact-uri':
        artifactUri = requireArgValue(argv, index);
        index += 1;
        break;
      default:
        throw new Error(`unsupported runner contract artifact argument: ${arg}`);
    }
  }

  return {
    outputDir: path.resolve(cwd, outputDir ?? DEFAULT_OUTPUT_DIR),
    artifactUri,
  };
}

function requireArgValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--') || value.trim().length === 0) {
    throw new Error(`missing value for ${argv[index]}.`);
  }
  return value;
}

function resolveCiInput(
  env: Readonly<Record<string, string | undefined>>,
): RunnerContractArtifactCiInput {
  const missingKeys = REQUIRED_GITHUB_ENV_KEYS.filter((key) => !firstNonEmptyString(env[key]));
  if (missingKeys.length > 0) {
    throw new Error(`missing required GitHub Actions environment variables: ${missingKeys.join(', ')}`);
  }

  const repository = requireGitHubEnv(env, 'GITHUB_REPOSITORY');
  const producerRepo = `github.com/${repository}`;
  if (producerRepo !== AGENTSMITH_CANONICAL_REPO) {
    throw new Error('GITHUB_REPOSITORY must be agentsmith-project/agentsmith.');
  }

  return {
    producerRepo: AGENTSMITH_CANONICAL_REPO,
    commitSha: requireGitHubEnv(env, 'GITHUB_SHA'),
    workflowName: requireGitHubEnv(env, 'GITHUB_WORKFLOW'),
    runId: requireGitHubEnv(env, 'GITHUB_RUN_ID'),
    runAttempt: requireGitHubEnv(env, 'GITHUB_RUN_ATTEMPT'),
    job: requireGitHubEnv(env, 'GITHUB_JOB'),
    generatedAt: firstNonEmptyString(env.AGENTSMITH_RUNNER_CONTRACT_ARTIFACT_GENERATED_AT)
      ?? new Date().toISOString(),
  };
}

function defaultArtifactUri(
  ci: RunnerContractArtifactCiInput,
  artifactFilename: string,
): string {
  return `gh-artifact://agentsmith-project/agentsmith/runner-contract-artifact/${ci.runId}/${artifactFilename}`;
}

function requireGitHubEnv(
  env: Readonly<Record<string, string | undefined>>,
  key: RequiredGitHubEnvKey,
): string {
  const value = firstNonEmptyString(env[key]);
  if (!value) {
    throw new Error(`missing required GitHub Actions environment variable: ${key}`);
  }
  return value;
}

function runNpm(args: string[], cwd: string): string {
  return execFileSync('npm', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseNpmPackResult(output: string): NpmPackResult {
  const parsed = JSON.parse(output) as unknown;
  if (!Array.isArray(parsed) || !isRecord(parsed[0])) {
    throw new Error('npm pack --json did not return the expected result array.');
  }
  return parsed[0] as NpmPackResult;
}

function readJsonObject(filePath: string): JsonObject {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${path.relative(REPO_ROOT, filePath)} must be a JSON object.`);
  }
  return parsed;
}

function readPackageName(packageJson: JsonObject): '@mbos/agent-runner-contract' {
  if (packageJson.name !== PACKAGE_NAME) {
    throw new Error(`packages/agent-runner-contract/package.json name must be ${PACKAGE_NAME}.`);
  }
  return PACKAGE_NAME;
}

function readPackageVersion(packageJson: JsonObject): string {
  if (typeof packageJson.version !== 'string' || packageJson.version.trim().length === 0) {
    throw new Error('packages/agent-runner-contract/package.json version must be a non-empty string.');
  }
  return packageJson.version;
}

function readPackageStringField(packageJson: JsonObject, fieldName: string): string {
  const value = packageJson[fieldName];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`packages/agent-runner-contract/package.json ${fieldName} must be a non-empty string.`);
  }
  return value;
}

function cloneJsonField(packageJson: JsonObject, fieldName: string): unknown {
  const value = packageJson[fieldName];
  if (value === undefined) {
    throw new Error(`packages/agent-runner-contract/package.json ${fieldName} must be present.`);
  }
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export function readRunnerContractPackageManifestEntrypoints(
  packageManifest: JsonObject,
  packageName: '@mbos/agent-runner-contract',
  packageVersion: string,
): CurrentRunnerContractArtifactDescriptor['entrypoints'] {
  if (packageManifest.artifact_kind === 'local_pack_manifest') {
    throw new Error('packages/agent-runner-contract/contract-artifact.json must use package manifest v1, not legacy local_pack_manifest.');
  }

  for (const fieldName of PACKAGE_MANIFEST_FORBIDDEN_ROOT_FIELDS) {
    if (Object.hasOwn(packageManifest, fieldName)) {
      throw new Error(`packages/agent-runner-contract/contract-artifact.json ${fieldName} must not be present in package manifest.`);
    }
  }

  if (packageManifest.schema_version !== PACKAGE_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `packages/agent-runner-contract/contract-artifact.json schema_version must be ${PACKAGE_MANIFEST_SCHEMA_VERSION}.`,
    );
  }
  if (packageManifest.metadata_kind !== PACKAGE_MANIFEST_METADATA_KIND) {
    throw new Error(
      `packages/agent-runner-contract/contract-artifact.json metadata_kind must be ${PACKAGE_MANIFEST_METADATA_KIND}.`,
    );
  }

  if (!isRecord(packageManifest.package)) {
    throw new Error('packages/agent-runner-contract/contract-artifact.json package must be an object.');
  }
  if (packageManifest.package.name !== packageName) {
    throw new Error(`packages/agent-runner-contract/contract-artifact.json package.name must be ${packageName}.`);
  }
  if (packageManifest.package.version !== packageVersion) {
    throw new Error(`packages/agent-runner-contract/contract-artifact.json package.version must be ${packageVersion}.`);
  }

  if (canonicalReleaseBoundaryJson(packageManifest.release_provenance)
    !== canonicalReleaseBoundaryJson(PACKAGE_MANIFEST_RELEASE_PROVENANCE)) {
    throw new Error(
      `packages/agent-runner-contract/contract-artifact.json release_provenance must point to ${RUNNER_CONTRACT_ARTIFACT_DESCRIPTOR_NAME}.`,
    );
  }

  const entrypoints = packageManifest.entrypoints;
  if (!isRecord(entrypoints)) {
    throw new Error('packages/agent-runner-contract/contract-artifact.json entrypoints must be an object.');
  }

  const expected = {
    version: './dist/artifact.js',
    schema: './dist/contract-schema.js',
    types: './dist/index.d.ts',
    fixtures: './dist/contract-schema.js',
  } as const;

  for (const [key, value] of Object.entries(expected)) {
    if (entrypoints[key] !== value) {
      throw new Error(`contract-artifact.entrypoints.${key} must be ${value}.`);
    }
  }

  return expected;
}

function sha256BufferDigest(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function npmSha512Integrity(bytes: Buffer): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function writeJsonAtomically(outputPath: string, value: unknown): void {
  const outputDir = path.dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });
  const tempPath = path.join(outputDir, `.${path.basename(outputPath)}.${process.pid}.tmp`);

  try {
    writeFileSync(tempPath, `${canonicalReleaseBoundaryJson(value)}\n`);
    renameSync(tempPath, outputPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function firstNonEmptyString(value: string | undefined): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runRunnerContractArtifactCli());
}
