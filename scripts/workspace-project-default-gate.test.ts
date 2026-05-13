import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readWorkspaceProjectGateScript(): string {
  return readFileSync('scripts/workspace-project-default-gate.sh', 'utf8');
}

describe('workspace-project-default-gate', () => {
  it('stays shell-syntax valid', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/workspace-project-default-gate.sh'])).not.toThrow();
  });

  it('keeps focused visual coverage enabled by default and skippable only by explicit flag or env', () => {
    const script = readWorkspaceProjectGateScript();

    expect(script).toContain('SKIP_FOCUSED_VISUAL="${WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL:-0}"');
    expect(script).toContain('--skip-focused-visual');
    expect(script).toContain('if [[ "${SKIP_FOCUSED_VISUAL}" == "1" ]]; then');
    expect(script).toContain('skipping workspace/project focused visual mock lane; full visual evidence is owned by lane:visual');
    expect(script).toContain('e2e/visual.spec.ts');
    expect(script).toContain(
      "--grep 'workspace selection|workspace login|workspace home|workspace home - project creator|projects list|projects list public discovery|project join request dialog|project join now dialog|notification center join request outcome|projects empty state|workspace settings|workspace settings create project dialog|overview'",
    );
  });

  it('keeps shared preflight skip independent from focused visual skip', () => {
    const script = readWorkspaceProjectGateScript();
    const sharedPreflightIndex = script.indexOf('if [[ "${SKIP_SHARED_PREFLIGHT}" != "1" ]]; then');
    const focusedVisualIndex = script.indexOf('if [[ "${SKIP_FOCUSED_VISUAL}" == "1" ]]; then');

    expect(sharedPreflightIndex).toBeGreaterThanOrEqual(0);
    expect(focusedVisualIndex).toBeGreaterThan(sharedPreflightIndex);
    expect(script).toContain('--skip-shared-preflight');
    expect(script).toContain('--skip-focused-visual');
  });
});
