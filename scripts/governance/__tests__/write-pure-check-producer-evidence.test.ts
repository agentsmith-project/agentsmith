import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readPureCheckProducerEvidence } from '../pure-check-producer-evidence';
import { runWritePureCheckProducerEvidenceCli } from '../write-pure-check-producer-evidence';

const STARTED_AT = '2026-04-25T12:00:00.000Z';
const FINISHED_AT = '2026-04-25T12:00:02.000Z';

const tempRoots: string[] = [];

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agentsmith-pure-producer-cli-'));
  tempRoots.push(root);
  return root;
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function runCli(argv: readonly string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runWritePureCheckProducerEvidenceCli(argv, {
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
  });

  return {
    exitCode,
    stdout: stdout.join(''),
    stderr: stderr.join(''),
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('write pure check producer evidence CLI', () => {
  it('runs through the tsx CLI entrypoint without top-level await transform failures', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');

    const result = spawnSync('npx', [
      'tsx',
      'scripts/governance/write-pure-check-producer-evidence.ts',
      '--repo-root',
      root,
      '--report-root',
      reportRoot,
      '--check-id',
      'contracts',
      '--status',
      'passed',
      '--failure-class',
      'none',
      '--exit-code',
      '0',
      '--started-at',
      STARTED_AT,
      '--finished-at',
      FINISHED_AT,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Top-level await');
    expect(result.stdout).toContain(join(reportRoot, 'pure-check-producer', 'contracts', 'result.json'));

    const evidence = await readPureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'contracts',
    });
    expect(evidence.ok).toBe(true);
  });

  it('writes passed producer evidence from summary files', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');
    const stdoutSummaryFile = join(root, 'summaries', 'contracts.stdout.txt');
    const stderrSummaryFile = join(root, 'summaries', 'contracts.stderr.txt');
    await writeTextFile(stdoutSummaryFile, 'contracts ok\n');
    await writeTextFile(stderrSummaryFile, '');

    const result = await runCli([
      '--repo-root',
      root,
      '--report-root',
      reportRoot,
      '--check-id',
      'contracts',
      '--status',
      'passed',
      '--failure-class',
      'none',
      '--exit-code',
      '0',
      '--started-at',
      STARTED_AT,
      '--finished-at',
      FINISHED_AT,
      '--stdout-summary-file',
      stdoutSummaryFile,
      '--stderr-summary-file',
      stderrSummaryFile,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(join(reportRoot, 'pure-check-producer', 'contracts', 'result.json'));

    const evidence = await readPureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'contracts',
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      return;
    }
    expect(evidence.value).toMatchObject({
      check_id: 'contracts',
      result_status: 'passed',
      failure_class: 'none',
      exit_code: 0,
      started_at: STARTED_AT,
      finished_at: FINISHED_AT,
    });
    expect(evidence.value.stdout_summary_digest).toEqual({
      digest: sha256('contracts ok\n'),
      summary_length: 'contracts ok\n'.length,
      redacted: false,
    });
  });

  it('writes failed producer evidence and preserves the command exit code', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');

    const result = await runCli([
      `--repo-root=${root}`,
      `--report-root=${reportRoot}`,
      '--check-id=lint',
      '--status=failed',
      '--failure-class=product_regression',
      '--exit-code=2',
      `--started-at=${STARTED_AT}`,
      `--finished-at=${FINISHED_AT}`,
    ]);

    expect(result.exitCode).toBe(0);

    const evidence = await readPureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'lint',
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      return;
    }
    expect(evidence.value).toMatchObject({
      check_id: 'lint',
      result_status: 'failed',
      failure_class: 'product_regression',
      exit_code: 2,
    });
  });

  it('redacts secret-looking summaries before writing evidence', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');
    const stdoutSummaryFile = join(root, 'summaries', 'lint.stdout.txt');
    const stderrSummaryFile = join(root, 'summaries', 'lint.stderr.txt');
    await writeTextFile(stdoutSummaryFile, 'lint ok Bearer stdout-secret-token\n');
    await writeTextFile(stderrSummaryFile, 'client_secret=stderr-secret-token\n');

    const result = await runCli([
      '--repo-root',
      root,
      '--report-root',
      reportRoot,
      '--check-id',
      'lint',
      '--status',
      'passed',
      '--failure-class',
      'none',
      '--exit-code',
      '0',
      '--started-at',
      STARTED_AT,
      '--finished-at',
      FINISHED_AT,
      '--stdout-summary-file',
      stdoutSummaryFile,
      '--stderr-summary-file',
      stderrSummaryFile,
    ]);

    expect(result.exitCode).toBe(0);
    const rawEvidence = await readFile(join(reportRoot, 'pure-check-producer', 'lint', 'result.json'), 'utf8');
    expect(rawEvidence).not.toContain('stdout-secret-token');
    expect(rawEvidence).not.toContain('stderr-secret-token');

    const evidence = await readPureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'lint',
    });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      return;
    }
    expect(evidence.value.stdout_summary_digest.redacted).toBe(true);
    expect(evidence.value.stderr_summary_digest.redacted).toBe(true);
  });

  it('records required Next typegen artifacts for typecheck', async () => {
    const root = await makeTempRoot();
    const reportRoot = join(root, 'reports');
    await writeTextFile(join(root, '.next/types/routes.d.ts'), 'declare const routes: "/";\n');
    await writeTextFile(join(root, 'next-env.d.ts'), '/// <reference types="next" />\n');

    const result = await runCli([
      '--repo-root',
      root,
      '--report-root',
      reportRoot,
      '--check-id',
      'typecheck',
      '--status',
      'passed',
      '--failure-class',
      'none',
      '--exit-code',
      '0',
      '--started-at',
      STARTED_AT,
      '--finished-at',
      FINISHED_AT,
      '--required-artifact',
      'repo_root:.next/types/routes.d.ts:next-typegen-routes',
      '--required-artifact',
      'repo_root:next-env.d.ts:next-env',
    ]);

    expect(result.exitCode).toBe(0);

    const evidence = await readPureCheckProducerEvidence({
      repoRoot: root,
      reportRoot,
      checkId: 'typecheck',
    });

    expect(evidence.ok).toBe(true);
    if (!evidence.ok) {
      return;
    }
    expect(evidence.value.required_artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'next-typegen-routes',
        scope: 'repo_root',
        path: '.next/types/routes.d.ts',
        digest: sha256('declare const routes: "/";\n'),
      }),
      expect.objectContaining({
        id: 'next-env',
        scope: 'repo_root',
        path: 'next-env.d.ts',
        digest: sha256('/// <reference types="next" />\n'),
      }),
    ]));
  });
});
