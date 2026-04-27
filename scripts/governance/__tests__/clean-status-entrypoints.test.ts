import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';
import { validateCurrentStatusProjection } from '../current-status-projection-schema';
import { runLocalRealStatusProjection } from '../local-real-status';
import { runRehearsalEntrypoint } from '../rehearsal-entrypoint';

const GENERATED_AT = '2026-04-27T12:00:00.000Z';
const RELEASE_STATUS_SECRET_ARG = '--api_key=entrypoint-release-api-key-raw-value';
const LOCAL_REAL_STATUS_SECRET_ARG = '--ticket=entrypoint-local-ticket-raw-value';
const REHEARSAL_STATUS_SECRET_ARG = 'Authorization: Bearer entrypoint-rehearsal-bearer-raw-token';

function expectNoEntrypointSecretLeak(output: string, rawArg: string, rawSecret: string): void {
  expect(output).not.toContain(rawArg);
  expect(output).not.toContain(rawSecret);
  expect(output).not.toContain('Authorization: Bearer entrypoint-rehearsal-bearer-raw-token');
}

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeReleaseAggregateResult(campaignRoot: string): void {
  writeJson(join(campaignRoot, 'gate-release-full', 'result.json'), {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: 'gate-release-full',
    gate_adapter: {
      npm_script: 'gate:release:full',
      ci_job: null,
    },
    status: 'passed',
    failure_class: 'none',
    stage: 'aggregate',
    line_kind: 'release_full_verdict',
    evidence_dir: join(campaignRoot, 'gate-release-full'),
    summary: 'Release-full campaign evidence passed aggregate verification.',
    generated_at: GENERATED_AT,
  });
}

