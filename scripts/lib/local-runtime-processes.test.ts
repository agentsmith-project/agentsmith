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
    const stat = execFileSync('bash', ['-lc', `ps -p "${pid}" -o stat=`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return stat !== '' && !stat.startsWith('Z');
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
      schema_version: 2,
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
    expect(sidecar).toHaveProperty('process_group_id');
    expect(sidecar).toHaveProperty('session_id');
    expect(typeof sidecar.process_group_id).toBe('number');
    expect(typeof sidecar.session_id).toBe('number');

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
    const [processGroupIdText, sessionIdText] = execFileSync('bash', ['-lc', `ps -p "${pid}" -o pgid=,sid=`], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim().split(/\s+/);
    const processGroupId = Number.parseInt(processGroupIdText ?? '', 10);
    const sessionId = Number.parseInt(sessionIdText ?? '', 10);

    writeFileSync(
      path.join(processStateDir, 'stale.json'),
      `${JSON.stringify({
        schema_version: 2,
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
        process_group_id: processGroupId,
        session_id: sessionId,
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
while true; do :; done
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
while true; do :; done
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
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '1',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.02',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '3',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.02',
        },
      );

      expect(stopResult.status).toBe(0);
      expect(parseElapsedMs(stopResult.stdout)).toBeLessThan(6_000);
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
  }, 8_000);

  it('fails closed when a root-only owned descendant detaches during TERM handling', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const detachedChildPidFile = path.join(tempRoot, 'detached-child.pid');
    const detachedChildScript = path.join(tempRoot, 'detached-child.sh');
    const spawnDetachedChildScript = path.join(tempRoot, 'spawn-detached-child.sh');
    const rootScript = path.join(tempRoot, 'root-spawns-detached-child-on-term.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      detachedChildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
echo "$$" > "${detachedChildPidFile}"
while true; do sleep 1; done
`,
      'utf8',
    );
    writeFileSync(
      spawnDetachedChildScript,
      `#!/usr/bin/env bash
set -euo pipefail
nohup setsid bash "${detachedChildScript}" >/dev/null 2>&1 < /dev/null &
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
trap 'bash "${spawnDetachedChildScript}"; exit 0' TERM
while true; do :; done
`,
      'utf8',
    );

    let rootPid = 0;
    let detachedChildPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'root-only-term-detached-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-only-term-detached-owner',
        },
      );
      expect(startResult.status).toBe(0);
      rootPid = Number.parseInt(startResult.stdout.trim(), 10);
      expect(rootPid).toBeGreaterThan(0);

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
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-only-term-detached-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '20',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      for (let attempt = 0; attempt < 20 && !existsSync(detachedChildPidFile); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(existsSync(detachedChildPidFile)).toBe(true);
      detachedChildPid = Number.parseInt(readFileSync(detachedChildPidFile, 'utf8').trim(), 10);
      expect(detachedChildPid).toBeGreaterThan(0);

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('cannot confirm descendant ownership');
      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(isPidAlive(detachedChildPid)).toBe(true);
    } finally {
      for (const pid of [detachedChildPid, rootPid]) {
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

  it('fails closed when a root-only owned descendant detaches during the KILL window', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const detachedChildPidFile = path.join(tempRoot, 'detached-child.pid');
    const detachedChildScript = path.join(tempRoot, 'detached-child.sh');
    const delayedDetachedChildScript = path.join(tempRoot, 'delayed-detached-child.sh');
    const spawnDetachedChildScript = path.join(tempRoot, 'spawn-detached-child.sh');
    const detachedChildSpawnedMarkerFile = path.join(tempRoot, 'detached-child-spawned.marker');
    const rootScript = path.join(tempRoot, 'root-spawns-detached-child-before-kill.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      detachedChildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
echo "$$" > "${detachedChildPidFile}"
while true; do sleep 1; done
`,
      'utf8',
    );
    writeFileSync(
      delayedDetachedChildScript,
      `#!/usr/bin/env bash
set -euo pipefail
sleep 0.2
exec bash "${detachedChildScript}"
`,
      'utf8',
    );
    writeFileSync(
      spawnDetachedChildScript,
      `#!/usr/bin/env bash
set -euo pipefail
nohup setsid bash "${delayedDetachedChildScript}" >/dev/null 2>&1 < /dev/null &
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
trap 'if [[ ! -f "${detachedChildSpawnedMarkerFile}" ]]; then : > "${detachedChildSpawnedMarkerFile}"; bash "${spawnDetachedChildScript}"; fi' TERM
while true; do :; done
`,
      'utf8',
    );

    let rootPid = 0;
    let detachedChildPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'root-only-kill-detached-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-only-kill-detached-owner',
        },
      );
      expect(startResult.status).toBe(0);
      rootPid = Number.parseInt(startResult.stdout.trim(), 10);
      expect(rootPid).toBeGreaterThan(0);

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
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-only-kill-detached-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '5',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      for (let attempt = 0; attempt < 20 && !existsSync(detachedChildPidFile); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(existsSync(detachedChildPidFile)).toBe(true);
      detachedChildPid = Number.parseInt(readFileSync(detachedChildPidFile, 'utf8').trim(), 10);
      expect(detachedChildPid).toBeGreaterThan(0);

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('cannot confirm descendant ownership');
      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(isPidAlive(detachedChildPid)).toBe(true);
    } finally {
      for (const pid of [detachedChildPid, rootPid]) {
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

  it('fails closed when a root-only copied-marker descendant remains after the root pid already exited', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const childPidFile = path.join(tempRoot, 'child.pid');
    const stubbornChildScript = path.join(tempRoot, 'stubborn-child.sh');
    const rootScript = path.join(tempRoot, 'root-spawns-child-and-exits.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      stubbornChildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
bash "${stubbornChildScript}" &
echo "$!" > "${childPidFile}"
sleep 0.2
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
          LOCAL_RUNTIME_RUN_ID: 'root-dead-cleanup-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-cleanup-owner',
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

      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(isPidAlive(childPid)).toBe(true);

      const stopResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-cleanup-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '5',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('cannot confirm descendant ownership');
      expect(isPidAlive(childPid)).toBe(true);
      const sidecarFiles = existsSync(processStateDir)
        ? execFileSync('bash', ['-lc', `find "${processStateDir}" -type f -name '*.json' | sort`], {
          cwd: repoRoot,
          encoding: 'utf8',
        }).trim().split('\n').filter(Boolean)
        : [];
      expect(sidecarFiles).toHaveLength(1);
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

  it('fails closed when a root-dead owned descendant cleared runtime markers before cleanup', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const childPidFile = path.join(tempRoot, 'child.pid');
    const childScript = path.join(tempRoot, 'child-clears-markers.sh');
    const rootScript = path.join(tempRoot, 'root-spawns-child-and-exits.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      childScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
env \
  -u LOCAL_RUNTIME_OWNER_TOKEN \
  -u LOCAL_RUNTIME_SERVICE_KIND \
  -u LOCAL_RUNTIME_TREE_ROOT_PID \
  bash "${childScript}" &
echo "$!" > "${childPidFile}"
sleep 0.2
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
          LOCAL_RUNTIME_RUN_ID: 'root-dead-cleared-markers-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-cleared-markers-owner',
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

      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(isPidAlive(childPid)).toBe(true);

      const stopResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-cleared-markers-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '5',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('cannot confirm descendant ownership');
      expect(isPidAlive(childPid)).toBe(true);
      const sidecarFiles = existsSync(processStateDir)
        ? execFileSync('bash', ['-lc', `find "${processStateDir}" -type f -name '*.json' | sort`], {
          cwd: repoRoot,
          encoding: 'utf8',
        }).trim().split('\n').filter(Boolean)
        : [];
      expect(sidecarFiles).toHaveLength(1);
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

  it('fails closed when the root pid already exited and completion authority is unavailable', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const rootScript = path.join(tempRoot, 'root-exits-immediately.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
sleep 0.2
`,
      'utf8',
    );

    let rootPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'root-dead-no-proof-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-no-proof-owner',
        },
      );
      expect(startResult.status).toBe(0);
      rootPid = Number.parseInt(startResult.stdout.trim(), 10);
      expect(rootPid).toBeGreaterThan(0);

      expect(await waitForPidExit(rootPid)).toBe(true);

      const stopResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-no-proof-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '5',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('completion authority');
      const sidecarFiles = existsSync(processStateDir)
        ? execFileSync('bash', ['-lc', `find "${processStateDir}" -type f -name '*.json' | sort`], {
          cwd: repoRoot,
          encoding: 'utf8',
        }).trim().split('\n').filter(Boolean)
        : [];
      expect(sidecarFiles).toHaveLength(1);
    } finally {
      if (rootPid > 0 && isPidAlive(rootPid)) {
        try {
          process.kill(rootPid, 'SIGKILL');
        } catch {
          // Best-effort cleanup for a deliberately stubborn test process.
        }
      }
    }
  });

  it('fails closed when a root-dead detached owned descendant cleared runtime markers before cleanup', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const detachedChildPidFile = path.join(tempRoot, 'detached-child.pid');
    const detachedChildScript = path.join(tempRoot, 'detached-child-clears-markers.sh');
    const rootScript = path.join(tempRoot, 'root-spawns-detached-child-and-exits.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      detachedChildScript,
      `#!/usr/bin/env bash
echo "$$" > "${detachedChildPidFile}"
trap '' TERM
trap '' HUP
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
nohup env \
  -u LOCAL_RUNTIME_OWNER_TOKEN \
  -u LOCAL_RUNTIME_SERVICE_KIND \
  -u LOCAL_RUNTIME_TREE_ROOT_PID \
  setsid bash "${detachedChildScript}" >/dev/null 2>&1 < /dev/null &
sleep 0.2
`,
      'utf8',
    );

    let rootPid = 0;
    let detachedChildPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'root-dead-detached-cleared-markers-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-detached-cleared-markers-owner',
        },
      );
      expect(startResult.status).toBe(0);
      rootPid = Number.parseInt(startResult.stdout.trim(), 10);
      expect(rootPid).toBeGreaterThan(0);

      for (let attempt = 0; attempt < 20 && !existsSync(detachedChildPidFile); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(existsSync(detachedChildPidFile)).toBe(true);
      detachedChildPid = Number.parseInt(readFileSync(detachedChildPidFile, 'utf8').trim(), 10);
      expect(detachedChildPid).toBeGreaterThan(0);

      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(isPidAlive(detachedChildPid)).toBe(true);

      const stopResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-detached-cleared-markers-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '5',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('completion authority');
      expect(isPidAlive(detachedChildPid)).toBe(true);
      const sidecarFiles = existsSync(processStateDir)
        ? execFileSync('bash', ['-lc', `find "${processStateDir}" -type f -name '*.json' | sort`], {
          cwd: repoRoot,
          encoding: 'utf8',
        }).trim().split('\n').filter(Boolean)
        : [];
      expect(sidecarFiles).toHaveLength(1);
    } finally {
      for (const pid of [detachedChildPid, rootPid]) {
        if (pid > 0 && isPidAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Best-effort cleanup for a deliberately stubborn test process.
          }
        }
      }
    }
  }, 7_000);

  it('fails closed when the root pid already exited with only a legacy sidecar schema', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const childPidFile = path.join(tempRoot, 'child.pid');
    const stubbornChildScript = path.join(tempRoot, 'stubborn-child.sh');
    const rootScript = path.join(tempRoot, 'root-spawns-child-and-exits.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      stubbornChildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
bash "${stubbornChildScript}" &
echo "$!" > "${childPidFile}"
sleep 0.2
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
          LOCAL_RUNTIME_RUN_ID: 'root-dead-legacy-sidecar-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-legacy-sidecar-owner',
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

      expect(await waitForPidExit(rootPid)).toBe(true);
      const sidecarFiles = existsSync(processStateDir)
        ? execFileSync('bash', ['-lc', `find "${processStateDir}" -type f -name '*.json' | sort`], {
          cwd: repoRoot,
          encoding: 'utf8',
        }).trim().split('\n').filter(Boolean)
        : [];
      expect(sidecarFiles).toHaveLength(1);
      const legacySidecar = JSON.parse(readFileSync(sidecarFiles[0], 'utf8')) as Record<string, unknown>;
      delete legacySidecar.process_group_id;
      delete legacySidecar.session_id;
      legacySidecar.schema_version = 1;
      writeFileSync(sidecarFiles[0], `${JSON.stringify(legacySidecar, null, 2)}\n`, 'utf8');

      const stopResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-legacy-sidecar-owner',
        },
      );

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('legacy sidecar');
      expect(isPidAlive(childPid)).toBe(true);
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
      if (childPid > 0) {
        await waitForPidExit(childPid);
      }
    }
  });

  it('fails closed when the root pid already exited and sidecar authority is missing', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const childPidFile = path.join(tempRoot, 'child.pid');
    const stubbornChildScript = path.join(tempRoot, 'stubborn-child.sh');
    const rootScript = path.join(tempRoot, 'root-spawns-child-and-exits.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      stubbornChildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
bash "${stubbornChildScript}" &
echo "$!" > "${childPidFile}"
sleep 0.2
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
          LOCAL_RUNTIME_RUN_ID: 'root-dead-missing-sidecar-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-missing-sidecar-owner',
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

      expect(await waitForPidExit(rootPid)).toBe(true);
      const sidecarFiles = existsSync(processStateDir)
        ? execFileSync('bash', ['-lc', `find "${processStateDir}" -type f -name '*.json' | sort`], {
          cwd: repoRoot,
          encoding: 'utf8',
        }).trim().split('\n').filter(Boolean)
        : [];
      expect(sidecarFiles).toHaveLength(1);
      rmSync(sidecarFiles[0], { force: true });

      const stopResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-missing-sidecar-owner',
        },
      );

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('missing sidecar');
      expect(isPidAlive(childPid)).toBe(true);
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
      if (childPid > 0) {
        await waitForPidExit(childPid);
      }
    }
  });

  it('fails closed when a same-session copied-marker process remains after the root pid already exited', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const foreignPidFile = path.join(tempRoot, 'foreign.pid');
    const foreignScript = path.join(tempRoot, 'foreign.sh');
    const spawnForeignScript = path.join(tempRoot, 'spawn-foreign.sh');
    const rootScript = path.join(tempRoot, 'root-spawns-foreign-and-exits.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      foreignScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
echo "$$" > "${foreignPidFile}"
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      spawnForeignScript,
      `#!/usr/bin/env bash
set -euo pipefail
bash "${foreignScript}" &
echo "$!" > "${foreignPidFile}"
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
bash "${spawnForeignScript}"
sleep 0.2
`,
      'utf8',
    );

    let rootPid = 0;
    let foreignPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'root-dead-same-session-foreign-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-same-session-foreign-owner',
        },
      );
      expect(startResult.status).toBe(0);
      rootPid = Number.parseInt(startResult.stdout.trim(), 10);
      expect(rootPid).toBeGreaterThan(0);

      for (let attempt = 0; attempt < 20 && !existsSync(foreignPidFile); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(existsSync(foreignPidFile)).toBe(true);
      foreignPid = Number.parseInt(readFileSync(foreignPidFile, 'utf8').trim(), 10);
      expect(foreignPid).toBeGreaterThan(0);

      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(isPidAlive(foreignPid)).toBe(true);

      const stopResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'root-dead-same-session-foreign-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '5',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('cannot confirm descendant ownership');
      expect(isPidAlive(foreignPid)).toBe(true);
    } finally {
      for (const pid of [foreignPid, rootPid]) {
        if (pid > 0 && isPidAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Best-effort cleanup for a deliberately stubborn test process.
          }
        }
      }
      if (foreignPid > 0) {
        await waitForPidExit(foreignPid);
      }
    }
  });

  it('does not kill a foreign process discovered only by copied runtime markers during full /proc discovery', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const foreignPidFile = path.join(tempRoot, 'foreign.pid');
    const rootScript = path.join(tempRoot, 'root-exits-on-term.sh');
    const foreignScript = path.join(tempRoot, 'foreign-marker-only.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
trap 'exit 0' TERM
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      foreignScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
echo "$$" > "${foreignPidFile}"
while true; do sleep 1; done
`,
      'utf8',
    );

    let rootPid = 0;
    let foreignPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'marker-only-foreign-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'marker-only-foreign-owner',
        },
      );
      expect(startResult.status).toBe(0);
      rootPid = Number.parseInt(startResult.stdout.trim(), 10);
      expect(rootPid).toBeGreaterThan(0);

      const foreignStartResult = runBash(
        `
          set -euo pipefail
          nohup env \
            LOCAL_RUNTIME_OWNER_TOKEN='marker-only-foreign-owner' \
            LOCAL_RUNTIME_SERVICE_KIND='api' \
            LOCAL_RUNTIME_TREE_ROOT_PID='${rootPid}' \
            setsid bash "${foreignScript}" >/dev/null 2>&1 < /dev/null &
          echo "$!"
        `,
      );
      expect(foreignStartResult.status).toBe(0);
      foreignPid = Number.parseInt(foreignStartResult.stdout.trim(), 10);
      expect(foreignPid).toBeGreaterThan(0);

      for (let attempt = 0; attempt < 20 && !existsSync(foreignPidFile); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(existsSync(foreignPidFile)).toBe(true);
      expect(Number.parseInt(readFileSync(foreignPidFile, 'utf8').trim(), 10)).toBe(foreignPid);

      const stopResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'marker-only-foreign-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '5',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('cannot confirm descendant ownership');
      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(isPidAlive(foreignPid)).toBe(true);
    } finally {
      for (const pid of [foreignPid, rootPid]) {
        if (pid > 0 && isPidAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Best-effort cleanup for a deliberately stubborn test process.
          }
        }
      }
      if (foreignPid > 0) {
        await waitForPidExit(foreignPid);
      }
    }
  });

  it('fails closed when a foreign copied-marker process starts after cleanup begins', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const foreignPidFile = path.join(tempRoot, 'foreign-after-cleanup.pid');
    const rootScript = path.join(tempRoot, 'root-exits-on-term.sh');
    const foreignScript = path.join(tempRoot, 'foreign-after-cleanup.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
trap 'exit 0' TERM
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      foreignScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
echo "$$" > "${foreignPidFile}"
while true; do sleep 1; done
`,
      'utf8',
    );

    let rootPid = 0;
    let foreignPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'marker-only-foreign-after-cleanup-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'marker-only-foreign-after-cleanup-owner',
        },
      );
      expect(startResult.status).toBe(0);
      rootPid = Number.parseInt(startResult.stdout.trim(), 10);
      expect(rootPid).toBeGreaterThan(0);

      const stopResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          set +e
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}" >"${tempRoot}/stop.stdout" 2>"${tempRoot}/stop.stderr" &
          stop_pid="$!"
          sleep 0.1
          nohup env \
            LOCAL_RUNTIME_OWNER_TOKEN='marker-only-foreign-after-cleanup-owner' \
            LOCAL_RUNTIME_SERVICE_KIND='api' \
            LOCAL_RUNTIME_TREE_ROOT_PID='${rootPid}' \
            setsid bash "${foreignScript}" >/dev/null 2>&1 < /dev/null &
          wait "\${stop_pid}"
          stop_status="$?"
          set -e
          echo "stop_status=\${stop_status}"
          cat "${tempRoot}/stop.stdout"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'marker-only-foreign-after-cleanup-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '5',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      for (let attempt = 0; attempt < 20 && !existsSync(foreignPidFile); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(existsSync(foreignPidFile)).toBe(true);
      foreignPid = Number.parseInt(readFileSync(foreignPidFile, 'utf8').trim(), 10);
      expect(foreignPid).toBeGreaterThan(0);

      expect(stopResult.status).toBe(0);
      expect(stopResult.stdout).toContain('stop_status=1');
      expect(readFileSync(path.join(tempRoot, 'stop.stderr'), 'utf8')).toContain('cannot confirm descendant ownership');
      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(isPidAlive(foreignPid)).toBe(true);
    } finally {
      for (const pid of [foreignPid, rootPid]) {
        if (pid > 0 && isPidAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Best-effort cleanup for a deliberately stubborn test process.
          }
        }
      }
      if (foreignPid > 0) {
        await waitForPidExit(foreignPid);
      }
    }
  });

  it('keeps cleaning newly discovered owned descendants after root and child exit during TERM grace', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const childPidFile = path.join(tempRoot, 'child.pid');
    const grandchildPidFile = path.join(tempRoot, 'grandchild.pid');
    const stubbornGrandchildScript = path.join(tempRoot, 'stubborn-grandchild.sh');
    const childScript = path.join(tempRoot, 'child-spawns-grandchild-on-term.sh');
    const rootScript = path.join(tempRoot, 'root-exits-on-term.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      stubbornGrandchildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
echo "$$" > "${grandchildPidFile}"
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      childScript,
      `#!/usr/bin/env bash
set -euo pipefail
trap 'bash "${stubbornGrandchildScript}" & exit 0' TERM
trap '' HUP
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
bash "${childScript}" &
echo "$!" > "${childPidFile}"
trap 'exit 0' TERM
while true; do :; done
`,
      'utf8',
    );

    let rootPid = 0;
    let childPid = 0;
    let grandchildPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'term-grandchild-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'term-grandchild-owner',
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
          LOCAL_RUNTIME_OWNER_TOKEN: 'term-grandchild-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '20',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      for (let attempt = 0; attempt < 20 && !existsSync(grandchildPidFile); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(existsSync(grandchildPidFile)).toBe(true);
      grandchildPid = Number.parseInt(readFileSync(grandchildPidFile, 'utf8').trim(), 10);
      expect(grandchildPid).toBeGreaterThan(0);

      expect(stopResult.status).toBe(0);
      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(await waitForPidExit(childPid)).toBe(true);
      expect(await waitForPidExit(grandchildPid)).toBe(true);
    } finally {
      for (const pid of [grandchildPid, childPid, rootPid]) {
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

  it('fails closed when an owned descendant detaches into a new session during TERM handling', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const childPidFile = path.join(tempRoot, 'child.pid');
    const grandchildPidFile = path.join(tempRoot, 'detached-grandchild.pid');
    const detachedGrandchildScript = path.join(tempRoot, 'detached-grandchild.sh');
    const childScript = path.join(tempRoot, 'child-setsid-grandchild-on-term.sh');
    const rootScript = path.join(tempRoot, 'root-exits-on-term.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      detachedGrandchildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
echo "$$" > "${grandchildPidFile}"
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      childScript,
      `#!/usr/bin/env bash
set -euo pipefail
trap 'setsid bash "${detachedGrandchildScript}" & exit 0' TERM
trap '' HUP
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
bash "${childScript}" &
echo "$!" > "${childPidFile}"
trap 'exit 0' TERM
while true; do :; done
`,
      'utf8',
    );

    let rootPid = 0;
    let childPid = 0;
    let grandchildPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'term-detached-grandchild-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'term-detached-grandchild-owner',
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
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'term-detached-grandchild-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '20',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      for (let attempt = 0; attempt < 20 && !existsSync(grandchildPidFile); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(existsSync(grandchildPidFile)).toBe(true);
      grandchildPid = Number.parseInt(readFileSync(grandchildPidFile, 'utf8').trim(), 10);
      expect(grandchildPid).toBeGreaterThan(0);

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('cannot confirm descendant ownership');
      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(await waitForPidExit(childPid)).toBe(true);
      expect(isPidAlive(grandchildPid)).toBe(true);
    } finally {
      for (const pid of [grandchildPid, childPid, rootPid]) {
        if (pid > 0 && isPidAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Best-effort cleanup for a deliberately stubborn test process.
          }
        }
      }
    }
  }, 10_000);

  it('fails closed when same-session and detached owned descendants are discovered in the same TERM round', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const childPidFile = path.join(tempRoot, 'child.pid');
    const sameSessionGrandchildPidFile = path.join(tempRoot, 'same-session-grandchild.pid');
    const detachedGrandchildPidFile = path.join(tempRoot, 'detached-grandchild.pid');
    const sameSessionGrandchildScript = path.join(tempRoot, 'same-session-grandchild.sh');
    const detachedGrandchildScript = path.join(tempRoot, 'detached-grandchild.sh');
    const childScript = path.join(tempRoot, 'child-spawns-both-on-term.sh');
    const rootScript = path.join(tempRoot, 'root-exits-on-term.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      sameSessionGrandchildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
echo "$$" > "${sameSessionGrandchildPidFile}"
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      detachedGrandchildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
echo "$$" > "${detachedGrandchildPidFile}"
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      childScript,
      `#!/usr/bin/env bash
set -euo pipefail
trap 'bash "${sameSessionGrandchildScript}" & setsid bash "${detachedGrandchildScript}" & exit 0' TERM
trap '' HUP
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
bash "${childScript}" &
echo "$!" > "${childPidFile}"
trap 'exit 0' TERM
while true; do :; done
`,
      'utf8',
    );

    let rootPid = 0;
    let childPid = 0;
    let sameSessionGrandchildPid = 0;
    let detachedGrandchildPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'term-mixed-grandchildren-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'term-mixed-grandchildren-owner',
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
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'term-mixed-grandchildren-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '20',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      for (let attempt = 0; attempt < 20 && (!existsSync(sameSessionGrandchildPidFile) || !existsSync(detachedGrandchildPidFile)); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(existsSync(sameSessionGrandchildPidFile)).toBe(true);
      expect(existsSync(detachedGrandchildPidFile)).toBe(true);
      sameSessionGrandchildPid = Number.parseInt(readFileSync(sameSessionGrandchildPidFile, 'utf8').trim(), 10);
      detachedGrandchildPid = Number.parseInt(readFileSync(detachedGrandchildPidFile, 'utf8').trim(), 10);
      expect(sameSessionGrandchildPid).toBeGreaterThan(0);
      expect(detachedGrandchildPid).toBeGreaterThan(0);

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('cannot confirm descendant ownership');
      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(await waitForPidExit(childPid)).toBe(true);
      expect(isPidAlive(sameSessionGrandchildPid)).toBe(true);
      expect(isPidAlive(detachedGrandchildPid)).toBe(true);
    } finally {
      for (const pid of [detachedGrandchildPid, sameSessionGrandchildPid, childPid, rootPid]) {
        if (pid > 0 && isPidAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Best-effort cleanup for a deliberately stubborn test process.
          }
        }
      }
    }
  }, 10_000);

  it('keeps killing a same-tree scanned descendant when later identity and owner rereads race', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const childPidFile = path.join(tempRoot, 'child.pid');
    const grandchildPidFile = path.join(tempRoot, 'grandchild.pid');
    const racyCommandCountFile = path.join(tempRoot, 'same-tree-racy-command.count');
    const stubbornGrandchildScript = path.join(tempRoot, 'same-tree-racy-grandchild.sh');
    const childScript = path.join(tempRoot, 'child-spawns-racy-grandchild-on-term.sh');
    const rootScript = path.join(tempRoot, 'root-exits-on-term.sh');
    const escapedGrandchildScript = stubbornGrandchildScript.replace(/(["\\$`])/g, '\\$1');
    const port = await reserveTcpPort();

    writeFileSync(
      stubbornGrandchildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
echo "$$" > "${grandchildPidFile}"
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      childScript,
      `#!/usr/bin/env bash
set -euo pipefail
trap 'bash "${stubbornGrandchildScript}" & exit 0' TERM
trap '' HUP
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
bash "${childScript}" &
echo "$!" > "${childPidFile}"
trap 'exit 0' TERM
while true; do :; done
`,
      'utf8',
    );

    let rootPid = 0;
    let childPid = 0;
    let grandchildPid = 0;

    try {
      const startResult = runBash(
        `
          set -euo pipefail
          source scripts/lib/local-runtime-processes.sh
          local_runtime_start_owned_service api "${port}" "${tempRoot}/api.log" bash "${rootScript}"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_RUN_ID: 'same-tree-racy-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'same-tree-racy-owner',
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
          eval "$(declare -f local_runtime_process_command | sed '1s/local_runtime_process_command/local_runtime_process_command_original/')"
          eval "$(declare -f local_runtime_process_owner_token | sed '1s/local_runtime_process_owner_token/local_runtime_process_owner_token_original/')"
          local_runtime_process_command() {
            local pid="$1"
            local command
            command="$(local_runtime_process_command_original "\${pid}")"
            if [[ "\${command}" == *"${escapedGrandchildScript}"* ]]; then
              local count=0
              if [[ -f "\${LOCAL_RUNTIME_TEST_SAME_TREE_RACY_COMMAND_COUNT_FILE}" ]]; then
                count="$(cat "\${LOCAL_RUNTIME_TEST_SAME_TREE_RACY_COMMAND_COUNT_FILE}")"
              fi
              count="$((count + 1))"
              printf '%s\n' "\${count}" > "\${LOCAL_RUNTIME_TEST_SAME_TREE_RACY_COMMAND_COUNT_FILE}"
              if [[ "\${count}" -ge 2 ]]; then
                return 0
              fi
            fi
            printf '%s\n' "\${command}"
          }
          local_runtime_process_owner_token() {
            local pid="$1"
            local command
            command="$(local_runtime_process_command_original "\${pid}")"
            if [[ "\${command}" == *"${escapedGrandchildScript}"* ]]; then
              return 1
            fi
            local_runtime_process_owner_token_original "\${pid}"
          }
          started_ms="$(date +%s%3N)"
          local_runtime_stop_owned_process_tree "${rootPid}" api "${port}"
          finished_ms="$(date +%s%3N)"
          echo "elapsed_ms=$((finished_ms - started_ms))"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
          LOCAL_RUNTIME_OWNER_TOKEN: 'same-tree-racy-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '2',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '20',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_TEST_SAME_TREE_RACY_COMMAND_COUNT_FILE: racyCommandCountFile,
        },
      );

      for (let attempt = 0; attempt < 20 && !existsSync(grandchildPidFile); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(existsSync(grandchildPidFile)).toBe(true);
      grandchildPid = Number.parseInt(readFileSync(grandchildPidFile, 'utf8').trim(), 10);
      expect(grandchildPid).toBeGreaterThan(0);

      expect(stopResult.status).toBe(0);
      expect(parseElapsedMs(stopResult.stdout)).toBeLessThan(5_000);
      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(await waitForPidExit(childPid)).toBe(true);
      expect(await waitForPidExit(grandchildPid)).toBe(true);
      expect(Number.parseInt(readFileSync(racyCommandCountFile, 'utf8').trim(), 10)).toBeGreaterThanOrEqual(2);
    } finally {
      for (const pid of [grandchildPid, childPid, rootPid]) {
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

  it('keeps killing owned descendants when descendant cmdline reads race during KILL revalidation', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const childPidFile = path.join(tempRoot, 'child.pid');
    const cmdlineRaceCountFile = path.join(tempRoot, 'cmdline-race.count');
    const stubbornChildScript = path.join(tempRoot, 'stubborn-child.sh');
    const rootScript = path.join(tempRoot, 'root-exits-on-term.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      stubbornChildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
while true; do :; done
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
while true; do :; done
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
          eval "$(declare -f local_runtime_process_command | sed '1s/local_runtime_process_command/local_runtime_process_command_original/')"
          local_runtime_process_command() {
            local pid="$1"
            if [[ "\${pid}" == "\${LOCAL_RUNTIME_TEST_RACY_DESCENDANT_PID}" ]]; then
              local count=0
              if [[ -f "\${LOCAL_RUNTIME_TEST_CMDLINE_RACE_COUNT_FILE}" ]]; then
                count="$(cat "\${LOCAL_RUNTIME_TEST_CMDLINE_RACE_COUNT_FILE}")"
              fi
              count="$((count + 1))"
              printf '%s\n' "\${count}" > "\${LOCAL_RUNTIME_TEST_CMDLINE_RACE_COUNT_FILE}"
              if [[ "\${count}" -ge 3 ]]; then
                return 0
              fi
            fi
            local_runtime_process_command_original "\${pid}"
          }
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
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '80',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.1',
          LOCAL_RUNTIME_TEST_RACY_DESCENDANT_PID: String(childPid),
          LOCAL_RUNTIME_TEST_CMDLINE_RACE_COUNT_FILE: cmdlineRaceCountFile,
        },
      );

      expect(stopResult.status).toBe(0);
      expect(parseElapsedMs(stopResult.stdout)).toBeLessThan(5_000);
      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(await waitForPidExit(childPid)).toBe(true);
      expect(Number.parseInt(readFileSync(cmdlineRaceCountFile, 'utf8').trim(), 10)).toBeGreaterThanOrEqual(3);
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
  }, 8_000);

  it('refuses to KILL a descendant whose live identity changed after TERM even when the owner token still matches', async () => {
    const tempRoot = makeTempRoot();
    const processStateDir = path.join(tempRoot, 'processes');
    const childPidFile = path.join(tempRoot, 'child.pid');
    const childChangedMarkerFile = path.join(tempRoot, 'child-changed.marker');
    const replacementChildScript = path.join(tempRoot, 'replacement-child.sh');
    const switchingChildScript = path.join(tempRoot, 'switching-child.sh');
    const rootScript = path.join(tempRoot, 'root-exits-on-term.sh');
    const port = await reserveTcpPort();

    writeFileSync(
      replacementChildScript,
      `#!/usr/bin/env bash
trap '' TERM
trap '' HUP
printf 'changed\n' > "${childChangedMarkerFile}"
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      switchingChildScript,
      `#!/usr/bin/env bash
set -euo pipefail
trap 'exec bash "${replacementChildScript}"' TERM
trap '' HUP
while true; do :; done
`,
      'utf8',
    );
    writeFileSync(
      rootScript,
      `#!/usr/bin/env bash
set -euo pipefail
bash "${switchingChildScript}" &
echo "$!" > "${childPidFile}"
trap 'exit 0' TERM
while true; do :; done
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
          LOCAL_RUNTIME_RUN_ID: 'term-identity-change-run',
          LOCAL_RUNTIME_LINE_KIND: 'backend_real',
          LOCAL_RUNTIME_OWNER_TOKEN: 'term-identity-change-owner',
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
          LOCAL_RUNTIME_OWNER_TOKEN: 'term-identity-change-owner',
          LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS: '5',
          LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS: '0.05',
          LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS: '5',
          LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS: '0.05',
        },
      );

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain(`refusing to KILL pid ${childPid}: captured process identity changed`);
      expect(existsSync(childChangedMarkerFile)).toBe(true);
      expect(await waitForPidExit(rootPid)).toBe(true);
      expect(isPidAlive(childPid)).toBe(true);
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
      if (childPid > 0) {
        await waitForPidExit(childPid);
      }
      if (rootPid > 0) {
        await waitForPidExit(rootPid);
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
