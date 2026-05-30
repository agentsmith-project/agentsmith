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

  it('keeps backend-real engineering smoke on provider-neutral credential file safety coverage', () => {
    const engineeringSmoke = read('scripts/agent-task-engineering-smoke.sh');
    const fileSafetySmoke = read('scripts/agent-task-credential-file-safety-smoke.sh');
    const makefile = read('Makefile');

    expect(engineeringSmoke).not.toContain('agent-task-credential-sync-smoke');
    expect(engineeringSmoke).not.toContain('RUN_CREDENTIAL_SYNC_SMOKE');
    expect(makefile).toContain('agent-task-credential-file-safety-smoke');
    expect(makefile).toContain('./scripts/agent-task-credential-file-safety-smoke.sh');
    expect(makefile).not.toContain('agent-task-credential-sync-smoke');
    expect(fileSafetySmoke).not.toContain('missing ${INDEX_PATH}');
    expect(fileSafetySmoke).not.toContain('missing ${CUSTOM_PATH}');
    expect(fileSafetySmoke).not.toContain('custom connection file does not contain');
    expect(fileSafetySmoke).toContain('CREDENTIAL_FILE_SAFETY::ok');
    const promptDefault = fileSafetySmoke.match(/^PROMPT=.*$/m)?.[0] ?? '';
    expect(promptDefault).not.toContain('CREDENTIAL_FILE_SAFETY::ok');
    expect(promptDefault).not.toContain('SAFETY_MARKER');
    expect(fileSafetySmoke).not.toContain('print("CREDENTIAL_FILE_SAFETY::ok")');
    expect(fileSafetySmoke).not.toMatch(/rg -q ['"]CREDENTIAL_FILE_SAFETY::ok['"]/);
    expect(fileSafetySmoke).toContain('SAFETY_NONCE=');
    expect(fileSafetySmoke).toContain('SAFETY_MARKER="${SAFETY_MARKER_PREFIX}${SAFETY_NONCE}"');
    expect(fileSafetySmoke).toContain('CREDENTIAL_FILE_SAFETY_NONCE');
    expect(fileSafetySmoke).toContain('rg -q --fixed-strings -- "${SAFETY_MARKER}"');
    expect(fileSafetySmoke).toContain('forbidden_projection_field:');
    expect(fileSafetySmoke).toContain('unexpected_projected_dependencies');
    expect(fileSafetySmoke).toContain('credential_file_projection:');
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
