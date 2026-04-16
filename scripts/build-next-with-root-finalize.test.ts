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
});