function readPackageScripts(): Record<string, string> {
  return (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
}

describe('clean status entrypoints', () => {
  it('renders release:status default human output as a read-only status projection first screen', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-projection-'));
    try {
      writeReleaseAggregateResult(campaignRoot);

      const output = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(output).toContain('AgentSmith Status Projection');
      expect(output).toContain('Projection kind: read-only');
      expect(output).toContain('Goal: release-ready');
      expect(output).toContain('Presentation status: passed');
      expect(output).toContain('Release decision produced: false');
      expect(output).toContain('Commands executed: false');
      expect(output).not.toContain('Automated release verdict');
      expect(output).not.toContain('release_verdict');
      expect(output).not.toContain('automated_release_verdict');
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
    }
  });

  it('keeps release:status --json as the unified read-only projection', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-json-'));
    try {
      writeReleaseAggregateResult(campaignRoot);

      const output = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--json',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      const projection = JSON.parse(output) as unknown;

      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expect(projection).toMatchObject({
        schema: 'agentsmith_status_projection/v1',
        goal: 'release-ready',
        projection_kind: 'read_only',
        release_decision_produced: false,
        commands_executed: false,
      });
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
    }
  });

  it('does not echo secret-like unknown args from release status errors', () => {
    const result = spawnSync('npx', [
      'tsx',
      'scripts/governance/release-status.ts',
      RELEASE_STATUS_SECRET_ARG,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[release-status]');
    expectNoEntrypointSecretLeak(
      combinedOutput,
      RELEASE_STATUS_SECRET_ARG,
      'entrypoint-release-api-key-raw-value',
    );
  });

  it.each([
    ['demo-rehearsal', 'demo-rehearsal', 'npm run lane:demo-rehearsal'],
    ['cluster-rehearsal', 'cluster-rehearsal', 'npm run lane:cluster-rehearsal'],
  ])('renders %s --status --json as read-only projection without delegating the lane', (line, runtimeLine, laneCommand) => {
    const stdout: string[] = [];
    const delegated: string[][] = [];

    const exitCode = runRehearsalEntrypoint([line, '--status', '--json'], {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: () => undefined },
      delegate: (command, args) => {
        delegated.push([command, ...args]);
        return { status: 0 };
      },
      generatedAt: GENERATED_AT,
    });

    expect(exitCode).toBe(0);
    expect(delegated).toEqual([]);
    expect(stdout.join('')).not.toContain(laneCommand);

    const projection = JSON.parse(stdout.join('')) as unknown;
    expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
    expect(projection).toMatchObject({
      schema: 'agentsmith_status_projection/v1',
      goal: line,
      runtime_line: runtimeLine,
      projection_kind: 'read_only',
      commands_executed: false,
      leases_acquired: false,
      leases_released: false,
    });
  });

  it.each([
    ['demo-rehearsal', 'lane:demo-rehearsal'],
    ['cluster-rehearsal', 'lane:cluster-rehearsal'],
  ])('delegates %s default execution to the existing lane adapter', (line, laneScript) => {
    const delegated: string[][] = [];

    const exitCode = runRehearsalEntrypoint([line], {
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      delegate: (command, args) => {
        delegated.push([command, ...args]);
        return { status: 0 };
      },
      generatedAt: GENERATED_AT,
    });

    expect(exitCode).toBe(0);
    expect(delegated).toEqual([['npm', 'run', laneScript]]);
  });

  it('points public rehearse scripts at the mode-aware governance adapter', () => {
    const scripts = readPackageScripts();

    expect(scripts['rehearse:demo']).toBe('tsx scripts/governance/rehearsal-entrypoint.ts demo-rehearsal');
    expect(scripts['rehearse:cluster']).toBe('tsx scripts/governance/rehearsal-entrypoint.ts cluster-rehearsal');
  });

  it('renders local-real status projection with the registered local-manual runtime line', () => {
    const stdout: string[] = [];
    const exitCode = runLocalRealStatusProjection(['--json'], {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: () => undefined },
      generatedAt: GENERATED_AT,
    });

    expect(exitCode).toBe(0);
    const projection = JSON.parse(stdout.join('')) as unknown;
    expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
    expect(projection).toMatchObject({
      goal: 'local-real',
      runtime_line: 'local-manual',
      projection_kind: 'read_only',
      commands_executed: false,
      leases_acquired: false,
      leases_released: false,
    });
  });

  it('does not echo secret-like unknown args from local-real status errors', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runLocalRealStatusProjection([LOCAL_REAL_STATUS_SECRET_ARG], {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      generatedAt: GENERATED_AT,
    });

    const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;

    expect(exitCode).toBe(1);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('[local-real-status]');
    expectNoEntrypointSecretLeak(
      combinedOutput,
      LOCAL_REAL_STATUS_SECRET_ARG,
      'entrypoint-local-ticket-raw-value',
    );
  });

  it('does not echo secret-like unknown args from rehearsal entrypoint errors', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const delegated: string[][] = [];

    const exitCode = runRehearsalEntrypoint(['demo-rehearsal', REHEARSAL_STATUS_SECRET_ARG], {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      delegate: (command, args) => {
        delegated.push([command, ...args]);
        return { status: 0 };
      },
      generatedAt: GENERATED_AT,
    });

    const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;

    expect(exitCode).toBe(1);
    expect(delegated).toEqual([]);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('[rehearsal-entrypoint]');
    expectNoEntrypointSecretLeak(
      combinedOutput,
      REHEARSAL_STATUS_SECRET_ARG,
      'entrypoint-rehearsal-bearer-raw-token',
    );
  });

  it('runs local-real projection before existing substrate and local-manual diagnostics', () => {
    const makefile = readFileSync('Makefile', 'utf8');

    expect(makefile).toMatch(
      /local-real-status:[\s\S]*tsx scripts\/governance\/local-real-status\.ts[\s\S]*\$\(MAKE\) substrate-status[\s\S]*\$\(MAKE\) local-manual-status/,
    );
    expect(makefile).not.toContain('artifacts/runtime/lines/local-real');
  });
});
