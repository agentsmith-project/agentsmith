import {
  findCurrentGateDefinition,
  findCurrentGateDefinitionById,
  listCurrentGateDefinitions,
  type CurrentGateRequirement,
  type CurrentGateStoryEvidenceKind,
  type CurrentGateStoryEvidencePolicy,
} from './current-gate-manifest';
import { findCurrentResourceLockById } from './current-resource-lock-manifest';
import { listCurrentRuntimeLines } from './current-runtime-line-manifest';

export const CURRENT_WORKFLOW_TOP_LEVEL_TERMS = [
  '环境',
  '测试',
  '门禁',
  '验证通道',
  '发布',
] as const;

export type CurrentWorkflowTopLevelTerm = (typeof CURRENT_WORKFLOW_TOP_LEVEL_TERMS)[number];

export interface CurrentWorkflowCommand {
  command: string;
  description: string;
  canonical: 'npm' | 'make';
  makeTarget?: string;
  npmScript?: string;
  gateId?: string;
  recommended?: boolean;
  quickHuman?: boolean;
  workflowRole: CurrentWorkflowRole;
  storyEvidencePolicy: CurrentGateStoryEvidencePolicy;
  storyEvidenceKinds: readonly CurrentGateStoryEvidenceKind[];
  storyEvidenceArtifacts: readonly string[];
  storyEvidenceRequiredFor: readonly CurrentGateRequirement[];
}

export interface CurrentWorkflowSection {
  id: string;
  title: CurrentWorkflowTopLevelTerm;
  commands: CurrentWorkflowCommand[];
}

export const CURRENT_WORKFLOW_ROLES = [
  'environment_setup',
  'diagnostic',
  'diagnostic_lane',
  'evidence_lane',
  'gate_verdict',
  'terminal_gate_verdict',
  'release_operation',
] as const;

export type CurrentWorkflowRole = (typeof CURRENT_WORKFLOW_ROLES)[number];

export const CURRENT_WORKFLOW_ENTRY_PATH_IDS = ['ui_only', 'local_manual', 'release_grade'] as const;

export type CurrentWorkflowEntryPathId = (typeof CURRENT_WORKFLOW_ENTRY_PATH_IDS)[number];

export interface CurrentWorkflowEntryPath {
  id: CurrentWorkflowEntryPathId;
  label: string;
  whenToUse: string;
  startCommands: readonly string[];
  docs: readonly string[];
  avoid: readonly string[];
}

export const CURRENT_WORKFLOW_GLOSSARY_TERMS = [
  'e2e',
  'lane',
  'gate',
  'campaign',
  'diagnostic',
  'verdict',
] as const;

export type CurrentWorkflowGlossaryTermId = (typeof CURRENT_WORKFLOW_GLOSSARY_TERMS)[number];

export interface CurrentWorkflowGlossaryTerm {
  term: CurrentWorkflowGlossaryTermId;
  plainLanguage: string;
  currentMeaning: string;
  doNotConfuseWith: string;
}

type CurrentWorkflowDiagnosticCommandBase = {
  id: string;
  npmScript?: string;
  gateId?: string;
  workflowRole: Extract<CurrentWorkflowRole, 'diagnostic' | 'diagnostic_lane'>;
  whenToUse: string;
  nextStep: string;
};

export type CurrentWorkflowDiagnosticCommand = CurrentWorkflowDiagnosticCommandBase & (
  | {
      command: string;
      internalAdapter?: never;
      ownerSurface?: never;
    }
  | {
      command?: never;
      internalAdapter: string;
      ownerSurface: string;
    }
);

export type CurrentGovernanceEvidenceAuthority = 'campaign' | 'standalone_diagnostic';
export type CurrentGovernanceDependencyPurpose =
  | 'dependency_startup'
  | 'dependency_readiness'
  | 'combined_bootstrap';

export interface CurrentGovernancePublicHumanEntrypoint {
  command: string;
  source: string;
  description: string;
}

export interface CurrentGovernanceInternalAdapter {
  commandOrAdapter: string;
  workflowRole: CurrentWorkflowRole;
  source: string;
  note: string;
}

export interface CurrentGovernanceEvidenceAuthorityRoot {
  path: string;
  authority: CurrentGovernanceEvidenceAuthority;
  source: string;
}

export interface CurrentGovernanceRunLocalStateRoot {
  path: string;
  source: string;
  note: string;
}

export interface CurrentGovernanceCleanupOwnershipProof {
  command: string;
  ownershipProof: string;
  note: string;
}

export interface CurrentGovernanceDependencyCaller {
  path: string;
  caller: string;
  calls: readonly string[];
  purpose: CurrentGovernanceDependencyPurpose;
  note: string;
}

export interface CurrentGovernanceIntentionalDuplicateSafetyCheck {
  id: string;
  where: string;
  whyNotWaste: string;
}

export interface CurrentGovernanceSurfaceInventory {
  publicHumanEntrypoints: readonly CurrentGovernancePublicHumanEntrypoint[];
  internalAdaptersAndOwnerDiagnostics: readonly CurrentGovernanceInternalAdapter[];
  evidenceAuthorityRoots: readonly CurrentGovernanceEvidenceAuthorityRoot[];
  runLocalStateRoots: readonly CurrentGovernanceRunLocalStateRoot[];
  cleanupCommandsAndOwnershipProofs: readonly CurrentGovernanceCleanupOwnershipProof[];
  dependencyStartupReadinessCallers: readonly CurrentGovernanceDependencyCaller[];
  intentionalDuplicateSafetyChecks: readonly CurrentGovernanceIntentionalDuplicateSafetyCheck[];
}

export const CURRENT_CI_WORKFLOW_ROLES = [
  'quality_gate',
  'contract_gate',
  'backend_real_regression',
  'integration_e2e',
  'release_artifact_producer',
] as const;

export type CurrentCIWorkflowRole = (typeof CURRENT_CI_WORKFLOW_ROLES)[number];

export const CURRENT_CI_WORKFLOW_JOB_ROLES = [
  'gate_verdict',
  'contract_gate',
  'backend_real_lane',
  'visual_lane',
  'integration_lane',
  'artifact_producer',
] as const;

export type CurrentCIWorkflowJobRole = (typeof CURRENT_CI_WORKFLOW_JOB_ROLES)[number];

export const CURRENT_CI_WORKFLOW_TRIGGERS = [
  'pull_request',
  'push',
  'schedule',
  'workflow_dispatch',
] as const;

export type CurrentCIWorkflowTrigger = (typeof CURRENT_CI_WORKFLOW_TRIGGERS)[number];

export const CURRENT_CI_WORKFLOW_BLOCKING_SCOPES = [
  'pull_request',
  'push',
  'manual',
  'scheduled',
  'release',
] as const;

export type CurrentCIWorkflowBlockingScope = (typeof CURRENT_CI_WORKFLOW_BLOCKING_SCOPES)[number];

export const CURRENT_CI_WORKFLOW_EVIDENCE_FAMILIES = [
  'backend_real_current_state',
  'backend_real_run',
  'governance_report',
  'image_publish_handoff',
  'integration_log',
  'mock_lane_run',
  'playwright_report',
  'release_contract_artifact',
  'runner_contract_artifact',
  'test_results',
  'visual_baseline_review',
] as const;

export type CurrentCIWorkflowEvidenceFamily = (typeof CURRENT_CI_WORKFLOW_EVIDENCE_FAMILIES)[number];

