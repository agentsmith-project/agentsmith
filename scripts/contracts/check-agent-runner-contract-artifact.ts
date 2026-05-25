import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const PACKAGE_DIR = path.join(REPO_ROOT, 'packages/agent-runner-contract');
const PACKAGE_JSON_PATH = path.join(PACKAGE_DIR, 'package.json');
const ARTIFACT_MANIFEST_PATH = path.join(PACKAGE_DIR, 'contract-artifact.json');
const PACKAGE_NAME = '@mbos/agent-runner-contract';
const EXPECTED_FILES = ['dist', 'contract-artifact.json'] as const;
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

function validatePackageMetadata(packageJson: JsonObject | null, errors: string[]): void {
  if (!packageJson) {
    errors.push('packages/agent-runner-contract/package.json must be a JSON object');
    return;
  }

  expectEqual(errors, 'package.name', packageJson.name, PACKAGE_NAME);
  if (packageJson.private === true) {
    errors.push('package.private must not be true for the publishable contract artifact');
  }
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

  for (const dependencySection of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const dependencies = readStringRecord(packageJson[dependencySection]);
    for (const [dependencyName, dependencySpec] of Object.entries(dependencies)) {
      if (/^(workspace:|file:|link:|\/|~\/|\.\.?\/)/.test(dependencySpec)) {
        errors.push(`${dependencySection}.${dependencyName} must not use a workspace/local path spec`);
      }
    }
  }

  const scripts = readStringRecord(packageJson.scripts);
  expectEqual(errors, 'scripts.clean', scripts.clean, 'rm -rf dist');
  expectEqual(errors, 'scripts.build', scripts.build, 'npm run clean && tsc -p tsconfig.json');
  expectEqual(errors, 'scripts.prepack', scripts.prepack, 'npm run build');
  for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
    if (scriptCommand.includes('/home/') || scriptCommand.includes('../') || scriptCommand.includes('agentsmith-runner')) {
      errors.push(`scripts.${scriptName} must not contain workspace, sibling, or machine-local paths`);
    }
  }
}

function validateArtifactManifest(
  packageJson: JsonObject | null,
  artifactManifest: JsonObject | null,
  errors: string[],
): void {
  if (!artifactManifest) {
    errors.push('contract-artifact.json must exist as local pack metadata');
    return;
  }

  expectEqual(errors, 'contract-artifact.name', artifactManifest.name, packageJson?.name);
  expectEqual(errors, 'contract-artifact.version', artifactManifest.version, packageJson?.version);
  expectEqual(errors, 'contract-artifact.artifact_kind', artifactManifest.artifact_kind, 'local_pack_manifest');
  expectEqual(
    errors,
    'contract-artifact.formal_release_provenance',
    artifactManifest.formal_release_provenance,
    false,
  );
  expectEqual(errors, 'contract-artifact.entrypoints', artifactManifest.entrypoints, {
    version: './dist/artifact.js',
    schema: './dist/contract-schema.js',
    types: './dist/index.d.ts',
    fixtures: './dist/contract-schema.js',
  });
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

function validatePackDryRun(errors: string[]): void {
  try {
    const packOutput = runNpm(['pack', '--dry-run', '--json', PACKAGE_DIR], REPO_ROOT);
    validatePackFileList(readPackFilePaths(parseNpmPackResult(packOutput)), errors);
  } catch (error) {
    errors.push(`npm pack --dry-run failed: ${error instanceof Error ? error.message : String(error)}`);
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
      "  RUNNER_CONTRACT_ARTIFACT,",
      "  RUNNER_CONTRACT_TERMINAL_FIXTURES,",
      "  RUNNER_CONTRACT_VERSION,",
      "  TASK_EXECUTION_CONTEXT_FIXTURES,",
      "  TASK_EXECUTION_CONTEXT_JSON_SCHEMA,",
      "  assertTaskExecutionContext,",
      "} from '@mbos/agent-runner-contract';",
      '',
      "if (RUNNER_CONTRACT_VERSION !== RUNNER_CONTRACT_ARTIFACT.version) throw new Error('version entrypoint mismatch');",
      "if (TASK_EXECUTION_CONTEXT_JSON_SCHEMA.type !== 'object') throw new Error('schema entrypoint missing');",
      "if (!TASK_EXECUTION_CONTEXT_FIXTURES.managedTaskRun) throw new Error('fixtures entrypoint missing');",
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
      '  RUNNER_CONTRACT_ARTIFACT,',
      '  RUNNER_CONTRACT_TERMINAL_FIXTURES,',
      '  RUNNER_CONTRACT_VERSION,',
      '  TASK_EXECUTION_CONTEXT_FIXTURES,',
      '  TASK_EXECUTION_CONTEXT_JSON_SCHEMA,',
      '  assertTaskExecutionContext,',
      '  type AgentRunnerSpec,',
      '  type TaskExecutionContext,',
      "} from '@mbos/agent-runner-contract';",
      '',
      'const version: string = RUNNER_CONTRACT_VERSION;',
      'const artifactVersion: string = RUNNER_CONTRACT_ARTIFACT.version;',
      'const schemaType: string | undefined = TASK_EXECUTION_CONTEXT_JSON_SCHEMA.type;',
      'const context: TaskExecutionContext = TASK_EXECUTION_CONTEXT_FIXTURES.managedTaskRun;',
      'const spec: AgentRunnerSpec = AGENT_TASK_RUNNER_SPEC;',
      "const terminalType: 'server.terminal.start' = RUNNER_CONTRACT_TERMINAL_FIXTURES.serverTerminalStart.type;",
      'assertTaskExecutionContext(context);',
      'void version;',
      'void artifactVersion;',
      'void schemaType;',
      'void spec;',
      'void terminalType;',
      '',
    ].join('\n'),
  );
}

function validateConsumerInstall(errors: string[]): void {
  const packDir = mkdtempSync(path.join(tmpdir(), 'agent-runner-contract-pack-'));
  const consumerDir = mkdtempSync(path.join(tmpdir(), 'agent-runner-contract-consumer-'));
  try {
    const packOutput = runNpm(['pack', '--json', PACKAGE_DIR, '--pack-destination', packDir], REPO_ROOT);
    const packResult = parseNpmPackResult(packOutput);
    if (typeof packResult.filename !== 'string') {
      errors.push('npm pack must report a tgz filename for consumer installation');
      return;
    }
    const tgzPath = path.join(packDir, packResult.filename);
    createConsumerFiles(consumerDir);
    runNpm(['install', '--no-audit', '--no-fund', tgzPath], consumerDir);
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
    rmSync(packDir, { recursive: true, force: true });
    rmSync(consumerDir, { recursive: true, force: true });
  }
}

export function checkAgentRunnerContractArtifact(): ArtifactCheckResult {
  const errors: string[] = [];
  const packageJson = readJsonObject(PACKAGE_JSON_PATH);
  const artifactManifest = readJsonObject(ARTIFACT_MANIFEST_PATH);

  validatePackageMetadata(packageJson, errors);
  validateArtifactManifest(packageJson, artifactManifest, errors);
  validateDistEntrypoints(errors);
  validatePackDryRun(errors);

  if (errors.length === 0) {
    validateConsumerInstall(errors);
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

function runCli(): void {
  const result = checkAgentRunnerContractArtifact();
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
