import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS,
  CURRENT_WORKFLOW_TOP_LEVEL_TERMS,
  listCurrentGovernanceSurfaceInventory,
  listCurrentWorkflowCommands,
  listQuickHumanCurrentWorkflowCommands,
  type CurrentWorkflowCommand,
} from '../governance/current-workflow-manifest';
import {
  CURRENT_PURE_CHECK_IDENTITY_MANIFEST_SCHEMA,
  CURRENT_PURE_CHECK_IDENTITY_MANIFEST_VERSION,
  CURRENT_PURE_CHECK_IDS,
  listCurrentPureCheckIdentities,
  listCurrentPureCheckInputDigestRules,
} from '../governance/current-pure-check-identity-manifest';
import {
  RELEASE_PRECHECK_MOVED_CHECK_EVIDENCE_OWNERSHIP,
  validateReleasePrecheckEvidenceOwnership,
} from '../governance/release-precheck-evidence-ownership';
import { buildVerificationCatalog } from '../governance/verification-catalog';
import {
  DEFAULT_WORKFLOW_SURFACE_DOC_PATHS,
  findInternalWorkflowReferenceViolations,
} from './engineering-governance-doc-guard';
import { findUserGuideGaBoundaryViolations } from './user-guide-ga-boundary';

const rootDir = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

const governanceDoc = 'docs/current-engineering-governance-model.md';
const readme = read('README.md');
const development = read('DEVELOPMENT.md');
const baseline = read('docs/CURRENT_BASELINE.md');
const constitution = read('docs/项目宪法.md');
const docsIndex = read('docs/README.md');
const userGuidesIndex = read('docs/user-guides/README.md');
const alertCenterGuide = read('docs/user-guides/alert-center.md');
const auditUsageReportsGuide = read('docs/user-guides/audit-usage-reports.md');
const personalConnectionsGuide = read('docs/user-guides/personal-connections.md');
const releaseChecklist = read('docs/user-guides/release-readiness-checklist.md');
const testingIndex = read('docs/testing/README.md');
const verificationCampaigns = read('docs/testing/verification-campaigns-v1.md');
const diagnosticCatalog = read('docs/testing/diagnostic-catalog-v1.md');
const storyTruthGuide = read('docs/testing/story-source-of-truth-and-generated-specs.md');
const agentsDoc = read('AGENTS.md');
const visualPolicy = read('docs/testing/visual-baseline-policy-v1.md');
const contractsIndex = read('docs/contracts/README.md');
const gateManifestContract = read('docs/contracts/current-gate-manifest-contract.md');
const gateResultContract = read('docs/contracts/current-gate-result-schema-contract.md');
const unifiedDeployContract = read('docs/contracts/unified-deploy-contract.md');
const productTerminology = read('docs/contracts/product-terminology.md');
const releaseLocalPrecheck = read('scripts/run-release-local-precheck.sh');
const gaReleasePlan = read('docs/engineering/agentsmith-ga-release-plan-v1.md');
const releaseKitSplitPlan = read('docs/engineering/release-kit-and-runner-repo-split-kiss-plan-v1.md');
const integrationE2EFull = read('scripts/run-integration-e2e-full.sh');
const internalAgentTaskRealGate = read('scripts/run-internal-agent-task-real-gate.sh');
const playwrightConfig = read('playwright.config.ts');
const makefile = read('Makefile');
const contractsCheckWorkflow = read('.github/workflows/contracts-check.yml');
const qualityGatesWorkflow = read('.github/workflows/quality-gates.yml');
const governanceModel = read(governanceDoc);
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
const governanceSurfaceInventory = listCurrentGovernanceSurfaceInventory();

const failures: string[] = [];

function requireMatch(content: string, pattern: RegExp, message: string): void {
  if (!pattern.test(content)) {
    failures.push(message);
  }
}

