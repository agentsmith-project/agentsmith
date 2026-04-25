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
  risk_level: VerificationStoryCard['riskLevel'];
  risk_reason: string;
  required_levels: readonly string[];
  evidence_status: VerificationStoryCard['evidenceStatus'];
  status: VerificationStoryCard['status'];
  failure_reason: string | null;
  manual_review_required: boolean;
  manual_review_reasons: readonly string[];
  level_statuses: readonly {
    level: string;
    status: VerificationStoryCard['status'];
    reason: string;
  }[];
  latest_evidence: {
    state: VerificationStoryCard['latestEvidence']['state'];
    owner: string;
    artifact_path: string | null;
  };
  evidence_cards: readonly {
    level: string;
    state: VerificationStoryCard['latestEvidence']['state'];
    status: VerificationStoryCard['status'];
    owner: string;
    artifact_path: string | null;
    artifact_path_template: string | null;
    additional_artifact_path_templates: readonly string[];
    artifact_path_template_reason: string | null;
    note: string;
  }[];
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
  verification_catalog_path?: string;
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

export interface BuildStoryAcceptanceReportOptions {
  verificationCatalogPath?: string;
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
    risk_level: card.riskLevel,
    risk_reason: card.riskReason,
    required_levels: card.requiredLevels,
    evidence_status: card.evidenceStatus,
    status: card.status,
    failure_reason: card.failureReason,
    manual_review_required: card.manualReviewRequired,
    manual_review_reasons: card.manualReviewReasons,
    level_statuses: card.levelStatuses,
    latest_evidence: {
      state: card.latestEvidence.state,
      owner: card.latestEvidence.owner,
      artifact_path: card.latestEvidence.artifactPath,
    },
    evidence_cards: card.evidenceCards.map((evidenceCard) => ({
      level: evidenceCard.level,
      state: evidenceCard.state,
      status: evidenceCard.status,
      owner: evidenceCard.owner,
      artifact_path: evidenceCard.artifactPath,
      artifact_path_template: evidenceCard.artifactPathTemplate,
      additional_artifact_path_templates: evidenceCard.additionalArtifactPathTemplates,
      artifact_path_template_reason: evidenceCard.artifactPathTemplateReason,
      note: evidenceCard.note,
    })),
    next_action: card.nextAction,
  };
}

export function buildStoryAcceptanceReport(
  plan: VerificationPlan,
  reportRoot: string,
  options: BuildStoryAcceptanceReportOptions = {},
): StoryAcceptanceReport {
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
    ...(options.verificationCatalogPath
      ? { verification_catalog_path: path.resolve(options.verificationCatalogPath) }
      : {}),
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

function renderMarkdownTableValue(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function renderStoryStatusTable(cards: readonly StoryAcceptanceReportCard[]): string[] {
  if (cards.length === 0) {
    return ['No story cards were selected for this dry-run plan.'];
  }

  return [
    '| Story | Risk | Status | Required levels | Manual review | Next action |',
    '| --- | --- | --- | --- | --- | --- |',
    ...cards.map((card) => [
      card.story_id,
      card.risk_level,
      card.status,
      card.required_levels.join(', '),
      card.manual_review_required ? card.manual_review_reasons.join(', ') || 'required' : 'false',
      card.next_action,
    ].map(renderMarkdownTableValue).join(' | ')).map((row) => `| ${row} |`),
  ];
}

function renderLevelStatuses(card: StoryAcceptanceReportCard): string[] {
  if (card.level_statuses.length === 0) {
    return ['- Level statuses: <none>'];
  }
  return [
    '- Level statuses:',
    ...card.level_statuses.map((entry) => `  - ${entry.level}: ${entry.status} (${entry.reason})`),
  ];
}

function renderEvidenceCards(card: StoryAcceptanceReportCard): string[] {
  if (card.evidence_cards.length === 0) {
    return ['- Evidence cards: <none>'];
  }

  return [
    '- Evidence cards:',
    ...card.evidence_cards.map((entry) => {
      const additionalTemplates = entry.additional_artifact_path_templates.length > 0
        ? `; additional_path_templates=${entry.additional_artifact_path_templates.join(', ')}`
        : '';
      const missingTemplateReason = entry.artifact_path_template_reason
        ? `; template_reason=${entry.artifact_path_template_reason}`
        : '';
      return `  - ${entry.level}: owner=${entry.owner}; status=${entry.status}; path_template=${entry.artifact_path_template ?? '<none>'}${additionalTemplates}${missingTemplateReason}`;
    }),
  ];
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
    `- Risk: ${card.risk_level} (${card.risk})`,
    `- Risk reason: ${card.risk_reason}`,
    `- Required levels: ${card.required_levels.join(', ')}`,
    `- Evidence status: ${card.evidence_status}`,
    `- Status: ${card.status}`,
    `- Failure reason: ${card.failure_reason ?? '<none>'}`,
    `- Manual review required: ${card.manual_review_required ? 'true' : 'false'}`,
    `- Manual review reasons: ${card.manual_review_reasons.length > 0 ? card.manual_review_reasons.join(', ') : '<none>'}`,
    ...renderLevelStatuses(card),
    `- Latest evidence: ${card.latest_evidence.state}; owner=${card.latest_evidence.owner}; artifact_path=${card.latest_evidence.artifact_path ?? '<none>'}`,
    ...renderEvidenceCards(card),
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
    ...(report.verification_catalog_path
      ? [`- Verification catalog: ${report.verification_catalog_path}`]
      : []),
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
    '## Story Status',
    '',
    ...renderStoryStatusTable(report.story_cards),
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
  options: BuildStoryAcceptanceReportOptions = {},
): StoryAcceptanceReportWriteResult {
  if (!reportRoot) {
    throw new Error('report root is required to write the story acceptance report');
  }
  const resolvedReportRoot = path.resolve(reportRoot);
  const report = buildStoryAcceptanceReport(plan, resolvedReportRoot, options);
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
