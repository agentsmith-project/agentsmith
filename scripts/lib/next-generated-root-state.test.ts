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
  it('normalizes run-specific tsconfig includes back to wildcard patterns', () => {
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
    expect(tsconfig).toContain('artifacts/backend-real/runs/*/next-dist/types/**/*.ts');
    expect(tsconfig).toContain('artifacts/mock-lane/runs/*/next-dist/types/**/*.ts');
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
      'artifacts/backend-real/runs/*/next-dist/types/**/*.ts',
      'artifacts/mock-lane/runs/*/next-dist/types/**/*.ts',
      'src/**/*.ts',
      'src/**/*.tsx',
    ]);
  });
});
