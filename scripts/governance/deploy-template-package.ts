import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  AGENTSMITH_CANONICAL_REPO,
  CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
  CURRENT_DEPLOY_TEMPLATE_PACKAGE_SCHEMA_VERSION,
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateDeployTemplatePackage,
  type CurrentArtifactProvenance,
  type CurrentDeployTemplatePackage,
  type CurrentReleaseBoundaryValidationFailure,
} from './current-release-boundary-schema';

export const DEPLOY_TEMPLATE_PACKAGE_ARCHIVE_NAME = 'agentsmith-deploy-template-package.tgz' as const;
export const DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME = 'deploy-template-package.json' as const;
export const DEPLOY_TEMPLATE_PACKAGE_MANIFEST_NAME = 'manifest.json' as const;
export const DEPLOY_TEMPLATE_PACKAGE_MANIFEST_SCHEMA_VERSION =
  'agentsmith.deploy-template-package.manifest/v1' as const;

const DEPLOY_ROOT_RELATIVE_PATH = 'infra/deploy/unified';
const DEPLOYMENT_MANIFEST_FILE_NAME = 'deployment.manifest.json';
const DEPLOYMENT_MANIFEST_SOURCE_RELATIVE_PATH =
  `${DEPLOY_ROOT_RELATIVE_PATH}/${DEPLOYMENT_MANIFEST_FILE_NAME}`;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const RESERVED_TEMPLATE_GROUP_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const TEMPLATE_GROUP_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;
const RESERVED_TEMPLATE_PACKAGE_PATHS = new Set([
  DEPLOY_TEMPLATE_PACKAGE_MANIFEST_NAME,
  DEPLOYMENT_MANIFEST_FILE_NAME,
]);
const REQUIRED_CI_PROVENANCE_STRING_FIELDS = [
  'workflow_name',
  'run_id',
  'run_attempt',
  'job',
  'generated_at',
  'generator_command',
  'generator_version',
] as const satisfies readonly (keyof DeployTemplatePackageCiProvenanceInput)[];

export interface DeployTemplatePackageCiProvenanceInput {
  workflow_name: string;
  run_id: string;
  run_attempt: string;
  job: string;
  generated_at: string;
  generator_command: string;
  generator_version: string;
  subject_uri?: string;
  attestation: CurrentArtifactProvenance['attestation'];
}

export interface DeployTemplatePackageGenerationInput {
  package_uri: string;
  git_sha: string;
  ci_provenance: DeployTemplatePackageCiProvenanceInput;
}

export interface DeployTemplatePackageGenerationOptions {
  repoRoot?: string;
  outputDir: string;
  sourceGitSha: string;
}

export interface DeployTemplatePackageManifestFile {
  path: string;
  sha256: string;
}

export interface DeployTemplatePackageManifest {
  schema_version: typeof DEPLOY_TEMPLATE_PACKAGE_MANIFEST_SCHEMA_VERSION;
  source_deployment_manifest: {
    path: typeof DEPLOYMENT_MANIFEST_SOURCE_RELATIVE_PATH;
    package_path: typeof DEPLOYMENT_MANIFEST_FILE_NAME;
    sha256: string;
  };
  template_groups: Readonly<Record<string, readonly string[]>>;
  package_files: readonly DeployTemplatePackageManifestFile[];
}

export interface DeployTemplatePackageGenerationResult {
  archivePath: string;
  descriptorPath: string;
  descriptor: CurrentDeployTemplatePackage;
  manifest: DeployTemplatePackageManifest;
}

interface PackageFileSource {
  packagePath: string;
  sourcePath: string;
}

class DeployTemplatePackageGenerationError extends Error {
  constructor(readonly failures: readonly CurrentReleaseBoundaryValidationFailure[]) {
    super(formatFailures('deploy template package generation failed:', failures));
    this.name = 'DeployTemplatePackageGenerationError';
  }
}

