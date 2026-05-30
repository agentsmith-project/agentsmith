import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalReleaseBoundaryJson,
  validateRunnerContractArtifactDescriptor,
  type CurrentRunnerContractArtifactDescriptor,
} from '../governance/current-release-boundary-schema';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const PACKAGE_DIR = path.join(REPO_ROOT, 'packages/agent-runner-contract');
const PACKAGE_JSON_PATH = path.join(PACKAGE_DIR, 'package.json');
const ARTIFACT_MANIFEST_PATH = path.join(PACKAGE_DIR, 'contract-artifact.json');
const PACKAGE_NAME = '@mbos/agent-runner-contract';
const FORMAL_DESCRIPTOR_NAME = 'runner-contract-artifact.json';
const PACKAGE_MANIFEST_SCHEMA_VERSION = 'agentsmith.runner-contract-package-manifest/v1';
const PACKAGE_MANIFEST_METADATA_KIND = 'runner_contract_package_manifest';
const EXPECTED_FILES = ['dist', 'contract-artifact.json'] as const;
const EXPECTED_ENTRYPOINTS = {
  version: './dist/artifact.js',
  schema: './dist/contract-schema.js',
  types: './dist/index.d.ts',
  fixtures: './dist/contract-schema.js',
} as const;
const EXPECTED_RELEASE_PROVENANCE = {
  kind: 'external_descriptor',
  descriptor_name: FORMAL_DESCRIPTOR_NAME,
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
const EXPECTED_PACK_FILE_PATHS = [
  'contract-artifact.json',
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
  'package.json',
] as const;
const FORMAL_TARBALL_FORBIDDEN_LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepack',
  'postpack',
] as const;
const FORMAL_TARBALL_DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundledDependencies',
  'bundleDependencies',
] as const;
const SOURCE_FORBIDDEN_INSTALL_LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
] as const;
const SOURCE_DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;
const LOCAL_DEPENDENCY_SPEC_PATTERN = /^(workspace:|file:|link:|\/|~\/|\.\.?\/)/u;
export const CONSUMER_INSTALL_NPM_FLAGS = [
  '--ignore-scripts',
  '--package-lock=false',
  '--no-audit',
  '--no-fund',
] as const;

type JsonObject = Record<string, unknown>;

type NpmPackFile = {
  path?: unknown;
};

type NpmPackResult = {
  filename?: unknown;
  files?: unknown;
};

type ArtifactCheckResult = {
  ok: boolean;
  errors: string[];
};

type ArtifactCheckOptions = {
  artifactRoot?: string;
  descriptorPath?: string;
};

type FormalArtifactConfig = {
  descriptorPath: string;
  artifactRoot: string;
};

export type FormalTarballEntry = {
  path: string;
  type: string;
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonObject(filePath: string): JsonObject | null {
  if (!existsSync(filePath)) return null;
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  return isJsonObject(parsed) ? parsed : null;
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isJsonObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function formatUnknown(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function expectEqual(errors: string[], label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label} must be ${formatUnknown(expected)}, got ${formatUnknown(actual)}`);
  }
}

function expectDescriptorEqual(
  errors: string[],
  label: string,
  actual: unknown,
  expectedLabel: string,
  expected: unknown,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label} must match ${expectedLabel} ${formatUnknown(expected)}, got ${formatUnknown(actual)}`);
  }
}

function validatePackageShape(
  packageJson: JsonObject | null,
  errors: string[],
  missingMessage: string,
): packageJson is JsonObject {
  if (!packageJson) {
    errors.push(missingMessage);
    return false;
  }

  expectEqual(errors, 'package.name', packageJson.name, PACKAGE_NAME);
  expectEqual(errors, 'package.type', packageJson.type, 'module');
  expectEqual(errors, 'package.main', packageJson.main, './dist/index.js');
  expectEqual(errors, 'package.types', packageJson.types, './dist/index.d.ts');
  expectEqual(errors, 'package.exports', packageJson.exports, {
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    },
    './artifact': {
      types: './dist/artifact.d.ts',
      import: './dist/artifact.js',
      default: './dist/artifact.js',
    },
    './contract-artifact.json': './contract-artifact.json',
    './package.json': './package.json',
  });
  expectEqual(errors, 'package.files', packageJson.files, [...EXPECTED_FILES]);

  return true;
}

