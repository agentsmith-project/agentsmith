import {
  CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY,
  CURRENT_RELEASE_FULL_CAMPAIGN_EVIDENCE_ARTIFACTS,
  findCurrentGateDefinitionById,
} from './current-gate-manifest';

export type CurrentVerificationCampaignId = 'release-full';
export type CurrentVerificationCampaignStepRole =
  | 'preflight'
  | 'diagnostic'
  | 'evidence_owner'
  | 'terminal_verdict';
export type CurrentVerificationCampaignExecutionMode = 'execute' | 'aggregate_only';
export type CurrentVerificationCampaignFailureClass =
  | 'product_regression'
  | 'infra_setup_failure'
  | 'environment_conflict'
  | 'contract_drift'
  | 'evidence_missing';
export type CurrentVerificationCampaignEvidenceCheckKind =
  | 'file'
  | 'directory'
  | 'directory_non_empty'
  | 'recursive_file'
  | 'visual_baseline_automated_passes'
  | 'visual_run_manifest'
  | 'visual_baseline_reviews';
export type CurrentVerificationCampaignEvidenceSemantic =
  | 'unified_deploy_evidence'
  | 'ux_trace_bundle';

export interface CurrentVerificationCampaignEvidenceCheck {
  id: string;
  path: string;
  kind: CurrentVerificationCampaignEvidenceCheckKind;
  fileName?: string;
  minCount?: number;
  semantic?: CurrentVerificationCampaignEvidenceSemantic;
  expectedSchemaVersion?: string;
  expectedProducer?: string;
  expectedStatus?: string;
  expectedCommand?: string;
  expectedProfile?: string;
  expectedProductFlows?: readonly string[];
}

export interface CurrentVerificationCampaignNativeResult {
  gateId: string;
  npmScript?: string;
  path: string;
}

export interface CurrentVerificationCampaignStep {
  id: string;
  gateId: string;
  npmScript: string;
  command: string;
  workflowRole: CurrentVerificationCampaignStepRole;
  executionMode: CurrentVerificationCampaignExecutionMode;
  resultRequired: boolean;
  evidenceRequired: boolean;
  lineKind: string;
  defaultFailureClass: CurrentVerificationCampaignFailureClass;
  dependsOn: readonly string[];
  evidenceHints: readonly string[];
  evidenceChecks: readonly CurrentVerificationCampaignEvidenceCheck[];
  nativeResult?: CurrentVerificationCampaignNativeResult;
}

export interface CurrentVerificationCampaignDefinition {
  id: CurrentVerificationCampaignId;
  description: string;
  runRootPattern: string;
  steps: readonly CurrentVerificationCampaignStep[];
}

type CurrentReleaseCampaignEvidenceTopologyKey = keyof typeof CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY;

function campaignEvidenceChecks(
  key: CurrentReleaseCampaignEvidenceTopologyKey,
): readonly CurrentVerificationCampaignEvidenceCheck[] {
  return CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY[key].map((check) => ({
    ...check,
    ...(check.id === 'backend_real_ux_trace_reviews'
      ? { semantic: 'ux_trace_bundle' as const }
      : {}),
  }));
}

function campaignStep(
  step: Omit<CurrentVerificationCampaignStep, 'npmScript' | 'command'>,
): CurrentVerificationCampaignStep {
  const definition = findCurrentGateDefinitionById(step.gateId);
  if (!definition) {
    throw new Error(`Unknown current gate id in verification campaign: ${step.gateId}`);
  }

  return {
    ...step,
    npmScript: definition.npmScript,
    command: `npm run ${definition.npmScript}`,
  };
}

export const CURRENT_VERIFICATION_CAMPAIGN_MANIFEST: readonly CurrentVerificationCampaignDefinition[] = [
  {
    id: 'release-full',
    description: 'release-grade automated verification campaign with one terminal aggregate verdict',
    runRootPattern: 'artifacts/release-runs/<campaign-run-id>',
    steps: [
      campaignStep({
        id: 'gate-fast',
        gateId: 'gate-fast',
        workflowRole: 'preflight',
        executionMode: 'execute',
        resultRequired: true,
        evidenceRequired: false,
        lineKind: 'release_campaign_preflight',
        defaultFailureClass: 'product_regression',
        dependsOn: [],
        evidenceHints: [],
        evidenceChecks: [],
      }),
      campaignStep({
        id: 'gate-default',
        gateId: 'gate-default',
        workflowRole: 'preflight',
        executionMode: 'execute',
        resultRequired: true,
        evidenceRequired: false,
        lineKind: 'release_campaign_default',
        defaultFailureClass: 'product_regression',
        dependsOn: ['gate-fast'],
        evidenceHints: [],
        evidenceChecks: [],
      }),
      campaignStep({
        id: 'lane-visual',
        gateId: 'lane-visual',
        workflowRole: 'evidence_owner',
        executionMode: 'execute',
        resultRequired: true,
        evidenceRequired: true,
        lineKind: 'visual',
        defaultFailureClass: 'product_regression',
        dependsOn: ['gate-fast'],
        evidenceHints: findCurrentGateDefinitionById('lane-visual')?.campaignEvidenceArtifacts ?? [],
        evidenceChecks: campaignEvidenceChecks('laneVisual'),
        nativeResult: {
          gateId: 'lane-visual',
          npmScript: 'lane:visual',
          path: '<campaign-root>/lane-visual/native/result.json',
        },
      }),
      campaignStep({
        id: 'gate-release',
        gateId: 'gate-release',
        workflowRole: 'evidence_owner',
        executionMode: 'execute',
        resultRequired: true,
        evidenceRequired: true,
        lineKind: 'release_backend_real',
        defaultFailureClass: 'infra_setup_failure',
        dependsOn: ['gate-default'],
        evidenceHints: findCurrentGateDefinitionById('gate-release')?.campaignEvidenceArtifacts ?? [],
        evidenceChecks: campaignEvidenceChecks('gateRelease'),
        nativeResult: {
          gateId: 'lane-backend-real-release',
          npmScript: 'lane:backend-real:release',
          path: '<campaign-root>/gate-release/native/result.json',
        },
      }),
      campaignStep({
        id: 'gate-release-full',
        gateId: 'gate-release-full',
        workflowRole: 'terminal_verdict',
        executionMode: 'aggregate_only',
        resultRequired: true,
        evidenceRequired: true,
        lineKind: 'release_full_verdict',
        defaultFailureClass: 'evidence_missing',
        dependsOn: [
          'gate-fast',
          'gate-default',
          'lane-visual',
          'gate-release',
        ],
        evidenceHints: CURRENT_RELEASE_FULL_CAMPAIGN_EVIDENCE_ARTIFACTS,
        evidenceChecks: [
          {
            id: 'campaign_root',
            path: '<campaign-root>',
            kind: 'directory',
          },
        ],
      }),
    ],
  },
] as const;

export function listCurrentVerificationCampaigns(): readonly CurrentVerificationCampaignDefinition[] {
  return CURRENT_VERIFICATION_CAMPAIGN_MANIFEST;
}

export function findCurrentVerificationCampaignById(
  id: string,
): CurrentVerificationCampaignDefinition | undefined {
  return CURRENT_VERIFICATION_CAMPAIGN_MANIFEST.find((campaign) => campaign.id === id);
}
