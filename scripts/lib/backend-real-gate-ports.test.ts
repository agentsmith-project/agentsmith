import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentsmith-gate-ports-'));
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

function spawnUnownedListener(serverScript: string, port: number): number {
  return Number.parseInt(
    execFileSync('bash', ['-lc', `node "${serverScript}" "${port}" >/dev/null 2>&1 & echo $!`], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim(),
    10,
  );
}

function spawnFakeMatchingSupervisor(specPath: string): number {
  return Number.parseInt(
    execFileSync(
      'bash',
      [
        '-lc',
        `bash -c 'trap "" TERM; while true; do sleep 1; done' "scripts/run-integration-e2e-full.sh" "${specPath}" >/dev/null 2>&1 & echo $!`,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    ).trim(),
    10,
  );
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

describe('backend-real gate port ownership cleanup', () => {
  it('blocks unowned port listeners by default instead of killing arbitrary processes', async () => {
    const tempRoot = makeTempRoot();
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const listenerPid = spawnUnownedListener(writeFakeTcpServer(tempRoot), apiPort);

    const result = runBash(
      `
        set -euo pipefail
        source scripts/lib/backend-real-gate-ports.sh
        cleanup_gate_ports "${apiPort}" "${webPort}" "e2e/example.spec.ts"
      `,
      {
        LOCAL_RUNTIME_PROCESS_STATE_DIR: path.join(tempRoot, 'processes'),
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unowned listener');
    expect(isPidAlive(listenerPid)).toBe(true);

    process.kill(listenerPid, 'SIGKILL');
    await waitForPidExit(listenerPid);
  });

  it('cleans verified sidecar-owned listeners without requiring rescue mode', async () => {
    const tempRoot = makeTempRoot();
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const serverScript = writeFakeTcpServer(tempRoot);
    const processStateDir = path.join(tempRoot, 'processes');

    const startResult = runBash(
      `
        set -euo pipefail
        source scripts/lib/local-runtime-processes.sh
        local_runtime_start_owned_service api "${apiPort}" "${tempRoot}/api.log" node "${serverScript}" "${apiPort}"
      `,
      {
        LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
        LOCAL_RUNTIME_RUN_ID: 'test-run-gate-owned',
        LOCAL_RUNTIME_LINE_KIND: 'backend_real',
        LOCAL_RUNTIME_OWNER_TOKEN: 'owner-token-gate-owned',
      },
    );
    expect(startResult.status).toBe(0);
    const ownedPid = Number.parseInt(startResult.stdout.trim(), 10);
    expect(ownedPid).toBeGreaterThan(0);

    const cleanupResult = runBash(
      `
        set -euo pipefail
        source scripts/lib/backend-real-gate-ports.sh
        cleanup_gate_ports "${apiPort}" "${webPort}" "e2e/example.spec.ts"
      `,
      {
        LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
        LOCAL_RUNTIME_OWNER_TOKEN: 'owner-token-gate-owned',
      },
    );

    expect(cleanupResult.status).toBe(0);
    expect(await waitForPidExit(ownedPid)).toBe(true);
  });

  it('cleans stale sidecar-owned listeners from a previous run even when the current run has a different owner token', async () => {
    const tempRoot = makeTempRoot();
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const serverScript = writeFakeTcpServer(tempRoot);
    const processStateDir = path.join(tempRoot, 'processes');

    const startResult = runBash(
      `
        set -euo pipefail
        source scripts/lib/local-runtime-processes.sh
        local_runtime_start_owned_service api "${apiPort}" "${tempRoot}/api.log" node "${serverScript}" "${apiPort}"
      `,
      {
        LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
        LOCAL_RUNTIME_RUN_ID: 'previous-run',
        LOCAL_RUNTIME_LINE_KIND: 'backend_real',
        LOCAL_RUNTIME_OWNER_TOKEN: 'previous-owner-token',
      },
    );
    expect(startResult.status).toBe(0);
    const ownedPid = Number.parseInt(startResult.stdout.trim(), 10);

    const cleanupResult = runBash(
      `
        set -euo pipefail
        source scripts/lib/backend-real-gate-ports.sh
        cleanup_gate_ports "${apiPort}" "${webPort}" "e2e/example.spec.ts"
      `,
      {
        LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
        LOCAL_RUNTIME_OWNER_TOKEN: 'current-run-owner-token',
      },
    );

    expect(cleanupResult.status).toBe(0);
    expect(await waitForPidExit(ownedPid)).toBe(true);
  });

  it('cleans a verified owned process tree when the TCP listener is a child of the sidecar root process', async () => {
    const tempRoot = makeTempRoot();
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const serverScript = writeFakeTcpServer(tempRoot);
    const processStateDir = path.join(tempRoot, 'processes');

    const startResult = runBash(
      `
        set -euo pipefail
        source scripts/lib/local-runtime-processes.sh
        local_runtime_start_owned_service api "${apiPort}" "${tempRoot}/api.log" bash -lc 'node "${serverScript}" "${apiPort}" & wait'
      `,
      {
        LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
        LOCAL_RUNTIME_RUN_ID: 'child-listener-run',
        LOCAL_RUNTIME_LINE_KIND: 'backend_real',
        LOCAL_RUNTIME_OWNER_TOKEN: 'child-listener-owner-token',
      },
    );
    expect(startResult.status).toBe(0);
    const rootPid = Number.parseInt(startResult.stdout.trim(), 10);

    const cleanupResult = runBash(
      `
        set -euo pipefail
        source scripts/lib/backend-real-gate-ports.sh
        cleanup_gate_ports "${apiPort}" "${webPort}" "e2e/example.spec.ts"
      `,
      {
        LOCAL_RUNTIME_PROCESS_STATE_DIR: processStateDir,
        LOCAL_RUNTIME_OWNER_TOKEN: 'current-run-owner-token',
      },
    );

    expect(cleanupResult.status).toBe(0);
    expect(await waitForPidExit(rootPid)).toBe(true);
  });

  it('reports owned stop failures separately instead of mislabeling them as unowned listeners', () => {
    const result = runBash(
      `
        set -euo pipefail
        source scripts/lib/backend-real-gate-ports.sh
        backend_real_gate_stop_matching_supervisors() { return 0; }
        port_listener_pids() { printf '4321\\n'; }
        local_runtime_verified_owner_pid_for_tree_member() { printf '4100\\n'; }
        local_runtime_stop_owned_process_tree() {
          echo "[test] simulated owned stop failure" >&2
          return 1
        }
        cleanup_gate_ports "20000" "3001" "e2e/example.spec.ts"
      `,
      {
        BACKEND_REAL_GATE_PORTS_ALLOW_UNOWNED_RESCUE: '1',
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('owned listener cleanup failed');
    expect(result.stderr).not.toContain('unowned listener');
    expect(result.stderr).not.toContain('rescue cleanup for unowned listener');
  });

  it('requires an explicit rescue flag before killing unowned listeners', async () => {
    const tempRoot = makeTempRoot();
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const listenerPid = spawnUnownedListener(writeFakeTcpServer(tempRoot), apiPort);

    const result = runBash(
      `
        set -euo pipefail
        source scripts/lib/backend-real-gate-ports.sh
        cleanup_gate_ports "${apiPort}" "${webPort}" "e2e/example.spec.ts"
      `,
      {
        LOCAL_RUNTIME_PROCESS_STATE_DIR: path.join(tempRoot, 'processes'),
        BACKEND_REAL_GATE_PORTS_ALLOW_UNOWNED_RESCUE: '1',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('rescue cleanup for unowned listener');
    expect(await waitForPidExit(listenerPid)).toBe(true);
  });

  it('fails closed and leaves matching legacy supervisors alive unless legacy cleanup is explicitly enabled', async () => {
    const tempRoot = makeTempRoot();
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const supervisorPid = spawnFakeMatchingSupervisor('e2e/example.spec.ts');

    try {
      const result = runBash(
        `
          set -euo pipefail
          source scripts/lib/backend-real-gate-ports.sh
          cleanup_gate_ports "${apiPort}" "${webPort}" "e2e/example.spec.ts"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: path.join(tempRoot, 'processes'),
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('legacy supervisor cleanup disabled');
      expect(isPidAlive(supervisorPid)).toBe(true);
    } finally {
      if (isPidAlive(supervisorPid)) {
        process.kill(supervisorPid, 'SIGKILL');
        await waitForPidExit(supervisorPid);
      }
    }
  });

  it('only kills matching legacy supervisors when the explicit legacy cleanup flag is set', async () => {
    const tempRoot = makeTempRoot();
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const supervisorPid = spawnFakeMatchingSupervisor('e2e/example.spec.ts');

    try {
      const result = runBash(
        `
          set -euo pipefail
          source scripts/lib/backend-real-gate-ports.sh
          cleanup_gate_ports "${apiPort}" "${webPort}" "e2e/example.spec.ts"
        `,
        {
          LOCAL_RUNTIME_PROCESS_STATE_DIR: path.join(tempRoot, 'processes'),
          BACKEND_REAL_GATE_PORTS_ALLOW_LEGACY_SUPERVISOR_CLEANUP: '1',
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('legacy supervisor cleanup');
      expect(await waitForPidExit(supervisorPid)).toBe(true);
    } finally {
      if (isPidAlive(supervisorPid)) {
        process.kill(supervisorPid, 'SIGKILL');
        await waitForPidExit(supervisorPid);
      }
    }
  });
});
