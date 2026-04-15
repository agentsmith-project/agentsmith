import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CURRENT_WORKFLOW_TOP_LEVEL_TERMS,
  listCurrentWorkflowCommands,
  listRecommendedCurrentWorkflowCommands,
} from '../governance/current-workflow-manifest';

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
const testingIndex = read('docs/testing/README.md');
const agentsDoc = read('AGENTS.md');
const visualPolicy = read('docs/testing/visual-baseline-policy-v1.md');
const contractsIndex = read('docs/contracts/README.md');
const gateManifestContract = read('docs/contracts/current-gate-manifest-contract.md');
const gateResultContract = read('docs/contracts/current-gate-result-schema-contract.md');
const productTerminology = read('docs/contracts/product-terminology.md');
const demoDeployReset = read('scripts/demo-deploy/reset.sh');
const clusterDeployReset = read('scripts/cluster-deploy/reset.sh');
const clusterRehearsalReset = read('scripts/scenarios/cluster-rehearsal/reset.sh');
const clusterRehearsalCommon = read('scripts/scenarios/cluster-rehearsal/common.sh');
const clusterRehearsalUp = read('scripts/scenarios/cluster-rehearsal/up.sh');
const releaseLocalPrecheck = read('scripts/run-release-local-precheck.sh');
const playwrightConfig = read('playwright.config.ts');
const makefile = read('Makefile');
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

function extractBlock(content: string, startMarker: string, endMarker: string, label: string): string {
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    failures.push(`${label} is missing its generated block markers`);
    return '';
  }

  return content.slice(startIndex + startMarker.length, endIndex);
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
requireMatch(gateManifestContract, /stable gate id/i, 'current gate manifest contract must explain stable gate ids');
requireMatch(gateManifestContract, /adapter surface/i, 'current gate manifest contract must explain adapter surfaces');
requireMatch(gateManifestContract, /execution target/i, 'current gate manifest contract must explain structured execution targets');
requireMatch(gateManifestContract, /operator hint/i, 'current gate manifest contract must describe command as an operator hint');
requireMatch(gateResultContract, /result\.json/, 'current gate result schema contract must explain canonical result.json output');
requireMatch(gateResultContract, /failure_class/, 'current gate result schema contract must define failure_class');
requireMatch(governanceModel, /story evidence/i, 'current engineering governance model must describe story evidence as part of gate truth');
requireMatch(governanceModel, /visual_scene_catalog/, 'current engineering governance model must define visual_scene_catalog ownership');
requireMatch(governanceModel, /ux_trace_bundle/, 'current engineering governance model must define ux_trace_bundle ownership');
requireMatch(governanceModel, /test:backend-real:core/, 'current engineering governance model must describe test:backend-real:core as a default-tier backend-real story-evidence owner');
requireMatch(governanceModel, /lane:backend-real:core/, 'current engineering governance model must describe lane:backend-real:core as a default-tier backend-real story-evidence owner');
requireMatch(governanceModel, /execution target/i, 'current engineering governance model must describe structured execution targets');
requireMatch(governanceModel, /operator hint/i, 'current engineering governance model must describe command as an operator hint');
requireMatch(development, /operator hint/i, 'DEVELOPMENT must describe command as an operator hint');
requireMatch(contractsIndex, /product-terminology\.md/, 'contracts README is missing the product terminology contract reference');
requireMatch(contractsIndex, /Execution target/, 'contracts README must describe Execution target as part of the current terminology contract');
requireMatch(contractsIndex, /Shared context/, 'contracts README must describe Shared context as part of the current terminology contract');

for (const term of CURRENT_WORKFLOW_TOP_LEVEL_TERMS) {
  requireMatch(readme, new RegExp(term), `README is missing current workflow term: ${term}`);
  requireMatch(development, new RegExp(term), `DEVELOPMENT is missing current workflow term: ${term}`);
  requireMatch(governanceModel, new RegExp(term), `current engineering governance model is missing current workflow term: ${term}`);
}

for (const command of listRecommendedCurrentWorkflowCommands()) {
  const escapedCommand = command.command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  requireMatch(readmeWorkflowBlock, new RegExp(escapedCommand), `README current workflow block is missing recommended command: ${command.command}`);
  requireMatch(developmentWorkflowBlock, new RegExp(escapedCommand), `DEVELOPMENT current workflow block is missing recommended command: ${command.command}`);
}

