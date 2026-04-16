import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

function writeFixtureRoot(tempRoot: string): void {
  mkdirSync(path.join(tempRoot, 'scripts/lib'), { recursive: true });
  writeFileSync(
    path.join(tempRoot, 'tsconfig.json'),
    `${JSON.stringify({ include: canonicalInclude }, null, 2)}\n`,
  );
  writeFileSync(path.join(tempRoot, 'next-env.d.ts'), canonicalNextEnv);
}

describe('build-next-with-root-finalize', () => {
  it('finalizes the root source contract after Next writes root-generated route type references', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'build-next-root-finalize-'));
    writeFixtureRoot(tempRoot);

    const wrapper = path.join(process.cwd(), 'scripts/build-next-with-root-finalize.sh');
    const routesPath = path.join(tempRoot, '.next/types/routes.d.ts');

    execFileSync('bash', [wrapper], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_GENERATED_ROOT_BUILD_ROOT: tempRoot,
        NEXT_GENERATED_ROOT_BUILD_COMMAND: `
          mkdir -p .next/types
          cat > next-env.d.ts <<'EOF_NEXT_ENV'
${rootGeneratedNextEnv}EOF_NEXT_ENV
          printf 'declare module "next";\\n' > .next/types/routes.d.ts
        `,
      },
      stdio: 'pipe',
    });

    expect(readFileSync(path.join(tempRoot, 'next-env.d.ts'), 'utf8')).toBe(canonicalNextEnv);
    expect(readFileSync(routesPath, 'utf8')).toContain('declare module "next"');

    const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    expect(() => execFileSync(tsxCli, [path.join(process.cwd(), 'scripts/contracts/check-next-dist-types.ts')], {
      cwd: tempRoot,
      env: process.env,
      stdio: 'pipe',
    })).not.toThrow();
  });

  it('does not self-deadlock when the build wrapper runs inside the locked type-state gate sequence', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'build-next-root-finalize-locked-'));
    writeFixtureRoot(tempRoot);

    const helper = path.join(process.cwd(), 'scripts/lib/next-generated-root-state.sh');
    const wrapper = path.join(process.cwd(), 'scripts/build-next-with-root-finalize.sh');
    const stateDir = path.join(tempRoot, 'artifacts/runtime/next-root-contract');

    const output = execFileSync(
      'bash',
      ['-lc', `
        set -euo pipefail
        source "${helper}"
        export NEXT_GENERATED_ROOT_STATE_DIR="${stateDir}"
        typegen_callback() {
          mkdir -p "${tempRoot}/.next/types"
          printf 'declare module "next";\\n' > "${tempRoot}/.next/types/routes.d.ts"
        }
        tsc_callback() {
          :
        }
        build_callback() {
          NEXT_GENERATED_ROOT_BUILD_ROOT="${tempRoot}" \
          NEXT_GENERATED_ROOT_BUILD_COMMAND='
            mkdir -p .next/types
            cat > next-env.d.ts <<'"'"'EOF_NEXT_ENV'"'"'
${rootGeneratedNextEnv}EOF_NEXT_ENV
            printf '"'"'"'"'"'"'"'"'declare module "next";\\n'"'"'"'"'"'"'"'"' > .next/types/routes.d.ts
          ' \
          bash "${wrapper}"
          printf 'build_wrapper_completed\\n'
        }
        next_generated_root_run_locked_type_state_gate_sequence gate typegen_callback tsc_callback build_callback
      `],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ROOT_DIR: tempRoot,
        },
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 4_000,
      },
    );

    expect(output).toContain('build_wrapper_completed');
    expect(readFileSync(path.join(tempRoot, 'next-env.d.ts'), 'utf8')).toBe(canonicalNextEnv);
  });
});
