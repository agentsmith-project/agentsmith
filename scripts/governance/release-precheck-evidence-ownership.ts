import { readFileSync } from 'node:fs';

import {
  CURRENT_RELEASE_PRECHECK_MOVED_BROWSER_SPECS,
  type CurrentGateUxTraceExpectedMembership,
} from './current-gate-manifest';
import {
  findCurrentVerificationCampaignById,
  type CurrentVerificationCampaignDefinition,
} from './current-verification-campaign-manifest';

export type ReleasePrecheckMovedCheckId =
  | 'browser_product_scenarios'
  | 'agent_task_release_checks'
  | 'files_runner_business_assertions';

export interface ReleasePrecheckFormalEvidenceOwner {
  campaignId: 'release-full';
  stepId: string;
  evidenceCheckIds: readonly string[];
  reportPaths: readonly string[];
  requiredProductFlows?: readonly string[];
  requiredSpecFiles?: readonly string[];
  requiredUxTraceMembership?: readonly ReleasePrecheckRequiredUxTraceMembership[];
  requiredSourceAssertions?: readonly ReleasePrecheckEvidenceOwnerSourceAssertion[];
}

export interface ReleasePrecheckMovedCheckEvidenceOwnership {
  id: ReleasePrecheckMovedCheckId;
  removedFrom: 'test:release:precheck';
  movedCheck: string;
  formalOwners: readonly ReleasePrecheckFormalEvidenceOwner[];
  acceptanceTest: string;
}

export interface ReleasePrecheckEvidenceOwnershipFailure {
  movedCheckId: ReleasePrecheckMovedCheckId;
  ownerStepId?: string;
  reason: string;
}

export type ReleasePrecheckEvidenceOwnerSourcePath =
  | 'scripts/backend-real-full-gate.sh'
  | 'scripts/backend-real-run.sh'
  | 'scripts/run-backend-real-session-shards.sh'
  | 'scripts/unified-deploy/release-product-flows.sh';

export interface ReleasePrecheckEvidenceOwnerSourceAssertion {
  sourcePath: ReleasePrecheckEvidenceOwnerSourcePath;
  requiredNeedles: readonly string[];
}

export type ReleasePrecheckRequiredUxTraceMembership = CurrentGateUxTraceExpectedMembership & {
  specFile: string;
};

export interface ValidateReleasePrecheckEvidenceOwnershipOptions {
  campaign?: CurrentVerificationCampaignDefinition;
  sourceTexts?: Partial<Record<ReleasePrecheckEvidenceOwnerSourcePath, string>>;
}

export const RELEASE_PRECHECK_MOVED_BROWSER_SPECS = CURRENT_RELEASE_PRECHECK_MOVED_BROWSER_SPECS;

const RELEASE_PRECHECK_BROWSER_UX_TRACE_MEMBERSHIP = CURRENT_RELEASE_PRECHECK_MOVED_BROWSER_SPECS.flatMap(
  (spec) => spec.storyIds.map((storyId): ReleasePrecheckRequiredUxTraceMembership => ({
    specFile: spec.specFile,
    suite: spec.suite,
    storyId,
    scenarioId: spec.scenarioId,
  })),
);

export const RELEASE_PRECHECK_AGENT_TASK_SKILLS_RUNTIME_ASSERTION = {
  sourcePath: 'scripts/run-backend-real-session-shards.sh',
  requiredNeedles: ['--skills-runtime'],
} as const satisfies ReleasePrecheckEvidenceOwnerSourceAssertion;

const RELEASE_PRECHECK_AGENT_TASK_RELEASE_OWNER_SOURCE_ASSERTIONS = [
  {
    sourcePath: 'scripts/backend-real-full-gate.sh',
    requiredNeedles: ['npm run backend-real:run'],
  },
  {
    sourcePath: 'scripts/backend-real-run.sh',
    requiredNeedles: ['npm run test:agent-task:backend-real:runner'],
  },
  RELEASE_PRECHECK_AGENT_TASK_SKILLS_RUNTIME_ASSERTION,
] as const satisfies readonly ReleasePrecheckEvidenceOwnerSourceAssertion[];

