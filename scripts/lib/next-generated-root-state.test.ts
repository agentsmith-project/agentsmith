import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const canonicalInclude = [
  '.next/types/**/*.ts',
  'next-env.d.ts',
  'src/**/*.ts',
  'src/**/*.tsx',
];

const canonicalNextEnv = `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;

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

function installProbeRaceHook(args: {
  helperPath: string;
  tsconfigPath: string;
  restoredTsconfig?: string;
  restoreDelaySeconds?: number;
}): void {
  const restoreSnippet = args.restoredTsconfig
    ? `(
  sleep ${args.restoreDelaySeconds ?? 0.12}
  cat > "${args.tsconfigPath}" <<'EOF_RESTORED_TSCONFIG'
${args.restoredTsconfig}
EOF_RESTORED_TSCONFIG
) &`
    : '';

  writeFileSync(
    args.helperPath,
    `${readFileSync(args.helperPath, 'utf8')}
eval "$(declare -f next_generated_root_probe_source_contract_once | sed '1s/next_generated_root_probe_source_contract_once/next_generated_root_test_original_probe_source_contract_once/')"
next_generated_root_probe_source_contract_once() {
  local output
  output="$(next_generated_root_test_original_probe_source_contract_once "$@")"
  if [[ -z "\${NEXT_GENERATED_ROOT_TEST_RACE_TRIGGERED:-}" && "\${output}" == $'semantic_drift\\t'* ]]; then
    export NEXT_GENERATED_ROOT_TEST_RACE_TRIGGERED=1
    cat > "${args.tsconfigPath}" <<'EOF_HALF_WRITTEN_TSCONFIG'
{"compilerOptions":
EOF_HALF_WRITTEN_TSCONFIG
${restoreSnippet}
  fi
  printf '%s\\n' "\${output}"
}
`,
    'utf8',
  );
}

describe('next-generated-root-state', () => {
  it('normalizes polluted root files back to the canonical tsconfig include set', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":["artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/**/*.ts",".next*/types/**/*.ts",".next-local-manual-3101/types/**/*.ts","artifacts/recovery-manual-next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx","custom/**/*.ts"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference types="next" />
/// <reference types="next/image-types/global" />
/// <reference path="./artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
        source "${helper}"
        next_generated_root_normalize
      `,
      tempRoot,
    );

    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as { include: string[] };
    expect(tsconfig.include).toEqual(canonicalInclude);
    expect(readFileSync(nextEnvPath, 'utf8')).toBe(canonicalNextEnv);
  });

  it('rewrites duplicate and run-specific include entries to the fixed canonical order', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-preserve-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":["src/**/*.tsx","artifacts/mock-lane/runs/mock-20260410T032507Z-3268716-702/next-dist/types/**/*.ts",".next*/types/**/*.ts",".next/types/**/*.ts","artifacts/mock-lane/current/next-dist/types/**/*.d.ts","next-env.d.ts","src/**/*.ts","artifacts/mock-lane/runs/playwright-managed-1776167402066-1748658/next-dist/types/**/*.ts"]}
EOF_TSCONFIG
        : > "${nextEnvPath}"
        source "${helper}"
        next_generated_root_normalize
      `,
      tempRoot,
    );

    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as { include: string[] };
    expect(tsconfig.include).toEqual(canonicalInclude);
    expect(readFileSync(nextEnvPath, 'utf8')).toBe(canonicalNextEnv);
  });

  it('repairs include drift while preserving concurrent non-include tsconfig edits', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-guard-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    const output = runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"compilerOptions":{"strict":true},"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"],"exclude":["generated/**/*.ts"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF_NEXT_ENV
        source "${helper}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${tempRoot}/artifacts/runtime/local-manual-root-contract"
        export NEXT_GENERATED_ROOT_GUARD_INTERVAL_SEC=0.05
        guard_pid="$(next_generated_root_start_contract_guard)"
        cat > "${tsconfigPath}" <<'EOF_POLLUTED_TSCONFIG'
{"compilerOptions":{"strict":false,"jsx":"preserve"},"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"],"exclude":["generated/**/*.ts"],"references":[{"path":"./tsconfig.node.json"}]}
EOF_POLLUTED_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_POLLUTED_NEXT_ENV'
/// <reference path="./artifacts/runtime/lines/local-manual/current/next-dist/types/routes.d.ts" />
EOF_POLLUTED_NEXT_ENV
        sleep 0.3
        node - <<'NODE' "${tsconfigPath}" "${nextEnvPath}"
const fs = require('node:fs');
const [tsconfigPath, nextEnvPath] = process.argv.slice(2);
const canonicalInclude = [
  '.next/types/**/*.ts',
  'next-env.d.ts',
  'src/**/*.ts',
  'src/**/*.tsx',
];
const canonicalNextEnv = \`/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
\`;
const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
const nextEnv = fs.readFileSync(nextEnvPath, 'utf8');
if (JSON.stringify(tsconfig.include) !== JSON.stringify(canonicalInclude)) {
  process.exit(1);
}
if (tsconfig.compilerOptions?.strict !== false) {
  process.exit(1);
}
if (tsconfig.compilerOptions?.jsx !== 'preserve') {
  process.exit(1);
}
if (JSON.stringify(tsconfig.exclude) !== JSON.stringify(['generated/**/*.ts'])) {
  process.exit(1);
}
if (JSON.stringify(tsconfig.references) !== JSON.stringify([{ path: './tsconfig.node.json' }])) {
  process.exit(1);
}
if (nextEnv !== canonicalNextEnv) {
  process.exit(1);
}
NODE
        echo "guard=contract_scoped"
        next_generated_root_stop_contract_guard "\${guard_pid}"
        if kill -0 "\${guard_pid}" >/dev/null 2>&1; then
          echo "guard_process=alive"
        else
          echo "guard_process=stopped"
        fi
      `,
      tempRoot,
    );

    expect(output).toContain('guard=contract_scoped');
    expect(output).toContain('guard_process=stopped');
  });

  it('finalizes the source contract with a dedicated contract-scoped reconcile helper', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-finalize-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"compilerOptions":{"strict":false},"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"],"references":[{"path":"./tsconfig.node.json"}]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference path="./artifacts/runtime/lines/local-manual/current/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
        source "${helper}"
        next_generated_root_final_reconcile_source_contract
      `,
      tempRoot,
    );

    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
      compilerOptions?: { strict?: boolean };
      include: string[];
      references?: Array<{ path: string }>;
    };
    expect(tsconfig.include).toEqual(canonicalInclude);
    expect(tsconfig.compilerOptions).toEqual({ strict: false });
    expect(tsconfig.references).toEqual([{ path: './tsconfig.node.json' }]);
    expect(readFileSync(nextEnvPath, 'utf8')).toBe(canonicalNextEnv);
  });

  it('keeps validation prep non-destructive when live lane state exists but the root contract is canonical', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-preflight-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const runRoot = path.join(
      tempRoot,
      'artifacts/mock-lane/runs/mock-20260411T011449Z-1305939-19002',
    );
    const lanePidFile = path.join(
      runRoot,
      'web.pid',
    );
    const nextPidFile = path.join(
      runRoot,
      'next-dev.pid',
    );
    const currentLink = path.join(tempRoot, 'artifacts/mock-lane/current');

    const output = runBash(
      `
        mkdir -p "${runRoot}"
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF_NEXT_ENV
        tsconfig_before="$(sha256sum "${tsconfigPath}" | awk '{print $1}')"
        next_env_before="$(sha256sum "${nextEnvPath}" | awk '{print $1}')"
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
        next_generated_root_prepare_for_validation
        printf 'status=0\\n'
        tsconfig_after="$(sha256sum "${tsconfigPath}" | awk '{print $1}')"
        next_env_after="$(sha256sum "${nextEnvPath}" | awk '{print $1}')"
        if [[ "\${tsconfig_before}" == "\${tsconfig_after}" ]]; then
          echo "tsconfig=unchanged"
        else
          echo "tsconfig=rewritten"
        fi
        if [[ "\${next_env_before}" == "\${next_env_after}" ]]; then
          echo "next_env=unchanged"
        else
          echo "next_env=rewritten"
        fi
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
        kill "\${owner_pid}" "\${lane_pid}" "\${next_pid}" >/dev/null 2>&1 || true
        wait "\${owner_pid}" "\${lane_pid}" "\${next_pid}" >/dev/null 2>&1 || true
      `,
      tempRoot,
    );

    expect(output).toContain('status=0');
    expect(output).toContain('tsconfig=unchanged');
    expect(output).toContain('next_env=unchanged');
    expect(output).toContain('owner_process=alive');
    expect(output).toContain('lane_process=alive');
    expect(output).toContain('next_process=alive');
    expect(output).toContain('pid_file=present');
    expect(output).toContain('next_pid_file=present');
    expect(output).toContain('current_link=present');

    const tsconfig = readFileSync(tsconfigPath, 'utf8');
    expect(JSON.parse(tsconfig).include).toEqual(canonicalInclude);
  });

  it('fails validation prep on polluted root files without rewriting root contract or cleaning live lane state', () => {
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
{"include":["artifacts/mock-lane/current/next-dist/types/**/*.d.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference types="next" />
/// <reference types="next/image-types/global" />
/// <reference path="./artifacts/mock-lane/current/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
        tsconfig_before="$(sha256sum "${tsconfigPath}" | awk '{print $1}')"
        next_env_before="$(sha256sum "${nextEnvPath}" | awk '{print $1}')"
        bash -lc 'exec -a "npm run dev:test -- --port 3001" sleep 300' &
        lane_pid=$!
        bash -lc 'exec -a "next dev --port 3001" sleep 300' &
        next_pid=$!
        printf '%s\\n' "\${lane_pid}" > "${lanePidFile}"
        printf '%s\\n' "\${next_pid}" > "${nextPidFile}"
        ln -sfn "${runRoot}" "${currentLink}"
        source "${helper}"
        set +e
        next_generated_root_prepare_for_validation >"${tempRoot}/prepare.log" 2>&1
        status=$?
        set -e
        printf 'status=%s\\n' "\${status}"
        cat "${tempRoot}/prepare.log"
        tsconfig_after="$(sha256sum "${tsconfigPath}" | awk '{print $1}')"
        next_env_after="$(sha256sum "${nextEnvPath}" | awk '{print $1}')"
        if [[ "\${tsconfig_before}" == "\${tsconfig_after}" ]]; then
          echo "tsconfig=unchanged"
        else
          echo "tsconfig=rewritten"
        fi
        if [[ "\${next_env_before}" == "\${next_env_after}" ]]; then
          echo "next_env=unchanged"
        else
          echo "next_env=rewritten"
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
        kill "\${lane_pid}" "\${next_pid}" >/dev/null 2>&1 || true
        wait "\${lane_pid}" "\${next_pid}" >/dev/null 2>&1 || true
      `,
      tempRoot,
    );

    expect(output).toContain('status=1');
    expect(output).toContain('tsconfig=unchanged');
    expect(output).toContain('next_env=unchanged');
    expect(output).toContain('lane_process=alive');
    expect(output).toContain('next_process=alive');
    expect(output).toContain('current_link=present');
    expect(output).toContain('root source contract drift');
  });

  it('keeps lane cleanup from rewriting source root files', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-finalize-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const originalTsconfig = '{"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"],"compilerOptions":{"strict":false}}\n';

    runBash(
      `
        printf '%s' '${originalTsconfig}' > "${tsconfigPath}"
        rm -f "${nextEnvPath}"
        source "${helper}"
        next_generated_root_finalize_lane_cleanup
      `,
      tempRoot,
    );

    expect(readFileSync(tsconfigPath, 'utf8')).toBe(originalTsconfig);
    expect(() => readFileSync(nextEnvPath, 'utf8')).toThrow();
  });

  it('retries transient half-written tsconfig during validation prep until the root becomes readable again', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-transient-prepare-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    const output = runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF_NEXT_ENV
        (
          sleep 0.15
          cat > "${tsconfigPath}" <<'EOF_RESTORED_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_RESTORED_TSCONFIG
        ) &
        restore_pid=$!
        source "${helper}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${tempRoot}/artifacts/runtime/next-root-contract"
        export NEXT_GENERATED_ROOT_PREPARE_RETRY_COUNT=8
        export NEXT_GENERATED_ROOT_PREPARE_RETRY_DELAY_SEC=0.05
        set +e
        next_generated_root_prepare_for_validation >"${tempRoot}/prepare.log" 2>&1
        status=$?
        set -e
        wait "\${restore_pid}"
        printf 'status=%s\\n' "\${status}"
        cat "${tempRoot}/prepare.log"
      `,
      tempRoot,
    );

    expect(output).toContain('status=0');
    expect(JSON.parse(readFileSync(tsconfigPath, 'utf8'))).toEqual({
      include: canonicalInclude,
    });
  });

  it('keeps the contract guard alive and records evidence when tsconfig stays unreadable past one guard cycle', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-guard-unreadable-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const eventFile = path.join(
      tempRoot,
      'artifacts/runtime/next-root-contract/source-contract-events.jsonl',
    );

    const output = runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF_NEXT_ENV
        source "${helper}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${tempRoot}/artifacts/runtime/next-root-contract"
        export NEXT_GENERATED_ROOT_GUARD_RETRY_COUNT=1
        export NEXT_GENERATED_ROOT_GUARD_RETRY_DELAY_SEC=0.02
        export NEXT_GENERATED_ROOT_GUARD_INTERVAL_SEC=0.05
        guard_pid="$(next_generated_root_start_contract_guard)"
        sleep 0.2
        if kill -0 "\${guard_pid}" >/dev/null 2>&1; then
          echo "guard_before_restore=alive"
        else
          echo "guard_before_restore=dead"
        fi
        if [[ -f "${eventFile}" ]]; then
          echo "evidence=present"
          cat "${eventFile}"
        else
          echo "evidence=missing"
        fi
        cat > "${tsconfigPath}" <<'EOF_RESTORED_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_RESTORED_TSCONFIG
        sleep 0.15
        if kill -0 "\${guard_pid}" >/dev/null 2>&1; then
          echo "guard_after_restore=alive"
        else
          echo "guard_after_restore=dead"
        fi
        next_generated_root_stop_contract_guard "\${guard_pid}"
      `,
      tempRoot,
    );

    expect(output).toContain('guard_before_restore=alive');
    expect(output).toContain('guard_after_restore=alive');
    expect(output).toContain('evidence=present');
    expect(output).toContain('"status":"persistent_unreadable"');
    expect(output).toContain('"phase":"guard"');
    expect(JSON.parse(readFileSync(tsconfigPath, 'utf8'))).toEqual({
      include: canonicalInclude,
    });
  });

  it('fails final reconcile with unreadable-specific semantics after the retry budget is exhausted', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-final-unreadable-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const eventFile = path.join(
      tempRoot,
      'artifacts/runtime/next-root-contract/source-contract-events.jsonl',
    );

    const output = runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF_NEXT_ENV
        source "${helper}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${tempRoot}/artifacts/runtime/next-root-contract"
        export NEXT_GENERATED_ROOT_FINALIZE_RETRY_COUNT=2
        export NEXT_GENERATED_ROOT_FINALIZE_RETRY_DELAY_SEC=0.02
        set +e
        next_generated_root_final_reconcile_source_contract >"${tempRoot}/finalize.log" 2>&1
        status=$?
        set -e
        printf 'status=%s\\n' "\${status}"
        cat "${tempRoot}/finalize.log"
        if [[ -f "${eventFile}" ]]; then
          echo "evidence=present"
          cat "${eventFile}"
        else
          echo "evidence=missing"
        fi
      `,
      tempRoot,
    );

    expect(output).toContain('status=2');
    expect(output).toContain('persistent_unreadable');
    expect(output).toContain('evidence=present');
    expect(output).toContain('"phase":"final_reconcile"');
    expect(output).toContain('"status":"persistent_unreadable"');
    expect(readFileSync(tsconfigPath, 'utf8')).toContain('{"include":');
  });

  it('retries final_reconcile when tsconfig becomes unreadable after semantic_drift and repairs once readable', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-final-race-'));
    const helper = path.join(tempRoot, 'next-generated-root-state.sh');
    cpSync(path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh'), helper);
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    installProbeRaceHook({
      helperPath: helper,
      tsconfigPath,
      restoredTsconfig: '{"compilerOptions":{"strict":false},"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"],"references":[{"path":"./tsconfig.node.json"}]}',
      restoreDelaySeconds: 0.12,
    });

    const output = runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"compilerOptions":{"strict":false},"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"],"references":[{"path":"./tsconfig.node.json"}]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference path="./artifacts/runtime/lines/local-manual/current/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
        source "${helper}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${tempRoot}/artifacts/runtime/next-root-contract"
        export NEXT_GENERATED_ROOT_FINALIZE_RETRY_COUNT=8
        export NEXT_GENERATED_ROOT_FINALIZE_RETRY_DELAY_SEC=0.05
        set +e
        next_generated_root_final_reconcile_source_contract >"${tempRoot}/finalize.log" 2>&1
        status=$?
        set -e
        printf 'status=%s\\n' "\${status}"
        cat "${tempRoot}/finalize.log"
      `,
      tempRoot,
    );

    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
      compilerOptions?: { strict?: boolean };
      include: string[];
      references?: Array<{ path: string }>;
    };

    expect(output).toContain('status=0');
    expect(tsconfig.include).toEqual(canonicalInclude);
    expect(tsconfig.compilerOptions).toEqual({ strict: false });
    expect(tsconfig.references).toEqual([{ path: './tsconfig.node.json' }]);
    expect(readFileSync(nextEnvPath, 'utf8')).toBe(canonicalNextEnv);
  });

  it('reports persistent_unreadable with evidence when final_reconcile repair acquisition never gets a readable tsconfig', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-final-race-persistent-'));
    const helper = path.join(tempRoot, 'next-generated-root-state.sh');
    cpSync(path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh'), helper);
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const eventFile = path.join(
      tempRoot,
      'artifacts/runtime/next-root-contract/source-contract-events.jsonl',
    );

    installProbeRaceHook({
      helperPath: helper,
      tsconfigPath,
    });

    const output = runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"compilerOptions":{"strict":false},"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference path="./artifacts/runtime/lines/local-manual/current/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
        source "${helper}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${tempRoot}/artifacts/runtime/next-root-contract"
        export NEXT_GENERATED_ROOT_FINALIZE_RETRY_COUNT=2
        export NEXT_GENERATED_ROOT_FINALIZE_RETRY_DELAY_SEC=0.02
        set +e
        next_generated_root_final_reconcile_source_contract >"${tempRoot}/finalize.log" 2>&1
        status=$?
        set -e
        printf 'status=%s\\n' "\${status}"
        cat "${tempRoot}/finalize.log"
        if [[ -f "${eventFile}" ]]; then
          cat "${eventFile}"
        fi
      `,
      tempRoot,
    );

    expect(output).toContain('status=2');
    expect(output).toContain('persistent_unreadable');
    expect(output).toContain('"phase":"final_reconcile"');
    expect(output).toContain('"status":"persistent_unreadable"');
    expect(readFileSync(tsconfigPath, 'utf8')).toContain('{"compilerOptions":');
  });
});
