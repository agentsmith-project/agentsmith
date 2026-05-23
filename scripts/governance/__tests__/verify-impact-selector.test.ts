import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildVerificationPlan,
} from '../run-verify';
import {
  defaultGateProfileForVerificationPlan,
  verificationRunContractFailure,
} from '../verify-impact-selector';
import {
  CURRENT_STORY_RISK_POLICY_SCHEMA,
  CURRENT_STORY_RISK_POLICY_SOURCE,
} from '../current-story-risk-policy';
import { buildVerificationCatalog } from '../verification-catalog';
import { buildStoryAcceptanceReport } from '../story-acceptance-report';
import { loadCommittedStoryDefinitionsSync } from '../../story-catalog-support';

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

function runGitInFixture(root: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
}

function withPackageJsonGitFixture<T>(
  basePackageJson: unknown,
  currentPackageJson: unknown,
  run: (args: { root: string; catalog: ReturnType<typeof buildVerificationCatalog> }) => T,
): T {
  const catalog = buildVerificationCatalog();
  return withTempDir('agentsmith-package-impact-', (root) => {
    writeFileSync(join(root, 'package.json'), `${JSON.stringify(basePackageJson, null, 2)}\n`);
    runGitInFixture(root, ['init']);
    runGitInFixture(root, ['add', 'package.json']);
    runGitInFixture(root, [
      '-c',
      'user.email=agentsmith@example.test',
      '-c',
      'user.name=AgentSmith Test',
      'commit',
      '-m',
      'base package',
    ]);
    writeFileSync(join(root, 'package.json'), `${JSON.stringify(currentPackageJson, null, 2)}\n`);

    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      return run({ root, catalog });
    } finally {
      process.chdir(originalCwd);
    }
  });
}