export interface CurrentCIWorkflowJob {
  workflowPath: string;
  workflowName: string;
  id: string;
  role: CurrentCIWorkflowJobRole;
  gateId?: string;
  laneId?: string;
  commands: readonly string[];
  triggers: readonly CurrentCIWorkflowTrigger[];
  requiredSecrets: readonly string[];
  requiresSecrets: boolean;
  evidenceRequired: boolean;
  evidenceFamilies: readonly CurrentCIWorkflowEvidenceFamily[];
  artifactPaths: readonly string[];
  blockingFor: readonly CurrentCIWorkflowBlockingScope[];
  scheduled: boolean;
  releaseBlocking: boolean;
  notes?: string;
}

export interface CurrentCIWorkflowDefinition {
  path: string;
  workflowName: string;
  role: CurrentCIWorkflowRole;
  triggers: readonly CurrentCIWorkflowTrigger[];
  jobs: readonly CurrentCIWorkflowJob[];
  blockingFor: readonly CurrentCIWorkflowBlockingScope[];
  scheduled: boolean;
  releaseBlocking: boolean;
}

export const CURRENT_WORKFLOW_DOCUMENT_FILES = [
  'README.md',
  'DEVELOPMENT.md',
  'Makefile',
  'docs/CURRENT_BASELINE.md',
  'docs/README.md',
  'docs/current-engineering-governance-model.md',
  'docs/contracts/current-gate-manifest-contract.md',
  'docs/contracts/current-gate-result-schema-contract.md',
  'docs/user-guides/README.md',
  'docs/user-guides/release-readiness-checklist.md',
  'docs/testing/README.md',
  'docs/testing/diagnostic-catalog-v1.md',
  'docs/testing/story-source-of-truth-and-generated-specs.md',
  'docs/testing/verification-campaigns-v1.md',
  'docs/testing/visual-baseline-policy-v1.md',
  '.github/workflows/quality-gates.yml',
  '.github/workflows/contracts-check.yml',
  '.github/workflows/engineering-gate.yml',
  '.github/workflows/image-publish.yml',
  '.github/workflows/integration-e2e.yml',
  '.github/workflows/release-contract-artifact.yml',
  '.github/workflows/runner-contract-artifact.yml',
  'scripts/contracts/check-current-workflows.ts',
  'scripts/contracts/check-current-gates.ts',
  'scripts/contracts/check-engineering-governance.ts',
  'scripts/governance/current-workflow-manifest.ts',
  'scripts/governance/current-gate-manifest.ts',
] as const;

type RawCurrentWorkflowCommand = Omit<
  CurrentWorkflowCommand,
  | 'workflowRole'
  | 'storyEvidencePolicy'
  | 'storyEvidenceKinds'
  | 'storyEvidenceArtifacts'
  | 'storyEvidenceRequiredFor'
> &
  Partial<
    Pick<
      CurrentWorkflowCommand,
      | 'workflowRole'
      | 'storyEvidencePolicy'
      | 'storyEvidenceKinds'
      | 'storyEvidenceArtifacts'
      | 'storyEvidenceRequiredFor'
    >
  >;

type RawCurrentWorkflowSection = {
  id: string;
  title: CurrentWorkflowTopLevelTerm;
  commands: RawCurrentWorkflowCommand[];
};

type RawCurrentCIWorkflowJob = Omit<
  CurrentCIWorkflowJob,
  'workflowPath' | 'workflowName' | 'triggers'
> &
  Partial<Pick<CurrentCIWorkflowJob, 'triggers'>>;

type RawCurrentCIWorkflowDefinition = Omit<CurrentCIWorkflowDefinition, 'jobs'> & {
  jobs: readonly RawCurrentCIWorkflowJob[];
};

function defaultWorkflowRole(sectionId: string, command: RawCurrentWorkflowCommand): CurrentWorkflowRole {
  switch (sectionId) {
    case 'environment':
      return 'environment_setup';
    case 'test':
      return 'diagnostic';
    case 'gate':
      return command.npmScript === 'gate:release:full' ? 'terminal_gate_verdict' : 'gate_verdict';
    case 'lane':
      return command.npmScript === 'lane:mock' ? 'diagnostic_lane' : 'evidence_lane';
    case 'release':
      return 'release_operation';
    default:
      return 'diagnostic';
  }
}

function hydrateCurrentWorkflowCommand(
  sectionId: string,
  command: RawCurrentWorkflowCommand,
): CurrentWorkflowCommand {
  const storyEvidence = command.gateId
    ? findCurrentGateDefinitionById(command.gateId)
    : command.npmScript
      ? findCurrentGateDefinition(command.npmScript)
      : undefined;

  return {
    workflowRole: defaultWorkflowRole(sectionId, command),
    storyEvidencePolicy: 'none',
    storyEvidenceKinds: [],
    storyEvidenceArtifacts: [],
    storyEvidenceRequiredFor: [],
    ...command,
    ...(storyEvidence
      ? {
          storyEvidencePolicy: storyEvidence.storyEvidencePolicy,
          storyEvidenceKinds: storyEvidence.storyEvidenceKinds,
          storyEvidenceArtifacts: storyEvidence.storyEvidenceArtifacts,
          storyEvidenceRequiredFor: storyEvidence.storyEvidenceRequiredFor,
        }
      : {}),
  };
}

function defineCurrentCIWorkflow(definition: RawCurrentCIWorkflowDefinition): CurrentCIWorkflowDefinition {
  return {
    ...definition,
    jobs: definition.jobs.map((job) => ({
      workflowPath: definition.path,
      workflowName: definition.workflowName,
      triggers: definition.triggers,
      ...job,
    })),
  };
}

export const CURRENT_WORKFLOW_ENTRY_PATHS: readonly CurrentWorkflowEntryPath[] = [
  {
    id: 'ui_only',
    label: 'UI only',
    whenToUse: '只改前端页面、交互、文案，暂时不需要真实后端或 notebook / runner 主链。',
    startCommands: ['npm run dev', 'npm run verify'],
    docs: ['README.md', 'DEVELOPMENT.md', 'docs/testing/diagnostic-catalog-v1.md'],
    avoid: ['不要把 `npm run dev` 当成产品侧 readiness 结论。', '不要直接跳到 `gate:release:full`。'],
  },
  {
    id: 'local_manual',
    label: 'Local manual',
    whenToUse: '要验证真实本地 API / Web / notebook / runner 行为，或者要复现 local-manual 路径问题。',
    startCommands: ['make local-real-up', 'make local-real-status'],
    docs: [
      'DEVELOPMENT.md',
      'docs/user-guides/local-runtime-flows.md',
      'docs/testing/diagnostic-catalog-v1.md',
    ],
    avoid: ['不要和其他本地工作线并发混跑。', '不要把 local-manual 手测结果当成 gate verdict。'],
  },
  {
    id: 'release_grade',
    label: 'Release grade',
    whenToUse: '准备收口大改动、发布前产品侧 readiness 复核、或者 incident 修复后的跨层复验。',
    startCommands: [
      'npm run release:ready',
      'npm run release:status',
    ],
    docs: [
      'docs/testing/verification-campaigns-v1.md',
      'docs/user-guides/release-readiness-checklist.md',
      'docs/user-guides/unified-deploy-operations.md',
      'docs/contracts/current-gate-manifest-contract.md',
    ],
    avoid: [
      '不要用 focused test 代替最终 verdict。',
      '不要跳过 visual / product readiness evidence owners。',
      '不要直接把 `gate:release:full` 当 release 执行入口；它只做显式 campaign context 下的聚合复核。',
    ],
  },
] as const;

