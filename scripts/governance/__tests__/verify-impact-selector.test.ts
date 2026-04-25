import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildVerificationPlan,
} from '../run-verify';

function withTempDir<T>(prefix: string, run: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function occurrenceCount(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}

describe('verify impact selector', () => {
  it('selects visual stories from visual catalog code refs and recommends V0/V1/V2', () => {
    const plan = buildVerificationPlan({
      goal: 'pr',
      run: false,
      changedFiles: ['src/components/chat/ChatMainPane.tsx'],
    });

    expect(plan.mode).toBe('dry-run');
    expect(plan.affectedStories).toContain('mock-lane-chat-operate-and-recover');
    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2']);
    expect(plan.recommendedCommands).toEqual([
      'npm run verify:quick',
      'npm run verify:default',
      'npm run verify:visual',
    ]);
    expect(plan.affectedSurfaces.some((surface) => surface.startsWith('visual:'))).toBe(true);
    expect(plan.storyCards.find((card) => card.storyId === 'mock-lane-chat-operate-and-recover')).toMatchObject({
      lane: 'mock-lane',
      risk: 'required',
      evidenceStatus: 'not_evaluated',
    });
  });

  it('does not emit duplicated reasons or next-action text for a single mapped visual file', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['src/components/chat/ChatMainPane.tsx'],
    });
    const storyCard = plan.storyCards.find((card) => card.storyId === 'mock-lane-chat-operate-and-recover');

    expect(new Set(plan.riskSummary.reasons).size).toBe(plan.riskSummary.reasons.length);
    expect(occurrenceCount(plan.nextAction, 'Run npm run verify:visual')).toBe(1);
    expect(storyCard).toBeDefined();
    expect(occurrenceCount(storyCard?.nextAction ?? '', 'Run npm run verify:visual')).toBe(1);
  });

  it('keeps release-real goal as V3 backend-real owner diagnostic instead of V4 release closure', () => {
    const plan = buildVerificationPlan({
      goal: 'release-real',
      goalExplicit: true,
    });

    expect(plan.requiredLevels).toEqual(['V3']);
    expect(plan.recommendedCommands).toEqual(['npm run verify:release-real']);
    expect(plan.requiredEvidence).toEqual(['backend-real ux_trace_bundle evidence']);
    expect(plan.nextAction).toContain('npm run verify:release-real');
    expect(plan.nextAction).toContain('not release readiness');
    expect(plan.releaseVerdict).toBe(false);
  });

  it('maps canonical story markdown changes to the exact story and requires manual review', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['e2e/stories/backend-real/notebook-first-success.story.md'],
    });

    expect(plan.affectedStories).toEqual(['notebook-first-success']);
    expect(plan.storyCards).toHaveLength(1);
    expect(plan.storyCards[0]).toMatchObject({
      storyId: 'notebook-first-success',
      lane: 'backend-real',
      sourceFile: 'e2e/stories/backend-real/notebook-first-success.story.md',
      risk: 'required',
      evidenceStatus: 'not_evaluated',
    });
    expect(plan.storyCards[0].nextAction).toContain('Manual story review');
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
  });

  it('treats generated story specs as derived cache drift instead of canonical truth', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['e2e/generated/story-specs.generated.json'],
    });

    expect(plan.affectedStories.length).toBeGreaterThan(10);
    expect(plan.riskSummary.warnings.join('\n')).toContain('derived cache');
    expect(plan.affectedSurfaces).toContain('derived-cache:story-specs');
    expect(plan.storyCards.every((card) => card.sourceFile !== 'e2e/generated/story-specs.generated.json')).toBe(true);
    expect(plan.storyCards.some((card) => card.evidenceStatus === 'missing')).toBe(true);
  });

  it('fails closed to V3 real-backend verification for runner, Context Store, and credential paths', () => {
    const plan = buildVerificationPlan({
      changedFiles: [
        'scripts/run-external-runner-dev.sh',
        'src/lib/api/endpoints/context.ts',
        'src/lib/api/endpoints/credentials.ts',
      ],
    });

    expect(plan.requiredLevels).toContain('V3');
    expect(plan.recommendedCommands).toContain('npm run verify:real');
    expect(plan.affectedSurfaces).toContain('runner/context-store/credentials');
    expect(plan.finalVerdict).toContain('not_evaluated');
    expect(plan.nextAction).toContain('npm run verify:real');
  });

  it('recommends V4 release-ready next action for release and rehearsal paths without making a release verdict', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['scripts/demo-deploy/deploy.sh'],
    });

    expect(plan.requiredLevels).toContain('V4');
    expect(plan.affectedSurfaces).toContain('release/deploy/rehearsal');
    expect(plan.nextAction).toContain('npm run release:ready');
    expect(plan.recommendedCommands).not.toContain('npm run verify:release-real');
    expect(plan.recommendedCommands).not.toContain('npm run release:ready');
    expect(plan.finalVerdict).toBe('not_evaluated_fail_closed');
    expect(plan.releaseVerdict).toBe(false);
  });

  it('fails closed with broad impact and a clear next action for unmapped source files', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['src/lib/new-unmapped-source.ts'],
    });

    expect(plan.affectedStories.length).toBeGreaterThan(10);
    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V3']);
    expect(plan.affectedSurfaces).toContain('unmapped-source');
    expect(plan.riskSummary.broadImpact).toBe(true);
    expect(plan.nextAction).toContain('Manual impact owner triage');
  });

  it('writes the story acceptance report JSON and markdown under the requested report root', () => {
    withTempDir('agentsmith-story-acceptance-report-', (reportRoot) => {
      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--report-root',
        reportRoot,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Story acceptance report');

      const jsonPath = join(reportRoot, 'story-acceptance-report.json');
      const markdownPath = join(reportRoot, 'story-acceptance-report.md');
      expect(existsSync(jsonPath)).toBe(true);
      expect(existsSync(markdownPath)).toBe(true);

      const report = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
        schema: string;
        changed_files: string[];
        story_cards: Array<{ story_id: string; evidence_status: string }>;
        final_verdict: string;
        release_verdict: boolean;
      };
      expect(report.schema).toBe('agentsmith_story_acceptance_report/v1');
      expect(report.changed_files).toEqual(['src/components/chat/ChatMainPane.tsx']);
      expect(report.story_cards.some((card) => card.story_id === 'mock-lane-chat-operate-and-recover')).toBe(true);
      expect(report.story_cards.every((card) => ['not_evaluated', 'missing'].includes(card.evidence_status))).toBe(true);
      expect(report.final_verdict).toBe('not_evaluated_fail_closed');
      expect(report.release_verdict).toBe(false);

      const markdown = readFileSync(markdownPath, 'utf8');
      expect(markdown).toContain('Story Acceptance Report');
      expect(markdown).toContain('not release readiness');
      expect(markdown).toContain('not a release verdict');
      expect(markdown).toContain('mock-lane-chat-operate-and-recover');
    });
  });
});