function withCleanBranchPackageJsonGitFixture<T>(
  basePackageJson: unknown,
  currentPackageJson: unknown,
  run: (args: { root: string; catalog: ReturnType<typeof buildVerificationCatalog> }) => T,
  baseRef = 'refs/remotes/origin/main',
): T {
  const catalog = buildVerificationCatalog();
  return withTempDir('agentsmith-package-impact-clean-branch-', (root) => {
    writeFileSync(join(root, 'package.json'), `${JSON.stringify(basePackageJson, null, 2)}\n`);
    runGitInFixture(root, ['init']);
    runGitInFixture(root, ['add', 'package.json']);
    runGitInFixture(root, [
      '-c',
      'user.email=agentsmith@example.test',
      '-c',
      'user.name=AgentSmith Test',
      'commit',
      '-m',
      'base package',
    ]);
    runGitInFixture(root, ['update-ref', baseRef, 'HEAD']);

    writeFileSync(join(root, 'package.json'), `${JSON.stringify(currentPackageJson, null, 2)}\n`);
    runGitInFixture(root, ['add', 'package.json']);
    runGitInFixture(root, [
      '-c',
      'user.email=agentsmith@example.test',
      '-c',
      'user.name=AgentSmith Test',
      'commit',
      '-m',
      'current package',
    ]);

    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      return run({ root, catalog });
    } finally {
      process.chdir(originalCwd);
    }
  });
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
  risk_level: string;
  risk_reason: string;
  risk_policy_refs: string[];
  risk_policy_source: string;
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
        'scripts/skills-runtime-backend-real-gate.sh',
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
    expect(visualCard?.riskPolicyRefs).toContain('visual_product_experience');
    expect(visualCard?.riskPolicySource).toBe(CURRENT_STORY_RISK_POLICY_SOURCE);
    expect(visualCard?.riskReason).toContain('risk policy sidecar');
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
    expect(plan.nextAction).toContain('npm run release:ready');
    expect(plan.nextAction).not.toContain('npm run verify -- --goal=release-real --run');
    expect(plan.nextAction).not.toContain('npm run verify:release-real');
    expect(plan.nextAction).toContain('not a release verdict until npm run release:ready runs');
    expect(plan.releaseVerdict).toBe(false);
  });

  it('does not downgrade mock-lane visual story policy floors for explicit release-real goal', () => {
    const plan = buildVerificationPlan({
      goal: 'release-real',
      goalExplicit: true,
      changedFiles: ['e2e/stories/mock-lane/mock-lane-chat-operate-and-recover.story.md'],
    });
    const storyCard = plan.storyCards.find((card) => card.storyId === 'mock-lane-chat-operate-and-recover');

    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(plan.recommendedCommands).not.toEqual(['npm run verify:release-real']);
    expect(plan.recommendedCommands).toEqual([
      'npm run verify:quick',
      'npm run verify:default',
      'npm run verify:visual',
      'npm run verify:release-real',
    ]);
    expect(storyCard).toMatchObject({
      lane: 'mock-lane',
      riskLevel: 'R2',
      requiredLevels: ['V0', 'V1', 'V2'],
    });
    expect(storyCard?.riskReason).not.toContain('release-real owner diagnostic stays V3-only');
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

  it('raises R0 policy stories to the policy risk and level floors', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['e2e/stories/backend-real/unicode-filename-round-trip.story.md'],
    });
    const storyCard = plan.storyCards.find((card) => card.storyId === 'unicode-filename-round-trip');

    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(storyCard).toMatchObject({
      riskLevel: 'R0',
      riskPolicyRefs: ['file_continuity_integrity'],
      riskPolicySource: CURRENT_STORY_RISK_POLICY_SOURCE,
      requiredLevels: ['V0', 'V1', 'V2', 'V3'],
    });
    expect(storyCard?.riskReason).toContain('file_continuity_integrity');
  });

  it('does not let R3 policy refs lower backend-real baseline risk or levels', () => {
    const story = loadCommittedStoryDefinitionsSync()
      .find((candidate) => candidate.storyId === 'agent-task-first-success');
    if (!story) {
      throw new Error('agent-task-first-success story fixture is required');
    }
    const catalog = buildVerificationCatalog({
      stories: [story],
      visualCatalogEntries: [],
      storyRiskPolicy: {
        schema: CURRENT_STORY_RISK_POLICY_SCHEMA,
        stories: {
          'agent-task-first-success': {
            policy_refs: ['low_risk_reference'],
          },
        },
      },
    });
    const plan = buildVerificationPlan({
      catalog,
      changedFiles: [story.sourceFile ?? story.filePath],
    });

    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V3']);
    expect(plan.storyCards[0]).toMatchObject({
      riskLevel: 'R1',
      riskPolicyRefs: ['low_risk_reference'],
      riskPolicySource: 'input_override_non_authoritative',
      requiredLevels: ['V0', 'V1', 'V3'],
    });
    expect(buildStoryAcceptanceReport(plan, '/tmp/report-root').story_cards[0]).toMatchObject({
      risk_policy_refs: ['low_risk_reference'],
      risk_policy_source: 'input_override_non_authoritative',
    });
    expect(plan.storyCards[0]?.riskReason).toContain('backend-real');
  });

  it('maps canonical story markdown changes to the exact story and requires manual review', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['e2e/stories/backend-real/agent-task-first-success.story.md'],
    });

    expect(plan.affectedStories).toEqual(['agent-task-first-success']);
    expect(plan.storyCards).toHaveLength(1);
    expect(plan.storyCards[0]).toMatchObject({
      storyId: 'agent-task-first-success',
      lane: 'backend-real',
      sourceFile: 'e2e/stories/backend-real/agent-task-first-success.story.md',
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
        'e2e/stories/backend-real/agent-task-first-success.story.md',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      const report = JSON.parse(readFileSync(join(reportRoot, 'story-acceptance-report.json'), 'utf8')) as {
        schema: string;
        traceability_gaps: ReportTraceabilityGap[];
        story_cards: ReportStoryCard[];
        release_verdict: boolean;
      };
      const reportCard = report.story_cards.find((card) => card.story_id === 'agent-task-first-success');
      const v3Evidence = reportCard?.evidence_cards.find((card) => card.level === 'V3');

      expect(report.schema).toBe('agentsmith_story_acceptance_report/v1');
      expect(v3Evidence).toMatchObject({
        state: 'not_inspected_by_verify_report',
        status: 'manual_review_needed',
        owner: 'npm run verify -- --goal=real --run',
        artifact_path: null,
        artifact_path_template: 'artifacts/backend-real/runs/<run-id>/ux-traces',
        artifact_path_template_reason: null,
      });
      expect(report.traceability_gaps.some((gap) => (
        gap.story_id === 'agent-task-first-success' && gap.level === 'V3'
      ))).toBe(false);
      expect(report.release_verdict).toBe(false);
      expect(reportStatusValues(report.story_cards)).not.toContain('passed');
      expect(reportStatusValues(report.story_cards)).not.toContain('stale');

      const markdown = readFileSync(join(reportRoot, 'story-acceptance-report.md'), 'utf8');
      expect(markdown).toContain(
        '- V3: owner=npm run verify -- --goal=real --run; status=manual_review_needed; path_template=artifacts/backend-real/runs/<run-id>/ux-traces',
      );
      expect(readFileSync(join(reportRoot, 'story-acceptance-report.json'), 'utf8')).not.toContain('npm run verify:');
      expect(markdown).not.toContain('npm run verify:');
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

  it('maps trace-bound integration chat specs to exact story cards without broad impact', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['e2e/integration-chat.spec.ts'],
    });

    expect(plan.affectedStories).toEqual([
      'chat-day-two-thread-workflow',
      'chat-stop-terminate-idempotent-state-resync',
    ]);
    expect(plan.affectedSurfaces).toEqual([
      'trace-spec:e2e/integration-chat.spec.ts',
    ]);
    expect(plan.riskSummary.broadImpact).toBe(false);
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.changedFileImpacts).toEqual([
      expect.objectContaining({
        changedFile: 'e2e/integration-chat.spec.ts',
        matchedRules: ['trace_spec_story_binding'],
        storyIds: [
          'chat-day-two-thread-workflow',
          'chat-stop-terminate-idempotent-state-resync',
        ],
        broadImpact: false,
      }),
    ]);
    expect(plan.storyCards).toEqual(expect.arrayContaining([
      expect.objectContaining({
        storyId: 'chat-stop-terminate-idempotent-state-resync',
        requiredLevels: ['V0', 'V1', 'V2', 'V3'],
      }),
      expect.objectContaining({
        storyId: 'chat-day-two-thread-workflow',
        requiredLevels: ['V0', 'V1', 'V3'],
      }),
    ]));
    expect(plan.storyCards.flatMap((card) => card.impactSources)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        changedFile: 'e2e/integration-chat.spec.ts',
        rule: 'trace_spec_story_binding',
        broadImpact: false,
      }),
    ]));
  });

  it('keeps trace story cards and runner/context broad review for agent-task terminal specs', () => {
    const plan = buildVerificationPlan({
      changedFiles: [
        'e2e/integration-agent-task-terminal-ux.spec.ts',
      ],
    });
    const terminalImpact = plan.changedFileImpacts.find(
      (candidate) => candidate.changedFile === 'e2e/integration-agent-task-terminal-ux.spec.ts',
    );
    const storyCard = plan.storyCards.find(
      (card) => card.storyId === 'agent-task-terminal-workspace-multi-session',
    );

    expect(plan.affectedStories).toContain('agent-task-terminal-workspace-multi-session');
    expect(plan.affectedStories).toContain('agent-task-terminal-truth-unavailable-retry');
    expect(plan.affectedStories).toContain('agent-task-terminal-reentry-recovery');
    expect(terminalImpact).toMatchObject({
      broadImpact: true,
      manualReviewRequired: true,
    });
    expect(terminalImpact?.matchedRules).toEqual(expect.arrayContaining([
      'trace_spec_story_binding',
      'runner_context_credential',
    ]));
    expect(terminalImpact?.storyIds).toEqual(expect.arrayContaining([
      'agent-task-terminal-workspace-multi-session',
      'agent-task-terminal-truth-unavailable-retry',
      'agent-task-terminal-reentry-recovery',
    ]));
    expect(plan.riskSummary.broadImpact).toBe(true);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.affectedSurfaces).toContain('trace-spec:e2e/integration-agent-task-terminal-ux.spec.ts');
    expect(plan.affectedSurfaces).toContain('runner/context-store/credentials');
    expect(storyCard?.impactSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: 'trace_spec_story_binding',
        broadImpact: false,
      }),
    ]));
  });

  it('keeps trace story cards and V4 release review for trace-bound release user story specs', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['e2e/integration-release-user-story.spec.ts'],
    });
    const impact = plan.changedFileImpacts.find(
      (candidate) => candidate.changedFile === 'e2e/integration-release-user-story.spec.ts',
    );
    const storyCard = plan.storyCards.find(
      (card) => card.storyId === 'release-user-story-end-to-end',
    );

    expect(plan.affectedStories).toContain('release-user-story-end-to-end');
    expect(impact).toMatchObject({
      matchedRules: ['trace_spec_story_binding', 'release_deploy_operations'],
      broadImpact: true,
      manualReviewRequired: true,
    });
    expect(impact?.storyIds).toContain('release-user-story-end-to-end');
    expect(plan.requiredLevels).toContain('V4');
    expect(plan.riskSummary.broadImpact).toBe(true);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
    expect(plan.affectedSurfaces).toContain('trace-spec:e2e/integration-release-user-story.spec.ts');
    expect(plan.affectedSurfaces).toContain('release/deploy');
    expect(storyCard?.impactSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: 'trace_spec_story_binding',
        broadImpact: false,
      }),
      expect.objectContaining({
        rule: 'release_deploy_operations',
        broadImpact: true,
        manualReviewRequired: true,
      }),
    ]));
    expect(storyCard?.manualReviewReasons).toContain('release/deploy operator review');
  });

  it('fails closed to V3 real-backend verification for runner, Context Store, and credential paths', () => {
    const plan = buildVerificationPlan({
      changedFiles: [
        'scripts/skills-runtime-backend-real-gate.sh',
        'src/lib/api/endpoints/context.ts',
        'src/lib/api/endpoints/credentials.ts',
      ],
    });

    expect(plan.requiredLevels).toContain('V3');
    expect(plan.recommendedCommands).toEqual([
      'npm run verify:quick',
      'npm run verify:default',
      'npm run verify:visual',
      'npm run test:agent-task:runner:fast',
      'npm run test:agent-task:runner:backend-real',
      'npm run verify:real',
    ]);
    expect(plan.recommendedCommands).not.toContain('npm run test:e2e:integration:agent-task');
    expect(plan.affectedSurfaces).toContain('runner/context-store/credentials');
    expect(plan.finalVerdict).toContain('not_evaluated');
    expect(plan.nextAction).toContain('npm run verify -- --goal=real --run');
    expect(plan.nextAction).not.toMatch(/npm run test:e2e:integration:agent-task(?:[\s,]|$)/);
    expect(plan.nextAction).not.toContain('npm run verify:real');
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
    expect(plan.riskSummary.broadImpact).toBe(true);
    expect(plan.changedFileImpacts.find((impact) => impact.changedFile === 'src/lib/api/endpoints/context.ts')).toMatchObject({
      matchedRules: ['runner_context_credential'],
      broadImpact: true,
    });
  });

  it('maps runner and notebook execution package sources to runner owner review instead of unmapped triage', () => {
    const changedFiles = [
      'packages/agent-runner/src/index.ts',
      'packages/agent-task-runner/src/runner.ts',
      'packages/api-entry-node/src/notebook-execution-orchestrator.ts',
    ];
    const plan = buildVerificationPlan({ changedFiles });

    expect(plan.requiredLevels).toContain('V3');
    expect(plan.recommendedCommands).toContain('npm run verify:real');
    expect(plan.recommendedCommands).not.toContain('npm run test:e2e:integration:agent-task');
    expect(plan.affectedSurfaces).toContain('runner/context-store/credentials');
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.nextAction).toContain('npm run verify -- --goal=real --run');
    expect(plan.riskSummary.warnings.join('\n')).not.toContain('did not match canonical story markdown');
    expect(plan.changedFileImpacts).toEqual(expect.arrayContaining(
      changedFiles.map((changedFile) => expect.objectContaining({
        changedFile,
        matchedRules: ['runner_context_credential'],
        affectedSurfaces: ['runner/context-store/credentials'],
        broadImpact: true,
        manualReviewRequired: true,
      })),
    ));
    expect(plan.storyCards[0]?.manualReviewReasons).toContain('runner/context/credential owner review');
  });

  it('maps api-entry runner context credential backend sources to runner owner review', () => {
    const changedFiles = [
      'packages/api-entry-node/src/notebook-execution-orchestrator.ts',
      'packages/api-entry-node/src/context-store.ts',
      'packages/api-entry-node/src/context-route-handler.ts',
      'packages/api-entry-node/src/managed-credential-resolver.ts',
      'packages/api-entry-node/src/agent-execution-service.ts',
      'packages/api-entry-node/src/agent-runner-profile.ts',
    ];
    const plan = buildVerificationPlan({ changedFiles });

    expect(plan.requiredLevels).toContain('V3');
    expect(plan.recommendedCommands).toContain('npm run verify:real');
    expect(plan.recommendedCommands).not.toContain('npm run test:e2e:integration:agent-task');
    expect(plan.affectedSurfaces).toContain('runner/context-store/credentials');
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
    expect(plan.riskSummary.broadImpact).toBe(true);
    expect(plan.riskSummary.warnings.join('\n')).not.toContain('did not match canonical story markdown');
    expect(plan.changedFileImpacts).toHaveLength(changedFiles.length);
    for (const changedFile of changedFiles) {
      expect(plan.changedFileImpacts).toContainEqual(expect.objectContaining({
        changedFile,
        matchedRules: ['runner_context_credential'],
        affectedSurfaces: ['runner/context-store/credentials'],
        manualReviewRequired: true,
        broadImpact: true,
      }));
    }
    expect(plan.storyCards[0]?.manualReviewReasons).toContain('runner/context/credential owner review');
  });

  it('keeps pr --run package runner changes fail-closed on backend-real owner verification, not unmapped triage', () => {
    const plan = buildVerificationPlan({
      goal: 'pr',
      goalExplicit: true,
      run: true,
      changedFiles: ['packages/api-entry-node/src/context-store.ts'],
    });

    expect(plan.finalVerdict).toBe('not_evaluated_fail_closed');
    expect(plan.requiredLevels).toContain('V3');
    expect(plan.recommendedCommands).toContain('npm run verify:real');
    expect(plan.affectedSurfaces).toContain('runner/context-store/credentials');
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.riskSummary.warnings.join('\n')).toContain(
      '--goal=pr --run cannot execute npm run verify -- --goal=real --run',
    );
    expect(plan.riskSummary.warnings.join('\n')).not.toContain('did not match canonical story markdown');
    expect(plan.changedFileImpacts).toEqual([
      expect.objectContaining({
        changedFile: 'packages/api-entry-node/src/context-store.ts',
        matchedRules: ['runner_context_credential'],
        affectedSurfaces: ['runner/context-store/credentials'],
        broadImpact: true,
        manualReviewRequired: true,
      }),
    ]);
    expect(plan.storyCards[0]?.manualReviewReasons).toContain('runner/context/credential owner review');
  });

  it('keeps unrelated api-entry-node route sources as unmapped instead of sprawling runner review', () => {
    const changedFile = 'packages/api-entry-node/src/project-route-handler.ts';
    const plan = buildVerificationPlan({ changedFiles: [changedFile] });

    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(plan.affectedSurfaces).toEqual(['unmapped-source']);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
    expect(plan.riskSummary.broadImpact).toBe(true);
    expect(plan.changedFileImpacts).toEqual([
      expect.objectContaining({
        changedFile,
        matchedRules: ['unmapped_source'],
        affectedSurfaces: ['unmapped-source'],
        manualReviewRequired: true,
        broadImpact: true,
      }),
    ]);
  });

  it('marks --run without explicit goal as fail-closed and keeps the report non-release', () => {
    const plan = buildVerificationPlan({
      run: true,
      changedFiles: ['src/components/chat/ChatMainPane.tsx'],
    });

    expect(plan.mode).toBe('run');
    expect(plan.finalVerdict).toBe('not_evaluated_fail_closed');
    expect(plan.riskSummary.warnings.join('\n')).toContain('--run requires an explicit public --goal=<pr|visual|real>');
    expect(plan.riskSummary.warnings.join('\n')).not.toContain('--goal=debug');
    expect(plan.riskSummary.warnings.join('\n')).not.toContain('--goal=release-real');
    expect(plan.releaseVerdict).toBe(false);
  });

  it('blocks bare agent-task Playwright integration aliases from governed run contracts', () => {
    const failure = verificationRunContractFailure({
      goal: 'real',
      goalExplicit: true,
      run: true,
      recommendedCommands: ['npm run test:e2e:integration:agent-task'],
    });

    expect(failure).toContain('cannot execute npm run test:e2e:integration:agent-task');
    expect(failure).toContain('governed verify uses npm run test:agent-task:runner:backend-real');
    expect(failure).toContain('AGENTSMITH_ENABLE_TEST_ROUTES');
    expect(failure).toContain('npm run test:e2e:integration:agent-task:with-api');
    expect(failure).toContain('only after preparing Web/test routes');
  });

  it.each(['debug', 'pr', 'visual'] as const)(
    'blocks implicit verify:real execution for %s run goal while preserving required evidence',
    (goal) => {
      const plan = buildVerificationPlan({
        goal,
        goalExplicit: true,
        run: true,
        changedFiles: ['src/lib/api/endpoints/context.ts'],
      });

      expect(plan.recommendedCommands).toContain('npm run verify:real');
      expect(plan.finalVerdict).toBe('not_evaluated_fail_closed');
      expect(plan.riskSummary.warnings.join('\n')).toContain(`--goal=${goal === 'debug' ? 'pr' : goal} --run cannot execute npm run verify -- --goal=real --run`);
      expect(plan.riskSummary.warnings.join('\n')).not.toContain('npm run verify:real');
      expect(plan.riskSummary.warnings.join('\n')).not.toContain('npm run verify:release-real');
      expect(plan.riskSummary.warnings.join('\n')).not.toContain('--goal=debug');
      expect(plan.releaseVerdict).toBe(false);
    },
  );

  it('allows verify:real execution only for explicit real run goal', () => {
    const plan = buildVerificationPlan({
      goal: 'real',
      goalExplicit: true,
      run: true,
      changedFiles: ['src/lib/api/endpoints/context.ts'],
    });

    expect(plan.recommendedCommands).toContain('npm run verify:real');
    expect(plan.recommendedCommands).not.toContain('npm run test:e2e:integration:agent-task');
    expect(plan.finalVerdict).toBe('delegated_to_executed_verification_commands');
    expect(plan.riskSummary.warnings.join('\n')).not.toContain('cannot execute npm run verify:real');
    expect(plan.releaseVerdict).toBe(false);
  });

  it.each(['debug', 'pr', 'visual'] as const)(
    'blocks implicit release-real owner execution for %s run goal with release-ready guidance',
    (goal) => {
      const plan = buildVerificationPlan({
        goal,
        goalExplicit: true,
        run: true,
        changedFiles: ['scripts/backend-real-full-gate.sh'],
      });

      expect(plan.recommendedCommands).toContain('npm run verify:release-real');
      expect(plan.recommendedCommands).not.toContain('npm run verify:real');
      expect(plan.finalVerdict).toBe('not_evaluated_fail_closed');
      expect(plan.riskSummary.warnings.join('\n')).toContain('cannot cover release-owned backend-real changes');
      expect(plan.riskSummary.warnings.join('\n')).toContain('npm run release:ready');
      expect(plan.riskSummary.warnings.join('\n')).not.toContain('npm run verify -- --goal=release-real --run');
      expect(plan.riskSummary.warnings.join('\n')).not.toContain('npm run verify:release-real');
      expect(plan.releaseVerdict).toBe(false);
    },
  );

  it('keeps release-real run as a diagnostic plan without creating a release verdict', () => {
    const plan = buildVerificationPlan({
      goal: 'release-real',
      goalExplicit: true,
      run: true,
      changedFiles: ['e2e/stories/backend-real/release-user-story-end-to-end.story.md'],
    });

    expect(plan.recommendedCommands).toEqual(['npm run verify:release-real']);
    expect(plan.requiredLevels).toEqual(['V3']);
    expect(plan.finalVerdict).toBe('delegated_to_executed_verification_commands');
    expect(plan.releaseVerdict).toBe(false);
    expect(plan.nextAction).toContain('npm run release:ready');
    expect(plan.nextAction).not.toContain('npm run verify -- --goal=release-real --run');
    expect(plan.nextAction).not.toContain('npm run verify:release-real');
    expect(plan.nextAction).toContain('not a release verdict until npm run release:ready runs');
  });

  it('carries trace spec story binding sources into the acceptance report projection', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['e2e/integration-chat.spec.ts'],
    });
    const report = buildStoryAcceptanceReport(plan, '/tmp/report-root');
    const chatImpact = report.changed_file_impacts.find(
      (impact) => impact.changed_file === 'e2e/integration-chat.spec.ts',
    );
    const chatCard = report.story_cards.find(
      (card) => card.story_id === 'chat-stop-terminate-idempotent-state-resync',
    );

    expect(chatImpact?.matched_rules).toContain('trace_spec_story_binding');
    expect(chatCard?.impact_sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: 'trace_spec_story_binding',
        changed_file: 'e2e/integration-chat.spec.ts',
        broad_impact: false,
      }),
    ]));
  });

  it('recommends V4 release-ready next action for release and deploy paths without making a release verdict', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['scripts/unified-deploy/release-local-kind.sh'],
    });

    expect(plan.requiredLevels).toContain('V4');
    expect(plan.affectedSurfaces).toContain('release/deploy');
    expect(plan.nextAction).toContain('npm run release:ready');
    expect(plan.recommendedCommands).toContain('npm run test:unified-deploy:unit');
    expect(plan.recommendedCommands).not.toContain('npm run verify:release-real');
    expect(plan.recommendedCommands).not.toContain('npm run release:ready');
    expect(plan.recommendedCommands).not.toContain('npm run verify:visual');
    expect(plan.finalVerdict).toBe('not_evaluated_fail_closed');
    expect(plan.releaseVerdict).toBe(false);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
  });

  it('recommends only the lightweight unified deploy unit suite for unified deploy implementation changes', () => {
    const plan = buildVerificationPlan({
      changedFiles: [
        'scripts/unified-deploy/check-local-kind-rollout.ts',
        'infra/deploy/unified/templates/app/api-deployment.yaml.tpl',
      ],
    });

    expect(plan.requiredLevels).toEqual(['V4']);
    expect(plan.recommendedCommands).toEqual(['npm run test:unified-deploy:unit']);
    expect(plan.recommendedCommands).not.toContain('npm run release:ready');
    expect(plan.recommendedCommands).not.toContain('npm run verify:visual');
    expect(plan.affectedSurfaces).toEqual(['release/deploy']);
    expect(plan.releaseVerdict).toBe(false);
  });

  it('maps pure governance tooling sources to targeted V0/V1 without broad, manual, story, or unmapped impact', () => {
    const changedFiles = [
      'scripts/governance/verify-impact-selector.ts',
      'scripts/governance/__tests__/verify-impact-selector.test.ts',
    ];
    const plan = buildVerificationPlan({ changedFiles });

    expect(plan.requiredLevels).toEqual(['V0', 'V1']);
    expect(plan.recommendedCommands).toEqual([
      'npm run verify:quick',
      'npm run verify:default',
    ]);
    expect(plan.affectedSurfaces).toEqual(['engineering-governance-tooling']);
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.storyCards).toEqual([]);
    expect(plan.affectedStories.join('\n')).toContain('mapped operational impact: engineering-governance-tooling');
    expect(plan.riskSummary.manualReviewRequired).toBe(false);
    expect(plan.riskSummary.broadImpact).toBe(false);
    expect(plan.riskSummary.warnings.join('\n')).not.toContain('did not match canonical story markdown');
    expect(plan.changedFileImpacts).toHaveLength(changedFiles.length);
    expect(plan.changedFileImpacts).toEqual(expect.arrayContaining(
      changedFiles.map((changedFile) => expect.objectContaining({
        changedFile,
        matchedRules: ['governance_tooling'],
        affectedSurfaces: ['engineering-governance-tooling'],
        storyIds: [],
        manualReviewRequired: false,
        broadImpact: false,
      })),
    ));
    expect(defaultGateProfileForVerificationPlan(plan)).toBe('governance_tooling');
  });

  it('does not select the governance tooling default-gate profile for mixed mapped changes', () => {
    const plan = buildVerificationPlan({
      goal: 'pr',
      goalExplicit: true,
      run: true,
      changedFiles: [
        'scripts/governance/verify-impact-selector.ts',
        'README.md',
      ],
    });

    expect(plan.requiredLevels).toEqual(['V0', 'V1']);
    expect(plan.recommendedCommands).toEqual([
      'npm run verify:quick',
      'npm run verify:default',
    ]);
    expect(plan.affectedSurfaces).toEqual(['docs-only', 'engineering-governance-tooling']);
    expect(plan.riskSummary.broadImpact).toBe(false);
    expect(plan.storyCards).toEqual([]);
    expect(defaultGateProfileForVerificationPlan(plan)).toBeNull();
  });

  it('maps root governance gate and current contract checks without unmapped or visual impact', () => {
    const changedFiles = [
      'scripts/default-gate.sh',
      'scripts/default-gate.test.ts',
      'scripts/contracts/check-current-gates.ts',
      'scripts/contracts/check-current-gates.test.ts',
      'scripts/contracts/check-current-verification-campaigns.ts',
      'scripts/contracts/check-engineering-governance.ts',
      'scripts/governance-default-gate.sh',
      'scripts/governance-default-gate.test.ts',
      'scripts/run-mock-lane-playwright.test.ts',
    ];
    const plan = buildVerificationPlan({ changedFiles });

    expect(plan.requiredLevels).toEqual(['V0', 'V1']);
    expect(plan.recommendedCommands).toEqual([
      'npm run verify:quick',
      'npm run verify:default',
    ]);
    expect(plan.recommendedCommands).not.toContain('npm run verify:visual');
    expect(plan.affectedSurfaces).toEqual(['engineering-governance-tooling']);
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.storyCards).toEqual([]);
    expect(plan.riskSummary.broadImpact).toBe(false);
    expect(plan.changedFileImpacts).toEqual(expect.arrayContaining(
      changedFiles.map((changedFile) => expect.objectContaining({
        changedFile,
        matchedRules: ['governance_tooling'],
        affectedSurfaces: ['engineering-governance-tooling'],
        storyIds: [],
        broadImpact: false,
      })),
    ));
  });

  it('maps package.json to governance tooling only when git diff is limited to safe governance and mock-lane npm scripts', () => {
    const basePackageJson = {
      scripts: {
        'test:e2e:lane:mock:chromium': 'bash scripts/run-mock-lane-playwright.sh --project=chromium --workers=4 && bash scripts/run-mock-lane-playwright.sh --project=chromium-serial --workers=1',
        'test:governance': 'bash scripts/governance-default-gate.sh',
      },
      dependencies: {
        next: '15.0.0',
      },
    };
    const currentPackageJson = {
      scripts: {
        'test:e2e:lane:mock:chromium': 'bash scripts/run-mock-lane-session.sh --shards=chromium,chromium-serial',
        'test:governance': 'bash scripts/governance-default-gate.sh',
        'test:governance-tooling': 'npm run test:run -- scripts/default-gate.test.ts scripts/contracts/check-current-gates.test.ts scripts/contracts/check-current-gate-results.test.ts scripts/contracts/check-current-governance-observability.test.ts scripts/governance/__tests__/current-gate-governance.test.ts scripts/governance/__tests__/current-gate-result-schema.test.ts scripts/governance/__tests__/current-workflow-governance.test.ts scripts/governance/__tests__/current-verification-campaign-manifest.test.ts scripts/governance/__tests__/verify-entrypoints.test.ts scripts/governance/__tests__/verify-impact-selector.test.ts',
      },
      dependencies: {
        next: '15.0.0',
      },
    };

    withPackageJsonGitFixture(basePackageJson, currentPackageJson, ({ catalog }) => {
      const plan = buildVerificationPlan({
        changedFiles: ['package.json'],
        catalog,
      });

      expect(plan.requiredLevels).toEqual(['V0', 'V1']);
      expect(plan.recommendedCommands).toEqual([
        'npm run verify:quick',
        'npm run verify:default',
      ]);
      expect(plan.recommendedCommands).not.toContain('npm run verify:visual');
      expect(plan.affectedSurfaces).toEqual(['engineering-governance-tooling']);
      expect(plan.affectedSurfaces).not.toContain('unmapped-source');
      expect(plan.storyCards).toEqual([]);
      expect(plan.riskSummary.broadImpact).toBe(false);
      expect(plan.riskSummary.manualReviewRequired).toBe(false);
      expect(plan.changedFileImpacts).toEqual([
        expect.objectContaining({
          changedFile: 'package.json',
          matchedRules: ['governance_tooling'],
          affectedSurfaces: ['engineering-governance-tooling'],
          storyIds: [],
          broadImpact: false,
        }),
      ]);
    });
  });

  it('maps clean branch package.json safe scripts by comparing merge-base to HEAD instead of dirty worktree state', () => {
    const basePackageJson = {
      scripts: {
        'test:e2e:lane:mock:chromium': 'bash scripts/run-mock-lane-playwright.sh --project=chromium --workers=4 && bash scripts/run-mock-lane-playwright.sh --project=chromium-serial --workers=1',
        'test:governance': 'bash scripts/governance-default-gate.sh',
      },
      dependencies: {
        next: '15.0.0',
      },
    };
    const currentPackageJson = {
      scripts: {
        'test:e2e:lane:mock:chromium': 'bash scripts/run-mock-lane-session.sh --shards=chromium,chromium-serial',
        'test:governance': 'bash scripts/governance-default-gate.sh',
      },
      dependencies: {
        next: '15.0.0',
      },
    };

    withCleanBranchPackageJsonGitFixture(basePackageJson, currentPackageJson, ({ catalog }) => {
      const plan = buildVerificationPlan({
        changedFiles: ['package.json'],
        catalog,
      });

      expect(plan.requiredLevels).toEqual(['V0', 'V1']);
      expect(plan.recommendedCommands).toEqual([
        'npm run verify:quick',
        'npm run verify:default',
      ]);
      expect(plan.affectedSurfaces).toEqual(['engineering-governance-tooling']);
      expect(plan.affectedSurfaces).not.toContain('unmapped-source');
      expect(plan.riskSummary.broadImpact).toBe(false);
      expect(plan.riskSummary.manualReviewRequired).toBe(false);
      expect(plan.changedFileImpacts).toEqual([
        expect.objectContaining({
          changedFile: 'package.json',
          matchedRules: ['governance_tooling'],
          affectedSurfaces: ['engineering-governance-tooling'],
          storyIds: [],
          broadImpact: false,
        }),
      ]);
    });
  });

  it('uses the caller-provided package.json base ref instead of assuming origin/main', () => {
    const basePackageJson = {
      scripts: {
        'test:governance': 'bash scripts/governance-default-gate.sh',
      },
      dependencies: {
        next: '15.0.0',
      },
    };
    const currentPackageJson = {
      scripts: {
        'test:governance': 'bash scripts/governance-default-gate.sh',
        'test:governance-tooling': 'npm run test:run -- scripts/default-gate.test.ts scripts/governance/__tests__/verify-impact-selector.test.ts',
      },
      dependencies: {
        next: '15.0.0',
      },
    };

    withCleanBranchPackageJsonGitFixture(
      basePackageJson,
      currentPackageJson,
      ({ catalog }) => {
        const plan = buildVerificationPlan({
          changedFiles: ['package.json'],
          catalog,
          packageJsonBaseRefs: ['upstream/main'],
        });

        expect(plan.requiredLevels).toEqual(['V0', 'V1']);
        expect(plan.affectedSurfaces).toEqual(['engineering-governance-tooling']);
        expect(plan.riskSummary.broadImpact).toBe(false);
        expect(plan.changedFileImpacts).toEqual([
          expect.objectContaining({
            changedFile: 'package.json',
            matchedRules: ['governance_tooling'],
            affectedSurfaces: ['engineering-governance-tooling'],
          }),
        ]);
      },
      'refs/remotes/upstream/main',
    );
  });

  it('does not ignore unsafe dirty package.json state when a clean branch base diff is otherwise safe', () => {
    const basePackageJson = {
      scripts: {
        'test:governance': 'bash scripts/governance-default-gate.sh',
      },
      dependencies: {
        next: '15.0.0',
      },
    };
    const currentPackageJson = {
      scripts: {
        'test:governance': 'bash scripts/governance-default-gate.sh',
        'test:governance-tooling': 'npm run test:run -- scripts/default-gate.test.ts scripts/governance/__tests__/verify-impact-selector.test.ts',
      },
      dependencies: {
        next: '15.0.0',
      },
    };

    withCleanBranchPackageJsonGitFixture(basePackageJson, currentPackageJson, ({ root, catalog }) => {
      writeFileSync(join(root, 'package.json'), `${JSON.stringify({
        ...currentPackageJson,
        dependencies: {
          next: '15.1.0',
        },
      }, null, 2)}\n`);
      runGitInFixture(root, ['add', 'package.json']);
      writeFileSync(join(root, 'package.json'), `${JSON.stringify({
        ...currentPackageJson,
        dependencies: {
          next: '15.2.0',
        },
      }, null, 2)}\n`);

      const plan = buildVerificationPlan({
        changedFiles: ['package.json'],
        catalog,
      });

      expect(plan.affectedSurfaces).toContain('unmapped-source');
      expect(plan.changedFileImpacts).toEqual([
        expect.objectContaining({
          changedFile: 'package.json',
          matchedRules: ['unmapped_source'],
          affectedSurfaces: ['unmapped-source'],
          broadImpact: true,
          manualReviewRequired: true,
        }),
      ]);
    });
  });

  it('keeps package.json fail-closed when git diff changes dependencies instead of only safe scripts', () => {
    const basePackageJson = {
      scripts: {
        'test:governance': 'bash scripts/governance-default-gate.sh',
      },
      dependencies: {
        next: '15.0.0',
      },
    };
    const currentPackageJson = {
      scripts: {
        'test:governance': 'bash scripts/governance-default-gate.sh',
      },
      dependencies: {
        next: '15.1.0',
      },
    };

    withPackageJsonGitFixture(basePackageJson, currentPackageJson, ({ catalog }) => {
      const plan = buildVerificationPlan({
        changedFiles: ['package.json'],
        catalog,
      });

      expect(plan.affectedSurfaces).toContain('unmapped-source');
      expect(plan.changedFileImpacts).toEqual([
        expect.objectContaining({
          changedFile: 'package.json',
          matchedRules: ['unmapped_source'],
          affectedSurfaces: ['unmapped-source'],
          broadImpact: true,
          manualReviewRequired: true,
        }),
      ]);
      expect(plan.recommendedCommands).toContain('npm run verify:visual');
    });
  });

  it.each([
    'scripts/governance/release-ready.ts',
    'scripts/governance/run-release-aggregate.ts',
    'scripts/governance/release-campaign-runner.ts',
    'scripts/governance/release-campaign-execution.ts',
    'scripts/governance/release-campaign-io.ts',
  ])('keeps governance release path %s on V4 release/deploy operator review', (changedFile) => {
    const plan = buildVerificationPlan({
      changedFiles: [changedFile],
    });

    expect(plan.requiredLevels).toEqual(['V4']);
    expect(plan.recommendedCommands).toEqual([]);
    expect(plan.affectedSurfaces).toEqual(['release/deploy']);
    expect(plan.changedFileImpacts).toEqual([
      expect.objectContaining({
        changedFile,
        matchedRules: ['release_deploy_operations'],
        affectedSurfaces: ['release/deploy'],
        manualReviewRequired: true,
        broadImpact: true,
      }),
    ]);
  });

  it.each([
    'scripts/release-full-campaign.sh',
    'scripts/release-full-aggregate-gate.sh',
    'scripts/run-integration-release-user-story.sh',
    'scripts/release-local-precheck-afscp.test.ts',
  ])('maps root release and deploy script %s to V4 operator review only', (changedFile) => {
    const plan = buildVerificationPlan({
      changedFiles: [changedFile],
    });

    expect(plan.requiredLevels).toEqual(['V4']);
    expect(plan.recommendedCommands).toEqual([]);
    expect(plan.affectedSurfaces).toEqual(['release/deploy']);
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.nextAction).toContain('npm run release:ready');
    expect(plan.releaseVerdict).toBe(false);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
    expect(plan.storyCards[0]).toMatchObject({
      riskLevel: 'R0',
      status: 'manual_review_needed',
      manualReviewRequired: true,
    });
    expect(plan.storyCards[0]?.manualReviewReasons).toContain('release/deploy operator review');
  });

  it('keeps explicit real run for release/deploy changes pointed at release-ready instead of partial heavy aliases', () => {
    const plan = buildVerificationPlan({
      goal: 'real',
      goalExplicit: true,
      run: true,
      changedFiles: ['scripts/run-integration-release-user-story.sh'],
    });

    expect(plan.requiredLevels).toEqual(['V4']);
    expect(plan.recommendedCommands).toEqual([]);
    expect(plan.affectedSurfaces).toEqual(['release/deploy']);
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.nextAction).toContain('npm run release:ready');
    expect(plan.nextAction).toContain('not a release verdict');
    expect(plan.finalVerdict).toBe('not_evaluated_next_action_required');
    expect(plan.releaseVerdict).toBe(false);
  });

  it('maps non-runtime env examples/local frontend configuration to V0/V1 without visual, backend-real, or unmapped impact', () => {
    const changedFiles = [
      '.env.local.example',
      '.env.example',
      'infra/integration/.env.example',
    ];
    const plan = buildVerificationPlan({ changedFiles });

    expect(plan.requiredLevels).toEqual(['V0', 'V1']);
    expect(plan.recommendedCommands).toEqual([
      'npm run verify:quick',
      'npm run verify:default',
    ]);
    expect(plan.recommendedCommands).not.toContain('npm run verify:visual');
    expect(plan.recommendedCommands).not.toContain('npm run verify:real');
    expect(plan.affectedSurfaces).toEqual(['env-only-configuration']);
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.storyCards).toEqual([]);
    expect(plan.riskSummary.manualReviewRequired).toBe(false);
    expect(plan.riskSummary.broadImpact).toBe(false);
    expect(plan.riskSummary.warnings.join('\n')).not.toContain('did not match canonical story markdown');
    expect(plan.changedFileImpacts).toEqual(expect.arrayContaining(
      changedFiles.map((changedFile) => expect.objectContaining({
        changedFile,
        matchedRules: ['env_only_configuration'],
        affectedSurfaces: ['env-only-configuration'],
        storyIds: [],
        manualReviewRequired: false,
        broadImpact: false,
      })),
    ));
  });

  it('maps ordinary docs-only changes to V0/V1 without heavy visual or backend-real expansion', () => {
    const changedFiles = [
      'README.md',
      'DEVELOPMENT.md',
      'docs/user-guides/test-and-evidence-directory-model.md',
      'marketing/README.md',
    ];
    const plan = buildVerificationPlan({ changedFiles });

    expect(plan.requiredLevels).toEqual(['V0', 'V1']);
    expect(plan.recommendedCommands).toEqual([
      'npm run verify:quick',
      'npm run verify:default',
    ]);
    expect(plan.recommendedCommands).not.toContain('npm run verify:visual');
    expect(plan.recommendedCommands).not.toContain('npm run verify:real');
    expect(plan.affectedSurfaces).toEqual(['docs-only']);
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.storyCards).toEqual([]);
    expect(plan.riskSummary.manualReviewRequired).toBe(false);
    expect(plan.riskSummary.broadImpact).toBe(false);
    expect(plan.changedFileImpacts).toEqual(expect.arrayContaining(
      changedFiles.map((changedFile) => expect.objectContaining({
        changedFile,
        matchedRules: ['docs_only'],
        affectedSurfaces: ['docs-only'],
        storyIds: [],
        manualReviewRequired: false,
        broadImpact: false,
      })),
    ));
  });

  it.each([
    'infra/runtime/backend-real.env',
    'infra/substrate/local-dev.env',
  ])('does not downgrade runtime-critical env path %s to env-only verification', (changedFile) => {
    const plan = buildVerificationPlan({
      changedFiles: [changedFile],
    });
    const impact = plan.changedFileImpacts.find((candidate) => candidate.changedFile === changedFile);

    expect(plan.requiredLevels).toContain('V3');
    expect(plan.requiredLevels).not.toEqual(['V0', 'V1']);
    expect(plan.recommendedCommands).not.toEqual([
      'npm run verify:quick',
      'npm run verify:default',
    ]);
    expect(plan.affectedSurfaces).not.toEqual(['env-only-configuration']);
    expect(impact?.matchedRules).not.toContain('env_only_configuration');
    expect(impact?.broadImpact).toBe(true);
  });

  it.each([
    'infra/deploy/unified/env/site.env.example',
    'infra/deploy/unified/substrate/connection.env.example',
  ])('keeps release env path %s on the release/deploy closure instead of env-only selection', (changedFile) => {
    const plan = buildVerificationPlan({
      changedFiles: [changedFile],
    });

    expect(plan.requiredLevels).toEqual(['V4']);
    expect(plan.recommendedCommands).not.toContain('npm run verify:visual');
    expect(plan.recommendedCommands).not.toContain('npm run verify:real');
    expect(plan.affectedSurfaces).toEqual(['release/deploy']);
    expect(plan.changedFileImpacts).toEqual([
      expect.objectContaining({
        changedFile,
        matchedRules: ['release_deploy_operations'],
        affectedSurfaces: ['release/deploy'],
        manualReviewRequired: true,
        broadImpact: true,
      }),
    ]);
  });

  it('maps design-system changes to visual impact while preserving story policy floors', () => {
    const changedFiles = [
      'DESIGN.md',
      'docs/UXUI/00-设计系统/状态与文案规范-v1.md',
      'src/app/globals.css',
      'src/components/ui/button.tsx',
      'tailwind.config.js',
      'components.json',
    ];
    const plan = buildVerificationPlan({ changedFiles });
    const designImpacts = plan.changedFileImpacts.filter(
      (impact) => changedFiles.includes(impact.changedFile),
    );
    const governanceCard = plan.storyCards.find((card) => card.storyId === 'mock-lane-governance-surfaces');
    const chatCard = plan.storyCards.find((card) => card.storyId === 'mock-lane-chat-operate-and-recover');

    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(plan.recommendedCommands).toEqual([
      'npm run verify:quick',
      'npm run verify:default',
      'npm run verify:visual',
      'npm run verify:real',
    ]);
    expect(plan.affectedSurfaces).toContain('design-system');
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.affectedStories).toContain('mock-lane-chat-operate-and-recover');
    expect(plan.storyCards.every((card) => card.lane === 'mock-lane')).toBe(true);
    expect(governanceCard).toMatchObject({
      riskLevel: 'R0',
      riskPolicyRefs: expect.arrayContaining(['release_blocking_governance']),
      requiredLevels: ['V0', 'V1', 'V2', 'V3'],
    });
    expect(chatCard).toMatchObject({
      riskLevel: 'R2',
      requiredLevels: ['V0', 'V1', 'V2'],
    });
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
    expect(plan.riskSummary.broadImpact).toBe(true);
    expect(plan.nextAction).toContain('npm run verify:visual');
    expect(designImpacts).toHaveLength(changedFiles.length);
    expect(designImpacts).toEqual(expect.arrayContaining(
      changedFiles.map((changedFile) => expect.objectContaining({
        changedFile,
        matchedRules: ['design_system'],
        affectedSurfaces: ['design-system'],
        manualReviewRequired: true,
        broadImpact: true,
      })),
    ));
  });

  it.each([
    'DESIGN.md',
    'src/app/globals.css',
    'src/components/ui/button.tsx',
  ])('keeps design-system path %s from bypassing R0/R1 story policy floors', (changedFile) => {
    const plan = buildVerificationPlan({
      changedFiles: [changedFile],
    });
    const r0Card = plan.storyCards.find((card) => card.storyId === 'mock-lane-entry-access');
    const r2Card = plan.storyCards.find((card) => card.storyId === 'mock-lane-chat-operate-and-recover');

    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(plan.recommendedCommands).toContain('npm run verify:visual');
    expect(plan.recommendedCommands).toContain('npm run verify:real');
    expect(plan.changedFileImpacts).toContainEqual(expect.objectContaining({
      changedFile,
      matchedRules: ['design_system'],
      affectedSurfaces: ['design-system'],
      broadImpact: true,
    }));
    expect(r0Card).toMatchObject({
      riskLevel: 'R0',
      riskPolicyRefs: expect.arrayContaining(['identity_access_boundary']),
      requiredLevels: ['V0', 'V1', 'V2', 'V3'],
    });
    expect(r2Card).toMatchObject({
      riskLevel: 'R2',
      requiredLevels: ['V0', 'V1', 'V2'],
    });
  });

  it('maps backend-real full gate to release-ready publicly instead of downgrading to core real', () => {
    const plan = buildVerificationPlan({
      changedFiles: ['scripts/backend-real-full-gate.sh'],
    });
    const report = buildStoryAcceptanceReport(plan, '/tmp/report-root');

    expect(plan.requiredLevels).toEqual(['V3']);
    expect(plan.recommendedCommands).toEqual(['npm run verify:release-real']);
    expect(plan.affectedSurfaces).toEqual(['release-real-owner']);
    expect(plan.affectedStories.join('\n')).toContain('mapped operational impact: release-real-owner');
    expect(plan.affectedStories.join('\n')).not.toContain('No changed files provided or detected');
    expect(plan.nextAction).toContain('npm run release:ready');
    expect(plan.nextAction).not.toContain('npm run verify -- --goal=release-real --run');
    expect(plan.nextAction).not.toContain('npm run verify:release-real');
    expect(plan.nextAction).toContain('not a release verdict until npm run release:ready runs');
    expect(report.recommended_commands).toEqual(['npm run release:ready']);
    expect(JSON.stringify(report)).not.toContain('npm run verify:');
    expect(JSON.stringify(report)).not.toContain('--goal=release-real');
    expect(JSON.stringify(report)).not.toContain('--goal=debug');
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

  it('maps backend-real gate diagnostics to backend-real owner review without unmapped or visual impact', () => {
    const changedFiles = [
      'scripts/backend-real-bootstrap.sh',
      'scripts/backend-real-run.sh',
      'scripts/backend-real-run.test.ts',
      'scripts/agent-task-real-smoke-gate.sh',
      'scripts/run-internal-agent-task-real-gate.sh',
      'scripts/internal-backend-real-gate-runtime.test.ts',
    ];
    const plan = buildVerificationPlan({ changedFiles });
    const internalAgentTaskGateImpact = plan.changedFileImpacts.find(
      (impact) => impact.changedFile === 'scripts/run-internal-agent-task-real-gate.sh',
    );

    expect(plan.requiredLevels).toEqual(['V0', 'V1', 'V3']);
    expect(plan.recommendedCommands).toContain('npm run verify:real');
    expect(plan.recommendedCommands).not.toContain('npm run verify:visual');
    expect(plan.affectedSurfaces).toEqual(['backend-real-diagnostic-tooling']);
    expect(plan.affectedSurfaces).not.toContain('unmapped-source');
    expect(plan.riskSummary.broadImpact).toBe(true);
    expect(plan.riskSummary.manualReviewRequired).toBe(true);
    expect(plan.changedFileImpacts).toEqual(expect.arrayContaining(
      changedFiles.map((changedFile) => expect.objectContaining({
        changedFile,
        matchedRules: ['backend_real_diagnostic_tooling'],
        affectedSurfaces: ['backend-real-diagnostic-tooling'],
        broadImpact: true,
        manualReviewRequired: true,
      })),
    ));
    expect(internalAgentTaskGateImpact).toMatchObject({
      matchedRules: ['backend_real_diagnostic_tooling'],
      affectedSurfaces: ['backend-real-diagnostic-tooling'],
      storyIds: [],
      broadImpact: true,
      manualReviewRequired: true,
    });
    expect(internalAgentTaskGateImpact?.matchedRules).not.toContain('runner_context_credential');
    expect(plan.storyCards.every((card) => card.lane === 'backend-real')).toBe(true);
  });

  it('keeps broad-impact story cards on their own story-level evidence lanes', () => {
    const plan = buildVerificationPlan({
      changedFiles: [
        'e2e/generated/story-specs.generated.json',
        'src/lib/new-unmapped-source.ts',
      ],
    });
    const mockLaneCard = plan.storyCards.find((card) => card.storyId === 'mock-lane-chat-operate-and-recover');
    const backendRealCard = plan.storyCards.find((card) => card.storyId === 'agent-task-first-success');
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
    const backendRealCard = plan.storyCards.find((card) => card.storyId === 'agent-task-first-success');

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
      changedFiles: ['scripts/unified-deploy/release-local-kind.sh'],
    });

    expect(plan.requiredLevels).toEqual(['V4']);
    expect(plan.recommendedCommands).not.toContain('npm run verify:release-real');
    expect(plan.recommendedCommands).toEqual(['npm run test:unified-deploy:unit']);
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
        traceability_gaps: ReportTraceabilityGap[];
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
      expect(reportCard).toMatchObject({
        risk_policy_refs: expect.arrayContaining(['visual_product_experience']),
        risk_policy_source: CURRENT_STORY_RISK_POLICY_SOURCE,
      });
      expect(reportCard?.risk_reason).toContain('risk policy sidecar');
      expect(reportCard?.latest_evidence).toEqual({
        state: 'not_inspected_by_verify_report',
        owner: 'visual review owner',
        artifact_path: null,
      });
      expect(reportCard?.evidence_cards.find((card) => card.level === 'V2')).toMatchObject({
        state: 'not_inspected_by_verify_report',
        status: 'manual_review_needed',
        owner: 'npm run verify -- --goal=visual --run',
        artifact_path: null,
        artifact_path_template: 'artifacts/visual-baseline-reviews/<run-id>/run-manifest.json',
        artifact_path_template_reason: null,
      });
      expect(reportCard?.evidence_cards.find((card) => card.level === 'V0')).toMatchObject({
        owner: 'npm run verify -- --goal=pr --run',
        artifact_path_template: null,
      });
      expect(reportCard?.evidence_cards.find((card) => card.level === 'V0')?.artifact_path_template_reason)
        .toContain('No registered current gate result writer');
      expect(report.traceability_gaps).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'missing_catalog_mapping',
          story_id: 'mock-lane-chat-operate-and-recover',
          level: 'V0',
          owner: 'npm run verify -- --goal=pr --run',
          status: 'not_evaluated',
          artifact_path_template_reason: expect.stringContaining('No registered current gate result writer for gate-fast'),
          next_action: expect.stringContaining('Register the current gate result writer artifact_path_template mapping for V0'),
        }),
        expect.objectContaining({
          kind: 'missing_catalog_mapping',
          story_id: 'mock-lane-chat-operate-and-recover',
          level: 'V1',
          owner: 'npm run verify -- --goal=pr --run',
          status: 'not_evaluated',
          artifact_path_template_reason: expect.stringContaining('No registered current gate result writer for gate-default'),
          next_action: expect.stringContaining('Register the current gate result writer artifact_path_template mapping for V1'),
        }),
      ]));
      expect(report.traceability_gaps.some((gap) => (
        gap.story_id === 'mock-lane-chat-operate-and-recover' && gap.level === 'V2'
      ))).toBe(false);
      expect(reportStatusValues(report.story_cards)).not.toContain('passed');
      expect(reportStatusValues(report.story_cards)).not.toContain('stale');
      expect(report.final_verdict).toBe('not_evaluated_fail_closed');
      expect(report.release_verdict).toBe(false);

      const markdown = readFileSync(markdownPath, 'utf8');
      expect(markdown).toContain('Story Acceptance Report');
      expect(markdown).toContain('| Story | Risk | Status | Required levels | Manual review | Next action |');
      expect(markdown).toContain('not release readiness');
      expect(markdown).toContain('not a release verdict');
      expect(markdown).toContain('## Traceability Gaps');
      expect(markdown).toContain('missing_catalog_mapping');
      expect(markdown).toContain('No registered current gate result writer for gate-fast');
      expect(markdown).toContain('mock-lane-chat-operate-and-recover');
      expect(markdown).toContain('- Risk policy refs: visual_product_experience, standard_mock_workflow');
      expect(markdown).toContain(`- Risk policy source: ${CURRENT_STORY_RISK_POLICY_SOURCE}`);
      expect(markdown).toContain('- Evidence cards:');
      expect(markdown).toContain(
        '- V2: owner=npm run verify -- --goal=visual --run; status=manual_review_needed; path_template=artifacts/visual-baseline-reviews/<run-id>/run-manifest.json',
      );
      expect(readFileSync(jsonPath, 'utf8')).not.toContain('npm run verify:');
      expect(markdown).not.toContain('npm run verify:');
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
      expect(report.next_actions.some((action) => action.includes('npm run verify -- --goal=visual --run'))).toBe(true);
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
