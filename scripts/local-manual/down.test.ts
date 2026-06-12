import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('local-manual down', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  function writeExecutable(filePath: string, content: string): void {
    writeFileSync(filePath, content, 'utf8');
    chmodSync(filePath, 0o755);
  }

  it('fails soft when substrate connection.env is missing and still clears half-start local-real state', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-down-'));
    tempRoots.push(tempRoot);

    const binDir = path.join(tempRoot, 'bin');
    const runtimeLinesRoot = path.join(tempRoot, 'runtime-lines');
    const backendRealStateDir = path.join(tempRoot, 'backend-real');
    const scenarioRuntimeRoot = path.join(tempRoot, 'scenario');
    const substrateStateRoot = path.join(tempRoot, 'substrate');
    const substrateConfigFile = path.join(tempRoot, 'substrate.env');
    const envFile = path.join(tempRoot, '.env.local-manual');
    const dockerLog = path.join(tempRoot, 'docker.log');
    const kindLog = path.join(tempRoot, 'kind.log');
    const activeScenarioLock = path.join(scenarioRuntimeRoot, 'active-scenario.lock');

    mkdirSync(binDir, { recursive: true });
    mkdirSync(substrateStateRoot, { recursive: true });
    mkdirSync(scenarioRuntimeRoot, { recursive: true });
    writeFileSync(activeScenarioLock, 'local-manual\n', 'utf8');
    writeFileSync(envFile, 'MBOS_UNIVERSAL_PROXY_BASE_URL=http://127.0.0.1:38080\n', 'utf8');
    writeFileSync(
      substrateConfigFile,
      `SUBSTRATE_TYPE=compose
SUBSTRATE_STATE_ROOT=${substrateStateRoot}
SUBSTRATE_COMPOSE_FILE=${path.join(tempRoot, 'docker-compose.yml')}
SUBSTRATE_COMPOSE_PROJECT_NAME=local-manual-down-test
SUBSTRATE_PROXY_PORT=38080
SUBSTRATE_KEYCLOAK_PORT=18080
`,
      'utf8',
    );

    writeExecutable(
      path.join(binDir, 'docker'),
      `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'docker'
  for arg in "$@"; do
    printf ' %s' "\${arg}"
  done
  printf '\\n'
} >> "${dockerLog}"
exit 0
`,
    );
    writeExecutable(
      path.join(binDir, 'kind'),
      `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'kind'
  for arg in "$@"; do
    printf ' %s' "\${arg}"
  done
  printf '\\n'
} >> "${kindLog}"
exit 0
`,
    );

    const result = spawnSync('bash', [path.join(repoRoot, 'scripts/local-manual/down.sh')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        BACKEND_REAL_STATE_DIR: backendRealStateDir,
        ENV_FILE: envFile,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        RUNTIME_LINES_ROOT: runtimeLinesRoot,
        SCENARIO_RUNTIME_ROOT: scenarioRuntimeRoot,
        SUBSTRATE_CONFIG_FILE: substrateConfigFile,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stderr).not.toContain('missing substrate connection env');
    expect(existsSync(path.join(substrateStateRoot, 'connection.env'))).toBe(false);
    expect(existsSync(activeScenarioLock)).toBe(false);
    expect(readFileSync(dockerLog, 'utf8')).toContain('docker compose');
    expect(readFileSync(dockerLog, 'utf8')).toContain('docker rm -f kind-registry');
    expect(readFileSync(kindLog, 'utf8')).toContain('kind delete cluster --name agentsmith');
    expect(readFileSync(path.join(backendRealStateDir, 'state.json'), 'utf8')).toContain('"workspace"');
  });

  it('internal down falls back to no-api cleanup when substrate connection.env is already gone', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-internal-down-'));
    tempRoots.push(tempRoot);

    const runtimeLinesRoot = path.join(tempRoot, 'runtime-lines');
    const backendRealStateDir = path.join(tempRoot, 'backend-real');
    const scenarioRuntimeRoot = path.join(tempRoot, 'scenario');
    const substrateStateRoot = path.join(tempRoot, 'substrate');
    const substrateConfigFile = path.join(tempRoot, 'substrate.env');
    const envFile = path.join(tempRoot, '.env.local-manual');

    mkdirSync(substrateStateRoot, { recursive: true });
    mkdirSync(scenarioRuntimeRoot, { recursive: true });
    writeFileSync(envFile, 'MBOS_UNIVERSAL_PROXY_BASE_URL=http://127.0.0.1:38080\n', 'utf8');
    writeFileSync(
      substrateConfigFile,
      `SUBSTRATE_TYPE=compose
SUBSTRATE_STATE_ROOT=${substrateStateRoot}
SUBSTRATE_COMPOSE_FILE=${path.join(tempRoot, 'docker-compose.yml')}
SUBSTRATE_PROXY_PORT=38080
SUBSTRATE_KEYCLOAK_PORT=18080
`,
      'utf8',
    );

    const result = spawnSync('bash', [path.join(repoRoot, 'scripts/local-manual/internal-down.sh')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        BACKEND_REAL_STATE_DIR: backendRealStateDir,
        ENV_FILE: envFile,
        RUNTIME_LINES_ROOT: runtimeLinesRoot,
        SCENARIO_RUNTIME_ROOT: scenarioRuntimeRoot,
        SUBSTRATE_CONFIG_FILE: substrateConfigFile,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stderr).not.toContain('missing substrate connection env');
    expect(result.stdout).toContain('stopping internal runtime without API restart');
    expect(result.stdout).toContain('[local-manual-internal] down');
  });

  it('derives proxy port from substrate connection env instead of local app env defaults', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-proxy-truth-'));
    tempRoots.push(tempRoot);

    const runtimeLinesRoot = path.join(tempRoot, 'runtime-lines');
    const backendRealStateDir = path.join(tempRoot, 'backend-real');
    const scenarioRuntimeRoot = path.join(tempRoot, 'scenario');
    const substrateStateRoot = path.join(tempRoot, 'substrate');
    const substrateConfigFile = path.join(tempRoot, 'substrate.env');
    const envFile = path.join(tempRoot, '.env.local-manual');

    mkdirSync(substrateStateRoot, { recursive: true });
    writeFileSync(envFile, 'PROXY_PORT=39080\n', 'utf8');
    writeFileSync(
      substrateConfigFile,
      `SUBSTRATE_TYPE=compose
SUBSTRATE_STATE_ROOT=${substrateStateRoot}
SUBSTRATE_COMPOSE_FILE=${path.join(tempRoot, 'docker-compose.yml')}
SUBSTRATE_PROXY_PORT=38080
SUBSTRATE_KEYCLOAK_PORT=18080
`,
      'utf8',
    );
    writeFileSync(
      path.join(substrateStateRoot, 'connection.env'),
      `DATABASE_URL=postgresql://mbos:mbos_dev_password@localhost:15432/mbos
MONGO_URL=mongodb://mbos:mbos_dev_password@localhost:17017/admin
MONGO_DB_NAME=mbos
REDIS_URL=redis://:mbos_dev_password@localhost:16379
SUBSTRATE_REDIS_PASSWORD=mbos_dev_password
MINIO_ENDPOINT=localhost
MINIO_PORT=19000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=mbos
MINIO_SECRET_KEY=mbos_dev_password
MINIO_BUCKET=mbos-dev
KEYCLOAK_BASE_URL=http://localhost:18080
KEYCLOAK_REALM=mbos
KEYCLOAK_CLIENT_ID=agentsmith
KEYCLOAK_ISSUER_URL=http://localhost:18080/realms/mbos
MBOS_UNIVERSAL_PROXY_BASE_URL=http://127.0.0.1:38080
MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=proxy-token
`,
      'utf8',
    );

    const result = spawnSync(
      'bash',
      ['-lc', `source "${path.join(repoRoot, 'scripts/local-manual/common.sh')}"; init_local_manual_env; printf '%s\\n' "$PROXY_PORT"`],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          BACKEND_REAL_STATE_DIR: backendRealStateDir,
          ENV_FILE: envFile,
          RUNTIME_LINES_ROOT: runtimeLinesRoot,
          SCENARIO_RUNTIME_ROOT: scenarioRuntimeRoot,
          SUBSTRATE_CONFIG_FILE: substrateConfigFile,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stdout.trim()).toBe('38080');
  });
});