export function validatePackageMetadata(packageJson: JsonObject | null, errors: string[]): void {
  if (!validatePackageShape(
    packageJson,
    errors,
    'packages/agent-runner-contract/package.json must be a JSON object',
  )) {
    return;
  }

  if (packageJson.private === true) {
    errors.push('package.private must not be true for the publishable contract artifact');
  }

  for (const dependencySection of SOURCE_DEPENDENCY_SECTIONS) {
    const dependencies = readStringRecord(packageJson[dependencySection]);
    for (const [dependencyName, dependencySpec] of Object.entries(dependencies)) {
      if (LOCAL_DEPENDENCY_SPEC_PATTERN.test(dependencySpec)) {
        errors.push(`${dependencySection}.${dependencyName} must not use a workspace/local path spec`);
      }
    }
  }

  const scriptMetadata = isJsonObject(packageJson.scripts) ? packageJson.scripts : {};
  const scripts = readStringRecord(packageJson.scripts);
  expectEqual(errors, 'scripts.clean', scripts.clean, 'rm -rf dist');
  expectEqual(errors, 'scripts.build', scripts.build, 'npm run clean && tsc -p tsconfig.json');
  expectEqual(errors, 'scripts.prepack', scripts.prepack, 'npm run build');
  for (const lifecycleScript of SOURCE_FORBIDDEN_INSTALL_LIFECYCLE_SCRIPTS) {
    if (Object.hasOwn(scriptMetadata, lifecycleScript)) {
      errors.push(`scripts.${lifecycleScript} must not be present on the source package`);
    }
  }
  for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
    if (scriptCommand.includes('/home/') || scriptCommand.includes('../') || scriptCommand.includes('agentsmith-runner')) {
      errors.push(`scripts.${scriptName} must not contain workspace, sibling, or machine-local paths`);
    }
  }
}

function validateFormalPackageMetadata(packageJson: JsonObject | null, errors: string[]): void {
  if (!validatePackageShape(packageJson, errors, 'formal tarball package.json must be a JSON object')) {
    return;
  }

  if (Object.hasOwn(packageJson, 'private')) {
    errors.push('formal tarball package private must not be present.');
  }

  validateFormalPackageScripts(packageJson, errors);
  validateFormalPackageDependencies(packageJson, errors);
}

function validateFormalPackageScripts(packageJson: JsonObject, errors: string[]): void {
  if (!Object.hasOwn(packageJson, 'scripts')) {
    return;
  }

  const scriptsValue = packageJson.scripts;
  if (!isJsonObject(scriptsValue)) {
    errors.push('formal tarball package scripts must not be present.');
    return;
  }

  const scriptNames = Object.keys(scriptsValue);
  for (const lifecycleScript of FORMAL_TARBALL_FORBIDDEN_LIFECYCLE_SCRIPTS) {
    if (Object.hasOwn(scriptsValue, lifecycleScript)) {
      errors.push(`formal tarball package scripts.${lifecycleScript} must not be present.`);
    }
  }

  const hasNonLifecycleScript = scriptNames.some(
    (scriptName) => !FORMAL_TARBALL_FORBIDDEN_LIFECYCLE_SCRIPTS.includes(
      scriptName as (typeof FORMAL_TARBALL_FORBIDDEN_LIFECYCLE_SCRIPTS)[number],
    ),
  );
  if (hasNonLifecycleScript || scriptNames.length === 0) {
    errors.push('formal tarball package scripts must not be present.');
  }
}

function validateFormalPackageDependencies(packageJson: JsonObject, errors: string[]): void {
  for (const dependencySection of FORMAL_TARBALL_DEPENDENCY_SECTIONS) {
    if (!Object.hasOwn(packageJson, dependencySection)) {
      continue;
    }

    const dependencyValue = packageJson[dependencySection];
    errors.push(`formal tarball package ${dependencySection} must not be present.`);

    const dependencies = readStringRecord(dependencyValue);
    for (const [dependencyName, dependencySpec] of Object.entries(dependencies)) {
      if (LOCAL_DEPENDENCY_SPEC_PATTERN.test(dependencySpec)) {
        errors.push(`formal tarball package ${dependencySection}.${dependencyName} must not use a workspace/local path spec.`);
      }
    }
  }
}

