import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('local-manual proxy truth', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('uses connection.env MBOS_UNIVERSAL_PROXY_BASE_URL as truth over app PROXY_PORT', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-proxy-truth-'));
    tempRoots.push(tempRoot);

    const backendRealStateDir = path.join(tempRoot, 'backend-real');
    const runtimeLinesRoot = path.join(tempRoot, 'runtime-lines');
    const substrateStateRoot = path.join(tempRoot, 'substrate');
    const substrateConfigFile = path.join(tempRoot, 'substrate.env');
    const envFile = path.join(tempRoot, '.env.local-manual');

    mkdirSync(substrateStateRoot, { recursive: true });
    writeFileSync(envFile, 'PROXY_PORT=39080\n', 'utf8');
    writeFileSync(
      substrateConfigFile,
      `SUBSTRATE_TYPE=compose
SUBSTRATE_STATE_ROOT=${substrateStateRoot}
SUBSTRATE_PROXY_PORT=38080
SUBSTRATE_COMPOSE_FILE=${path.join(tempRoot, 'docker-compose.yml')}
`,
      'utf8',
    );
    writeFileSync(
      path.join(substrateStateRoot, 'connection.env'),
      `KEYCLOAK_BASE_URL=http://localhost:18080
KEYCLOAK_REALM=mbos
KEYCLOAK_CLIENT_ID=agentsmith
KEYCLOAK_ISSUER_URL=http://localhost:18080/realms/mbos
MBOS_UNIVERSAL_PROXY_BASE_URL=http://127.0.0.1:38080
MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=saved-admin-token
`,
      'utf8',
    );

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          export BACKEND_REAL_STATE_DIR="${backendRealStateDir}"
          export ENV_FILE="${envFile}"
          export RUNTIME_LINES_ROOT="${runtimeLinesRoot}"
          export SUBSTRATE_CONFIG_FILE="${substrateConfigFile}"
          source "${repoRoot}/scripts/local-manual/common.sh"
          init_local_manual_env
          printf 'base=%s\\n' "$MBOS_UNIVERSAL_PROXY_BASE_URL"
          printf 'port=%s\\n' "$PROXY_PORT"
        `,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toContain('base=http://127.0.0.1:38080');
    expect(output).toContain('port=38080');
  });

  it('does not hand connection.env proxy variables to substrate bootstrap as explicit external env', () => {
    const script = readFileSync(path.join(repoRoot, 'scripts/local-manual/up.sh'), 'utf8');

    expect(script.indexOf('local_manual_capture_substrate_proxy_env')).toBeLessThan(script.indexOf('init_local_manual_env'));
    expect(script).toContain('unset MBOS_UNIVERSAL_PROXY_BASE_URL');
    expect(script).toContain('unset MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
    expect(script).toContain('local_manual_run_substrate_script up');
    expect(script).toContain('local_manual_run_substrate_script reseed');
    expect(script).not.toContain('SUBSTRATE_ENV_FILE="${ENV_FILE}" SUBSTRATE="${SUBSTRATE}" bash "${ROOT_DIR}/scripts/substrate/up.sh"');
  });
});
