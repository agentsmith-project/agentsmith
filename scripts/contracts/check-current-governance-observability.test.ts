import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, it } from 'vitest';

describe('check-current-governance-observability contract', () => {
  it('passes the current governance observability manifest contract checker', () => {
    const tsxCli = path.join(process.cwd(), 'node_modules/.bin/tsx');

    execFileSync(tsxCli, ['scripts/contracts/check-current-governance-observability.ts'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
  });
});
