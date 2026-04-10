import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    expect(tsconfig).toContain('artifacts/backend-real/runs/*/next-dist/types/**/*.ts');
    expect(tsconfig).not.toContain('/integration-20260410T062839Z-3559213-15947/');
    expect(nextEnv).not.toContain('/integration-20260410T062839Z-3559213-15947/');
  });
});
