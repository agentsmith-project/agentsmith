import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type SpawnedChild = ReturnType<typeof spawn>;

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

function setupTempRoot(): { rootDir: string; fakeBin: string } {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'run-next-dev-safe-'));
  mkdirSync(path.join(rootDir, 'scripts/lib'), { recursive: true });
  mkdirSync(path.join(rootDir, 'artifacts/runtime'), { recursive: true });
  cpSync(path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh'), path.join(rootDir, 'scripts/lib/next-generated-root-state.sh'));

  writeFileSync(
    path.join(rootDir, 'tsconfig.json'),
    `${JSON.stringify({ include: canonicalInclude }, null, 2)}\n`,
  );
  writeFileSync(path.join(rootDir, 'next-env.d.ts'), canonicalNextEnv);

  const fakeBin = path.join(rootDir, 'bin');
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(
    path.join(fakeBin, 'next'),
    `#!/usr/bin/env bash
set -euo pipefail
cat > "${rootDir}/tsconfig.json" <<'EOF_TSCONFIG'
{"include":["artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/**/*.ts","next-env.d.ts"]}
EOF_TSCONFIG
cat > "${rootDir}/next-env.d.ts" <<'EOF_NEXT_ENV'
/// <reference path="./artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
exit 0
`,
    { mode: 0o755 },
  );

  return { rootDir, fakeBin };
}

