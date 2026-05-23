import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';

import { checkReleaseBoundaryContract } from './check-release-boundary-contract';

const fixtureRoots: string[] = [];
const RELEASE_BOUNDARY_FIXTURE_ROOT = path.join(
  process.cwd(),
  'scripts',
  'governance',
  '__fixtures__',
  'release-boundary',
);
const CHECK_SCRIPT = 'tsx scripts/contracts/check-release-boundary-contract.ts';
const CHECK_NPM_SCRIPT = 'contracts:check-release-boundary';

function writePackageJson(root: string): void {
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      [CHECK_NPM_SCRIPT]: CHECK_SCRIPT,
      'contracts:check': `npm run ${CHECK_NPM_SCRIPT}`,
    },
  }, null, 2), 'utf8');
}

function writeFixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'release-boundary-contract-'));
  fixtureRoots.push(root);

  const targetFixtureRoot = path.join(root, 'scripts', 'governance', '__fixtures__', 'release-boundary');
  mkdirSync(path.dirname(targetFixtureRoot), { recursive: true });
  cpSync(RELEASE_BOUNDARY_FIXTURE_ROOT, targetFixtureRoot, { recursive: true });
  writePackageJson(root);

  return root;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('check-release-boundary-contract', () => {
  it('validates the current P0 release boundary machine truth', () => {
    const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

    expect(() =>
      execFileSync(tsxCli, ['scripts/contracts/check-release-boundary-contract.ts'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('reports malformed JSON fixtures as structured contract failures', () => {
    const root = writeFixtureRoot();
    writeFileSync(
      path.join(root, 'scripts', 'governance', '__fixtures__', 'release-boundary', 'release-kit-evidence.valid.json'),
      '{ "schema_version": "agentsmith.release-kit-evidence/v1",',
      'utf8',
    );

    const result = checkReleaseBoundaryContract({ rootDir: root });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'scripts/governance/__fixtures__/release-boundary/release-kit-evidence.valid.json',
          message: expect.stringContaining('Invalid JSON fixture'),
        }),
      ]),
    );
  });
});
