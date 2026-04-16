import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentsmith-local-runtime-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function runBash(script: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync('bash', ['-lc', script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      PATH: process.env.PATH ?? '',
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseElapsedMs(output: string): number {
  const elapsedMs = Number.parseInt(output.match(/elapsed_ms=(\d+)/)?.[1] ?? '', 10);
  if (!Number.isFinite(elapsedMs)) {
    throw new Error(`missing elapsed_ms in output: ${output}`);
  }
  return elapsedMs;
}

function reserveTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to reserve tcp port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function writeFakeTcpServer(tempRoot: string): string {
  const scriptPath = path.join(tempRoot, 'fake-tcp-server.js');
  writeFileSync(
    scriptPath,
    `const net = require('node:net');
const port = Number.parseInt(process.argv[2], 10);
const server = net.createServer((socket) => socket.end('ok\\n'));
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
setInterval(() => {}, 1000);
`,
    'utf8',
  );
  return scriptPath;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 4_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isPidAlive(pid);
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('local runtime process ownership contract', () => {
  it('starts a service with a machine-readable sidecar and stops the verified owned tree', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const logFile = path.join(tempRoot, 'api.log');
    const serverScript = writeFakeTcpServer(tempRoot);
    const port = await reserveTcpPort();

    const startResult = runBash(
      `
        set -euo pipefail
        source scripts/lib/local-runtime-processes.sh
        pid="$(local_runtime_start_owned_service api "${port}" "${logFile}" node "${serverScript}" "${port}")"
        echo "pid=$pid"
      `,
      {
        LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
        LOCAL_RUNTIME_RUN_ID: 'test-run-owned',
        LOCAL_RUNTIME_LINE_KIND: 'backend_real',
        LOCAL_RUNTIME_OWNER_TOKEN: 'owner-token-owned',
      },
    );

    expect(startResult.status).toBe(0);
    const pid = Number.parseInt(startResult.stdout.match(/pid=(\d+)/)?.[1] ?? '', 10);
    expect(Number.isInteger(pid)).toBe(true);
    expect(pid).toBeGreaterThan(0);

    const sidecarFiles = existsSync(processStateDir)
      ? execFileSync('bash', ['-lc', `find "${processStateDir}" -type f -name '*.json' | sort`], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim().split('\n').filter(Boolean)
      : [];
    expect(sidecarFiles).toHaveLength(1);

    const sidecar = JSON.parse(readFileSync(sidecarFiles[0], 'utf8')) as Record<string, unknown>;
    expect(sidecar).toMatchObject({
      schema_version: 1,
      run_id: 'test-run-owned',
      line_kind: 'backend_real',
      service_kind: 'api',
      pid,
      port,
      cwd: repoRoot,
      owner_token: 'owner-token-owned',
      captured_by: 'local-runtime-processes',
    });
    expect(sidecar).toHaveProperty('started_at');
    expect(sidecar).toHaveProperty('command');
    expect(sidecar).toHaveProperty('process_identity');

    const stopResult = runBash(
      `
        set -euo pipefail
        source scripts/lib/local-runtime-processes.sh
        local_runtime_stop_owned_process_tree "${pid}" api "${port}"
        local_runtime_wait_port_free "${port}" api 5
      `,
      {
        LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
        LOCAL_RUNTIME_OWNER_TOKEN: 'owner-token-owned',
      },
    );

    expect(stopResult.status).toBe(0);
    expect(await waitForPidExit(pid)).toBe(true);
  });

  it('refuses to stop a reused pid when the live process identity no longer matches its sidecar', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    mkdirSync(processStateDir, { recursive: true });
    const serverScript = writeFakeTcpServer(tempRoot);
    const port = await reserveTcpPort();
    const pid = Number.parseInt(
      execFileSync('bash', ['-lc', `node "${serverScript}" "${port}" >/dev/null 2>&1 & echo $!`], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim(),
      10,
    );

    writeFileSync(
      path.join(processStateDir, 'stale.json'),
      `${JSON.stringify({
        schema_version: 1,
        run_id: 'stale-run',
        line_kind: 'backend_real',
        service_kind: 'api',
        pid,
        port,
        cwd: repoRoot,
        command: 'node stale-server.js',
        owner_token: 'owner-token-stale',
        started_at: '2026-04-15T00:00:00.000Z',
        captured_by: 'local-runtime-processes',
        process_identity: {
          token: 'not-the-live-process-token',
          source: 'test',
        },
      }, null, 2)}\n`,
      'utf8',
    );

    const stopResult = runBash(
      `
        set -euo pipefail
        source scripts/lib/local-runtime-processes.sh
        local_runtime_stop_owned_process_tree "${pid}" api "${port}"
      `,
      {
        LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
        LOCAL_RUNTIME_OWNER_TOKEN: 'owner-token-stale',
      },
    );

    expect(stopResult.status).not.toBe(0);
    expect(stopResult.stderr).toContain('ownership verification failed');
    expect(isPidAlive(pid)).toBe(true);

    process.kill(pid, 'SIGKILL');
    await waitForPidExit(pid);
  });

  it('continues killing captured child pids with a test-scoped TERM/KILL grace budget', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const childPidFile = path.join(tempRoot, 'child.pid');
    const stubbornChildScript = path.join(tempRoot, 'stubborn-child.sh');
    const rootScript = path.join(tempRoot, 'root-exits-on-term.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      stubbornChildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
while true; do sleep 1; done
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
bash "${stubbornChildScript}" &
echo "$!" > "${childPidFile}"
trap 'exit 0' TERM
while true; do sleep 1; done
`,
      'utf8',
    );

    let rootPid = 0;
    let childPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'term-reparent-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'term-reparent-owner',
        },
      );
      expect(startResult.status).toBe(0);
      rootPid = Number.parseInt(startResult.stdout.trim(), 10);
      expect(rootPid).toBeGreaterThan(0);

      for (let attempt = 0; attempt < 20 && !existsSync(childPidFile); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(existsSync(childPidFile)).toBe(true);
      childPid = Number.parseInt(readFileSync(childPidFile, 'utf8').trim(), 10);
      expect(childPid).toBeGreaterThan(0);

      const stopResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          started_ms="$(date +%s%3N)"
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
          finished_ms="$(date +%s%3N)"
          echo "elapsed_ms=$((finished_ms - started_ms))"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'term-reparent-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '5',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      expect(stopResult.status).toBe(0);
      expect(parseElapsedMs(stopResult.stdout)).toBeLessThan(2_000);
      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(await waitForPidExit(childPid)).toBe(true);
    } finally {
      for (const pid of [childPid, rootPid]) {
        if (pid > 0 && isPidAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Best-effort cleanup for a deliberately stubborn test process.
          }
        }
      }
    }
  });

  it('falls back to conservative default grace budgets when grace environment values are invalid', () => {
    const result = runBash(
      `
        set -euo pipefail
        source scripts/lib/local-runtime-processes.sh
        echo "term_attempts=$(local_runtime_term_grace_attempts)"
        echo "term_sleep=$(local_runtime_term_grace_sleep_seconds)"
        echo "kill_attempts=$(local_runtime_kill_grace_attempts)"
        echo "kill_sleep=$(local_runtime_kill_grace_sleep_seconds)"
      `,
      {
        LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '0',
        LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: 'not-a-number',
        LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '-1',
        LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('term_attempts=20');
    expect(result.stdout).toContain('term_sleep=0.2');
    expect(result.stdout).toContain('kill_attempts=10');
    expect(result.stdout).toContain('kill_sleep=0.2');
  });

  it('rejects captured pid cleanup when the live identity token is unknown or changed', async () => {
    const tempRoot = makeTempRoot();
    const serverScript = writeFakeTcpServer(tempRoot);
    const port = await reserveTcpPort();
    const pid = Number.parseInt(
      execFileSync('bash', ['-lc', `node "${serverScript}" "${port}" >/dev/null 2>&1 & echo $!`], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim(),
      10,
    );

    try {
      const result = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_captured_pid_identity_matches "${pid}" "definitely-not-this-process-token"
        `,
      );

      expect(result.status).not.toBe(0);
      expect(isPidAlive(pid)).toBe(true);
    } finally {
      if (isPidAlive(pid)) {
        process.kill(pid, 'SIGKILL');
        await waitForPidExit(pid);
      }
    }
  });
});
