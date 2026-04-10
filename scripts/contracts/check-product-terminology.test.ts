import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('check-product-terminology contract', () => {
  it('passes against the active product terminology contract and route truth', () => {
    const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

    expect(() =>
      execFileSync(tsxCli, ['scripts/contracts/check-product-terminology.ts'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