export const RELEASE_PRECHECK_MOVED_CHECK_EVIDENCE_OWNERSHIP = [
  {
    id: 'browser_product_scenarios',
    removedFrom: 'test:release:precheck',
    movedCheck: 'Playwright browser product scenarios formerly run by release-local-precheck',
    formalOwners: [
      {
        campaignId: 'release-full',
        stepId: 'gate-release',
        evidenceCheckIds: [
          'backend_real_ux_trace_index',
          'backend_real_ux_trace_reviews',
        ],
        reportPaths: [
          '<campaign-root>/gate-release/backend-real-visual/ux-traces/ux-trace-index.json',
          '<campaign-root>/gate-release/backend-real-visual/ux-traces',
        ],
        requiredSpecFiles: CURRENT_RELEASE_PRECHECK_MOVED_BROWSER_SPECS.map((spec) => spec.specFile),
        requiredUxTraceMembership: RELEASE_PRECHECK_BROWSER_UX_TRACE_MEMBERSHIP,
      },
      {
        campaignId: 'release-full',
        stepId: 'lane-unified-deploy-product-flows',
        evidenceCheckIds: ['unified_deploy_product_flow_evidence'],
        reportPaths: ['<campaign-root>/unified-deploy/product-flows'],
        requiredProductFlows: ['workspace_project'],
      },
    ],
    acceptanceTest: 'scripts/governance/__tests__/release-precheck-evidence-ownership.test.ts',
  },
  {
    id: 'agent_task_release_checks',
    removedFrom: 'test:release:precheck',
    movedCheck: 'Internal Agent Task release-grade backend-real checks formerly run from precheck',
    formalOwners: [
      {
        campaignId: 'release-full',
        stepId: 'gate-release',
        evidenceCheckIds: ['backend_real_ux_trace_reviews'],
        reportPaths: ['<campaign-root>/gate-release/backend-real-visual/ux-traces'],
        requiredSourceAssertions: RELEASE_PRECHECK_AGENT_TASK_RELEASE_OWNER_SOURCE_ASSERTIONS,
      },
      {
        campaignId: 'release-full',
        stepId: 'lane-unified-deploy-product-flows',
        evidenceCheckIds: ['unified_deploy_product_flow_evidence'],
        reportPaths: ['<campaign-root>/unified-deploy/product-flows'],
        requiredProductFlows: ['agent_task_managed_runner'],
      },
    ],
    acceptanceTest: 'scripts/governance/__tests__/release-precheck-evidence-ownership.test.ts',
  },
  {
    id: 'files_runner_business_assertions',
    removedFrom: 'test:release:precheck',
    movedCheck: 'Files and Runner business assertions formerly reachable through nested precheck gates',
    formalOwners: [
      {
        campaignId: 'release-full',
        stepId: 'gate-release',
        evidenceCheckIds: ['backend_real_ux_trace_reviews'],
        reportPaths: ['<campaign-root>/gate-release/backend-real-visual/ux-traces'],
      },
      {
        campaignId: 'release-full',
        stepId: 'lane-unified-deploy-product-flows',
        evidenceCheckIds: ['unified_deploy_product_flow_evidence'],
        reportPaths: ['<campaign-root>/unified-deploy/product-flows'],
        requiredProductFlows: ['files', 'agent_task_managed_runner'],
      },
    ],
    acceptanceTest: 'scripts/governance/__tests__/release-precheck-evidence-ownership.test.ts',
  },
] as const satisfies readonly ReleasePrecheckMovedCheckEvidenceOwnership[];

function currentReleaseFullCampaign(): CurrentVerificationCampaignDefinition {
  const campaign = findCurrentVerificationCampaignById('release-full');
  if (!campaign) {
    throw new Error('Missing release-full verification campaign.');
  }
  return campaign;
}

function isCampaignDefinition(value: unknown): value is CurrentVerificationCampaignDefinition {
  return Boolean(
    value
      && typeof value === 'object'
      && 'id' in value
      && 'steps' in value
      && Array.isArray((value as { steps?: unknown }).steps),
  );
}

function resolveValidationInput(
  input?: CurrentVerificationCampaignDefinition | ValidateReleasePrecheckEvidenceOwnershipOptions,
): Required<Pick<ValidateReleasePrecheckEvidenceOwnershipOptions, 'campaign'>> &
  Pick<ValidateReleasePrecheckEvidenceOwnershipOptions, 'sourceTexts'> {
  if (!input) {
    return {
      campaign: currentReleaseFullCampaign(),
    };
  }
  if (isCampaignDefinition(input)) {
    return {
      campaign: input,
    };
  }
  return {
    campaign: input.campaign ?? currentReleaseFullCampaign(),
    sourceTexts: input.sourceTexts,
  };
}

function readOwnerSource(
  sourcePath: ReleasePrecheckEvidenceOwnerSourcePath,
  sourceTexts?: Partial<Record<ReleasePrecheckEvidenceOwnerSourcePath, string>>,
): string {
  const provided = sourceTexts?.[sourcePath];
  if (provided !== undefined) {
    return provided;
  }
  return readFileSync(sourcePath, 'utf8');
}

function membershipMatches(
  left: CurrentGateUxTraceExpectedMembership,
  right: CurrentGateUxTraceExpectedMembership,
): boolean {
  return left.suite === right.suite
    && left.storyId === right.storyId
    && (left.scenarioId ?? '') === (right.scenarioId ?? '');
}

function sourceLineContaining(source: string, needle: string): string | null {
  return source.split(/\r?\n/u).find((line) => line.includes(needle)) ?? null;
}

function sourceWritesSpecToAuthoritativeUxTraceRoot(source: string, specFile: string): boolean {
  const specLine = sourceLineContaining(source, specFile);
  if (specLine?.includes("UX_TRACE_OUTPUT_ROOT='${AUTHORITATIVE_UX_TRACE_ROOT}'")) {
    return true;
  }

  return Boolean(
    specLine?.includes('run_release_browser_trace_spec')
      && source.includes('export UX_TRACE_OUTPUT_ROOT="${AUTHORITATIVE_UX_TRACE_ROOT}"'),
  );
}

