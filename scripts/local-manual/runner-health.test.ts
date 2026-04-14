import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runRunnerHealthState(args: {
  logContent: string;
  pidValue: number;
  readyFileContent?: string;
}): string {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-runner-health-'));
  const backendRealRoot = path.join(tempRoot, 'backend-real', 'current');
  const logFile = path.join(tempRoot, 'runner.log');
  const pidFile = path.join(tempRoot, 'runner.pid');
  const readyFile = path.join(tempRoot, 'runner.ready');

  try {
    writeFileSync(logFile, args.logContent, 'utf8');
    writeFileSync(pidFile, `${args.pidValue}\n`, 'utf8');
    writeFileSync(readyFile, `${args.readyFileContent ?? 'ready'}\n`, 'utf8');

    return execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          export ROOT_DIR="${repoRoot}"
          export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
          source "${repoRoot}/scripts/local-manual/common.sh"
          RUNNER_LOG="${logFile}" RUNNER_PID_FILE="${pidFile}" RUNNER_READY_FILE="${readyFile}" runner_socket_health_state
        `,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    ).trim();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('local-manual runner health', () => {
  it('reports connected when the runner process is alive and the latest socket log is connected', () => {
    const state = runRunnerHealthState({
      logContent: '[notebook-codex-runner] connected\n',
      pidValue: process.pid,
    });

    expect(state).toBe('connected');
  });

  it('reports disconnected when the latest socket log is disconnected even if the ready file is present', () => {
    const state = runRunnerHealthState({
      logContent: '[notebook-codex-runner] connected\n[notebook-codex-runner] disconnected\n',
      pidValue: process.pid,
      readyFileContent: 'ready',
    });

    expect(state).toBe('disconnected');
  });

  it('reports disconnected when the runner pid is gone even if an old connected log remains', () => {
    const state = runRunnerHealthState({
      logContent: '[notebook-codex-runner] connected\n',
      pidValue: 99999999,
      readyFileContent: 'ready',
    });

    expect(state).toBe('disconnected');
  });
});