function validateArtifactManifest(
  packageJson: JsonObject | null,
  artifactManifest: JsonObject | null,
  errors: string[],
): void {
  if (!artifactManifest) {
    errors.push('contract-artifact.json must exist as package manifest metadata');
    return;
  }

  if (artifactManifest.artifact_kind === 'local_pack_manifest') {
    errors.push('contract-artifact.json must use package manifest v1, not legacy local_pack_manifest');
  }

  for (const fieldName of PACKAGE_MANIFEST_FORBIDDEN_ROOT_FIELDS) {
    if (Object.hasOwn(artifactManifest, fieldName)) {
      errors.push(`contract-artifact.${fieldName} must not be present in package manifest`);
    }
  }

  expectEqual(errors, 'contract-artifact.schema_version', artifactManifest.schema_version, PACKAGE_MANIFEST_SCHEMA_VERSION);
  expectEqual(errors, 'contract-artifact.metadata_kind', artifactManifest.metadata_kind, PACKAGE_MANIFEST_METADATA_KIND);

  if (!isJsonObject(artifactManifest.package)) {
    errors.push('contract-artifact.package must be an object.');
  } else {
    expectEqual(errors, 'contract-artifact.package.name', artifactManifest.package.name, packageJson?.name);
    expectEqual(errors, 'contract-artifact.package.version', artifactManifest.package.version, packageJson?.version);
  }

  expectEqual(errors, 'contract-artifact.entrypoints', artifactManifest.entrypoints, EXPECTED_ENTRYPOINTS);
  expectEqual(
    errors,
    'contract-artifact.release_provenance',
    artifactManifest.release_provenance,
    EXPECTED_RELEASE_PROVENANCE,
  );
}

function validateDistEntrypoints(errors: string[]): void {
  for (const relativePath of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/artifact.js',
    'dist/artifact.d.ts',
    'dist/contract-schema.js',
    'dist/contract-schema.d.ts',
  ]) {
    if (!existsSync(path.join(PACKAGE_DIR, relativePath))) {
      errors.push(`${relativePath} must exist before packing the contract artifact`);
    }
  }
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
  if (!Array.isArray(parsed) || !isJsonObject(parsed[0])) {
    throw new Error('npm pack --json did not return the expected result array');
  }
  return parsed[0] as NpmPackResult;
}

function readPackFilePaths(packResult: NpmPackResult): string[] {
  if (!Array.isArray(packResult.files)) return [];
  return packResult.files
    .filter((file): file is NpmPackFile => isJsonObject(file))
    .map((file) => file.path)
    .filter((filePath): filePath is string => typeof filePath === 'string')
    .sort((a, b) => a.localeCompare(b));
}

export function validatePackFileList(files: string[], errors: string[]): void {
  if (files.length === 0) {
    errors.push('npm pack --dry-run must report package files');
    return;
  }

  const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));
  const expectedPackFilePaths = new Set<string>(EXPECTED_PACK_FILE_PATHS);

  for (const filePath of sortedFiles) {
    if (filePath.startsWith('src/') || filePath.includes('.test.')) {
      errors.push(`pack tarball must not include source tests or source files: ${filePath}`);
    }
    if (filePath.includes('/home/') || filePath.includes('..') || filePath.includes('agentsmith-runner')) {
      errors.push(`pack tarball must not include workspace/local/sibling paths: ${filePath}`);
    }
    if (!expectedPackFilePaths.has(filePath)) {
      errors.push(`pack tarball contains unexpected artifact file: ${filePath}`);
    }
  }

  for (const expectedPath of EXPECTED_PACK_FILE_PATHS) {
    if (!sortedFiles.includes(expectedPath)) {
      errors.push(`pack tarball is missing expected artifact file: ${expectedPath}`);
    }
  }
}

