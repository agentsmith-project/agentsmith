import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function runLifecycleSnippet(logContent: string, snippet: string): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'runner-lifecycle-log-'));
  const logFile = path.join(tempRoot, 'runner.log');
  try {
    writeFileSync(logFile, logContent, 'utf8');
    return execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "${repoRoot}/scripts/lib/runner-lifecycle-log.sh"
          RUNNER_LOG_UNDER_TEST="${logFile}"
          ${snippet}
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

function latestState(logContent: string): string {
  return runLifecycleSnippet(logContent, 'runner_lifecycle_latest_log_state_file "${RUNNER_LOG_UNDER_TEST}"');
}

function isConnected(logContent: string): boolean {
  const output = runLifecycleSnippet(
    logContent,
    'if runner_lifecycle_log_file_is_connected "${RUNNER_LOG_UNDER_TEST}"; then printf connected; else printf not-connected; fi',
  );
  return output === 'connected';
}

describe('runner lifecycle log parser', () => {
  it('treats connected followed by stable shutting_down as not healthy', () => {
    const logs = [
      '[notebook-codex-runner] runner_state=connected reason=websocket_open',
      '[notebook-codex-runner] runner_state=shutting_down reason=websocket_close',
    ].join('\n');

    expect(latestState(logs)).toBe('shutting_down');
    expect(isConnected(logs)).toBe(false);
  });

  it('treats connected followed by stable disconnected as not healthy', () => {
    const logs = [
      '[notebook-codex-runner] runner_state=connected reason=websocket_open',
      '[notebook-codex-runner] runner_state=disconnected reason=websocket_close',
    ].join('\n');

    expect(latestState(logs)).toBe('disconnected');
    expect(isConnected(logs)).toBe(false);
  });

  it('treats legacy connected followed by legacy shutting down as not healthy', () => {
    const logs = [
      '[notebook-codex-runner] connected',
      '[notebook-codex-runner] shutting down (websocket_close)',
    ].join('\n');

    expect(latestState(logs)).toBe('shutting_down');
    expect(isConnected(logs)).toBe(false);
  });

  it('returns stale when no lifecycle transition is observed', () => {
    expect(latestState('[notebook-codex-runner] booting\n')).toBe('stale');
    expect(isConnected('[notebook-codex-runner] booting\n')).toBe(false);
  });

  it('keeps a lone legacy connected line compatible for old runner images', () => {
    expect(latestState('[notebook-codex-runner] connected\n')).toBe('connected');
    expect(isConnected('[notebook-codex-runner] connected\n')).toBe(true);
  });
});
