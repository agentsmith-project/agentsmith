import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  RELEASE_PRECHECK_AGENT_TASK_SKILLS_RUNTIME_ASSERTION,
  RELEASE_PRECHECK_MOVED_BROWSER_SPECS,
  RELEASE_PRECHECK_MOVED_CHECK_EVIDENCE_OWNERSHIP,
  type ReleasePrecheckEvidenceOwnerSourcePath,
  validateReleasePrecheckEvidenceOwnership,
} from '../release-precheck-evidence-ownership';
import {
  findCurrentVerificationCampaignById,
  type CurrentVerificationCampaignDefinition,
} from '../current-verification-campaign-manifest';

function releaseFullCampaign(): CurrentVerificationCampaignDefinition {
  const campaign = findCurrentVerificationCampaignById('release-full');
  if (!campaign) {
    throw new Error('Missing release-full campaign.');
  }
  return campaign;
}

function releaseOwnerSources(): Record<ReleasePrecheckEvidenceOwnerSourcePath, string> {
  return {
    'scripts/backend-real-full-gate.sh': readFileSync('scripts/backend-real-full-gate.sh', 'utf8'),
    'scripts/backend-real-run.sh': readFileSync('scripts/backend-real-run.sh', 'utf8'),
    'scripts/run-backend-real-session-shards.sh': readFileSync('scripts/run-backend-real-session-shards.sh', 'utf8'),
    'scripts/unified-deploy/release-product-flows.sh': readFileSync('scripts/unified-deploy/release-product-flows.sh', 'utf8'),
  };
}