export const CURRENT_WORKFLOW_GLOSSARY: readonly CurrentWorkflowGlossaryTerm[] = [
  {
    term: 'e2e',
    plainLanguage: '从用户视角走完整交互链路的测试手段。',
    currentMeaning: '在当前仓库里，e2e 是一种测试方法，常见实现是 Playwright。',
    doNotConfuseWith: 'e2e 不是 gate，也不是 lane；它回答的是“怎么测”，不是“谁给 verdict”。',
  },
  {
    term: 'lane',
    plainLanguage: '一条独立的验证通道。',
    currentMeaning: 'lane 定义的是在哪条真相路径下验证，例如 mock、full visual、backend-real；unified deploy lanes 仅保留为 transition-only focused diagnostics / 过渡期专项诊断。',
    doNotConfuseWith: 'lane 可以运行 e2e，但 lane 本身不是测试技术，也不天然等于最终 verdict。',
  },
  {
    term: 'gate',
    plainLanguage: '一个带通过标准的工程验收口。',
    currentMeaning: 'gate 负责给出某一层是否通过的正式判断，稳定 identity 统一看 current-gate-manifest 里的 id。',
    doNotConfuseWith: 'gate 不是某一个 spec，也不是自由命名的 shell 命令别名。',
  },
  {
    term: 'campaign',
    plainLanguage: '围绕一个目标组织起来的一组验证动作。',
    currentMeaning: 'campaign 用来组织产品侧 readiness 或 incident 后复验这类多步骤动作，它消费 gate/lane 真相，而不是发明第二套 truth。',
    doNotConfuseWith: 'campaign 不是新的 gate id，也不是 story truth source。',
  },
  {
    term: 'diagnostic',
    plainLanguage: '用来定位问题、缩小范围的路径。',
    currentMeaning: 'diagnostic command 主要帮助排查，不直接替代最终 gate verdict。',
    doNotConfuseWith: 'diagnostic 通过不等于 release ready。',
  },
  {
    term: 'verdict',
    plainLanguage: '当前层级的正式结论。',
    currentMeaning: 'verdict 由 gate 给出；需要证据的 gate/lane 还要求 evidence completeness 一起满足。',
    doNotConfuseWith: 'verdict 不是“命令退出码看起来没报错”这么简单。',
  },
] as const;

export const CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS: readonly CurrentWorkflowDiagnosticCommand[] = [
  {
    id: 'mock-default-slice',
    command: 'npm run test:e2e',
    npmScript: 'test:e2e',
    workflowRole: 'diagnostic',
    whenToUse: '先看默认 mock UI 回归是不是已经坏了。',
    nextStep: '如果失败，先修最小 UI 切片，再回到对应 gate。',
  },
  {
    id: 'mock-full-slice',
    command: 'npm run test:e2e:all',
    npmScript: 'test:e2e:all',
    workflowRole: 'diagnostic',
    whenToUse: '要扩大 mock lane 范围，确认问题是不是只在 visual 或串行范围里。',
    nextStep: '确认根因后回到 gate:default 或 lane:visual。',
  },
  {
    id: 'integration-slice',
    command: 'npm run test:integration',
    npmScript: 'test:integration',
    workflowRole: 'diagnostic',
    whenToUse: '改动跨组件或跨 API 边界，需要先用集成层定位。',
    nextStep: '修完先重跑当前 integration slice，再回当前 gate wave。',
  },
  {
    id: 'unit-slice',
    command: 'npm run test:run',
    npmScript: 'test:run',
    workflowRole: 'diagnostic',
    whenToUse: '先用最低成本确认 contract / unit / small integration 是否稳定。',
    nextStep: '如果这里已失败，不要直接跑更贵的 lane。',
  },
  {
    id: 'openapi-contract',
    command: 'npm run contracts:check-openapi',
    npmScript: 'contracts:check-openapi',
    workflowRole: 'diagnostic',
    whenToUse: '接口或生成类型相关改动，先确认 OpenAPI contract 没漂。',
    nextStep: '修 contract drift 后，再回 typecheck 和 domain tests。',
  },
  {
    id: 'openapi-generated',
    command: 'npm run openapi:check-generated',
    npmScript: 'openapi:check-generated',
    workflowRole: 'diagnostic',
    whenToUse: '怀疑 generated types 和 contract 不一致时。',
    nextStep: '先把 generated artifacts 收正，再继续跑更高层验证。',
  },
  {
    id: 'workspace-typecheck',
    command: 'npm run ws:typecheck',
    npmScript: 'ws:typecheck',
    workflowRole: 'diagnostic',
    whenToUse: 'workspace shell、store、shared lib 改动后做局部类型收口。',
    nextStep: '通过后再回当前功能线的 integration / e2e。',
  },
  {
    id: 'workspace-vitest',
    command: 'npm run ws:test',
    npmScript: 'ws:test',
    workflowRole: 'diagnostic',
    whenToUse: '要快速确认 workspace 相关逻辑没有明显单元级回归时。',
    nextStep: '定位通过后仍要回对应 gate 或 lane 复核。',
  },
  {
    id: 'release-precheck',
    command: 'npm run test:release:precheck',
    npmScript: 'test:release:precheck',
    workflowRole: 'diagnostic',
    whenToUse: '准备进入产品侧 readiness 验证前，先确认本地 substrate 和端口就绪。',
    nextStep: 'precheck 绿只是准入，不是产品侧 readiness 结论；继续跑 `npm run release:ready`。',
  },
  {
    id: 'mock-lane',
    internalAdapter: 'lane:mock',
    ownerSurface: 'mock lane owner adapter',
    npmScript: 'lane:mock',
    workflowRole: 'diagnostic_lane',
    whenToUse: '需要用当前 mock 验证通道复现 UI / interaction 问题，但还不想进入 full visual 或 backend-real。',
    nextStep: 'lane:mock 用于诊断和日常回归切片；正式 verdict 仍回 gate:default 或更高层 gate。',
  },
  {
    id: 'release-backend-real-owner',
    internalAdapter: 'gate:release',
    ownerSurface: 'backend-real product readiness evidence owner',
    npmScript: 'gate:release',
    gateId: 'gate-release',
    workflowRole: 'diagnostic',
    whenToUse: '产品侧 readiness campaign 失败指向 backend-real owner，或需要单独复核 `ux_trace_bundle` owner。',
    nextStep: '通过后回到 `npm run release:ready`；不要用它代替 full visual 或 aggregate readiness check。',
  },
  {
    id: 'release-unified-deploy-substrate-owner',
    internalAdapter: 'lane:unified-deploy:substrate',
    ownerSurface: 'transition-only unified deploy substrate diagnostic',
    npmScript: 'lane:unified-deploy:substrate',
    gateId: 'lane-unified-deploy-substrate',
    workflowRole: 'diagnostic_lane',
    whenToUse: '需要定位 transition-only unified deploy substrate reset / readiness 诊断。',
    nextStep: '修复本机 substrate 后重跑该 diagnostic；AgentSmith product-side readiness / handoff input completeness 仍使用 `npm run release:ready`。',
  },
  {
    id: 'release-unified-deploy-local-kind-images-owner',
    internalAdapter: 'lane:unified-deploy:local-kind:images',
    ownerSurface: 'transition-only unified deploy local-kind image diagnostic',
    npmScript: 'lane:unified-deploy:local-kind:images',
    gateId: 'lane-unified-deploy-local-kind-images',
    workflowRole: 'diagnostic_lane',
    whenToUse: '需要定位 transition-only local-kind image handoff 诊断。',
    nextStep: '修复镜像构建、tag、registry handoff 后重跑该 diagnostic；AgentSmith product-side readiness / handoff input completeness 仍使用 `npm run release:ready`。',
  },
  {
    id: 'release-unified-deploy-local-kind-owner',
    internalAdapter: 'lane:unified-deploy:local-kind',
    ownerSurface: 'transition-only unified deploy local-kind rollout diagnostic',
    npmScript: 'lane:unified-deploy:local-kind',
    gateId: 'lane-unified-deploy-local-kind',
    workflowRole: 'diagnostic_lane',
    whenToUse: '需要定位 transition-only local-kind Kubernetes rollout / ingress smoke 诊断。',
    nextStep: '修复 deploy topology 或 ingress route 后重跑该 diagnostic；AgentSmith product-side readiness / handoff input completeness 仍使用 `npm run release:ready`。',
  },
  {
    id: 'release-unified-deploy-product-flows-owner',
    internalAdapter: 'lane:unified-deploy:product-flows',
    ownerSurface: 'transition-only unified deploy focused product-flow diagnostic',
    npmScript: 'lane:unified-deploy:product-flows',
    gateId: 'lane-unified-deploy-product-flows',
    workflowRole: 'diagnostic_lane',
    whenToUse: '需要定位 transition-only deployed project / files / managed runner product-flow 诊断。',
    nextStep: '修复产品链路后重跑该 diagnostic；AgentSmith product-side readiness / handoff input completeness 仍使用 `npm run release:ready`。',
  },
  {
    id: 'release-terminal-aggregate',
    internalAdapter: 'gate:release:full',
    ownerSurface: 'AgentSmith product readiness aggregate verifier',
    npmScript: 'gate:release:full',
    gateId: 'gate-release-full',
    workflowRole: 'diagnostic',
    whenToUse: '只在已有显式 campaign root/run id 时复核 aggregate readiness evidence；该命令不会执行任何 suite。',
    nextStep: '如果缺少显式 campaign context，改跑 `npm run release:ready` 生成当前 campaign evidence。',
  },
] as const;

