import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function setupTempRoot(): { rootDir: string; fakeBin: string } {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'run-next-dev-safe-'));
  mkdirSync(path.join(rootDir, 'scripts/lib'), { recursive: true });
  mkdirSync(path.join(rootDir, 'artifacts/runtime'), { recursive: true });
  cpSync(path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh'), path.join(rootDir, 'scripts/lib/next-generated-root-state.sh'));

  writeFileSync(
    path.join(rootDir, 'tsconfig.json'),
    `${JSON.stringify({ include: ['.next*/types/**/*.ts', 'next-env.d.ts', 'src/**/*.ts'] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(rootDir, 'next-env.d.ts'),
    '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
  );

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

describe('run-next-dev-safe', () => {
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

  it('normalizes root files when NEXT_GENERATED_ROOT_MANAGED=1', () => {
    const { rootDir, fakeBin } = setupTempRoot();

    execFileSync('bash', [path.join(process.cwd(), 'scripts/run-next-dev-safe.sh')], {
      cwd: rootDir,
      env: {
        ...process.env,
        ROOT_DIR: rootDir,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NEXT_GENERATED_ROOT_MANAGED: '1',
      },
      stdio: 'pipe',
    });

    const tsconfig = readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8');
    const nextEnv = readFileSync(path.join(rootDir, 'next-env.d.ts'), 'utf8');
    expect(tsconfig).toContain('artifacts/backend-real/current-run/next-dist/types/**/*.ts');
    expect(tsconfig).not.toContain('/integration-20260410T062839Z-3559213-15947/');
    expect(nextEnv).not.toContain('/integration-20260410T062839Z-3559213-15947/');
  });

  it('normalizes root files when the wrapper receives SIGTERM in managed mode', async () => {
    const { rootDir, fakeBin } = setupTempRoot();
    writeFileSync(
      path.join(fakeBin, 'next'),
      `#!/usr/bin/env bash
set -euo pipefail
cat > "${rootDir}/tsconfig.json" <<'EOF_TSCONFIG'
{"include":["artifacts/mock-lane/runs/mock-20260411T011449Z-1305939-19002/next-dist/types/**/*.ts","next-env.d.ts"]}
EOF_TSCONFIG
cat > "${rootDir}/next-env.d.ts" <<'EOF_NEXT_ENV'
/// <reference path="./artifacts/mock-lane/runs/mock-20260411T011449Z-1305939-19002/next-dist/types/routes.d.ts" />
EOF_NEXT_ENV
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
      },
      stdio: 'pipe',
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    child.kill('SIGTERM');
    await new Promise<number>((resolve, reject) => {
      child.on('exit', (code) => resolve(code ?? 0));
      child.on('error', reject);
    });

    const tsconfig = readFileSync(path.join(rootDir, 'tsconfig.json'), 'utf8');
    const nextEnv = readFileSync(path.join(rootDir, 'next-env.d.ts'), 'utf8');
    expect(tsconfig).toContain('artifacts/mock-lane/current/next-dist/types/**/*.ts');
    expect(tsconfig).not.toContain('/mock-20260411T011449Z-1305939-19002/');
    expect(nextEnv).not.toContain('/mock-20260411T011449Z-1305939-19002/');
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
});