export function validateReleasePrecheckEvidenceOwnership(
  input?: CurrentVerificationCampaignDefinition | ValidateReleasePrecheckEvidenceOwnershipOptions,
): ReleasePrecheckEvidenceOwnershipFailure[] {
  const { campaign, sourceTexts } = resolveValidationInput(input);
  const failures: ReleasePrecheckEvidenceOwnershipFailure[] = [];

  for (const mapping of RELEASE_PRECHECK_MOVED_CHECK_EVIDENCE_OWNERSHIP) {
    if (mapping.formalOwners.length === 0) {
      failures.push({
        movedCheckId: mapping.id,
        reason: 'missing formal release evidence owner',
      });
      continue;
    }

    for (const owner of mapping.formalOwners) {
      if (owner.campaignId !== campaign.id) {
        failures.push({
          movedCheckId: mapping.id,
          ownerStepId: owner.stepId,
          reason: `owner campaign ${owner.campaignId} does not match ${campaign.id}`,
        });
        continue;
      }

      const step = campaign.steps.find((candidate) => candidate.id === owner.stepId);
      if (!step) {
        failures.push({
          movedCheckId: mapping.id,
          ownerStepId: owner.stepId,
          reason: `missing release campaign step ${owner.stepId}`,
        });
        continue;
      }

      if (!step.evidenceRequired) {
        failures.push({
          movedCheckId: mapping.id,
          ownerStepId: owner.stepId,
          reason: `${owner.stepId} is not marked evidenceRequired`,
        });
      }

      for (const evidenceCheckId of owner.evidenceCheckIds) {
        if (!step.evidenceChecks.some((check) => check.id === evidenceCheckId)) {
          failures.push({
            movedCheckId: mapping.id,
            ownerStepId: owner.stepId,
            reason: `missing evidence check ${evidenceCheckId}`,
          });
        }
      }

      for (const reportPath of owner.reportPaths) {
        if (!step.evidenceChecks.some((check) => check.path === reportPath)) {
          failures.push({
            movedCheckId: mapping.id,
            ownerStepId: owner.stepId,
            reason: `missing report path ${reportPath}`,
          });
        }
      }

      for (const productFlow of owner.requiredProductFlows ?? []) {
        const hasProductFlow = step.evidenceChecks.some((check) => (
          owner.evidenceCheckIds.some((evidenceCheckId) => evidenceCheckId === check.id)
          && (check.expectedProductFlows ?? []).some((expectedFlow) => expectedFlow === productFlow)
        ));
        if (!hasProductFlow) {
          failures.push({
            movedCheckId: mapping.id,
            ownerStepId: owner.stepId,
            reason: `missing expected product flow ${productFlow}`,
          });
        }
      }

      for (const membership of owner.requiredUxTraceMembership ?? []) {
        const hasUxTraceMembership = step.evidenceChecks.some((check) => (
          owner.evidenceCheckIds.some((evidenceCheckId) => evidenceCheckId === check.id)
          && (check.expectedMembership ?? []).some((expected) => membershipMatches(expected, membership))
        ));
        if (!hasUxTraceMembership) {
          failures.push({
            movedCheckId: mapping.id,
            ownerStepId: owner.stepId,
            reason: `missing expected UX trace membership for ${membership.specFile}: ${membership.suite}/${membership.storyId}`,
          });
        }
      }

      for (const specFile of owner.requiredSpecFiles ?? []) {
        const sourcePath = 'scripts/backend-real-full-gate.sh';
        let source = '';
        try {
          source = readOwnerSource(sourcePath, sourceTexts);
        } catch (error) {
          failures.push({
            movedCheckId: mapping.id,
            ownerStepId: owner.stepId,
            reason: `missing release owner source ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
          });
          continue;
        }
        if (!source.includes(specFile)) {
          failures.push({
            movedCheckId: mapping.id,
            ownerStepId: owner.stepId,
            reason: `release owner ${sourcePath} does not run removed browser spec ${specFile}`,
          });
          continue;
        }
        if (!sourceWritesSpecToAuthoritativeUxTraceRoot(source, specFile)) {
          failures.push({
            movedCheckId: mapping.id,
            ownerStepId: owner.stepId,
            reason: `release owner ${sourcePath} must write ${specFile} to AUTHORITATIVE_UX_TRACE_ROOT`,
          });
        }
      }

      for (const assertion of owner.requiredSourceAssertions ?? []) {
        let source = '';
        try {
          source = readOwnerSource(assertion.sourcePath, sourceTexts);
        } catch (error) {
          failures.push({
            movedCheckId: mapping.id,
            ownerStepId: owner.stepId,
            reason: `missing release owner source ${assertion.sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
          });
          continue;
        }
        for (const needle of assertion.requiredNeedles) {
          if (!source.includes(needle)) {
            failures.push({
              movedCheckId: mapping.id,
              ownerStepId: owner.stepId,
              reason: `missing release owner source assertion ${needle} in ${assertion.sourcePath}`,
            });
          }
        }
      }
    }
  }

  return failures;
}
