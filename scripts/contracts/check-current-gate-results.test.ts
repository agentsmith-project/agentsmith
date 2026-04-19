import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('check-current-gate-results contract', () => {
  it('uses each writer line_kind even when an outer release wrapper exports a different line_kind', () => {
    const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

    expect(() =>
      execFileSync(tsxCli, ['scripts/contracts/check-current-gate-results.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CURRENT_GATE_RESULT_LINE_KIND: 'release_backend_real',
        },
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