export const CURRENT_CI_WORKFLOW_MANIFEST: readonly CurrentCIWorkflowDefinition[] = [
  defineCurrentCIWorkflow({
    path: '.github/workflows/contracts-check.yml',
    workflowName: 'Contracts Check',
    role: 'contract_gate',
    triggers: ['pull_request', 'push'],
    blockingFor: ['pull_request', 'push', 'release'],
    scheduled: false,
    releaseBlocking: true,
    jobs: [
      {
        id: 'contracts',
        role: 'contract_gate',
        commands: [
          'npm run contracts:check',
          'npm run contracts:check-current-workflows',
          'npm run contracts:check-current-gates',
          'npm run contracts:check-engineering-governance',
        ],
        requiredSecrets: [],
        requiresSecrets: false,
        evidenceRequired: false,
        evidenceFamilies: [],
        artifactPaths: [],
        blockingFor: ['pull_request', 'push', 'release'],
        scheduled: false,
        releaseBlocking: true,
        notes: 'Contracts workflow is static/contract fail-fast only; gate:fast remains owned by quality-gates.yml.',
      },
    ],
  }),
  defineCurrentCIWorkflow({
    path: '.github/workflows/engineering-gate.yml',
    workflowName: 'Engineering Gate',
    role: 'backend_real_regression',
    triggers: ['schedule', 'workflow_dispatch'],
    blockingFor: ['manual', 'scheduled', 'release'],
    scheduled: true,
    releaseBlocking: true,
    jobs: [
      {
        id: 'engineering-gate',
        role: 'backend_real_lane',
        laneId: 'lane-backend-real-core',
        commands: [
          'npm run backend-real:bootstrap',
          'npm run lane:backend-real:core',
        ],
        requiredSecrets: ['PRESET_ENDPOINT_API_KEY'],
        requiresSecrets: true,
        evidenceRequired: true,
        evidenceFamilies: [
          'backend_real_current_state',
          'backend_real_run',
          'governance_report',
          'mock_lane_run',
          'test_results',
          'playwright_report',
        ],
        artifactPaths: [
          'artifacts/governance-reports/**',
          'artifacts/backend-real/current/**',
          'artifacts/backend-real/runs/**',
          '!artifacts/backend-real/runs/**/next-dist/**',
          'artifacts/mock-lane/runs/**',
          '!artifacts/mock-lane/runs/**/next-dist/**',
          'test-results/**',
          'playwright-report/**',
        ],
        blockingFor: ['manual', 'scheduled', 'release'],
        scheduled: true,
        releaseBlocking: true,
        notes: 'Scheduled engineering regression must run the backend-real core lane and publish backend-real evidence; governance reports are archived side evidence only.',
      },
    ],
  }),
  defineCurrentCIWorkflow({
    path: '.github/workflows/image-publish.yml',
    workflowName: 'Image Publish',
    role: 'release_artifact_producer',
    triggers: ['push', 'workflow_dispatch'],
    blockingFor: ['manual', 'release'],
    scheduled: false,
    releaseBlocking: false,
    jobs: [
      {
        id: 'publish-images',
        role: 'artifact_producer',
        commands: [
          'npm run build -w @mbos/agent-runner-contract',
          'scripts/governance/build-artifact-broker-cli.ts',
          'npm run release:deploy-template-package',
        ],
        requiredSecrets: [],
        requiresSecrets: false,
        evidenceRequired: true,
        evidenceFamilies: ['image_publish_handoff'],
        artifactPaths: [
          'artifacts/image-publish/VERSION',
          'artifacts/image-publish/build-artifact-broker-plan.json',
          'artifacts/image-publish/build-manifest.json',
          'artifacts/image-publish/image-publish-summary.json',
          'artifacts/image-publish/release-contract-input.json',
          'artifacts/image-publish/deploy-template-package.json',
          'artifacts/image-publish/agentsmith-deploy-template-package.tgz',
        ],
        blockingFor: ['manual', 'release'],
        scheduled: false,
        releaseBlocking: false,
        notes: 'Publishes the single shared agentsmith-app product image to GHCR and uploads the release-contract input handoff; it is not an AgentSmith product readiness gate.',
      },
    ],
  }),
  defineCurrentCIWorkflow({
    path: '.github/workflows/integration-e2e.yml',
    workflowName: 'Integration E2E',
    role: 'integration_e2e',
    triggers: ['pull_request', 'workflow_dispatch'],
    blockingFor: ['pull_request', 'manual'],
    scheduled: false,
    releaseBlocking: false,
    jobs: [
      {
        id: 'integration-agent-task',
        role: 'integration_lane',
        commands: ['make e2e-int-agent-task-auto'],
        requiredSecrets: [],
        requiresSecrets: false,
        evidenceRequired: true,
        evidenceFamilies: ['integration_log', 'test_results', 'playwright_report'],
        artifactPaths: [
          'artifacts/backend-real/current/ci/integration-agent-task.log',
          'artifacts/backend-real/current/integration/api.log',
          'artifacts/backend-real/current/integration/web.log',
          'test-results/**',
          'playwright-report/**',
        ],
        blockingFor: ['pull_request', 'manual'],
        scheduled: false,
        releaseBlocking: false,
      },
    ],
  }),
  defineCurrentCIWorkflow({
    path: '.github/workflows/release-contract-artifact.yml',
    workflowName: 'Release Contract Artifact',
    role: 'release_artifact_producer',
    triggers: ['workflow_dispatch'],
    blockingFor: ['manual'],
    scheduled: false,
    releaseBlocking: false,
    jobs: [
      {
        id: 'generate-release-contract',
        role: 'artifact_producer',
        commands: [
          'npm run build -w @mbos/agent-runner-contract',
          'npm run release:contract:ci-artifact',
        ],
        requiredSecrets: [],
        requiresSecrets: false,
        evidenceRequired: true,
        evidenceFamilies: ['release_contract_artifact'],
        artifactPaths: [
          'artifacts/release-contract/agentsmith-release-contract.json',
          'artifacts/release-contract/release-contract-input-source.json',
        ],
        blockingFor: ['manual'],
        scheduled: false,
        releaseBlocking: false,
        notes: 'Produces the AgentSmith release contract handoff artifact only; it is not a deployment, package, or operator gate.',
      },
    ],
  }),
  defineCurrentCIWorkflow({
    path: '.github/workflows/runner-contract-artifact.yml',
    workflowName: 'Runner Contract Artifact',
    role: 'release_artifact_producer',
    triggers: ['workflow_dispatch'],
    blockingFor: ['manual'],
    scheduled: false,
    releaseBlocking: false,
    jobs: [
      {
        id: 'produce-runner-contract-artifact',
        role: 'artifact_producer',
        commands: [
          'npm run build -w @mbos/agent-runner-contract',
          'npx tsx scripts/governance/runner-contract-artifact.ts',
        ],
        requiredSecrets: [],
        requiresSecrets: false,
        evidenceRequired: true,
        evidenceFamilies: ['runner_contract_artifact'],
        artifactPaths: [
          'artifacts/runner-contract/runner-contract-artifact.json',
          'artifacts/runner-contract/*.tgz',
        ],
        blockingFor: ['manual'],
        scheduled: false,
        releaseBlocking: false,
        notes: 'Produces the runner contract descriptor and tgz artifact only; it is not an AgentSmith product readiness gate.',
      },
      {
        id: 'consume-runner-contract-artifact',
        role: 'contract_gate',
        commands: [
          'npm run build -w @mbos/agent-runner-contract',
          'npx tsx scripts/contracts/check-agent-runner-contract-artifact.ts --artifact-root artifacts/runner-contract-download',
        ],
        requiredSecrets: [],
        requiresSecrets: false,
        evidenceRequired: false,
        evidenceFamilies: [],
        artifactPaths: [],
        blockingFor: ['manual'],
        scheduled: false,
        releaseBlocking: false,
        notes: 'Downloads the produced descriptor/tgz and verifies install/type consumption from that artifact.',
      },
      {
        id: 'runner-repo-contract-handoff',
        role: 'contract_gate',
        commands: [
          'bash scripts/verify-release.sh --contract-consumer --artifact-root "$GITHUB_WORKSPACE/artifacts/runner-contract-download"',
        ],
        requiredSecrets: [],
        requiresSecrets: false,
        evidenceRequired: false,
        evidenceFamilies: [],
        artifactPaths: [],
        blockingFor: ['manual'],
        scheduled: false,
        releaseBlocking: false,
        notes: 'Focused cross-repo runner contract artifact handoff to the agentsmith-runner consumer only; it is not release readiness, runtime/image publication, runner adoption, signing, or attestation.',
      },
    ],
  }),
  defineCurrentCIWorkflow({
    path: '.github/workflows/quality-gates.yml',
    workflowName: 'Quality Gates',
    role: 'quality_gate',
    triggers: ['pull_request', 'push', 'workflow_dispatch'],
    blockingFor: ['pull_request', 'push', 'manual', 'release'],
    scheduled: false,
    releaseBlocking: true,
    jobs: [
      {
        id: 'gate-fast',
        role: 'gate_verdict',
        gateId: 'gate-fast',
        commands: ['npm run gate:fast'],
        requiredSecrets: [],
        requiresSecrets: false,
        evidenceRequired: true,
        evidenceFamilies: ['mock_lane_run', 'test_results', 'playwright_report'],
        artifactPaths: [
          'artifacts/mock-lane/runs/**',
          '!artifacts/mock-lane/runs/**/next-dist/**',
          'test-results/**',
          'playwright-report/**',
        ],
        blockingFor: ['pull_request', 'push', 'manual', 'release'],
        scheduled: false,
        releaseBlocking: true,
      },
      {
        id: 'gate-default',
        role: 'gate_verdict',
        gateId: 'gate-default',
        commands: ['npm run gate:default'],
        requiredSecrets: [],
        requiresSecrets: false,
        evidenceRequired: true,
        evidenceFamilies: ['mock_lane_run', 'test_results', 'playwright_report'],
        artifactPaths: [
          'artifacts/mock-lane/runs/**',
          '!artifacts/mock-lane/runs/**/next-dist/**',
          'test-results/**',
          'playwright-report/**',
        ],
        blockingFor: ['pull_request', 'push', 'manual', 'release'],
        scheduled: false,
        releaseBlocking: true,
      },
      {
        id: 'lane-visual',
        role: 'visual_lane',
        laneId: 'lane-visual',
        commands: [
          'npm run build -w @mbos/agent-runner-contract',
          'npm run lane:visual',
        ],
        requiredSecrets: [],
        requiresSecrets: false,
        evidenceRequired: true,
        evidenceFamilies: [
          'visual_baseline_review',
          'mock_lane_run',
          'test_results',
          'playwright_report',
        ],
        artifactPaths: [
          'artifacts/gate-results/lane-visual/**',
          'artifacts/visual-baseline-reviews/**',
          'artifacts/mock-lane/runs/**',
          '!artifacts/mock-lane/runs/**/next-dist/**',
          'test-results/**',
          'playwright-report/**',
        ],
        blockingFor: ['push', 'manual', 'release'],
        scheduled: false,
        releaseBlocking: true,
      },
      {
        id: 'lane-backend-real-core',
        role: 'backend_real_lane',
        laneId: 'lane-backend-real-core',
        commands: [
          'npm run backend-real:bootstrap',
          'npm run lane:backend-real:core',
        ],
        requiredSecrets: ['PRESET_ENDPOINT_API_KEY'],
        requiresSecrets: true,
        evidenceRequired: true,
        evidenceFamilies: [
          'backend_real_run',
          'mock_lane_run',
          'test_results',
          'playwright_report',
        ],
        artifactPaths: [
          'artifacts/backend-real/runs/**',
          '!artifacts/backend-real/runs/**/next-dist/**',
          'artifacts/mock-lane/runs/**',
          '!artifacts/mock-lane/runs/**/next-dist/**',
          'test-results/**',
          'playwright-report/**',
        ],
        blockingFor: ['manual', 'release'],
        scheduled: false,
        releaseBlocking: true,
      },
    ],
  }),
] as const;

