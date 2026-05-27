import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

const rootGeneratedNextEnv = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
/// <reference path="./.next/types/routes.d.ts" />

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

function runBashWithTimeout(script: string, rootDir: string, timeout: number): string {
  return execFileSync('bash', ['-lc', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ROOT_DIR: rootDir,
    },
    encoding: 'utf8',
    timeout,
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
  it('classifies Next 15 root-generated route references as valid when the root routes file exists', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-root-generated-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const routesPath = path.join(tempRoot, '.next/types/routes.d.ts');

    const output = runBash(
      `
        mkdir -p "$(dirname "${routesPath}")"
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
${rootGeneratedNextEnv}EOF_NEXT_ENV
        printf 'declare module "next";\\n' > "${routesPath}"
        source "${helper}"
        next_generated_root_resolve_source_contract_status prepare_for_validation
        printf 'status=%s\\nreason=%s\\n' "\${NEXT_GENERATED_ROOT_LAST_STATUS}" "\${NEXT_GENERATED_ROOT_LAST_REASON}"
      `,
      tempRoot,
    );

    expect(output).toContain('status=canonical');
    expect(output).toContain('reason=next_env_generated_root_valid');
    expect(output).not.toContain('next_env_generated_lane_state');
  });

  it('allows a Next 15 root-generated route reference before the root routes file exists', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-missing-root-routes-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    const output = runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
${rootGeneratedNextEnv}EOF_NEXT_ENV
        source "${helper}"
        next_generated_root_resolve_source_contract_status prepare_for_validation
        printf 'status=%s\\nreason=%s\\n' "\${NEXT_GENERATED_ROOT_LAST_STATUS}" "\${NEXT_GENERATED_ROOT_LAST_REASON}"
      `,
      tempRoot,
    );

    expect(output).toContain('status=canonical');
    expect(output).toContain('reason=next_env_generated_root_valid');
    expect(output).not.toContain('next_env_generated_lane_state');
  });

  it('prepares a source-safe root for tsc when Next 15 left a root route reference without generated route types', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-source-safe-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    const output = runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
${rootGeneratedNextEnv}EOF_NEXT_ENV
        source "${helper}"
        next_generated_root_prepare_source_safe_for_tsc
        next_generated_root_resolve_source_contract_status prepare_for_validation
        printf 'status=%s\\nreason=%s\\n' "\${NEXT_GENERATED_ROOT_LAST_STATUS}" "\${NEXT_GENERATED_ROOT_LAST_REASON}"
      `,
      tempRoot,
    );

    expect(output).toContain('status=canonical');
    expect(output).toContain('reason=source_contract_canonical');
    expect(readFileSync(nextEnvPath, 'utf8')).toBe(canonicalNextEnv);
  });

  it('serializes root source contract work under a repository lock', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-lock-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');

    const output = runBash(
      `
        source "${helper}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${tempRoot}/artifacts/runtime/next-root-contract"
        start_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
        next_generated_root_with_source_contract_lock holder bash -lc 'sleep 0.25' &
        holder_pid=$!
        sleep 0.05
        next_generated_root_with_source_contract_lock waiter bash -lc 'printf "waiter=entered\\n"'
        wait "\${holder_pid}"
        end_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
        printf 'elapsed_ms=%s\\n' "$((end_ms - start_ms))"
      `,
      tempRoot,
    );

    const elapsed = Number(output.match(/elapsed_ms=(\d+)/)?.[1] ?? '0');
    expect(output).toContain('waiter=entered');
    expect(elapsed).toBeGreaterThanOrEqual(220);
  });

  it('reuses an inherited lock context inside nested child shells instead of deadlocking on a second lock acquisition', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-nested-lock-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const stateDir = path.join(tempRoot, 'artifacts/runtime/next-root-contract');

    const output = runBashWithTimeout(
      `
        source "${helper}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${stateDir}"
        next_generated_root_with_source_contract_lock outer bash -lc '
          set -euo pipefail
          source "'"${helper}"'"
          export NEXT_GENERATED_ROOT_STATE_DIR="'"${stateDir}"'"
          next_generated_root_with_source_contract_lock inner bash -lc "printf nested_lock_reused"
        '
      `,
      tempRoot,
      3_000,
    );

    expect(output).toContain('nested_lock_reused');
  });

  it('keeps repo-root context available to locked callbacks inside the flock child shell', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-root-context-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const stateDir = path.join(tempRoot, 'artifacts/runtime/next-root-contract');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const markerPath = path.join(tempRoot, 'locked-callback-root.txt');

    const output = runBash(
      `
        source "${helper}"
        unset ROOT_DIR
        ROOT_DIR="${tempRoot}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${stateDir}"
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
${canonicalNextEnv}EOF_NEXT_ENV
        typegen_callback() {
          mkdir -p "\${ROOT_DIR}/.next/types"
          printf 'declare module "next";\\n' > "\${ROOT_DIR}/.next/types/routes.d.ts"
        }
        tsc_callback() {
          printf '%s\\n' "\${ROOT_DIR}" > "\${ROOT_DIR}/locked-callback-root.txt"
        }
        next_generated_root_run_locked_type_state_gate_sequence gate typegen_callback tsc_callback
        cat "${markerPath}"
      `,
      tempRoot,
    );

    expect(output).toContain(tempRoot);
  });

  it('allows build callbacks to reenter the source-contract lock in child shells without leaking full lock context to regular callbacks', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-build-reentry-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const stateDir = path.join(tempRoot, 'artifacts/runtime/next-root-contract');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    const output = runBashWithTimeout(
      `
        source "${helper}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${stateDir}"
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
${canonicalNextEnv}EOF_NEXT_ENV
        typegen_callback() {
          printf 'typegen_lock_held=%s\\n' "\${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD:-unset}"
          mkdir -p "${tempRoot}/.next/types"
          printf 'declare module "next";\\n' > "${tempRoot}/.next/types/routes.d.ts"
        }
        tsc_callback() {
          printf 'tsc_lock_held=%s\\n' "\${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD:-unset}"
        }
        build_callback() {
          printf 'build_lock_held=%s\\n' "\${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD:-unset}"
          bash -lc '
            set -euo pipefail
            source "'"${helper}"'"
            export NEXT_GENERATED_ROOT_STATE_DIR="'"${stateDir}"'"
            next_generated_root_with_source_contract_lock build_next_with_root_finalize bash -lc "printf nested_build_reentry"
          '
          printf '\\n'
        }
        next_generated_root_run_locked_type_state_gate_sequence gate typegen_callback tsc_callback build_callback
      `,
      tempRoot,
      3_000,
    );

    expect(output).toContain('typegen_lock_held=unset');
    expect(output).toContain('tsc_lock_held=unset');
    expect(output).toContain('build_lock_held=unset');
    expect(output).toContain('nested_build_reentry');
  });

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

  it('preserves latest parseable tsconfig edits made after repair acquisition', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-acquire-race-'));
    const helper = path.join(tempRoot, 'next-generated-root-state.sh');
    cpSync(path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh'), helper);
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const pauseFile = path.join(tempRoot, 'repair-acquired');
    const continueFile = path.join(tempRoot, 'repair-continue');

    writeFileSync(
      helper,
      `${readFileSync(helper, 'utf8')}
eval "$(declare -f next_generated_root_repair_acquire_tsconfig_once | sed '1s/next_generated_root_repair_acquire_tsconfig_once/next_generated_root_test_original_repair_acquire_tsconfig_once/')"
next_generated_root_repair_acquire_tsconfig_once() {
  local output
  output="$(next_generated_root_test_original_repair_acquire_tsconfig_once "$@")"
  if [[ ! -f "${pauseFile}" && "\${output}" == $'readable\\t'* ]]; then
    printf 'acquired\\n' > "${pauseFile}"
    while [[ ! -f "${continueFile}" ]]; do
      sleep 0.02
    done
  fi
  printf '%s\\n' "\${output}"
}
`,
      'utf8',
    );

    const output = runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"compilerOptions":{"strict":true},"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference path="./artifacts/runtime/lines/local-manual/current/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
        source "${helper}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${tempRoot}/artifacts/runtime/next-root-contract"
        next_generated_root_final_reconcile_source_contract >"${tempRoot}/repair.log" 2>&1 &
        repair_pid=$!
        for _i in $(seq 1 100); do
          [[ -f "${pauseFile}" ]] && break
          sleep 0.02
        done
        if [[ ! -f "${pauseFile}" ]]; then
          echo "pause=missing"
          kill "\${repair_pid}" >/dev/null 2>&1 || true
          wait "\${repair_pid}" >/dev/null 2>&1 || true
          exit 1
        fi
        cat > "${tsconfigPath}" <<'EOF_CONCURRENT_TSCONFIG'
{"compilerOptions":{"strict":false,"baseUrl":".","paths":{"@custom/*":["custom/*"]}},"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"],"references":[{"path":"./tsconfig.node.json"}]}
EOF_CONCURRENT_TSCONFIG
        printf 'continue\\n' > "${continueFile}"
        set +e
        wait "\${repair_pid}"
        status=$?
        set -e
        printf 'status=%s\\n' "\${status}"
        cat "${tempRoot}/repair.log"
      `,
      tempRoot,
    );

    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
      compilerOptions?: { strict?: boolean; baseUrl?: string; paths?: Record<string, string[]> };
      include: string[];
      references?: Array<{ path: string }>;
    };

    expect(output).toContain('status=0');
    expect(tsconfig.include).toEqual(canonicalInclude);
    expect(tsconfig.compilerOptions).toEqual({
      strict: false,
      baseUrl: '.',
      paths: {
        '@custom/*': ['custom/*'],
      },
    });
    expect(tsconfig.references).toEqual([{ path: './tsconfig.node.json' }]);
    expect(readFileSync(nextEnvPath, 'utf8')).toBe(canonicalNextEnv);
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

  it('runs typegen, tsc, and build under one locked type-state sequence while forcing fresh root route types', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-locked-type-state-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const fakeBin = path.join(tempRoot, 'bin');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const routesPath = path.join(tempRoot, '.next/types/routes.d.ts');
    const lockWaiterFile = path.join(tempRoot, 'waiter-entered');
    const commandLog = path.join(tempRoot, 'command.log');

    writeFileSync(tsconfigPath, `${JSON.stringify({ include: canonicalInclude }, null, 2)}\n`);
    writeFileSync(nextEnvPath, canonicalNextEnv);
    mkdirSync(path.dirname(routesPath), { recursive: true });
    writeFileSync(routesPath, 'declare const staleRoutes: true;\n');
    cpSync(path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh'), path.join(tempRoot, 'next-generated-root-state.sh'));
    execFileSync('bash', ['-lc', `mkdir -p "${fakeBin}"`], { stdio: 'pipe' });

    writeFileSync(
      path.join(fakeBin, 'npx'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "next" && "$2" == "typegen" && "$3" == "." ]]; then
  if [[ -f "${routesPath}" ]]; then
    printf 'typegen:stale-routes-present\\n' >> "${commandLog}"
  else
    printf 'typegen:stale-routes-cleared\\n' >> "${commandLog}"
  fi
  mkdir -p "$(dirname "${routesPath}")"
  cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
${rootGeneratedNextEnv}EOF_NEXT_ENV
  printf 'declare module "next";\\n' > "${routesPath}"
  exit 0
fi
if [[ "$1" == "tsc" && "$2" == "--noEmit" ]]; then
  printf 'tsc\\n' >> "${commandLog}"
  exit 0
fi
printf 'unexpected npx invocation: %s\\n' "$*" >&2
exit 1
`,
      { mode: 0o755 },
    );
    writeFileSync(
      path.join(fakeBin, 'npm'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "run" && "$2" == "build" ]]; then
  printf 'build\\n' >> "${commandLog}"
  exit 0
