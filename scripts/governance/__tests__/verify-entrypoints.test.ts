import { chmodSync, existsSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildVerificationPlan,
  renderVerificationPlan,
} from '../run-verify';
import { findCurrentGateDefinitionById } from '../current-gate-manifest';

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
}

type FakeGitOptions = {
  refs?: Record<string, string>;
  mergeBases?: Record<string, string>;
  emptyMergeBases?: readonly string[];
  baseDiffs?: Record<string, readonly string[]>;
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
        'npm run verify:real',
      ]);
      expect(output).toContain('AgentSmith Verification');
      expect(output).toContain('Mode: dry-run');
      expect(output).toContain('Final verdict: not evaluated');
      expect(existsSync(join(root, 'artifacts', 'gate-results'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
      expect(result.stdout).toContain('npm run verify:visual');
      expect(result.stdout).toContain('this is not release readiness');
      expect(result.stdout).toContain(`Verification catalog: ${join(root, 'verification-catalog.json')}`);
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(true);
      const markdown = readFileSync(join(root, 'story-acceptance-report.md'), 'utf8');
      expect(markdown).toContain('| Story | Risk | Status | Required levels | Manual review | Next action |');
      expect(markdown).toContain(`- Verification catalog: ${join(root, 'verification-catalog.json')}`);
      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        generated_at: string;
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
      expect(result.stdout).toContain('npm run verify:visual');
      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as VerifyReport;
      expect(report.changed_files).toEqual(['src/components/chat/ChatMainPane.tsx']);
      expect(report.recommended_commands).toContain('npm run verify:visual');

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
      expect(report.recommended_commands).toContain('npm run verify:visual');

      const log = readFileSync(gitLog, 'utf8');
      expect(log).toContain('rev-parse --verify upstream/main');
      expect(log).toContain('merge-base HEAD upstream/main');
      expect(log).not.toContain('origin/main');
      expect(log).not.toContain('fetch');
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
      expect(report.recommended_commands).toContain('npm run verify:visual');

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
      expect(report.required_levels).toEqual(['V0', 'V1', 'V3']);
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
      expect(report.required_levels).toEqual(['V0', 'V1', 'V3']);
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
      expect(report.recommended_commands).toContain('npm run verify:visual');
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
      expect(report.recommended_commands).toContain('npm run verify:visual');
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
      expect(result.stdout).toContain('npm run verify:release-real');
      expect(result.stdout).not.toContain('npm run verify:visual');
      expect(result.stdout).not.toContain('npm run verify:real');
      expect(result.stdout).toContain('this is not release readiness and not a release verdict');

      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        release_verdict: boolean;
        not_release_readiness: boolean;
        required_levels: string[];
        recommended_commands: string[];
        story_cards: ReportStoryCard[];
      };
      const v3Evidence = report.story_cards[0]?.evidence_cards.find((card) => card.level === 'V3');

      expect(releaseRealUxTraceTemplate).toBeTruthy();
      expect(report.required_levels).toEqual(['V3']);
      expect(report.required_levels).not.toContain('V4');
      expect(report.recommended_commands).toEqual(['npm run verify:release-real']);
      expect(report.recommended_commands).not.toContain('npm run verify:visual');
      expect(report.recommended_commands).not.toContain('npm run verify:real');
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
        owner: 'npm run verify:release-real',
        artifact_path: null,
        artifact_path_template: releaseRealUxTraceTemplate,
        artifact_path_template_reason: null,
      });
      expect(v3Evidence?.additional_artifact_path_templates).toEqual([]);
      expect(report.release_verdict).toBe(false);
      expect(report.not_release_readiness).toBe(true);
      expect(reportStatusValues(report.story_cards)).not.toContain('passed');
      expect(reportStatusValues(report.story_cards)).not.toContain('stale');
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
      expect(result.stdout).toContain('npm run verify:quick');
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      expect(existsSync(join(root, 'verification-catalog.json'))).toBe(true);
      expect(existsSync(logPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes the report before executing recommended aliases when --run is explicit', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-run-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeReportAwareFakeNpm(root, logPath);

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

  it('does not execute verify aliases for release/deploy V4 impact even when --run is explicit', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-verify-release-run-fake-npm-'));
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
        'scripts/demo-deploy/deploy.sh',
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
      expect(result.stdout).toContain('No verify alias is safe to run for this V4 plan; use the next action.');
      expect(result.stdout).toContain('Final verdict: not evaluated (next action required; no verify aliases executed)');
      expect(result.stdout).toContain('npm run release:ready');
      expect(result.stdout).not.toContain('npm run verify:release-real');
      expect(existsSync(join(root, 'story-acceptance-report.json'))).toBe(true);
      const report = JSON.parse(readFileSync(join(root, 'story-acceptance-report.json'), 'utf8')) as {
        schema: string;
        final_verdict: string;
        recommended_commands: string[];
        release_verdict: boolean;
        not_release_readiness: boolean;
        story_cards: Array<ReportStoryCard & { risk_level: string }>;
      };
      expect(report.final_verdict).toBe('not_evaluated_next_action_required');
      expect(report.recommended_commands).toEqual([]);
      expect(report.story_cards[0]).toMatchObject({
        risk_level: 'R0',
        manual_review_required: true,
      });
      expect(report.story_cards[0]?.manual_review_reasons).toContain('release/deploy/rehearsal operator review');
      expect(report.story_cards[0]?.evidence_cards.find((card) => card.level === 'V4')).toMatchObject({
        state: 'not_inspected_by_verify_report',
        status: 'manual_review_needed',
        owner: 'npm run release:ready',
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
        '- V4: owner=npm run release:ready; status=manual_review_needed; path_template=artifacts/release-runs/<campaign-run-id>/gate-release-full/result.json; additional_path_templates=artifacts/release-runs/<campaign-run-id>',
      );
      expect(markdown).toContain('This report is not release readiness and not a release verdict.');
      expect(existsSync(logPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