export function validateFormalArtifactTextBoundary(label: string, text: string, errors: string[]): void {
  if (/@mbos\/agent-runner(?!-contract)(?:\b|["'/:])/u.test(text)
    || /packages\/agent-runner(?!-contract)(?:\b|\/)/u.test(text)) {
    errors.push(`${label} must not reference legacy @mbos/agent-runner package names`);
  }
  if (/\bbuildAgentRuntimeEnv\b/u.test(text)) {
    errors.push(`${label} must not reference buildAgentRuntimeEnv`);
  }
  if (
    /(?:^|["'\s])(?:\/home\/(?!task_[A-Za-z0-9_-]*(?:\/|["'\s]|$))|\/Users\/|~\/|\.\.\/)/u.test(text)
    || /\bagentsmith-runner\b/u.test(text)
    || /\b(?:workspace|file|link):/u.test(text)
  ) {
    errors.push(`${label} must not include workspace/local/sibling paths`);
  }
}

export function validateDescriptorArtifactBytes(
  descriptor: CurrentRunnerContractArtifactDescriptor,
  artifactBytes: Buffer,
  errors: string[],
): void {
  const actualSha256 = sha256BufferDigest(artifactBytes);
  if (actualSha256 !== descriptor.artifact.sha256) {
    errors.push(`runner contract artifact sha256 must match descriptor artifact.sha256 ${descriptor.artifact.sha256}`);
  }

  const actualIntegrity = npmSha512Integrity(artifactBytes);
  if (actualIntegrity !== descriptor.artifact.integrity) {
    errors.push(
      `runner contract artifact integrity must match descriptor artifact.integrity ${descriptor.artifact.integrity}`,
    );
  }
}

export function validateFormalTarballEntryList(
  entries: readonly FormalTarballEntry[],
  errors: string[],
): void {
  if (entries.length === 0) {
    errors.push('formal tarball must contain entries');
    return;
  }

  for (const entry of entries) {
    const entryPath = entry.path;
    const entryType = entry.type.trim().charAt(0);

    if (entryPath.trim().length === 0) {
      errors.push('formal tarball entry path must be non-empty');
      continue;
    }
    if (entryPath.startsWith('/') || entryPath.startsWith('\\')) {
      errors.push(`formal tarball entry must not be absolute: ${entryPath}`);
    }
    if (entryPath.includes('\\')) {
      errors.push(`formal tarball entry must not contain backslashes: ${entryPath}`);
    }
    if (entryPath !== 'package/' && !entryPath.startsWith('package/')) {
      errors.push(`formal tarball entry must stay under package/: ${entryPath}`);
    }
    if (entryPath.split('/').some((segment) => segment === '..')) {
      errors.push(`formal tarball entry must not contain traversal segments: ${entryPath}`);
    }
    if (entryType === 'l' || entryType === 'h') {
      errors.push(`formal tarball entry must not be a symlink or hardlink: ${entryPath}`);
    } else if (entryType !== '-' && entryType !== 'd') {
      errors.push(`formal tarball entry has unsupported type ${formatUnknown(entry.type)}: ${entryPath}`);
    }
  }
}

export function validateFormalTarballMetadata(
  descriptor: CurrentRunnerContractArtifactDescriptor,
  packageJson: JsonObject | null,
  artifactManifest: JsonObject | null,
  errors: string[],
): void {
  validateFormalPackageMetadata(packageJson, errors);
  validateArtifactManifest(packageJson, artifactManifest, errors);

  if (packageJson) {
    expectDescriptorEqual(
      errors,
      'tarball package.name',
      packageJson.name,
      'descriptor package.name',
      descriptor.package.name,
    );
    expectDescriptorEqual(
      errors,
      'tarball package.version',
      packageJson.version,
      'descriptor package.version',
      descriptor.package.version,
    );
  }

  if (!artifactManifest) {
    return;
  }

  const artifactManifestPackage = isJsonObject(artifactManifest.package) ? artifactManifest.package : null;
  if (artifactManifestPackage) {
    expectDescriptorEqual(
      errors,
      'tarball contract-artifact.package.name',
      artifactManifestPackage.name,
      'descriptor package.name',
      descriptor.package.name,
    );
    expectDescriptorEqual(
      errors,
      'tarball contract-artifact.package.version',
      artifactManifestPackage.version,
      'descriptor package.version',
      descriptor.package.version,
    );
  }
  if (canonicalReleaseBoundaryJson(artifactManifest.entrypoints)
    !== canonicalReleaseBoundaryJson(descriptor.entrypoints)) {
    errors.push('tarball contract-artifact.entrypoints must match descriptor entrypoints.');
  }
}

export function createSanitizedRunnerContractPackageJson(sourcePackageJson: JsonObject): JsonObject {
  return {
    name: sourcePackageJson.name,
    version: sourcePackageJson.version,
    type: sourcePackageJson.type,
    main: sourcePackageJson.main,
    types: sourcePackageJson.types,
    exports: cloneJsonField(sourcePackageJson, 'exports'),
    files: cloneJsonField(sourcePackageJson, 'files'),
  };
}

function cloneJsonField(packageJson: JsonObject, fieldName: string): unknown {
  const value = packageJson[fieldName];
  if (value === undefined) {
    throw new Error(`packages/agent-runner-contract/package.json ${fieldName} must be present.`);
  }
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function copyRequiredPackageFile(relativePath: string, stagingPackageDir: string): void {
  const sourcePath = path.join(PACKAGE_DIR, relativePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`${relativePath} must exist before packing the contract artifact`);
  }
  const outputPath = path.join(stagingPackageDir, relativePath);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  copyFileSync(sourcePath, outputPath);
}

function createSanitizedStagingPackage(packageJson: JsonObject): string {
  const stagingRoot = mkdtempSync(path.join(tmpdir(), 'agent-runner-contract-staging-'));
  const stagingPackageDir = path.join(stagingRoot, 'package');

  try {
    for (const relativePath of EXPECTED_PACK_FILE_PATHS) {
      if (relativePath === 'package.json') {
        continue;
      }
      copyRequiredPackageFile(relativePath, stagingPackageDir);
    }
    writeFileSync(
      path.join(stagingPackageDir, 'package.json'),
      `${JSON.stringify(createSanitizedRunnerContractPackageJson(packageJson), null, 2)}\n`,
    );
    return stagingRoot;
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function validateSanitizedPackDryRun(packageJson: JsonObject, errors: string[]): void {
  const stagingRoot = createSanitizedStagingPackage(packageJson);
  try {
    const stagingPackageDir = path.join(stagingRoot, 'package');
    const packOutput = runNpm(['pack', '--dry-run', '--json', '--ignore-scripts', stagingPackageDir], REPO_ROOT);
    validatePackFileList(readPackFilePaths(parseNpmPackResult(packOutput)), errors);
  } catch (error) {
    errors.push(`npm pack --dry-run failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function createConsumerFiles(consumerDir: string): void {
  writeFileSync(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify({
      private: true,
      type: 'module',
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(consumerDir, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        resolveJsonModule: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ['typecheck.ts'],
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(consumerDir, 'smoke.mjs'),
    [
      "import {",
      "  AGENT_TASK_RUNNER_SPEC,",
      "  PROJECTED_DEPENDENCIES_ENV_FIXTURE,",
      "  PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA,",
      "  PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA,",
      "  RUNNER_CONTRACT_ARTIFACT,",
      "  RUNNER_CONTRACT_TERMINAL_FIXTURES,",
      "  RUNNER_CONTRACT_VERSION,",
      "  TASK_EXECUTION_CONTEXT_FIXTURES,",
      "  TASK_EXECUTION_CONTEXT_JSON_SCHEMA,",
      "  assertTaskExecutionContext,",
      "} from '@mbos/agent-runner-contract';",
      "import { RUNNER_CONTRACT_ARTIFACT as SUBPATH_RUNNER_CONTRACT_ARTIFACT } from '@mbos/agent-runner-contract/artifact';",
      "import contractArtifactJson from '@mbos/agent-runner-contract/contract-artifact.json' with { type: 'json' };",
      '',
      "if (RUNNER_CONTRACT_VERSION !== RUNNER_CONTRACT_ARTIFACT.package.version) throw new Error('version entrypoint mismatch');",
      "if (SUBPATH_RUNNER_CONTRACT_ARTIFACT.package.version !== RUNNER_CONTRACT_ARTIFACT.package.version) throw new Error('artifact subpath mismatch');",
      "if (contractArtifactJson.package.version !== RUNNER_CONTRACT_ARTIFACT.package.version) throw new Error('contract-artifact.json subpath mismatch');",
      "if (TASK_EXECUTION_CONTEXT_JSON_SCHEMA.type !== 'object') throw new Error('schema entrypoint missing');",
      "if (PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA.oneOf.length !== 2) throw new Error('projected dependency payload schema missing');",
      "if (PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA.properties.dependencies.type !== 'object') throw new Error('projected dependencies env schema missing');",
      "if (!TASK_EXECUTION_CONTEXT_FIXTURES.managedTaskRun) throw new Error('fixtures entrypoint missing');",
      "if (PROJECTED_DEPENDENCIES_ENV_FIXTURE.dependencies['sample-runtime-dependency'].fields.access_token !== 'projected_access_token') throw new Error('projected dependencies env fixture missing');",
      "if (PROJECTED_DEPENDENCIES_ENV_FIXTURE.dependencies['sample-runtime-dependency'].fields.endpoint !== 'https://runtime-dependency.example.test') throw new Error('projected dependencies env endpoint fixture missing');",
      "if (PROJECTED_DEPENDENCIES_ENV_FIXTURE.dependencies['sample-secret'].fields.token !== 'projected_sample_token') throw new Error('projected dependencies env token fixture missing');",
      "if (RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalStart.type !== 'server.terminal.start') throw new Error('terminal fixture missing');",
      "if (AGENT_TASK_RUNNER_SPEC.protocol_version !== '1.0') throw new Error('runner spec missing');",
      'assertTaskExecutionContext(TASK_EXECUTION_CONTEXT_FIXTURES.managedTaskRun);',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(consumerDir, 'typecheck.ts'),
    [
      'import {',
      '  AGENT_TASK_RUNNER_SPEC,',
      '  PROJECTED_DEPENDENCIES_ENV_FIXTURE,',
      '  PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA,',
      '  PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA,',
      '  RUNNER_CONTRACT_ARTIFACT,',
      '  RUNNER_CONTRACT_TERMINAL_FIXTURES,',
      '  RUNNER_CONTRACT_VERSION,',
      '  TASK_EXECUTION_CONTEXT_FIXTURES,',
      '  TASK_EXECUTION_CONTEXT_JSON_SCHEMA,',
      '  assertTaskExecutionContext,',
      '  type AgentRunnerSpec,',
      '  type TaskExecutionContext,',
      "} from '@mbos/agent-runner-contract';",
      "import { RUNNER_CONTRACT_ARTIFACT as SUBPATH_RUNNER_CONTRACT_ARTIFACT } from '@mbos/agent-runner-contract/artifact';",
      "import contractArtifactJson from '@mbos/agent-runner-contract/contract-artifact.json' with { type: 'json' };",
      '',
      'const version: string = RUNNER_CONTRACT_VERSION;',
      'const artifactVersion: string = RUNNER_CONTRACT_ARTIFACT.package.version;',
      'const artifactSubpathVersion: string = SUBPATH_RUNNER_CONTRACT_ARTIFACT.package.version;',
      'const manifestSubpathVersion: string = contractArtifactJson.package.version;',
      'const schemaType: string | undefined = TASK_EXECUTION_CONTEXT_JSON_SCHEMA.type;',
      'const projectedDependencyPayloadVariants = PROJECTED_DEPENDENCY_PAYLOAD_JSON_SCHEMA.oneOf;',
      'const projectedDependenciesEnvSchemaType: string | undefined = PROJECTED_DEPENDENCIES_ENV_JSON_SCHEMA.type;',
      "const projectedDependencyAccessToken: string = PROJECTED_DEPENDENCIES_ENV_FIXTURE.dependencies['sample-runtime-dependency'].fields.access_token;",
      "const projectedDependencyEndpoint: string = PROJECTED_DEPENDENCIES_ENV_FIXTURE.dependencies['sample-runtime-dependency'].fields.endpoint;",
      "const projectedDependencyToken: string = PROJECTED_DEPENDENCIES_ENV_FIXTURE.dependencies['sample-secret'].fields.token;",
      'const context: TaskExecutionContext = TASK_EXECUTION_CONTEXT_FIXTURES.managedTaskRun;',
      'const spec: AgentRunnerSpec = AGENT_TASK_RUNNER_SPEC;',
      "const terminalType: 'server.terminal.start' = RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalStart.type;",
      'assertTaskExecutionContext(context);',
      'void version;',
      'void artifactVersion;',
      'void artifactSubpathVersion;',
      'void manifestSubpathVersion;',
      'void schemaType;',
      'void projectedDependencyPayloadVariants;',
      'void projectedDependenciesEnvSchemaType;',
      'void projectedDependencyAccessToken;',
      'void projectedDependencyEndpoint;',
      'void projectedDependencyToken;',
      'void spec;',
      'void terminalType;',
      '',
    ].join('\n'),
  );
}

function validateConsumerInstallFromTgz(tgzPath: string, errors: string[]): void {
  const consumerDir = mkdtempSync(path.join(tmpdir(), 'agent-runner-contract-consumer-'));
  try {
    createConsumerFiles(consumerDir);
    runNpm(createConsumerInstallNpmArgs(tgzPath), consumerDir);
    execFileSync(process.execPath, ['smoke.mjs'], {
      cwd: consumerDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync(process.execPath, [
      path.join(REPO_ROOT, 'node_modules/typescript/bin/tsc'),
      '-p',
      'tsconfig.json',
      '--noEmit',
    ], {
      cwd: consumerDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    errors.push(`temporary consumer install/import/typecheck failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(consumerDir, { recursive: true, force: true });
  }
}

export function createConsumerInstallNpmArgs(tgzPath: string): string[] {
  return ['install', ...CONSUMER_INSTALL_NPM_FLAGS, tgzPath];
}

function validateConsumerInstall(packageJson: JsonObject, errors: string[]): void {
  const packDir = mkdtempSync(path.join(tmpdir(), 'agent-runner-contract-pack-'));
  let stagingRoot: string | null = null;
  try {
    stagingRoot = createSanitizedStagingPackage(packageJson);
    const stagingPackageDir = path.join(stagingRoot, 'package');
    const packOutput = runNpm([
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      packDir,
      stagingPackageDir,
    ], REPO_ROOT);
    const packResult = parseNpmPackResult(packOutput);
    if (typeof packResult.filename !== 'string') {
      errors.push('npm pack must report a tgz filename for consumer installation');
      return;
    }
    const tgzPath = path.join(packDir, packResult.filename);
    const metadataErrorCount = errors.length;
    validateLocalSanitizedTarballContents(tgzPath, errors);
    if (errors.length === metadataErrorCount) {
      validateConsumerInstallFromTgz(tgzPath, errors);
    }
  } catch (error) {
    errors.push(`temporary consumer install/import/typecheck failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (stagingRoot) {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
    rmSync(packDir, { recursive: true, force: true });
  }
}

function validateLocalSanitizedTarballContents(tgzPath: string, errors: string[]): void {
  const extractDir = mkdtempSync(path.join(tmpdir(), 'agent-runner-contract-local-artifact-'));
  try {
    const entryErrorCount = errors.length;
    validateFormalTarballEntryList(readFormalTarballEntryList(tgzPath), errors);
    if (errors.length > entryErrorCount) {
      return;
    }

    execFileSync('tar', ['-xzf', tgzPath, '-C', extractDir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const packageRoot = path.join(extractDir, 'package');
    if (!existsSync(packageRoot)) {
      errors.push('local runner contract artifact tgz must contain npm package/ root');
      return;
    }

    const packageFiles = listFilesRecursive(packageRoot)
      .map((filePath) => path.relative(packageRoot, filePath).split(path.sep).join('/'))
      .sort((a, b) => a.localeCompare(b));
    validatePackFileList(packageFiles, errors);
    const tarballPackageJson = readJsonObject(path.join(packageRoot, 'package.json'));
    validateFormalPackageMetadata(tarballPackageJson, errors);
    validateArtifactManifest(
      tarballPackageJson,
      readJsonObject(path.join(packageRoot, 'contract-artifact.json')),
      errors,
    );

    for (const relativePath of packageFiles) {
      const absolutePath = path.join(packageRoot, relativePath);
      if (!isScannablePackageFile(relativePath)) {
        continue;
      }
      validateFormalArtifactTextBoundary(`local tarball:${relativePath}`, readFileSync(absolutePath, 'utf8'), errors);
    }
  } catch (error) {
    errors.push(`local runner contract artifact tgz inspection failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

function validateFormalArtifact(config: FormalArtifactConfig, errors: string[]): void {
  if (!existsSync(config.descriptorPath)) {
    errors.push(`runner contract artifact descriptor must exist: ${config.descriptorPath}`);
    return;
  }

  const descriptorText = readFileSync(config.descriptorPath, 'utf8');
  validateFormalArtifactTextBoundary(FORMAL_DESCRIPTOR_NAME, descriptorText, errors);

  let parsedDescriptor: unknown;
  try {
    parsedDescriptor = JSON.parse(descriptorText) as unknown;
  } catch (error) {
    errors.push(`runner contract artifact descriptor must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const validation = validateRunnerContractArtifactDescriptor(parsedDescriptor);
  if (!validation.ok) {
    for (const failure of validation.failures) {
      errors.push(`runner contract artifact descriptor ${failure.path}: ${failure.reason}`);
    }
    return;
  }

  const descriptor = validation.value;
  const artifactPath = path.resolve(config.artifactRoot, descriptor.artifact.filename);
  if (!artifactPath.startsWith(`${path.resolve(config.artifactRoot)}${path.sep}`)) {
    errors.push('runner contract artifact filename must resolve inside artifact root');
    return;
  }
  if (!existsSync(artifactPath)) {
    errors.push(`runner contract artifact tgz must exist: ${artifactPath}`);
    return;
  }

  const artifactBytes = readFileSync(artifactPath);
  validateDescriptorArtifactBytes(descriptor, artifactBytes, errors);
  validateFormalTarballContents(artifactPath, descriptor, errors);

  if (errors.length === 0) {
    validateConsumerInstallFromTgz(artifactPath, errors);
  }
}

function validateFormalTarballContents(
  tgzPath: string,
  descriptor: CurrentRunnerContractArtifactDescriptor,
  errors: string[],
): void {
  const extractDir = mkdtempSync(path.join(tmpdir(), 'agent-runner-contract-artifact-'));
  try {
    const entryErrorCount = errors.length;
    validateFormalTarballEntryList(readFormalTarballEntryList(tgzPath), errors);
    if (errors.length > entryErrorCount) {
      return;
    }

    execFileSync('tar', ['-xzf', tgzPath, '-C', extractDir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const packageRoot = path.join(extractDir, 'package');
    if (!existsSync(packageRoot)) {
      errors.push('runner contract artifact tgz must contain npm package/ root');
      return;
    }

    const packageFiles = listFilesRecursive(packageRoot)
      .map((filePath) => path.relative(packageRoot, filePath).split(path.sep).join('/'))
      .sort((a, b) => a.localeCompare(b));
    validatePackFileList(packageFiles, errors);
    validateFormalTarballMetadata(
      descriptor,
      readJsonObject(path.join(packageRoot, 'package.json')),
      readJsonObject(path.join(packageRoot, 'contract-artifact.json')),
      errors,
    );

    for (const relativePath of packageFiles) {
      const absolutePath = path.join(packageRoot, relativePath);
      if (!isScannablePackageFile(relativePath)) {
        continue;
      }
      validateFormalArtifactTextBoundary(`tarball:${relativePath}`, readFileSync(absolutePath, 'utf8'), errors);
    }
  } catch (error) {
    errors.push(`runner contract artifact tgz inspection failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

function readFormalTarballEntryList(tgzPath: string): FormalTarballEntry[] {
  const pathLines = execFileSync('tar', ['-tzf', tgzPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const verboseLines = execFileSync('tar', ['-tvzf', tgzPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\n')
    .filter((line) => line.trim().length > 0);

  return pathLines.map((entryPath, index) => ({
    path: entryPath,
    type: verboseLines[index]?.charAt(0) ?? '',
  }));
}

function listFilesRecursive(root: string): string[] {
  const entries = readdirSync(root).sort((a, b) => a.localeCompare(b));
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      files.push(...listFilesRecursive(absolutePath));
    } else if (stat.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function isScannablePackageFile(relativePath: string): boolean {
  return /\.(?:json|js|d\.ts)$/u.test(relativePath);
}

function sha256BufferDigest(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function npmSha512Integrity(bytes: Buffer): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function resolveFormalArtifactConfig(options: ArtifactCheckOptions): FormalArtifactConfig | null {
  if (!options.artifactRoot && !options.descriptorPath) {
    return null;
  }

  const artifactRoot = path.resolve(options.artifactRoot ?? path.dirname(options.descriptorPath ?? '.'));
  const descriptorPath = path.resolve(options.descriptorPath ?? path.join(artifactRoot, FORMAL_DESCRIPTOR_NAME));

  return {
    artifactRoot,
    descriptorPath,
  };
}

export function checkAgentRunnerContractArtifact(options: ArtifactCheckOptions = {}): ArtifactCheckResult {
  const errors: string[] = [];
  const formalArtifactConfig = resolveFormalArtifactConfig(options);
  if (formalArtifactConfig) {
    validateFormalArtifact(formalArtifactConfig, errors);
    return {
      ok: errors.length === 0,
      errors,
    };
  }

  const packageJson = readJsonObject(PACKAGE_JSON_PATH);
  const artifactManifest = readJsonObject(ARTIFACT_MANIFEST_PATH);

  validatePackageMetadata(packageJson, errors);
  validateArtifactManifest(packageJson, artifactManifest, errors);
  validateDistEntrypoints(errors);

  if (errors.length === 0 && packageJson) {
    validateSanitizedPackDryRun(packageJson, errors);
  }

  if (errors.length === 0 && packageJson) {
    validateConsumerInstall(packageJson, errors);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function formatArtifactCheckResult(result: ArtifactCheckResult): string {
  if (result.ok) {
    return '[contracts] Agent runner contract artifact check passed.';
  }
  return [
    '[contracts] Agent runner contract artifact check failed.',
    ...result.errors.map((error) => `- ${error}`),
  ].join('\n');
}

function parseCliArgs(argv: readonly string[]): ArtifactCheckOptions {
  let artifactRoot: string | undefined;
  let descriptorPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--artifact-root':
        artifactRoot = requireArgValue(argv, index);
        index += 1;
        break;
      case '--descriptor':
        descriptorPath = requireArgValue(argv, index);
        index += 1;
        break;
      default:
        throw new Error(`unsupported agent runner contract artifact check argument: ${arg}`);
    }
  }

  return { artifactRoot, descriptorPath };
}

function requireArgValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--') || value.trim().length === 0) {
    throw new Error(`missing value for ${argv[index]}.`);
  }
  return value;
}

function runCli(): void {
  let result: ArtifactCheckResult;
  try {
    result = checkAgentRunnerContractArtifact(parseCliArgs(process.argv.slice(2)));
  } catch (error) {
    result = {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  const output = formatArtifactCheckResult(result);
  if (!result.ok) {
    process.stderr.write(`${output}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${output}\n`);
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === currentModulePath) {
  runCli();
}
