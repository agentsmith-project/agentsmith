import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('check-engineering-governance contract', () => {
  it('passes against the active governance and product terminology docs', () => {
    const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

    expect(() =>
      execFileSync(tsxCli, ['scripts/contracts/check-engineering-governance.ts'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
