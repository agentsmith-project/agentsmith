import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type RunnerHealthFixtureArgs = {
  logContent: string;
  pidValue: number;
  readyFileContent?: string;
  healthContent?: string;
  maxAgeSeconds?: number;
};

function writeRunnerOwnerState(file: string, pid: number, ownerToken: string): void {
  writeFileSync(file, `${JSON.stringify({
    schema_version: 1,
    pid,
    owner_token: ownerToken,
    recorded_at: new Date().toISOString(),
    captured_by: 'runner-health.test',
  }, null, 2)}\n`, 'utf8');
}

function withOwnedRunnerAuthority<T>(
  args: {
    logContent: string;
    healthState: 'connected' | 'shutting_down' | 'disconnected';
    readyFileContent?: string;
    snippet: (fixture: {
      repoRoot: string;
      tempRoot: string;
      backendRealRoot: string;
      logFile: string;
      pidFile: string;
      readyFile: string;
      healthFile: string;
      ownerStateFile: string;
      ownerToken: string;
      processStateDir: string;
      pid: number;
    }) => string;
  },
): T {
  const repoRoot = process.cwd();
  return withRunnerHealthFixture({
    logContent: args.logContent,
    pidValue: process.pid,
  }, ({ tempRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile, ownerStateFile }) => {
    const child = spawn('bash', ['-lc', 'sleep 120'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    if (!child.pid) {
      throw new Error('failed to create a live runner pid for authority-backed runner test');
    }

    const ownerToken = 'runner-health-test-owner';
    const processStateDir = path.join(tempRoot, 'local-runtime-processes');

    try {
      writeFileSync(pidFile, `${child.pid}\n`, 'utf8');
      writeFileSync(readyFile, `${args.readyFileContent ?? 'ready'}\n`, 'utf8');
      writeFileSync(healthFile, runnerHealthArtifact(args.healthState, child.pid), 'utf8');
      writeRunnerOwnerState(ownerStateFile, child.pid, ownerToken);

      execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            export ROOT_DIR="${repoRoot}"
            export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
            export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
            export LOCAL_RUNTIME_OWNER_TOKEN="${ownerToken}"
            source "${repoRoot}/scripts/local-manual/common.sh"
            source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
            local_runtime_write_process_sidecar runner "${child.pid}" "0" "sleep 120"
          `,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      return execFileSync(
        'bash',
        [
          '-lc',
          args.snippet({
            repoRoot,
            tempRoot,
            backendRealRoot,
            logFile,
            pidFile,
            readyFile,
            healthFile,
            ownerStateFile,
            ownerToken,
            processStateDir,
            pid: child.pid,
          }),
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      ).trim() as T;
    } finally {
      child.kill('SIGKILL');
    }
  });
}

function withRunnerHealthFixture<T>(
  args: RunnerHealthFixtureArgs,
  callback: (fixture: {
    tempRoot: string;
    backendRealRoot: string;
    logFile: string;
    pidFile: string;
    readyFile: string;
    healthFile: string;
    ownerStateFile: string;
  }) => T,
): T {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-runner-health-'));
  const backendRealRoot = path.join(tempRoot, 'backend-real', 'current');
  const logFile = path.join(tempRoot, 'runner.log');
  const pidFile = path.join(tempRoot, 'runner.pid');
  const readyFile = path.join(tempRoot, 'runner.ready');
  const healthFile = path.join(tempRoot, 'runner.health.json');
  const ownerStateFile = path.join(tempRoot, 'runner.owner.json');

  try {
    mkdirSync(backendRealRoot, { recursive: true });
    writeFileSync(logFile, args.logContent, 'utf8');
    writeFileSync(pidFile, `${args.pidValue}\n`, 'utf8');
    writeFileSync(readyFile, `${args.readyFileContent ?? 'ready'}\n`, 'utf8');
    if (args.healthContent !== undefined) {
      writeFileSync(healthFile, args.healthContent, 'utf8');
    }

    return callback({ tempRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile, ownerStateFile });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runCommonSnippet(args: RunnerHealthFixtureArgs, snippet: string): string {
  const repoRoot = process.cwd();
  return withRunnerHealthFixture(args, ({ backendRealRoot, logFile, pidFile, readyFile, healthFile, ownerStateFile }) => (
    execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          export ROOT_DIR="${repoRoot}"
          export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
          source "${repoRoot}/scripts/local-manual/common.sh"
          RUNNER_LOG="${logFile}"
          RUNNER_PID_FILE="${pidFile}"
          RUNNER_READY_FILE="${readyFile}"
          RUNNER_HEALTH_FILE="${healthFile}"
          RUNNER_OWNER_STATE_FILE="${ownerStateFile}"
          LOCAL_MANUAL_RUNNER_HEALTH_MAX_AGE_SEC="${args.maxAgeSeconds ?? 60}"
          ${snippet}
        `,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    ).trim()
  ));
}

function runRunnerHealthState(args: RunnerHealthFixtureArgs): string {
  return runCommonSnippet(args, 'runner_socket_health_state');
}

function runnerHealthArtifact(state: 'connected' | 'shutting_down' | 'disconnected' | 'stale', pid = process.pid) {
  return JSON.stringify({
    schema_version: 2,
    contract: 'agent-task-runner.lifecycle.v1',
    state,
    pid,
    observed_at: new Date().toISOString(),
    source: 'local_manual_runner_health_monitor',
    reason: `${state}_test`,
  });
}

describe('local-manual runner health', () => {
  it.each(['connected', 'shutting_down'] as const)(
    'degrades %s when the runner pid is alive but owner/process identity no longer matches',
    (artifactState) => {
      const repoRoot = process.cwd();

      withRunnerHealthFixture({
        logContent: '',
        pidValue: process.pid,
        healthContent: runnerHealthArtifact(artifactState),
      }, ({ tempRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile }) => {
        const child = spawn('bash', ['-lc', 'sleep 120'], {
          cwd: repoRoot,
          stdio: 'ignore',
        });

        if (!child.pid) {
          throw new Error('failed to create a live runner pid for owner mismatch test');
        }

        const processStateDir = path.join(tempRoot, 'local-runtime-processes');

        try {
          writeFileSync(pidFile, `${child.pid}\n`, 'utf8');
          writeFileSync(healthFile, runnerHealthArtifact(artifactState, child.pid), 'utf8');

          const sidecarFile = execFileSync(
            'bash',
            [
              '-lc',
              `
                set -euo pipefail
                export ROOT_DIR="${repoRoot}"
                export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
                export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
                export LOCAL_RUNTIME_OWNER_TOKEN="runner-health-test-owner"
                source "${repoRoot}/scripts/local-manual/common.sh"
                source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
                local_runtime_write_process_sidecar runner "${child.pid}" "0" "sleep 120"
                local_runtime_sidecar_file_for runner "${child.pid}" "0"
              `,
            ],
            {
              cwd: repoRoot,
              env: { ...process.env },
              encoding: 'utf8',
              stdio: 'pipe',
            },
          ).trim();

          const sidecarPayload = JSON.parse(readFileSync(sidecarFile, 'utf8')) as {
            process_identity: { token: string };
          };
          sidecarPayload.process_identity.token = 'mismatched-owner-identity-token';
          writeFileSync(sidecarFile, `${JSON.stringify(sidecarPayload, null, 2)}\n`, 'utf8');

          const state = execFileSync(
            'bash',
            [
              '-lc',
              `
                set -euo pipefail
                export ROOT_DIR="${repoRoot}"
                export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
                export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
                export LOCAL_RUNTIME_OWNER_TOKEN="runner-health-test-owner"
                source "${repoRoot}/scripts/local-manual/common.sh"
                source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
                if local_runtime_verify_owned_process "${child.pid}" runner "0" >/dev/null 2>&1; then
                  echo "owner verification unexpectedly succeeded for mismatched runner pid" >&2
                  exit 99
                fi
                RUNNER_LOG="${logFile}"
                RUNNER_PID_FILE="${pidFile}"
                RUNNER_READY_FILE="${readyFile}"
                RUNNER_HEALTH_FILE="${healthFile}"
                runner_socket_health_state
              `,
            ],
            {
              cwd: repoRoot,
              env: { ...process.env },
              encoding: 'utf8',
              stdio: 'pipe',
            },
          ).trim();

          expect(['stale', 'disconnected']).toContain(state);
        } finally {
          child.kill('SIGKILL');
        }
      });
    },
  );

  it.each(['connected', 'shutting_down'] as const)(
    'degrades %s when the runner pid is alive but the sidecar is missing and stale online artifacts remain',
    (artifactState) => {
      const repoRoot = process.cwd();

      withRunnerHealthFixture({
        logContent: '[agent-task-runner] runner_state=connected reason=websocket_open\n',
        pidValue: process.pid,
        readyFileContent: 'ready',
        healthContent: runnerHealthArtifact(artifactState),
      }, ({ tempRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile }) => {
        const child = spawn('bash', ['-lc', 'sleep 120'], {
          cwd: repoRoot,
          stdio: 'ignore',
        });

        if (!child.pid) {
          throw new Error('failed to create a live runner pid for missing sidecar test');
        }

        const processStateDir = path.join(tempRoot, 'local-runtime-processes');

        try {
          mkdirSync(processStateDir, { recursive: true });
          writeFileSync(pidFile, `${child.pid}\n`, 'utf8');
          writeFileSync(healthFile, runnerHealthArtifact(artifactState, child.pid), 'utf8');

          const state = execFileSync(
            'bash',
            [
              '-lc',
              `
                set -euo pipefail
                export ROOT_DIR="${repoRoot}"
                export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
                export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
                export LOCAL_RUNTIME_OWNER_TOKEN="runner-health-test-owner"
                source "${repoRoot}/scripts/local-manual/common.sh"
                source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
                RUNNER_LOG="${logFile}"
                RUNNER_PID_FILE="${pidFile}"
                RUNNER_READY_FILE="${readyFile}"
                RUNNER_HEALTH_FILE="${healthFile}"
                runner_socket_health_state
              `,
            ],
            {
              cwd: repoRoot,
              env: { ...process.env },
              encoding: 'utf8',
              stdio: 'pipe',
            },
          ).trim();

          expect(['stale', 'disconnected']).toContain(state);
        } finally {
          child.kill('SIGKILL');
        }
      });
    },
  );

  it('writes a stale health artifact when the runner pid is alive but the sidecar is missing', () => {
    const repoRoot = process.cwd();

    withRunnerHealthFixture({
      logContent: '[agent-task-runner] runner_state=connected reason=websocket_open\n',
      pidValue: process.pid,
      readyFileContent: 'ready',
    }, ({ tempRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile }) => {
      const child = spawn('bash', ['-lc', 'sleep 120'], {
        cwd: repoRoot,
        stdio: 'ignore',
      });

      if (!child.pid) {
        throw new Error('failed to create a live runner pid for missing sidecar monitor test');
      }

      const processStateDir = path.join(tempRoot, 'local-runtime-processes');

      try {
        mkdirSync(processStateDir, { recursive: true });
        writeFileSync(pidFile, `${child.pid}\n`, 'utf8');

        const output = execFileSync(
          'bash',
          [
            '-lc',
            `
              set -euo pipefail
              export ROOT_DIR="${repoRoot}"
              export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
              export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
              export LOCAL_RUNTIME_OWNER_TOKEN="runner-health-test-owner"
              source "${repoRoot}/scripts/local-manual/common.sh"
              source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
              RUNNER_LOG="${logFile}"
              RUNNER_PID_FILE="${pidFile}"
              RUNNER_READY_FILE="${readyFile}"
              RUNNER_HEALTH_FILE="${healthFile}"
              local_manual_runner_health_monitor_once || true
              node - <<'NODE' "\${RUNNER_HEALTH_FILE}"
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write([payload.state, payload.reason].join(':'));
NODE
            `,
          ],
          {
            cwd: repoRoot,
            env: { ...process.env },
            encoding: 'utf8',
            stdio: 'pipe',
          },
        ).trim();

        expect(output).toBe('stale:runner_sidecar_missing');
      } finally {
        child.kill('SIGKILL');
      }
    });
  });

  it('fails closed when a live runner has a fresh health artifact but no owner token can be resolved', () => {
    const repoRoot = process.cwd();

    withRunnerHealthFixture({
      logContent: '',
      pidValue: process.pid,
      healthContent: runnerHealthArtifact('connected'),
    }, ({ tempRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile, ownerStateFile }) => {
      const child = spawn('bash', ['-lc', 'sleep 120'], {
        cwd: repoRoot,
        stdio: 'ignore',
      });

      if (!child.pid) {
        throw new Error('failed to create a live runner pid for missing owner token test');
      }

      const processStateDir = path.join(tempRoot, 'local-runtime-processes');

      try {
        writeFileSync(pidFile, `${child.pid}\n`, 'utf8');
        writeFileSync(healthFile, runnerHealthArtifact('connected', child.pid), 'utf8');

        execFileSync(
          'bash',
          [
            '-lc',
            `
              set -euo pipefail
              export ROOT_DIR="${repoRoot}"
              export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
              export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
              export LOCAL_RUNTIME_OWNER_TOKEN="runner-health-test-owner"
              source "${repoRoot}/scripts/local-manual/common.sh"
              source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
              local_runtime_write_process_sidecar runner "${child.pid}" "0" "sleep 120"
            `,
          ],
          {
            cwd: repoRoot,
            env: { ...process.env },
            encoding: 'utf8',
            stdio: 'pipe',
          },
        );

        const state = execFileSync(
          'bash',
          [
            '-lc',
            `
              set -euo pipefail
              export ROOT_DIR="${repoRoot}"
              export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
              export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
              source "${repoRoot}/scripts/local-manual/common.sh"
              source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
              RUNNER_LOG="${logFile}"
              RUNNER_PID_FILE="${pidFile}"
              RUNNER_READY_FILE="${readyFile}"
              RUNNER_HEALTH_FILE="${healthFile}"
              RUNNER_OWNER_STATE_FILE="${ownerStateFile}"
              runner_socket_health_state
            `,
          ],
          {
            cwd: repoRoot,
            env: { ...process.env },
            encoding: 'utf8',
            stdio: 'pipe',
          },
        ).trim();

        expect(state).toBe('stale');
      } finally {
        child.kill('SIGKILL');
      }
    });
  });

  it('accepts a live runner from persisted owner state even when no owner token is exported in the current shell', () => {
    const repoRoot = process.cwd();

    withRunnerHealthFixture({
      logContent: '',
      pidValue: process.pid,
      healthContent: runnerHealthArtifact('connected'),
    }, ({ tempRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile, ownerStateFile }) => {
      const child = spawn('bash', ['-lc', 'sleep 120'], {
        cwd: repoRoot,
        stdio: 'ignore',
      });

      if (!child.pid) {
        throw new Error('failed to create a live runner pid for persisted owner state test');
      }

      const processStateDir = path.join(tempRoot, 'local-runtime-processes');

      try {
        writeFileSync(pidFile, `${child.pid}\n`, 'utf8');
        writeFileSync(healthFile, runnerHealthArtifact('connected', child.pid), 'utf8');
        writeFileSync(ownerStateFile, `${JSON.stringify({
          schema_version: 1,
          pid: child.pid,
          owner_token: 'runner-health-test-owner',
          recorded_at: new Date().toISOString(),
          captured_by: 'runner-health.test',
        }, null, 2)}\n`, 'utf8');

        execFileSync(
          'bash',
          [
            '-lc',
            `
              set -euo pipefail
              export ROOT_DIR="${repoRoot}"
              export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
              export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
              export LOCAL_RUNTIME_OWNER_TOKEN="runner-health-test-owner"
              source "${repoRoot}/scripts/local-manual/common.sh"
              source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
              local_runtime_write_process_sidecar runner "${child.pid}" "0" "sleep 120"
            `,
          ],
          {
            cwd: repoRoot,
            env: { ...process.env },
            encoding: 'utf8',
            stdio: 'pipe',
          },
        );

        const state = execFileSync(
          'bash',
          [
            '-lc',
            `
              set -euo pipefail
              export ROOT_DIR="${repoRoot}"
              export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
              export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
              source "${repoRoot}/scripts/local-manual/common.sh"
              source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
              RUNNER_LOG="${logFile}"
              RUNNER_PID_FILE="${pidFile}"
              RUNNER_READY_FILE="${readyFile}"
              RUNNER_HEALTH_FILE="${healthFile}"
              RUNNER_OWNER_STATE_FILE="${ownerStateFile}"
              runner_socket_health_state
            `,
          ],
          {
            cwd: repoRoot,
            env: { ...process.env },
            encoding: 'utf8',
            stdio: 'pipe',
          },
        ).trim();

        expect(state).toBe('connected');
      } finally {
        child.kill('SIGKILL');
      }
    });
  });

  it('reports connected from a fresh runner health artifact even when logs are empty', () => {
    const state = withOwnedRunnerAuthority<string>({
      logContent: '',
      healthState: 'connected',
      snippet: ({ repoRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile, ownerStateFile, processStateDir }) => `
        set -euo pipefail
        export ROOT_DIR="${repoRoot}"
        export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
        export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
        source "${repoRoot}/scripts/local-manual/common.sh"
        source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
        RUNNER_LOG="${logFile}"
        RUNNER_PID_FILE="${pidFile}"
        RUNNER_READY_FILE="${readyFile}"
        RUNNER_HEALTH_FILE="${healthFile}"
        RUNNER_OWNER_STATE_FILE="${ownerStateFile}"
        runner_socket_health_state
      `,
    });

    expect(state).toBe('connected');
  });

  it('reports shutting_down from a fresh runner health artifact instead of collapsing it to connected or disconnected', () => {
    const state = withOwnedRunnerAuthority<string>({
      logContent: '[agent-task-runner] runner_state=connected reason=websocket_open\n',
      healthState: 'shutting_down',
      snippet: ({ repoRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile, ownerStateFile, processStateDir }) => `
        set -euo pipefail
        export ROOT_DIR="${repoRoot}"
        export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
        export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
        source "${repoRoot}/scripts/local-manual/common.sh"
        source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
        RUNNER_LOG="${logFile}"
        RUNNER_PID_FILE="${pidFile}"
        RUNNER_READY_FILE="${readyFile}"
        RUNNER_HEALTH_FILE="${healthFile}"
        RUNNER_OWNER_STATE_FILE="${ownerStateFile}"
        runner_socket_health_state
      `,
    });

    expect(state).toBe('shutting_down');
  });

  it('rejects an old connected log when no fresh health artifact exists', () => {
    const state = runRunnerHealthState({
      logContent: '[agent-task-runner] connected\n',
      pidValue: process.pid,
      readyFileContent: 'ready',
    });

    expect(state).toBe('stale');
  });

  it('reports disconnected when the fresh health artifact says the socket is disconnected', () => {
    const state = withOwnedRunnerAuthority<string>({
      logContent: '[agent-task-runner] connected\n[agent-task-runner] disconnected\n',
      healthState: 'disconnected',
      snippet: ({ repoRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile, ownerStateFile, processStateDir }) => `
        set -euo pipefail
        export ROOT_DIR="${repoRoot}"
        export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
        export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
        source "${repoRoot}/scripts/local-manual/common.sh"
        source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
        RUNNER_LOG="${logFile}"
        RUNNER_PID_FILE="${pidFile}"
        RUNNER_READY_FILE="${readyFile}"
        RUNNER_HEALTH_FILE="${healthFile}"
        RUNNER_OWNER_STATE_FILE="${ownerStateFile}"
        runner_socket_health_state
      `,
    });

    expect(state).toBe('disconnected');
  });

  it('reports disconnected when a connected health artifact is stale', () => {
    const state = runRunnerHealthState({
      logContent: '',
      pidValue: process.pid,
      readyFileContent: 'ready',
      maxAgeSeconds: 1,
      healthContent: JSON.stringify({
        schema_version: 2,
        contract: 'agent-task-runner.lifecycle.v1',
        state: 'connected',
        pid: process.pid,
        observed_at: new Date(Date.now() - 60_000).toISOString(),
        source: 'local_manual_runner_health_monitor',
      }),
    });

    expect(state).toBe('stale');
  });

  it('reports disconnected when the runner pid is gone even if an old connected log remains', () => {
    const state = runRunnerHealthState({
      logContent: '[agent-task-runner] connected\n',
      pidValue: 99999999,
      readyFileContent: 'ready',
      healthContent: runnerHealthArtifact('connected', 99999999),
    });

    expect(state).toBe('disconnected');
  });

  it('treats connected followed by shutting_down as shutting_down in the latest lifecycle log transition', () => {
    const state = runCommonSnippet({
      logContent: [
        '[agent-task-runner] runner_state=connected reason=websocket_open',
        '[agent-task-runner] shutting down (websocket_close)',
      ].join('\n'),
      pidValue: process.pid,
    }, 'local_manual_runner_latest_socket_log_state');

    expect(state).toBe('shutting_down');
  });

  it('writes a v2 shutting_down health artifact from a single monitor observation', () => {
    const output = withOwnedRunnerAuthority<string>({
      logContent: [
        '[agent-task-runner] runner_state=connected reason=websocket_open',
        '[agent-task-runner] runner_state=shutting_down reason=websocket_close',
      ].join('\n'),
      healthState: 'connected',
      snippet: ({ repoRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile, ownerStateFile, processStateDir }) => `
        set -euo pipefail
        export ROOT_DIR="${repoRoot}"
        export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
        export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
        source "${repoRoot}/scripts/local-manual/common.sh"
        source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
        RUNNER_LOG="${logFile}"
        RUNNER_PID_FILE="${pidFile}"
        RUNNER_READY_FILE="${readyFile}"
        RUNNER_HEALTH_FILE="${healthFile}"
        RUNNER_OWNER_STATE_FILE="${ownerStateFile}"
        local_manual_runner_health_monitor_once || true
        node - <<'NODE' "\${RUNNER_HEALTH_FILE}"
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write([payload.schema_version, payload.state, payload.reason].join(':'));
NODE
      `,
    });

    expect(output).toBe('2:shutting_down:websocket_close');
  });

  it('restarts the local runner for a shutting_down socket and reports the actual four-state reason', () => {
    const output = withOwnedRunnerAuthority<string>({
      logContent: '',
      healthState: 'shutting_down',
      snippet: ({ repoRoot, tempRoot, backendRealRoot, logFile, pidFile, readyFile, healthFile, ownerStateFile, processStateDir }) => {
        const fakeStartRunner = path.join(tempRoot, 'scripts/local-manual/start-runner.sh');
        mkdirSync(path.dirname(fakeStartRunner), { recursive: true });
        writeFileSync(
          fakeStartRunner,
          `#!/usr/bin/env bash\nprintf 'start-runner-called\\n'\n`,
          'utf8',
        );
        chmodSync(fakeStartRunner, 0o755);
        return `
          set -euo pipefail
          export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
          export LOCAL_RUNTIME_PROCESS_STATE_DIR="${processStateDir}"
          source "${repoRoot}/scripts/local-manual/common.sh"
          source "${repoRoot}/scripts/lib/local-runtime-processes.sh"
          ROOT_DIR="${tempRoot}"
          RUNNER_LOG="${logFile}"
          RUNNER_PID_FILE="${pidFile}"
          RUNNER_READY_FILE="${readyFile}"
          RUNNER_HEALTH_FILE="${healthFile}"
          RUNNER_OWNER_STATE_FILE="${ownerStateFile}"
          ensure_local_manual_runner_connected
        `;
      },
    });

    expect(output).toContain('socket is shutting_down');
    expect(output).toContain('start-runner-called');
  });
});