for (const command of listCurrentWorkflowCommands()) {
  const escapedCommand = command.command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  requireMatch(governanceWorkflowBlock, new RegExp(escapedCommand), `current engineering governance model workflow block is missing command: ${command.command}`);

  if (command.npmScript && !packageJson.scripts?.[command.npmScript]) {
    failures.push(`package.json is missing current workflow script: ${command.npmScript}`);
  }

  if (command.makeTarget) {
    requireMatch(makefile, new RegExp(`^${command.makeTarget}:`, 'm'), `Makefile is missing current workflow target: ${command.makeTarget}`);
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

const requiredMockLaneScripts = [
  'test:e2e:lane:mock:smoke',
  'test:e2e:lane:mock:chromium',
  'test:e2e:lane:mock:visual',
  'test:e2e:lane:mock:visual:update',
  'test:e2e:lane:mock:full:with-visual',
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

requireMatch(clusterDeployReset, /kubernetes resources were left untouched/, 'cluster-deploy reset must keep its non-destructive target-host semantics',);
requireMatch(clusterRehearsalReset, /scenario_local_kind_cleanup/, 'cluster-rehearsal reset must destroy its scenario-owned local kind world before delegating to cluster-deploy reset',);
requireMatch(clusterRehearsalCommon, /CLUSTER_REHEARSAL_GENERATED_DIR="\$\{CLUSTER_REHEARSAL_ROOT\}\/state\/generated"/, 'cluster-rehearsal common must keep its generated-state root under state/generated',);
requireMatch(clusterRehearsalCommon, /CLUSTER_DEPLOY_SHARED_ADMIN_READY_ENV="\$\{CLUSTER_REHEARSAL_GENERATED_DIR\}\/admin-ready\.env"/, 'cluster-rehearsal common must route the admin-ready marker into generated state',);
requireMatch(clusterRehearsalCommon, /CLUSTER_DEPLOY_ADMIN_HANDOFF_DIR="\$\{CLUSTER_REHEARSAL_GENERATED_DIR\}\/admin-handoff"/, 'cluster-rehearsal common must route the handoff package into generated state',);
requireMatch(clusterRehearsalUp, /CLUSTER_DEPLOY_SHARED_ADMIN_READY_ENV/, 'cluster-rehearsal up must operate on the generated admin-ready path',);
requireMatch(demoDeployReset, /local_kind_world_destroy/, 'demo-deploy reset must reuse the shared local kind world cleanup helper',);
forbidMatch(demoDeployReset, /kind delete cluster --name agentsmith|grep -qx 'agentsmith'/, 'demo-deploy reset must not hardcode the local kind cluster name',);

const requiredScenarioCommandLockedScripts = [
  'scripts/scenarios/demo-rehearsal/up.sh',
  'scripts/scenarios/demo-rehearsal/down.sh',
  'scripts/scenarios/demo-rehearsal/reset.sh',
  'scripts/scenarios/demo-rehearsal/bootstrap.sh',
  'scripts/scenarios/demo-rehearsal/verify.sh',
  'scripts/scenarios/demo-rehearsal/report.sh',
  'scripts/scenarios/cluster-rehearsal/up.sh',
  'scripts/scenarios/cluster-rehearsal/down.sh',
  'scripts/scenarios/cluster-rehearsal/reset.sh',
  'scripts/scenarios/cluster-rehearsal/bootstrap.sh',
  'scripts/scenarios/cluster-rehearsal/verify.sh',
  'scripts/scenarios/cluster-rehearsal/report.sh',
] as const;

for (const scriptPath of requiredScenarioCommandLockedScripts) {
  const script = read(scriptPath);
  requireMatch(
    script,
    /acquire_scenario_command_lock/,
    `${scriptPath} must acquire a scenario command lock before mutating scenario state`,
  );
  requireMatch(
    script,
    /arm_scenario_command_lock_cleanup/,
    `${scriptPath} must arm scenario command lock cleanup`,
  );
}

const defaultMockE2EScript = packageJson.scripts?.['test:e2e'];
if (!defaultMockE2EScript || !/test:e2e:lane:mock:smoke/.test(defaultMockE2EScript) || !/test:e2e:lane:mock:chromium/.test(defaultMockE2EScript)) {
  failures.push('test:e2e must delegate to the canonical mock smoke and chromium lane scripts');
}

const fullMockE2EScript = packageJson.scripts?.['test:e2e:all'];
if (!fullMockE2EScript || !/test:e2e\b/.test(fullMockE2EScript) || !/test:e2e:lane:mock:visual/.test(fullMockE2EScript)) {
  failures.push('test:e2e:all must compose the canonical mock e2e script with the visual lane script');
}

requireMatch(constitution, /视觉验证属于独立证据通道/, 'constitution must describe visual verification as an independent evidence channel');
requireMatch(constitution, /源码根目录不得承载 lane 运行态/, 'constitution must forbid runtime coordination state from living in the source root');
requireMatch(constitution, /环境失败不得伪装成功能回归/, 'constitution must keep infra failures separate from product regressions');
requireMatch(constitution, /ownership 未证实前不得 destructive cleanup/, 'constitution must require authority before destructive cleanup');
forbidMatch(constitution, /smoke \+ chromium/, 'constitution still uses legacy smoke + chromium wording');

const requiredProductTerminologyChecks: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /Execution target/, message: 'product terminology contract must define Execution target' },
  { pattern: /Endpoint/, message: 'product terminology contract must define Endpoint' },
  { pattern: /Agent/, message: 'product terminology contract must define Agent' },
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
  /do not describe `Endpoint` and `Agent` as interchangeable model sources/,
  'product terminology contract must forbid collapsing Endpoint and Agent into generic model-source wording',
);
requireMatch(
  productTerminology,
  /must not be described as a second model catalog or a generic provider picker/,
  'product terminology contract must explicitly forbid describing Execution target as a generic provider picker',
);

if (failures.length > 0) {
  console.error('[contracts] engineering governance check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] engineering governance check passed');
