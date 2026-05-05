import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function setupStartRunnerFixture() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-start-runner-'));
  const scriptsDir = path.join(tempRoot, 'scripts/local-manual');
  const runtimeRoot = path.join(tempRoot, 'artifacts/runtime/lines/local-manual/current');
  const fakeBin = path.join(tempRoot, 'bin');
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  cpSync(
    path.join(process.cwd(), 'scripts/local-manual/start-runner.sh'),
    path.join(scriptsDir, 'start-runner.sh'),
  );

  writeFileSync(
    path.join(scriptsDir, 'common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${tempRoot}"
LOCAL_MANUAL_ROOT="${runtimeRoot}"
RUNNER_PID_FILE="${runtimeRoot}/runner.pid"
RUNNER_READY_FILE="${runtimeRoot}/runner.ready"
RUNNER_LOG="${runtimeRoot}/runner.log"
RUNNER_HEALTH_FILE="${runtimeRoot}/runner.health.json"
RUNNER_HEALTH_MONITOR_PID_FILE="${runtimeRoot}/runner.health-monitor.pid"
RUNNER_OWNER_STATE_FILE="${runtimeRoot}/runner.owner.json"

info() { :; }
err() { echo "$*" >&2; }
init_local_manual_env() {
  mkdir -p "${runtimeRoot}"
}
stop_local_manual_runner_owner_aware() {
  printf 'owner-aware:%s\\n' "\${1:-default}" >> "${tempRoot}/events.log"
  if [[ "\${START_RUNNER_JANITOR_MODE:-stop}" == "block" && "\${1:-default}" == "replace_runner" ]]; then
    return 12
  fi
  if [[ "\${START_RUNNER_JANITOR_MODE:-stop}" == "rollback_block" && "\${1:-default}" == "rollback_launch" ]]; then
    return 12
  fi
  rm -f "${runtimeRoot}/runner.pid" "${runtimeRoot}/runner.ready"
}
stop_pid_file_if_running() {
  printf 'stop-pid:%s\\n' "$2" >> "${tempRoot}/events.log"
  rm -f "$1"
}
launch_detached() {
  printf 'launch\\n' >> "${tempRoot}/events.log"
  printf '%s\\n' "999999" > "$1"
  : > "$2"
}
local_manual_resolve_runner_owner_token() {
  printf 'runner-owner-token\\n'
}
local_runtime_start_owned_service() {
  printf 'owned-launch:%s\\n' "\${LOCAL_RUNTIME_OWNER_TOKEN:-missing}" >> "${tempRoot}/events.log"
  if [[ "\${START_RUNNER_FAIL_PID_FILE_WRITE:-0}" == "1" ]]; then
    ln -snf /dev/full "${runtimeRoot}/runner.pid"
  fi
  if [[ "\${START_RUNNER_REAL_CHILD:-0}" == "1" ]]; then
    local pid
    pid="$(setsid bash -lc 'exec sleep 300' >/dev/null 2>&1 < /dev/null & echo $!)"
    printf '%s\\n' "\${pid}" > "${tempRoot}/launched.pid"
    printf '%s\\n' "\${pid}"
    return 0
  fi
  printf '%s\\n' "999999"
}
local_runtime_stop_owned_process_tree() {
  printf 'stop-owned-tree:%s:%s:%s\\n' "$1" "$2" "$3" >> "${tempRoot}/events.log"
  kill "$1" >/dev/null 2>&1 || true
  sleep 0.1
  kill -9 "$1" >/dev/null 2>&1 || true
  return 0
}
local_manual_write_runner_owner_state() {
  if [[ "\${START_RUNNER_FAIL_OWNER_STATE_WRITE:-0}" == "1" ]]; then
    printf '{\\"partial\\":true}\\n' > "$1"
    return 1
  fi
  node - <<'NODE' "$1" "$2" "$3"
const fs = require('node:fs');
const [file, pidRaw, ownerToken] = process.argv.slice(2);
const payload = {
  schema_version: 1,
  pid: Number.parseInt(pidRaw, 10),
  owner_token: ownerToken,
  recorded_at: new Date().toISOString(),
  captured_by: 'start-runner.test',
};
fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\\n');
NODE
}
write_ready_file() {
  printf 'ready\\n' > "$1"
}
start_runner_health_monitor() {
  printf 'health-monitor\\n' >> "${tempRoot}/events.log"
}
runner_socket_health_state() {
  if [[ "\${START_RUNNER_HEALTH_CONNECTED:-0}" == "1" ]]; then
    printf 'connected\\n'
  else
    printf '%s\\n' "\${START_RUNNER_HEALTH_STATE:-disconnected}"
  fi
}
runner_socket_is_connected() {
  [[ "$(runner_socket_health_state)" == "connected" ]]
}
`,
    'utf8',
  );

  writeFileSync(
    path.join(fakeBin, 'date'),
    `#!/usr/bin/env bash
set -euo pipefail
counter_file="${tempRoot}/date-counter"
if [[ "\${START_RUNNER_FAST_TIMEOUT:-0}" == "1" && "\${1:-}" == "+%s" ]]; then
  counter="$(cat "\${counter_file}" 2>/dev/null || printf '0')"
  if [[ "\${counter}" == "0" ]]; then
    printf '0\\n'
  else
    printf '120\\n'
  fi
  printf '%s\\n' "$((counter + 1))" > "\${counter_file}"
  exit 0
fi
exec /bin/date "$@"
`,
    { mode: 0o755 },
  );

  return {
    tempRoot,
    fakeBin,
    runnerPidFile: path.join(runtimeRoot, 'runner.pid'),
    runnerReadyFile: path.join(runtimeRoot, 'runner.ready'),
    runnerOwnerStateFile: path.join(runtimeRoot, 'runner.owner.json'),
    launchedPidFile: path.join(tempRoot, 'launched.pid'),
    eventsFile: path.join(tempRoot, 'events.log'),
    script: path.join(scriptsDir, 'start-runner.sh'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await sleep(100);
  }
  return !isPidAlive(pid);
}

function killProcessTreeGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Ignore cleanup failures.
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Ignore cleanup failures.
  }
}

function readLaunchedPid(file: string): number {
  return Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
}

function errorStderr(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    return Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? '');
  }
  return '';
}

function writeOwnedRunnerTreeScripts(tempRoot: string) {
  const level1Script = path.join(tempRoot, 'runner-level-1.sh');
  const level2Script = path.join(tempRoot, 'runner-level-2.sh');
  const level3Script = path.join(tempRoot, 'runner-level-3.sh');
  const fakeTsxCli = path.join(tempRoot, 'node_modules/tsx/dist/cli.mjs');
  mkdirSync(path.dirname(fakeTsxCli), { recursive: true });
  writeFileSync(
    fakeTsxCli,
    'setInterval(() => {}, 1000);\\n',
    'utf8',
  );

  writeFileSync(
    level1Script,
    `#!/usr/bin/env bash
set -euo pipefail
bash -lc 'exec -a "make agent-task-runner" bash "${level2Script}"' &
child=$!
wait "$child"
`,
    'utf8',
  );
  chmodSync(level1Script, 0o755);

  writeFileSync(
    level2Script,
    `#!/usr/bin/env bash
set -euo pipefail
bash -lc 'exec -a "npm run dev -w @mbos/agent-task-runner" bash "${level3Script}"' &
child=$!
wait "$child"
`,
    'utf8',
  );
  chmodSync(level2Script, 0o755);

  writeFileSync(
    level3Script,
    `#!/usr/bin/env bash
set -euo pipefail
exec -a "agentsmith-agent-task-runner runner_instance_id=local-manual-test" node "${fakeTsxCli}" src/index.ts
`,
    'utf8',
  );
  chmodSync(level3Script, 0o755);

  return { level1Script };
}

function spawnDetachedOwnedRunnerTree(tempRoot: string, rootLabel = 'make agent-task-runner-from-state'): number {
  const { level1Script } = writeOwnedRunnerTreeScripts(tempRoot);
  const launcherScript = path.join(tempRoot, 'runner-launcher.sh');
  writeFileSync(
    launcherScript,
    `#!/usr/bin/env bash
set -euo pipefail
exec -a "${rootLabel}" bash "${level1Script}"
`,
    'utf8',
  );
  chmodSync(launcherScript, 0o755);

  const pid = Number.parseInt(
    execFileSync(
      'bash',
      ['-lc', `setsid bash "${launcherScript}" >/dev/null 2>&1 < /dev/null & echo $!`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    ).trim(),
    10,
  );
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error('failed to spawn owned runner tree');
  }
  return pid;
}

function spawnDetachedSiblingProcess(label = 'make agent-task-runner unrelated-sibling'): number {
  const siblingScript = path.join(os.tmpdir(), `local-manual-sibling-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`);
  writeFileSync(
    siblingScript,
    `#!/usr/bin/env bash
set -euo pipefail
exec -a "${label}" sleep 300
`,
    'utf8',
  );
  chmodSync(siblingScript, 0o755);

  const pid = Number.parseInt(
    execFileSync(
      'bash',
      ['-lc', `setsid bash "${siblingScript}" >/dev/null 2>&1 < /dev/null & echo $!`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    ).trim(),
    10,
  );
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error('failed to spawn sibling process');
  }
  return pid;
}

function setupRealOwnerAwareFixture() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-start-runner-real-'));
  const fakeBin = path.join(tempRoot, 'bin');
  const backendRealRoot = path.join(tempRoot, 'artifacts/backend-real/current');
  const runtimeLinesRoot = path.join(tempRoot, 'artifacts/runtime/lines');
  const envFile = path.join(tempRoot, '.env.local-manual');
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(backendRealRoot, { recursive: true });
  mkdirSync(runtimeLinesRoot, { recursive: true });
  writeFileSync(envFile, '\n', 'utf8');

  writeFileSync(
    path.join(fakeBin, 'date'),
    `#!/usr/bin/env bash
set -euo pipefail
counter_file="${tempRoot}/date-counter"
if [[ "\${START_RUNNER_FAST_TIMEOUT:-0}" == "1" && "\${1:-}" == "+%s" ]]; then
  counter="$(cat "\${counter_file}" 2>/dev/null || printf '0')"
  if [[ "\${counter}" == "0" ]]; then
    printf '0\\n'
  else
    printf '120\\n'
  fi
  printf '%s\\n' "$((counter + 1))" > "\${counter_file}"
  exit 0
fi
exec /bin/date "$@"
`,
    { mode: 0o755 },
  );

  const { level1Script } = writeOwnedRunnerTreeScripts(tempRoot);
  writeFileSync(
    path.join(fakeBin, 'make'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -ge 1 && "$1" == "agent-task-runner-from-state" ]]; then
  bash -lc 'exec -a "make agent-task-runner" bash "${level1Script}"' &
  child=$!
  wait "$child"
  exit 0
fi
printf 'unsupported fake make invocation: %s\\n' "$*" >&2
exit 1
`,
    { mode: 0o755 },
  );

  return {
    tempRoot,
    fakeBin,
    envFile,
    backendRealRoot,
    runtimeLinesRoot,
    runnerPidFile: path.join(runtimeLinesRoot, 'local-manual/current/runner.pid'),
    runnerReadyFile: path.join(runtimeLinesRoot, 'local-manual/current/runner.ready'),
  };
}

