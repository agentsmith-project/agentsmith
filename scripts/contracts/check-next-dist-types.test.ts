import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('check-next-dist-types contract', () => {
  it('requires stable current-lane Next dist includes', () => {
    const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

    expect(() =>
      execFileSync(tsxCli, ['scripts/contracts/check-next-dist-types.ts'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
