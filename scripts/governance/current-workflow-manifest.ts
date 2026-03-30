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
  recommended?: boolean;
}

export interface CurrentWorkflowSection {
  id: string;
  title: CurrentWorkflowTopLevelTerm;
  commands: CurrentWorkflowCommand[];
}

export const CURRENT_WORKFLOW_DOCUMENT_FILES = [
  'README.md',
  'DEVELOPMENT.md',
  'Makefile',
  'docs/CURRENT_BASELINE.md',
  'docs/current-engineering-governance-model.md',
  'docs/troubleshooting-guide-v1.md',
  'docs/agent-codex-notebook-runbook.md',
  'docs/UXUI/01-通用规范/visual-baseline-policy-v1.md',
  'scripts/local-manual/common.sh',
  'scripts/notebook-agent-init-resources.sh',
  'scripts/contracts/check-current-workflows.ts',
  'scripts/contracts/check-engineering-governance.ts',
] as const;

export const CURRENT_WORKFLOW_MANIFEST: readonly CurrentWorkflowSection[] = [
  {
    id: 'environment',
    title: '环境',
    commands: [
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
        recommended: true,
      },
      {
        command: 'npm run test:visual',
        description: 'run the visual verification suite',
        canonical: 'npm',
        npmScript: 'test:visual',
        recommended: true,
      },
      {
        command: 'npm run test:governance',
        description: 'run governance-focused verification',
        canonical: 'npm',
        npmScript: 'test:governance',
        recommended: true,
      },
      {
        command: 'npm run test:backend-real:core',
        description: 'run the core real-backend verification suite',
        canonical: 'npm',
        npmScript: 'test:backend-real:core',
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
        makeTarget: 'gate-fast',
        recommended: true,
      },
      {
        command: 'npm run gate:default',
        description: 'run the default engineering gate',
        canonical: 'npm',
        npmScript: 'gate:default',
        makeTarget: 'gate-default',
        recommended: true,
      },
      {
        command: 'npm run gate:release',
        description: 'run the release-grade engineering gate',
        canonical: 'npm',
        npmScript: 'gate:release',
        makeTarget: 'gate-release',
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
        makeTarget: 'lane-mock',
        recommended: true,
      },
      {
        command: 'npm run lane:visual',
        description: 'run the visual verification channel',
        canonical: 'npm',
        npmScript: 'lane:visual',
        makeTarget: 'lane-visual',
        recommended: true,
      },
      {
        command: 'npm run lane:backend-real:core',
        description: 'run the core real-backend verification channel',
        canonical: 'npm',
        npmScript: 'lane:backend-real:core',
        makeTarget: 'lane-real-core',
      },
      {
        command: 'npm run lane:backend-real:release',
        description: 'run the full real-backend verification channel',
        canonical: 'npm',
        npmScript: 'lane:backend-real:release',
        makeTarget: 'lane-real-release',
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
        recommended: true,
      },
      {
        command: 'npm run backend-real:report',
        description: 'write the release verification report',
        canonical: 'npm',
        npmScript: 'backend-real:report',
        makeTarget: 'backend-real-report',
        recommended: true,
      },
    ],
  },
] as const;

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
