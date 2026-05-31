import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildVerificationPlan,
  renderVerificationPlan,
  runVerificationCli,
} from '../run-verify';
import type { ResourceOwnerPreflightResult } from '../resource-owner-preflight';
import { findCurrentGateDefinitionById } from '../current-gate-manifest';
import { validateCurrentStatusProjection } from '../current-status-projection-schema';
import { PURE_CHECK_SHADOW_AUDIT_FILE_NAME } from '../pure-check-shadow-audit';
import { findCurrentPureCheckIdentityById } from '../current-pure-check-identity-manifest';
import {
  buildPureCheckRuntimeShadowClaimRecord,
  STABLE_PURE_CHECK_CLAIMS_JSONL_PATH,
} from '../pure-check-runtime-shadow';
import {
  PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA,
  PURE_CHECK_PRODUCER_RESULT_ARTIFACT_ID,
  PURE_CHECK_PRODUCER_RESULT_FILE_NAME,
} from '../pure-check-producer-evidence';
import {
  READINESS_STATE_ENV,
  validateRunReadinessStateForConsumer,
} from '../run-readiness-state';
import type { GovernanceRuntimeLockLease } from '../governance-lock-lease-manager';

const LEASE_SNAPSHOT_ENV = 'AGENTSMITH_GOVERNANCE_LEASE_SNAPSHOT_PATH';
const LEASE_SNAPSHOT_SECRET = 'sk-verify-status-lease-shadow-do-not-print';
const CLAIM_STORE_ROOT_ENV = 'AGENTSMITH_GOVERNANCE_CLAIM_STORE_ROOT';
const CLAIM_STORE_GIT_SHA_ENV = 'AGENTSMITH_GOVERNANCE_CLAIM_STORE_GIT_SHA';

function readPackageScripts(): Record<string, string> {
  return (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
}

function writeFakeNpm(dir: string, logPath: string): void {
  const path = join(dir, 'npm');
  writeFileSync(path, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"
exit 42
`);
  chmodSync(path, 0o755);
}

function writeJson(path: string, payload: unknown): void {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function lease(overrides: Partial<GovernanceRuntimeLockLease>): GovernanceRuntimeLockLease {
  return {
    leaseId: overrides.leaseId ?? 'lease-verify-status-001',
    lockId: overrides.lockId ?? 'release-campaign-root-writes',
    scopeKind: overrides.scopeKind ?? 'campaign_root',
    scopeKey: overrides.scopeKey ?? '/tmp/verify-status-release-run',
    ownerGroup: overrides.ownerGroup ?? 'release-full|verify-status-run|/tmp/verify-status-release-run',
    ownerAttemptId: overrides.ownerAttemptId ?? 'verify-status-run:gate-release',
    ownerStepId: overrides.ownerStepId ?? 'gate-release',
    mode: overrides.mode ?? 'exclusive',
    campaignId: overrides.campaignId ?? 'release-full',
    runId: overrides.runId ?? 'verify-status-run',
    campaignRoot: overrides.campaignRoot ?? '/tmp/verify-status-release-run',
    acquiredAt: overrides.acquiredAt ?? '2026-04-27T12:00:00.000Z',
  };
}

function writeLeaseSnapshot(root: string): string {
  const path = join(root, 'lease-snapshot.json');
  writeJson(path, {
    activeLeases: [
      lease({}),
      lease({
        leaseId: 'lease-verify-status-destructive',
        lockId: 'destructive-lifecycle',
        scopeKind: 'local_host',
        scopeKey: 'localhost',
        ownerStepId: 'local-real-reset',
      }),
      lease({
        leaseId: 'lease-verify-status-ports',
        lockId: 'fixed-local-ports',
        scopeKind: 'local_host',
        scopeKey: 'local-real:ports',
        ownerStepId: 'local-real-up',
      }),
      lease({
        leaseId: 'lease-verify-status-secret',
        lockId: 'provider-secret-profile',
        scopeKind: 'provider_profile',
        scopeKey: 'backend-real-managed-secret',
        ownerStepId: 'gate-release',
      }),
    ],
  });
  return path;
}

function writeMalformedLeaseSnapshot(root: string): string {
  const path = join(root, 'lease-snapshot-malformed.json');
  writeJson(path, {
    activeLeases: [
      lease({ acquiredAt: 'not-an-iso-date' }),
    ],
  });
  return path;
}

function writeReportAwareFakeNpm(dir: string, logPath: string): void {
  const path = join(dir, 'npm');
  writeFileSync(path, `#!/usr/bin/env bash
set -euo pipefail
test -f "${dir}/story-acceptance-report.json"
test -f "${dir}/verification-catalog.json"
printf '%s\\n' "$*" >> "${logPath}"
exit 0
`);
  chmodSync(path, 0o755);
  const dockerPath = join(dir, 'docker');
  writeFileSync(dockerPath, '#!/usr/bin/env bash\nset -euo pipefail\nif [[ "$1" == "ps" ]]; then exit 0; fi\nexit 1\n');
  chmodSync(dockerPath, 0o755);
  const lsofPath = join(dir, 'lsof');
  writeFileSync(lsofPath, '#!/usr/bin/env bash\nexit 1\n');
  chmodSync(lsofPath, 0o755);
}

type FakeGitOptions = {
  refs?: Record<string, string>;
  mergeBases?: Record<string, string>;
  emptyMergeBases?: readonly string[];
  baseDiffs?: Record<string, readonly string[]>;
  showFiles?: Record<string, string>;
  dirtyFiles?: readonly string[];
  cachedFiles?: readonly string[];
  untrackedFiles?: readonly string[];
};

function bashCasePattern(value: string): string {
  return value.replace(/[\\*?[\]]/g, '\\$&');
}

function bashArrayLiteral(values: readonly string[] = []): string {
  return values.map((value) => `"${value.replace(/["\\$`]/g, '\\$&')}"`).join(' ');
}

function bashAssocLiteral(values: Record<string, string> = {}): string {
  return Object.entries(values)
    .map(([key, value]) => `["${key.replace(/["\\$`]/g, '\\$&')}"]="${value.replace(/["\\$`]/g, '\\$&')}"`)
    .join(' ');
}

function bashDiffCases(baseDiffs: Record<string, readonly string[]> = {}): string {
  return Object.entries(baseDiffs).map(([range, files]) => `
    ${bashCasePattern(range)})
      for file in ${bashArrayLiteral(files)}; do
        printf '%s\\n' "$file"
      done
      exit 0
      ;;
`).join('');
}

function writeFakeGit(dir: string, logPath: string, options: FakeGitOptions): void {
  const path = join(dir, 'git');
  writeFileSync(path, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"

declare -A refs=(${bashAssocLiteral(options.refs)})
declare -A merge_bases=(${bashAssocLiteral(options.mergeBases)})
declare -A show_files=(${bashAssocLiteral(options.showFiles)})
empty_merge_bases=(${bashArrayLiteral(options.emptyMergeBases)})

if [[ "$1" == "fetch" ]]; then
  echo "fetch must not be called" >&2
  exit 99
fi

if [[ "$1" == "rev-parse" && "$2" == "--verify" ]]; then
  ref="$3"
  if [[ -n "\${refs[$ref]:-}" ]]; then
    printf '%s\\n' "\${refs[$ref]}"
    exit 0
  fi
  echo "fatal: Needed a single revision" >&2
  exit 128
fi

if [[ "$1" == "merge-base" ]]; then
  key="$2 $3"
  if [[ -n "\${merge_bases[$key]:-}" ]]; then
    printf '%s\\n' "\${merge_bases[$key]}"
    exit 0
  fi
  for empty_key in "\${empty_merge_bases[@]}"; do
    if [[ "$key" == "$empty_key" ]]; then
      exit 0
    fi
  done
  echo "fatal: no merge base" >&2
  exit 1
fi

if [[ "$1" == "diff" && "$2" == "--name-only" && "$#" -eq 2 ]]; then
  for file in ${bashArrayLiteral(options.dirtyFiles)}; do
    printf '%s\\n' "$file"
  done
  exit 0
fi

if [[ "$1" == "diff" && "$2" == "--name-only" && "$#" -eq 3 && "$3" == "--cached" ]]; then
  for file in ${bashArrayLiteral(options.cachedFiles)}; do
    printf '%s\\n' "$file"
  done
  exit 0
fi

if [[ "$1" == "diff" && "$2" == "--name-only" && "$#" -eq 3 ]]; then
  range="$3"
  case "$range" in
${bashDiffCases(options.baseDiffs)}
    *)
      exit 0
      ;;
  esac
fi

if [[ "$1" == "diff" && "$2" == "--name-only" && "$#" -eq 5 && "$4" == "--" ]]; then
  range="$3"
  path_filter="$5"
  case "$range" in
${bashDiffCases(options.baseDiffs)}
    *)
      exit 0
      ;;
  esac | while IFS= read -r file; do
    if [[ "$file" == "$path_filter" ]]; then
      printf '%s\\n' "$file"
    fi
  done
  exit 0
fi

if [[ "$1" == "show" && "$#" -eq 2 ]]; then
  spec="$2"
  if [[ -n "\${show_files[$spec]:-}" ]]; then
    printf '%s\\n' "\${show_files[$spec]}"
    exit 0
  fi
  echo "fatal: path not found: $spec" >&2
  exit 128
fi

if [[ "$1" == "ls-files" && "$#" -eq 3 && "$2" == "--others" && "$3" == "--exclude-standard" ]]; then
  for file in ${bashArrayLiteral(options.untrackedFiles)}; do
    printf '%s\\n' "$file"
  done
  exit 0
fi

echo "unexpected git command: $*" >&2
exit 2
`);
  chmodSync(path, 0o755);
}

type ReportEvidenceCard = {
  level: string;
  state: string;
  status: string;
  owner: string;
  artifact_path: string | null;
  artifact_path_template: string | null;
  additional_artifact_path_templates: string[];
  artifact_path_template_reason: string | null;
};

type ReportTraceabilityGap = {
  kind: 'missing_catalog_mapping';
  story_id: string;
  level: string;
  owner: string;
  status: string;
  artifact_path_template_reason: string;
  next_action: string;
};

type ReportChangedFileImpact = {
  changed_file: string;
  matched_rules: string[];
  affected_surfaces: string[];
  story_ids: string[];
  manual_review_required: boolean;
  broad_impact: boolean;
};

type ReportStoryCard = {
  risk_level: string;
  risk_reason: string;
  risk_policy_refs: string[];
  risk_policy_source: string;
  required_levels: string[];
  status: string;
  evidence_status: string;
  manual_review_required: boolean;
  manual_review_reasons: string[];
  level_statuses: Array<{ level: string; status: string; reason: string }>;
  evidence_cards: ReportEvidenceCard[];
};

function reportStatusValues(cards: readonly ReportStoryCard[]): string[] {
  return cards.flatMap((card) => [
    card.status,
    card.evidence_status,
    ...card.level_statuses.map((entry) => entry.status),
    ...card.evidence_cards.map((entry) => entry.status),
  ]);
}

type VerifyReport = {
  changed_files: string[];
  required_levels: string[];
  recommended_commands: string[];
  risk_summary: {
    warnings: string[];
    manual_review_required: boolean;
    broad_impact: boolean;
  };
  story_cards: ReportStoryCard[];
};

