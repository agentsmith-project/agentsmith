import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildVerificationPlan,
  renderVerificationPlan,
} from '../run-verify';

function readPackageScripts(): Record<string, string> {
  return (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
}

function writeFakeNpm(dir: string, logPath: string): void {
  const path = join(dir, 'npm');
  writeFileSync(path, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"
exit 42
`);
  chmodSync(path, 0o755);
}

describe('verify human entrypoints', () => {
  it('keeps npm run verify as a dry-run planner by default', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-dry-run-'));
    try {
      const plan = buildVerificationPlan({ goal: 'pr', run: false });
      const output = renderVerificationPlan(plan);

      expect(plan.mode).toBe('dry-run');
      expect(plan.risk).toBe('fail-closed');
      expect(plan.recommendedCommands).toEqual([
        'npm run verify:quick',
        'npm run verify:default',
        'npm run verify:real',
      ]);
      expect(output).toContain('AgentSmith Verification');
      expect(output).toContain('Mode: dry-run');
      expect(output).toContain('Final verdict: not evaluated');
      expect(existsSync(join(root, 'artifacts', 'gate-results'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes friendly verification aliases without replacing existing expert commands', () => {
    const scripts = readPackageScripts();

    expect(scripts.verify).toContain('scripts/governance/run-verify.ts');
    expect(scripts['verify:quick']).toBe('npm run gate:fast');
    expect(scripts['verify:default']).toBe('npm run gate:default');
    expect(scripts['verify:visual']).toBe('npm run lane:visual');
    expect(scripts['verify:real']).toBe('npm run lane:backend-real:core');
    expect(scripts['verify:release-real']).toBe('npm run gate:release');

    expect(scripts['gate:fast']).toBeTruthy();
    expect(scripts['gate:default']).toBeTruthy();
    expect(scripts['lane:visual']).toBeTruthy();
    expect(scripts['lane:backend-real:core']).toBeTruthy();
    expect(scripts['gate:release']).toBeTruthy();
  });

  it('prints the dry-run plan from the CLI without executing gates', () => {
    const result = spawnSync('npx', ['tsx', 'scripts/governance/run-verify.ts', '--goal=visual'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('AgentSmith Verification');
    expect(result.stdout).toContain('Goal: visual');
    expect(result.stdout).toContain('Mode: dry-run');
    expect(result.stdout).toContain('npm run verify:visual');
    expect(result.stdout).toContain('this is not release readiness');
  });

  it('does not execute npm gate aliases on default dry-run even when fake npm is first on PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(root, logPath);

      const result = spawnSync('npx', ['tsx', 'scripts/governance/run-verify.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Mode: dry-run');
      expect(result.stdout).toContain('npm run verify:quick');
      expect(existsSync(logPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