function forbidMatch(content: string, pattern: RegExp, message: string): void {
  if (pattern.test(content)) {
    failures.push(message);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function extractBlock(content: string, startMarker: string, endMarker: string, label: string): string {
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    failures.push(`${label} is missing its generated block markers`);
    return '';
  }

  return content.slice(startIndex + startMarker.length, endIndex);
}

const QUICK_HUMAN_FORBIDDEN_COMMAND_PATTERNS = [
  /\bnpm run verify:[a-z0-9:_-]+/,
  /\bnpm run gate:[a-z0-9:_-]+/,
  /\bmake gate-[a-z0-9_-]+/,
  /\bnpm run lane:[a-z0-9:_-]+/,
  /\bmake lane-[a-z0-9_-]+/,
  /\bnpm run release:aggregate\b/,
  /\bnpm run release:campaign:full\b/,
  /\bnpm run gate:release:full\b/,
  /\bRELEASE_CAMPAIGN_ROOT\b/,
  /\bnpm run backend-real:[a-z0-9:_-]+/,
  /\bmake backend-real-[a-z0-9_-]+/,
] as const;

const HUMAN_DOC_FORBIDDEN_COPYABLE_COMMAND_PATTERNS = [
  /\bnpm run verify:[a-z0-9:_-]+/,
  /\bnpm run gate:[a-z0-9:_-]+/,
  /\bmake gate-[a-z0-9_-]+/,
  /\bnpm run lane:[a-z0-9:_-]+/,
  /\bmake lane-[a-z0-9_-]+/,
  /\bnpm run release:aggregate\b/,
  /\bnpm run release:campaign:full\b/,
  /\bRELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full\b/,
  /\bnpm run backend-real:[a-z0-9:_-]+/,
  /\bmake backend-real-[a-z0-9_-]+/,
] as const;

const REMOVED_MAKE_COMPAT_TARGETS = [
  'gate-fast',
  'gate-default',
  'gate-release',
  'lane-mock',
  'lane-visual',
  'lane-real-core',
  'lane-real-release',
  'backend-real-reset',
  'backend-real-bootstrap',
  'backend-real-ready',
  'backend-real-run',
  'backend-real-report',
] as const;

function renderMakeQuickDisplay(command: CurrentWorkflowCommand): string {
  return command.makeTarget ? `make ${command.makeTarget}` : command.command;
}

const readmeWorkflowBlock = extractBlock(
  readme,
  '<!-- current-workflow:readme:start -->',
  '<!-- current-workflow:readme:end -->',
  'README current workflow block',
);
const developmentWorkflowBlock = extractBlock(
  development,
  '<!-- current-workflow:development:start -->',
  '<!-- current-workflow:development:end -->',
  'DEVELOPMENT current workflow block',
);
const governanceWorkflowBlock = extractBlock(
  governanceModel,
  '<!-- current-workflow:governance-model:start -->',
  '<!-- current-workflow:governance-model:end -->',
  'current engineering governance model workflow block',
);
const makeHelpExtendedWorkflowBlock = extractBlock(
  makefile,
  '# current-workflow:help-extended:start',
  '# current-workflow:help-extended:end',
  'Makefile help-extended workflow block',
);
const makeQuickHelpWorkflowBlock = extractBlock(
  makefile,
  '# current-workflow:quick-help:start',
  '# current-workflow:quick-help:end',
  'Makefile quick-help workflow block',
);

const humanCopyableWorkflowBlocks = [
  ['README current workflow block', readmeWorkflowBlock],
  ['DEVELOPMENT current workflow block', developmentWorkflowBlock],
  ['current engineering governance model workflow block', governanceWorkflowBlock],
  ['Makefile help-extended workflow block', makeHelpExtendedWorkflowBlock],
  ['Makefile quick-help workflow block', makeQuickHelpWorkflowBlock],
] as const;

requireMatch(readme, /current-engineering-governance-model\.md/, 'README is missing the current engineering governance model reference');
requireMatch(readme, /DESIGN\.md/, 'README must reference DESIGN.md as the UI design guide');
requireMatch(development, /DESIGN\.md/, 'DEVELOPMENT must reference DESIGN.md as the UI design guide');
requireMatch(baseline, /DESIGN\.md/, 'CURRENT_BASELINE must reference DESIGN.md as the UI design guide');
requireMatch(docsIndex, /DESIGN\.md/, 'docs README must reference DESIGN.md as the UI design guide');
requireMatch(governanceModel, /DESIGN\.md/, 'current engineering governance model must reference DESIGN.md as the UI design guide');
requireMatch(agentsDoc, /DESIGN\.md/, 'AGENTS.md must reference DESIGN.md as the UI design guide');
requireMatch(agentsDoc, /getdesign@latest add cursor|getdesign cursor/, 'AGENTS.md must explain that DESIGN.md comes from getdesign cursor');
forbidMatch(readme, /视觉设计系统-v1\.md/, 'README must not treat the archived visual design system as current truth');
forbidMatch(development, /视觉设计系统-v1\.md/, 'DEVELOPMENT must not treat the archived visual design system as current truth');
forbidMatch(docsIndex, /视觉设计系统-v1\.md/, 'docs README must not treat the archived visual design system as current truth');
forbidMatch(docsIndex, /Archive Index|docs\/archive\//, 'docs README must not expose archive navigation or archive paths');
forbidMatch(userGuidesIndex, /archived example|docs\/archive\//i, 'user guides index must not expose archived examples or archive paths');
forbidMatch(contractsIndex, /docs\/archive\//, 'contracts README must not reference docs/archive/');
forbidMatch(contractsIndex, /handoff\s*\/\s*refactor|allow.*current.*migration/i, 'contracts README must not keep archive-era exceptions for handoff/refactor docs');
forbidMatch(testingIndex, /system-visual-state-coverage-todo-v1/, 'testing README must not keep TODO docs in the current testing index');
forbidMatch(agentsDoc, /CLAUDE\.md/, 'AGENTS.md must not keep the old root instruction file name');
forbidMatch(readme, /UI Constitution|constitutional UI language/i, 'README must treat DESIGN.md as a design guide, not a constitution');
forbidMatch(development, /UI truth|constitutional UI language/i, 'DEVELOPMENT must treat DESIGN.md as a design guide, not governance truth');
forbidMatch(baseline, /唯一 UI 宪法|设计语言真相/, 'CURRENT_BASELINE must not describe DESIGN.md as product/governance truth');
forbidMatch(governanceModel, /authoritative source for the current UI language/i, 'current engineering governance model must not describe DESIGN.md as governance truth');
requireMatch(development, /current-engineering-governance-model\.md/, 'DEVELOPMENT is missing the current engineering governance model reference');
requireMatch(baseline, /current-engineering-governance-model\.md/, 'CURRENT_BASELINE is missing the current engineering governance model reference');
requireMatch(readme, /`ui_only`/, 'README must expose the ui_only entry path');
requireMatch(readme, /`local_manual`/, 'README must expose the local_manual entry path');
requireMatch(readme, /`release_grade`/, 'README must expose the release_grade entry path');
requireMatch(development, /`ui_only`/, 'DEVELOPMENT must expose the ui_only entry path');
requireMatch(development, /`local_manual`/, 'DEVELOPMENT must expose the local_manual entry path');
requireMatch(development, /`release_grade`/, 'DEVELOPMENT must expose the release_grade entry path');
requireMatch(readme, /diagnostic catalog/i, 'README must reference the diagnostic catalog');
requireMatch(development, /diagnostic catalog/i, 'DEVELOPMENT must reference the diagnostic catalog');
requireMatch(readme, /current-workflow-manifest\.ts/, 'README is missing the current workflow manifest reference');
requireMatch(development, /current-workflow-manifest\.ts/, 'DEVELOPMENT is missing the current workflow manifest reference');
requireMatch(governanceModel, /current-workflow-manifest\.ts/, 'current engineering governance model is missing the workflow manifest reference');
requireMatch(readme, /current-runtime-line-manifest\.ts/, 'README is missing the current runtime-line manifest reference');
requireMatch(development, /current-runtime-line-manifest\.ts/, 'DEVELOPMENT is missing the current runtime-line manifest reference');
requireMatch(governanceModel, /current-runtime-line-manifest\.ts/, 'current engineering governance model is missing the runtime-line manifest reference');
requireMatch(readme, /current-gate-manifest\.ts/, 'README is missing the current gate manifest reference');
requireMatch(development, /current-gate-manifest\.ts/, 'DEVELOPMENT is missing the current gate manifest reference');
requireMatch(governanceModel, /current-gate-manifest\.ts/, 'current engineering governance model is missing the gate manifest reference');
requireMatch(development, /current-gate-result-schema\.ts/, 'DEVELOPMENT is missing the current gate result schema reference');
requireMatch(governanceModel, /current-gate-result-schema\.ts/, 'current engineering governance model is missing the gate result schema reference');
requireMatch(governanceModel, /failure_class/, 'current engineering governance model must describe the gate-level failure_class contract');
requireMatch(governanceModel, /result\.json/, 'current engineering governance model must describe canonical gate result.json output');
requireMatch(governanceModel, /gate id/i, 'current engineering governance model must describe gate id as the stable gate identity');
requireMatch(governanceModel, /operational baseline/i, 'current engineering governance model must keep runtime baselines separate from correctness contracts');
requireMatch(governanceModel, /Plain-language glossary/, 'current engineering governance model must include the plain-language workflow glossary');
requireMatch(constitution, /provider-specific credential[\s\S]{0,100}runner skill[\s\S]{0,120}(?:默认|success|成功路径)/iu, 'constitution must forbid provider-specific credentials or runner skills as default success paths');
requireMatch(constitution, /LLM endpoint[\s\S]{0,80}provider catalog[\s\S]{0,80}preset[\s\S]{0,160}(?:不等于|not)[\s\S]{0,80}runner credential[\s\S]{0,120}provider-specific execution binding/iu, 'constitution must keep LLM endpoint provider catalog/preset separate from runner credentials and provider-specific execution binding');
requireMatch(governanceModel, /`e2e`/, 'current engineering governance model must define e2e plainly');
requireMatch(governanceModel, /`lane`/, 'current engineering governance model must define lane plainly');
requireMatch(governanceModel, /`gate`/, 'current engineering governance model must define gate plainly');
requireMatch(governanceModel, /`campaign`/, 'current engineering governance model must define campaign plainly');
requireMatch(governanceModel, /`diagnostic`/, 'current engineering governance model must define diagnostic plainly');
requireMatch(governanceModel, /`verdict`/, 'current engineering governance model must define verdict plainly');
requireMatch(gateManifestContract, /stable gate id/i, 'current gate manifest contract must explain stable gate ids');
requireMatch(gateManifestContract, /adapter surface/i, 'current gate manifest contract must explain adapter surfaces');
requireMatch(gateManifestContract, /execution target/i, 'current gate manifest contract must explain structured execution targets');
requireMatch(gateManifestContract, /operator hint/i, 'current gate manifest contract must describe command as an operator hint');
requireMatch(gateManifestContract, /diagnostic lane surface/i, 'current gate manifest contract must explain diagnostic lane surfaces');
requireMatch(gateManifestContract, /lane:mock/, 'current gate manifest contract must mention lane:mock as the current diagnostic lane surface');
requireMatch(gateResultContract, /result\.json/, 'current gate result schema contract must explain canonical result.json output');
requireMatch(gateResultContract, /failure_class/, 'current gate result schema contract must define failure_class');
requireMatch(gateResultContract, /campaign is not a writer identity/i, 'current gate result schema contract must explain that campaign is not a writer identity');
requireMatch(governanceModel, /story evidence/i, 'current engineering governance model must describe story evidence as part of gate truth');
requireMatch(governanceModel, /visual_scene_catalog/, 'current engineering governance model must define visual_scene_catalog ownership');
requireMatch(governanceModel, /ux_trace_bundle/, 'current engineering governance model must define ux_trace_bundle ownership');
requireMatch(governanceModel, /test:backend-real:core/, 'current engineering governance model must describe test:backend-real:core as a default-tier backend-real story-evidence owner');
requireMatch(governanceModel, /lane:backend-real:core/, 'current engineering governance model must describe lane:backend-real:core as a default-tier backend-real story-evidence owner');
requireMatch(governanceModel, /execution target/i, 'current engineering governance model must describe structured execution targets');
requireMatch(governanceModel, /operator hint/i, 'current engineering governance model must describe command as an operator hint');
requireMatch(development, /operator hint/i, 'DEVELOPMENT must describe command as an operator hint');
requireMatch(governanceModel, /Lean closure inventory/, 'current engineering governance model must include the lean closure inventory view');
requireMatch(governanceModel, /campaign authority/, 'lean closure inventory must label campaign authority roots');
requireMatch(governanceModel, /standalone diagnostics/, 'lean closure inventory must label standalone diagnostic roots');
requireMatch(governanceModel, /run-local state/, 'lean closure inventory must label run-local state as operational state');
requireMatch(governanceModel, /dependency startup\/readiness callers/, 'lean closure inventory must list dependency startup/readiness callers');
requireMatch(governanceModel, /Intentional duplicate-looking safety checks/, 'lean closure inventory must separate intentional duplicate-looking safety checks from waste');
for (const caller of governanceSurfaceInventory.dependencyStartupReadinessCallers) {
  requireMatch(
    governanceModel,
    new RegExp(escapeRegExp(caller.caller)),
    `lean closure inventory must document dependency caller ${caller.caller}`,
  );
}
requireMatch(contractsIndex, /product-terminology\.md/, 'contracts README is missing the product terminology contract reference');
requireMatch(contractsIndex, /Model/, 'contracts README must describe Model as part of the current terminology contract');
requireMatch(contractsIndex, /Agent tasks/, 'contracts README must describe Agent tasks as part of the current terminology contract');
requireMatch(contractsIndex, /Agent Runners/, 'contracts README must describe Agent Runners as part of the current terminology contract');
requireMatch(contractsIndex, /Shared context/, 'contracts README must describe Shared context as part of the current terminology contract');

for (const term of CURRENT_WORKFLOW_TOP_LEVEL_TERMS) {
  requireMatch(readme, new RegExp(term), `README is missing current workflow term: ${term}`);
  requireMatch(development, new RegExp(term), `DEVELOPMENT is missing current workflow term: ${term}`);
  requireMatch(governanceModel, new RegExp(term), `current engineering governance model is missing current workflow term: ${term}`);
}

for (const command of listQuickHumanCurrentWorkflowCommands()) {
  const escapedCommand = escapeRegExp(command.command);
  const escapedQuickHelpDisplay = escapeRegExp(renderMakeQuickDisplay(command));
  requireMatch(readmeWorkflowBlock, new RegExp(escapedCommand), `README current workflow block is missing quick human command: ${command.command}`);
  requireMatch(developmentWorkflowBlock, new RegExp(escapedCommand), `DEVELOPMENT current workflow block is missing quick human command: ${command.command}`);
  requireMatch(governanceWorkflowBlock, new RegExp(escapedCommand), `current engineering governance model workflow block is missing human command: ${command.command}`);
  requireMatch(makeHelpExtendedWorkflowBlock, new RegExp(escapedQuickHelpDisplay), `Makefile help-extended block is missing human command: ${renderMakeQuickDisplay(command)}`);
  requireMatch(makeQuickHelpWorkflowBlock, new RegExp(escapedQuickHelpDisplay), `Makefile quick-help block is missing quick human command: ${renderMakeQuickDisplay(command)}`);
}

for (const [label, block] of [
  ['README current workflow block', readmeWorkflowBlock],
  ['DEVELOPMENT current workflow block', developmentWorkflowBlock],
  ['Makefile quick-help workflow block', makeQuickHelpWorkflowBlock],
] as const) {
  for (const pattern of QUICK_HUMAN_FORBIDDEN_COMMAND_PATTERNS) {
    forbidMatch(block, pattern, `${label} must not expose advanced command pattern in the quick path: ${pattern}`);
  }
  requireMatch(block, /product:status[\s\S]*read-only/i, `${label} must describe product:status as read-only`);
  forbidMatch(
    block,
    /product:status[\s\S]{0,120}(?:verdict|re-aggregat|aggregate)/i,
    `${label} must not describe product:status as producing or re-aggregating a verdict`,
  );
  requireMatch(
    block,
    /release:(?:ready|status)[\s\S]{0,240}(?:transition|deprecated|过渡)/i,
    `${label} must describe release:ready/status as transition aliases`,
  );
}

for (const [label, block] of humanCopyableWorkflowBlocks) {
  for (const pattern of HUMAN_DOC_FORBIDDEN_COPYABLE_COMMAND_PATTERNS) {
    forbidMatch(block, pattern, `${label} must not expose internal adapter as a copyable human entrypoint: ${pattern}`);
  }
}

const workflowSurfaceDocContent = new Map<string, string>([
  ['README.md', readme],
  ['DEVELOPMENT.md', development],
  ['docs/user-guides/release-readiness-checklist.md', releaseChecklist],
  ['docs/testing/diagnostic-catalog-v1.md', diagnosticCatalog],
]);
for (const relativePath of DEFAULT_WORKFLOW_SURFACE_DOC_PATHS) {
  const content = workflowSurfaceDocContent.get(relativePath);
  if (!content) {
    failures.push(`workflow surface doc guard is missing content for ${relativePath}`);
    continue;
  }
  for (const violation of findInternalWorkflowReferenceViolations({ relativePath, content })) {
    failures.push(
      `${violation.relativePath}:${violation.lineNumber} internal workflow command reference ${violation.command} must be inside diagnostic, maintainer troubleshooting, or machine-readable report context`,
    );
  }
}

for (const command of listCurrentWorkflowCommands()) {
  if (command.npmScript && !packageJson.scripts?.[command.npmScript]) {
    failures.push(`package.json is missing current workflow script: ${command.npmScript}`);
  }

  if (/^(?:gate:|lane:|backend-real:|release:campaign:full|release:aggregate|verify:)/.test(command.npmScript ?? '') && command.makeTarget) {
    failures.push(`internal workflow adapter must not keep a Make compatibility target: ${command.command}`);
  }

  if (command.makeTarget) {
    requireMatch(makefile, new RegExp(`^${command.makeTarget}:`, 'm'), `Makefile is missing current workflow target: ${command.makeTarget}`);
  }
}

const makefilePhonyBlock = makefile.match(/^\.PHONY:[\s\S]*?\n\n/)?.[0] ?? '';
for (const target of REMOVED_MAKE_COMPAT_TARGETS) {
  forbidMatch(makefile, new RegExp(`^${target}:`, 'm'), `Makefile must not define removed compatibility target: ${target}`);
  forbidMatch(makefilePhonyBlock, new RegExp(`\\b${target}\\b`), `.PHONY must not expose removed compatibility target: ${target}`);
}

for (const diagnostic of CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS) {
  if (diagnostic.command) {
    forbidMatch(
      diagnostic.command,
      /\b(?:npm run (?:gate|lane|backend-real):[a-z0-9:_-]+|RELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full)\b/,
      `diagnostic command truth must not expose internal adapter as copyable command: ${diagnostic.id}`,
    );
  } else if (!diagnostic.internalAdapter || !diagnostic.ownerSurface) {
    failures.push(`diagnostic owner reference must declare internalAdapter and ownerSurface: ${diagnostic.id}`);
  }
}

requireMatch(playwrightConfig, /\bdefaultE2ESpecMatch\b/, 'playwright.config.ts must use the defaultE2ESpecMatch name');
forbidMatch(playwrightConfig, /\bchromiumMvpSpecMatch\b/, 'playwright.config.ts still uses chromiumMvpSpecMatch');
requireMatch(
  playwrightConfig,
  /NEXT_GENERATED_ROOT_MANAGED=1/,
  'playwright.config.ts managed dev server must normalize generated root files explicitly',
);
requireMatch(
  playwrightConfig,
  /managedMockNextDistDir = `artifacts\/mock-lane\/runs\/\$\{managedMockRunId\}\/next-dist`[\s\S]*NEXT_DIST_DIR=\$\{managedMockNextDistDir\}/,
  'playwright.config.ts managed dev server must use an isolated mock-lane NEXT_DIST_DIR',
);
requireMatch(
  playwrightConfig,
  /reuseExistingServer:\s*false/,
  'playwright.config.ts managed dev server must not reuse an unmanaged existing server',
);

requireMatch(visualPolicy, /整页视觉基线/, 'visual baseline policy must define full-page visual baselines');
requireMatch(visualPolicy, /局部视觉基线/, 'visual baseline policy must define focused visual baselines');
requireMatch(visualPolicy, /默认工程门禁/, 'visual baseline policy must explain default engineering gate semantics');
requireMatch(visualPolicy, /视觉验证通道/, 'visual baseline policy must explain visual verification channel semantics');
forbidMatch(visualPolicy, /ignored by git/, 'visual baseline policy still says screenshots are ignored by git');
requireMatch(readme, /lane:visual/, 'README must document lane:visual');
requireMatch(development, /lane:visual/, 'DEVELOPMENT must document lane:visual');
requireMatch(governanceModel, /lane:visual/, 'current engineering governance model must document lane:visual');
requireMatch(governanceModel, /e2e\/visual-baseline-support\.ts/, 'current engineering governance model must identify the visual scene catalog source');
requireMatch(governanceModel, /artifacts\/backend-real\/runs\/<run-id>\/ux-traces/, 'current engineering governance model must identify the default-tier backend-real ux trace bundle root');
requireMatch(governanceModel, /artifacts\/backend-real-visual\/<run-id>\/ux-traces/, 'current engineering governance model must identify the backend-real ux trace bundle root');
requireMatch(testingIndex, /diagnostic-catalog-v1/, 'testing README must index the diagnostic catalog');
requireMatch(testingIndex, /entry path/i, 'testing README must explain where the entry path selector lives');
requireMatch(diagnosticCatalog, /diagnostic commands are not final conclusions/i, 'diagnostic catalog must separate diagnostics from conclusions');
requireMatch(diagnosticCatalog, /lane:mock/, 'diagnostic catalog must include lane:mock as an internal adapter reference');
forbidMatch(diagnosticCatalog, /\bnpm run (?:gate|lane|backend-real):[a-z0-9:_-]+/, 'diagnostic catalog must not present internal gate/lane/backend-real adapters as copyable human defaults');
forbidMatch(diagnosticCatalog, /\bRELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full\b/, 'diagnostic catalog must not present gate:release:full as a copyable human default');
requireMatch(diagnosticCatalog, /npm run test:integration/, 'diagnostic catalog must include integration diagnostics');
requireMatch(diagnosticCatalog, /npm run test:release:precheck/, 'diagnostic catalog must include release precheck diagnostics');
requireMatch(storyTruthGuide, /edit the story markdown first/i, 'story truth guide must explain the story-first edit loop');
requireMatch(storyTruthGuide, /regenerate/i, 'story truth guide must explain regeneration after story edits');
requireMatch(storyTruthGuide, /re-run/i, 'story truth guide must explain rerunning the affected story evidence owner');
requireMatch(userGuidesIndex, /`ui_only`/, 'user guides index must point UI-only readers back to the right entry path');
requireMatch(userGuidesIndex, /`local_manual`/, 'user guides index must point local-manual readers back to the right entry path');
requireMatch(userGuidesIndex, /`release_grade`/, 'user guides index must point product readiness readers back to the right entry path');
requireMatch(releaseChecklist, /preflight/i, 'release checklist must label preflight steps');
requireMatch(releaseChecklist, /evidence owner/i, 'release checklist must label evidence-owner steps');
requireMatch(releaseChecklist, /aggregate readiness check/i, 'release checklist must label the aggregate readiness check step');
requireMatch(releaseChecklist, /CI green/i, 'release checklist must explain what CI green means');
requireMatch(releaseChecklist, /npm run product:ready/, 'release checklist must define product:ready as the human-facing product readiness / handoff entrypoint');
requireMatch(releaseChecklist, /npm run product:status/, 'release checklist must define product:status as the read-only product readiness status entrypoint');
requireMatch(releaseChecklist, /npm run test:unified-deploy:local-kind/, 'release checklist must expose local-kind unified deploy diagnostics');
requireMatch(releaseChecklist, /npm run test:unified-deploy:existing-cluster-smoke/, 'release checklist must expose existing-cluster unified deploy smoke diagnostics');
requireMatch(releaseChecklist, /focused product-flow/, 'release checklist must explain focused product-flow deploy diagnostics');
forbidMatch(releaseChecklist, /local-kind evidence[\s\S]{0,80}(?:part of|belongs to|属于)[\s\S]{0,80}AgentSmith product readiness/i, 'release checklist must not make local-kind evidence part of current AgentSmith product readiness');
requireMatch(verificationCampaigns, /transition-only focused diagnostics[\s\S]{0,80}过渡期专项诊断/i, 'verification campaign guide must describe unified deploy producers as transition-only focused diagnostics / 过渡期专项诊断');
requireMatch(verificationCampaigns, /runtime pending\/readiness/i, 'verification campaign guide must classify repeated Files/Agent Task/AFSCP/read export failures as runtime pending/readiness');
requireMatch(verificationCampaigns, /pending[\s\S]{0,80}releasing[\s\S]{0,80}offline[\s\S]{0,80}not_found/i, 'verification campaign guide must mention runtime readiness convergence states');
requireMatch(verificationCampaigns, /Files restore continuation focused backend-real gate/i, 'verification campaign guide must keep Files restore continuation focused backend-real gate as Product Readiness evidence');
requireMatch(verificationCampaigns, /files_restore_continuation_spec\/runtime-readiness-details\.json/i, 'verification campaign guide must document runtime readiness detail evidence path');
requireMatch(verificationCampaigns, /AGENT_SANDBOX_UNAVAILABLE[\s\S]{0,180}API[\s\S]{0,180}pod-manager[\s\S]{0,180}ASBCP/i, 'verification campaign guide must require AGENT_SANDBOX_UNAVAILABLE owner call summaries');
requireMatch(verificationCampaigns, /runtime_flake[\s\S]{0,180}stability_blocker/i, 'verification campaign guide must preserve runtime flake versus stability blocker classification');
requireMatch(verificationCampaigns, /60_000[\s\S]{0,80}90_000[\s\S]{0,80}120_000[\s\S]{0,80}180_000[\s\S]{0,80}300_000/, 'verification campaign guide must document increasing runtime readiness wait intervals');
forbidMatch(verificationCampaigns, /legacy\/focused diagnostics|legacy focused diagnostics|legacy deploy diagnostics|旧部署诊断/i, 'verification campaign guide must not describe current unified deploy diagnostics as legacy');
forbidMatch(verificationCampaigns, /由 release campaign 编排/i, 'verification campaign guide must not say release campaign orchestrates unified deploy producers');
forbidMatch(verificationCampaigns, /current release[\s\S]{0,80}(?:must|必须)[\s\S]{0,80}unified deploy evidence/i, 'verification campaign guide must not require unified deploy evidence for current release');
requireMatch(releaseKitSplitPlan, /P2\/P3\/P6[\s\S]{0,120}(?:remove or hide|移除或隐藏)[\s\S]{0,160}AgentSmith active status\/workflow/i, 'release-kit split plan must state the transition-only diagnostics exit condition');
requireMatch(gaReleasePlan, /ga-evidence-index\.json[\s\S]{0,180}(?:归档|archive)[\s\S]{0,180}(?:不发独立 verdict|does not issue|not issue|不发\s*verdict)/iu, 'GA release plan must list ga-evidence-index.json as a derived archive index, not an independent verdict');

const currentReleaseBoundaryDocs = [
  readme,
  development,
  verificationCampaigns,
  unifiedDeployContract,
  releaseChecklist,
  gaReleasePlan,
].join('\n');
forbidMatch(currentReleaseBoundaryDocs, /release campaign evidence uses unified deploy lanes/i, 'active docs must not say release campaign evidence uses unified deploy lanes');
forbidMatch(currentReleaseBoundaryDocs, /当前 release campaign 直接绑定[\s\S]{0,120}unified deploy/i, 'active docs must not say the current release campaign directly binds unified deploy');
forbidMatch(currentReleaseBoundaryDocs, /release:ready[\s\S]{0,100}local-kind evidence/i, 'active docs must not make release:ready a local-kind evidence entrypoint');
forbidMatch(currentReleaseBoundaryDocs, /release:ready[\s\S]{0,120}default deploy evidence line/i, 'active docs must not make local-kind the default release:ready deploy evidence line');
forbidMatch(currentReleaseBoundaryDocs, /orchestrate[s]?[\s\S]{0,120}unified deploy evidence lanes/i, 'active docs must not say release:ready orchestrates unified deploy evidence lanes');
forbidMatch(currentReleaseBoundaryDocs, /release:ready[\s\S]{0,120}unified deploy evidence lanes/i, 'active docs must not tie release:ready to unified deploy evidence lanes');
requireMatch(currentReleaseBoundaryDocs, /transition-only focused diagnostics[\s\S]{0,80}过渡期专项诊断/i, 'active docs must describe current unified deploy diagnostics as transition-only focused diagnostics / 过渡期专项诊断');
forbidMatch(currentReleaseBoundaryDocs, /legacy\/focused diagnostics|legacy focused diagnostics|legacy deploy diagnostics|旧部署诊断/i, 'active docs must not describe current unified deploy diagnostics as legacy');
forbidMatch(currentReleaseBoundaryDocs, /release kit evidence[\s\S]{0,80}映射回当前 release campaign/i, 'active docs must not map release-kit evidence back into the current AgentSmith release campaign');
forbidMatch(currentReleaseBoundaryDocs, /release:ready[\s\S]{0,80}(?:已消费|consume|consumes|consumed)[\s\S]{0,80}(?:new )?deploy evidence/i, 'active docs must not say release:ready consumes new deploy evidence');
forbidMatch(currentReleaseBoundaryDocs, /future campaign[\s\S]{0,80}consume/i, 'active docs must not imply a future AgentSmith campaign will consume unified deploy diagnostics');
requireMatch(releaseChecklist, /internal adapter/i, 'release checklist must label old gate/lane/backend-real commands as internal adapters');
forbidMatch(releaseChecklist, /\bnpm run (?:gate|lane|backend-real):[a-z0-9:_-]+/, 'release checklist must not present internal gate/lane/backend-real adapters as copyable human defaults');
forbidMatch(releaseChecklist, /\bnpm run release:campaign:full\b/, 'release checklist must not present release:campaign:full as a copyable human default');
forbidMatch(releaseChecklist, /\bRELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full\b/, 'release checklist must not present gate:release:full as a copyable human default');
requireMatch(qualityGatesWorkflow, /lane-visual:\n(?:[ \t].*\n)*[ \t]+needs:\s*gate-fast/, 'quality-gates CI must run lane-visual after gate-fast');
forbidMatch(qualityGatesWorkflow, /lane-visual:\n(?:[ \t].*\n)*[ \t]+needs:\s*gate-default/, 'quality-gates CI must not require gate-default before lane-visual');
forbidMatch(
  `${contractsCheckWorkflow}\n${qualityGatesWorkflow}`,
  /\bmake (?:gate-(?:fast|default|release)|lane-(?:mock|visual|real-core|real-release)|backend-real-(?:reset|bootstrap|ready|run|report))\b/,
  'CI workflows must call npm internal adapters directly instead of removed Make compatibility targets',
);

const singleShardMockLaneScripts = [
  'test:e2e:lane:mock:smoke',
  'test:e2e:lane:mock:visual',
  'test:e2e:lane:mock:visual:update',
] as const;

for (const scriptName of singleShardMockLaneScripts) {
  const scriptValue = packageJson.scripts?.[scriptName];
  if (!scriptValue) {
    failures.push(`package.json is missing required mock lane script: ${scriptName}`);
    continue;
  }
  if (!/run-mock-lane-playwright\.sh/.test(scriptValue)) {
    failures.push(`${scriptName} must use scripts/run-mock-lane-playwright.sh as the canonical mock lane launcher`);
  }
}

const multiShardMockLaneAggregateScripts = [
  {
    scriptName: 'test:e2e:lane:mock:chromium',
    shards: 'chromium,chromium-serial',
  },
] as const;

for (const { scriptName, shards } of multiShardMockLaneAggregateScripts) {
  const scriptValue = packageJson.scripts?.[scriptName];
  if (!scriptValue) {
    failures.push(`package.json is missing required mock lane script: ${scriptName}`);
    continue;
  }
  if (!/run-mock-lane-session\.sh/.test(scriptValue) || !scriptValue.includes(`--shards=${shards}`)) {
    failures.push(`${scriptName} must use scripts/run-mock-lane-session.sh with --shards=${shards} so the aggregate chromium lane shares one mock session`);
  }
  if (/run-mock-lane-playwright\.sh/.test(scriptValue)) {
    failures.push(`${scriptName} must not chain scripts/run-mock-lane-playwright.sh; single-shard diagnostics own that launcher`);
  }
}

const fullMockLaneWithVisualScript = packageJson.scripts?.['test:e2e:lane:mock:full:with-visual'];
if (!fullMockLaneWithVisualScript || !/run-mock-lane-session\.sh/.test(fullMockLaneWithVisualScript) || !/--preset=with-visual/.test(fullMockLaneWithVisualScript)) {
  failures.push('test:e2e:lane:mock:full:with-visual must use the shared mock lane session adapter with visual enabled');
}

requireMatch(
  releaseLocalPrecheck,
  /clear_runtime_stack_env[\s\S]*resolve_loopback_runtime_stack/,
  'release-local-precheck must clear inherited runtime stack addresses before rebuilding its isolated local stack',
);
requireMatch(
  releaseLocalPrecheck,
  /cleanup_gate_ports "\$\{API_PORT\}" "\$\{WEB_PORT\}" "release-local-precheck"/,
  'release-local-precheck must clean stale fixed ports before starting its local API/Web stack',
);
requireMatch(
  releaseLocalPrecheck,
  /PUBLIC_API_BASE_URL="\$\{PUBLIC_API_BASE_URL:-\$\{INTEGRATION_API_BASE\}\/api\/v1\}"/,
  'release-local-precheck must pass a trusted PUBLIC_API_BASE_URL when starting the local API for agent websocket/resource proxy flows',
);
requireMatch(
  releaseLocalPrecheck,
  /MONGO_PORT="\$\{MONGO_PORT:-\$\{INTEGRATION_MONGO_PORT:-17017\}\}"/,
  'release-local-precheck must derive Mongo port from the backend-real integration port before constructing MONGO_URL',
);
requireMatch(
  releaseLocalPrecheck,
  /KEYCLOAK_PORT="\$\{KEYCLOAK_PORT:-\$\{INTEGRATION_KEYCLOAK_PORT:-18080\}\}"/,
  'release-local-precheck must derive Keycloak port from the backend-real integration port',
);
for (const failure of validateReleasePrecheckEvidenceOwnership()) {
  failures.push(
    `release-local-precheck moved-check evidence ownership invalid: ${failure.movedCheckId}`
    + `${failure.ownerStepId ? `/${failure.ownerStepId}` : ''}: ${failure.reason}`,
  );
}
requireMatch(
  releaseLocalPrecheck,
  /deps_ready\(\)[\s\S]*tcp_ready "127\.0\.0\.1" "\$\{POSTGRES_PORT\}"[\s\S]*tcp_ready "127\.0\.0\.1" "\$\{MONGO_PORT\}"[\s\S]*local_redis_auth_ping "127\.0\.0\.1" "\$\{REDIS_PORT\}" "\$\{REDIS_PASSWORD\}"[\s\S]*minio\/health\/live/,
  'release-local-precheck must keep lightweight dependency availability checks with Redis auth ping',
);
requireMatch(
  releaseLocalPrecheck,
  /api_ready=0[\s\S]*"\$\{INTEGRATION_API_BASE\}\/api\/v1\/workspaces"[\s\S]*web_ready=0[\s\S]*"\$\{WEB_BASE_URL\}\/en-US\/login\/workspace"/,
  'release-local-precheck must keep lightweight API and Web readiness checks',
);
requireMatch(
  releaseLocalPrecheck,
  /protocol\/openid-connect\/token[\s\S]*ACCESS_TOKEN[\s\S]*"\$\{INTEGRATION_API_BASE\}\/api\/v1\/me\/profile"[\s\S]*public-auth gate passed/,
  'release-local-precheck must keep lightweight public auth token smoke',
);
requireMatch(
  releaseLocalPrecheck,
  /RELEASE_PRECHECK_EVIDENCE_DIR="\$\{RELEASE_CAMPAIGN_ROOT\}\/release-local-precheck"[\s\S]*write_precheck_success_report\(\)[\s\S]*agentsmith\.release-local-precheck\/v1[\s\S]*write_precheck_success_report[\s\S]*PRECHECK_STATUS=0/,
  'release-local-precheck must write a successful lightweight precheck summary into the release campaign root',
);
for (const movedCheck of RELEASE_PRECHECK_MOVED_CHECK_EVIDENCE_OWNERSHIP) {
  if (movedCheck.formalOwners.length === 0) {
    failures.push(`release-local-precheck moved-check mapping ${movedCheck.id} must have formal product readiness evidence owners`);
  }
}
forbidMatch(
  releaseLocalPrecheck,
  /run_clean npx playwright test|playwright test|e2e\/integration-(?:system-admin-entry|workspace-public-login|workspace-entry|workspace-publish-usable|workspace-settings-directory)\.spec\.ts/,
  'release-local-precheck must not run Playwright product scenarios; product readiness evidence ownership is mapped separately',
);
forbidMatch(
  releaseLocalPrecheck,
  /run_agent_task_backend_real_precheck|run-internal-agent-task-real-gate\.sh|--skills-runtime|--files-restore-continue|run-file-library-real-gate\.sh|test:agent-task:backend-real|test:agent-runners:lifecycle:evidence/,
  'release-local-precheck must not run Agent Task, Files, or Runner business assertions directly',
);
requireMatch(
  integrationE2EFull,
  /"\$\{PLAYWRIGHT_BASE_URL\}\/api\/test\/system\/workspaces\/seed"[\s\S]*gate_record_preflight_check "\$\{INTEGRATION_LOG_DIR\}" "web_test_routes" "passed"/,
  'run-integration-e2e-full must verify web test routes before Playwright so BASE_URL cannot silently target a stale/manual web server',
);
requireMatch(
  internalAgentTaskRealGate,
  /resolve_internal_spec_port_pair\(\)[\s\S]*INTERNAL_REAL_SPEC_WEB_PORT_BASE:-33000[\s\S]*run_internal_spec_grep e2e\/integration-context-store-isolation\.spec\.ts "member context stays private between workspace members\|task context stays private to the task owner within the same workspace" 23079 33079/,
  'internal Agent Task real gate must allocate isolated Context Store ports away from local-manual web defaults',
);
forbidMatch(
  internalAgentTaskRealGate,
  /run_internal_spec_grep e2e\/integration-context-store-isolation\.spec\.ts [^\n]*\s3101(?:\s|\|\|)/,
  'internal Agent Task real gate must not run nested Context Store isolation on local-manual web port 3101',
);

const defaultMockE2EScript = packageJson.scripts?.['test:e2e'];
if (!defaultMockE2EScript || !/run-mock-lane-session\.sh/.test(defaultMockE2EScript) || !/--preset=default/.test(defaultMockE2EScript)) {
  failures.push('test:e2e must run the shared mock lane session adapter with the default shard preset');
}

const fullMockE2EScript = packageJson.scripts?.['test:e2e:all'];
if (!fullMockE2EScript || !/run-mock-lane-session\.sh/.test(fullMockE2EScript) || !/--preset=with-visual/.test(fullMockE2EScript)) {
  failures.push('test:e2e:all must run the shared mock lane session adapter with visual enabled');
}

requireMatch(constitution, /视觉验证属于独立证据通道/, 'constitution must describe visual verification as an independent evidence channel');
requireMatch(constitution, /源码根目录不得承载 lane 运行态/, 'constitution must forbid runtime coordination state from living in the source root');
requireMatch(constitution, /环境失败不得伪装成功能回归/, 'constitution must keep infra failures separate from product regressions');
requireMatch(constitution, /ownership 未证实前不得 destructive cleanup/, 'constitution must require authority before destructive cleanup');
forbidMatch(constitution, /smoke \+ chromium/, 'constitution still uses legacy smoke + chromium wording');

const requiredProductTerminologyChecks: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /Model/, message: 'product terminology contract must define Model as the Chat selector' },
  { pattern: /Endpoint/, message: 'product terminology contract must define Endpoint' },
  { pattern: /Agent tasks/, message: 'product terminology contract must define Agent tasks' },
  { pattern: /Agent Runners/, message: 'product terminology contract must define Agent Runners' },
  { pattern: /Agent Runner/, message: 'product terminology contract must define Agent Runner' },
  { pattern: /shared project library/, message: 'product terminology contract must define Files as the shared project library' },
  { pattern: /Shared context/, message: 'product terminology contract must define Shared context' },
  { pattern: /Project secrets/, message: 'product terminology contract must define Project secrets' },
  { pattern: /Workspace integrations/, message: 'product terminology contract must define Workspace integrations' },
  { pattern: /Personal connections/, message: 'product terminology contract must define Personal connections' },
  { pattern: /Access guide/, message: 'product terminology contract must define Access guide' },
  { pattern: /Sidebar/, message: 'product terminology contract must define Sidebar as the cross-product IA truth' },
  { pattern: /Overview/, message: 'product terminology contract must define the Overview boundary' },
  { pattern: /Settings/, message: 'product terminology contract must define the Settings boundary' },
  { pattern: /Sources/, message: 'product terminology contract must explain that Sources is not the current product-facing module name' },
];

for (const check of requiredProductTerminologyChecks) {
  requireMatch(productTerminology, check.pattern, check.message);
}

failures.push(...findUserGuideGaBoundaryViolations({
  alertCenter: alertCenterGuide,
  auditUsageReports: auditUsageReportsGuide,
  personalConnections: personalConnectionsGuide,
}));

requireMatch(
  productTerminology,
  /must not return to being a work-link or governance-link hub/,
  'product terminology contract must forbid Overview from becoming a navigation hub again',
);
requireMatch(
  productTerminology,
  /must not return to being a governance launcher/,
  'product terminology contract must forbid Settings from becoming a governance launcher again',
);
requireMatch(
  productTerminology,
  /must remain a formal governance object and formal navigation item/,
  'product terminology contract must require Shared context to stay visible in formal governance IA',
);
requireMatch(
  productTerminology,
  /Product-facing Chat UI must use `Model`/,
  'product terminology contract must require Model as the Chat selector',
);
requireMatch(
  productTerminology,
  /Agent task dispatch is backend-owned and resolves the eligible default Agent Runner/,
  'product terminology contract must keep Agent Runner selection backend-owned',
);

const verificationCatalog = buildVerificationCatalog({
  generatedAt: '2026-04-27T12:00:00.000Z',
});
const currentPureChecks = listCurrentPureCheckIdentities();
const currentPureCheckDigestRuleIds = new Set(listCurrentPureCheckInputDigestRules().map((rule) => rule.id));
const pureCheckCachePolicyCounts = currentPureChecks.reduce<Record<'shadow' | 'disabled', number>>(
  (counts, check) => ({
    ...counts,
    [check.cache_policy]: counts[check.cache_policy] + 1,
  }),
  {
    shadow: 0,
    disabled: 0,
  },
);
const pureCheckSourceTruth = verificationCatalog.source_truth.current_pure_check_identity_manifest;
const pureCheckProjection = verificationCatalog.p2_model_projection.pure_checks;

if (pureCheckSourceTruth.schema !== CURRENT_PURE_CHECK_IDENTITY_MANIFEST_SCHEMA) {
  failures.push('verification catalog source truth must include the current pure check identity manifest schema');
}
if (pureCheckSourceTruth.version !== CURRENT_PURE_CHECK_IDENTITY_MANIFEST_VERSION) {
  failures.push('verification catalog source truth must include the current pure check identity manifest version');
}
if (stableJson(pureCheckSourceTruth.check_ids) !== stableJson(CURRENT_PURE_CHECK_IDS)) {
  failures.push('verification catalog source truth must preserve current pure check ids');
}
if (pureCheckSourceTruth.check_count !== currentPureChecks.length) {
  failures.push('verification catalog source truth must include the current pure check count');
}
if (pureCheckSourceTruth.digest_rule_count !== currentPureCheckDigestRuleIds.size) {
  failures.push('verification catalog source truth must include the current pure check digest rule count');
}
if (stableJson(pureCheckSourceTruth.cache_policy_counts) !== stableJson(pureCheckCachePolicyCounts)) {
  failures.push('verification catalog source truth must include the current pure check cache policy distribution');
}
if (pureCheckSourceTruth.claim_instances_included !== false || pureCheckSourceTruth.commands_executed !== false) {
  failures.push('verification catalog source truth must not include claim instances or execute pure checks');
}
if (
  pureCheckProjection.schema !== CURRENT_PURE_CHECK_IDENTITY_MANIFEST_SCHEMA
  || pureCheckProjection.version !== CURRENT_PURE_CHECK_IDENTITY_MANIFEST_VERSION
  || stableJson(pureCheckProjection.check_ids) !== stableJson(CURRENT_PURE_CHECK_IDS)
  || pureCheckProjection.check_count !== currentPureChecks.length
  || pureCheckProjection.digest_rule_count !== currentPureCheckDigestRuleIds.size
  || stableJson(pureCheckProjection.cache_policy_counts) !== stableJson(pureCheckCachePolicyCounts)
  || pureCheckProjection.claim_instances_included !== false
  || pureCheckProjection.commands_executed !== false
) {
  failures.push('verification catalog P2 projection must mirror pure check identity manifest metadata without claim reuse');
}
for (const check of pureCheckProjection.checks) {
  if (check.path_glob_count <= 0) {
    failures.push(`verification catalog pure check projection has empty path glob count: ${check.check_id}`);
  }
  if (check.cache_policy !== 'shadow' && check.cache_policy !== 'disabled') {
    failures.push(`verification catalog pure check projection has unsafe cache policy: ${check.check_id}`);
  }
  if (!currentPureCheckDigestRuleIds.has(check.digest_rule_id)) {
    failures.push(`verification catalog pure check projection references unknown digest rule: ${check.check_id}`);
  }
}

if (failures.length > 0) {
  console.error('[contracts] engineering governance check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] engineering governance check passed');