describe('local-manual start-runner', () => {
  const tempRoots: string[] = [];
  const trackedPids: number[] = [];

  afterEach(() => {
    while (trackedPids.length > 0) {
      const pid = trackedPids.pop();
      if (pid !== undefined) {
        killProcessTreeGroup(pid);
      }
    }
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('blocks restart without deleting tracked state or launching a replacement runner', () => {
    const fixture = setupStartRunnerFixture();
    tempRoots.push(fixture.tempRoot);

    writeFileSync(fixture.runnerPidFile, '4100\n', 'utf8');
    writeFileSync(fixture.runnerReadyFile, 'ready\n', 'utf8');

    let error: unknown;
    try {
      execFileSync('bash', [fixture.script], {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          START_RUNNER_JANITOR_MODE: 'block',
          PATH: `${fixture.fakeBin}:${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(readFileSync(fixture.runnerPidFile, 'utf8')).toBe('4100\n');
    expect(readFileSync(fixture.runnerReadyFile, 'utf8')).toBe('ready\n');
    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('owner-aware:replace_runner');
    expect(readFileSync(fixture.eventsFile, 'utf8')).not.toContain('owned-launch:');
  });

  it('uses owner-aware rollback cleanup instead of generic pid-file stop after post-launch failure', () => {
    const fixture = setupStartRunnerFixture();
    tempRoots.push(fixture.tempRoot);

    let error: unknown;
    try {
      execFileSync('bash', [fixture.script], {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          PATH: `${fixture.fakeBin}:${process.env.PATH ?? ''}`,
          START_RUNNER_FAST_TIMEOUT: '1',
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    const events = readFileSync(fixture.eventsFile, 'utf8');
    expect(events).toContain('owned-launch:runner-owner-token');
    expect(events).toContain('owner-aware:rollback_launch');
    expect(events).not.toContain('stop-pid:runner');
  });

  it('kills an uncommitted launched runner and clears tracking files when runner.pid cannot be written', async () => {
    const fixture = setupStartRunnerFixture();
    tempRoots.push(fixture.tempRoot);

    let error: unknown;
    try {
      execFileSync('bash', [fixture.script], {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          PATH: `${fixture.fakeBin}:${process.env.PATH ?? ''}`,
          START_RUNNER_REAL_CHILD: '1',
          START_RUNNER_FAIL_PID_FILE_WRITE: '1',
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    const launchedPid = readLaunchedPid(fixture.launchedPidFile);
    expect(await waitForPidExit(launchedPid)).toBe(true);
    const events = readFileSync(fixture.eventsFile, 'utf8');
    expect(events).toContain('owned-launch:runner-owner-token');
    expect(events).toContain(`stop-owned-tree:${launchedPid}:runner:0`);
    expect(events).not.toContain('owner-aware:rollback_launch');
    expect(existsSync(fixture.runnerPidFile)).toBe(false);
    expect(existsSync(fixture.runnerOwnerStateFile)).toBe(false);
    expect(existsSync(fixture.runnerReadyFile)).toBe(false);
  });

  it('kills an uncommitted launched runner and clears partial tracking files when runner owner state write fails', async () => {
    const fixture = setupStartRunnerFixture();
    tempRoots.push(fixture.tempRoot);

    let error: unknown;
    try {
      execFileSync('bash', [fixture.script], {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          PATH: `${fixture.fakeBin}:${process.env.PATH ?? ''}`,
          START_RUNNER_REAL_CHILD: '1',
          START_RUNNER_FAIL_OWNER_STATE_WRITE: '1',
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    const launchedPid = readLaunchedPid(fixture.launchedPidFile);
    expect(await waitForPidExit(launchedPid)).toBe(true);
    const events = readFileSync(fixture.eventsFile, 'utf8');
    expect(events).toContain('owned-launch:runner-owner-token');
    expect(events).toContain(`stop-owned-tree:${launchedPid}:runner:0`);
    expect(events).not.toContain('owner-aware:rollback_launch');
    expect(existsSync(fixture.runnerPidFile)).toBe(false);
    expect(existsSync(fixture.runnerOwnerStateFile)).toBe(false);
    expect(existsSync(fixture.runnerReadyFile)).toBe(false);
  });

  it('preserves runner tracking state when post-launch rollback is blocked by owner resolution', () => {
    const fixture = setupStartRunnerFixture();
    tempRoots.push(fixture.tempRoot);

    let error: unknown;
    try {
      execFileSync('bash', [fixture.script], {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          PATH: `${fixture.fakeBin}:${process.env.PATH ?? ''}`,
          START_RUNNER_FAST_TIMEOUT: '1',
          START_RUNNER_JANITOR_MODE: 'rollback_block',
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(readFileSync(fixture.runnerPidFile, 'utf8')).toBe('999999\n');
    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('owner-aware:rollback_launch');
    expect(readFileSync(fixture.eventsFile, 'utf8')).not.toContain('stop-pid:runner');
  });

  it('waits for the runner health freshness contract instead of accepting stale log text', () => {
    const fixture = setupStartRunnerFixture();
    tempRoots.push(fixture.tempRoot);

    execFileSync('bash', [fixture.script], {
      cwd: fixture.tempRoot,
      env: {
        ...process.env,
        PATH: `${fixture.fakeBin}:${process.env.PATH ?? ''}`,
        START_RUNNER_FAST_TIMEOUT: '1',
        START_RUNNER_HEALTH_CONNECTED: '1',
      },
      stdio: 'pipe',
    });

    const events = readFileSync(fixture.eventsFile, 'utf8');
    expect(events).toContain('owned-launch:runner-owner-token');
    expect(events).toContain('health-monitor');
    expect(readFileSync(fixture.runnerReadyFile, 'utf8')).toBe('ready\n');
    const ownerState = JSON.parse(readFileSync(fixture.runnerOwnerStateFile, 'utf8')) as {
      pid: number;
      owner_token: string;
    };
    expect(ownerState.pid).toBe(999999);
    expect(ownerState.owner_token).toBe('runner-owner-token');
  });

  it('fails fast and rolls back when the launched runner enters shutting_down before becoming connected', () => {
    const fixture = setupStartRunnerFixture();
    tempRoots.push(fixture.tempRoot);

    let error: unknown;
    try {
      execFileSync('bash', [fixture.script], {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          PATH: `${fixture.fakeBin}:${process.env.PATH ?? ''}`,
          START_RUNNER_FAST_TIMEOUT: '1',
          START_RUNNER_HEALTH_STATE: 'shutting_down',
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(errorStderr(error)).toContain('runner entered shutting_down before it became connected');
    const events = readFileSync(fixture.eventsFile, 'utf8');
    expect(events).toContain('owned-launch:runner-owner-token');
    expect(events).toContain('owner-aware:rollback_launch');
    expect(existsSync(fixture.runnerReadyFile)).toBe(false);
  });

  it('uses the real common + owner-janitor path to replace and roll back only the owned runner tree without killing an unrelated sibling', async () => {
    const fixture = setupRealOwnerAwareFixture();
    tempRoots.push(fixture.tempRoot);

    const oldRunnerRootPid = spawnDetachedOwnedRunnerTree(fixture.tempRoot);
    const siblingPid = spawnDetachedSiblingProcess();
    trackedPids.push(oldRunnerRootPid, siblingPid);

    await sleep(300);
    mkdirSync(path.dirname(fixture.runnerPidFile), { recursive: true });
    writeFileSync(fixture.runnerPidFile, `${oldRunnerRootPid}\n`, 'utf8');
    writeFileSync(fixture.runnerReadyFile, 'ready\n', 'utf8');

    let error: unknown;
    try {
      execFileSync('bash', [path.join(repoRoot, 'scripts/local-manual/start-runner.sh')], {
        cwd: repoRoot,
        env: {
          ...process.env,
          ENV_FILE: fixture.envFile,
          BACKEND_REAL_STATE_DIR: fixture.backendRealRoot,
          RUNTIME_LINES_ROOT: fixture.runtimeLinesRoot,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          START_RUNNER_FAST_TIMEOUT: '1',
          PATH: `${fixture.fakeBin}:${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(await waitForPidExit(oldRunnerRootPid)).toBe(true);
    expect(isPidAlive(siblingPid)).toBe(true);
    expect(existsSync(fixture.runnerPidFile)).toBe(false);
    expect(existsSync(fixture.runnerReadyFile)).toBe(false);
  }, 20_000);
});