function runNodeOptionsProbe(envOverrides: Record<string, string>): {
  nodeOptions: string;
  profile: string;
} {
  const { rootDir, fakeBin } = setupTempRoot();
  const nodeOptionsLog = path.join(rootDir, 'node-options.log');
  const profileLog = path.join(rootDir, 'profile.log');

  writeFileSync(
    path.join(fakeBin, 'next'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "\${NODE_OPTIONS:-}" > "${nodeOptionsLog}"
printf '%s\\n' "\${NEXT_DEV_MEMORY_PROFILE:-}" > "${profileLog}"
exit 0
`,
    { mode: 0o755 },
  );

  execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
    cwd: rootDir,
    env: {
      ...process.env,
      ROOT_DIR: rootDir,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      NODE_OPTIONS: '',
      NEXT_DEV_LOCAL_MAX_OLD_SPACE_SIZE: '',
      NEXT_DEV_MEMORY_PROFILE: '',
      NEXT_DEV_VALIDATION_MAX_OLD_SPACE_SIZE: '',
      NEXT_MAX_OLD_SPACE_SIZE: '',
      ...envOverrides,
    },
    stdio: 'pipe',
  });

  return {
    nodeOptions: readFileSync(nodeOptionsLog, 'utf8').trim(),
    profile: readFileSync(profileLog, 'utf8').trim(),
  };
}

function installProbeRaceHook(args: {
  rootDir: string;
  restoredTsconfig?: string;
  restoreDelaySeconds?: number;
}): void {
  const helperPath = path.join(args.rootDir, 'scripts/lib/next-generated-root-state.sh');
  const tsconfigPath = path.join(args.rootDir, 'tsconfig.json');
  const restoreSnippet = args.restoredTsconfig
    ? `(
  sleep ${args.restoreDelaySeconds ?? 0.12}
  cat > "${tsconfigPath}" <<'EOF_RESTORED_TSCONFIG'
${args.restoredTsconfig}
EOF_RESTORED_TSCONFIG
) &`
    : '';

  writeFileSync(
    helperPath,
    `${readFileSync(helperPath, 'utf8')}
eval "$(declare -f next_generated_root_probe_source_contract_once | sed '1s/next_generated_root_probe_source_contract_once/next_generated_root_test_original_probe_source_contract_once/')"
next_generated_root_probe_source_contract_once() {
  local output
  output="$(next_generated_root_test_original_probe_source_contract_once "$@")"
  if [[ -z "\${NEXT_GENERATED_ROOT_TEST_RACE_TRIGGERED:-}" && "\${output}" == $'semantic_drift\\t'* ]]; then
    export NEXT_GENERATED_ROOT_TEST_RACE_TRIGGERED=1
    cat > "${tsconfigPath}" <<'EOF_HALF_WRITTEN_TSCONFIG'
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

function runBackgroundRestoreTsconfig(args: {
  rootDir: string;
  delaySeconds: number;
}): ReturnType<typeof spawn> {
  return spawn(
    'bash',
    [
      '-lc',
      `
        sleep ${args.delaySeconds}
        cat > "${path.join(args.rootDir, 'tsconfig.json')}" <<'EOF_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_TSCONFIG
      `,
    ],
    {
      cwd: args.rootDir,
      env: {
        ...process.env,
      },
      stdio: 'pipe',
    },
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      return;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for file: ${file}`);
}

async function waitForChildExit(child: SpawnedChild, timeoutMs = 5000): Promise<number> {
  if (child.exitCode !== null) {
    return child.exitCode;
  }
  if (child.signalCode !== null) {
    return 0;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out waiting for child process ${child.pid ?? 'unknown'} to exit`));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function terminateChild(child: SpawnedChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  try {
    await waitForChildExit(child, 5000);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}

function readRootContract(rootDir: string): {
  tsconfig: {
    compilerOptions?: { strict?: boolean; baseUrl?: string; paths?: Record<string, string[]> };
    include: string[];
    references?: Array<{ path: string }>;
  };
  nextEnv: string;
} {
  return {
    tsconfig: JSON.parse(readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { strict?: boolean; baseUrl?: string; paths?: Record<string, string[]> };
      include: string[];
      references?: Array<{ path: string }>;
    },
    nextEnv: readFileSync(path.join(rootDir, 'next-env.d.ts'), 'utf8'),
  };
}

function hasExpectedConcurrentFields(tsconfig: ReturnType<typeof readRootContract>['tsconfig']): boolean {
  return (
    tsconfig.compilerOptions?.strict === false
    && tsconfig.compilerOptions?.baseUrl === '.'
    && JSON.stringify(tsconfig.compilerOptions?.paths) === JSON.stringify({ '@custom/*': ['custom/*'] })
    && JSON.stringify(tsconfig.references) === JSON.stringify([{ path: './tsconfig.node.json' }])
  );
}

async function waitForConcurrentContractRepair(rootDir: string, timeoutMs = 5000): Promise<ReturnType<typeof readRootContract>> {
  const deadline = Date.now() + timeoutMs;
  let lastState = readRootContract(rootDir);
  while (Date.now() < deadline) {
    lastState = readRootContract(rootDir);
    const includeIsCanonical = JSON.stringify(lastState.tsconfig.include) === JSON.stringify(canonicalInclude);
    if (
      includeIsCanonical
      && hasExpectedConcurrentFields(lastState.tsconfig)
      && lastState.nextEnv === canonicalNextEnv
    ) {
      return lastState;
    }
    if (includeIsCanonical && !hasExpectedConcurrentFields(lastState.tsconfig)) {
      throw new Error(`Root repair dropped concurrent tsconfig fields: ${JSON.stringify(lastState.tsconfig, null, 2)}`);
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for concurrent root repair. Last tsconfig: ${JSON.stringify(lastState.tsconfig, null, 2)}`);
}

async function waitForCanonicalRootContract(rootDir: string, timeoutMs = 5000): Promise<ReturnType<typeof readRootContract>> {
  const deadline = Date.now() + timeoutMs;
  let lastState = readRootContract(rootDir);
  while (Date.now() < deadline) {
    lastState = readRootContract(rootDir);
    if (
      JSON.stringify(lastState.tsconfig.include) === JSON.stringify(canonicalInclude)
      && lastState.nextEnv === canonicalNextEnv
    ) {
      return lastState;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for canonical root contract. Last tsconfig: ${JSON.stringify(lastState.tsconfig, null, 2)}`);
}

function installDedicatedFinalReconcileProbe(rootDir: string): string {
  const helperPath = path.join(rootDir, 'scripts/lib/next-generated-root-state.sh');
  const markerFile = path.join(rootDir, 'artifacts/runtime/final-reconcile.log');

  writeFileSync(
    helperPath,
    `${readFileSync(helperPath, 'utf8')}
next_generated_root_finalize_source_contract() {
  return 0
}

next_generated_root_final_reconcile_source_contract() {
  mkdir -p "$(dirname "${markerFile}")"
  printf 'final_reconcile\\n' >> "${markerFile}"
  next_generated_root_repair_source_contract final_reconcile
}
`,
  );

  return markerFile;
}

describe('run-next-dev-safe', () => {
  it('keeps the interactive heap default while validation lanes raise the restart threshold', () => {
    const interactive = runNodeOptionsProbe({});
    const validation = runNodeOptionsProbe({
      NEXT_DEV_MEMORY_PROFILE: 'validation',
    });

    expect(interactive.profile).toBe('interactive');
    expect(interactive.nodeOptions).toBe('--max-old-space-size=4096');
    expect(validation.profile).toBe('validation');
    expect(validation.nodeOptions).toBe('--max-old-space-size=12288');
  });

  it('lets validation callers override the Next dev heap ceiling explicitly', () => {
    const probe = runNodeOptionsProbe({
      NEXT_DEV_MEMORY_PROFILE: 'validation',
      NEXT_MAX_OLD_SPACE_SIZE: '16384',
      NODE_OPTIONS: '--trace-warnings',
    });

    expect(probe.profile).toBe('validation');
    expect(probe.nodeOptions).toBe('--trace-warnings --max-old-space-size=16384');
  });

  it('does not normalize root files unless NEXT_GENERATED_ROOT_MANAGED=1', () => {
    const { rootDir, fakeBin } = setupTempRoot();

    execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      },
      stdio: 'pipe',
    });

    expect(readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8')).toContain('/integration-20260410T062839Z-3559213-15947/');
    expect(readFileSync(path.join(rootDir, 'next-env.d.ts'), 'utf8')).toContain('/integration-20260410T062839Z-3559213-15947/');
  });

  it('preserves concurrent non-include tsconfig edits while managed mode repairs include drift', async () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const readyFile = path.join(rootDir, 'managed-ready');

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
cat > "${rootDir}/tsconfig.json" <<'EOF_TSCONFIG'
{"include":["artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/**/*.ts","next-env.d.ts"]}
EOF_TSCONFIG
cat > "${rootDir}/next-env.d.ts" <<'EOF_NEXT_ENV'
/// <reference path="./artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
printf 'ready\\n' > "${readyFile}"
trap 'exit 0' TERM INT
while true; do sleep 1; done
`,
      { mode: 0o755 },
    );

    const child = spawn('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NEXT_GENERATED_ROOT_MANAGED: '1',
        NEXT_GENERATED_ROOT_STATE_DIR: path.join(rootDir, 'artifacts/runtime/local-manual-root-contract'),
      },
      stdio: 'pipe',
    });

    try {
      await waitForFile(readyFile);

      writeFileSync(
        path.join(rootDir, 'tsconfig.json'),
        `${JSON.stringify({
          compilerOptions: {
            strict: false,
            baseUrl: '.',
            paths: {
              '@custom/*': ['custom/*'],
            },
          },
          include: ['artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts', 'next-env.d.ts'],
          references: [{ path: './tsconfig.node.json' }],
        }, null, 2)}\n`,
      );

      const { tsconfig, nextEnv } = await waitForConcurrentContractRepair(rootDir);
      expect(tsconfig.include).toEqual(canonicalInclude);
      expect(tsconfig.compilerOptions).toEqual({
        strict: false,
        baseUrl: '.',
        paths: {
          '@custom/*': ['custom/*'],
        },
      });
      expect(tsconfig.references).toEqual([{ path: './tsconfig.node.json' }]);
      expect(nextEnv).toBe(canonicalNextEnv);
    } finally {
      await terminateChild(child);
    }
  });

  it('keeps root files canonical while managed next dev is still running', async () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const readyFile = path.join(rootDir, 'child-ready');

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
cat > "${rootDir}/tsconfig.json" <<'EOF_TSCONFIG'
{"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"]}
EOF_TSCONFIG
cat > "${rootDir}/next-env.d.ts" <<'EOF_NEXT_ENV'
/// <reference path="./artifacts/runtime/lines/local-manual/current/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
printf 'ready\\n' > "${readyFile}"
trap 'exit 0' TERM INT
while true; do sleep 1; done
`,
      { mode: 0o755 },
    );

    const child = spawn('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NEXT_GENERATED_ROOT_MANAGED: '1',
        NEXT_GENERATED_ROOT_STATE_DIR: path.join(rootDir, 'artifacts/runtime/local-manual-root-contract'),
      },
      stdio: 'pipe',
    });

    try {
      await waitForFile(readyFile);

      const { tsconfig, nextEnv } = await waitForCanonicalRootContract(rootDir);
      expect(tsconfig.include).toEqual(canonicalInclude);
      expect(nextEnv).toBe(canonicalNextEnv);
    } finally {
      await terminateChild(child);
    }
  });

  it('repairs the contract-owned root surface after a managed child exits immediately with drift', () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const finalReconcileMarker = installDedicatedFinalReconcileProbe(rootDir);

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
trap 'cat > "${rootDir}/tsconfig.json" <<'"'"'EOF_TSCONFIG'"'"'
{"include":["artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/**/*.ts","next-env.d.ts"],"compilerOptions":{"strict":false}}
EOF_TSCONFIG
cat > "${rootDir}/next-env.d.ts" <<'"'"'EOF_NEXT_ENV'"'"'
/// <reference path="./artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
' EXIT
exit 0
`,
      { mode: 0o755 },
    );

    execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NEXT_GENERATED_ROOT_MANAGED: '1',
        NEXT_GENERATED_ROOT_GUARD_INTERVAL_SEC: '5',
        NEXT_GENERATED_ROOT_STATE_DIR: path.join(rootDir, 'artifacts/runtime/local-manual-root-contract'),
      },
      stdio: 'pipe',
    });

    const tsconfig = JSON.parse(readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { strict?: boolean };
      include: string[];
    };
    const nextEnv = readFileSync(path.join(rootDir, 'next-env.d.ts'), 'utf8');
    expect(tsconfig.include).toEqual(canonicalInclude);
    expect(tsconfig.compilerOptions).toEqual({ strict: false });
    expect(nextEnv).toBe(canonicalNextEnv);
    expect(readFileSync(finalReconcileMarker, 'utf8')).toContain('final_reconcile');
  });

  it('repairs the contract-owned root surface after wrapper cleanup terminates the managed child', async () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const readyFile = path.join(rootDir, 'cleanup-final-reconcile.ready');
    const finalReconcileMarker = installDedicatedFinalReconcileProbe(rootDir);

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
trap 'cat > "${rootDir}/tsconfig.json" <<'"'"'EOF_TSCONFIG'"'"'
{"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"],"compilerOptions":{"jsx":"preserve"}}
EOF_TSCONFIG
cat > "${rootDir}/next-env.d.ts" <<'"'"'EOF_NEXT_ENV'"'"'
/// <reference path="./artifacts/runtime/lines/local-manual/current/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
exit 0' EXIT
trap 'exit 0' TERM INT
printf 'ready\\n' > "${readyFile}"
while true; do sleep 1; done
`,
      { mode: 0o755 },
    );

    const child = spawn('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NEXT_GENERATED_ROOT_MANAGED: '1',
        NEXT_GENERATED_ROOT_GUARD_INTERVAL_SEC: '5',
        NEXT_GENERATED_ROOT_STATE_DIR: path.join(rootDir, 'artifacts/runtime/local-manual-root-contract'),
      },
      stdio: 'pipe',
    });

    const deadline = Date.now() + 5000;
    while (!existsSync(readyFile) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(existsSync(readyFile)).toBe(true);

    child.kill('SIGTERM');
    await new Promise<number>((resolve, reject) => {
      child.on('exit', (code) => resolve(code ?? 0));
      child.on('error', reject);
    });

    const tsconfig = JSON.parse(readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { jsx?: string };
      include: string[];
    };
    const nextEnv = readFileSync(path.join(rootDir, 'next-env.d.ts'), 'utf8');
    expect(tsconfig.include).toEqual(canonicalInclude);
    expect(tsconfig.compilerOptions).toEqual({ jsx: 'preserve' });
    expect(nextEnv).toBe(canonicalNextEnv);
    expect(readFileSync(finalReconcileMarker, 'utf8')).toContain('final_reconcile');
  });

  it('does not resurrect or delete next-env.d.ts on cleanup based on startup presence', async () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const readyFile = path.join(rootDir, 'cleanup-ready');

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'ready\\n' > "${readyFile}"
trap 'exit 0' TERM INT
while true; do sleep 1; done
`,
      { mode: 0o755 },
    );

    const cases = [
      {
        label: 'keeps a file deleted during the run deleted',
        initialState: 'present' as const,
        mutateDuringRun() {
          writeFileSync(path.join(rootDir, 'next-env.d.ts'), canonicalNextEnv);
          writeFileSync(
            path.join(rootDir, 'tsconfig.json'),
            `${JSON.stringify({ include: canonicalInclude }, null, 2)}\n`,
          );
          rmSync(path.join(rootDir, 'next-env.d.ts'));
        },
        expectState() {
          expect(existsSync(path.join(rootDir, 'next-env.d.ts'))).toBe(false);
        },
      },
      {
        label: 'keeps a file created during the run present',
        initialState: 'absent' as const,
        mutateDuringRun() {
          rmSync(path.join(rootDir, 'next-env.d.ts'), { force: true });
          writeFileSync(
            path.join(rootDir, 'tsconfig.json'),
            `${JSON.stringify({ include: canonicalInclude }, null, 2)}\n`,
          );
          writeFileSync(path.join(rootDir, 'next-env.d.ts'), canonicalNextEnv);
        },
        expectState() {
          expect(readFileSync(path.join(rootDir, 'next-env.d.ts'), 'utf8')).toBe(canonicalNextEnv);
        },
      },
    ];

    for (const testCase of cases) {
      if (testCase.initialState === 'present') {
        writeFileSync(path.join(rootDir, 'next-env.d.ts'), canonicalNextEnv);
      } else {
        rmSync(path.join(rootDir, 'next-env.d.ts'), { force: true });
      }

      const child = spawn('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
        cwd: rootDir,
        env: {
          ...process.env,
          ROOT_DIR: rootDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          NEXT_GENERATED_ROOT_MANAGED: '1',
          NEXT_GENERATED_ROOT_STATE_DIR: path.join(rootDir, 'artifacts/runtime/local-manual-root-contract'),
        },
        stdio: 'pipe',
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(existsSync(readyFile)).toBe(true);
      testCase.mutateDuringRun();

      child.kill('SIGTERM');
      await new Promise<number>((resolve, reject) => {
        child.on('exit', (code) => resolve(code ?? 0));
        child.on('error', reject);
      });

      testCase.expectState();
      rmSync(readyFile, { force: true });
    }
  });

  it('stops the spawned Next process tree when the wrapper exits', async () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const childPidFile = path.join(rootDir, 'child.pid');

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
sleep 300 &
child_pid=$!
printf '%s\\n' "\${child_pid}" > "${childPidFile}"
trap 'exit 0' TERM INT
while true; do sleep 1; done
`,
      { mode: 0o755 },
    );

    const child = spawn('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      },
      stdio: 'pipe',
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    const spawnedChildPid = Number.parseInt(readFileSync(childPidFile, 'utf8').trim(), 10);
    expect(Number.isNaN(spawnedChildPid)).toBe(false);

    child.kill('SIGTERM');
    await new Promise<number>((resolve, reject) => {
      child.on('exit', (code) => resolve(code ?? 0));
      child.on('error', reject);
    });

    let childStillAlive = false;
    try {
      process.kill(spawnedChildPid, 0);
      childStillAlive = true;
    } catch {
      childStillAlive = false;
    }

    expect(childStillAlive).toBe(false);
  });

  it('writes the web process sidecar when the authoritative child pid is established', async () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const readyFile = path.join(rootDir, 'writer-ready');
    const processStateFile = path.join(rootDir, 'artifacts/runtime/lines/local-manual/current/web.process.json');
    const pidFile = path.join(rootDir, 'artifacts/runtime/lines/local-manual/current/web.pid');

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'ready\\n' > "${readyFile}"
trap 'exit 0' TERM INT
while true; do sleep 1; done
`,
      { mode: 0o755 },
    );

    const child = spawn('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NEXT_DEV_PID_FILE: pidFile,
        NEXT_DEV_PORT_FILE: path.join(rootDir, 'artifacts/runtime/lines/local-manual/current/web.port'),
        NEXT_DEV_PORT: '3101',
        NEXT_DEV_PROCESS_STATE_FILE: processStateFile,
      },
      stdio: 'pipe',
    });

    const deadline = Date.now() + 5000;
    while ((!existsSync(readyFile) || !existsSync(processStateFile)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(existsSync(readyFile)).toBe(true);
    expect(existsSync(processStateFile)).toBe(true);

    const authoritativePid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    const sidecar = JSON.parse(readFileSync(processStateFile, 'utf8')) as {
      schema_version: number;
      kind: string;
      pid: number;
      port: number;
      command: string;
      cwd: string;
      process_identity: {
        token: string;
        source: string;
      };
      captured_by: string;
    };

    expect(sidecar.schema_version).toBe(1);
    expect(sidecar.kind).toBe('web');
    expect(sidecar.pid).toBe(authoritativePid);
    expect(sidecar.port).toBe(3101);
    expect(sidecar.command).toContain(path.join(fakeBin, 'next'));
    expect(sidecar.cwd).toBe(rootDir);
    expect(sidecar.process_identity.token.length).toBeGreaterThan(0);
    expect(sidecar.process_identity.source.length).toBeGreaterThan(0);
    expect(sidecar.captured_by).toBe('run-next-dev-safe');

    child.kill('SIGTERM');
    await new Promise<number>((resolve, reject) => {
      child.on('exit', (code) => resolve(code ?? 0));
      child.on('error', reject);
    });
  });

  it('reports child signal exits for observability when next dev terminates unexpectedly', () => {
    const { rootDir, fakeBin } = setupTempRoot();

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
kill -KILL $$
`,
      { mode: 0o755 },
    );

    let error: unknown;
    try {
      execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
        cwd: rootDir,
        env: {
          ...process.env,
          ROOT_DIR: rootDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    const stderr = String((error as { stderr?: Buffer | string }).stderr ?? '');
    expect(stderr).toContain('[next-dev-safe] next dev child exited due to signal 9');
  });

  it('writes a child exit marker when next dev terminates unexpectedly', () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const exitMarkerFile = path.join(rootDir, 'artifacts/runtime/next-dev-exit.json');

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
kill -KILL $$
`,
      { mode: 0o755 },
    );

    let error: unknown;
    try {
      execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
        cwd: rootDir,
        env: {
          ...process.env,
          ROOT_DIR: rootDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          NEXT_DEV_EXIT_MARKER_FILE: exitMarkerFile,
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(existsSync(exitMarkerFile)).toBe(true);
    const exitMarker = JSON.parse(readFileSync(exitMarkerFile, 'utf8')) as {
      event: string;
      exit_status: number;
      signal: number | null;
      wrapper_pid: number;
      child_pid: number | null;
    };
    expect(exitMarker.event).toBe('child_exit');
    expect(exitMarker.exit_status).toBe(137);
    expect(exitMarker.signal).toBe(9);
    expect(exitMarker.wrapper_pid).toBeGreaterThan(0);
    expect(exitMarker.child_pid).toBeGreaterThan(0);
  });

  it('writes process-state from the authoritative next-dev child pid when configured', async () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const readyFile = path.join(rootDir, 'child-ready');
    const processStateFile = path.join(rootDir, 'artifacts/runtime/web.process.json');

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'ready\\n' > "${readyFile}"
trap 'exit 0' TERM INT
while true; do sleep 1; done
`,
      { mode: 0o755 },
    );

    const child = spawn('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NEXT_DEV_PID_FILE: path.join(rootDir, 'artifacts/runtime/web.pid'),
        NEXT_DEV_PORT_FILE: path.join(rootDir, 'artifacts/runtime/web.port'),
        NEXT_DEV_PORT: '3101',
        NEXT_DEV_PROCESS_STATE_FILE: processStateFile,
        NEXT_DEV_PROCESS_KIND: 'web',
        NEXT_DEV_PROCESS_CAPTURED_BY: 'run-next-dev-safe.test',
      },
      stdio: 'pipe',
    });

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (existsSync(readyFile) && existsSync(processStateFile)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(existsSync(readyFile)).toBe(true);
    expect(existsSync(processStateFile)).toBe(true);

    const trackedPid = Number.parseInt(readFileSync(path.join(rootDir, 'artifacts/runtime/web.pid'), 'utf8').trim(), 10);
    const processState = JSON.parse(readFileSync(processStateFile, 'utf8')) as {
      schema_version: number;
      kind: string;
      pid: number;
      port: number;
      command: string;
      cwd: string;
      process_identity: {
        token: string;
        source: string;
      };
      captured_by: string;
    };

    expect(processState.schema_version).toBe(1);
    expect(processState.kind).toBe('web');
    expect(processState.pid).toBe(trackedPid);
    expect(processState.port).toBe(3101);
    expect(processState.command.length).toBeGreaterThan(0);
    expect(processState.cwd).toBe(rootDir);
    expect(processState.process_identity.token.length).toBeGreaterThan(0);
    expect(processState.process_identity.source.length).toBeGreaterThan(0);
    expect(processState.captured_by).toBe('run-next-dev-safe.test');

    child.kill('SIGTERM');
    await new Promise<number>((resolve, reject) => {
      child.on('exit', (code) => resolve(code ?? 0));
      child.on('error', reject);
    });
  });

  it('refuses to launch a second managed dev server when a verified process-state owner is active', async () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const readyFile = path.join(rootDir, 'first-ready');
    const launchedMarker = path.join(rootDir, 'second-launched');
    const pidFile = path.join(rootDir, 'artifacts/runtime/web.pid');
    const processStateFile = path.join(rootDir, 'artifacts/runtime/web.process.json');

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'ready\\n' > "${readyFile}"
trap 'exit 0' TERM INT
while true; do sleep 1; done
`,
      { mode: 0o755 },
    );

    const first = spawn('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh'), '--port', '3101'], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NEXT_GENERATED_ROOT_MANAGED: '1',
        NEXT_DEV_PID_FILE: pidFile,
        NEXT_DEV_PORT_FILE: path.join(rootDir, 'artifacts/runtime/web.port'),
        NEXT_DEV_PORT: '3101',
        NEXT_DEV_PROCESS_STATE_FILE: processStateFile,
      },
      stdio: 'pipe',
    });

    const deadline = Date.now() + 5_000;
    while ((!existsSync(readyFile) || !existsSync(processStateFile)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(existsSync(readyFile)).toBe(true);
    expect(existsSync(processStateFile)).toBe(true);

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'launched\\n' > "${launchedMarker}"
exit 0
`,
      { mode: 0o755 },
    );

    let error: unknown;
    try {
      execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh'), '--port', '3101'], {
        cwd: rootDir,
        env: {
          ...process.env,
          ROOT_DIR: rootDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          NEXT_GENERATED_ROOT_MANAGED: '1',
          NEXT_DEV_PID_FILE: pidFile,
          NEXT_DEV_PORT_FILE: path.join(rootDir, 'artifacts/runtime/web.port'),
          NEXT_DEV_PORT: '3101',
          NEXT_DEV_PROCESS_STATE_FILE: processStateFile,
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    } finally {
      first.kill('SIGTERM');
      await new Promise<number>((resolve, reject) => {
        first.on('exit', (code) => resolve(code ?? 0));
        first.on('error', reject);
      });
    }

    expect(error).toBeDefined();
    expect(existsSync(launchedMarker)).toBe(false);
    const stderr = String((error as { stderr?: Buffer | string }).stderr ?? '');
    expect(stderr).toContain('active Next.js dev process already owns this workspace');
  });

  it('fails fast in managed mode when the source root is already polluted before launch', () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const launchedMarker = path.join(rootDir, 'child-launched');

    writeFileSync(
      path.join(rootDir, 'tsconfig.json'),
      `${JSON.stringify({ include: ['artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts', 'next-env.d.ts'] }, null, 2)}\n`,
    );
    writeFileSync(
      path.join(rootDir, 'next-env.d.ts'),
      '/// <reference path="./artifacts/runtime/lines/local-manual/current/next-dist/types/routes.d.ts" />\n',
    );
    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'launched\\n' > "${launchedMarker}"
exit 0
`,
      { mode: 0o755 },
    );

    let error: unknown;
    try {
      execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
        cwd: rootDir,
        env: {
          ...process.env,
          ROOT_DIR: rootDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          NEXT_GENERATED_ROOT_MANAGED: '1',
          NEXT_GENERATED_ROOT_STATE_DIR: path.join(rootDir, 'artifacts/runtime/local-manual-root-contract'),
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    const stderr = String((error as { stderr?: Buffer | string }).stderr ?? '');
    expect(stderr).toContain('root source contract drift detected');
    expect(existsSync(launchedMarker)).toBe(false);
  });

  it('waits through a transient unreadable root contract before launching the managed child', async () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const launchedMarker = path.join(rootDir, 'child-launched');

    writeFileSync(path.join(rootDir, 'tsconfig.json'), '{"include":\n');
    writeFileSync(path.join(rootDir, 'next-env.d.ts'), canonicalNextEnv);
    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'launched\\n' > "${launchedMarker}"
exit 0
`,
      { mode: 0o755 },
    );

    const restore = runBackgroundRestoreTsconfig({
      rootDir,
      delaySeconds: 0.15,
    });

    execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NEXT_GENERATED_ROOT_MANAGED: '1',
        NEXT_GENERATED_ROOT_PREPARE_RETRY_COUNT: '8',
        NEXT_GENERATED_ROOT_PREPARE_RETRY_DELAY_SEC: '0.05',
        NEXT_GENERATED_ROOT_STATE_DIR: path.join(rootDir, 'artifacts/runtime/local-manual-root-contract'),
      },
      stdio: 'pipe',
    });

    await new Promise<void>((resolve, reject) => {
      restore.on('exit', () => resolve());
      restore.on('error', reject);
    });

    expect(existsSync(launchedMarker)).toBe(true);
    expect(JSON.parse(readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8'))).toEqual({
      include: canonicalInclude,
    });
  });

  it('fails managed startup with unreadable-root-specific semantics when the root stays half-written', () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const launchedMarker = path.join(rootDir, 'child-launched');
    const eventFile = path.join(
      rootDir,
      'artifacts/runtime/local-manual-root-contract/source-contract-events.jsonl',
    );

    writeFileSync(path.join(rootDir, 'tsconfig.json'), '{"include":\n');
    writeFileSync(path.join(rootDir, 'next-env.d.ts'), canonicalNextEnv);
    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'launched\\n' > "${launchedMarker}"
exit 0
`,
      { mode: 0o755 },
    );

    let error: unknown;
    try {
      execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
        cwd: rootDir,
        env: {
          ...process.env,
          ROOT_DIR: rootDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          NEXT_GENERATED_ROOT_MANAGED: '1',
          NEXT_GENERATED_ROOT_PREPARE_RETRY_COUNT: '2',
          NEXT_GENERATED_ROOT_PREPARE_RETRY_DELAY_SEC: '0.02',
          NEXT_GENERATED_ROOT_STATE_DIR: path.join(rootDir, 'artifacts/runtime/local-manual-root-contract'),
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    const stderr = String((error as { stderr?: Buffer | string }).stderr ?? '');
    expect(stderr).toContain('persistent_unreadable');
    expect(stderr).not.toContain('root source contract drift detected');
    expect(existsSync(launchedMarker)).toBe(false);
    expect(existsSync(eventFile)).toBe(true);
    expect(readFileSync(eventFile, 'utf8')).toContain('"status":"persistent_unreadable"');
    expect(readFileSync(eventFile, 'utf8')).toContain('"phase":"prepare_for_validation"');
  });

  it('managed fast-exit finalize waits through transient unreadable after drift before reconciling', async () => {
    const { rootDir, fakeBin } = setupTempRoot();
    installProbeRaceHook({
      rootDir,
      restoredTsconfig: '{"compilerOptions":{"strict":false},"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"],"references":[{"path":"./tsconfig.node.json"}]}',
      restoreDelaySeconds: 0.12,
    });

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
trap 'cat > "${rootDir}/tsconfig.json" <<'"'"'EOF_DIRTY'"'"'
{"compilerOptions":{"strict":false},"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"],"references":[{"path":"./tsconfig.node.json"}]}
EOF_DIRTY
cat > "${rootDir}/next-env.d.ts" <<'"'"'EOF_NEXT_ENV'"'"'
/// <reference path="./artifacts/runtime/lines/local-manual/current/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
' EXIT
exit 0
`,
      { mode: 0o755 },
    );

    execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NEXT_GENERATED_ROOT_MANAGED: '1',
        NEXT_GENERATED_ROOT_GUARD_INTERVAL_SEC: '5',
        NEXT_GENERATED_ROOT_FINALIZE_RETRY_COUNT: '8',
        NEXT_GENERATED_ROOT_FINALIZE_RETRY_DELAY_SEC: '0.05',
        NEXT_GENERATED_ROOT_STATE_DIR: path.join(rootDir, 'artifacts/runtime/local-manual-root-contract'),
      },
      stdio: 'pipe',
    });

    const tsconfig = JSON.parse(readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8')) as {
      compilerOptions?: { strict?: boolean };
      include: string[];
      references?: Array<{ path: string }>;
    };
    const nextEnv = readFileSync(path.join(rootDir, 'next-env.d.ts'), 'utf8');
    expect(tsconfig.include).toEqual(canonicalInclude);
    expect(tsconfig.compilerOptions).toEqual({ strict: false });
    expect(tsconfig.references).toEqual([{ path: './tsconfig.node.json' }]);
    expect(nextEnv).toBe(canonicalNextEnv);
  });

  it('managed fast-exit finalize surfaces persistent_unreadable semantics instead of raw parse failure', () => {
    const { rootDir, fakeBin } = setupTempRoot();
    const eventFile = path.join(
      rootDir,
      'artifacts/runtime/local-manual-root-contract/source-contract-events.jsonl',
    );
    installProbeRaceHook({
      rootDir,
    });

    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
trap 'cat > "${rootDir}/tsconfig.json" <<'"'"'EOF_DIRTY'"'"'
{"compilerOptions":{"strict":false},"include":["artifacts/runtime/lines/local-manual/current/next-dist/types/**/*.ts","next-env.d.ts"]}
EOF_DIRTY
cat > "${rootDir}/next-env.d.ts" <<'"'"'EOF_NEXT_ENV'"'"'
/// <reference path="./artifacts/runtime/lines/local-manual/current/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
' EXIT
exit 0
`,
      { mode: 0o755 },
    );

    let error: unknown;
    try {
      execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
        cwd: rootDir,
        env: {
          ...process.env,
          ROOT_DIR: rootDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          NEXT_GENERATED_ROOT_MANAGED: '1',
          NEXT_GENERATED_ROOT_GUARD_INTERVAL_SEC: '5',
          NEXT_GENERATED_ROOT_FINALIZE_RETRY_COUNT: '2',
          NEXT_GENERATED_ROOT_FINALIZE_RETRY_DELAY_SEC: '0.02',
          NEXT_GENERATED_ROOT_STATE_DIR: path.join(rootDir, 'artifacts/runtime/local-manual-root-contract'),
        },
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    const stderr = String((error as { stderr?: Buffer | string }).stderr ?? '');
    expect(stderr).toContain('persistent_unreadable');
    expect(stderr).not.toContain('Unexpected token');
    expect(stderr).not.toContain('JSON');
    expect(existsSync(eventFile)).toBe(true);
    expect(readFileSync(eventFile, 'utf8')).toContain('"phase":"final_reconcile"');
    expect(readFileSync(eventFile, 'utf8')).toContain('"status":"persistent_unreadable"');
  });
});
