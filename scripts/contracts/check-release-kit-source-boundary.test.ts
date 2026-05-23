import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { checkReleaseKitSourceBoundary } from './check-release-kit-source-boundary';

const CHECK_SCRIPT = 'tsx scripts/contracts/check-release-kit-source-boundary.ts';
const CHECK_NPM_SCRIPT = 'contracts:check-release-kit-source-boundary';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK_SCRIPT_PATH = join(REPO_ROOT, 'scripts/contracts/check-release-kit-source-boundary.ts');
const TSX_BIN = join(REPO_ROOT, 'node_modules/.bin/tsx');

const fixtureRoots: string[] = [];

function writeText(root: string, relativePath: string, content: string): void {
  mkdirSync(join(root, relativePath, '..'), { recursive: true });
  writeFileSync(join(root, relativePath), content, 'utf8');
}

function writePackageJson(root: string): void {
  writeText(root, 'package.json', JSON.stringify({
    scripts: {
      [CHECK_NPM_SCRIPT]: CHECK_SCRIPT,
      'contracts:check': `npm run ${CHECK_NPM_SCRIPT}`,
    },
  }, null, 2));
}

function writeFixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'release-kit-source-boundary-'));
  fixtureRoots.push(root);
  writePackageJson(root);

  for (const [relativePath, content] of Object.entries(files)) {
    writeText(root, relativePath, content);
  }

  return root;
}

function writeWorkspaceRootWithCommittedFixture(files: Record<string, string>): string {
  const parent = mkdtempSync(join(tmpdir(), 'release-kit-source-boundary-default-'));
  fixtureRoots.push(parent);

  const root = join(parent, 'agentsmith');
  writePackageJson(root);
  writeText(
    root,
    'scripts/contracts/fixtures/release-kit-source-boundary/valid-release-kit/src/allowed-inputs.ts',
    `
const releaseContract = readFileSync('inputs/release-contract.json', 'utf8');
const packageManifest = readFileSync('inputs/deploy-template-package/manifest.json', 'utf8');
const rendered = readFileSync('artifacts/rendered-manifests/agentsmith.yaml', 'utf8');
void releaseContract;
void packageManifest;
void rendered;
`,
  );

  for (const [relativePath, content] of Object.entries(files)) {
    writeText(root, relativePath, content);
  }

  return root;
}

