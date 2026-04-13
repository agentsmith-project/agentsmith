import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runBash(script: string, rootDir: string): string {
  return execFileSync('bash', ['-lc', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ROOT_DIR: rootDir,
    },
    encoding: 'utf8',
  }).trim();
}

describe('next-generated-root-state', () => {
  it('normalizes run-specific tsconfig includes back to stable lane aliases', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":["artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/**/*.ts",".next*/types/**/*.ts","src/**/*.ts","custom/**/*.ts"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference path="./artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
        source "${helper}"
        next_generated_root_normalize
      `,
      tempRoot,
    );

    const tsconfig = readFileSync(tsconfigPath, 'utf8');
    expect(tsconfig).toContain('.next*/types/**/*.ts');
    expect(tsconfig).toContain('artifacts/backend-real/current-run/next-dist/types/**/*.d.ts');
    expect(tsconfig).toContain('artifacts/mock-lane/current/next-dist/types/**/*.d.ts');
    expect(tsconfig).toContain('custom/**/*.ts');
    expect(tsconfig).not.toContain('/integration-20260410T062839Z-3559213-15947/');

    const nextEnv = readFileSync(nextEnvPath, 'utf8');
    expect(nextEnv).toContain('reference types="next"');
    expect(nextEnv).not.toContain('/integration-20260410T062839Z-3559213-15947/');
  });

  it('preserves existing non-managed include entries while deduplicating managed patterns', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-preserve-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":["src/**/*.ts","artifacts/mock-lane/runs/mock-20260410T032507Z-3268716-702/next-dist/types/**/*.ts","src/**/*.tsx","artifacts/mock-lane/runs/*/next-dist/types/**/*.ts"]}
EOF_TSCONFIG
        : > "${nextEnvPath}"
        source "${helper}"
        next_generated_root_normalize
      `,
      tempRoot,
    );

    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as { include: string[] };
    expect(tsconfig.include).toEqual([
      '.next*/types/**/*.ts',
      'artifacts/backend-real/current-run/next-dist/types/**/*.d.ts',
      'artifacts/mock-lane/current/next-dist/types/**/*.d.ts',
      'src/**/*.ts',
      'src/**/*.tsx',
    ]);
  });

  it('stops leftover lane web processes before normalizing root files for validation', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-preflight-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const lanePidFile = path.join(
      tempRoot,
      'artifacts/mock-lane/runs/mock-20260411T011449Z-1305939-19002/web.pid',
    );
    const nextPidFile = path.join(
      tempRoot,
      'artifacts/mock-lane/runs/mock-20260411T011449Z-1305939-19002/next-dev.pid',
    );
    const currentLink = path.join(tempRoot, 'artifacts/mock-lane/current');

    const output = runBash(
      `
        mkdir -p "$(dirname "${lanePidFile}")"
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":["src/**/*.ts","artifacts/mock-lane/runs/mock-20260411T011449Z-1305939-19002/next-dist/types/**/*.ts"]}
EOF_TSCONFIG
        : > "${nextEnvPath}"
        bash -lc 'exec -a "npm run dev:test -- --port 3001" sleep 300' &
        lane_pid=$!
        bash -lc 'exec -a "next dev --port 3001" sleep 300' &
        next_pid=$!
        printf '%s\\n' "\${lane_pid}" > "${lanePidFile}"
        printf '%s\\n' "\${next_pid}" > "${nextPidFile}"
        ln -sfn "$(dirname "${lanePidFile}")" "${currentLink}"
        source "${helper}"
        next_generated_root_prepare_for_validation
        if kill -0 "\${lane_pid}" >/dev/null 2>&1; then
          echo "lane_process=alive"
        else
          echo "lane_process=stopped"
        fi
        if kill -0 "\${next_pid}" >/dev/null 2>&1; then
          echo "next_process=alive"
        else
          echo "next_process=stopped"
        fi
        if [[ -f "${lanePidFile}" ]]; then
          echo "pid_file=present"
        else
          echo "pid_file=removed"
        fi
        if [[ -f "${nextPidFile}" ]]; then
          echo "next_pid_file=present"
        else
          echo "next_pid_file=removed"
        fi
        if [[ -L "${currentLink}" ]]; then
          echo "current_link=present"
        else
          echo "current_link=removed"
        fi
      `,
      tempRoot,
    );

    expect(output).toContain('lane_process=stopped');
    expect(output).toContain('next_process=stopped');
    expect(output).toContain('pid_file=removed');
    expect(output).toContain('next_pid_file=removed');
    expect(output).toContain('current_link=removed');

    const tsconfig = readFileSync(tsconfigPath, 'utf8');
    expect(tsconfig).toContain('artifacts/mock-lane/current/next-dist/types/**/*.d.ts');
    expect(tsconfig).not.toContain('/mock-20260411T011449Z-1305939-19002/');
  });

  it('refuses validation cleanup when an active mock-lane owner still holds the run', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-owner-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const runRoot = path.join(
      tempRoot,
      'artifacts/mock-lane/runs/mock-20260412T190154Z-1498987-24516',
    );
    const lanePidFile = path.join(runRoot, 'web.pid');
    const nextPidFile = path.join(runRoot, 'next-dev.pid');
    const currentLink = path.join(tempRoot, 'artifacts/mock-lane/current');

    const output = runBash(
      `
        mkdir -p "${runRoot}"
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":["src/**/*.ts","artifacts/mock-lane/runs/mock-20260412T190154Z-1498987-24516/next-dist/types/**/*.ts"]}
EOF_TSCONFIG
        : > "${nextEnvPath}"
        bash -lc 'exec -a "bash scripts/run-mock-lane-playwright.sh e2e/visual.spec.ts --project=visual" sleep 300' &
        owner_pid=$!
        bash -lc 'exec -a "npm run dev:test -- --port 3001" sleep 300' &
        lane_pid=$!
        bash -lc 'exec -a "next dev --port 3001" sleep 300' &
        next_pid=$!
        printf '%s\\n' "\${lane_pid}" > "${lanePidFile}"
        printf '%s\\n' "\${next_pid}" > "${nextPidFile}"
        ln -sfn "${runRoot}" "${currentLink}"
        source "${helper}"
        next_generated_root_write_lane_owner "${runRoot}" "mock-lane" "\${owner_pid}" "run-mock-lane-playwright.sh"
        set +e
        next_generated_root_prepare_for_validation >"${tempRoot}/prepare.log" 2>&1
        status=$?
        set -e
        printf 'status=%s\\n' "\${status}"
        cat "${tempRoot}/prepare.log"
        if kill -0 "\${owner_pid}" >/dev/null 2>&1; then
          echo "owner_process=alive"
        else
          echo "owner_process=stopped"
        fi
        if kill -0 "\${lane_pid}" >/dev/null 2>&1; then
          echo "lane_process=alive"
        else
          echo "lane_process=stopped"
        fi
        if kill -0 "\${next_pid}" >/dev/null 2>&1; then
          echo "next_process=alive"
        else
          echo "next_process=stopped"
        fi
        if [[ -L "${currentLink}" ]]; then
          echo "current_link=present"
        else
          echo "current_link=removed"
        fi
        kill "\${owner_pid}" "\${lane_pid}" "\${next_pid}" >/dev/null 2>&1 || true
        wait "\${owner_pid}" "\${lane_pid}" "\${next_pid}" >/dev/null 2>&1 || true
      `,
      tempRoot,
    );

    expect(output).toContain('status=1');
    expect(output).toContain('owner_process=alive');
    expect(output).toContain('lane_process=alive');
    expect(output).toContain('next_process=alive');
    expect(output).toContain('current_link=present');
    expect(output).toContain('active lane owner');
  });
});
