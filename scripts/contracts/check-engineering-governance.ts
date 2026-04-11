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
const visualPolicy = read('docs/UXUI/01-通用规范/visual-baseline-policy-v1.md');
const contractsIndex = read('docs/contracts/README.md');
const productTerminology = read('docs/contracts/product-terminology.md');
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

requireMatch(readme, /current-engineering-governance-model\.md/, 'README is missing the current engineering governance model reference');
requireMatch(development, /current-engineering-governance-model\.md/, 'DEVELOPMENT is missing the current engineering governance model reference');
requireMatch(baseline, /current-engineering-governance-model\.md/, 'CURRENT_BASELINE is missing the current engineering governance model reference');
requireMatch(readme, /current-workflow-manifest\.ts/, 'README is missing the current workflow manifest reference');
requireMatch(development, /current-workflow-manifest\.ts/, 'DEVELOPMENT is missing the current workflow manifest reference');
requireMatch(governanceModel, /current-workflow-manifest\.ts/, 'current engineering governance model is missing the workflow manifest reference');
requireMatch(readme, /current-gate-manifest\.ts/, 'README is missing the current gate manifest reference');
requireMatch(development, /current-gate-manifest\.ts/, 'DEVELOPMENT is missing the current gate manifest reference');
requireMatch(governanceModel, /current-gate-manifest\.ts/, 'current engineering governance model is missing the gate manifest reference');
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
  requireMatch(readme, new RegExp(escapedCommand), `README is missing recommended current workflow command: ${command.command}`);
  requireMatch(development, new RegExp(escapedCommand), `DEVELOPMENT is missing recommended current workflow command: ${command.command}`);
}

for (const command of listCurrentWorkflowCommands()) {
  const escapedCommand = command.command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  requireMatch(governanceModel, new RegExp(escapedCommand), `current engineering governance model is missing current workflow command: ${command.command}`);

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
