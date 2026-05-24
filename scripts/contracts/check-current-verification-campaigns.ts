import { readFileSync } from 'node:fs';
import path from 'node:path';

import { findCurrentGateDefinitionById } from '../governance/current-gate-manifest';
import {
  CURRENT_VERIFICATION_CAMPAIGN_MANIFEST,
  findCurrentVerificationCampaignById,
} from '../governance/current-verification-campaign-manifest';

const rootDir = process.cwd();

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(rootDir, relativePath), 'utf8')) as unknown;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const packageJson = readJson('package.json') as { scripts?: Record<string, string> };
const releaseCampaignIo = readFileSync(path.join(rootDir, 'scripts/governance/release-campaign-io.ts'), 'utf8');

function main(): void {
  assert(CURRENT_VERIFICATION_CAMPAIGN_MANIFEST.length > 0, 'Expected current verification campaign manifest to be populated.');

  const campaignIds = new Set<string>();
  for (const campaign of CURRENT_VERIFICATION_CAMPAIGN_MANIFEST) {
    assert(!campaignIds.has(campaign.id), `Duplicate verification campaign id: ${campaign.id}`);
    campaignIds.add(campaign.id);

    const stepIds = new Set<string>();
    for (const step of campaign.steps) {
      assert(!stepIds.has(step.id), `Duplicate step id in ${campaign.id}: ${step.id}`);
      stepIds.add(step.id);
      const gate = findCurrentGateDefinitionById(step.gateId);
      assert(gate, `Campaign ${campaign.id} references unknown gate id: ${step.gateId}`);
      assert(step.npmScript === gate.npmScript, `Campaign ${campaign.id}/${step.id} npmScript drifted from gate manifest.`);
      assert(step.command === `npm run ${gate.npmScript}`, `Campaign ${campaign.id}/${step.id} command must be derived from npmScript.`);
      assert(packageJson.scripts?.[step.npmScript], `package.json is missing campaign step npm script: ${step.npmScript}`);
      for (const dependency of step.dependsOn) {
        assert(stepIds.has(dependency), `Campaign ${campaign.id}/${step.id} depends on a later or missing step: ${dependency}`);
      }
    }
  }

  const releaseFull = findCurrentVerificationCampaignById('release-full');
  assert(releaseFull, 'Missing release-full verification campaign.');
  assert(
    releaseFull.steps.map((step) => step.id).join(',') === [
      'gate-fast',
      'gate-default',
      'lane-visual',
      'gate-release',
      'gate-release-full',
    ].join(','),
    'release-full campaign step order drifted.',
  );
  const unifiedDeploySteps = releaseFull.steps.filter((step) => step.id.startsWith('lane-unified-deploy-'));
  assert(
    unifiedDeploySteps.length === 0,
    'release-full campaign must not execute unified deploy lanes; keep them as focused diagnostics only.',
  );
  const terminalStep = releaseFull.steps.at(-1);
  assert(terminalStep?.id === 'gate-release-full', 'release-full terminal step must be gate-release-full.');
  assert(terminalStep.executionMode === 'aggregate_only', 'gate-release-full campaign step must be aggregate-only.');
  assert(terminalStep.workflowRole === 'terminal_verdict', 'gate-release-full campaign step must be terminal_verdict.');
  assert(terminalStep.evidenceChecks.length > 0, 'gate-release-full must declare aggregate evidence checks.');
  assert(
    terminalStep.dependsOn.includes('lane-visual') && terminalStep.dependsOn.includes('gate-release'),
    'gate-release-full must aggregate both lane-visual and gate-release evidence.',
  );
  assert(
    !terminalStep.dependsOn.some((stepId) => stepId.startsWith('lane-unified-deploy-')),
    'gate-release-full must not depend on unified deploy lanes.',
  );
  for (const step of releaseFull.steps.filter((candidate) => candidate.workflowRole === 'evidence_owner')) {
    assert(step.nativeResult, `${step.id} must declare its native result contract.`);
    assert(step.nativeResult.path.includes('<campaign-root>'), `${step.id} native result path must be campaign-scoped.`);
    assert(step.evidenceChecks.length > 0, `${step.id} must declare concrete evidence checks.`);
  }
  const visualStep = releaseFull.steps.find((step) => step.id === 'lane-visual');
  assert(visualStep?.workflowRole === 'evidence_owner', 'lane-visual must stay a release evidence owner.');
  assert(visualStep.evidenceRequired, 'lane-visual release evidence must stay required.');
  assert(
    visualStep?.evidenceChecks.some((check) => check.kind === 'visual_baseline_automated_passes'),
    'lane-visual campaign step must require visual baseline automated-pass artifacts.',
  );
  const gateReleaseStep = releaseFull.steps.find((step) => step.id === 'gate-release');
  assert(
    gateReleaseStep?.dependsOn.join(',') === 'gate-default',
    'gate-release must depend only on gate-default; visual evidence is aggregated by gate-release-full.',
  );
  assert(
    gateReleaseStep?.evidenceChecks.some((check) => check.path.includes('backend-real-visual/review.md')),
    'gate-release campaign step must require the backend-real visual review summary.',
  );
  assert(
    gateReleaseStep?.evidenceChecks.some((check) => check.kind === 'recursive_file' && check.fileName === 'review.md'),
    'gate-release campaign step must require backend-real ux trace review bundles.',
  );
  assert(packageJson.scripts?.['release:campaign:full'], 'package.json is missing release:campaign:full.');
  assert(
    releaseCampaignIo.includes('RELEASE_CAMPAIGN_USE_LATEST') && releaseCampaignIo.includes('only for diagnostics'),
    'gate:release:full must not consume the latest release run unless diagnostic latest mode is explicit.',
  );
}

main();
