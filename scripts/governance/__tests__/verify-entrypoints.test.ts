import { chmodSync, existsSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
      expect(result.stdout).toContain('Required levels: V0, V1, V3');
      expect(result.stdout).toContain('npm run verify:release-real');
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
      expect(report.required_levels).toEqual(['V0', 'V1', 'V3']);
      expect(report.recommended_commands).toContain('npm run verify:release-real');
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