const CURRENT_WORKFLOW_RAW_MANIFEST: readonly RawCurrentWorkflowSection[] = [
  {
    id: 'environment',
    title: '环境',
    commands: [
      {
        command: 'npm run dev',
        description: 'start the Next.js development server',
        canonical: 'npm',
        npmScript: 'dev',
        recommended: true,
        quickHuman: true,
      },
      {
        command: 'make substrate-up',
        description: 'start the local managed substrate',
        canonical: 'make',
        makeTarget: 'substrate-up',
      },
      {
        command: 'make substrate-reseed',
        description: 'rebuild minimum substrate data',
        canonical: 'make',
        makeTarget: 'substrate-reseed',
      },
      {
        command: 'make substrate-status',
        description: 'inspect the managed substrate',
        canonical: 'make',
        makeTarget: 'substrate-status',
      },
      {
        command: 'make substrate-down',
        description: 'stop the managed substrate',
        canonical: 'make',
        makeTarget: 'substrate-down',
      },
      {
        command: 'make substrate-reset',
        description: 'clear the managed substrate',
        canonical: 'make',
        makeTarget: 'substrate-reset',
      },
      {
        command: 'make local-real-up',
        description: 'start the real local environment',
        canonical: 'make',
        makeTarget: 'local-real-up',
        recommended: true,
        quickHuman: true,
      },
      {
        command: 'make local-real-status',
        description: 'show the real local environment status',
        canonical: 'make',
        makeTarget: 'local-real-status',
        recommended: true,
        quickHuman: true,
      },
      {
        command: 'make local-real-down',
        description: 'stop the real local environment',
        canonical: 'make',
        makeTarget: 'local-real-down',
        recommended: true,
        quickHuman: true,
      },
      {
        command: 'make local-real-reset',
        description: 'reset the real local environment',
        canonical: 'make',
        makeTarget: 'local-real-reset',
        recommended: true,
        quickHuman: true,
      },
      {
        command: 'make local-manual-up',
        description: 'start the real local manual-test environment',
        canonical: 'make',
        makeTarget: 'local-manual-up',
      },
      {
        command: 'make local-manual-seed-agent-task',
        description: 'create agent-task diagnostic resources and start the host runner',
        canonical: 'make',
        makeTarget: 'local-manual-seed-agent-task',
      },
      {
        command: 'make local-manual-internal-up',
        description: 'enable the local internal sandbox extension on top of local-manual',
        canonical: 'make',
        makeTarget: 'local-manual-internal-up',
      },
      {
        command: 'make local-manual-internal-status',
        description: 'inspect the local internal sandbox extension',
        canonical: 'make',
        makeTarget: 'local-manual-internal-status',
      },
      {
        command: 'make local-manual-internal-down',
        description: 'disable the local internal sandbox extension',
        canonical: 'make',
        makeTarget: 'local-manual-internal-down',
      },
      {
        command: 'make local-manual-internal-reset',
        description: 'rebuild the local internal sandbox extension',
        canonical: 'make',
        makeTarget: 'local-manual-internal-reset',
      },
      {
        command: 'make local-manual-status',
        description: 'show the current real local environment state',
        canonical: 'make',
        makeTarget: 'local-manual-status',
      },
      {
        command: 'make local-manual-down',
        description: 'stop the real local manual-test environment',
        canonical: 'make',
        makeTarget: 'local-manual-down',
      },
      {
        command: 'make local-manual-reset',
        description: 'rebuild the real local manual-test environment',
        canonical: 'make',
        makeTarget: 'local-manual-reset',
      },
    ],
  },
  {
    id: 'test',
    title: '测试',
    commands: [
      {
        command: 'npm run verify',
        description: 'write a dry-run story acceptance report and print the recommended verification plan',
        canonical: 'npm',
        npmScript: 'verify',
        recommended: true,
        quickHuman: true,
      },
      {
        command: 'npm run verify:quick',
        description: 'run the quick verification adapter',
        canonical: 'npm',
        npmScript: 'verify:quick',
      },
      {
        command: 'npm run verify:default',
        description: 'run the default verification adapter',
        canonical: 'npm',
        npmScript: 'verify:default',
      },
      {
        command: 'npm run verify:visual',
        description: 'run the visual verification adapter',
        canonical: 'npm',
        npmScript: 'verify:visual',
      },
      {
        command: 'npm run verify:real',
        description: 'run the real-backend verification adapter',
        canonical: 'npm',
        npmScript: 'verify:real',
      },
      {
        command: 'npm run verify:release-real',
        description: 'run the release backend-real owner diagnostic adapter',
        canonical: 'npm',
        npmScript: 'verify:release-real',
      },
      {
        command: 'npm run test:default-e2e',
        description: 'run the default mock UI regression range',
        canonical: 'npm',
        npmScript: 'test:default-e2e',
        gateId: 'workspace-project-default',
      },
      {
        command: 'npm run test:visual',
        description: 'run the visual verification suite',
        canonical: 'npm',
        npmScript: 'test:visual',
        gateId: 'visual-lane-command',
      },
      {
        command: 'npm run test:governance',
        description: 'run governance-focused verification',
        canonical: 'npm',
        npmScript: 'test:governance',
        gateId: 'governance-default',
      },
      {
        command: 'npm run test:backend-real:core',
        description: 'run the core real-backend verification suite',
        canonical: 'npm',
        npmScript: 'test:backend-real:core',
        gateId: 'test-backend-real-core',
      },
      {
        command: 'npm run test:agent-task:backend-real:smoke',
        description: 'run Agent Task real-backend smoke verification',
        canonical: 'npm',
        npmScript: 'test:agent-task:backend-real:smoke',
      },
    ],
  },
  {
    id: 'gate',
    title: '门禁',
    commands: [
      {
        command: 'npm run gate:fast',
        description: 'run the fast engineering gate',
        canonical: 'npm',
        npmScript: 'gate:fast',
        gateId: 'gate-fast',
      },
      {
        command: 'npm run gate:default',
        description: 'run the default engineering gate',
        canonical: 'npm',
        npmScript: 'gate:default',
        gateId: 'gate-default',
      },
      {
        command: 'npm run gate:release',
        description: 'run the backend-real product readiness gate',
        canonical: 'npm',
        npmScript: 'gate:release',
        gateId: 'gate-release',
      },
      {
        command: 'RELEASE_CAMPAIGN_ROOT=<campaign-root> npm run gate:release:full',
        description: 'aggregate an explicitly selected AgentSmith product readiness campaign',
        canonical: 'npm',
        npmScript: 'gate:release:full',
        gateId: 'gate-release-full',
      },
    ],
  },
  {
    id: 'lane',
    title: '验证通道',
    commands: [
      {
        command: 'npm run lane:mock',
        description: 'run the mock verification channel',
        canonical: 'npm',
        npmScript: 'lane:mock',
        gateId: 'lane-mock',
      },
      {
        command: 'npm run lane:visual',
        description: 'run the visual verification channel',
        canonical: 'npm',
        npmScript: 'lane:visual',
        gateId: 'lane-visual',
      },
      {
        command: 'npm run lane:backend-real:core',
        description: 'run the core real-backend verification channel',
        canonical: 'npm',
        npmScript: 'lane:backend-real:core',
        gateId: 'lane-backend-real-core',
      },
      {
        command: 'npm run lane:backend-real:release',
        description: 'run the full real-backend verification channel',
        canonical: 'npm',
        npmScript: 'lane:backend-real:release',
        gateId: 'lane-backend-real-release',
      },
      {
        command: 'npm run lane:unified-deploy:substrate',
        description: 'run the transition-only unified deploy focused diagnostic for substrate',
        canonical: 'npm',
        npmScript: 'lane:unified-deploy:substrate',
        gateId: 'lane-unified-deploy-substrate',
        workflowRole: 'diagnostic_lane',
      },
      {
        command: 'npm run lane:unified-deploy:local-kind:images',
        description: 'run the transition-only unified deploy focused diagnostic for local-kind images',
        canonical: 'npm',
        npmScript: 'lane:unified-deploy:local-kind:images',
        gateId: 'lane-unified-deploy-local-kind-images',
        workflowRole: 'diagnostic_lane',
      },
      {
        command: 'npm run lane:unified-deploy:local-kind',
        description: 'run the transition-only unified deploy focused diagnostic for local-kind rollout',
        canonical: 'npm',
        npmScript: 'lane:unified-deploy:local-kind',
        gateId: 'lane-unified-deploy-local-kind',
        workflowRole: 'diagnostic_lane',
      },
      {
        command: 'npm run lane:unified-deploy:product-flows',
        description: 'run the transition-only unified deploy focused diagnostic for product-flow',
        canonical: 'npm',
        npmScript: 'lane:unified-deploy:product-flows',
        gateId: 'lane-unified-deploy-product-flows',
        workflowRole: 'diagnostic_lane',
      },
    ],
  },
  {
    id: 'release',
    title: '发布',
    commands: [
      {
        command: 'npm run release:ready',
        description: 'run the human-friendly AgentSmith product readiness wrapper',
        canonical: 'npm',
        npmScript: 'release:ready',
        recommended: true,
        quickHuman: true,
      },
      {
        command: 'npm run release:status',
        description: 'read the latest release summary in read-only mode',
        canonical: 'npm',
        npmScript: 'release:status',
        recommended: true,
        quickHuman: true,
      },
      {
        command: 'npm run release:aggregate -- --campaign-root=<campaign-root>',
        description: 'aggregate an explicitly selected AgentSmith product readiness campaign and write its summary',
        canonical: 'npm',
        npmScript: 'release:aggregate',
      },
      {
        command: 'npm run release:deploy-template-package -- --package-uri <remote-artifact-uri> --git-sha <git-sha> --source-git-sha <source-git-sha> --output-dir <artifact-dir> --ci-workflow-name <workflow-name> --ci-run-id <ci-run-id> --ci-run-attempt <ci-run-attempt> --ci-job <ci-job> --generated-at <generated-at-iso> --generator-command <generator-command> --generator-version <generator-version> --attestation none',
        description: 'internal artifact producer: package deploy templates for release contract handoff; do not use as the human release entrypoint',
        canonical: 'npm',
        npmScript: 'release:deploy-template-package',
      },
      {
        command: 'npm run release:contract:ci-artifact -- --input <release-contract-input.json> --output-dir <artifact-dir>',
        description: 'internal artifact producer: write the AgentSmith release contract handoff artifact; do not use as the human release entrypoint',
        canonical: 'npm',
        npmScript: 'release:contract:ci-artifact',
      },
      {
        command: 'npm run test:unified-deploy:local-kind:images',
        description: 'owner diagnostic: prepare local-kind deploy images and immutable registry handoff',
        canonical: 'npm',
        npmScript: 'test:unified-deploy:local-kind:images',
      },
      {
        command: 'npm run test:unified-deploy:local-kind',
        description: 'owner diagnostic: run the local-kind Kubernetes deploy smoke',
        canonical: 'npm',
        npmScript: 'test:unified-deploy:local-kind',
      },
      {
        command: 'npm run test:unified-deploy:product-flows -- --flow=workspace_project --flow=files --flow=agent_task_managed_runner',
        description: 'owner diagnostic: run the focused deployed product proof for project, files, and managed runner task',
        canonical: 'npm',
        npmScript: 'test:unified-deploy:product-flows',
      },
      {
        command: 'npm run test:unified-deploy:existing-cluster-smoke -- --site-env=<existing-cluster-site-env> --substrate-truth=infra/deploy/unified/substrate/connection.env --public-base-url=<public-base-url>',
        description: 'owner diagnostic: run the existing-cluster profile smoke with explicit profile inputs',
        canonical: 'npm',
        npmScript: 'test:unified-deploy:existing-cluster-smoke',
      },
      {
        command: 'npm run backend-real:reset',
        description: 'clean release verification state',
        canonical: 'npm',
        npmScript: 'backend-real:reset',
      },
      {
        command: 'npm run backend-real:bootstrap',
        description: 'bootstrap release verification dependencies and tokens',
        canonical: 'npm',
        npmScript: 'backend-real:bootstrap',
      },
      {
        command: 'npm run backend-real:ready',
        description: 'wait for release verification readiness',
        canonical: 'npm',
        npmScript: 'backend-real:ready',
      },
      {
        command: 'npm run backend-real:run',
        description: 'run the release verification matrix',
        canonical: 'npm',
        npmScript: 'backend-real:run',
      },
      {
        command: 'npm run backend-real:report',
        description: 'write the release verification report',
        canonical: 'npm',
        npmScript: 'backend-real:report',
      },
      {
        command: 'npm run release:campaign:full',
        description: 'run the product readiness campaign launcher behind release:ready; do not use as the human release entrypoint',
        canonical: 'npm',
        npmScript: 'release:campaign:full',
      },
    ],
  },
] as const;

