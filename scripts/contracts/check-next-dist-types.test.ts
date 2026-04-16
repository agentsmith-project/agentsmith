import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

function writeFixtureRoot(
  tempRoot: string,
  options?: {
    include?: string[];
    nextEnv?: string;
  },
): void {
  writeFileSync(
    path.join(tempRoot, 'tsconfig.json'),
    `${JSON.stringify({ include: options?.include ?? canonicalInclude }, null, 2)}\n`,
  );
  writeFileSync(path.join(tempRoot, 'next-env.d.ts'), options?.nextEnv ?? canonicalNextEnv);
}

function runCheck(cwd: string): void {
  const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  execFileSync(tsxCli, [path.join(process.cwd(), 'scripts/contracts/check-next-dist-types.ts')], {
    cwd,
    env: process.env,
    stdio: 'pipe',
  });
}

function runCheckWithEnv(cwd: string, env: NodeJS.ProcessEnv): void {
  const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  execFileSync(tsxCli, [path.join(process.cwd(), 'scripts/contracts/check-next-dist-types.ts')], {
    cwd,
    env,
    stdio: 'pipe',
  });
}

describe('check-next-dist-types contract', () => {
  it('accepts the canonical root tsconfig include set and canonical next-env template', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'check-next-dist-types-'));
    writeFixtureRoot(tempRoot);

    expect(() => runCheck(tempRoot)).not.toThrow();
  });

  it('keeps the tracked repo root on the canonical include set', () => {
    expect(() => runCheck(process.cwd())).not.toThrow();

    const tsconfig = JSON.parse(readFileSync(path.join(process.cwd(), 'tsconfig.json'), 'utf8')) as {
      include: string[];
    };
    expect(tsconfig.include).toEqual(canonicalInclude);
    const nextEnvPath = path.join(process.cwd(), 'next-env.d.ts');
    if (existsSync(nextEnvPath)) {
      expect([canonicalNextEnv, rootGeneratedNextEnv]).toContain(readFileSync(nextEnvPath, 'utf8'));
    }
  });

  it('accepts the Next 15 root-generated next-env route reference when root routes types exist', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'check-next-dist-types-root-generated-'));
    writeFixtureRoot(tempRoot, {
      nextEnv: rootGeneratedNextEnv,
    });
    const routesDir = path.join(tempRoot, '.next/types');
    mkdirSync(routesDir, { recursive: true });
    writeFileSync(path.join(routesDir, 'routes.d.ts'), 'declare module "next";\n');

    expect(() => runCheck(tempRoot)).not.toThrow();
  });

  it('fails with a clear root-generated missing-types error when the Next 15 route reference has no routes file', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'check-next-dist-types-root-missing-'));
    writeFixtureRoot(tempRoot, {
      nextEnv: rootGeneratedNextEnv,
    });

    let error: unknown;
    try {
      runCheck(tempRoot);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    const stderr = String((error as { stderr?: Buffer | string }).stderr ?? '');
    expect(stderr).toContain('next_env_root_route_types_missing');
    expect(stderr).not.toContain('next_env_must_not_reference_lane_specific_types');
  });

  it.each([
    '.next*/types/**/*.ts',
    '.next-local-manual-3101/types/**/*.ts',
    'artifacts/recovery-manual-next/types/**/*.ts',
    'artifacts/mock-lane/current/next-dist/types/**/*.d.ts',
    'artifacts/backend-real/current-run/next-dist/types/**/*.d.ts',
    'artifacts/mock-lane/runs/playwright-managed-1776167402066-1748658/next-dist/types/**/*.ts',
    'artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/**/*.ts',
  ])('rejects forbidden tsconfig include entry %s', (forbiddenInclude) => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'check-next-dist-types-forbidden-'));
    writeFixtureRoot(tempRoot, {
      include: [...canonicalInclude.filter((entry) => entry !== '.next/types/**/*.ts'), forbiddenInclude, 'next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx'],
    });

    expect(() => runCheck(tempRoot)).toThrow();
  });

  it.each([
    './artifacts/mock-lane/current/next-dist/types/routes.d.ts',
    './artifacts/backend-real/current-run/next-dist/types/routes.d.ts',
    './.next-local-manual-3101/types/routes.d.ts',
    './artifacts/recovery-manual-next/types/routes.d.ts',
    './artifacts/mock-lane/runs/playwright-managed-1776167402066-1748658/next-dist/types/routes.d.ts',
    './artifacts/backend-real/runs/integration-20260410T062839Z-3559213-15947/next-dist/types/routes.d.ts',
  ])('rejects lane-specific next-env reference %s', (forbiddenReference) => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'check-next-dist-types-next-env-'));
    writeFixtureRoot(tempRoot, {
      nextEnv: `/// <reference types="next" />
/// <reference types="next/image-types/global" />
/// <reference path="${forbiddenReference}" />
`,
    });

    expect(() => runCheck(tempRoot)).toThrow();
  });

  it('retries transient unreadable tsconfig before passing the static contract check', async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'check-next-dist-types-transient-'));
    writeFixtureRoot(tempRoot);
    writeFileSync(path.join(tempRoot, 'tsconfig.json'), '{"include":\n');

    const restore = spawn(
      'bash',
      [
        '-lc',
        `
          sleep 0.15
          cat > "${path.join(tempRoot, 'tsconfig.json')}" <<'EOF_TSCONFIG'
{"include":[".next/types/**/*.ts","next-env.d.ts","src/**/*.ts","src/**/*.tsx"]}
EOF_TSCONFIG
        `,
      ],
      {
        cwd: tempRoot,
        env: {
          ...process.env,
        },
        stdio: 'pipe',
      },
    );

    expect(() => runCheckWithEnv(tempRoot, {
      ...process.env,
      CHECK_NEXT_DIST_TYPES_RETRY_COUNT: '8',
      CHECK_NEXT_DIST_TYPES_RETRY_DELAY_MS: '50',
    })).not.toThrow();

    await new Promise<void>((resolve, reject) => {
      restore.on('exit', () => resolve());
      restore.on('error', reject);
    });
  });

  it('fails with unreadable-specific semantics when tsconfig stays half-written', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'check-next-dist-types-persistent-'));
    writeFixtureRoot(tempRoot);
    writeFileSync(path.join(tempRoot, 'tsconfig.json'), '{"include":\n');

    let error: unknown;
    try {
      runCheckWithEnv(tempRoot, {
        ...process.env,
        CHECK_NEXT_DIST_TYPES_RETRY_COUNT: '2',
        CHECK_NEXT_DIST_TYPES_RETRY_DELAY_MS: '20',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    const stderr = String((error as { stderr?: Buffer | string }).stderr ?? '');
    expect(stderr).toContain('tsconfig_next_dist_contract_persistent_unreadable');
    expect(stderr).not.toContain('tsconfig_next_dist_include_must_match_canonical');
  });
});
