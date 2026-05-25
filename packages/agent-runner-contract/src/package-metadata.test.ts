import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  RUNNER_CONTRACT_ARTIFACT,
  RUNNER_CONTRACT_VERSION,
} from './artifact.js';

const packageDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(packageDir, '..', 'package.json');
const repoRoot = join(packageDir, '..', '..', '..');
const packagesDir = join(repoRoot, 'packages');
const contractBuildScript = 'npm run build -w @mbos/agent-runner-contract';

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

function readNpmPackDryRunFiles(): string[] {
  const output = execFileSync('npm', [
    'pack',
    '--dry-run',
    '--json',
    '-w',
    '@mbos/agent-runner-contract',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(output) as unknown;
  if (!Array.isArray(parsed)) return [];
  const packResult = parsed[0] as { files?: Array<{ path?: unknown }> } | undefined;
  return (packResult?.files ?? [])
    .map((file) => file.path)
    .filter((file): file is string => typeof file === 'string')
    .sort((a, b) => a.localeCompare(b));
}

function readPackageJson(packageJsonFile: string): PackageJson {
  return JSON.parse(readFileSync(packageJsonFile, 'utf8')) as PackageJson;
}

function findDirectWorkspaceConsumers(): Array<{
  name: string;
  packageJson: PackageJson;
}> {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readPackageJson(join(packagesDir, entry.name, 'package.json')))
    .filter((packageJson): packageJson is PackageJson & { name: string } => {
      if (!packageJson.name || packageJson.name === '@mbos/agent-runner-contract') {
        return false;
      }
      const dependencyVersions = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.optionalDependencies,
        ...packageJson.peerDependencies,
      };
      return dependencyVersions['@mbos/agent-runner-contract'] !== undefined;
    })
    .map((packageJson) => ({
      name: packageJson.name,
      packageJson,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe('agent-runner-contract package metadata', () => {
  it('is configured as a packable dist artifact', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      private?: boolean;
      main?: string;
      types?: string;
      exports?: unknown;
      files?: string[];
      scripts?: Record<string, string>;
    };

    expect(packageJson.private).not.toBe(true);
    expect(packageJson.main).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.exports).toEqual({
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
    expect(packageJson.files).toEqual([
      'dist',
      'contract-artifact.json',
    ]);
    expect(packageJson.scripts?.clean).toBe('rm -rf dist');
    expect(packageJson.scripts?.build).toBe('npm run clean && tsc -p tsconfig.json');
    expect(packageJson.scripts?.prepack).toBe('npm run build');
  });

  it('keeps the local pack manifest aligned with artifact entrypoints', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: string;
      version?: string;
    };
    const manifest = JSON.parse(
      readFileSync(join(packageDir, '..', 'contract-artifact.json'), 'utf8'),
    ) as {
      name?: string;
      version?: string;
      artifact_kind?: string;
      formal_release_provenance?: boolean;
      entrypoints?: {
        version?: string;
        schema?: string;
        types?: string;
        fixtures?: string;
      };
    };

    expect(manifest.name).toBe(packageJson.name);
    expect(manifest.version).toBe(packageJson.version);
    expect(RUNNER_CONTRACT_VERSION).toBe(packageJson.version);
    expect(RUNNER_CONTRACT_ARTIFACT.version).toBe(packageJson.version);
    expect(manifest.artifact_kind).toBe('local_pack_manifest');
    expect(manifest.formal_release_provenance).toBe(false);
    expect(manifest.entrypoints).toEqual({
      version: './dist/artifact.js',
      schema: './dist/contract-schema.js',
      types: './dist/index.d.ts',
      fixtures: './dist/contract-schema.js',
    });
  });

  it('keeps stale dist files out of the dry-run pack artifact', () => {
    const staleDistFile = join(packageDir, '..', 'dist', 'stale.js');
    mkdirSync(dirname(staleDistFile), { recursive: true });
    writeFileSync(staleDistFile, 'export const stale = true;\n');

    try {
      expect(readNpmPackDryRunFiles()).not.toContain('dist/stale.js');
    } finally {
      rmSync(staleDistFile, { force: true });
    }
  });

  it('stays a standalone contract package without runtime implementation dependencies', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];

    expect(packageJson.name).toBe('@mbos/agent-runner-contract');
    expect(dependencyNames).not.toEqual(expect.arrayContaining([
      '@mbos/api-entry-node',
      '@mbos/agent-task-runner',
      '@mbos/agent-runner',
    ]));
  });

  it('keeps direct workspace consumers self-preparing clean contract dist before local checks', () => {
    const directConsumers = findDirectWorkspaceConsumers();

    expect(directConsumers.map((consumer) => consumer.name)).toEqual([
      '@mbos/agent-runner',
      '@mbos/agent-task-runner',
      '@mbos/api-entry-node',
    ]);

    for (const consumer of directConsumers) {
      if (consumer.packageJson.scripts?.typecheck) {
        expect(consumer.packageJson.scripts.pretypecheck).toBe(contractBuildScript);
      }
      if (consumer.packageJson.scripts?.build) {
        expect(consumer.packageJson.scripts.prebuild).toBe(contractBuildScript);
      }
      if (consumer.packageJson.scripts?.dev) {
        expect(consumer.packageJson.scripts.predev).toBe(contractBuildScript);
      }
      if (consumer.packageJson.scripts?.test) {
        expect(consumer.packageJson.scripts.pretest).toBe(contractBuildScript);
      }
    }
  });
});
