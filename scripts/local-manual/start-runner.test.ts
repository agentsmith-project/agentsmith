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
write_ready_file() {
  printf 'ready\\n' > "$1"
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
bash -lc 'exec -a "make notebook-runner" bash "${level2Script}"' &
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
bash -lc 'exec -a "npm run dev -w @mbos/notebook-codex-runner" bash "${level3Script}"' &
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
cd "${path.join(repoRoot, 'packages/notebook-codex-runner')}"
exec node "${fakeTsxCli}" src/index.ts
`,
    'utf8',
  );
  chmodSync(level3Script, 0o755);

  return { level1Script };
}

function spawnDetachedOwnedRunnerTree(tempRoot: string, rootLabel = 'make notebook-agent-runner'): number {
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

function spawnDetachedSiblingProcess(label = 'make notebook-runner unrelated-sibling'): number {
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
if [[ "$#" -ge 1 && "$1" == "notebook-agent-runner" ]]; then
  bash -lc 'exec -a "make notebook-runner" bash "${level1Script}"' &
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
    expect(readFileSync(fixture.eventsFile, 'utf8')).not.toContain('launch');
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
    expect(events).toContain('launch');
    expect(events).toContain('owner-aware:rollback_launch');
    expect(events).not.toContain('stop-pid:runner');
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