fi
printf 'unexpected npm invocation: %s\\n' "$*" >&2
exit 1
`,
      { mode: 0o755 },
    );

    const output = runBash(
      `
        source "${helper}"
        export PATH="${fakeBin}:\${PATH}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${tempRoot}/artifacts/runtime/next-root-contract"
        export waiter_pid=''
        start_waiter() {
          if [[ -n "\${waiter_pid}" ]]; then
            return 0
          fi
          next_generated_root_with_source_contract_lock waiter bash -lc 'printf entered > "${lockWaiterFile}"' &
          waiter_pid=$!
          sleep 0.05
          if [[ -f "${lockWaiterFile}" ]]; then
            printf 'waiter:entered-while-locked\\n' >> "${commandLog}"
          else
            printf 'waiter:blocked-while-locked\\n' >> "${commandLog}"
          fi
        }
        run_typegen() {
          start_waiter
          npx next typegen .
        }
        run_tsc() {
          start_waiter
          npx tsc --noEmit
        }
        run_build() {
          start_waiter
          npm run build
        }
        next_generated_root_run_locked_type_state_gate_sequence default_gate_root_state run_typegen run_tsc run_build
        for _i in $(seq 1 100); do
          if [[ -f "${lockWaiterFile}" ]]; then
            break
          fi
          sleep 0.02
        done
        if [[ -f "${lockWaiterFile}" ]]; then
          printf 'waiter:entered-after-unlock\\n' >> "${commandLog}"
        else
          printf 'waiter:missing-after-unlock\\n' >> "${commandLog}"
          exit 1
        fi
        cat "${commandLog}"
      `,
      tempRoot,
    );

    expect(output).toContain('waiter:blocked-while-locked');
    expect(output).toContain('waiter:entered-after-unlock');
    expect(output).toContain('typegen:stale-routes-cleared');
    expect(output).toMatch(/typegen:stale-routes-cleared[\s\S]*tsc[\s\S]*build/);
    expect(readFileSync(nextEnvPath, 'utf8')).toBe(canonicalNextEnv);
    expect(readFileSync(routesPath, 'utf8')).toContain('declare module "next"');
  });

  it('blocks validation prep when a live lane owner is still active even if the root contract is canonical', () => {
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

    expect(output).toContain('status=2');
    expect(output).toContain('active lane owner blocks validation cleanup');
    expect(output).toContain('stop the active lane');
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

  it('removes inactive stale lane web state before validation without rewriting canonical root files', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-stale-lane-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const runRoot = path.join(
      tempRoot,
      'artifacts/backend-real/runs/backend-real-20260412T190154Z-1498987-24516',
    );
    const lanePidFile = path.join(runRoot, 'web.pid');
    const nextPidFile = path.join(runRoot, 'next-dev.pid');
    const currentLink = path.join(tempRoot, 'artifacts/backend-real/current-run');

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
        printf '99999999\\n' > "${lanePidFile}"
        printf '99999998\\n' > "${nextPidFile}"
        ln -sfn "${runRoot}" "${currentLink}"
        source "${helper}"
        export NEXT_GENERATED_ROOT_ALLOWED_ACTIVE_RUN_ROOT="${runRoot}"
        next_generated_root_write_lane_owner "${runRoot}" "backend-real" "99999997" "run-integration-e2e-full.sh"
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
        if [[ -f "$(next_generated_root_lane_owner_file "${runRoot}")" ]]; then
          echo "owner_file=present"
        else
          echo "owner_file=removed"
        fi
        if [[ -L "${currentLink}" ]]; then
          echo "current_link=present"
        else
          echo "current_link=removed"
        fi
      `,
      tempRoot,
    );

    expect(output).toContain('status=0');
    expect(output).toContain('tsconfig=unchanged');
    expect(output).toContain('next_env=unchanged');
    expect(output).toContain('pid_file=removed');
    expect(output).toContain('next_pid_file=removed');
    expect(output).toContain('owner_file=removed');
    expect(output).toContain('current_link=removed');
    expect(JSON.parse(readFileSync(tsconfigPath, 'utf8')).include).toEqual(canonicalInclude);
    expect(readFileSync(nextEnvPath, 'utf8')).toBe(canonicalNextEnv);
  });

  it('allows validation prep inside the declared owning lane while keeping that lane state alive', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-owning-lane-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const runRoot = path.join(
      tempRoot,
      'artifacts/mock-lane/runs/mock-20260415T130154Z-1498987-24516',
    );
    const lanePidFile = path.join(runRoot, 'web.pid');
    const nextPidFile = path.join(runRoot, 'next-dev.pid');
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
        bash -lc 'exec -a "bash scripts/run-mock-lane-playwright.sh e2e/visual.spec.ts --project=visual" sleep 300' &
        owner_pid=$!
        bash -lc 'exec -a "bash scripts/run-next-dev-safe.sh --port 3001" sleep 300' &
        wrapper_pid=$!
        bash -lc 'exec -a "next dev --port 3001" sleep 300' &
        next_pid=$!
        printf '%s\\n' "\${wrapper_pid}" > "${lanePidFile}"
        printf '%s\\n' "\${next_pid}" > "${nextPidFile}"
        ln -sfn "${runRoot}" "${currentLink}"
        source "${helper}"
        export NEXT_GENERATED_ROOT_ALLOWED_ACTIVE_RUN_ROOT="${runRoot}"
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
        if kill -0 "\${wrapper_pid}" >/dev/null 2>&1; then
          echo "wrapper_process=alive"
        else
          echo "wrapper_process=stopped"
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
        if [[ -f "$(next_generated_root_lane_owner_file "${runRoot}")" ]]; then
          echo "owner_file=present"
        else
          echo "owner_file=removed"
        fi
        if [[ -L "${currentLink}" ]]; then
          echo "current_link=present"
        else
          echo "current_link=removed"
        fi
        kill "\${owner_pid}" "\${wrapper_pid}" "\${next_pid}" >/dev/null 2>&1 || true
        wait "\${owner_pid}" "\${wrapper_pid}" "\${next_pid}" >/dev/null 2>&1 || true
      `,
      tempRoot,
    );

    expect(output).toContain('status=0');
    expect(output).toContain('owner_process=alive');
    expect(output).toContain('wrapper_process=alive');
    expect(output).toContain('next_process=alive');
    expect(output).toContain('pid_file=present');
    expect(output).toContain('next_pid_file=present');
    expect(output).toContain('owner_file=present');
    expect(output).toContain('current_link=present');
    expect(JSON.parse(readFileSync(tsconfigPath, 'utf8')).include).toEqual(canonicalInclude);
    expect(readFileSync(nextEnvPath, 'utf8')).toBe(canonicalNextEnv);
  });

  it('normalizes stale backend-real current-run file and symlink aliases without touching run evidence', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-current-run-link-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const runRoot = path.join(
      tempRoot,
      'artifacts/backend-real/runs/backend-real-20260413T190154Z-1498987-24516',
    );
    const currentRun = path.join(tempRoot, 'artifacts/backend-real/current-run');

    const output = runBash(
      `
        set -e
        mkdir -p "${runRoot}" "$(dirname "${currentRun}")"
        printf 'real-run-evidence\\n' > "${runRoot}/evidence.txt"
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF_NEXT_ENV
        source "${helper}"
        printf 'legacy-file-alias\\n' > "${currentRun}"
        next_generated_root_normalize
        if [[ ! -e "${currentRun}" && ! -L "${currentRun}" ]]; then
          echo "file_alias=removed"
        fi
        ln -sfn "${runRoot}" "${currentRun}"
        next_generated_root_normalize
        if [[ ! -e "${currentRun}" && ! -L "${currentRun}" ]]; then
          echo "symlink_alias=removed"
        fi
        printf 'run_evidence=%s\\n' "$(cat "${runRoot}/evidence.txt")"
      `,
      tempRoot,
    );

    expect(output).toContain('file_alias=removed');
    expect(output).toContain('symlink_alias=removed');
    expect(output).toContain('run_evidence=real-run-evidence');
    expect(JSON.parse(readFileSync(tsconfigPath, 'utf8')).include).toEqual(canonicalInclude);
    expect(readFileSync(nextEnvPath, 'utf8')).toBe(canonicalNextEnv);
  });

  it('quarantines a stale backend-real current-run directory during mock-lane startup normalization', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-current-run-dir-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');
    const runRoot = path.join(
      tempRoot,
      'artifacts/backend-real/runs/backend-real-20260413T200154Z-1498987-24516',
    );
    const currentRun = path.join(tempRoot, 'artifacts/backend-real/current-run');

    const output = runBash(
      `
        set -e
        mkdir -p "${runRoot}" "${currentRun}/nested"
        printf 'real-run-evidence\\n' > "${runRoot}/evidence.txt"
        printf 'stale-directory-evidence\\n' > "${currentRun}/nested/marker.txt"
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF_NEXT_ENV
        source "${helper}"
        next_generated_root_normalize
        if [[ ! -e "${currentRun}" && ! -L "${currentRun}" ]]; then
          echo "current_run=normalized"
        fi
        legacy_dir="$(find "${tempRoot}/artifacts/backend-real" -mindepth 1 -maxdepth 1 -type d -name 'current-run-legacy-*' | head -n 1)"
        if [[ -n "\${legacy_dir}" ]]; then
          echo "legacy_dir=present"
          printf 'legacy_marker=%s\\n' "$(cat "\${legacy_dir}/nested/marker.txt")"
        fi
        printf 'run_evidence=%s\\n' "$(cat "${runRoot}/evidence.txt")"
      `,
      tempRoot,
    );

    expect(output).toContain('current_run=normalized');
    expect(output).toContain('legacy_dir=present');
    expect(output).toContain('legacy_marker=stale-directory-evidence');
    expect(output).toContain('run_evidence=real-run-evidence');
    expect(JSON.parse(readFileSync(tsconfigPath, 'utf8')).include).toEqual(canonicalInclude);
    expect(readFileSync(nextEnvPath, 'utf8')).toBe(canonicalNextEnv);
  });

  it('blocks validation prep on polluted root files without rewriting root contract or cleaning live lane state', () => {
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

    expect(output).toContain('status=2');
    expect(output).toContain('tsconfig=unchanged');
    expect(output).toContain('next_env=unchanged');
    expect(output).toContain('lane_process=alive');
    expect(output).toContain('next_process=alive');
    expect(output).toContain('current_link=present');
    expect(output).toContain('active lane owner blocks validation cleanup');
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
