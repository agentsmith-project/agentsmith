import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('check-current-gates contract', () => {
  it('allows the governance tooling default-gate profile without weakening standalone domain delegation', () => {
    const defaultGateScript = read('scripts/default-gate.sh');
    const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const governanceToolingSuite = packageJson.scripts?.['test:governance-tooling'] ?? '';
    const profileStart = defaultGateScript.indexOf('if [[ "${DEFAULT_GATE_PROFILE}" == "governance_tooling" ]]; then');
    const standaloneDomainStart = defaultGateScript.indexOf('workspace_project_default_gate_command=');

    expect(governanceToolingSuite).toContain('npm run test:run --');
    expect(governanceToolingSuite).toContain('scripts/default-gate.test.ts');
    expect(governanceToolingSuite).toContain('scripts/contracts/check-current-gates.test.ts');
    expect(governanceToolingSuite).toContain('scripts/governance/__tests__/verify-impact-selector.test.ts');
    expect(governanceToolingSuite).not.toMatch(
      /playwright|test:e2e|lane:mock|lane:visual|test:visual|workspace-project-default-gate|governance-default-gate/,
    );

    expect(profileStart).toBeGreaterThanOrEqual(0);
    expect(standaloneDomainStart).toBeGreaterThan(profileStart);

    const profileBlock = defaultGateScript.slice(profileStart, standaloneDomainStart);
    expect(profileBlock).toContain('run_cmd "npm run test:governance-tooling"');
    expect(profileBlock).toContain('exit 0');
    expect(profileBlock).not.toMatch(
      /workspace-project-default-gate|governance-default-gate|test:e2e:lane:mock|lane:visual|test:visual|e2e\/visual/,
    );

    const standaloneDomainBlock = defaultGateScript.slice(standaloneDomainStart);
    expect(standaloneDomainBlock).toContain(
      'workspace_project_default_gate_command="bash scripts/workspace-project-default-gate.sh --skip-shared-preflight"',
    );
    expect(standaloneDomainBlock).toContain(
      'governance_default_gate_command="bash scripts/governance-default-gate.sh --skip-shared-preflight"',
    );
    expect(standaloneDomainBlock).toContain('run_cmd "${workspace_project_default_gate_command}"');
    expect(standaloneDomainBlock).toContain('run_cmd "${governance_default_gate_command}"');
  });

  it('passes the active current gates contract', () => {
    const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

    expect(() =>
      execFileSync(tsxCli, ['scripts/contracts/check-current-gates.ts'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