function runVerifyWithFakeGit(
  root: string,
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = {},
): SpawnSyncReturns<string> {
  return spawnSync('npx', [
    'tsx',
    'scripts/governance/run-verify.ts',
    '--report-root',
    root,
    ...args,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH ?? ''}`,
      CI: '',
      GITHUB_EVENT_NAME: '',
      GITHUB_BASE_REF: '',
      VERIFY_BASE_REF: '',
      ...env,
    },
    encoding: 'utf8',
  });
}

function readVerifyReport(root: string): VerifyReport {
  return JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as VerifyReport;
}

const LEGACY_VERIFY_REPORT_ALIASES = [
  'npm run verify:quick',
  'npm run verify:default',
  'npm run verify:visual',
  'npm run verify:real',
  'npm run verify:release-real',
] as const;
const INTERNAL_VERIFY_HUMAN_COMMAND_PATTERNS = [
  /\bnpm run verify:(?:quick|default|visual|real|release-real)\b/,
  /\bnpm run verify -- --goal=(?:debug|release-real) --run\b/,
  /\bnpm run gate:[a-z0-9:_-]+\b/,
  /\bnpm run lane:[a-z0-9:_-]+\b/,
] as const;
const SENTINEL_PASS_ENV = {
  NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
  INTERNAL_EXECUTION_WS_BASE_URL: 'ws://localhost:20000/api/v1/execution/ws',
  PROXY_DATA_TOKEN: 'test-proxy-token',
  RUNNER_TICKET: 'test-runner-ticket',
  KEYCLOAK_REDIRECT_BASE_URL: 'http://localhost:3000',
  DNS_GATEWAY_REACHABLE: 'true',
  PROVIDER_PROFILE: 'test-provider-profile',
  SECRET_PROFILE: 'test-secret-profile',
  DOCKER_AVAILABLE: 'true',
} as const;

function expectCleanVerifyReportSurface(root: string): void {
  const json = readFileSync(join(root, 'story-acceptance-report.json'), 'utf8');
  const markdown = readFileSync(join(root, 'story-acceptance-report.md'), 'utf8');
  for (const alias of LEGACY_VERIFY_REPORT_ALIASES) {
    expect(json).not.toContain(alias);
    expect(markdown).not.toContain(alias);
  }
  expect(json).not.toMatch(/\bnpm run verify -- --goal=(?:debug|release-real) --run\b/);
  expect(markdown).not.toMatch(/\bnpm run verify -- --goal=(?:debug|release-real) --run\b/);
}

function expectCleanVerifyHumanOutput(output: string): void {
  for (const alias of LEGACY_VERIFY_REPORT_ALIASES) {
    expect(output).not.toContain(alias);
  }
  for (const pattern of INTERNAL_VERIFY_HUMAN_COMMAND_PATTERNS) {
    expect(output).not.toMatch(pattern);
  }
  expect(output).not.toMatch(/\badapter\b/i);
}

function passingSentinelResult() {
  return {
    exitCode: 0 as const,
    output: {
      presence: {},
      profile_digest: 'sha256:test-profile-digest',
      public_endpoint: null,
      port_family: 'unknown',
    },
  };
}

function failingSentinelResult() {
  return {
    exitCode: 1 as const,
    output: {
      presence: {
        'probe.secret_profile_present': false,
      },
      profile_digest: 'sha256:redacted-failing-profile-digest',
      public_endpoint: null,
      port_family: 'unknown',
    },
  };
}

function unifiedSubstrateConflictPreflight(evidencePath: string): ResourceOwnerPreflightResult {
  return {
    ok: false,
    evidencePath,
    evidence: {
      schema: 'agentsmith_resource_owner_preflight/v1',
      target: 'verify-real',
      status: 'failed',
      generated_at: '2026-04-27T12:00:00.000Z',
      lock_id: 'fixed-local-ports',
      checked_ports: [27027],
      conflicts: [],
      blocker: null,
    },
    blocker: {
      port: 27027,
      label: 'Mongo unified substrate database port',
      owner_kind: 'unified-deploy-substrate',
      owner_label: 'agentsmith-unified-substrate-mongodb-1',
      detail: 'agentsmith-unified-substrate/mongodb publishes host port 27027',
      recovery: {
        kind: 'fix',
        command: 'npx tsx scripts/unified-deploy/substrate-lifecycle.ts down',
      },
    },
    conflicts: [],
  };
}

function passingOwnerPreflight(evidencePath: string): ResourceOwnerPreflightResult {
  return {
    ok: true,
    evidencePath,
    evidence: {
      schema: 'agentsmith_resource_owner_preflight/v1',
      target: 'verify-real',
      status: 'passed',
      generated_at: '2026-04-27T12:00:00.000Z',
      lock_id: 'fixed-local-ports',
      checked_ports: [],
      conflicts: [],
      blocker: null,
    },
    conflicts: [],
  };
}

function recommendedPlanBlock(output: string): string {
  return output.split('\n\nNext action:')[0]?.split('Recommended plan:\n')[1] ?? '';
}

function heavyEvidenceDecisionLine(output: string): string {
  const line = output.split('\n').find((candidate) => candidate.startsWith('Heavy evidence: '));
  if (!line) {
    throw new Error(`Missing heavy evidence decision line in output:\n${output}`);
  }
  return line;
}

describe('verify human entrypoints', () => {
  it('keeps npm run verify as a dry-run planner by default', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-dry-run-'));
    try {
      const plan = buildVerificationPlan({ goal: 'pr', run: false });
      const output = renderVerificationPlan(plan);

      expect(plan.mode).toBe('dry-run');
      expect(plan.risk).toBe('fail-closed');
      expect(plan.recommendedCommands).toEqual([
        'npm run verify:quick',
        'npm run verify:default',
      ]);
      expect(output).toContain('AgentSmith Verification');
      expect(output).toContain('Mode: dry-run');
      expect(output).toContain('npm run verify -- --goal=pr --run');
      expect(output).not.toContain('npm run verify -- --goal=real --run');
      expect(output).not.toContain('npm run verify:release-real');
      expect(output).toContain('Final verdict: not evaluated');
      expect(existsSync(join(root, 'artifacts', 'gate-results'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('executes clean pr run without requiring backend-real owner verification', () => {
    const plan = buildVerificationPlan({
      goal: 'pr',
      goalExplicit: true,
      run: true,
    });

    expect(plan.requiredLevels).toEqual(['V0', 'V1']);
    expect(plan.recommendedCommands).toEqual([
      'npm run verify:quick',
      'npm run verify:default',
    ]);
    expect(plan.riskSummary.warnings.join('\n')).not.toContain('cannot execute');
    expect(plan.finalVerdict).toBe('delegated_to_executed_verification_commands');
  });

  it('shows lightweight unified deploy unit diagnostics in dry-run human output', () => {
    const plan = buildVerificationPlan({
      goal: 'pr',
      run: false,
      changedFiles: ['scripts/unified-deploy/check-local-kind-rollout.ts'],
    });
    const output = renderVerificationPlan(plan);
    const recommendedBlock = recommendedPlanBlock(output);

    expect(plan.mode).toBe('dry-run');
    expect(plan.requiredLevels).toEqual(['V4']);
    expect(plan.recommendedCommands).toEqual(['npm run test:unified-deploy:unit']);
    expect(recommendedBlock).toContain('1. npm run test:unified-deploy:unit');
    expect(recommendedBlock).not.toContain('npm run release:ready');
    expect(recommendedBlock).not.toContain('npm run verify:visual');
    expect(output).toContain('Next action: Release or deploy-support path changed. Use npm run product:ready');
    expect(output).not.toContain('Next action: Release or deploy-support path changed. Use npm run release:ready');
  });

  it('prints heavy evidence decisions from selector output for docs-only and env-only plans', () => {
    const docsPlan = buildVerificationPlan({
      goal: 'pr',
      run: false,
      changedFiles: ['docs/user-guides/test-and-evidence-directory-model.md'],
    });
    const envPlan = buildVerificationPlan({
      goal: 'pr',
      run: false,
      changedFiles: ['.env.local.example'],
    });

    const docsDecision = heavyEvidenceDecisionLine(renderVerificationPlan(docsPlan));
    const envDecision = heavyEvidenceDecisionLine(renderVerificationPlan(envPlan));

    expect(docsDecision).toContain('visual=no');
    expect(docsDecision).toContain('backend-real=no');
    expect(docsDecision).toContain('docs/user-guides/test-and-evidence-directory-model.md is docs-only');
    expect(docsDecision).toContain('without visual or backend-real expansion');
    expect(envDecision).toContain('visual=no');
    expect(envDecision).toContain('backend-real=no');
    expect(envDecision).toContain('.env.local.example is env-only configuration');
    expect(envDecision).toContain('without visual or backend-real expansion');
  });

  it('renders docs-only dry-run recommendations through public PR entrypoints only', () => {
    const plan = buildVerificationPlan({
      goal: 'pr',
      run: false,
      changedFiles: ['docs/engineering/archive/governance-verification-runtime-simplification-plan-v1.md'],
    });
    const output = renderVerificationPlan(plan);
    const recommendedBlock = recommendedPlanBlock(output);

    expect(recommendedBlock).toContain('npm run verify -- --goal=pr --run');
    expect(recommendedBlock).not.toMatch(/\bnpm run verify -- --goal=debug --run\b/);
    expect(output).not.toMatch(/\bnpm run verify -- --goal=debug --run\b/);
  });

  it('renders design-system dry-run recommendations through public visual and real entrypoints', () => {
    const plan = buildVerificationPlan({
      goal: 'pr',
      run: false,
      changedFiles: ['src/app/globals.css'],
    });
    const output = renderVerificationPlan(plan);
    const recommendedBlock = recommendedPlanBlock(output);

    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(recommendedBlock).toContain('npm run verify -- --goal=visual --run');
    expect(recommendedBlock).toContain('npm run verify -- --goal=real --run');
    expect(recommendedBlock).not.toMatch(/\bnpm run verify -- --goal=debug --run\b/);
    expect(recommendedBlock).not.toMatch(/\bnpm run verify -- --goal=release-real --run\b/);
  });

  it('renders backend-real full gate dry-run recommendations through release-ready', () => {
    const plan = buildVerificationPlan({
      goal: 'pr',
      run: false,
      changedFiles: ['scripts/backend-real-full-gate.sh'],
    });
    const output = renderVerificationPlan(plan);
    const recommendedBlock = recommendedPlanBlock(output);

    expect(recommendedBlock).toContain('npm run product:ready');
    expect(recommendedBlock).not.toContain('npm run release:ready');
    expect(recommendedBlock).not.toContain('npm run verify -- --goal=real --run');
    expect(recommendedBlock).not.toMatch(/\bnpm run verify -- --goal=release-real --run\b/);
    expect(output).toContain('Next action: Run npm run product:ready');
    expect(output).not.toContain('Next action: Run npm run release:ready');
    expect(output).toContain('not a product readiness conclusion');
    expect(output).not.toMatch(/\bnpm run verify -- --goal=release-real --run\b/);
  });

  it('writes docs-only dry-run reports with only the public PR command', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-report-docs-only-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const exitCode = runVerificationCli([
        '--report-root',
        root,
        '--changed-file',
        'docs/engineering/archive/governance-verification-runtime-simplification-plan-v1.md',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
      });
      const output = stdout.join('');
      const report = readVerifyReport(root);

      expect(exitCode).toBe(0);
      expect(stderr.join('')).toBe('');
      expect(recommendedPlanBlock(output).trim()).toBe('1. npm run verify -- --goal=pr --run');
      expect(report.recommended_commands).toEqual(['npm run verify -- --goal=pr --run']);
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps --run without an explicit goal clean across stdout, stderr, JSON, and markdown', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-no-goal-clean-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const exitCode = runVerificationCli([
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'docs/engineering/archive/governance-verification-runtime-simplification-plan-v1.md',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
      });
      const stdoutText = stdout.join('');
      const stderrText = stderr.join('');
      const report = readVerifyReport(root);

      expect(exitCode).toBe(1);
      expect(stdoutText).toContain('--run requires an explicit public --goal=<pr|visual|real>');
      expect(stderrText).toContain('--run requires an explicit public --goal=<pr|visual|real>');
      expect(report.recommended_commands).toEqual(['npm run verify -- --goal=pr --run']);
      expect(report.risk_summary.warnings.join('\n')).toContain('--run requires an explicit public --goal=<pr|visual|real>');
      expectCleanVerifyHumanOutput(stdoutText);
      expectCleanVerifyHumanOutput(stderrText);
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes design-system dry-run reports with public PR, visual, and real commands', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-report-design-system-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const exitCode = runVerificationCli([
        '--report-root',
        root,
        '--changed-file',
        'src/app/globals.css',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
      });
      const output = stdout.join('');
      const report = readVerifyReport(root);

      expect(exitCode).toBe(0);
      expect(stderr.join('')).toBe('');
      expect(recommendedPlanBlock(output).trim().split('\n')).toEqual([
        '1. npm run verify -- --goal=pr --run',
        '2. npm run verify -- --goal=visual --run',
        '3. npm run verify -- --goal=real --run',
      ]);
      expect(report.recommended_commands).toEqual([
        'npm run verify -- --goal=pr --run',
        'npm run verify -- --goal=visual --run',
        'npm run verify -- --goal=real --run',
      ]);
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes backend-real owner dry-run reports with only release-ready publicly recommended', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-report-backend-real-owner-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const exitCode = runVerificationCli([
        '--report-root',
        root,
        '--changed-file',
        'scripts/backend-real-full-gate.sh',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
      });
      const output = stdout.join('');
      const report = readVerifyReport(root);

      expect(exitCode).toBe(0);
      expect(stderr.join('')).toBe('');
      expect(recommendedPlanBlock(output).trim()).toBe('1. npm run product:ready');
      expect(report.recommended_commands).toEqual(['npm run product:ready']);
      expect(output).toContain('not a product readiness conclusion');
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prints heavy evidence decisions from selector output for visual and backend-real impact', () => {
    const visualPlan = buildVerificationPlan({
      goal: 'pr',
      run: false,
      changedFiles: ['src/components/ui/button.tsx'],
    });
    const backendRealPlan = buildVerificationPlan({
      goal: 'pr',
      run: false,
      changedFiles: ['e2e/stories/backend-real/agent-task-first-success.story.md'],
    });

    const visualDecision = heavyEvidenceDecisionLine(renderVerificationPlan(visualPlan));
    const backendRealDecision = heavyEvidenceDecisionLine(renderVerificationPlan(backendRealPlan));

    expect(visualDecision).toContain('visual=yes');
    expect(visualDecision).toContain('backend-real=yes');
    expect(visualDecision).toContain('src/components/ui/button.tsx touches design-system truth');
    expect(backendRealDecision).toContain('visual=no');
    expect(backendRealDecision).toContain('backend-real=yes');
    expect(backendRealDecision).toContain('e2e/stories/backend-real/agent-task-first-success.story.md is canonical story markdown');
    expect(backendRealDecision).not.toContain('Heavy evidence: visual=no, backend-real=no');
  });

  it('does not use docs-only as the heavy evidence reason for mixed heavy impact plans', () => {
    const plan = buildVerificationPlan({
      goal: 'pr',
      run: false,
      changedFiles: [
        'README.md',
        'scripts/unified-deploy/release-local-kind.sh',
        'src/unknown-heavy.ts',
      ],
    });

    const decision = heavyEvidenceDecisionLine(renderVerificationPlan(plan));

    expect(decision).toContain('visual=yes');
    expect(decision).toContain('backend-real=yes');
    expect(decision).not.toContain('README.md is docs-only');
    expect(decision).toMatch(/release or deploy operations|unmapped source impact/);
  });

  it('exposes friendly verification aliases without replacing existing expert commands', () => {
    const scripts = readPackageScripts();

    expect(scripts.verify).toContain('scripts/governance/run-verify.ts');
    expect(scripts['verify:quick']).toBe('npm run gate:fast');
    expect(scripts['verify:default']).toBe('npm run gate:default');
    expect(scripts['verify:visual']).toBe('npm run lane:visual');
    expect(scripts['verify:real']).toBe('npm run lane:backend-real:core');
    expect(scripts['verify:release-real']).toBe('npm run gate:release');

    expect(scripts['gate:fast']).toBeTruthy();
    expect(scripts['gate:default']).toBeTruthy();
    expect(scripts['lane:visual']).toBeTruthy();
    expect(scripts['lane:backend-real:core']).toBeTruthy();
    expect(scripts['gate:release']).toBeTruthy();
  });

  it('prints verify status as a read-only projection without writing reports or executing aliases', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-status-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--status',
        '--report-root',
        root,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('AgentSmith Verify Status');
      expect(result.stdout).toContain('Goal: verify');
      expect(result.stdout).toContain('Projection: read-only');
      expect(result.stdout).toContain('Lease shadow active run: not-known');
      expect(result.stdout).toContain('Lease shadow destructive command lock: not-known');
      expect(result.stdout).toContain('Lease shadow port family: not-known');
      expect(result.stdout).toContain('Lease shadow secret profile: not-known');
      expect(result.stdout).toContain('Release decision produced: false');
      expect(result.stdout).toContain('Commands executed: false');
      expect(result.stdout).not.toContain('Story acceptance report');
      expect(result.stdout).not.toContain('release_verdict');
      expect(result.stderr).toBe('');
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(false);
      expect(existsSync(join(root, 'story-acceptance-report.md'))).toBe(false);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(false);
      expect(existsSync(logPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prints verify status JSON as the unified read-only projection', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-status-json-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--status',
        '--json',
        '--report-root',
        root,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });
      const projection = JSON.parse(result.stdout) as {
        schema: string;
        projection_kind: string;
        goal: string;
        release_decision_produced: boolean;
        commands_executed: boolean;
      };

      expect(result.status).toBe(0);
      expect(projection).toMatchObject({
        schema: 'agentsmith_status_projection/v1',
        projection_kind: 'read_only',
        goal: 'verify',
        lease_status_shadow: null,
        release_decision_produced: false,
        commands_executed: false,
      });
      expect(JSON.stringify(projection)).not.toContain('release_verdict');
      expect(result.stderr).toBe('');
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(false);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(false);
      expect(existsSync(logPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads an existing active lease snapshot in real verify status JSON and human output', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-status-live-lease-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(root, logPath);
      const snapshotPath = writeLeaseSnapshot(root);
      const env = {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ''}`,
        [LEASE_SNAPSHOT_ENV]: snapshotPath,
        PRESET_ENDPOINT_API_KEY: LEASE_SNAPSHOT_SECRET,
      };

      const jsonResult = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--status',
        '--json',
        '--report-root',
        root,
      ], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
      });
      const projection = JSON.parse(jsonResult.stdout) as {
        lease_status_shadow: {
          active_run: { run_id: string } | null;
          destructive_command_lock: { present: boolean };
          port_family: { present: boolean };
          secret_profile_lock: { present: boolean; profile: { present: boolean; digest: string | null } };
        } | null;
        commands_executed: boolean;
        release_decision_produced: boolean;
      };

      expect(jsonResult.status).toBe(0);
      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expect(projection.lease_status_shadow?.active_run?.run_id).toBe('verify-status-run');
      expect(projection.lease_status_shadow?.destructive_command_lock.present).toBe(true);
      expect(projection.lease_status_shadow?.port_family.present).toBe(true);
      expect(projection.lease_status_shadow?.secret_profile_lock.present).toBe(true);
      expect(projection.lease_status_shadow?.secret_profile_lock.profile).toEqual({
        present: true,
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
      expect(projection.commands_executed).toBe(false);
      expect(projection.release_decision_produced).toBe(false);
      expect(jsonResult.stdout).not.toContain(LEASE_SNAPSHOT_SECRET);

      const humanResult = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--status',
        '--report-root',
        root,
      ], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
      });

      expect(humanResult.status).toBe(0);
      expect(humanResult.stdout).toContain('Lease shadow active run: verify-status-run');
      expect(humanResult.stdout).toContain('Lease shadow destructive command lock: present');
      expect(humanResult.stdout).toContain('Lease shadow port family: present');
      expect(humanResult.stdout).toContain('Lease shadow secret profile: present');
      expect(humanResult.stdout).toContain('profile_presence=true');
      expect(humanResult.stdout).not.toContain(LEASE_SNAPSHOT_SECRET);
      expect(existsSync(logPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('degrades malformed active lease snapshots in real verify status without invalidating JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-status-malformed-lease-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(root, logPath);
      const snapshotPath = writeMalformedLeaseSnapshot(root);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--status',
        '--json',
        '--report-root',
        root,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
          [LEASE_SNAPSHOT_ENV]: snapshotPath,
        },
        encoding: 'utf8',
      });
      const projection = JSON.parse(result.stdout) as {
        lease_status_shadow: unknown;
        commands_executed: boolean;
        release_decision_produced: boolean;
      };

      expect(result.status).toBe(0);
      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expect(projection.lease_status_shadow).toBe(null);
      expect(projection.commands_executed).toBe(false);
      expect(projection.release_decision_produced).toBe(false);
      expect(existsSync(logPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not run sentinel for status or dry-run verify entrypoints', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-sentinel-clean-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const sentinelProfiles: string[] = [];
    const aliases: string[] = [];
    try {
      const dryRunExit = runVerificationCli([
        '--report-root',
        root,
        '--changed-file',
        'e2e/stories/backend-real/notebook-first-success.story.md',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return failingSentinelResult();
        },
        ownerPreflight: passingOwnerPreflight,
        runNpmScript: (script) => {
          aliases.push(script);
          return { status: 0 };
        },
      });
      const statusExit = runVerificationCli([
        '--status',
        '--report-root',
        root,
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return failingSentinelResult();
        },
        ownerPreflight: passingOwnerPreflight,
        runNpmScript: (script) => {
          aliases.push(script);
          return { status: 0 };
        },
      });

      expect(dryRunExit).toBe(0);
      expect(statusExit).toBe(0);
      expect(sentinelProfiles).toEqual([]);
      expect(aliases).toEqual([]);
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast on fixed-port owner conflicts before writing the full real-run plan or executing aliases', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-real-owner-preflight-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const sentinelProfiles: string[] = [];
    const aliases: string[] = [];
    try {
      const evidencePath = join(root, 'preflight', 'evidence.json');
      const exitCode = runVerificationCli([
        '--goal=real',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'e2e/stories/backend-real/notebook-first-success.story.md',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        ownerPreflight: () => unifiedSubstrateConflictPreflight(evidencePath),
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return passingSentinelResult();
        },
        runNpmScript: (script) => {
          aliases.push(script);
          return { status: 0 };
        },
      });

      const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;

      expect(exitCode).toBe(1);
      expect(sentinelProfiles).toEqual([]);
      expect(aliases).toEqual([]);
      expect(combinedOutput.trim().split('\n')).toHaveLength(6);
      expect(combinedOutput).not.toContain('AgentSmith Verification');
      expect(combinedOutput).not.toContain('Verdict:');
      expect(combinedOutput).toContain('Blocker: environment_conflict');
      expect(combinedOutput).toContain('Stage: preflight');
      expect(combinedOutput).toContain('Why: port 27027 is owned by agentsmith-unified-substrate-mongodb-1');
      expect(combinedOutput).toContain('Fix: npx tsx scripts/unified-deploy/substrate-lifecycle.ts down');
      expect(combinedOutput).toContain('Rerun: npm run verify -- --goal=real --run');
      expect(combinedOutput).toContain(`Evidence: ${evidencePath}`);
      expect(combinedOutput).not.toContain('Recommended plan:');
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(false);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prints the dry-run plan from the CLI without executing gates', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-report-root-'));
    try {
      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=visual',
        '--report-root',
        root,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('AgentSmith Verification');
      expect(result.stdout).toContain('Goal: visual');
      expect(result.stdout).toContain('Mode: dry-run');
      expect(result.stdout).toContain('npm run verify -- --goal=visual --run');
      expect(result.stdout).toContain('this is not AgentSmith product readiness / handoff input completeness');
      expect(result.stdout).toContain(`Verification catalog: ${join(root, 'verification-catalog.json')}`);
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(true);
      const markdown = readFileSync(join(root, 'story-acceptance-report.md'), 'utf8');
      expect(markdown).toContain('| Story | Risk | Status | Required levels | Manual review | Next action |');
      expect(markdown).toContain(`- Verification catalog: ${join(root, 'verification-catalog.json')}`);
      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        generated_at: string;
        recommended_commands: string[];
        verification_catalog_path: string;
      };
      const catalog = JSON.parse(readFileSync(join(root, 'verification-catalog.json'), 'utf8')) as {
        provenance: {
          generated_at: string;
          projection_kind: string;
          artifact_directory_inspection: boolean;
          verdict_state: string;
          evidence_claims_created: boolean;
        };
      };
      expect(report.verification_catalog_path).toBe(join(root, 'verification-catalog.json'));
      expect(report.recommended_commands).toEqual([
        'npm run verify -- --goal=pr --run',
        'npm run verify -- --goal=visual --run',
      ]);
      expect(markdown).toContain('- npm run verify -- --goal=pr --run');
      expect(markdown).toContain('- npm run verify -- --goal=visual --run');
      expectCleanVerifyReportSurface(root);
      expect(report.generated_at).toBe(catalog.provenance.generated_at);
      expect(catalog.provenance).toMatchObject({
        projection_kind: 'read_only',
        artifact_directory_inspection: false,
        verdict_state: 'none',
        evidence_claims_created: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects clean branch changed files from implicit origin/main merge-base diff', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-clean-branch-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {
        refs: {
          'origin/main': 'refs/remotes/origin/main',
        },
        mergeBases: {
          'HEAD origin/main': 'merge-base-sha',
        },
        baseDiffs: {
          'merge-base-sha..HEAD': ['src/components/chat/ChatMainPane.tsx'],
        },
      });

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--report-root',
        root,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
          CI: '',
          GITHUB_EVENT_NAME: '',
          GITHUB_BASE_REF: '',
          VERIFY_BASE_REF: '',
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Changed files: src/components/chat/ChatMainPane.tsx');
      expect(result.stdout).toContain('npm run verify -- --goal=visual --run');
      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as VerifyReport;
      expect(report.changed_files).toEqual(['src/components/chat/ChatMainPane.tsx']);
      expect(report.recommended_commands).toContain('npm run verify -- --goal=visual --run');
      expectCleanVerifyReportSurface(root);

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('rev-parse --verify origin/main');
      expect(log).toContain('merge-base HEAD origin/main');
      expect(log).toContain('diff --name-only merge-base-sha..HEAD');
      expect(log).not.toContain('fetch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses explicit --base-ref without probing origin/main or fetching', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-explicit-base-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {
        refs: {
          'upstream/main': 'refs/remotes/upstream/main',
        },
        mergeBases: {
          'HEAD upstream/main': 'upstream-merge-base-sha',
        },
        baseDiffs: {
          'upstream-merge-base-sha..HEAD': ['src/components/chat/ChatMainPane.tsx'],
        },
      });

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--base-ref=upstream/main',
        '--report-root',
        root,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
          CI: '',
          GITHUB_EVENT_NAME: '',
          GITHUB_BASE_REF: '',
          VERIFY_BASE_REF: '',
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as VerifyReport;
      expect(report.changed_files).toEqual(['src/components/chat/ChatMainPane.tsx']);
      expect(report.recommended_commands).toContain('npm run verify -- --goal=visual --run');
      expectCleanVerifyReportSurface(root);

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('rev-parse --verify upstream/main');
      expect(log).toContain('merge-base HEAD upstream/main');
      expect(log).not.toContain('origin/main');
      expect(log).not.toContain('fetch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the selected base ref when classifying clean branch package.json script-only changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-package-base-'));
    const gitLog = join(root, 'git.log');
    const basePackageJson = JSON.stringify({
      scripts: {
        'test:governance': 'bash scripts/governance-default-gate.sh',
      },
      dependencies: {
        next: '15.0.0',
      },
    });
    const currentPackageJson = JSON.stringify({
      scripts: {
        'test:governance': 'bash scripts/governance-default-gate.sh',
        'test:governance-tooling': 'npm run test:run -- scripts/default-gate.test.ts scripts/governance/__tests__/verify-impact-selector.test.ts',
      },
      dependencies: {
        next: '15.0.0',
      },
    });
    try {
      writeFakeGit(root, gitLog, {
        refs: {
          'upstream/main': 'refs/remotes/upstream/main',
        },
        mergeBases: {
          'HEAD upstream/main': 'upstream-merge-base-sha',
        },
        baseDiffs: {
          'upstream-merge-base-sha..HEAD': ['package.json'],
        },
        showFiles: {
          'upstream-merge-base-sha:package.json': basePackageJson,
          'HEAD:package.json': currentPackageJson,
        },
      });

      const result = runVerifyWithFakeGit(root, ['--base-ref=upstream/main']);

      expect(result.status).toBe(0);
      const report = readVerifyReport(root);
      expect(report.changed_files).toEqual(['package.json']);
      expect(report.required_levels).toEqual(['V0', 'V1']);
      expect(report.recommended_commands).toEqual(['npm run verify -- --goal=pr --run']);
      expect(report.risk_summary.broad_impact).toBe(false);
      expect(report.risk_summary.manual_review_required).toBe(false);
      expect(result.stdout).toContain('Heavy evidence: visual=no, backend-real=no');
      expect(result.stdout).not.toContain('unmapped-source');

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('rev-parse --verify upstream/main');
      expect(log).toContain('merge-base HEAD upstream/main');
      expect(log).toContain('show upstream-merge-base-sha:package.json');
      expect(log).not.toContain('origin/main');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses VERIFY_BASE_REF when no explicit base ref is provided', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-env-base-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {
        refs: {
          'origin/develop': 'refs/remotes/origin/develop',
        },
        mergeBases: {
          'HEAD origin/develop': 'env-merge-base-sha',
        },
        baseDiffs: {
          'env-merge-base-sha..HEAD': ['src/components/chat/ChatMainPane.tsx'],
        },
      });

      const result = runVerifyWithFakeGit(root, [], {
        VERIFY_BASE_REF: 'origin/develop',
      });

      expect(result.status).toBe(0);
      const report = readVerifyReport(root);
      expect(report.changed_files).toEqual(['src/components/chat/ChatMainPane.tsx']);
      expect(report.recommended_commands).toContain('npm run verify -- --goal=visual --run');
      expectCleanVerifyReportSurface(root);

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('rev-parse --verify origin/develop');
      expect(log).toContain('merge-base HEAD origin/develop');
      expect(log).not.toContain('origin/main');
      expect(log).not.toContain('fetch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers explicit --base-ref over VERIFY_BASE_REF', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-explicit-over-env-base-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {
        refs: {
          'upstream/main': 'refs/remotes/upstream/main',
          'origin/develop': 'refs/remotes/origin/develop',
        },
        mergeBases: {
          'HEAD upstream/main': 'explicit-merge-base-sha',
          'HEAD origin/develop': 'env-merge-base-sha',
        },
        baseDiffs: {
          'explicit-merge-base-sha..HEAD': ['src/components/chat/ChatMainPane.tsx'],
          'env-merge-base-sha..HEAD': ['src/lib/new-unmapped-source.ts'],
        },
      });

      const result = runVerifyWithFakeGit(root, ['--base-ref', 'upstream/main'], {
        VERIFY_BASE_REF: 'origin/develop',
      });

      expect(result.status).toBe(0);
      const report = readVerifyReport(root);
      expect(report.changed_files).toEqual(['src/components/chat/ChatMainPane.tsx']);
      expect(report.changed_files).not.toContain('src/lib/new-unmapped-source.ts');

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('rev-parse --verify upstream/main');
      expect(log).not.toContain('origin/develop');
      expect(log).not.toContain('fetch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers VERIFY_BASE_REF over GitHub PR base ref', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-env-over-github-base-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {
        refs: {
          'upstream/main': 'refs/remotes/upstream/main',
          'origin/main': 'refs/remotes/origin/main',
        },
        mergeBases: {
          'HEAD upstream/main': 'env-merge-base-sha',
          'HEAD origin/main': 'github-merge-base-sha',
        },
        baseDiffs: {
          'env-merge-base-sha..HEAD': ['src/components/chat/ChatMainPane.tsx'],
          'github-merge-base-sha..HEAD': ['src/lib/new-unmapped-source.ts'],
        },
      });

      const result = runVerifyWithFakeGit(root, [], {
        CI: 'true',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_BASE_REF: 'main',
        VERIFY_BASE_REF: 'upstream/main',
      });

      expect(result.status).toBe(0);
      const report = readVerifyReport(root);
      expect(report.changed_files).toEqual(['src/components/chat/ChatMainPane.tsx']);
      expect(report.changed_files).not.toContain('src/lib/new-unmapped-source.ts');

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('rev-parse --verify upstream/main');
      expect(log).not.toContain('origin/main');
      expect(log).not.toContain('fetch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses goal defaults with a warning when implicit origin/main is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-missing-implicit-base-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {});

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--report-root',
        root,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
          CI: '',
          GITHUB_EVENT_NAME: '',
          GITHUB_BASE_REF: '',
          VERIFY_BASE_REF: '',
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('base ref unavailable');
      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as VerifyReport;
      expect(report.changed_files).toEqual([]);
      expect(report.required_levels).toEqual(['V0', 'V1']);
      expect(report.risk_summary.warnings.join('\n')).toContain('base ref unavailable');
      expect(report.risk_summary.manual_review_required).toBe(false);
      expect(report.risk_summary.broad_impact).toBe(false);

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('rev-parse --verify origin/main');
      expect(log).not.toContain('fetch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses goal defaults with a warning when implicit origin/main merge-base is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-missing-implicit-merge-base-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {
        refs: {
          'origin/main': 'refs/remotes/origin/main',
        },
      });

      const result = runVerifyWithFakeGit(root);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('base ref unavailable');
      const report = readVerifyReport(root);
      expect(report.changed_files).toEqual([]);
      expect(report.required_levels).toEqual(['V0', 'V1']);
      expect(report.risk_summary.warnings.join('\n')).toContain('base ref unavailable');
      expect(report.risk_summary.manual_review_required).toBe(false);
      expect(report.risk_summary.broad_impact).toBe(false);

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('merge-base HEAD origin/main');
      expect(log).not.toContain('fetch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps dirty files when implicit origin/main merge-base returns empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-empty-implicit-merge-base-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {
        refs: {
          'origin/main': 'refs/remotes/origin/main',
        },
        emptyMergeBases: ['HEAD origin/main'],
        dirtyFiles: ['src/components/chat/ChatMainPane.tsx'],
      });

      const result = runVerifyWithFakeGit(root);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('base ref unavailable');
      const report = readVerifyReport(root);
      expect(report.changed_files).toEqual(['src/components/chat/ChatMainPane.tsx']);
      expect(report.recommended_commands).toContain('npm run verify -- --goal=visual --run');
      expectCleanVerifyReportSurface(root);
      expect(report.risk_summary.warnings.join('\n')).toContain('base ref unavailable');
      expect(report.risk_summary.broad_impact).toBe(false);

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('merge-base HEAD origin/main');
      expect(log).toContain('diff --name-only');
      expect(log).not.toContain('fetch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed to broad impact when explicit base ref is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-missing-explicit-base-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {});

      const result = runVerifyWithFakeGit(root, ['--base-ref=upstream/main']);

      expect(result.status).toBe(0);
      const report = readVerifyReport(root);
      expect(report.changed_files).toEqual([]);
      expect(report.risk_summary.warnings.join('\n')).toContain('Changed-file detection failed');
      expect(report.risk_summary.warnings.join('\n')).toContain('base ref unavailable');
      expect(report.risk_summary.manual_review_required).toBe(true);
      expect(report.risk_summary.broad_impact).toBe(true);
      expect(report.story_cards.length).toBeGreaterThan(10);

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('rev-parse --verify upstream/main');
      expect(log).not.toContain('origin/main');
      expect(log).not.toContain('fetch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('unions base, dirty, cached, and untracked changed files', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-base-dirty-union-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {
        refs: {
          'origin/main': 'refs/remotes/origin/main',
        },
        mergeBases: {
          'HEAD origin/main': 'merge-base-sha',
        },
        baseDiffs: {
          'merge-base-sha..HEAD': ['src/components/chat/ChatMainPane.tsx'],
        },
        dirtyFiles: ['scripts/backend-real-full-gate.sh'],
        cachedFiles: ['src/lib/api/endpoints/context.ts'],
        untrackedFiles: ['e2e/stories/backend-real/notebook-first-success.story.md'],
      });

      const result = runVerifyWithFakeGit(root);

      expect(result.status).toBe(0);
      const report = readVerifyReport(root);
      expect(report.changed_files).toEqual([
        'e2e/stories/backend-real/notebook-first-success.story.md',
        'scripts/backend-real-full-gate.sh',
        'src/components/chat/ChatMainPane.tsx',
        'src/lib/api/endpoints/context.ts',
      ]);

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('diff --name-only merge-base-sha..HEAD');
      expect(log).toContain('diff --name-only --cached');
      expect(log).toContain('ls-files --others --exclude-standard');
      expect(log).not.toContain('fetch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed to broad impact when GitHub PR base ref is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-missing-github-base-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {});

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--report-root',
        root,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
          CI: 'true',
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_BASE_REF: 'main',
          VERIFY_BASE_REF: '',
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as VerifyReport;
      expect(report.changed_files).toEqual([]);
      expect(report.risk_summary.warnings.join('\n')).toContain('Changed-file detection failed');
      expect(report.risk_summary.manual_review_required).toBe(true);
      expect(report.risk_summary.broad_impact).toBe(true);
      expect(report.story_cards.length).toBeGreaterThan(10);

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('rev-parse --verify origin/main');
      expect(log).not.toContain('fetch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps --changed-file as highest priority and bypasses git', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-changed-file-priority-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {
        refs: {
          'origin/main': 'refs/remotes/origin/main',
        },
      });

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--report-root',
        root,
        '--base-ref',
        'upstream/main',
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
          CI: 'true',
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_BASE_REF: 'main',
          VERIFY_BASE_REF: 'origin/develop',
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as VerifyReport;
      expect(report.changed_files).toEqual(['src/components/chat/ChatMainPane.tsx']);
      expect(report.recommended_commands).toContain('npm run verify -- --goal=visual --run');
      expectCleanVerifyReportSurface(root);
      expect(existsSync(gitLog)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes the default dry-run report under artifacts/verification', () => {
    let reportRoot: string | undefined;
    try {
      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      const match = result.stdout.match(/Story acceptance report JSON: (.+story-acceptance-report\.json)/);
      expect(match?.[1]).toBeTruthy();
      const jsonPath = match?.[1] ?? '';
      reportRoot = dirname(jsonPath);

      expect(jsonPath).toContain('/artifacts/verification/');
      expect(existsSync(jsonPath)).toBe(true);
      expect(existsSync(join(reportRoot, 'verification-catalog.json'))).toBe(true);
    } finally {
      if (reportRoot?.includes('/artifacts/verification/')) {
        rmSync(reportRoot, { recursive: true, force: true });
        try {
          rmdirSync(join(process.cwd(), 'artifacts', 'verification'));
        } catch {
          // Keep unrelated verification artifacts intact when the directory is not empty.
        }
      }
    }
  });

  it('keeps release-real as a V3 backend-real diagnostic without release readiness claims', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-release-real-'));
    try {
      const releaseRealUxTraceTemplate = findCurrentGateDefinitionById('gate-release')
        ?.standaloneEvidenceArtifacts.find((artifactPath) => artifactPath.includes('/ux-traces'));
      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=release-real',
        '--report-root',
        root,
        '--changed-file',
        'e2e/stories/backend-real/release-user-story-end-to-end.story.md',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Goal: release-real');
      expect(result.stdout).toContain('Required levels: V3');
      expect(result.stdout).toContain('npm run product:ready');
      expect(result.stdout).not.toContain('npm run release:ready');
      expect(result.stdout).toContain('not a product readiness conclusion');
      expect(result.stdout).not.toContain('npm run verify -- --goal=real --run');
      expect(result.stdout).not.toContain('npm run verify -- --goal=release-real --run');
      expect(result.stdout).not.toContain('npm run verify:release-real');
      expect(result.stdout).not.toContain('npm run verify:visual');
      expect(result.stdout).not.toContain('npm run verify:real');
      expect(result.stdout).toContain('this is not AgentSmith product readiness / handoff input completeness and not a product readiness conclusion');

      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        release_verdict: boolean;
        not_release_readiness: boolean;
        required_levels: string[];
        recommended_commands: string[];
        traceability_gaps: ReportTraceabilityGap[];
        story_cards: ReportStoryCard[];
      };
      const v3Evidence = report.story_cards[0]?.evidence_cards.find((card) => card.level === 'V3');

      expect(releaseRealUxTraceTemplate).toBeTruthy();
      expect(report.required_levels).toEqual(['V3']);
      expect(report.required_levels).not.toContain('V4');
      expect(report.recommended_commands).toEqual(['npm run product:ready']);
      expect(report.story_cards[0]).toMatchObject({
        risk_level: 'R0',
        risk_policy_refs: ['release_blocking_governance'],
        risk_policy_source: 'scripts/governance/current-story-risk-policy.ts',
        required_levels: ['V3'],
      });
      expect(report.story_cards[0]?.risk_reason).toContain('release_blocking_governance');
      expect(v3Evidence).toMatchObject({
        state: 'not_inspected_by_verify_report',
        status: 'manual_review_needed',
        owner: 'npm run product:ready',
        artifact_path: null,
        artifact_path_template: releaseRealUxTraceTemplate,
        artifact_path_template_reason: null,
      });
      expect(v3Evidence?.additional_artifact_path_templates).toEqual([]);
      expect(report.traceability_gaps).toEqual([]);
      expect(report.release_verdict).toBe(false);
      expect(report.not_release_readiness).toBe(true);
      expect(reportStatusValues(report.story_cards)).not.toContain('passed');
      expect(reportStatusValues(report.story_cards)).not.toContain('stale');

      const markdown = readFileSync(join(root, 'story-acceptance-report.md'), 'utf8');
      expect(markdown).toContain('- npm run product:ready');
      expect(markdown).not.toContain('- npm run release:ready');
      expect(markdown).toContain('## Traceability Gaps');
      expect(markdown).toContain('No traceability gaps were detected.');
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes release-real goal-default reports with only the governed clean command', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-release-real-default-'));
    const gitLog = join(root, 'git.log');
    try {
      writeFakeGit(root, gitLog, {
        refs: {
          'origin/main': 'refs/remotes/origin/main',
        },
        mergeBases: {
          'HEAD origin/main': 'merge-base-sha',
        },
      });

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=release-real',
        '--report-root',
        root,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
          CI: '',
          GITHUB_EVENT_NAME: '',
          GITHUB_BASE_REF: '',
          VERIFY_BASE_REF: '',
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('npm run product:ready');
      expect(result.stdout).not.toContain('npm run release:ready');
      expect(result.stdout).not.toContain('npm run verify -- --goal=real --run');
      expect(result.stdout).not.toContain('npm run verify -- --goal=release-real --run');
      expect(result.stdout).not.toContain('npm run verify:release-real');
      const report = readVerifyReport(root);
      expect(report.recommended_commands).toEqual(['npm run product:ready']);
      expectCleanVerifyReportSurface(root);
      expect(readFileSync(join(root, 'story-acceptance-report.md'), 'utf8'))
        .toContain('- npm run product:ready');
      expect(readFileSync(gitLog, 'utf8')).toContain('diff --name-only merge-base-sha..HEAD');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not execute npm gate aliases on default dry-run even when fake npm is first on PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--report-root',
        root,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Mode: dry-run');
      expect(result.stdout).toContain('npm run verify -- --goal=visual --run');
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(true);
      expect(existsSync(logPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes a fail-closed report and refuses --run without an explicit --goal', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-missing-goal-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('--run requires an explicit public --goal=<pr|visual|real>');
      expectCleanVerifyHumanOutput(result.stdout);
      expectCleanVerifyHumanOutput(result.stderr);
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(true);
      expect(existsSync(logPath)).toBe(false);

      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        final_verdict: string;
        risk_summary: { warnings: string[] };
      };
      expect(report.final_verdict).toBe('not_evaluated_fail_closed');
      expect(report.risk_summary.warnings.join('\n')).toContain('--run requires an explicit public --goal=<pr|visual|real>');
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not implicitly execute verify:real for pr/debug/visual run goals', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-real-blocked-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=pr',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'e2e/stories/backend-real/notebook-first-success.story.md',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('--goal=pr --run cannot execute npm run verify -- --goal=real --run');
      expectCleanVerifyHumanOutput(result.stdout);
      expect(result.stderr).toContain('--goal=pr --run cannot execute npm run verify -- --goal=real --run');
      expectCleanVerifyHumanOutput(result.stderr);
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(true);
      expect(existsSync(logPath)).toBe(false);

      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        final_verdict: string;
        recommended_commands: string[];
        risk_summary: { warnings: string[] };
      };
      expect(report.final_verdict).toBe('not_evaluated_fail_closed');
      expect(report.recommended_commands).toContain('npm run verify -- --goal=real --run');
      expect(report.risk_summary.warnings.join('\n')).toContain('--goal=pr --run cannot execute npm run verify -- --goal=real --run');
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports package runner sources as backend-real owner review when pr run blocks implicit real execution', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-package-real-blocked-'));
    const logPath = join(root, 'npm.log');
    const changedFile = 'packages/api-entry-node/src/managed-credential-resolver.ts';
    try {
      writeFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=pr',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        changedFile,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Affected surfaces: runner/context-store/credentials');
      expect(result.stdout).toContain('runner_context_credential');
      expect(result.stdout).not.toContain('unmapped-source');
      expect(result.stdout).not.toContain('unmapped_source');
      expect(result.stdout).not.toContain('did not match canonical story markdown');
      expect(result.stdout).toContain('runner, Context Store, and credential owner review');
      expect(result.stderr).toContain('--goal=pr --run cannot execute npm run verify -- --goal=real --run');
      expectCleanVerifyHumanOutput(result.stdout);
      expectCleanVerifyHumanOutput(result.stderr);
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(true);
      expect(existsSync(logPath)).toBe(false);

      const reportJson = readFileSync(join(root, 'story-acceptance-report.json'), 'utf8');
      expect(reportJson).toContain('runner_context_credential');
      expect(reportJson).not.toContain('unmapped-source');
      expect(reportJson).not.toContain('unmapped_source');
      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        final_verdict: string;
        recommended_commands: string[];
        risk_summary: { warnings: string[] };
        changed_file_impacts: ReportChangedFileImpact[];
      };
      expect(report.final_verdict).toBe('not_evaluated_fail_closed');
      expect(report.recommended_commands).toContain('npm run verify -- --goal=real --run');
      expect(report.risk_summary.warnings.join('\n')).toContain('--goal=pr --run cannot execute npm run verify -- --goal=real --run');
      expect(report.risk_summary.warnings.join('\n')).not.toContain('did not match canonical story markdown');
      expect(report.changed_file_impacts).toEqual([
        expect.objectContaining({
          changed_file: changedFile,
          matched_rules: ['runner_context_credential'],
          affected_surfaces: ['runner/context-store/credentials'],
          manual_review_required: true,
          broad_impact: true,
        }),
      ]);
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not implicitly execute release-real diagnostics for non-release-real run goals', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-release-real-blocked-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=visual',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'scripts/backend-real-full-gate.sh',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('--goal=visual --run cannot cover product-readiness backend-real owner changes');
      expect(result.stdout).toContain('npm run product:ready');
      expect(result.stdout).not.toContain('npm run release:ready');
      expect(result.stdout).not.toContain('npm run verify -- --goal=real --run');
      expectCleanVerifyHumanOutput(result.stdout);
      expect(result.stderr).toContain('--goal=visual --run cannot cover product-readiness backend-real owner changes');
      expect(result.stderr).toContain('npm run product:ready');
      expect(result.stderr).not.toContain('npm run release:ready');
      expect(result.stderr).not.toContain('npm run verify -- --goal=real --run');
      expectCleanVerifyHumanOutput(result.stderr);
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(true);
      expect(existsSync(logPath)).toBe(false);

      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        final_verdict: string;
        recommended_commands: string[];
        release_verdict: boolean;
        risk_summary: { warnings: string[] };
      };
      expect(report.final_verdict).toBe('not_evaluated_fail_closed');
      expect(report.recommended_commands).toContain('npm run product:ready');
      expect(report.release_verdict).toBe(false);
      expect(report.risk_summary.warnings.join('\n')).toContain('--goal=visual --run cannot cover product-readiness backend-real owner changes');
      expect(report.risk_summary.warnings.join('\n')).toContain('npm run product:ready');
      expect(report.risk_summary.warnings.join('\n')).not.toContain('npm run release:ready');
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes the report before executing recommended aliases when --run and a safe goal are explicit', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeReportAwareFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=visual',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(readFileSync(logPath, 'utf8').trim().split('\n')).toEqual([
        'run verify:quick',
        'run verify:default',
        'run verify:visual',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes same-run fast evidence reuse to default after quick succeeds', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-default-reuse-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const captured: Array<{ script: string; env: NodeJS.ProcessEnv }> = [];
    try {
      const exitCode = runVerificationCli([
        '--goal=pr',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'scripts/governance/verify-impact-selector.ts',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        runNpmScript: (script, context) => {
          captured.push({ script, env: context.env });
          return { status: 0 };
        },
        pureCheckShadowRepoRoot: root,
        pureCheckShadowGitSha: 'current-git-sha',
      });

      expect(exitCode).toBe(0);
      expect(captured.map((entry) => entry.script)).toEqual(['verify:quick', 'verify:default']);
      expect(captured.find((entry) => entry.script === 'verify:quick')?.env.DEFAULT_GATE_REUSE_FAST_EVIDENCE)
        .toBeUndefined();
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.DEFAULT_GATE_REUSE_FAST_EVIDENCE)
        .toBe('1');
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL)
        .toBeUndefined();
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.GOVERNANCE_DEFAULT_GATE_SKIP_FOCUSED_VISUAL)
        .toBeUndefined();
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE)
        .toBeUndefined();
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.DEFAULT_GATE_PROFILE)
        .toBe('governance_tooling');
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not pass the governance tooling default profile for mixed mapped pr runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-mixed-no-governance-profile-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const captured: Array<{ script: string; env: NodeJS.ProcessEnv }> = [];
    try {
      const exitCode = runVerificationCli([
        '--goal=pr',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'scripts/governance/verify-impact-selector.ts',
        '--changed-file',
        'README.md',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        runNpmScript: (script, context) => {
          captured.push({ script, env: context.env });
          return { status: 0 };
        },
        pureCheckShadowRepoRoot: root,
        pureCheckShadowGitSha: 'current-git-sha',
      });

      expect(exitCode).toBe(0);
      expect(captured.map((entry) => entry.script)).toEqual(['verify:quick', 'verify:default']);
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.DEFAULT_GATE_PROFILE)
        .toBeUndefined();
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes focused visual skip env to default when the same run owns full visual evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-visual-reuse-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const captured: Array<{ script: string; env: NodeJS.ProcessEnv }> = [];
    try {
      const exitCode = runVerificationCli([
        '--goal=visual',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        runNpmScript: (script, context) => {
          captured.push({ script, env: context.env });
          return { status: 0 };
        },
        pureCheckShadowRepoRoot: root,
        pureCheckShadowGitSha: 'current-git-sha',
      });

      expect(exitCode).toBe(0);
      expect(captured.map((entry) => entry.script)).toEqual(['verify:quick', 'verify:default', 'verify:visual']);
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.DEFAULT_GATE_REUSE_FAST_EVIDENCE)
        .toBe('1');
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL)
        .toBe('1');
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.GOVERNANCE_DEFAULT_GATE_SKIP_FOCUSED_VISUAL)
        .toBe('1');
      expect(captured.find((entry) => entry.script === 'verify:visual')?.env.WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL)
        .toBeUndefined();
      expect(captured.find((entry) => entry.script === 'verify:visual')?.env.GOVERNANCE_DEFAULT_GATE_SKIP_FOCUSED_VISUAL)
        .toBeUndefined();
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs quick/default for governance tooling pr runs without unmapped-source impact', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-governance-tooling-'));
    const logPath = join(root, 'npm.log');
    try {
      writeReportAwareFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=pr',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'scripts/governance/verify-impact-selector.ts',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Affected surfaces: engineering-governance-tooling');
      expect(result.stdout).not.toContain('unmapped-source');
      expect(result.stderr).not.toContain('unmapped-source');
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(true);
      expect(readFileSync(logPath, 'utf8').trim().split('\n')).toEqual([
        'run verify:quick',
        'run verify:default',
      ]);
      expect(readFileSync(logPath, 'utf8')).not.toContain('verify:real');

      const reportJson = readFileSync(join(root, 'story-acceptance-report.json'), 'utf8');
      const reportMarkdown = readFileSync(join(root, 'story-acceptance-report.md'), 'utf8');
      expect(reportJson).not.toContain('unmapped-source');
      expect(reportMarkdown).not.toContain('unmapped-source');
      const report = JSON.parse(reportJson) as {
        final_verdict: string;
        recommended_commands: string[];
        risk_summary: { manual_review_required: boolean; broad_impact: boolean; warnings: string[] };
        story_cards: unknown[];
        changed_file_impacts: ReportChangedFileImpact[];
      };
      expect(report.final_verdict).toBe('delegated_to_executed_verification_commands');
      expect(report.recommended_commands).toEqual(['npm run verify -- --goal=pr --run']);
      expect(report.risk_summary.manual_review_required).toBe(false);
      expect(report.risk_summary.broad_impact).toBe(false);
      expect(report.risk_summary.warnings.join('\n')).not.toContain('did not match canonical story markdown');
      expect(report.story_cards).toEqual([]);
      expect(report.changed_file_impacts).toEqual([
        expect.objectContaining({
          changed_file: 'scripts/governance/verify-impact-selector.ts',
          matched_rules: ['governance_tooling'],
          affected_surfaces: ['engineering-governance-tooling'],
          story_ids: [],
          manual_review_required: false,
          broad_impact: false,
        }),
      ]);
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs pr verify for mixed docs/contracts and release boundary changes without unmapped or real blockers', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-contract-release-boundary-'));
    const logPath = join(root, 'npm.log');
    const changedFiles = [
      'docs/contracts/README.md',
      'docs/contracts/product-terminology.md',
      'docs/contracts/unified-deploy-contract.md',
      'docs/engineering/release-kit-and-runner-repo-split-kiss-plan-v1.md',
      'scripts/contracts/check-unified-deploy-vocabulary.ts',
      'scripts/contracts/check-unified-deploy-vocabulary.test.ts',
    ];
    try {
      writeReportAwareFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=pr',
        '--run',
        '--report-root',
        root,
        ...changedFiles.flatMap((changedFile) => ['--changed-file', changedFile]),
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Affected surfaces: docs-only; release-boundary-guard; release/deploy');
      expect(result.stdout).toContain('npm run product:ready');
      expect(result.stdout).not.toContain('npm run release:ready');
      expect(result.stdout).not.toContain('unmapped-source');
      expect(result.stderr).not.toContain('unmapped-source');
      expect(result.stdout).not.toContain('--goal=real --run');
      expect(result.stderr).not.toContain('--goal=real --run');
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(true);
      expect(readFileSync(logPath, 'utf8').trim().split('\n')).toEqual([
        'run verify:quick',
        'run verify:default',
        'run test:unified-deploy:unit',
      ]);

      const reportJson = readFileSync(join(root, 'story-acceptance-report.json'), 'utf8');
      const reportMarkdown = readFileSync(join(root, 'story-acceptance-report.md'), 'utf8');
      expect(reportJson).not.toContain('unmapped-source');
      expect(reportJson).not.toContain('unmapped_source');
      expect(reportMarkdown).not.toContain('unmapped-source');
      expect(reportMarkdown).not.toContain('unmapped_source');
      const report = JSON.parse(reportJson) as {
        final_verdict: string;
        recommended_commands: string[];
        risk_summary: { warnings: string[] };
        changed_file_impacts: ReportChangedFileImpact[];
      };
      expect(report.final_verdict).toBe('delegated_to_executed_verification_commands');
      expect(report.recommended_commands).toEqual([
        'npm run verify -- --goal=pr --run',
        'npm run test:unified-deploy:unit',
      ]);
      expect(report.risk_summary.warnings.join('\n')).not.toContain('cannot execute npm run verify -- --goal=real --run');
      expect(report.changed_file_impacts.flatMap((impact) => impact.matched_rules)).not.toContain('unmapped_source');
      expect(report.changed_file_impacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          changed_file: 'docs/contracts/README.md',
          matched_rules: ['docs_only'],
        }),
        expect.objectContaining({
          changed_file: 'docs/contracts/product-terminology.md',
          matched_rules: ['docs_only'],
        }),
        expect.objectContaining({
          changed_file: 'docs/contracts/unified-deploy-contract.md',
          matched_rules: ['release_deploy_operations'],
        }),
        expect.objectContaining({
          changed_file: 'docs/engineering/release-kit-and-runner-repo-split-kiss-plan-v1.md',
          matched_rules: ['release_boundary_guard'],
        }),
        expect.objectContaining({
          changed_file: 'scripts/contracts/check-unified-deploy-vocabulary.ts',
          matched_rules: ['release_boundary_guard'],
        }),
        expect.objectContaining({
          changed_file: 'scripts/contracts/check-unified-deploy-vocabulary.test.ts',
          matched_rules: ['release_boundary_guard'],
        }),
      ]));
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes backend-real reuse env to real after default succeeds in the same run', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-real-reuse-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const sentinelProfiles: string[] = [];
    const captured: Array<{ script: string; env: NodeJS.ProcessEnv }> = [];
    try {
      const exitCode = runVerificationCli([
        '--goal=real',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'e2e/stories/backend-real/notebook-first-success.story.md',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        ownerPreflight: passingOwnerPreflight,
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return passingSentinelResult();
        },
        runNpmScript: (script, context) => {
          captured.push({ script, env: context.env });
          return { status: 0 };
        },
        pureCheckShadowRepoRoot: root,
        pureCheckShadowGitSha: 'current-git-sha',
      });

      expect(exitCode).toBe(0);
      expect(sentinelProfiles).toEqual(['verify-real']);
      expect(captured.map((entry) => entry.script)).toEqual([
        'verify:quick',
        'verify:default',
        'verify:visual',
        'verify:real',
      ]);
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.DEFAULT_GATE_REUSE_FAST_EVIDENCE)
        .toBe('1');
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL)
        .toBe('1');
      expect(captured.find((entry) => entry.script === 'verify:default')?.env.GOVERNANCE_DEFAULT_GATE_SKIP_FOCUSED_VISUAL)
        .toBe('1');
      expect(captured.find((entry) => entry.script === 'verify:real')?.env.BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE)
        .toBe('1');
      expect(captured.find((entry) => entry.script === 'verify:quick')?.env.BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE)
        .toBeUndefined();
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not execute the bare agent-task integration alias for runner context real runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-runner-context-real-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const sentinelProfiles: string[] = [];
    const aliases: string[] = [];
    const bareAgentTaskIntegration = /npm run test:e2e:integration:agent-task(?:[\s,]|$)/;
    try {
      const exitCode = runVerificationCli([
        '--goal=real',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'packages/api-entry-node/src/managed-credential-resolver.ts',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        ownerPreflight: passingOwnerPreflight,
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return passingSentinelResult();
        },
        runNpmScript: (script) => {
          aliases.push(script);
          return { status: 0 };
        },
        pureCheckShadowRepoRoot: root,
        pureCheckShadowGitSha: 'current-git-sha',
      });
      const report = readVerifyReport(root);

      expect(exitCode).toBe(0);
      expect(sentinelProfiles).toEqual(['verify-real']);
      expect(aliases).toEqual([
        'verify:quick',
        'verify:default',
        'verify:visual',
        'test:agent-task:runner:fast',
        'test:agent-task:runner:backend-real',
        'verify:real',
      ]);
      expect(aliases).not.toContain('test:e2e:integration:agent-task');
      expect(stdout.join('')).not.toMatch(bareAgentTaskIntegration);
      expect(report.recommended_commands).toEqual([
        'npm run verify -- --goal=pr --run',
        'npm run verify -- --goal=visual --run',
        'npm run test:agent-task:runner:fast',
        'npm run test:agent-task:runner:backend-real',
        'npm run verify -- --goal=real --run',
      ]);
      expect(report.recommended_commands).not.toContain('npm run test:e2e:integration:agent-task');
      expect(JSON.stringify(report)).not.toMatch(bareAgentTaskIntegration);
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finalizes verify-real cleanup after successful aliases so later real preflight is not blocked by its own resources', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-real-cleanup-success-'));
    const shadowRoot = join(root, 'claim-store-shadow');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cleanupContexts: Array<{ reportRoot: string; repoRoot: string; goal: string }> = [];
    const cleanupReasons: string[] = [];
    const aliasClaimStoreRoots: string[] = [];
    try {
      mkdirSync(shadowRoot, { recursive: true });
      const exitCode = runVerificationCli([
        '--goal=real',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'e2e/stories/backend-real/notebook-first-success.story.md',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        ownerPreflight: passingOwnerPreflight,
        sentinelRunner: () => passingSentinelResult(),
        runNpmScript: (_script, context) => {
          aliasClaimStoreRoots.push(context.env[CLAIM_STORE_ROOT_ENV] ?? '');
          return { status: 0 };
        },
        cleanupFinalizer: (context) => {
          cleanupContexts.push({
            reportRoot: context.reportRoot,
            repoRoot: context.repoRoot,
            goal: context.goal,
          });
          return {
            finalize: (reason) => cleanupReasons.push(reason),
          };
        },
        pureCheckShadowRepoRoot: shadowRoot,
        pureCheckShadowGitSha: 'current-git-sha',
      });

      expect(exitCode).toBe(0);
      expect(cleanupContexts).toEqual([{ reportRoot: root, repoRoot: process.cwd(), goal: 'real' }]);
      expect(cleanupReasons).toEqual(['success']);
      expect(new Set(aliasClaimStoreRoots)).toEqual(new Set([shadowRoot]));
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finalizes verify-real cleanup after failed aliases before returning the alias failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-real-cleanup-failure-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cleanupReasons: string[] = [];
    try {
      const exitCode = runVerificationCli([
        '--goal=real',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'e2e/stories/backend-real/notebook-first-success.story.md',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        ownerPreflight: passingOwnerPreflight,
        sentinelRunner: () => passingSentinelResult(),
        runNpmScript: (script) => ({ status: script === 'verify:real' ? 7 : 0 }),
        cleanupFinalizer: () => ({
          finalize: (reason) => cleanupReasons.push(reason),
        }),
        pureCheckShadowRepoRoot: root,
        pureCheckShadowGitSha: 'current-git-sha',
      });

      expect(exitCode).toBe(7);
      expect(cleanupReasons).toEqual(['failure']);
      expect(stderr.join('')).toContain('Blocker: verify_alias_failed');
      expect(stderr.join('')).toContain('internal backend-real verification check step');
      expect(stdout.join('')).toContain('Pure check shadow audit:');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not run sentinel for explicit visual run before executing aliases', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-visual-no-sentinel-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const sentinelProfiles: string[] = [];
    const aliases: string[] = [];
    try {
      const exitCode = runVerificationCli([
        '--goal=visual',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return failingSentinelResult();
        },
        runNpmScript: (script) => {
          aliases.push(script);
          return { status: 0 };
        },
        pureCheckShadowRepoRoot: root,
        pureCheckShadowGitSha: 'current-git-sha',
      });

      expect(exitCode).toBe(0);
      expect(sentinelProfiles).toEqual([]);
      expect(aliases).toEqual(['verify:quick', 'verify:default', 'verify:visual']);
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes verify run context env to npm aliases so default-gate can write producer evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-env-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const captured: Array<{
      script: string;
      reportRoot: string;
      repoRoot: string;
      gitSha: string;
      env: NodeJS.ProcessEnv;
    }> = [];
    try {
      const exitCode = runVerificationCli([
        '--goal=debug',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        runNpmScript: (script, context) => {
          captured.push({
            script,
            reportRoot: context.reportRoot,
            repoRoot: context.repoRoot,
            gitSha: context.gitSha,
            env: context.env,
          });
          throw new Error('stop after env capture');
        },
        pureCheckShadowRepoRoot: root,
        pureCheckShadowGitSha: 'current-git-sha',
      });

      expect(exitCode).toBe(1);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        script: 'verify:quick',
        reportRoot: root,
        repoRoot: root,
        gitSha: 'current-git-sha',
      });
      expect(captured[0]?.env.AGENTSMITH_VERIFY_REPORT_ROOT).toBe(root);
      expect(captured[0]?.env.AGENTSMITH_VERIFY_REPO_ROOT).toBe(root);
      expect(captured[0]?.env.AGENTSMITH_VERIFY_GIT_SHA).toBe('current-git-sha');
      expect(captured[0]?.env[CLAIM_STORE_ROOT_ENV]).toBe(root);
      expect(captured[0]?.env[CLAIM_STORE_GIT_SHA_ENV]).toBe('current-git-sha');
      expect(captured[0]?.env[READINESS_STATE_ENV.path]).toBe(join(root, 'state', 'readiness.json'));
      expect(captured[0]?.env[READINESS_STATE_ENV.invocationId]).toBeTruthy();
      expect(captured[0]?.env[READINESS_STATE_ENV.processNonce]).toBeTruthy();
      expect(existsSync(join(root, 'state', 'readiness.json'))).toBe(true);
      expect(validateRunReadinessStateForConsumer({
        statePath: captured[0]?.env[READINESS_STATE_ENV.path] ?? '',
        invocationId: captured[0]?.env[READINESS_STATE_ENV.invocationId] ?? '',
        processNonce: captured[0]?.env[READINESS_STATE_ENV.processNonce] ?? '',
        inputDigest: captured[0]?.env[READINESS_STATE_ENV.inputDigest],
        envDigest: captured[0]?.env[READINESS_STATE_ENV.envDigest],
        gitSha: 'current-git-sha',
      })).toMatchObject({ ok: true });
      expect(stderr.join('')).toContain('[verify] stop after env capture');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes pure check shadow audit for non-release verify run without claiming unit coverage', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-pure-shadow-audit-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const aliases: string[] = [];
    try {
      const existingIdentity = findCurrentPureCheckIdentityById('contracts');
      expect(existingIdentity).toBeDefined();
      if (!existingIdentity) {
        return;
      }
      const existingClaim = buildPureCheckRuntimeShadowClaimRecord({
        identity: existingIdentity,
        scope: 'debug',
        evidenceDir: 'artifacts/previous-pure-shadow/contracts',
        resultStatus: 'passed',
        failureClass: 'none',
        inputDigest: `sha256:${'1'.repeat(64)}`,
        artifactDigest: `sha256:${'2'.repeat(64)}`,
        resultDigest: `sha256:${'3'.repeat(64)}`,
        gitSha: 'previous-git-sha',
        generatedAt: '2026-04-25T12:00:00.000Z',
        producerOrigin: 'test-seed',
      });
      expect(existingClaim.ok).toBe(true);
      if (!existingClaim.ok) {
        return;
      }
      const stableStorePath = join(root, STABLE_PURE_CHECK_CLAIMS_JSONL_PATH);
      mkdirSync(dirname(stableStorePath), { recursive: true });
      writeFileSync(stableStorePath, `${JSON.stringify(existingClaim.value)}\n`);

      const exitCode = runVerificationCli([
        '--goal=visual',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        runNpmScript: (script) => {
          aliases.push(script);
          return { status: 0 };
        },
        pureCheckShadowRepoRoot: root,
        pureCheckShadowGitSha: 'current-git-sha',
      });

      expect(exitCode).toBe(0);
      expect(aliases).toEqual(['verify:quick', 'verify:default', 'verify:visual']);
      expect(stderr.join('')).toBe('');
      expect(stdout.join('')).toContain(`Pure check shadow audit: ${join(root, PURE_CHECK_SHADOW_AUDIT_FILE_NAME)}`);

      const audit = JSON.parse(readFileSync(join(root, PURE_CHECK_SHADOW_AUDIT_FILE_NAME), 'utf8')) as {
        schema: string;
        audit_scope: string;
        summary_semantics: string;
        cache_semantics: string;
        claim_store_read: boolean;
        claim_store_write: boolean;
        claim_count: number;
        valid_count: number;
        invalid_count: number;
        checks: Array<{
          check_id: string;
          decision: string;
          would_reuse: boolean;
          reason_codes: string[];
          result_status?: string;
          failure_class?: string;
          script_results?: Array<{
            script: string;
            result_status: string;
            failure_class: string;
          }>;
          claim_store_read: boolean;
          claim_store_write: boolean;
          claim_count: number;
          valid_count: number;
          invalid_count: number;
          audit_digests?: {
            scope: string;
            input?: string;
            artifact?: string;
            result?: string;
            claim?: string;
          };
        }>;
      };
      const digestPattern = /^sha256:[0-9a-f]{64}$/;

      expect(audit).toMatchObject({
        schema: 'agentsmith_pure_check_shadow_audit/v1',
        audit_scope: 'pure_check_shadow_audit',
        summary_semantics: 'audit_only_not_release_verdict',
        cache_semantics: 'shadow_no_skip',
        claim_store_read: true,
        claim_store_write: false,
        claim_count: 1,
        valid_count: 0,
        invalid_count: 1,
      });
      expect(audit.checks.map((check) => check.check_id)).toEqual([
        'contracts',
        'openapi-contract',
        'openapi-generated',
        'lint',
        'typecheck',
      ]);
      expect(audit.checks.map((check) => check.check_id)).not.toContain('unit');
      expect(audit.checks.every((check) => check.decision === 'rerun_required')).toBe(true);
      expect(audit.checks.every((check) => check.would_reuse === false)).toBe(true);
      expect(audit.checks.every((check) => check.claim_store_read === true)).toBe(true);
      expect(audit.checks.every((check) => check.claim_store_write === false)).toBe(true);
      expect(audit.checks.every((check) => check.result_status === 'passed')).toBe(true);
      expect(audit.checks.every((check) => check.failure_class === 'none')).toBe(true);
      expect(audit.checks.every((check) => check.script_results?.some((script) => (
        script.script === 'verify:quick'
        && script.result_status === 'passed'
        && script.failure_class === 'none'
      )))).toBe(true);
      expect(audit.checks.every((check) => check.audit_digests?.scope === 'pure_check_shadow_audit')).toBe(true);
      expect(audit.checks.every((check) => digestPattern.test(check.audit_digests?.input ?? ''))).toBe(true);
      expect(audit.checks.every((check) => digestPattern.test(check.audit_digests?.artifact ?? ''))).toBe(true);
      expect(audit.checks.every((check) => digestPattern.test(check.audit_digests?.result ?? ''))).toBe(true);
      expect(audit.checks.every((check) => check.audit_digests?.claim === undefined)).toBe(true);
      expect(audit.checks.find((check) => check.check_id === 'contracts')).toMatchObject({
        claim_count: 1,
        valid_count: 0,
        invalid_count: 1,
        reason_codes: expect.arrayContaining([
          'stable_claim_not_reusable_without_current_producer_evidence',
          'producer_evidence_missing',
          'runtime_shadow_claim_not_written',
        ]),
      });
      expect(audit.checks.filter((check) => check.check_id !== 'contracts').every((check) => (
        check.claim_count === 0
        && check.valid_count === 0
        && check.invalid_count === 0
        && check.reason_codes.includes('stable_claim_store_empty')
      ))).toBe(true);
      expect(audit.checks.every((check) => check.reason_codes.includes('producer_evidence_missing')))
        .toBe(true);

      const stableClaims = readFileSync(stableStorePath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { check_id: string });
      expect(existsSync(join(root, 'evidence-claims.jsonl'))).toBe(false);
      expect(stableClaims.map((claim) => claim.check_id)).toEqual([
        'contracts',
      ]);
      expect(JSON.stringify(audit)).not.toMatch(
        /"(?:cache_hit|claim_reuse|skipped|verdict|release_verdict|automated_release_verdict)"\s*:/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes pure check shadow claims when verify run has passed producer evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-pure-shadow-claim-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const aliases: string[] = [];
    try {
      const exitCode = runVerificationCli([
        '--goal=debug',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        runNpmScript: (script, context) => {
          aliases.push(script);
          if (script === 'verify:quick') {
            const identity = findCurrentPureCheckIdentityById('contracts');
            expect(identity).toBeDefined();
            if (identity) {
              const evidenceDir = join(context.reportRoot, 'pure-check-producer', 'contracts');
              const generatedAt = new Date().toISOString();
              mkdirSync(evidenceDir, { recursive: true });
              writeJson(join(evidenceDir, PURE_CHECK_PRODUCER_RESULT_FILE_NAME), {
                schema: PURE_CHECK_PRODUCER_EVIDENCE_SCHEMA,
                check_id: identity.check_id,
                owning_job_id: identity.owning_job_id,
                gate_id: identity.owning_gate_id,
                command: identity.command,
                npm_script: identity.npm_script ?? null,
                report_root: context.reportRoot,
                evidence_dir: evidenceDir,
                result_status: 'passed',
                failure_class: 'none',
                exit_code: 0,
                started_at: generatedAt,
                finished_at: generatedAt,
                duration_ms: 0,
                stdout_summary_digest: { digest: null, summary_length: 0, redacted: false },
                stderr_summary_digest: { digest: null, summary_length: 0, redacted: false },
                required_artifacts: [{
                  id: PURE_CHECK_PRODUCER_RESULT_ARTIFACT_ID,
                  scope: 'evidence_dir',
                  path: PURE_CHECK_PRODUCER_RESULT_FILE_NAME,
                  kind: 'file',
                  digest: null,
                  size_bytes: null,
                }],
                generated_at: generatedAt,
              });
            }
          }
          return { status: 0 };
        },
        pureCheckShadowRepoRoot: root,
        pureCheckShadowGitSha: 'current-git-sha',
        pureCheckShadowToolchainIdentity: {
          node: 'node-v24.14.1',
          npm: 'npm-v11.11.0',
          'package-lock': 'lockfile-version-3',
          'next-typegen': 'next-typegen-v1',
        },
      });

      expect(exitCode).toBe(0);
      expect(aliases).toEqual(['verify:quick', 'verify:default', 'verify:visual']);
      expect(stderr.join('')).toBe('');

      const audit = JSON.parse(readFileSync(join(root, PURE_CHECK_SHADOW_AUDIT_FILE_NAME), 'utf8')) as {
        claim_store_write: boolean;
        checks: Array<{
          check_id: string;
          decision: string;
          reason_codes: string[];
          claim_store_write: boolean;
          audit_digests?: {
            input?: string;
            artifact?: string;
            result?: string;
            claim?: string;
          };
        }>;
      };
      const contracts = audit.checks.find((check) => check.check_id === 'contracts');
      const digestPattern = /^sha256:[0-9a-f]{64}$/;

      expect(audit.claim_store_write).toBe(true);
      expect(audit.checks.map((check) => check.check_id)).not.toContain('unit');
      expect(contracts).toMatchObject({
        decision: 'shadow_only',
        claim_store_write: true,
        reason_codes: expect.arrayContaining([
          'producer_evidence_valid',
          'runtime_shadow_claim_written',
        ]),
      });
      expect(contracts?.audit_digests?.input).toMatch(digestPattern);
      expect(contracts?.audit_digests?.artifact).toMatch(digestPattern);
      expect(contracts?.audit_digests?.result).toMatch(digestPattern);
      expect(contracts?.audit_digests?.claim).toMatch(digestPattern);
      expect(existsSync(join(root, 'evidence-claims.jsonl'))).toBe(true);
      expect(existsSync(join(root, STABLE_PURE_CHECK_CLAIMS_JSONL_PATH))).toBe(true);
      expect(JSON.stringify(audit)).not.toMatch(
        /"(?:cache_hit|claim_reuse|skipped|verdict|release_verdict|automated_release_verdict)"\s*:/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes failed executed verify aliases in pure check audit without writing reusable passed claims', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-pure-shadow-failed-alias-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const aliases: string[] = [];
    try {
      const exitCode = runVerificationCli([
        '--goal=debug',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        runNpmScript: (script) => {
          aliases.push(script);
          return { status: 7 };
        },
        pureCheckShadowRepoRoot: root,
        pureCheckShadowGitSha: 'current-git-sha',
        pureCheckShadowToolchainIdentity: {
          node: 'node-v24.14.1',
          npm: 'npm-v11.11.0',
          'package-lock': 'lockfile-version-3',
          'next-typegen': 'next-typegen-v1',
        },
      });

      expect(exitCode).toBe(7);
      expect(aliases).toEqual(['verify:quick']);
      expect(stderr.join('')).toContain('Blocker: verify_alias_failed');
      expect(stderr.join('')).toContain('Stage: verify');
      expect(stderr.join('')).toContain('Why: internal fast verification check step for npm run verify -- --goal=pr --run failed with exit 7.');
      expect(stderr.join('')).toContain('Rerun: npm run verify -- --goal=pr --run');
      expect(stderr.join('')).toContain(`Evidence: ${root}`);
      expect(stderr.join('')).toContain('[verify] failed internal check step: fast verification check step (exit 7)');
      expect(stderr.join('')).toContain(`[verify] report root: ${root}`);
      expectCleanVerifyHumanOutput(stderr.join(''));
      expect(stdout.join('')).toContain(`Pure check shadow audit: ${join(root, PURE_CHECK_SHADOW_AUDIT_FILE_NAME)}`);

      const audit = JSON.parse(readFileSync(join(root, PURE_CHECK_SHADOW_AUDIT_FILE_NAME), 'utf8')) as {
        claim_store_write: boolean;
        checks: Array<{
          check_id: string;
          decision: string;
          reason_codes: string[];
          result_status?: string;
          failure_class?: string;
          script_results?: Array<{
            script: string;
            result_status: string;
            failure_class: string;
          }>;
          claim_store_write: boolean;
          audit_digests?: {
            input?: string;
            artifact?: string;
            result?: string;
            claim?: string;
          };
        }>;
      };

      expect(audit.claim_store_write).toBe(false);
      expect(audit.checks.map((check) => check.check_id)).toEqual([
        'contracts',
        'openapi-contract',
        'openapi-generated',
        'lint',
        'typecheck',
      ]);
      expect(audit.checks.every((check) => check.result_status === 'failed')).toBe(true);
      expect(audit.checks.every((check) => check.failure_class && check.failure_class !== 'none')).toBe(true);
      expect(audit.checks.every((check) => check.script_results?.some((script) => (
        script.script === 'verify:quick'
        && script.result_status === 'failed'
        && script.failure_class !== 'none'
      )))).toBe(true);
      expect(audit.checks.every((check) => check.decision === 'rerun_required')).toBe(true);
      expect(audit.checks.every((check) => check.claim_store_write === false)).toBe(true);
      expect(audit.checks.every((check) => check.reason_codes.includes('producer_execution_failed'))).toBe(true);
      expect(audit.checks.every((check) => check.reason_codes.includes('runtime_shadow_claim_not_written'))).toBe(true);
      expect(audit.checks.every((check) => check.audit_digests?.claim === undefined)).toBe(true);
      expect(existsSync(join(root, 'evidence-claims.jsonl'))).toBe(false);
      expect(existsSync(join(root, STABLE_PURE_CHECK_CLAIMS_JSONL_PATH))).toBe(false);
      expect(JSON.stringify(audit)).not.toMatch(
        /"(?:cache_hit|claim_reuse|skipped|verdict|release_verdict|automated_release_verdict)"\s*:/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops explicit real run before npm aliases when sentinel fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-real-sentinel-fail-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const sentinelProfiles: string[] = [];
    const aliases: string[] = [];
    try {
      const exitCode = runVerificationCli([
        '--goal=real',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'e2e/stories/backend-real/notebook-first-success.story.md',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return failingSentinelResult();
        },
        ownerPreflight: passingOwnerPreflight,
        runNpmScript: (script) => {
          aliases.push(script);
          return { status: 0 };
        },
      });

      expect(exitCode).toBe(1);
      expect(sentinelProfiles).toEqual(['verify-real']);
      expect(aliases).toEqual([]);
      expect(stdout.join('')).toContain('"probe.secret_profile_present": false');
      expect(stdout.join('')).not.toContain('release_verdict');
      expect(stdout.join('')).not.toContain('release_ready');
      expect(stderr.join('')).toContain('[verify] sentinel preflight failed for verify-real.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('executes verify:real only for explicit real run goal after writing reports', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-real-allowed-'));
    const logPath = join(root, 'npm.log');
    try {
      writeReportAwareFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=real',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'e2e/stories/backend-real/notebook-first-success.story.md',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...SENTINEL_PASS_ENV,
          [CLAIM_STORE_ROOT_ENV]: root,
          [CLAIM_STORE_GIT_SHA_ENV]: 'current-git-sha',
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(true);
      expect(readFileSync(logPath, 'utf8').trim().split('\n')).toEqual([
        'run verify:quick',
        'run verify:default',
        'run verify:visual',
        'run verify:real',
      ]);

      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        final_verdict: string;
        recommended_commands: string[];
        release_verdict: boolean;
      };
      expect(report.final_verdict).toBe('delegated_to_executed_verification_commands');
      expect(report.recommended_commands).toEqual([
        'npm run verify -- --goal=pr --run',
        'npm run verify -- --goal=visual --run',
        'npm run verify -- --goal=real --run',
      ]);
      expect(report.release_verdict).toBe(false);
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs explicit release-real aliases only after release-real sentinel passes', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-release-real-sentinel-pass-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const sentinelProfiles: string[] = [];
    const aliases: string[] = [];
    try {
      const exitCode = runVerificationCli([
        '--goal=release-real',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'e2e/stories/backend-real/release-user-story-end-to-end.story.md',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return passingSentinelResult();
        },
        runNpmScript: (script) => {
          aliases.push(script);
          return { status: 0 };
        },
      });

      expect(exitCode).toBe(0);
      expect(sentinelProfiles).toEqual(['verify-release-real']);
      expect(aliases).toEqual(['verify:release-real']);
      expect(stderr.join('')).toBe('');
      expect(stdout.join('')).not.toContain('Automated release verdict');
      expect(stdout.join('')).not.toContain('release_ready');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps release-real run as an owner diagnostic without producing a release verdict', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-release-real-allowed-'));
    const logPath = join(root, 'npm.log');
    try {
      writeReportAwareFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=release-real',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'e2e/stories/backend-real/release-user-story-end-to-end.story.md',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...SENTINEL_PASS_ENV,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(readFileSync(logPath, 'utf8').trim()).toBe('run verify:release-real');

      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        final_verdict: string;
        recommended_commands: string[];
        release_verdict: boolean;
        not_release_readiness: boolean;
      };
      expect(report.final_verdict).toBe('delegated_to_executed_verification_commands');
      expect(report.recommended_commands).toEqual(['npm run product:ready']);
      expect(report.release_verdict).toBe(false);
      expect(report.not_release_readiness).toBe(true);
      expectCleanVerifyReportSurface(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('executes only the lightweight unified deploy diagnostic for unified deploy V4 impact', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-release-run-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeReportAwareFakeNpm(root, logPath);

      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--goal=pr',
        '--run',
        '--report-root',
        root,
        '--changed-file',
        'scripts/unified-deploy/release-local-kind.sh',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Required levels: V4');
      expect(recommendedPlanBlock(result.stdout)).toContain('1. npm run test:unified-deploy:unit');
      expect(recommendedPlanBlock(result.stdout)).not.toContain('npm run release:ready');
      expect(result.stdout).toContain('Final verdict: delegated to the executed verification commands');
      expect(result.stdout).toContain('npm run product:ready');
      expect(result.stdout).not.toContain('npm run release:ready');
      expect(result.stdout).not.toContain('npm run verify:release-real');
      expect(readFileSync(logPath, 'utf8').trim()).toBe('run test:unified-deploy:unit');
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        schema: string;
        final_verdict: string;
        recommended_commands: string[];
        release_verdict: boolean;
        not_release_readiness: boolean;
        story_cards: Array<ReportStoryCard & { risk_level: string }>;
      };
      expect(report.final_verdict).toBe('delegated_to_executed_verification_commands');
      expect(report.recommended_commands).toEqual(['npm run test:unified-deploy:unit']);
      expect(report.story_cards[0]).toMatchObject({
        risk_level: 'R0',
        manual_review_required: true,
      });
      expect(report.story_cards[0]?.manual_review_reasons).toContain('release/deploy operator review');
      expect(report.story_cards[0]?.evidence_cards.find((card) => card.level === 'V4')).toMatchObject({
        state: 'not_inspected_by_verify_report',
        status: 'manual_review_needed',
        owner: 'npm run product:ready',
        artifact_path: null,
        artifact_path_template: 'artifacts/release-runs/<campaign-run-id>/gate-release-full/result.json',
        artifact_path_template_reason: null,
      });
      expect(report.story_cards[0]?.evidence_cards.find((card) => card.level === 'V4')?.additional_artifact_path_templates)
        .toContain('artifacts/release-runs/<campaign-run-id>');
      expect(report.schema).toBe('agentsmith_story_acceptance_report/v1');
      expect(report.release_verdict).toBe(false);
      expect(report.not_release_readiness).toBe(true);
      expect(reportStatusValues(report.story_cards)).not.toContain('passed');
      expect(reportStatusValues(report.story_cards)).not.toContain('stale');

      const markdown = readFileSync(join(root, 'story-acceptance-report.md'), 'utf8');
      expect(markdown).toContain(
        '- V4: owner=npm run product:ready; status=manual_review_needed; path_template=artifacts/release-runs/<campaign-run-id>/gate-release-full/result.json; additional_path_templates=artifacts/release-runs/<campaign-run-id>',
      );
      expect(markdown).toContain('This report is not AgentSmith product readiness / handoff input completeness and not a product readiness conclusion.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