describe('release precheck evidence ownership', () => {
  it('maps every heavy check removed from release precheck to formal release evidence', () => {
    expect(validateReleasePrecheckEvidenceOwnership()).toEqual([]);
    expect(RELEASE_PRECHECK_MOVED_CHECK_EVIDENCE_OWNERSHIP.map((entry) => entry.id)).toEqual([
      'browser_product_scenarios',
      'agent_task_release_checks',
      'files_runner_business_assertions',
    ]);

    for (const entry of RELEASE_PRECHECK_MOVED_CHECK_EVIDENCE_OWNERSHIP) {
      expect(entry.removedFrom).toBe('test:release:precheck');
      expect(entry.acceptanceTest).toContain('release-precheck-evidence-ownership.test.ts');
      expect(entry.formalOwners.length).toBeGreaterThan(0);
      for (const owner of entry.formalOwners) {
        expect(owner.campaignId).toBe('release-full');
        expect(owner.reportPaths.length).toBeGreaterThan(0);
        expect(owner.evidenceCheckIds.length).toBeGreaterThan(0);
      }
    }

    const browserScenarios = RELEASE_PRECHECK_MOVED_CHECK_EVIDENCE_OWNERSHIP.find(
      (entry) => entry.id === 'browser_product_scenarios',
    );
    expect(RELEASE_PRECHECK_MOVED_BROWSER_SPECS.map((spec) => spec.specFile)).toEqual([
      'e2e/integration-system-admin-entry.spec.ts',
      'e2e/integration-workspace-public-login.spec.ts',
      'e2e/integration-workspace-entry.spec.ts',
      'e2e/integration-workspace-publish-usable.spec.ts',
      'e2e/integration-workspace-settings-directory.spec.ts',
    ]);
    expect(browserScenarios?.formalOwners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'gate-release',
          requiredSpecFiles: RELEASE_PRECHECK_MOVED_BROWSER_SPECS.map((spec) => spec.specFile),
          reportPaths: expect.arrayContaining([
            '<campaign-root>/gate-release/backend-real-visual/ux-traces',
          ]),
        }),
      ]),
    );

    const agentTask = RELEASE_PRECHECK_MOVED_CHECK_EVIDENCE_OWNERSHIP.find(
      (entry) => entry.id === 'agent_task_release_checks',
    );
    expect(RELEASE_PRECHECK_AGENT_TASK_SKILLS_RUNTIME_ASSERTION.requiredNeedles).toEqual(
      expect.arrayContaining(['--skills-runtime']),
    );
    expect(agentTask?.formalOwners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'gate-release',
          requiredSourceAssertions: expect.arrayContaining([
            expect.objectContaining({
              sourcePath: 'scripts/run-backend-real-session-shards.sh',
              requiredNeedles: expect.arrayContaining(['--skills-runtime']),
            }),
          ]),
          reportPaths: expect.arrayContaining([
            '<campaign-root>/gate-release/backend-real-visual/ux-traces',
          ]),
        }),
        expect.objectContaining({
          stepId: 'lane-unified-deploy-product-flows',
          reportPaths: expect.arrayContaining([
            '<campaign-root>/unified-deploy/product-flows',
          ]),
        }),
      ]),
    );

    const filesRunner = RELEASE_PRECHECK_MOVED_CHECK_EVIDENCE_OWNERSHIP.find(
      (entry) => entry.id === 'files_runner_business_assertions',
    );
    expect(filesRunner?.formalOwners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'gate-release',
          reportPaths: expect.arrayContaining([
            '<campaign-root>/gate-release/backend-real-visual/ux-traces',
          ]),
        }),
        expect.objectContaining({
          stepId: 'lane-unified-deploy-product-flows',
          reportPaths: expect.arrayContaining([
            '<campaign-root>/unified-deploy/product-flows',
          ]),
        }),
      ]),
    );
  });

  it('fails closed when a removed browser spec is no longer declared in release UX trace membership', () => {
    const campaign = releaseFullCampaign();
    const brokenCampaign: CurrentVerificationCampaignDefinition = {
      ...campaign,
      steps: campaign.steps.map((step) => step.id === 'gate-release'
        ? {
          ...step,
          evidenceChecks: step.evidenceChecks.map((check) => check.id === 'backend_real_ux_trace_reviews'
            ? {
              ...check,
              expectedMembership: (check.expectedMembership ?? []).filter(
                (membership) => membership.suite !== 'integration-workspace-entry',
              ),
            }
            : check),
        }
        : step),
    };

    expect(validateReleasePrecheckEvidenceOwnership({ campaign: brokenCampaign })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movedCheckId: 'browser_product_scenarios',
          ownerStepId: 'gate-release',
          reason: expect.stringContaining('e2e/integration-workspace-entry.spec.ts'),
        }),
      ]),
    );
  });

  it('fails closed when the formal release owner no longer runs a removed browser spec', () => {
    const sourceTexts = releaseOwnerSources();
    sourceTexts['scripts/backend-real-full-gate.sh'] = sourceTexts['scripts/backend-real-full-gate.sh']
      .replace(/e2e\/integration-workspace-entry\.spec\.ts/g, 'e2e/integration-workspace-entry.removed.ts');

    expect(validateReleasePrecheckEvidenceOwnership({ sourceTexts })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movedCheckId: 'browser_product_scenarios',
          ownerStepId: 'gate-release',
          reason: expect.stringContaining('e2e/integration-workspace-entry.spec.ts'),
        }),
      ]),
    );
  });

  it('fails closed when a removed browser spec no longer writes to the authoritative release UX trace root', () => {
    const sourceTexts = releaseOwnerSources();
    sourceTexts['scripts/backend-real-full-gate.sh'] = sourceTexts['scripts/backend-real-full-gate.sh']
      .replace(
        "UX_TRACE_OUTPUT_ROOT='${AUTHORITATIVE_UX_TRACE_ROOT}' bash scripts/run-integration-e2e-full.sh e2e/integration-workspace-entry.spec.ts",
        "UX_TRACE_OUTPUT_ROOT='${VISUAL_REVIEW_ARTIFACT_DIR}/ux-traces' bash scripts/run-integration-e2e-full.sh e2e/integration-workspace-entry.spec.ts",
      );

    expect(validateReleasePrecheckEvidenceOwnership({ sourceTexts })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movedCheckId: 'browser_product_scenarios',
          ownerStepId: 'gate-release',
          reason: expect.stringContaining('AUTHORITATIVE_UX_TRACE_ROOT'),
        }),
      ]),
    );
  });

  it('fails closed when the release Agent Task chain loses the skills-runtime assertion', () => {
    const sourceTexts = releaseOwnerSources();
    sourceTexts['scripts/run-backend-real-session-shards.sh'] = sourceTexts['scripts/run-backend-real-session-shards.sh']
      .replace(/--skills-runtime/g, '--agent-task-runner');

    expect(validateReleasePrecheckEvidenceOwnership({ sourceTexts })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movedCheckId: 'agent_task_release_checks',
          ownerStepId: 'gate-release',
          reason: expect.stringContaining('--skills-runtime'),
        }),
      ]),
    );
  });

  it('fails closed when mapped formal report paths disappear from release campaign checks', () => {
    const campaign = releaseFullCampaign();
    const brokenCampaign: CurrentVerificationCampaignDefinition = {
      ...campaign,
      steps: campaign.steps.map((step) => step.id === 'lane-unified-deploy-product-flows'
        ? {
          ...step,
          evidenceChecks: step.evidenceChecks.filter(
            (check) => check.id !== 'unified_deploy_product_flow_evidence',
          ),
        }
        : step),
    };

    expect(validateReleasePrecheckEvidenceOwnership(brokenCampaign)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movedCheckId: 'agent_task_release_checks',
          ownerStepId: 'lane-unified-deploy-product-flows',
          reason: expect.stringContaining('missing evidence check unified_deploy_product_flow_evidence'),
        }),
        expect.objectContaining({
          movedCheckId: 'files_runner_business_assertions',
          ownerStepId: 'lane-unified-deploy-product-flows',
          reason: expect.stringContaining('missing evidence check unified_deploy_product_flow_evidence'),
        }),
      ]),
    );
  });
});
