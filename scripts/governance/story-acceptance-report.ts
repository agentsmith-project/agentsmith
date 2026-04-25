import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  VerificationPlan,
  VerificationRiskSummary,
  VerificationStoryCard,
} from './verify-impact-selector';

export const STORY_ACCEPTANCE_REPORT_SCHEMA = 'agentsmith_story_acceptance_report/v1';

export interface StoryAcceptanceReportCard {
  story_id: string;
  title: string;
  personas: readonly string[];
  family: string;
  lane: VerificationStoryCard['lane'];
  source_file: string;
  risk: VerificationStoryCard['risk'];
  required_levels: readonly string[];
  evidence_status: VerificationStoryCard['evidenceStatus'];
  next_action: string;
}

export interface StoryAcceptanceReport {
  schema: typeof STORY_ACCEPTANCE_REPORT_SCHEMA;
  generated_at: string;
  goal: VerificationPlan['goal'];
  mode: VerificationPlan['mode'];
  changed_files: readonly string[];
  risk_summary: {
    posture: VerificationRiskSummary['posture'];
    summary: string;
    reasons: readonly string[];
    warnings: readonly string[];
    manual_review_required: boolean;
    broad_impact: boolean;
  };
  required_levels: readonly string[];
  recommended_commands: readonly string[];
  final_verdict: string;
  next_action: string;
  report_root: string;
  release_verdict: false;
  not_release_readiness: true;
  story_cards: readonly StoryAcceptanceReportCard[];
}

export interface StoryAcceptanceReportWriteResult {
  reportRoot: string;
  jsonPath: string;
  markdownPath: string;
  report: StoryAcceptanceReport;
}

function toReportCard(card: VerificationStoryCard): StoryAcceptanceReportCard {
  return {
    story_id: card.storyId,
    title: card.title,
    personas: card.personas,
    family: card.family,
    lane: card.lane,
    source_file: card.sourceFile,
    risk: card.risk,
    required_levels: card.requiredLevels,
    evidence_status: card.evidenceStatus,
    next_action: card.nextAction,
  };
}

export function buildStoryAcceptanceReport(plan: VerificationPlan, reportRoot: string): StoryAcceptanceReport {
  return {
    schema: STORY_ACCEPTANCE_REPORT_SCHEMA,
    generated_at: plan.generatedAt,
    goal: plan.goal,
    mode: plan.mode,
    changed_files: plan.changedFiles,
    risk_summary: {
      posture: plan.riskSummary.posture,
      summary: plan.riskSummary.summary,
      reasons: plan.riskSummary.reasons,
      warnings: plan.riskSummary.warnings,
      manual_review_required: plan.riskSummary.manualReviewRequired,
      broad_impact: plan.riskSummary.broadImpact,
    },
    required_levels: plan.requiredLevels,
    recommended_commands: plan.recommendedCommands,
    final_verdict: plan.finalVerdict,
    next_action: plan.nextAction,
    report_root: reportRoot,
    release_verdict: false,
    not_release_readiness: true,
    story_cards: plan.storyCards.map(toReportCard),
  };
}

function renderList(values: readonly string[], empty = '<none>'): string[] {
  if (values.length === 0) {
    return [`- ${empty}`];
  }
  return values.map((value) => `- ${value}`);
}

function renderStoryCard(card: StoryAcceptanceReportCard): string[] {
  return [
    `### ${card.story_id}`,
    '',
    `- Title: ${card.title}`,
    `- Personas: ${card.personas.join(', ')}`,
    `- Family: ${card.family}`,
    `- Lane: ${card.lane}`,
    `- Source file: ${card.source_file}`,
    `- Risk: ${card.risk}`,
    `- Required levels: ${card.required_levels.join(', ')}`,
    `- Evidence status: ${card.evidence_status}`,
    `- Next action: ${card.next_action}`,
    '',
  ];
}

export function renderStoryAcceptanceReportMarkdown(report: StoryAcceptanceReport): string {
  const lines = [
    '# Story Acceptance Report',
    '',
    `- Schema: ${report.schema}`,
    `- Generated at: ${report.generated_at}`,
    `- Goal: ${report.goal}`,
    `- Mode: ${report.mode}`,
    `- Report root: ${report.report_root}`,
    '',
    'This report is not release readiness and not a release verdict. It does not claim passed, stale, or release-ready evidence.',
    '',
    '## Verdict',
    '',
    `- Final verdict: ${report.final_verdict}`,
    '- Release verdict: false',
    `- Next action: ${report.next_action}`,
    '',
    '## Risk',
    '',
    `- Posture: ${report.risk_summary.posture}`,
    `- Summary: ${report.risk_summary.summary}`,
    `- Manual review required: ${report.risk_summary.manual_review_required ? 'true' : 'false'}`,
    `- Broad impact: ${report.risk_summary.broad_impact ? 'true' : 'false'}`,
    '',
    '## Changed Files',
    '',
    ...renderList(report.changed_files),
    '',
    '## Required Levels',
    '',
    ...renderList(report.required_levels),
    '',
    '## Recommended Commands',
    '',
    ...renderList(report.recommended_commands),
    '',
    '## Risk Reasons',
    '',
    ...renderList(report.risk_summary.reasons),
    '',
    '## Warnings',
    '',
    ...renderList(report.risk_summary.warnings),
    '',
    '## Affected Stories',
    '',
    ...renderList(report.story_cards.map((card) => card.story_id)),
    '',
    '## Story Cards',
    '',
  ];

  if (report.story_cards.length === 0) {
    lines.push('No story cards were selected for this dry-run plan.', '');
  } else {
    for (const card of report.story_cards) {
      lines.push(...renderStoryCard(card));
    }
  }

  return `${lines.join('\n')}\n`;
}

export function writeStoryAcceptanceReport(
  plan: VerificationPlan,
  reportRoot = plan.reportRoot,
): StoryAcceptanceReportWriteResult {
  if (!reportRoot) {
    throw new Error('report root is required to write the story acceptance report');
  }
  const resolvedReportRoot = path.resolve(reportRoot);
  const report = buildStoryAcceptanceReport(plan, resolvedReportRoot);
  const jsonPath = path.join(resolvedReportRoot, 'story-acceptance-report.json');
  const markdownPath = path.join(resolvedReportRoot, 'story-acceptance-report.md');

  mkdirSync(resolvedReportRoot, { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderStoryAcceptanceReportMarkdown(report));

  return {
    reportRoot: resolvedReportRoot,
    jsonPath,
    markdownPath,
    report,
  };
}