export const CURRENT_WORKFLOW_MANIFEST: readonly CurrentWorkflowSection[] = CURRENT_WORKFLOW_RAW_MANIFEST.map((section) => ({
  ...section,
  commands: section.commands.map((command) => hydrateCurrentWorkflowCommand(section.id, command)),
}));

export function listCurrentWorkflowCommands(): readonly CurrentWorkflowCommand[] {
  return CURRENT_WORKFLOW_MANIFEST.flatMap((section) => section.commands);
}

export function listRecommendedCurrentWorkflowSections(): readonly CurrentWorkflowSection[] {
  return CURRENT_WORKFLOW_MANIFEST.map((section) => ({
    ...section,
    commands: section.commands.filter((command) => command.recommended),
  })).filter((section) => section.commands.length > 0);
}

export function listRecommendedCurrentWorkflowCommands(): readonly CurrentWorkflowCommand[] {
  return listRecommendedCurrentWorkflowSections().flatMap((section) => section.commands);
}

export function listQuickHumanCurrentWorkflowSections(): readonly CurrentWorkflowSection[] {
  return CURRENT_WORKFLOW_MANIFEST.map((section) => ({
    ...section,
    commands: section.commands.filter((command) => command.quickHuman),
  })).filter((section) => section.commands.length > 0);
}

