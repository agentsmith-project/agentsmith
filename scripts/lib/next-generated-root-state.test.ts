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
  it('restores tsconfig and next-env snapshots after a lane mutates them', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":[".next*/types/**/*.ts","next-env.d.ts","src/**/*.ts"]}
EOF_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_NEXT_ENV'
/// <reference types="next" />
/// <reference types="next/image-types/global" />
EOF_NEXT_ENV
        source "${helper}"
        state_dir="$(next_generated_root_state_dir)"
        next_generated_root_snapshot "\${state_dir}"
        cat > "${tsconfigPath}" <<'EOF_MUTATED_TSCONFIG'
{"include":["artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/**/*.ts","next-env.d.ts"]}
EOF_MUTATED_TSCONFIG
        cat > "${nextEnvPath}" <<'EOF_MUTATED_NEXT_ENV'
/// <reference path="./artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/routes.d.ts" />
EOF_MUTATED_NEXT_ENV
        next_generated_root_restore "\${state_dir}"
      `,
      tempRoot,
    );

    expect(readFileSync(tsconfigPath, 'utf8')).toContain('.next*/types/**/*.ts');
    expect(readFileSync(tsconfigPath, 'utf8')).not.toContain('/integration-20260410T062839Z-3559213-15947/');
    expect(readFileSync(nextEnvPath, 'utf8')).not.toContain('/integration-20260410T062839Z-3559213-15947/');
  });

  it('writes a clean canonical next-env file when no snapshot existed', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'next-root-state-canonical-'));
    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
    const nextEnvPath = path.join(tempRoot, 'next-env.d.ts');

    runBash(
      `
        cat > "${tsconfigPath}" <<'EOF_TSCONFIG'
{"include":[".next*/types/**/*.ts","next-env.d.ts","src/**/*.ts"]}
EOF_TSCONFIG
        rm -f "${nextEnvPath}"
        source "${helper}"
        state_dir="$(next_generated_root_state_dir)"
        next_generated_root_snapshot "\${state_dir}"
        cat > "${nextEnvPath}" <<'EOF_MUTATED_NEXT_ENV'
/// <reference path="./artifacts/mock-lane/runs/mock-20260410T032507Z-3268716-702/next-dist/types/routes.d.ts" />
EOF_MUTATED_NEXT_ENV
        next_generated_root_restore "\${state_dir}"
      `,
      tempRoot,
    );

    const nextEnv = readFileSync(nextEnvPath, 'utf8');
    expect(nextEnv).toContain('reference types="next"');
    expect(nextEnv).not.toContain('/mock-20260410T032507Z-3268716-702/');
  });
});