export function generateDeployTemplatePackage(
  input: DeployTemplatePackageGenerationInput,
  options: DeployTemplatePackageGenerationOptions,
): DeployTemplatePackageGenerationResult {
  const normalizedInput = normalizeGeneratorInput(input, options);
  assertValidDescriptor(buildDescriptor(normalizedInput, ZERO_DIGEST, ZERO_DIGEST));

  const repoRoot = resolveRepoRoot(options.repoRoot ?? process.cwd());
  const outputDir = path.resolve(normalizedInput.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const deployRoot = resolveDeployRoot(repoRoot);
  const deploymentManifestSourcePath = resolveRequiredPackageFilePath(
    deployRoot,
    DEPLOYMENT_MANIFEST_FILE_NAME,
    DEPLOYMENT_MANIFEST_FILE_NAME,
  );
  const deploymentManifestBytes = readRequiredFile(deploymentManifestSourcePath);
  const deploymentManifest = parseDeploymentManifest(deploymentManifestBytes, deploymentManifestSourcePath);
  const templateGroups = resolveTemplateGroups(deploymentManifest, deployRoot);
  const packageSources = buildPackageSources(deployRoot, templateGroups, deploymentManifestSourcePath);
  const packageFiles = packageSources
    .map((source) => ({
      path: source.packagePath,
      sha256: sha256FileDigest(source.sourcePath),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const manifest: DeployTemplatePackageManifest = {
    schema_version: DEPLOY_TEMPLATE_PACKAGE_MANIFEST_SCHEMA_VERSION,
    source_deployment_manifest: {
      path: DEPLOYMENT_MANIFEST_SOURCE_RELATIVE_PATH,
      package_path: DEPLOYMENT_MANIFEST_FILE_NAME,
      sha256: sha256BufferDigest(deploymentManifestBytes),
    },
    template_groups: templateGroups,
    package_files: packageFiles,
  };
  const manifestBytes = Buffer.from(`${canonicalReleaseBoundaryJson(manifest)}\n`, 'utf8');
  const manifestSha256 = sha256BufferDigest(manifestBytes);

  const archivePath = path.join(outputDir, DEPLOY_TEMPLATE_PACKAGE_ARCHIVE_NAME);
  const descriptorPath = path.join(outputDir, DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME);
  const tempArchivePath = path.join(outputDir, `.${DEPLOY_TEMPLATE_PACKAGE_ARCHIVE_NAME}.${process.pid}.tmp`);
  const stagingRoot = mkdtempSync(path.join(tmpdir(), 'agentsmith-deploy-template-package-'));

  try {
    const packageRoot = path.join(stagingRoot, 'package');
    mkdirSync(packageRoot, { recursive: true });
    stagePackageFiles(packageRoot, packageSources);
    writeFileSync(path.join(packageRoot, DEPLOY_TEMPLATE_PACKAGE_MANIFEST_NAME), manifestBytes);

    createDeterministicArchive(tempArchivePath, packageRoot, [
      DEPLOY_TEMPLATE_PACKAGE_MANIFEST_NAME,
      ...packageFiles.map((file) => file.path),
    ]);
    const packageSha256 = sha256FileDigest(tempArchivePath);
    const descriptor = buildDescriptor(normalizedInput, packageSha256, manifestSha256);
    assertValidDescriptor(descriptor);

    renameSync(tempArchivePath, archivePath);
    writeJsonAtomically(descriptorPath, descriptor);

    return {
      archivePath,
      descriptorPath,
      descriptor,
      manifest,
    };
  } catch (error) {
    rmSync(tempArchivePath, { force: true });
    throw error;
  } finally {
    rmSync(stagingRoot, { force: true, recursive: true });
  }
}

function normalizeGeneratorInput(
  input: DeployTemplatePackageGenerationInput,
  options: DeployTemplatePackageGenerationOptions,
): DeployTemplatePackageGenerationInput & { outputDir: string } {
  if (!isRecord(input)) {
    throw new Error('deploy template package generator input must be an object.');
  }
  if (!isRecord(options)) {
    throw new Error('deploy template package generation options must be an object.');
  }
  if (!isRecord(input.ci_provenance)) {
    throw new Error('ci_provenance must be an object.');
  }

  const packageUri = requireNonEmptyString(input.package_uri, 'package_uri');
  const gitSha = requireNonEmptyString(input.git_sha, 'git_sha');
  const sourceGitSha = requireNonEmptyString(options.sourceGitSha, 'sourceGitSha');
  if (gitSha !== sourceGitSha) {
    throw new Error('git_sha must match sourceGitSha.');
  }
  const outputDir = requireNonEmptyString(options.outputDir, 'outputDir');

  for (const field of REQUIRED_CI_PROVENANCE_STRING_FIELDS) {
    requireOwnNonEmptyString(input.ci_provenance, field, `ci_provenance.${field}`);
  }
  if (!Object.hasOwn(input.ci_provenance, 'attestation') || input.ci_provenance.attestation === undefined) {
    throw new Error('ci_provenance.attestation is required.');
  }

  return {
    package_uri: packageUri,
    git_sha: gitSha,
    ci_provenance: input.ci_provenance,
    outputDir,
  };
}

function buildDescriptor(
  input: DeployTemplatePackageGenerationInput,
  packageSha256: string,
  manifestSha256: string,
): CurrentDeployTemplatePackage {
  const subject: Omit<CurrentDeployTemplatePackage, 'artifact_provenance'> = {
    schema_version: CURRENT_DEPLOY_TEMPLATE_PACKAGE_SCHEMA_VERSION,
    package_uri: input.package_uri,
    package_sha256: packageSha256,
    manifest_sha256: manifestSha256,
  };

  return {
    ...subject,
    artifact_provenance: {
      schema_version: CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
      provenance_kind: 'ci_artifact',
      producer_repo: AGENTSMITH_CANONICAL_REPO,
      normalized_remote: AGENTSMITH_CANONICAL_REPO,
      commit_sha: input.git_sha,
      subject_name: 'agentsmith-deploy-template-package',
      subject_sha256: sha256Digest(canonicalReleaseBoundaryJson(subject)),
      subject_uri: input.ci_provenance.subject_uri ?? DEPLOY_TEMPLATE_PACKAGE_DESCRIPTOR_NAME,
      workflow_name: input.ci_provenance.workflow_name,
      run_id: input.ci_provenance.run_id,
      run_attempt: input.ci_provenance.run_attempt,
      job: input.ci_provenance.job,
      artifact_uri: input.package_uri,
      artifact_sha256: packageSha256,
      generated_at: input.ci_provenance.generated_at,
      generator_command: input.ci_provenance.generator_command,
      generator_version: input.ci_provenance.generator_version,
      attestation: input.ci_provenance.attestation,
    },
  };
}

function assertValidDescriptor(descriptor: CurrentDeployTemplatePackage): void {
  const validation = validateDeployTemplatePackage(descriptor);
  if (!validation.ok) {
    throw new DeployTemplatePackageGenerationError(validation.failures);
  }
}

function parseDeploymentManifest(bytes: Buffer, manifestPath: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${manifestPath} must be valid JSON: ${reason}`);
  }
}

function resolveTemplateGroups(
  deploymentManifest: unknown,
  deployRoot: string,
): Readonly<Record<string, readonly string[]>> {
  if (!isRecord(deploymentManifest)) {
    throw new Error('deployment manifest must be an object.');
  }
  if (!isRecord(deploymentManifest.templates)) {
    throw new Error('deployment manifest templates must be an object.');
  }

  const seenPaths = new Set<string>();
  const groups = new Map<string, string[]>();
  for (const [groupName, rawPaths] of Object.entries(deploymentManifest.templates).sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    assertSafeTemplateGroupName(groupName);

    if (!Array.isArray(rawPaths)) {
      throw new Error(`deployment manifest templates.${groupName} must be an array.`);
    }

    const groupPaths = rawPaths.map((rawPath, index) => {
      if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
        throw new Error(`deployment manifest templates.${groupName}[${index}] must be a non-empty string.`);
      }
      if (!isSafeRelativePackagePath(rawPath)) {
        throw new Error(`template path "${rawPath}" must be a safe relative path.`);
      }
      if (RESERVED_TEMPLATE_PACKAGE_PATHS.has(rawPath)) {
        throw new Error(`template path "${rawPath}" is a reserved package path.`);
      }
      if (!isTemplatePackagePath(rawPath)) {
        throw new Error(`template path "${rawPath}" must start with templates/ and end with .tpl.`);
      }
      if (seenPaths.has(rawPath)) {
        throw new Error(`template path "${rawPath}" is declared more than once.`);
      }

      resolveTemplateSourcePath(deployRoot, rawPath);
      seenPaths.add(rawPath);
      return rawPath;
    });

    groups.set(groupName, groupPaths);
  }

  return Object.fromEntries(groups) as Readonly<Record<string, readonly string[]>>;
}

function buildPackageSources(
  deployRoot: string,
  templateGroups: Readonly<Record<string, readonly string[]>>,
  deploymentManifestSourcePath: string,
): PackageFileSource[] {
  const sources: PackageFileSource[] = [
    {
      packagePath: DEPLOYMENT_MANIFEST_FILE_NAME,
      sourcePath: deploymentManifestSourcePath,
    },
  ];

  for (const templatePath of Object.values(templateGroups).flat()) {
    sources.push({
      packagePath: templatePath,
      sourcePath: resolveTemplateSourcePath(deployRoot, templatePath),
    });
  }

  return sources;
}

function stagePackageFiles(packageRoot: string, sources: readonly PackageFileSource[]): void {
  for (const source of sources) {
    const outputPath = path.join(packageRoot, source.packagePath);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    copyFileSync(source.sourcePath, outputPath);
  }
}

function createDeterministicArchive(
  archivePath: string,
  packageRoot: string,
  entries: readonly string[],
): void {
  execFileSync('tar', [
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--format=ustar',
    '--mode=0644',
    '--use-compress-program=gzip -n',
    '-cf',
    archivePath,
    '-C',
    packageRoot,
    '--',
    ...[...entries].sort((left, right) => left.localeCompare(right)),
  ]);
}

function readRequiredFile(filePath: string): Buffer {
  try {
    return readFileSync(filePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`required deploy template package source file is missing: ${filePath}: ${reason}`);
  }
}

function resolveRepoRoot(repoRootInput: string): string {
  const repoRoot = path.resolve(repoRootInput);
  const repoRootStatus = lstatSync(repoRoot, { throwIfNoEntry: false });
  if (!repoRootStatus?.isDirectory()) {
    throw new Error(`repoRoot must exist and be a directory: ${repoRoot}`);
  }

  return realpathSync(repoRoot);
}

function resolveDeployRoot(repoRoot: string): string {
  const deployRoot = path.join(repoRoot, DEPLOY_ROOT_RELATIVE_PATH);
  assertNoSymlinkSegments(repoRoot, deployRoot, DEPLOY_ROOT_RELATIVE_PATH);

  const deployRootStatus = lstatSync(deployRoot, { throwIfNoEntry: false });
  if (!deployRootStatus?.isDirectory()) {
    throw new Error(`${DEPLOY_ROOT_RELATIVE_PATH} must exist and be a directory.`);
  }

  const deployRootRealPath = realpathSync(deployRoot);
  assertContainedPath(repoRoot, deployRootRealPath, DEPLOY_ROOT_RELATIVE_PATH);
  return deployRootRealPath;
}

function resolveTemplateSourcePath(deployRoot: string, relativePath: string): string {
  return resolveRequiredPackageFilePath(deployRoot, relativePath, `template path "${relativePath}"`);
}

function resolveRequiredPackageFilePath(deployRoot: string, relativePath: string, label: string): string {
  const root = path.resolve(deployRoot);
  const resolved = path.resolve(root, relativePath);
  assertContainedPath(root, resolved, label);
  assertNoSymlinkSegments(root, resolved, label);

  const sourceStatus = lstatSync(resolved, { throwIfNoEntry: false });
  if (!sourceStatus?.isFile()) {
    throw new Error(`${label} does not exist or is not a file.`);
  }

  const realPath = realpathSync(resolved);
  assertContainedPath(root, realPath, label);
  return realPath;
}

function assertContainedPath(root: string, candidate: string, label: string): void {
  if (!isPathInsideOrEqual(path.resolve(root), path.resolve(candidate))) {
    throw new Error(`${label} must stay under ${DEPLOY_ROOT_RELATIVE_PATH}.`);
  }
}

function assertNoSymlinkSegments(root: string, candidate: string, label: string): void {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(candidate);
  assertContainedPath(rootPath, candidatePath, label);

  const relativePath = path.relative(rootPath, candidatePath);
  if (relativePath.length === 0) {
    return;
  }

  let currentPath = rootPath;
  for (const segment of relativePath.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    const segmentStatus = lstatSync(currentPath, { throwIfNoEntry: false });
    if (!segmentStatus) {
      throw new Error(`${label} does not exist.`);
    }
    if (segmentStatus.isSymbolicLink()) {
      throw new Error(`${label} must not contain symlink segments.`);
    }
  }
}

function isPathInsideOrEqual(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function assertSafeTemplateGroupName(groupName: string): void {
  if (RESERVED_TEMPLATE_GROUP_NAMES.has(groupName) || !TEMPLATE_GROUP_NAME_PATTERN.test(groupName)) {
    throw new Error(`deployment manifest template group name "${groupName}" is not allowed.`);
  }
}

function isTemplatePackagePath(value: string): boolean {
  return value.startsWith('templates/') && value.endsWith('.tpl');
}

function isSafeRelativePackagePath(value: string): boolean {
  if (
    value.trim() !== value
    || value.length === 0
    || value.startsWith('/')
    || value.startsWith('\\')
    || value.includes('\\')
    || value.includes('\0')
  ) {
    return false;
  }

  const segments = value.split('/');
  return !segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..');
}

function sha256FileDigest(filePath: string): string {
  return sha256BufferDigest(readFileSync(filePath));
}

function sha256BufferDigest(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
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

function requireOwnNonEmptyString<T extends Record<string, unknown>>(
  record: T,
  key: keyof T,
  pathName: string,
): string {
  if (!Object.hasOwn(record, key)) {
    throw new Error(`${pathName} must be a non-empty string.`);
  }

  return requireNonEmptyString(record[key], pathName);
}

function requireNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${pathName} must be a non-empty string.`);
  }

  return value.trim();
}

function formatFailures(
  heading: string,
  failures: readonly CurrentReleaseBoundaryValidationFailure[],
): string {
  return [
    heading,
    ...failures.map((failure) => `- ${failure.path}: ${failure.reason}`),
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
