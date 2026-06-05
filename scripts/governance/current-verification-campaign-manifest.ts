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
export type CurrentVerificationCampaignObservationTheme =
  | 'runtime_pending_readiness';
export type CurrentVerificationCampaignObservationBackoff =
  | 'increasing_after_consecutive_non_terminal';
export type CurrentVerificationCampaignRuntimeConvergenceSurface =
  | 'files'
  | 'agent_task_sandbox'
  | 'afscp_workspace_binding'
  | 'read_export';
export type CurrentVerificationCampaignRuntimeConvergenceState =
  | 'pending'
  | 'releasing'
  | 'offline'
  | 'not_found';

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
  expectedTheme?: string;
  expectedCommand?: string;
  expectedProfile?: string;
  expectedProductFlows?: readonly string[];
  expectedProductSmokes?: readonly string[];
}

export interface CurrentVerificationCampaignNativeResult {
  gateId: string;
  npmScript?: string;
  path: string;
}

export interface CurrentVerificationCampaignObservationPolicy {
  theme: CurrentVerificationCampaignObservationTheme;
  backoff: CurrentVerificationCampaignObservationBackoff;
  intervalMs: readonly number[];
  evidenceFocus: readonly string[];
  stateConvergence: Readonly<Record<
    CurrentVerificationCampaignRuntimeConvergenceSurface,
    Readonly<Record<CurrentVerificationCampaignRuntimeConvergenceState, string>>
  >>;
}

export interface CurrentVerificationCampaignStep {
  id: string;
  gateId: string;
  npmScript: string;
  command: string;
  timeoutMs: number;
  workflowRole: CurrentVerificationCampaignStepRole;
  executionMode: CurrentVerificationCampaignExecutionMode;
  resultRequired: boolean;
  evidenceRequired: boolean;
  lineKind: string;
  defaultFailureClass: CurrentVerificationCampaignFailureClass;
  dependsOn: readonly string[];
  evidenceHints: readonly string[];
  evidenceChecks: readonly CurrentVerificationCampaignEvidenceCheck[];
  observationPolicy?: CurrentVerificationCampaignObservationPolicy;
  nativeResult?: CurrentVerificationCampaignNativeResult;
}

export interface CurrentVerificationCampaignDefinition {
  id: CurrentVerificationCampaignId;
  description: string;
  runRootPattern: string;
  steps: readonly CurrentVerificationCampaignStep[];
}

type CurrentReleaseCampaignEvidenceTopologyKey = keyof typeof CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY;

const MINUTE_MS = 60_000;
const CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS = {
  gateFast: 20 * MINUTE_MS,
  gateDefault: 45 * MINUTE_MS,
  laneVisual: 45 * MINUTE_MS,
  gateRelease: 90 * MINUTE_MS,
  gateReleaseFull: 10 * MINUTE_MS,
} as const;

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
    description: 'AgentSmith product-side readiness campaign for local completeness, contracts, and handoff inputs',
    runRootPattern: 'artifacts/release-runs/<campaign-run-id>',
    steps: [
      campaignStep({
        id: 'gate-fast',
        gateId: 'gate-fast',
        timeoutMs: CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS.gateFast,
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
        timeoutMs: CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS.gateDefault,
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
        timeoutMs: CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS.laneVisual,
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
        timeoutMs: CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS.gateRelease,
        workflowRole: 'evidence_owner',
        executionMode: 'execute',
        resultRequired: true,
        evidenceRequired: true,
        lineKind: 'release_backend_real',
        defaultFailureClass: 'infra_setup_failure',
        dependsOn: ['gate-default'],
        evidenceHints: findCurrentGateDefinitionById('gate-release')?.campaignEvidenceArtifacts ?? [],
        evidenceChecks: campaignEvidenceChecks('gateRelease'),
        observationPolicy: {
          theme: 'runtime_pending_readiness',
          backoff: 'increasing_after_consecutive_non_terminal',
          intervalMs: [
            60 * 1_000,
            90 * 1_000,
            120 * 1_000,
            180 * 1_000,
            300 * 1_000,
          ],
          evidenceFocus: [
            'Files restore continuation focused backend-real gate',
            'AGENT_SANDBOX_UNAVAILABLE API/pod-manager/ASBCP summaries',
            'runtime flake versus stability blocker classification',
          ],
          stateConvergence: {
            files: {
              pending: 'Return typed file_library_list_pending, continue runtime-access release convergence, and recheck without reading a stale projection.',
              releasing: 'Wait for workspace binding release convergence before creating a read export; return typed pending while release is non-terminal.',
              offline: 'Treat as no active writer for Files read export and create or read the clean read export through the Files path only.',
              not_found: 'Treat as no active writer for Files read export; do not synthesize an executable connector.',
            },
            agent_task_sandbox: {
              pending: 'Continue bounded ASBCP status checks until Running, Failed, or timeout.',
              releasing: 'Wait for workload release or surface a typed release-incomplete error; do not start a second task HOME holder.',
              offline: 'Call ASBCP create-or-ensure for the workload, then continue status checks until Running, Failed, or timeout.',
              not_found: 'Call ASBCP create-or-ensure for the workload, then continue status checks until Running, Failed, or timeout.',
            },
            afscp_workspace_binding: {
              pending: 'Return typed runtime readiness pending and recheck through the workspace binding owner before Files read export proceeds.',
              releasing: 'Continue release convergence through the workspace binding owner until terminal released/revoked/expired/deleted.',
              offline: 'Treat as no active writer for Files read export; executable attachment must use the Agent Task sandbox owner path.',
              not_found: 'Treat as no active writer for Files read export; executable attachment must use the Agent Task sandbox owner path.',
            },
            read_export: {
              pending: 'Return typed pending, trigger or continue runtime-access release, and keep the pending read export warm for the caller next poll.',
              releasing: 'Wait for runtime release fence or export invalidation, and avoid revoke/create loops while convergence is non-terminal.',
              offline: 'Create or reuse the read export only after no active writer is observed.',
              not_found: 'Create a fresh read export if runtime access is clean; otherwise return typed pending.',
            },
          },
        },
        nativeResult: {
          gateId: 'lane-backend-real-release',
          npmScript: 'lane:backend-real:release',
          path: '<campaign-root>/gate-release/native/result.json',
        },
      }),
      campaignStep({
        id: 'gate-release-full',
        gateId: 'gate-release-full',
        timeoutMs: CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS.gateReleaseFull,
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
