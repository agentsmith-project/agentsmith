import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('unified deploy release substrate lane', () => {
  it('releases backend-real integration dependencies before claiming unified substrate ports', () => {
    const script = readFileSync('scripts/unified-deploy/release-substrate.sh', 'utf8');

    const depsDownIndex = script.indexOf('npm run integration:deps:down');
    const lifecycleResetIndex = script.indexOf('scripts/unified-deploy/substrate-lifecycle.ts reset');

    expect(depsDownIndex).toBeGreaterThan(0);
    expect(lifecycleResetIndex).toBeGreaterThan(0);
    expect(depsDownIndex).toBeLessThan(lifecycleResetIndex);
  });
});
