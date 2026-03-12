import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createGovernanceRunner } from './governance-runner.js';

describe('createGovernanceRunner', () => {
  it('triggers a full run and records completion', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'governance-runner-'));
    let executeCalls = 0;
    const runner = createGovernanceRunner({
      governanceRunsDir: runsDir,
      executeGovernanceReport: async () => {
        executeCalls += 1;
      },
    });

    await runner.triggerRun({
      mode: 'full',
      actorUserId: 'user_1',
      actorName: 'User One',
      notes: 'manual validation',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executeCalls).toBe(1);
    expect(runner.getStatus().running).toBe(false);
    expect(runner.getStatus().recent_operations[0]?.status).toBe('completed');
  });

  it('reruns only failed checks from a prior run', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'governance-runner-'));
    writeFileSync(join(runsDir, 'sample-run.json'), JSON.stringify({
      id: 'sample-run',
      report_name: 'sample-run',
      artifact_name: 'sample-run',
      trigger: 'manual',
      started_at: '2026-03-01T00:00:00.000Z',
      completed_at: '2026-03-01T00:01:00.000Z',
      duration_ms: 60000,
      status: 'fail',
      total_checks: 6,
      passed_checks: 5,
      failed_checks: 1,
      failed_step_names: ['Governance smoke'],
      failed_check_ids: ['smoke-governance'],
      failure_categories: ['authorization'],
    }), 'utf-8');

    let capturedArgs: string[] = [];
    const runner = createGovernanceRunner({
      governanceRunsDir: runsDir,
      executeGovernanceReport: async (args) => {
        capturedArgs = args;
      },
    });

    await runner.triggerRun({
      mode: 'failed_only',
      sourceRunId: 'sample-run',
      actorUserId: 'user_1',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capturedArgs).toContain('--checks');
    expect(capturedArgs).toContain('smoke-governance');
    expect(capturedArgs).toContain('--rerun-of-run-id');
    expect(capturedArgs).toContain('sample-run');
  });

  it('rejects concurrent runs with an explicit busy error', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'governance-runner-'));
    let unblockFirst: (() => void) | undefined;
    const runner = createGovernanceRunner({
      governanceRunsDir: runsDir,
      executeGovernanceReport: () =>
        new Promise<void>((resolve) => {
          unblockFirst = resolve;
        }),
    });

    await runner.triggerRun({
      mode: 'full',
      actorUserId: 'user_1',
    });

    await expect(
      runner.triggerRun({
        mode: 'full',
        actorUserId: 'user_2',
      }),
    ).rejects.toThrow('governance_runner_busy');

    unblockFirst?.();
  });
});
