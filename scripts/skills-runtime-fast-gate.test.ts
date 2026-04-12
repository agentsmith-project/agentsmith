import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('skills runtime fast gate', () => {
  it('normalizes lane-generated Next artifacts before running typecheck', () => {
    const script = readFileSync('scripts/skills-runtime-fast-gate.sh', 'utf8');

    expect(script).toContain('source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"');
    expect(script).toContain('next_generated_root_prepare_for_validation');

    const prepareIndex = script.indexOf('next_generated_root_prepare_for_validation');
    const tscIndex = script.indexOf('run_cmd "npx tsc --noEmit"');

    expect(prepareIndex).toBeGreaterThanOrEqual(0);
    expect(tscIndex).toBeGreaterThanOrEqual(0);
    expect(prepareIndex).toBeLessThan(tscIndex);
  });
});
