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
import '@mbos/api-entry-node/register';
import { createApi } from '@mbos/api-entry-node';
import type { Application } from '@mbos/application';
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
          message: expect.stringContaining('@mbos/application'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/package-specifiers.ts',
          message: expect.stringContaining('@mbos/agent-runner'),
        }),
      ]),
    );
  });

  it('rejects multi-line package-name imports, exports, requires, and dynamic imports', () => {
    const root = writeFixtureRoot({
      'release-kit/src/multiline-package-specifiers.ts': `
import {
  createApi,
} from '@mbos/api-entry-node';
export {
  createRunner,
} from '@mbos/agent-task-runner';
const runner = require(
  '@mbos/agent-runner',
);
const runnerWithOptions = require('@mbos/agent-runner', someOption);
const dynamicContracts = await import(
  '@mbos/contracts',
);
void createApi;
void runner;
void runnerWithOptions;
void dynamicContracts;
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
          path: 'release-kit/src/multiline-package-specifiers.ts',
          message: expect.stringContaining('@mbos/api-entry-node'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/multiline-package-specifiers.ts',
          message: expect.stringContaining('@mbos/agent-task-runner'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/multiline-package-specifiers.ts',
          message: expect.stringContaining('@mbos/agent-runner'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/multiline-package-specifiers.ts',
          message: expect.stringContaining('@mbos/contracts'),
        }),
      ]),
    );
  });

  it('rejects direct imports, requires, dynamic imports, and exports of the AgentSmith root package', () => {
    const root = writeFixtureRoot({
      'release-kit/src/root-package-specifiers.ts': `
import 'agentsmith/setup';
import app from 'agentsmith';
import type { AgentSmithApp } from 'agentsmith/types';
export * from 'agentsmith/shared';
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

  it('rejects package-root path specifiers while allowing ordinary repository-root strings elsewhere', () => {
    const root = writeFixtureRoot({
      'release-kit/src/root-path-specifiers.ts': `
const allowedSentinel = path.resolve(ROOT_DIR, '..', 'agentsmith');
const allowedString = '../agentsmith';
import localApp from '../agentsmith';
export * from '../agentsmith';
const requiredApp = require('../agentsmith');
const requiredAppWithOptions = require('../agentsmith', someOption);
const fileRequiredApp = require('file:../agentsmith');
const dynamicApp = await import('../agentsmith');
const dynamicTrailingApp = await import(
  '../agentsmith',
);
const absoluteApp = await import('/home/percy/works/mbos-v1/agentsmith');
void allowedSentinel;
void allowedString;
void localApp;
void requiredApp;
void requiredAppWithOptions;
void fileRequiredApp;
void dynamicApp;
void dynamicTrailingApp;
void absoluteApp;
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
          path: 'release-kit/src/root-path-specifiers.ts',
          message: expect.stringContaining('../agentsmith'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/root-path-specifiers.ts',
          message: expect.stringContaining('file:../agentsmith'),
        }),
        expect.objectContaining({
          path: 'release-kit/src/root-path-specifiers.ts',
          message: expect.stringContaining('absolute agentsmith repository root path'),
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
          'safe-file-link-name': 'file:../agentsmith',
          'safe-absolute-file-link-name': 'file:/home/percy/works/mbos-v1/agentsmith',
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
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('devDependencies.safe-file-link-name'),
        }),
        expect.objectContaining({
          path: 'release-kit/package.json',
          message: expect.stringContaining('devDependencies.safe-absolute-file-link-name'),
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

  it('allows ordinary product metadata and forbidden-source-root repository sentinels', () => {
    const root = writeFixtureRoot({
      'release-kit/src/source-root-sentinels.ts': `
const DEFAULT_FORBIDDEN_SOURCE_ROOTS = [path.resolve(ROOT_DIR, '..', 'agentsmith')];
const product = 'agentsmith';
const namespace = process.env.NAMESPACE ?? 'agentsmith';
if (namespace !== 'agentsmith') {
  throw new Error('unexpected namespace');
}
const relativeRepoRoot = '../agentsmith';
const fileRepoRoot = 'file:../agentsmith';
const joinedRepoRoot = path.join('..', 'agentsmith');
const resolvedRepoRoot = path.resolve('..', 'agentsmith');
void DEFAULT_FORBIDDEN_SOURCE_ROOTS;
void product;
void namespace;
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

    expect(result).toEqual({
      ok: true,
      failures: [],
    });
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

  it('rejects simple computed AgentSmith source paths during explicit CLI scans', () => {
    const root = writeWorkspaceRootWithCommittedFixture({});
    writeText(
      join(root, '..', 'agentsmith-release-kit'),
      'src/computed-boundary-break.ts',
      `
const repo = 'agent' + 'smith';
const joinedSource = path.join('..', repo, 'src', 'lib');
const sourceRoot = '..' + '/agentsmith' + '/src';
const aliasedSourceRoot = sourceRoot;
const aliasedJoinedSource = path.join(aliasedSourceRoot, 'lib');
void joinedSource;
void aliasedJoinedSource;
`,
    );

    const explicitResult = runBoundaryCli(root, ['--scan-root', '../agentsmith-release-kit']);

    expect(explicitResult.status).toBe(1);
    expect(explicitResult.stderr).toContain('../agentsmith-release-kit/src/computed-boundary-break.ts');
    expect(explicitResult.stderr).toContain('../agentsmith/src');
  });

  it('rejects computed sibling AgentSmith source roots during explicit CLI scans', () => {
    const root = writeWorkspaceRootWithCommittedFixture({});
    writeText(
      join(root, '..', 'agentsmith-release-kit'),
      'src/computed-sibling-boundary-break.ts',
      `
const RELEASE_KIT_ROOT = process.cwd();
const sourceRoot = path.join(path.dirname(RELEASE_KIT_ROOT), 'agent' + 'smith', 'src', 'lib');
void sourceRoot;
`,
    );

    const explicitResult = runBoundaryCli(root, ['--scan-root', '../agentsmith-release-kit']);

    expect(explicitResult.status).toBe(1);
    expect(explicitResult.stderr).toContain('../agentsmith-release-kit/src/computed-sibling-boundary-break.ts');
    expect(explicitResult.stderr).toContain('computed sibling agentsmith product source path');
  });

  it('rejects computed sibling AgentSmith source subpaths during explicit CLI scans', () => {
    const root = writeWorkspaceRootWithCommittedFixture({});
    writeText(
      join(root, '..', 'agentsmith-release-kit'),
      'src/computed-sibling-subpath-boundary-break.ts',
      `
const RELEASE_KIT_ROOT = process.cwd();
const sourceSubpath = path.join(path.dirname(RELEASE_KIT_ROOT), 'agent' + 'smith', 'src/lib');
const packageSubpath = path.join(path.dirname(RELEASE_KIT_ROOT), 'agent' + 'smith', 'packages/application');
const sourceRoot = path.resolve(REPO_ROOT, '..', 'agentsmith', 'src');
const productPackage = path.resolve(REPO_ROOT, '..', 'agentsmith', 'package.json');
void sourceSubpath;
void packageSubpath;
void sourceRoot;
void productPackage;
`,
    );

    const explicitResult = runBoundaryCli(root, ['--scan-root', '../agentsmith-release-kit']);

    expect(explicitResult.status).toBe(1);
    expect(explicitResult.stderr).toContain('../agentsmith-release-kit/src/computed-sibling-subpath-boundary-break.ts');
    expect(explicitResult.stderr).toContain('src/lib');
    expect(explicitResult.stderr).toContain('packages/application');
    expect(explicitResult.stderr).toContain('package.json');
    expect(explicitResult.stderr).toContain('computed sibling agentsmith product source path');
  });

  it('allows explicit sibling release-kit scans when they only contain boundary sentinels', () => {
    const root = writeWorkspaceRootWithCommittedFixture({});
    writeText(
      join(root, '..', 'agentsmith-release-kit'),
      'scripts/verify-render.mjs',
      `
const RELEASE_CONTRACT_SCHEMA = 'agentsmith.release-contract/v1';
const DEFAULT_FORBIDDEN_SOURCE_ROOTS = [path.resolve(REPO_ROOT, '..', 'agentsmith')];
const namespace = process.env.NAMESPACE ?? 'agentsmith';
if (namespace !== 'agentsmith') {
  throw new Error('unexpected namespace');
}
void RELEASE_CONTRACT_SCHEMA;
void DEFAULT_FORBIDDEN_SOURCE_ROOTS;
void namespace;
`,
    );
    writeText(
      join(root, '..', 'agentsmith-release-kit'),
      'scripts/test-render.sh',
      `
DEFAULT_SIBLING_AGENTSMITH="$ROOT_DIR/../agentsmith"
test_namespace="agentsmith"
`,
    );

    const explicitResult = runBoundaryCli(root, ['--scan-root', '../agentsmith-release-kit']);

    expect(explicitResult.status).toBe(0);
    expect(explicitResult.stdout).toContain('release kit source boundary check passed');
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
