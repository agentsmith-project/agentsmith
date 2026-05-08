import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CURRENT_WORKFLOW_DIAGNOSTIC_COMMANDS,
  CURRENT_WORKFLOW_TOP_LEVEL_TERMS,
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
import { buildVerificationCatalog } from '../governance/verification-catalog';

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
const releaseChecklist = read('docs/user-guides/release-readiness-checklist.md');
const testingIndex = read('docs/testing/README.md');
const diagnosticCatalog = read('docs/testing/diagnostic-catalog-v1.md');
const storyTruthGuide = read('docs/testing/story-source-of-truth-and-generated-specs.md');
const agentsDoc = read('AGENTS.md');
const visualPolicy = read('docs/testing/visual-baseline-policy-v1.md');
const contractsIndex = read('docs/contracts/README.md');
const gateManifestContract = read('docs/contracts/current-gate-manifest-contract.md');
const gateResultContract = read('docs/contracts/current-gate-result-schema-contract.md');
const productTerminology = read('docs/contracts/product-terminology.md');
const releaseLocalPrecheck = read('scripts/run-release-local-precheck.sh');
const playwrightConfig = read('playwright.config.ts');
const makefile = read('Makefile');
const contractsCheckWorkflow = read('.github/workflows/contracts-check.yml');
const qualityGatesWorkflow = read('.github/workflows/quality-gates.yml');
const governanceModel = read(governanceDoc);
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

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
  requireMatch(block, /release:status[\s\S]*read-only/i, `${label} must describe release:status as read-only`);
  forbidMatch(
    block,
    /release:status[\s\S]{0,120}(?:verdict|re-aggregat|aggregate)/i,
    `${label} must not describe release:status as producing or re-aggregating a verdict`,
  );
}

for (const [label, block] of humanCopyableWorkflowBlocks) {
  for (const pattern of HUMAN_DOC_FORBIDDEN_COPYABLE_COMMAND_PATTERNS) {
    forbidMatch(block, pattern, `${label} must not expose internal adapter as a copyable human entrypoint: ${pattern}`);
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
requireMatch(diagnosticCatalog, /diagnostic commands are not final verdicts/i, 'diagnostic catalog must separate diagnostics from verdicts');
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
requireMatch(userGuidesIndex, /`release_grade`/, 'user guides index must point release-grade readers back to the right entry path');
requireMatch(releaseChecklist, /preflight/i, 'release checklist must label preflight steps');
requireMatch(releaseChecklist, /evidence owner/i, 'release checklist must label evidence-owner steps');
requireMatch(releaseChecklist, /terminal verdict/i, 'release checklist must label the terminal verdict step');
requireMatch(releaseChecklist, /CI green/i, 'release checklist must explain what CI green means');
requireMatch(releaseChecklist, /npm run release:ready/, 'release checklist must define release:ready as the human-facing full release entrypoint');
requireMatch(releaseChecklist, /npm run release:status/, 'release checklist must define release:status as the read-only release status entrypoint');
requireMatch(releaseChecklist, /npm run test:unified-deploy:local-kind/, 'release checklist must expose local-kind unified deploy evidence');
requireMatch(releaseChecklist, /npm run test:unified-deploy:existing-cluster-smoke/, 'release checklist must expose existing-cluster unified deploy smoke evidence');
requireMatch(releaseChecklist, /focused product-flow/, 'release checklist must explain focused product-flow evidence');
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

const requiredMockLaneScripts = [
  'test:e2e:lane:mock:smoke',
  'test:e2e:lane:mock:chromium',
  'test:e2e:lane:mock:visual',
  'test:e2e:lane:mock:visual:update',
] as const;

for (const scriptName of requiredMockLaneScripts) {
  const scriptValue = packageJson.scripts?.[scriptName];
  if (!scriptValue) {
    failures.push(`package.json is missing required mock lane script: ${scriptName}`);
    continue;
  }
  if (!/run-mock-lane-playwright\.sh/.test(scriptValue)) {
    failures.push(`${scriptName} must use scripts/run-mock-lane-playwright.sh as the canonical mock lane launcher`);
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