export function listQuickHumanCurrentWorkflowCommands(): readonly CurrentWorkflowCommand[] {
  return listQuickHumanCurrentWorkflowSections().flatMap((section) => section.commands);
}

export function listCurrentCIWorkflowJobs(): readonly CurrentCIWorkflowJob[] {
  return CURRENT_CI_WORKFLOW_MANIFEST.flatMap((workflow) => workflow.jobs);
}

function uniqueByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function workflowCommandSurface(command: CurrentWorkflowCommand): string {
  return command.npmScript ?? command.makeTarget ?? command.command;
}

const CURRENT_DEPENDENCY_STARTUP_READINESS_CALLERS: readonly CurrentGovernanceDependencyCaller[] = [
  {
    path: 'Makefile',
    caller: 'deps-up',
    calls: ['integration:deps:up'],
    purpose: 'dependency_startup',
    note: 'canonical Make wrapper for starting integration dependencies',
  },
  {
    path: 'Makefile',
    caller: 'deps-ready',
    calls: ['scripts/integration-deps-ready.ts'],
    purpose: 'dependency_readiness',
    note: 'readiness-only polling target; no dependency startup',
  },
  {
    path: 'Makefile',
    caller: 'deps-bootstrap',
    calls: ['deps-up', 'deps-ready'],
    purpose: 'combined_bootstrap',
    note: 'intentional combined helper; this is not duplicate waste',
  },
  {
    path: 'scripts/backend-real-bootstrap.sh',
    caller: 'backend-real bootstrap',
    calls: ['integration:deps:up'],
    purpose: 'dependency_startup',
    note: 'backend-real owner bootstrap starts integration dependencies before readiness consumers',
  },
  {
    path: 'scripts/run-internal-agent-task-real-gate.sh',
    caller: 'internal agent task real gate bootstrap',
    calls: ['make deps-bootstrap'],
    purpose: 'combined_bootstrap',
    note: 'owner diagnostic uses the canonical combined dependency bootstrap helper',
  },
  {
    path: 'scripts/run-integration-e2e-full.sh',
    caller: 'integration e2e full bootstrap',
    calls: ['make deps-bootstrap'],
    purpose: 'combined_bootstrap',
    note: 'integration e2e preflight uses the canonical combined dependency bootstrap helper',
  },
  {
    path: 'scripts/run-integration-release-user-story.sh',
    caller: 'release user story integration bootstrap',
    calls: ['make deps-bootstrap'],
    purpose: 'combined_bootstrap',
    note: 'release user story owner diagnostic uses the canonical combined dependency bootstrap helper',
  },
  {
    path: 'scripts/run-release-local-precheck.sh',
    caller: 'release local precheck bootstrap',
    calls: ['make deps-bootstrap'],
    purpose: 'combined_bootstrap',
    note: 'release precheck uses the canonical combined dependency bootstrap helper after readiness reuse fails',
  },
] as const;

