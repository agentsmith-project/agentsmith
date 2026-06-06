import { readFileSync } from 'node:fs';
import path from 'node:path';

import { findCurrentGateDefinitionById } from '../governance/current-gate-manifest';
import {
  CURRENT_VERIFICATION_CAMPAIGN_MANIFEST,
  currentObservationWaitSchedule,
  findCurrentVerificationCampaignById,
} from '../governance/current-verification-campaign-manifest';

const rootDir = process.cwd();
const RUNTIME_READINESS_SURFACES = [
  'files',
  'agent_task_sandbox',
  'afscp_workspace_binding',
  'read_export',
] as const;
const RUNTIME_READINESS_STATES = [
  'pending',
  'releasing',
  'offline',
  'not_found',
] as const;

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(rootDir, relativePath), 'utf8')) as unknown;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertStringField(
  record: Record<string, unknown>,
  field: string,
  message: string,
): asserts record is Record<string, string> {
  assert(typeof record[field] === 'string' && record[field].trim().length > 0, message);
}

const packageJson = readJson('package.json') as { scripts?: Record<string, string> };
const releaseCampaignIo = readFileSync(path.join(rootDir, 'scripts/governance/release-campaign-io.ts'), 'utf8');
const runtimeReadinessPolicy = readJson('scripts/governance/runtime-readiness-policy.json');

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
      assert(Number.isSafeInteger(step.timeoutMs) && step.timeoutMs > 0, `Campaign ${campaign.id}/${step.id} must define a positive timeoutMs.`);
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
    'gate-release-full must aggregate both lane-visual and gate-release product readiness evidence.',
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
  assert(visualStep?.workflowRole === 'evidence_owner', 'lane-visual must stay a product readiness evidence owner.');
  assert(visualStep.evidenceRequired, 'lane-visual product readiness evidence must stay required.');
  assert(
    visualStep?.evidenceChecks.some((check) => check.kind === 'visual_baseline_automated_passes'),
    'lane-visual campaign step must require visual baseline automated-pass artifacts.',
  );
  const gateReleaseStep = releaseFull.steps.find((step) => step.id === 'gate-release');
  assert(
    gateReleaseStep?.dependsOn.join(',') === 'gate-default',
    'gate-release must depend only on gate-default; visual evidence is aggregated by gate-release-full.',
  );
  assert(gateReleaseStep.observationPolicy, 'gate-release must carry runtime pending/readiness observation policy.');
  assert(
    gateReleaseStep.observationPolicy.theme === 'runtime_pending_readiness',
    'gate-release observation policy must classify repeated release/backend-real waits as runtime pending/readiness.',
  );
  assert(
    gateReleaseStep.observationPolicy.backoff === 'increasing_after_consecutive_non_terminal',
    'gate-release observation policy must use increasing waits after consecutive non-terminal checks.',
  );
  assert(
    currentObservationWaitSchedule(gateReleaseStep.observationPolicy, 4).join(',') !== [
      60_000,
      60_000,
      60_000,
      60_000,
    ].join(','),
    'gate-release observation policy must not drift back to fixed one-minute polling.',
  );
  assert(isRecord(runtimeReadinessPolicy), 'runtime readiness policy JSON must be an object.');
  assert(
    JSON.stringify(gateReleaseStep.observationPolicy.intervalMs) === JSON.stringify(runtimeReadinessPolicy.interval_ms),
    'gate-release observation wait intervals must match scripts/governance/runtime-readiness-policy.json.',
  );
  assert(
    gateReleaseStep.observationPolicy.evidenceFocus.includes('Files restore continuation focused backend-real gate')
      && gateReleaseStep.observationPolicy.evidenceFocus.includes('AGENT_SANDBOX_UNAVAILABLE API/pod-manager/ASBCP summaries')
      && gateReleaseStep.observationPolicy.evidenceFocus.includes('runtime flake versus stability blocker classification'),
    'gate-release runtime readiness evidence focus must preserve Files restore continuation, sandbox-unavailable summaries, and flake/blocker classification.',
  );
  for (const surface of RUNTIME_READINESS_SURFACES) {
    const convergence = gateReleaseStep.observationPolicy.stateConvergence[surface];
    assert(convergence, `runtime readiness convergence must cover ${surface}.`);
    for (const state of RUNTIME_READINESS_STATES) {
      assert(
        typeof convergence[state] === 'string' && convergence[state].trim().length > 0,
        `runtime readiness convergence must define ${surface}.${state}.`,
      );
    }
  }
  const classificationRules = runtimeReadinessPolicy.classification_rules;
  assert(isRecord(classificationRules), 'runtime readiness policy must define classification_rules.');
  for (const field of ['clean_pass', 'runtime_flake', 'stability_blocker']) {
    assertStringField(
      classificationRules,
      field,
      `runtime readiness classification_rules must define ${field}.`,
    );
  }
  assert(
    classificationRules.runtime_flake.includes('passed on rerun')
      && classificationRules.stability_blocker.includes('consecutive'),
    'runtime readiness classification rules must keep first-pass-rerun as runtime_flake and consecutive failures as stability_blocker.',
  );
  assert(
    gateReleaseStep?.evidenceChecks.some((check) => check.path.includes('backend-real-visual/review.md')),
    'gate-release campaign step must require the backend-real visual review summary.',
  );
  assert(
    gateReleaseStep.evidenceChecks.some((check) =>
      check.id === 'files_restore_continuation_runtime_readiness_details'
      && check.path === '<campaign-root>/gate-release/child-internal-evidence/files_restore_continuation_spec/runtime-readiness-details.json'
      && check.expectedSchemaVersion === 'agentsmith.runtime-readiness-details/v1'
      && check.expectedTheme === 'runtime_pending_readiness',
    ),
    'gate-release must require Files restore continuation runtime readiness details before Product Readiness.',
  );
  assert(
    gateReleaseStep?.evidenceChecks.some((check) => check.kind === 'recursive_file' && check.fileName === 'review.md'),
    'gate-release campaign step must require backend-real ux trace review bundles.',
  );
  const releaseFullTimeoutTotalMs = releaseFull.steps.reduce((total, step) => total + step.timeoutMs, 0);
  assert(
    releaseFullTimeoutTotalMs < 240 * 60 * 1000,
    'release-full campaign step timeouts must fail before the GitHub product readiness job timeout.',
  );
  assert(packageJson.scripts?.['release:campaign:full'], 'package.json is missing release:campaign:full.');
  assert(
    releaseCampaignIo.includes('RELEASE_CAMPAIGN_USE_LATEST') && releaseCampaignIo.includes('only for diagnostics'),
    'gate:release:full must not consume the latest release run unless diagnostic latest mode is explicit.',
  );
}

main();
