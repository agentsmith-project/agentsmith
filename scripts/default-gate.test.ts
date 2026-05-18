import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type PureCheckHarnessOptions = {
  commandExitCode: number;
  commandStderr?: string;
  evidenceWriterExitCode?: number;
  reportRootEnabled: boolean;
};

type PureCheckHarnessResult = {
  capturedStderrSummary: string | null;
  processStatus: number | null;
  pureCheckStatus: number;
  stderr: string;
  stdout: string;
};

type DefaultGateHarnessResult = {
  commandLog: string[];
  processStatus: number | null;
  stderr: string;
  stdout: string;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function extractPureCheckFunctionBlock(): string {
  const script = readFileSync('scripts/default-gate.sh', 'utf8');
  const start = script.indexOf('info() {');
  const end = script.indexOf('run_default_gate_typegen() {');

  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Unable to extract run_pure_check_cmd function block from default-gate.sh.');
  }

  return script.slice(start, end).trim();
}

function runPureCheckHarness(options: PureCheckHarnessOptions): PureCheckHarnessResult {
  const root = mkdtempSync(join(tmpdir(), 'agentsmith-default-gate-'));

  try {
    const binDir = join(root, 'bin');
    mkdirSync(binDir);
    writeFileSync(
      join(root, 'check-command.sh'),
      `#!/usr/bin/env bash
printf 'check stdout\\n'
printf '%s' ${shellQuote(options.commandStderr ?? 'check stderr\n')} >&2
exit ${options.commandExitCode}
`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(binDir, 'npx'),
      `#!/usr/bin/env bash
stderr_summary_file=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "--stderr-summary-file" ]]; then
    stderr_summary_file="$2"
    shift 2
    continue
  fi
  shift
done
if [[ -n "\${FAKE_NPX_CAPTURE_DIR:-}" && -n "\${stderr_summary_file}" ]]; then
  mkdir -p "\${FAKE_NPX_CAPTURE_DIR}"
  cp "\${stderr_summary_file}" "\${FAKE_NPX_CAPTURE_DIR}/stderr-summary.txt"
fi
printf '[fake evidence writer] %s\\n' "$*" >&2
exit "\${FAKE_NPX_EXIT:-0}"
`,
      { mode: 0o755 },
    );

    const reportRootLine = options.reportRootEnabled
      ? `export AGENTSMITH_VERIFY_REPORT_ROOT=${shellQuote(join(root, 'reports'))}`
      : 'unset AGENTSMITH_VERIFY_REPORT_ROOT';
    const harnessPath = join(root, 'harness.sh');
    writeFileSync(
      harnessPath,
      `#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=${shellQuote(root)}
${extractPureCheckFunctionBlock()}
${reportRootLine}
if run_pure_check_cmd "probe-check" "bash ./check-command.sh"; then
  pure_check_status=0
else
  pure_check_status="$?"
fi
printf '__RUN_PURE_CHECK_STATUS__=%s\\n' "\${pure_check_status}"
`,
      { mode: 0o755 },
    );

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FAKE_NPX_CAPTURE_DIR: join(root, 'capture'),
      FAKE_NPX_EXIT: String(options.evidenceWriterExitCode ?? 0),
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    };
    delete env.AGENTSMITH_VERIFY_REPO_ROOT;

    const result = spawnSync('bash', [harnessPath], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    const stdout = result.stdout;
    const stderr = result.stderr;
    const statusMatch = stdout.match(/__RUN_PURE_CHECK_STATUS__=(\d+)/);

    if (!statusMatch) {
      throw new Error(`Pure check harness did not report status.
process status: ${String(result.status)}
stdout:
${stdout}
stderr:
${stderr}`);
    }

    const capturedStderrSummaryPath = join(root, 'capture', 'stderr-summary.txt');

    return {
      capturedStderrSummary: existsSync(capturedStderrSummaryPath)
        ? readFileSync(capturedStderrSummaryPath, 'utf8')
        : null,
      processStatus: result.status,
      pureCheckStatus: Number(statusMatch[1]),
      stderr,
      stdout,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeCommandLogger(path: string, command: string, logPath: string, exitCode: number): void {
  writeFileSync(
    path,
    `#!/bin/sh
printf '${command} %s\\n' "$*" >> ${shellQuote(logPath)}
exit ${exitCode}
`,
    { mode: 0o755 },
  );
}

function runDefaultGateHarness(profile: string): DefaultGateHarnessResult {
  const root = mkdtempSync(join(tmpdir(), 'agentsmith-default-gate-profile-'));

  try {
    const binDir = join(root, 'bin');
    const logPath = join(root, 'commands.log');
    mkdirSync(binDir);
    writeCommandLogger(join(binDir, 'npm'), 'npm', logPath, 0);
    writeCommandLogger(join(binDir, 'npx'), 'npx', logPath, 98);
    writeCommandLogger(join(binDir, 'bash'), 'bash', logPath, 97);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DEFAULT_GATE_PROFILE: profile,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    };
    delete env.DEFAULT_GATE_REUSE_FAST_EVIDENCE;

    const result = spawnSync('/usr/bin/bash', ['scripts/default-gate.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env,
    });

    return {
      commandLog: existsSync(logPath)
        ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
        : [],
      processStatus: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('default engineering gate profiles', () => {
  it('keeps gate:fast on the same authoritative gate driver with a dedicated fast profile', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['gate:fast']).toBe('DEFAULT_GATE_PROFILE=fast bash scripts/default-gate.sh');
  });

  it('keeps governance tooling on one focused non-Playwright suite', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    const script = packageJson.scripts?.['test:governance-tooling'] ?? '';

    expect(script).toContain('npm run test:run --');
    expect(script).toContain('scripts/default-gate.test.ts');
    expect(script).toContain('scripts/contracts/check-current-gates.test.ts');
    expect(script).toContain('scripts/governance/__tests__/verify-impact-selector.test.ts');
    expect(script).not.toMatch(/playwright|test:e2e|lane:mock|lane:visual|test:visual/);
  });

  it('keeps the fast profile on shared preflight, lint, and locked type-state before smoke coverage', () => {
    const script = readFileSync('scripts/default-gate.sh', 'utf8');

    expect(script).toContain('DEFAULT_GATE_PROFILE="${DEFAULT_GATE_PROFILE:-standalone}"');
    expect(script).toContain('DEFAULT_GATE_REUSE_FAST_EVIDENCE="${DEFAULT_GATE_REUSE_FAST_EVIDENCE:-0}"');
    expect(script).toContain('--campaign-after-gate-fast');
    expect(script).toContain('standalone|fast|campaign_after_gate_fast|governance_tooling');
    expect(script).toContain('reuse_gate_fast_evidence()');
    expect(script).toContain('skip_workspace_project_focused_visual()');
    expect(script).toContain('skip_governance_focused_visual()');
    expect(script).toContain('run_pure_check_cmd "contracts" "npm run contracts:check"');
    expect(script).toContain('run_pure_check_cmd "openapi-contract" "npm run contracts:check-openapi"');
    expect(script).toContain('run_pure_check_cmd "openapi-generated" "npm run openapi:check-generated"');
    expect(script).toContain('run_pure_check_cmd "lint" "npm run lint"');
    expect(script).toContain('next_generated_root_run_locked_type_state_gate_sequence');
    expect(script).toContain('run_cmd "npx next typegen ."');
    expect(script).toContain('run_pure_check_cmd "typecheck" "npx tsc --noEmit"');
    expect(script).toContain('run_cmd "npm run build"');
    expect(script).toContain('run_cmd "npm run test:e2e:lane:mock:smoke"');
    expect(script).toContain('if [[ "${DEFAULT_GATE_PROFILE}" == "fast" ]]; then');
  });

  it('reuses gate:fast evidence only for scoped reuse profiles or an explicit reuse env without forcing focused visual skip', () => {
    const script = readFileSync('scripts/default-gate.sh', 'utf8');

    expect(script).toContain('[[ "${DEFAULT_GATE_PROFILE}" != "fast" ]]');
    expect(script).toContain('[[ "${DEFAULT_GATE_PROFILE}" == "campaign_after_gate_fast" ]] || [[ "${DEFAULT_GATE_PROFILE}" == "governance_tooling" ]] || [[ "${DEFAULT_GATE_REUSE_FAST_EVIDENCE}" == "1" ]]');
    expect(script).toContain('[[ "${DEFAULT_GATE_PROFILE}" == "campaign_after_gate_fast" ]] || [[ "${WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL:-0}" == "1" ]]');
    expect(script).toContain('[[ "${DEFAULT_GATE_PROFILE}" == "campaign_after_gate_fast" ]] || [[ "${GOVERNANCE_DEFAULT_GATE_SKIP_FOCUSED_VISUAL:-0}" == "1" ]]');
    expect(script).toContain('reusing gate:fast evidence; skipping contracts/openapi/lint/typegen/typecheck/build');
    expect(script).toContain('workspace_project_default_gate_command="bash scripts/workspace-project-default-gate.sh --skip-shared-preflight"');
    expect(script).toContain('workspace_project_default_gate_command="${workspace_project_default_gate_command} --skip-focused-visual"');
    expect(script).toContain('governance_default_gate_command="bash scripts/governance-default-gate.sh --skip-shared-preflight"');
    expect(script).toContain('governance_default_gate_command="${governance_default_gate_command} --skip-focused-visual"');
  });

  it('runs only the focused governance tooling suite for the scoped governance tooling profile', () => {
    const result = runDefaultGateHarness('governance_tooling');
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.processStatus).toBe(0);
    expect(result.commandLog).toEqual(['npm run test:governance-tooling']);
    expect(result.stdout).toContain('reusing gate:fast evidence; skipping contracts/openapi/lint/typegen/typecheck/build');
    expect(result.stdout).toContain('[default-gate] npm run test:governance-tooling');
    expect(result.stdout).toContain('governance tooling engineering gate passed');
    expect(combinedOutput).not.toContain('workspace-project-default-gate');
    expect(combinedOutput).not.toContain('governance-default-gate');
    expect(combinedOutput).not.toContain('test:e2e:lane:mock:smoke');
    expect(combinedOutput).not.toContain('lane:visual');
    expect(combinedOutput).not.toContain('test:visual');
  });

  it('wraps only shared pure checks with producer evidence in default-gate', () => {
    const script = readFileSync('scripts/default-gate.sh', 'utf8');
    const wrappedChecks = [...script.matchAll(/run_pure_check_cmd "([^"]+)" "([^"]+)"/g)]
      .map((match) => ({ checkId: match[1], command: match[2] }));

    expect(wrappedChecks).toEqual([
      { checkId: 'typecheck', command: 'npx tsc --noEmit' },
      { checkId: 'contracts', command: 'npm run contracts:check' },
      { checkId: 'openapi-contract', command: 'npm run contracts:check-openapi' },
      { checkId: 'openapi-generated', command: 'npm run openapi:check-generated' },
      { checkId: 'lint', command: 'npm run lint' },
    ]);
    expect(script).not.toContain('run_pure_check_cmd "unit"');
    expect(script).not.toContain('run_pure_check_cmd "build"');
    expect(script).not.toContain('run_pure_check_cmd "e2e"');
    expect(script).not.toContain('run_pure_check_cmd "workspace-project"');
    expect(script).not.toContain('run_pure_check_cmd "governance"');
  });

  it('keeps producer evidence opt-in and records Next typegen artifacts for typecheck', () => {
    const script = readFileSync('scripts/default-gate.sh', 'utf8');

    expect(script).toContain('[[ -z "${AGENTSMITH_VERIFY_REPORT_ROOT:-}" ]]');
    expect(script).toContain('scripts/governance/write-pure-check-producer-evidence.ts');
    expect(script).toContain('"repo_root:.next/types/routes.d.ts:next-typegen-routes"');
    expect(script).toContain('"repo_root:next-env.d.ts:next-env"');
    expect(script.indexOf('run_cmd "npx next typegen ."'))
      .toBeLessThan(script.indexOf('run_pure_check_cmd "typecheck" "npx tsc --noEmit"'));
  });

  it('uses the original run_cmd behavior when producer evidence is not enabled', () => {
    const result = runPureCheckHarness({
      commandExitCode: 7,
      evidenceWriterExitCode: 43,
      reportRootEnabled: false,
    });

    expect(result.processStatus).toBe(0);
    expect(result.pureCheckStatus).toBe(7);
    expect(result.stdout).toContain('[default-gate] bash ./check-command.sh');
    expect(result.stdout).toContain('check stdout');
    expect(result.stderr).toContain('check stderr');
    expect(result.stderr).not.toContain('[fake evidence writer]');
  });

  it('keeps a successful pure check successful when producer evidence writing fails', () => {
    const result = runPureCheckHarness({
      commandExitCode: 0,
      evidenceWriterExitCode: 43,
      reportRootEnabled: true,
    });

    expect(result.processStatus).toBe(0);
    expect(result.pureCheckStatus).toBe(0);
    expect(result.stdout).toContain('check stdout');
    expect(result.stderr).toContain('check stderr');
    expect(result.stderr).toContain('[fake evidence writer]');
    expect(result.stderr).toContain('[default-gate] warning: pure check producer evidence writer failed');
    expect(result.stderr).toContain('probe-check');
    expect(result.stderr).toContain('43');
  });

  it('filters allowlisted expected stderr from successful pure check evidence summaries', () => {
    const result = runPureCheckHarness({
      commandExitCode: 0,
      commandStderr: 'Browserslist: caniuse-lite is outdated. Please run:\n',
      reportRootEnabled: true,
    });

    expect(result.processStatus).toBe(0);
    expect(result.pureCheckStatus).toBe(0);
    expect(result.stderr).toContain('Browserslist: caniuse-lite is outdated');
    expect(result.capturedStderrSummary).toBe('');
  });

  it('preserves stderr summaries for failed checks even when the text is allowlisted on success', () => {
    const result = runPureCheckHarness({
      commandExitCode: 7,
      commandStderr: 'Browserslist: caniuse-lite is outdated. Please run:\n',
      reportRootEnabled: true,
    });

    expect(result.processStatus).toBe(0);
    expect(result.pureCheckStatus).toBe(7);
    expect(result.capturedStderrSummary).toContain('Browserslist: caniuse-lite is outdated');
  });

  it('keeps unexpected successful stderr compacted into producer evidence instead of failing the check', () => {
    const result = runPureCheckHarness({
      commandExitCode: 0,
      commandStderr: 'unexpected warning from toolchain\n',
      reportRootEnabled: true,
    });

    expect(result.processStatus).toBe(0);
    expect(result.pureCheckStatus).toBe(0);
    expect(result.capturedStderrSummary).toContain('unexpected warning from toolchain');
  });

  it('keeps the original pure check failure code when producer evidence writing fails', () => {
    const result = runPureCheckHarness({
      commandExitCode: 7,
      evidenceWriterExitCode: 43,
      reportRootEnabled: true,
    });

    expect(result.processStatus).toBe(0);
    expect(result.pureCheckStatus).toBe(7);
    expect(result.stdout).toContain('check stdout');
    expect(result.stderr).toContain('check stderr');
    expect(result.stderr).toContain('[fake evidence writer]');
    expect(result.stderr).toContain('[default-gate] warning: pure check producer evidence writer failed');
    expect(result.stderr).toContain('probe-check');
    expect(result.stderr).toContain('43');
  });

  it('stays shell-syntax valid after adding the fast profile branch', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/default-gate.sh'])).not.toThrow();
  });
});