const CURRENT_INTENTIONAL_DUPLICATE_SAFETY_CHECKS: readonly CurrentGovernanceIntentionalDuplicateSafetyCheck[] = [
  {
    id: 'wrapper-and-native-result-json',
    where: 'current gate result writers',
    whyNotWaste: 'keeps producer-owned native truth separate from wrapper verdict truth',
  },
  {
    id: 'terminal-aggregate-revalidation',
    where: 'gate:release:full',
    whyNotWaste: 'recomputes campaign evidence completeness before the aggregate readiness result',
  },
  {
    id: 'rollout-image-consumability-preflight',
    where: 'unified deploy local-kind rollout',
    whyNotWaste: 'proves the rollout target can actually consume the image being deployed',
  },
  {
    id: 'route-smoke-before-product-flows',
    where: 'unified deploy product flows',
    whyNotWaste: 'fails fast on basic availability before expensive focused product flows hide that blocker',
  },
] as const;

function listEvidenceAuthorityRoots(): CurrentGovernanceEvidenceAuthorityRoot[] {
  const gateRoots = listCurrentGateDefinitions().flatMap((gate) => [
    ...gate.standaloneEvidenceArtifacts.map((artifact) => ({
      path: artifact,
      authority: 'standalone_diagnostic' as const,
      source: gate.id,
    })),
    ...gate.campaignEvidenceArtifacts.map((artifact) => ({
      path: artifact,
      authority: 'campaign' as const,
      source: gate.id,
    })),
  ]);
  const runtimeStandaloneRoots = listCurrentRuntimeLines().flatMap((line) => (
    line.evidenceRoot
      ? [{
          path: line.evidenceRoot,
          authority: 'standalone_diagnostic' as const,
          source: line.id,
        }]
      : []
  ));

  return uniqueByKey(
    [...gateRoots, ...runtimeStandaloneRoots],
    (root) => `${root.authority}:${root.path}`,
  );
}

function listInternalAdaptersAndOwnerDiagnostics(): CurrentGovernanceInternalAdapter[] {
  const workflowAdapters = listCurrentWorkflowCommands()
    .filter((command) => !command.quickHuman)
    .map((command) => ({
      commandOrAdapter: workflowCommandSurface(command),
      workflowRole: command.workflowRole,
      source: 'current-workflow-manifest',
      note: command.description,
    }));
  const ownerDiagnostics = CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS.map((diagnostic) => ({
    commandOrAdapter: diagnostic.internalAdapter ?? diagnostic.command,
    workflowRole: diagnostic.workflowRole,
    source: diagnostic.internalAdapter ? diagnostic.ownerSurface : 'diagnostic catalog',
    note: diagnostic.whenToUse,
  }));

  return uniqueByKey(
    [...workflowAdapters, ...ownerDiagnostics],
    (adapter) => adapter.commandOrAdapter,
  );
}

function listCleanupCommandsAndOwnershipProofs(): CurrentGovernanceCleanupOwnershipProof[] {
  const destructiveLockId = findCurrentResourceLockById('destructive-lifecycle')?.id ?? 'destructive-lifecycle';

  return [
    {
      command: 'make local-real-down',
      ownershipProof: 'current-runtime-line:local-manual',
      note: 'human cleanup for the supported local-real entrypoint',
    },
    {
      command: 'make local-real-reset',
      ownershipProof: 'current-runtime-line:local-manual',
      note: 'human reset for the supported local-real entrypoint',
    },
    {
      command: 'npm run backend-real:reset',
      ownershipProof: `current-resource-lock:${destructiveLockId}`,
      note: 'owner cleanup for backend-real product readiness verification state',
    },
    {
      command: 'npm run integration:deps:down',
      ownershipProof: `current-resource-lock:${destructiveLockId}`,
      note: 'integration dependency lifecycle cleanup; use only when that dependency owner is the active owner',
    },
    {
      command: 'npm run integration:deps:down:volumes',
      ownershipProof: `current-resource-lock:${destructiveLockId}`,
      note: 'destructive integration dependency cleanup; requires explicit dependency owner intent',
    },
  ];
}

export function listCurrentGovernanceSurfaceInventory(): CurrentGovernanceSurfaceInventory {
  return {
    publicHumanEntrypoints: listQuickHumanCurrentWorkflowCommands().map((command) => ({
      command: command.command,
      source: 'current-workflow-manifest',
      description: command.description,
    })),
    internalAdaptersAndOwnerDiagnostics: listInternalAdaptersAndOwnerDiagnostics(),
    evidenceAuthorityRoots: listEvidenceAuthorityRoots(),
    runLocalStateRoots: listCurrentRuntimeLines().map((line) => ({
      path: line.runtimePath.currentRootRelative,
      source: line.id,
      note: 'run-local operational state; not product readiness / handoff evidence',
    })),
    cleanupCommandsAndOwnershipProofs: listCleanupCommandsAndOwnershipProofs(),
    dependencyStartupReadinessCallers: CURRENT_DEPENDENCY_STARTUP_READINESS_CALLERS,
    intentionalDuplicateSafetyChecks: CURRENT_INTENTIONAL_DUPLICATE_SAFETY_CHECKS,
  };
}
