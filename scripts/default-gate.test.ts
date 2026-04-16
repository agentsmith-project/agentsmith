import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('default engineering gate profiles', () => {
  it('keeps gate:fast on the same authoritative gate driver with a dedicated fast profile', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['gate:fast']).toBe('DEFAULT_GATE_PROFILE=fast bash scripts/default-gate.sh');
  });

  it('keeps the fast profile on shared preflight, lint, and locked type-state before smoke coverage', () => {
    const script = readFileSync('scripts/default-gate.sh', 'utf8');

    expect(script).toContain('DEFAULT_GATE_PROFILE="${DEFAULT_GATE_PROFILE:-standalone}"');
    expect(script).toContain('--campaign-after-gate-fast');
    expect(script).toContain('standalone|fast|campaign_after_gate_fast');
    expect(script).toContain('run_cmd "npm run contracts:check"');
    expect(script).toContain('run_cmd "npm run contracts:check-openapi"');
    expect(script).toContain('run_cmd "npm run openapi:check-generated"');
    expect(script).toContain('run_cmd "npm run lint"');
    expect(script).toContain('next_generated_root_run_locked_type_state_gate_sequence');
    expect(script).toContain('run_cmd "npx next typegen ."');
    expect(script).toContain('run_cmd "npx tsc --noEmit"');
    expect(script).toContain('run_cmd "npm run build"');
    expect(script).toContain('run_cmd "npm run test:e2e:lane:mock:smoke"');
    expect(script).toContain('if [[ "${DEFAULT_GATE_PROFILE}" == "fast" ]]; then');
  });

  it('stays shell-syntax valid after adding the fast profile branch', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/default-gate.sh'])).not.toThrow();
  });
});
