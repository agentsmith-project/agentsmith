import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildVerificationPlan,
} from '../run-verify';
import { buildVerificationCatalog } from '../verification-catalog';

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

type ReportChangedFileImpact = {
  changed_file: string;
  matched_rules: string[];
  affected_surfaces: string[];
  story_ids: string[];
  action: string;
  manual_review_required: boolean;
  broad_impact: boolean;
};

type ReportStoryImpactSource = {
  changed_file: string;
  rule: string;
  surface: string;
  action: string;
  manual_review_required: boolean;
  broad_impact: boolean;
};

type ReportStoryCard = {
  story_id: string;
  status: string;
  evidence_status: string;
  impact_sources: ReportStoryImpactSource[];
  level_statuses: Array<{ level: string; status: string; reason: string }>;
  latest_evidence: { state: string; owner: string; artifact_path: string | null };
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

describe('verify impact selector', () => {
  it('uses the verification catalog for visual and backend-real impact lookup', () => {
    const catalog = buildVerificationCatalog();
    const visualPlan = buildVerificationPlan({
      catalog,
      changedFiles: ['src/components/chat/ChatMainPane.tsx'],
    });
    const backendRealPlan = buildVerificationPlan({
      catalog,
      changedFiles: [
        'scripts/run-external-runner-dev.sh',
        'src/lib/api/endpoints/context.ts',
      ],
    });

    expect(visualPlan.requiredLevels).toEqual(['V0', 'V1', 'V2']);
    expect(visualPlan.affectedStories).toContain('mock-lane-chat-operate-and-recover');
    expect(visualPlan.affectedSurfaces.some((surface) => surface.startsWith('visual:'))).toBe(true);
    expect(backendRealPlan.requiredLevels).toContain('V3');
    expect(backendRealPlan.recommendedCommands).toContain('npm run verify:real');
    expect(backendRealPlan.affectedSurfaces).toContain('runner/context-store/credentials');
  });

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
      riskLevel: 'R2',
      status: 'manual_review_needed',
      evidenceStatus: 'not_evaluated',
      manualReviewRequired: true,
    });
    const visualCard = plan.storyCards.find((card) => card.storyId === 'mock-lane-chat-operate-and-recover');
    expect(visualCard?.manualReviewReasons).toContain('visual V2 needs review');
    expect(visualCard?.levelStatuses).toContainEqual({
      level: 'V2',
      status: 'manual_review_needed',
      reason: 'Visual V2 needs review; verify report did not inspect visual evidence.',
    });
    expect(plan.nextActions).toEqual([
      'Run npm run verify:visual and review affected visual story cards before accepting the UI impact.',
    ]);
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

  it('prioritizes broad manual triage over visual-only action for mixed visual and unmapped impact', () => {
    const plan = buildVerificationPlan({
      changedFiles: [
        'src/components/chat/ChatMainPane.tsx',
        'src/lib/new-unmapped-source.ts',
      ],
    });
    const chatImpact = plan.changedFileImpacts.find(
      (impact) => impact.changedFile === 'src/components/chat/ChatMainPane.tsx',
    );
    const unmappedImpact = plan.changedFileImpacts.find(
      (impact) => impact.changedFile === 'src/lib/new-unmapped-source.ts',
    );
    const chatStory = plan.storyCards.find(
      (card) => card.storyId === 'mock-lane-chat-operate-and-recover',
    );

    expect(plan.riskSummary.broadImpact).toBe(true);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
    expect(plan.nextAction).toContain('Manual impact owner triage');
    expect(plan.nextActions.some((action) => action.includes('Manual impact owner triage'))).toBe(true);
    expect(plan.nextActions.some((action) => action.includes('npm run verify:visual'))).toBe(true);
    expect(chatImpact).toMatchObject({
      changedFile: 'src/components/chat/ChatMainPane.tsx',
      matchedRules: ['visual_code_ref'],
      manualReviewRequired: true,
      broadImpact: false,
    });
    expect(chatImpact?.affectedSurfaces.some((surface) => surface.startsWith('visual:'))).toBe(true);
    expect(chatImpact?.storyIds).toContain('mock-lane-chat-operate-and-recover');
    expect(unmappedImpact).toMatchObject({
      changedFile: 'src/lib/new-unmapped-source.ts',
      matchedRules: ['unmapped_source'],
      affectedSurfaces: ['unmapped-source'],
      manualReviewRequired: true,
      broadImpact: true,
    });
    expect(unmappedImpact?.storyIds.length).toBeGreaterThan(10);
    expect(chatStory?.nextAction.startsWith('Manual impact owner triage')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(chatStory, 'nextActions')).toBe(false);
    expect(chatStory?.impactSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        changedFile: 'src/components/chat/ChatMainPane.tsx',
        rule: 'visual_code_ref',
        broadImpact: false,
      }),
      expect.objectContaining({
        changedFile: 'src/lib/new-unmapped-source.ts',
        rule: 'unmapped_source',
        broadImpact: true,
      }),
    ]));
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

  it('requires visual and backend-real evidence for backend-real stories with visual review evidence', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['e2e/stories/backend-real/real-backend-visual-review.story.md'],
    });
    const storyCard = plan.storyCards.find((card) => card.storyId === 'real-backend-visual-review');

    expect(plan.affectedStories).toEqual(['real-backend-visual-review']);
    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(plan.recommendedCommands).toEqual([
      'npm run verify:quick',
      'npm run verify:default',
      'npm run verify:visual',
      'npm run verify:real',
    ]);
    expect(storyCard?.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(storyCard?.lane).toBe('backend-real');
    expect(storyCard?.riskLevel).toBe('R1');
    expect(storyCard?.riskReason).toContain('backend-real');
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

  it('writes backend-real V3 evidence card templates without inspecting artifacts', () => {
    withTempDir('agentsmith-story-acceptance-backend-real-', (reportRoot) => {
      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--report-root',
        reportRoot,
        '--changed-file',
        'e2e/stories/backend-real/notebook-first-success.story.md',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      const report = JSON.parse(readFileSync(join(reportRoot, 'story-acceptance-report.json'), 'utf8')) as {
        schema: string;
        story_cards: ReportStoryCard[];
        release_verdict: boolean;
      };
      const reportCard = report.story_cards.find((card) => card.story_id === 'notebook-first-success');
      const v3Evidence = reportCard?.evidence_cards.find((card) => card.level === 'V3');

      expect(report.schema).toBe('agentsmith_story_acceptance_report/v1');
      expect(v3Evidence).toMatchObject({
        state: 'not_inspected_by_verify_report',
        status: 'manual_review_needed',
        owner: 'npm run verify:real',
        artifact_path: null,
        artifact_path_template: 'artifacts/backend-real/runs/<run-id>/ux-traces',
        artifact_path_template_reason: null,
      });
      expect(report.release_verdict).toBe(false);
      expect(reportStatusValues(report.story_cards)).not.toContain('passed');
      expect(reportStatusValues(report.story_cards)).not.toContain('stale');

      const markdown = readFileSync(join(reportRoot, 'story-acceptance-report.md'), 'utf8');
      expect(markdown).toContain(
        '- V3: owner=npm run verify:real; status=manual_review_needed; path_template=artifacts/backend-real/runs/<run-id>/ux-traces',
      );
    });
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
    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
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
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
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
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
  });

  it.each([
    'scripts/release-full-campaign.sh',
    'scripts/release-full-aggregate-gate.sh',
    'scripts/cluster-rehearsal-verify.sh',
  ])('maps root release and rehearsal script %s to V4 operator review only', (changedFile) => {
    const plan = buildVerificationPlan({
      changedFiles: [changedFile],
    });

    expect(plan.requiredLevels).toEqual(['V4']);
    expect(plan.recommendedCommands).toEqual([]);
    expect(plan.affectedSurfaces).toEqual(['release/deploy/rehearsal']);
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.nextAction).toContain('npm run release:ready');
    expect(plan.releaseVerdict).toBe(false);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
    expect(plan.storyCards[0]).toMatchObject({
      riskLevel: 'R0',
      status: 'manual_review_needed',
      manualReviewRequired: true,
    });
    expect(plan.storyCards[0]?.manualReviewReasons).toContain('release/deploy/rehearsal operator review');
  });

  it('maps backend-real full gate to the release-real owner diagnostic instead of V4 release closure', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['scripts/backend-real-full-gate.sh'],
    });

    expect(plan.requiredLevels).toEqual(['V3']);
    expect(plan.recommendedCommands).toEqual(['npm run verify:release-real']);
    expect(plan.affectedSurfaces).toEqual(['release-real-owner']);
    expect(plan.affectedStories.join('\n')).toContain('mapped operational impact: release-real-owner');
    expect(plan.affectedStories.join('\n')).not.toContain('No changed files provided or detected');
    expect(plan.nextAction).toContain('npm run verify:release-real');
    expect(plan.nextAction).toContain('not release readiness');
    expect(plan.releaseVerdict).toBe(false);
  });

  it('fails closed with broad impact and a clear next action for unmapped source files', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['src/lib/new-unmapped-source.ts'],
    });

    expect(plan.affectedStories.length).toBeGreaterThan(10);
    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(plan.affectedSurfaces).toContain('unmapped-source');
    expect(plan.riskSummary.broadImpact).toBe(true);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
    expect(plan.nextAction).toContain('Manual impact owner triage');
    expect(plan.storyCards[0]?.riskReason).toContain('inferred fail-closed');
    expect(plan.storyCards[0]?.manualReviewReasons).toContain('unmapped source');
    expect(plan.storyCards[0]?.levelStatuses.length).toBe(plan.storyCards[0]?.requiredLevels.length);
  });

  it('keeps broad-impact story cards on their own story-level evidence lanes', () => {
    const plan = buildVerificationPlan({
      changedFiles: [
        'e2e/generated/story-specs.generated.json',
        'src/lib/new-unmapped-source.ts',
      ],
    });
    const mockLaneCard = plan.storyCards.find((card) => card.storyId === 'mock-lane-chat-operate-and-recover');
    const backendRealCard = plan.storyCards.find((card) => card.storyId === 'notebook-first-success');
    const backendRealVisualCard = plan.storyCards.find((card) => card.storyId === 'real-backend-visual-review');

    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(mockLaneCard?.requiredLevels).toEqual(['V0', 'V1', 'V2']);
    expect(backendRealCard?.requiredLevels).toEqual(['V0', 'V1', 'V3']);
    expect(backendRealVisualCard?.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
  });

  it('marks change detection failure as broad manual review with per-story levels', () => {
    const plan = buildVerificationPlan({
      changeDetectionFailure: 'git unavailable',
    });
    const mockLaneCard = plan.storyCards.find((card) => card.storyId === 'mock-lane-chat-operate-and-recover');
    const backendRealCard = plan.storyCards.find((card) => card.storyId === 'notebook-first-success');

    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(plan.affectedSurfaces).toContain('change-detection-failed');
    expect(mockLaneCard?.requiredLevels).toEqual(['V0', 'V1', 'V2']);
    expect(backendRealCard?.requiredLevels).toEqual(['V0', 'V1', 'V3']);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
  });

  it('suppresses release-real owner diagnostics when explicit release-real goal has V4 release impact', () => {
    const plan = buildVerificationPlan({
      goal: 'release-real',
      goalExplicit: true,
      changedFiles: ['scripts/demo-deploy/deploy.sh'],
    });

    expect(plan.requiredLevels).toEqual(['V4']);
    expect(plan.recommendedCommands).not.toContain('npm run verify:release-real');
    expect(plan.recommendedCommands).toEqual([]);
    expect(plan.nextAction).toContain('npm run release:ready');
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
        story_cards: ReportStoryCard[];
        final_verdict: string;
        release_verdict: boolean;
      };
      expect(report.schema).toBe('agentsmith_story_acceptance_report/v1');
      expect(report.changed_files).toEqual(['src/components/chat/ChatMainPane.tsx']);
      expect(report.story_cards.some((card) => card.story_id === 'mock-lane-chat-operate-and-recover')).toBe(true);
      expect(report.story_cards.every((card) => ['not_evaluated', 'missing'].includes(card.evidence_status))).toBe(true);
      const reportCard = report.story_cards.find((card) => card.story_id === 'mock-lane-chat-operate-and-recover');
      expect(reportCard?.level_statuses).toContainEqual({
        level: 'V2',
        status: 'manual_review_needed',
        reason: 'Visual V2 needs review; verify report did not inspect visual evidence.',
      });
      expect(reportCard?.latest_evidence).toEqual({
        state: 'not_inspected_by_verify_report',
        owner: 'visual review owner',
        artifact_path: null,
      });
      expect(reportCard?.evidence_cards.find((card) => card.level === 'V2')).toMatchObject({
        state: 'not_inspected_by_verify_report',
        status: 'manual_review_needed',
        owner: 'npm run verify:visual',
        artifact_path: null,
        artifact_path_template: 'artifacts/visual-baseline-reviews/<run-id>/run-manifest.json',
        artifact_path_template_reason: null,
      });
      expect(reportCard?.evidence_cards.find((card) => card.level === 'V0')).toMatchObject({
        owner: 'npm run verify:quick',
        artifact_path_template: null,
      });
      expect(reportCard?.evidence_cards.find((card) => card.level === 'V0')?.artifact_path_template_reason)
        .toContain('No registered current gate result writer');
      expect(reportStatusValues(report.story_cards)).not.toContain('passed');
      expect(reportStatusValues(report.story_cards)).not.toContain('stale');
      expect(report.final_verdict).toBe('not_evaluated_fail_closed');
      expect(report.release_verdict).toBe(false);

      const markdown = readFileSync(markdownPath, 'utf8');
      expect(markdown).toContain('Story Acceptance Report');
      expect(markdown).toContain('| Story | Risk | Status | Required levels | Manual review | Next action |');
      expect(markdown).toContain('not release readiness');
      expect(markdown).toContain('not a release verdict');
      expect(markdown).toContain('mock-lane-chat-operate-and-recover');
      expect(markdown).toContain('- Evidence cards:');
      expect(markdown).toContain(
        '- V2: owner=npm run verify:visual; status=manual_review_needed; path_template=artifacts/visual-baseline-reviews/<run-id>/run-manifest.json',
      );
    });
  });

  it('writes changed-file impact explanations and story impact sources to report JSON and markdown', () => {
    withTempDir('agentsmith-story-acceptance-impact-sources-', (reportRoot) => {
      const result = spawnSync('npx', [
        'tsx',
        'scripts/governance/run-verify.ts',
        '--report-root',
        reportRoot,
        '--changed-file',
        'src/components/chat/ChatMainPane.tsx',
        '--changed-file',
        'src/lib/new-unmapped-source.ts',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);

      const report = JSON.parse(readFileSync(join(reportRoot, 'story-acceptance-report.json'), 'utf8')) as {
        changed_file_impacts: ReportChangedFileImpact[];
        next_action: string;
        next_actions: string[];
        release_verdict: boolean;
        story_cards: ReportStoryCard[];
      };
      const chatImpact = report.changed_file_impacts.find(
        (impact) => impact.changed_file === 'src/components/chat/ChatMainPane.tsx',
      );
      const unmappedImpact = report.changed_file_impacts.find(
        (impact) => impact.changed_file === 'src/lib/new-unmapped-source.ts',
      );
      const chatCard = report.story_cards.find(
        (card) => card.story_id === 'mock-lane-chat-operate-and-recover',
      );

      expect(report.next_action).toContain('Manual impact owner triage');
      expect(report.next_actions.some((action) => action.includes('Manual impact owner triage'))).toBe(true);
      expect(report.next_actions.some((action) => action.includes('npm run verify:visual'))).toBe(true);
      expect(chatImpact).toMatchObject({
        matched_rules: ['visual_code_ref'],
        manual_review_required: true,
        broad_impact: false,
      });
      expect(chatImpact?.story_ids).toContain('mock-lane-chat-operate-and-recover');
      expect(unmappedImpact).toMatchObject({
        matched_rules: ['unmapped_source'],
        affected_surfaces: ['unmapped-source'],
        manual_review_required: true,
        broad_impact: true,
      });
      expect(chatCard?.impact_sources).toEqual(expect.arrayContaining([
        expect.objectContaining({
          changed_file: 'src/components/chat/ChatMainPane.tsx',
          rule: 'visual_code_ref',
          broad_impact: false,
        }),
        expect.objectContaining({
          changed_file: 'src/lib/new-unmapped-source.ts',
          rule: 'unmapped_source',
          broad_impact: true,
        }),
      ]));
      expect(reportStatusValues(report.story_cards).every((status) => (
        status === 'not_evaluated'
        || status === 'missing'
        || status === 'manual_review_needed'
      ))).toBe(true);
      expect(reportStatusValues(report.story_cards)).not.toContain('passed');
      expect(reportStatusValues(report.story_cards)).not.toContain('failed');
      expect(reportStatusValues(report.story_cards)).not.toContain('stale');
      expect(report.release_verdict).toBe(false);

      const markdown = readFileSync(join(reportRoot, 'story-acceptance-report.md'), 'utf8');
      expect(markdown).toContain('## Changed File Impacts');
      expect(markdown).toContain('src/lib/new-unmapped-source.ts');
      expect(markdown).toContain('unmapped_source');
      expect(markdown).toContain('src/components/chat/ChatMainPane.tsx');
      expect(markdown).toContain('visual_code_ref');
      expect(markdown).toContain('- Impact sources:');
    });
  });
});
