import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('chat runtime fast gate', () => {
  it('uses the shared root source contract preflight before running typecheck', () => {
    const script = readFileSync('scripts/chat-runtime-fast-gate.sh', 'utf8');

    expect(script).toContain('source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"');
    expect(script).toContain('next_generated_root_with_source_contract_lock');
    expect(script).toContain('next_generated_root_prepare_source_safe_for_tsc');

    const prepareIndex = script.indexOf('next_generated_root_prepare_source_safe_for_tsc');
    const tscIndex = script.indexOf('run_cmd "npx tsc --noEmit"');

    expect(prepareIndex).toBeGreaterThanOrEqual(0);
    expect(tscIndex).toBeGreaterThanOrEqual(0);
    expect(prepareIndex).toBeLessThan(tscIndex);
  });
});
