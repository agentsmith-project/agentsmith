import {
  findCurrentGateDefinition,
  findCurrentGateDefinitionById,
  type CurrentGateRequirement,
  type CurrentGateStoryEvidenceKind,
  type CurrentGateStoryEvidencePolicy,
} from './current-gate-manifest';

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

export interface CurrentWorkflowDiagnosticCommand {
  id: string;
  command: string;
  npmScript?: string;
  gateId?: string;
  workflowRole: Extract<CurrentWorkflowRole, 'diagnostic' | 'diagnostic_lane'>;
  whenToUse: string;
  nextStep: string;
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

export const CURRENT_WORKFLOW_ENTRY_PATHS: readonly CurrentWorkflowEntryPath[] = [
  {
    id: 'ui_only',
    label: 'UI only',
    whenToUse: '只改前端页面、交互、文案，暂时不需要真实后端或 notebook / runner 主链。',
    startCommands: ['npm run dev', 'npm run gate:fast', 'npm run test:e2e'],
    docs: ['README.md', 'DEVELOPMENT.md', 'docs/testing/diagnostic-catalog-v1.md'],
    avoid: ['不要把 `npm run dev` 当成 release verdict。', '不要直接跳到 `gate:release:full`。'],
  },
  {
    id: 'local_manual',
    label: 'Local manual',
    whenToUse: '要验证真实本地 API / Web / notebook / runner 行为，或者要复现 local-manual 路径问题。',
    startCommands: ['make substrate-up', 'make local-manual-up', 'make local-manual-seed-notebook'],
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
    whenToUse: '准备收口大改动、发布前总验收、或者 incident 修复后的跨层复验。',
    startCommands: [
      'npm run test:release:precheck',
      'npm run release:campaign:full',
      'npm run gate:release',
      'npm run lane:demo-rehearsal',
      'npm run lane:cluster-rehearsal',
    ],
    docs: [
      'docs/testing/verification-campaigns-v1.md',
      'docs/user-guides/release-readiness-checklist.md',
      'docs/contracts/current-gate-manifest-contract.md',
    ],
    avoid: [
      '不要用 focused test 代替最终 verdict。',
      '不要跳过 visual / release evidence owners。',
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
    currentMeaning: 'lane 定义的是在哪条真相路径下验证，例如 mock、full visual、backend-real、部署排演。',
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
    currentMeaning: 'campaign 用来组织 release-grade 或 incident 后复验这类多步骤动作，它消费 gate/lane 真相，而不是发明第二套 truth。',
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
    whenToUse: '准备进入 release-grade 验证前，先确认本地 release substrate 和端口就绪。',
    nextStep: 'precheck 绿只是准入，不是最终 release verdict。',
  },
  {
    id: 'mock-lane',
    command: 'npm run lane:mock',
    npmScript: 'lane:mock',
    workflowRole: 'diagnostic_lane',
    whenToUse: '需要用当前 mock 验证通道复现 UI / interaction 问题，但还不想进入 full visual 或 backend-real。',
    nextStep: 'lane:mock 用于诊断和日常回归切片；正式 verdict 仍回 gate:default 或更高层 gate。',
  },
  {
    id: 'release-backend-real-owner',
    command: 'npm run gate:release',
    npmScript: 'gate:release',
    gateId: 'gate-release',
    workflowRole: 'diagnostic',
    whenToUse: 'release campaign 失败指向 backend-real release owner，或需要单独复核 `ux_trace_bundle` owner。',
    nextStep: '通过后回到 `npm run release:campaign:full`；不要用它代替 full visual 或 rehearsal evidence。',
  },
  {
    id: 'release-demo-rehearsal-owner',
    command: 'npm run lane:demo-rehearsal',
    npmScript: 'lane:demo-rehearsal',
    gateId: 'lane-demo-rehearsal',
    workflowRole: 'diagnostic_lane',
    whenToUse: 'release campaign 失败指向 demo deployment rehearsal evidence owner。',
    nextStep: '修复后从 clean reset 重跑该 lane，再回到 `npm run release:campaign:full`。',
  },
  {
    id: 'release-cluster-rehearsal-owner',
    command: 'npm run lane:cluster-rehearsal',
    npmScript: 'lane:cluster-rehearsal',
    gateId: 'lane-cluster-rehearsal',
    workflowRole: 'diagnostic_lane',
    whenToUse: 'release campaign 失败指向 cluster deployment rehearsal evidence owner。',
    nextStep: '修复后从 clean reset 重跑该 lane，再回到 `npm run release:campaign:full`。',
  },
  {
    id: 'release-terminal-aggregate',
    command: 'RELEASE_CAMPAIGN_ROOT=<campaign-root> npm run gate:release:full',
    npmScript: 'gate:release:full',
    gateId: 'gate-release-full',
    workflowRole: 'diagnostic',
    whenToUse: '只在已有显式 campaign root/run id 时复核 terminal aggregate verdict；该命令不会执行任何 suite。',
    nextStep: '如果缺少显式 campaign context，改跑 `npm run release:campaign:full` 生成当前 campaign evidence。',
  },
] as const;

const CURRENT_WORKFLOW_RAW_MANIFEST: readonly RawCurrentWorkflowSection[] = [
  {
    id: 'environment',
    title: '环境',
    commands: [
      {
        command: 'make substrate-up',
        description: 'start the local managed substrate',
        canonical: 'make',
        makeTarget: 'substrate-up',
        recommended: true,
      },
      {
        command: 'make substrate-reseed',
        description: 'rebuild minimum substrate data',
        canonical: 'make',
        makeTarget: 'substrate-reseed',
        recommended: true,
      },
      {
        command: 'make substrate-status',
        description: 'inspect the managed substrate',
        canonical: 'make',
        makeTarget: 'substrate-status',
        recommended: true,
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
        command: 'make local-manual-up',
        description: 'start the real local manual-test environment',
        canonical: 'make',
        makeTarget: 'local-manual-up',
        recommended: true,
      },
      {
        command: 'make local-manual-seed-notebook',
        description: 'create notebook demo resources and start the host runner',
        canonical: 'make',
        makeTarget: 'local-manual-seed-notebook',
        recommended: true,
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
        recommended: true,
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
      {
        command: 'make demo-rehearsal-up',
        description: 'prepare the local demo deploy rehearsal line to the environment-ready stage',
        canonical: 'make',
        makeTarget: 'demo-rehearsal-up',
      },
      {
        command: 'make demo-rehearsal-status',
        description: 'inspect the local demo deploy rehearsal line',
        canonical: 'make',
        makeTarget: 'demo-rehearsal-status',
      },
      {
        command: 'make demo-rehearsal-down',
        description: 'clear the local demo deploy rehearsal line',
        canonical: 'make',
        makeTarget: 'demo-rehearsal-down',
      },
      {
        command: 'make demo-rehearsal-reset',
        description: 'reset the local demo deploy rehearsal line',
        canonical: 'make',
        makeTarget: 'demo-rehearsal-reset',
      },
      {
        command: 'make demo-rehearsal-bootstrap',
        description: 'bootstrap the local demo deploy rehearsal line after up',
        canonical: 'make',
        makeTarget: 'demo-rehearsal-bootstrap',
      },
      {
        command: 'make demo-rehearsal-verify',
        description: 'verify the local demo deploy rehearsal line after bootstrap',
        canonical: 'make',
        makeTarget: 'demo-rehearsal-verify',
      },
      {
        command: 'make demo-rehearsal-report',
        description: 'write the local demo deploy rehearsal report after verify',
        canonical: 'make',
        makeTarget: 'demo-rehearsal-report',
      },
      {
        command: 'make cluster-rehearsal-up',
        description: 'prepare the local cluster deploy rehearsal line to the environment-ready stage',
        canonical: 'make',
        makeTarget: 'cluster-rehearsal-up',
      },
      {
        command: 'make cluster-rehearsal-status',
        description: 'inspect the local cluster deploy rehearsal line',
        canonical: 'make',
        makeTarget: 'cluster-rehearsal-status',
      },
      {
        command: 'make cluster-rehearsal-down',
        description: 'clear the local cluster deploy rehearsal line',
        canonical: 'make',
        makeTarget: 'cluster-rehearsal-down',
      },
      {
        command: 'make cluster-rehearsal-reset',
        description: 'reset the local cluster deploy rehearsal line',
        canonical: 'make',
        makeTarget: 'cluster-rehearsal-reset',
      },
      {
        command: 'make cluster-rehearsal-bootstrap',
        description: 'bootstrap the local cluster deploy rehearsal line after up',
        canonical: 'make',
        makeTarget: 'cluster-rehearsal-bootstrap',
      },
      {
        command: 'make cluster-rehearsal-verify',
        description: 'verify the local cluster deploy rehearsal line after bootstrap',
        canonical: 'make',
        makeTarget: 'cluster-rehearsal-verify',
      },
      {
        command: 'make cluster-rehearsal-report',
        description: 'write the local cluster deploy rehearsal report after verify',
        canonical: 'make',
        makeTarget: 'cluster-rehearsal-report',
      },
    ],
  },
  {
    id: 'test',
    title: '测试',
    commands: [
      {
        command: 'npm run test:default-e2e',
        description: 'run the default mock UI regression range',
        canonical: 'npm',
        npmScript: 'test:default-e2e',
        gateId: 'workspace-project-default',
        recommended: true,
      },
      {
        command: 'npm run test:visual',
        description: 'run the visual verification suite',
        canonical: 'npm',
        npmScript: 'test:visual',
        gateId: 'visual-lane-command',
        recommended: true,
      },
      {
        command: 'npm run test:governance',
        description: 'run governance-focused verification',
        canonical: 'npm',
        npmScript: 'test:governance',
        gateId: 'governance-default',
        recommended: true,
      },
      {
        command: 'npm run test:backend-real:core',
        description: 'run the core real-backend verification suite',
        canonical: 'npm',
        npmScript: 'test:backend-real:core',
        gateId: 'test-backend-real-core',
        recommended: true,
      },
      {
        command: 'npm run test:demo-bundle:inputs',
        description: 'verify release bundle inputs',
        canonical: 'npm',
        npmScript: 'test:demo-bundle:inputs',
      },
      {
        command: 'npm run test:demo-rendered-env',
        description: 'verify rendered deployment env artifacts',
        canonical: 'npm',
        npmScript: 'test:demo-rendered-env',
      },
      {
        command: 'npm run test:notebook:backend-real:smoke',
        description: 'run notebook real-backend smoke verification',
        canonical: 'npm',
        npmScript: 'test:notebook:backend-real:smoke',
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
        makeTarget: 'gate-fast',
        recommended: true,
      },
      {
        command: 'npm run gate:default',
        description: 'run the default engineering gate',
        canonical: 'npm',
        npmScript: 'gate:default',
        gateId: 'gate-default',
        makeTarget: 'gate-default',
        recommended: true,
      },
      {
        command: 'npm run gate:release',
        description: 'run the release-grade engineering gate',
        canonical: 'npm',
        npmScript: 'gate:release',
        gateId: 'gate-release',
        makeTarget: 'gate-release',
        recommended: true,
      },
      {
        command: 'RELEASE_CAMPAIGN_ROOT=<campaign-root> npm run gate:release:full',
        description: 'aggregate an explicitly selected release campaign into the terminal release verdict',
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
        makeTarget: 'lane-mock',
        recommended: true,
      },
      {
        command: 'npm run lane:visual',
        description: 'run the visual verification channel',
        canonical: 'npm',
        npmScript: 'lane:visual',
        gateId: 'lane-visual',
        makeTarget: 'lane-visual',
        recommended: true,
      },
      {
        command: 'npm run lane:backend-real:core',
        description: 'run the core real-backend verification channel',
        canonical: 'npm',
        npmScript: 'lane:backend-real:core',
        gateId: 'lane-backend-real-core',
        makeTarget: 'lane-real-core',
      },
      {
        command: 'npm run lane:backend-real:release',
        description: 'run the full real-backend verification channel',
        canonical: 'npm',
        npmScript: 'lane:backend-real:release',
        gateId: 'lane-backend-real-release',
        makeTarget: 'lane-real-release',
        recommended: true,
      },
      {
        command: 'npm run lane:demo-rehearsal',
        description: 'run the demo deployment rehearsal verification channel',
        canonical: 'npm',
        npmScript: 'lane:demo-rehearsal',
        gateId: 'lane-demo-rehearsal',
        recommended: true,
      },
      {
        command: 'npm run lane:cluster-rehearsal',
        description: 'run the cluster deployment rehearsal verification channel',
        canonical: 'npm',
        npmScript: 'lane:cluster-rehearsal',
        gateId: 'lane-cluster-rehearsal',
        recommended: true,
      },
    ],
  },
  {
    id: 'release',
    title: '发布',
    commands: [
      {
        command: 'npm run backend-real:reset',
        description: 'clean release verification state',
        canonical: 'npm',
        npmScript: 'backend-real:reset',
        makeTarget: 'backend-real-reset',
      },
      {
        command: 'npm run backend-real:bootstrap',
        description: 'bootstrap release verification dependencies and tokens',
        canonical: 'npm',
        npmScript: 'backend-real:bootstrap',
        makeTarget: 'backend-real-bootstrap',
      },
      {
        command: 'npm run backend-real:ready',
        description: 'wait for release verification readiness',
        canonical: 'npm',
        npmScript: 'backend-real:ready',
        makeTarget: 'backend-real-ready',
      },
      {
        command: 'npm run backend-real:run',
        description: 'run the release verification matrix',
        canonical: 'npm',
        npmScript: 'backend-real:run',
        makeTarget: 'backend-real-run',
      },
      {
        command: 'npm run backend-real:report',
        description: 'write the release verification report',
        canonical: 'npm',
        npmScript: 'backend-real:report',
        makeTarget: 'backend-real-report',
      },
      {
        command: 'npm run release:campaign:full',
        description: 'run the official one-shot release verification campaign',
        canonical: 'npm',
        npmScript: 'release:campaign:full',
        recommended: true,
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