function runBoundaryCli(
  root: string,
  args: readonly string[] = [],
  env: Record<string, string | undefined> = {},
): ReturnType<typeof spawnSync> {
  return spawnSync(TSX_BIN, [CHECK_SCRIPT_PATH, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('checkReleaseKitSourceBoundary', () => {
  it('rejects release kit imports and path reads of AgentSmith product source', () => {
    const root = writeFixtureRoot({
      'release-kit/src/boundary-breaks.ts': `
import { client } from '../agentsmith/src/lib/api/client';
import { api } from '../agentsmith/packages/api-entry-node/src/index';
import runner from '../../agentsmith/packages/agent-task-runner/src/index';
import { application } from '../agentsmith/packages/application/src/index';
import { route } from '@/lib/routes';

const sourceRoot = '../../agentsmith/src';
const apiSource = readFileSync('../agentsmith/packages/api-entry-node/src/index.ts', 'utf8');
const runnerSource = readFileSync('../agentsmith/packages/agent-task-runner/src/index.ts', 'utf8');
const appPackage = readFileSync('../agentsmith/packages/application/package.json', 'utf8');
const productPackage = readFileSync('../agentsmith/package.json', 'utf8');
void client;
void api;
void runner;
void application;
void route;
void sourceRoot;
void apiSource;
void runnerSource;
void appPackage;
void productPackage;
`,
    });

    const result = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['release-kit'],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'release-kit/src/boundary-breaks.ts',
          message: expect.stringContaining('../agentsmith/src'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/boundary-breaks.ts',
          message: expect.stringContaining('../agentsmith/packages/api-entry-node'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/boundary-breaks.ts',
          message: expect.stringContaining('../agentsmith/packages/agent-task-runner'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/boundary-breaks.ts',
          message: expect.stringContaining('../agentsmith/packages/application'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/boundary-breaks.ts',
          message: expect.stringContaining('../agentsmith/package.json'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/boundary-breaks.ts',
          message: expect.stringContaining('@/'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/boundary-breaks.ts',
          message: expect.stringContaining('../../agentsmith'),
        }),
      ]),
    );
  });

  it('rejects package-name imports, require calls, and dynamic imports of AgentSmith product packages', () => {
    const root = writeFixtureRoot({
      'release-kit/src/package-specifiers.ts': `
import { createApi } from '@mbos/api-entry-node';
const runner = require('@mbos/agent-task-runner');
const sharedRunner = await import('@mbos/agent-runner');
const runnerSubpath = await import('@mbos/agent-runner/protocol');
void createApi;
void runner;
void sharedRunner;
void runnerSubpath;
`,
    });

    const result = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['release-kit'],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'release-kit/src/package-specifiers.ts',
          message: expect.stringContaining('@mbos/api-entry-node'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/package-specifiers.ts',
          message: expect.stringContaining('@mbos/agent-task-runner'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/package-specifiers.ts',
          message: expect.stringContaining('@mbos/agent-runner'),
        }),
      ]),
    );
  });

  it('rejects direct imports, requires, dynamic imports, and exports of the AgentSmith root package', () => {
    const root = writeFixtureRoot({
      'release-kit/src/root-package-specifiers.ts': `
import app from 'agentsmith';
export { createApp } from 'agentsmith/server';
const requiredApp = require('agentsmith');
const dynamicApp = await import('agentsmith/entry');
void app;
void requiredApp;
void dynamicApp;
`,
    });

    const result = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['release-kit'],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'release-kit/src/root-package-specifiers.ts',
          message: expect.stringContaining('AgentSmith product package agentsmith'),
        }),
      ]),
    );
  });

  it('rejects package.json dependencies on AgentSmith product packages', () => {
    const root = writeFixtureRoot({
      'release-kit/package.json': JSON.stringify({
        dependencies: {
          '@mbos/api-entry-node': 'workspace:*',
          '@mbos/agent-runner': 'workspace:*',
        },
        devDependencies: {
          '@mbos/agent-task-runner': 'workspace:*',
          '@mbos/application': 'file:../agentsmith/packages/application',
        },
      }, null, 2),
    });

    const result = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['release-kit'],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('dependencies.@mbos/api-entry-node'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('dependencies.@mbos/agent-runner'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('devDependencies.@mbos/agent-task-runner'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('devDependencies.@mbos/application'),
        }),
      ]),
    );
  });

  it('rejects npm alias dependencies targeting AgentSmith product packages', () => {
    const root = writeFixtureRoot({
      'release-kit/package.json': JSON.stringify({
        dependencies: {
          'safe-api-name': 'npm:@mbos/api-entry-node@0.1.0',
          'safe-root-name': 'npm:agentsmith@0.1.0',
        },
        devDependencies: {
          'safe-contract-name': 'npm:@mbos/contracts@0.1.0',
        },
      }, null, 2),
    });

    const result = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['release-kit'],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('dependencies.safe-api-name'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('@mbos/api-entry-node'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('dependencies.safe-root-name'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('agentsmith'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('devDependencies.safe-contract-name'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('@mbos/contracts'),
        }),
      ]),
    );
  });

  it('rejects former contract package exceptions as AgentSmith product packages', () => {
    const root = writeFixtureRoot({
      'release-kit/package.json': JSON.stringify({
        dependencies: {
          '@mbos/contracts': '1.0.0',
          '@mbos/agent-runner-contract': '1.0.0',
        },
      }, null, 2),
      'release-kit/src/contract-package-breaks.ts': `
import contracts from '@mbos/contracts';
const runnerContract = require('@mbos/agent-runner-contract');
void contracts;
void runnerContract;
`,
    });

    const result = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['release-kit'],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('dependencies.@mbos/contracts'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('dependencies.@mbos/agent-runner-contract'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/contract-package-breaks.ts',
          message: expect.stringContaining('@mbos/contracts'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/contract-package-breaks.ts',
          message: expect.stringContaining('@mbos/agent-runner-contract'),
        }),
      ]),
    );
  });

  it('rejects package.json dependencies on the AgentSmith root package across dependency sections', () => {
    const root = writeFixtureRoot({
      'release-kit/package.json': JSON.stringify({
        dependencies: {
          agentsmith: 'workspace:*',
        },
        devDependencies: {
          agentsmith: 'file:../agentsmith',
        },
        peerDependencies: {
          agentsmith: '^1.0.0',
        },
        optionalDependencies: {
          agentsmith: 'workspace:*',
        },
      }, null, 2),
    });

    const result = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['release-kit'],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('dependencies.agentsmith'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('devDependencies.agentsmith'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('peerDependencies.agentsmith'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('optionalDependencies.agentsmith'),
        }),
      ]),
    );
  });

  it('rejects AgentSmith repository root references through relative, file, and joined paths', () => {
    const root = writeFixtureRoot({
      'release-kit/src/root-path-breaks.ts': `
const relativeRepoRoot = '../agentsmith';
const fileRepoRoot = 'file:../agentsmith';
const joinedRepoRoot = path.join('..', 'agentsmith');
const resolvedRepoRoot = path.resolve('..', 'agentsmith');
void relativeRepoRoot;
void fileRepoRoot;
void joinedRepoRoot;
void resolvedRepoRoot;
`,
    });

    const result = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['release-kit'],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'release-kit/src/root-path-breaks.ts',
          message: expect.stringContaining('../agentsmith'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/root-path-breaks.ts',
          message: expect.stringContaining('file:../agentsmith'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/root-path-breaks.ts',
          message: expect.stringContaining('path.join agentsmith product source path'),
        }),
      ]),
    );
  });

  it('rejects absolute, file URI, path.join, and complete @/ alias source references', () => {
    const root = writeFixtureRoot({
      'release-kit/src/path-breaks.ts': `
import { Button } from '@/components/ui/button';
import messages from '@/messages/en-US.json';
const absoluteSource = '/home/percy/works/mbos-v1/agentsmith/packages/application/src/index.ts';
const fileUriSource = 'file:///home/percy/works/mbos-v1/agentsmith/src/lib/api/client.ts';
const joinedSource = path.join('..', 'agentsmith', 'src', 'lib', 'api');
const joinedPackage = path.join('..', 'agentsmith', 'packages', 'application');
void Button;
void messages;
void absoluteSource;
void fileUriSource;
void joinedSource;
void joinedPackage;
`,
    });

    const result = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['release-kit'],
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'release-kit/src/path-breaks.ts',
          message: expect.stringContaining('@/'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/path-breaks.ts',
          message: expect.stringContaining('absolute agentsmith product source path'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/path-breaks.ts',
          message: expect.stringContaining('file URI agentsmith product source path'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/path-breaks.ts',
          message: expect.stringContaining('path.join agentsmith product source path'),
        }),
      ]),
    );
  });

  it('uses the committed fixture as the default scan root and only scans external release-kit roots explicitly', () => {
    const root = writeWorkspaceRootWithCommittedFixture({});
    writeText(
      join(root, '..', 'agentsmith-release-kit'),
      'src/sibling-boundary-break.ts',
      "const source = '../agentsmith/src/lib/api/client';\nvoid source;\n",
    );

    expect(checkReleaseKitSourceBoundary({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });

    const explicitResult = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['../agentsmith-release-kit'],
    });
    expect(explicitResult.ok).toBe(false);
    expect(explicitResult.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '../agentsmith-release-kit/src/sibling-boundary-break.ts',
          message: expect.stringContaining('../agentsmith/src'),
        }),
      ]),
    );

    const previousEnv = process.env.RELEASE_KIT_SOURCE_ROOT;
    process.env.RELEASE_KIT_SOURCE_ROOT = '../agentsmith-release-kit';
    try {
      const envResult = checkReleaseKitSourceBoundary({ rootDir: root });
      expect(envResult).toEqual({
        ok: true,
        failures: [],
      });
    } finally {
      if (previousEnv === undefined) {
        delete process.env.RELEASE_KIT_SOURCE_ROOT;
      } else {
        process.env.RELEASE_KIT_SOURCE_ROOT = previousEnv;
      }
    }
  });

  it('uses --scan-root for explicit CLI scans while the default CLI stays hermetic', () => {
    const root = writeWorkspaceRootWithCommittedFixture({});
    writeText(
      join(root, '..', 'agentsmith-release-kit'),
      'src/sibling-boundary-break.ts',
      "const source = '../agentsmith/src/lib/api/client';\nvoid source;\n",
    );

    const defaultResult = runBoundaryCli(root);
    expect(defaultResult.status).toBe(0);
    expect(defaultResult.stdout).toContain('release kit source boundary check passed');

    const envResult = runBoundaryCli(root, [], {
      RELEASE_KIT_SOURCE_ROOT: '../agentsmith-release-kit',
      RELEASE_KIT_SCAN_ROOT: '../agentsmith-release-kit',
    });
    expect(envResult.status).toBe(0);
    expect(envResult.stdout).toContain('release kit source boundary check passed');

    const explicitResult = runBoundaryCli(root, ['--scan-root', '../agentsmith-release-kit']);
    expect(explicitResult.status).toBe(1);
    expect(explicitResult.stderr).toContain('../agentsmith-release-kit/src/sibling-boundary-break.ts');
    expect(explicitResult.stderr).toContain('../agentsmith/src');
  });

  it('allows ordinary JSON metadata to mention the product name without treating it as a package import', () => {
    const root = writeFixtureRoot({
      'release-kit/metadata.json': JSON.stringify({
        product: 'agentsmith',
        owner: 'release-kit',
      }, null, 2),
    });

    const result = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['release-kit'],
    });

    expect(result).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('allows release contract artifacts, deploy template package manifests, and generated artifact paths', () => {
    const root = writeFixtureRoot({
      'release-kit/src/allowed-inputs.ts': `
const releaseContract = readFileSync('inputs/release-contract.json', 'utf8');
const packageManifest = readFileSync('inputs/deploy-template-package/manifest.json', 'utf8');
const rendered = readFileSync('artifacts/rendered-manifests/agentsmith.yaml', 'utf8');
const renderedDirectory = readFileSync('artifacts/rendered-manifests/agentsmith/index.yaml', 'utf8');
const evidence = readFileSync('artifacts/evidence/rollout-report.json', 'utf8');
void releaseContract;
void packageManifest;
void rendered;
void renderedDirectory;
void evidence;
`,
    });

    const result = checkReleaseKitSourceBoundary({
      rootDir: root,
      scanRoots: ['release-kit'],
    });

    expect(result).toEqual({
      ok: true,
      failures: [],
    });
  });
});
