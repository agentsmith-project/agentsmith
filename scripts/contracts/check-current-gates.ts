import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CURRENT_GATE_DOCUMENT_FILES,
  CURRENT_GATE_MANIFEST,
  findCurrentGateDefinition,
} from '../governance/current-gate-manifest';

const rootDir = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function readJson(relativePath: string): unknown {
  return JSON.parse(read(relativePath)) as unknown;
}

function requireMatch(content: string, pattern: RegExp, message: string, failures: string[]): void {
  if (!pattern.test(content)) {
    failures.push(message);
  }
}

function forbidMatch(content: string, pattern: RegExp, message: string, failures: string[]): void {
  if (pattern.test(content)) {
    failures.push(message);
  }
}

const packageJson = readJson('package.json') as { scripts?: Record<string, string> };
const workflow = read('.github/workflows/quality-gates.yml');
const readme = read('README.md');
const development = read('DEVELOPMENT.md');
const governanceModel = read('docs/current-engineering-governance-model.md');
const gateContract = read('docs/contracts/current-gate-manifest-contract.md');
const workspaceDefaultChecklist = read('docs/user-guides/workspace-project-default-engineering-gate-checklist.md');
const governanceDefaultChecklist = read('docs/user-guides/governance-default-engineering-gate-checklist.md');
const releaseChecklist = read('docs/user-guides/release-readiness-checklist.md');
const workspaceDefaultGate = read('scripts/workspace-project-default-gate.sh');
const governanceDefaultGate = read('scripts/governance-default-gate.sh');
const backendRealRun = read('scripts/backend-real-run.sh');
const backendRealFullGate = read('scripts/backend-real-full-gate.sh');
const integrationE2EFull = read('scripts/run-integration-e2e-full.sh');

const failures: string[] = [];

for (const definition of CURRENT_GATE_MANIFEST) {
  const actualCommand = packageJson.scripts?.[definition.npmScript];
  if (actualCommand !== definition.command) {
    failures.push(`package.json script ${definition.npmScript} must equal: ${definition.command}`);
  }
  if (definition.storyEvidencePolicy === 'required' && definition.storyEvidenceKinds.length === 0) {
    failures.push(`${definition.npmScript} must declare at least one required story evidence kind`);
  }
  if (definition.storyEvidencePolicy === 'required' && definition.storyEvidenceArtifacts.length === 0) {
    failures.push(`${definition.npmScript} must declare required story evidence artifact roots`);
  }
  if (definition.storyEvidenceKinds.includes('visual_scene_catalog') && !definition.storyEvidenceSceneSource) {
    failures.push(`${definition.npmScript} must declare its visual scene source when it owns visual_scene_catalog evidence`);
  }
}

const gateDefault = findCurrentGateDefinition('gate:default');
const laneVisual = findCurrentGateDefinition('lane:visual');
const testVisual = findCurrentGateDefinition('test:visual');
const backendRealCore = findCurrentGateDefinition('lane:backend-real:core');
const laneDemoRehearsal = findCurrentGateDefinition('lane:demo-rehearsal');
const laneClusterRehearsal = findCurrentGateDefinition('lane:cluster-rehearsal');
const gateReleaseFull = findCurrentGateDefinition('gate:release:full');

if (!gateDefault || !laneVisual || !testVisual || !backendRealCore || !laneDemoRehearsal || !laneClusterRehearsal || !gateReleaseFull) {
  failures.push('current gate manifest is missing required default/visual/backend-real/rehearsal definitions');
}

requireMatch(workspaceDefaultGate, /e2e\/visual\.spec\.ts[\s\S]*--project=visual[\s\S]*--grep /, 'workspace-project default gate must keep targeted visual coverage with --grep', failures);
requireMatch(governanceDefaultGate, /e2e\/visual\.spec\.ts[\s\S]*--project=visual[\s\S]*--grep /, 'governance default gate must keep targeted visual coverage with --grep', failures);
forbidMatch(workspaceDefaultGate, /npm run test:visual/, 'workspace-project default gate must not delegate to the full visual lane', failures);
forbidMatch(governanceDefaultGate, /npm run test:visual/, 'governance default gate must not delegate to the full visual lane', failures);
requireMatch(workspaceDefaultGate, /source "\$\{ROOT_DIR\}\/scripts\/lib\/backend-real-gate-ports\.sh"/, 'workspace-project default gate must source backend-real-gate-ports when backend-real is enabled', failures);
requireMatch(workspaceDefaultGate, /cleanup_gate_ports "\$\{real_api_port\}" "\$\{real_web_port\}" "\$\{real_spec\}"/, 'workspace-project default gate must clean stale backend-real ports before running integration-minimal', failures);

requireMatch(backendRealFullGate, /npm run gate:default/, 'backend-real full gate must continue to include gate:default before release verification', failures);
requireMatch(backendRealFullGate, /npm run test:visual:backend-real:review/, 'backend-real full gate must keep backend-real visual review as a release-only evidence step', failures);
requireMatch(backendRealRun, /cleanup_gate_ports 20040 3041 e2e\/integration-minimal\.spec\.ts/, 'backend-real-run must clean stale ports before the external default backend-real lane', failures);
requireMatch(backendRealRun, /cleanup_gate_ports 20060 3061 e2e\/integration-system-notebook-default\.spec\.ts/, 'backend-real-run must clean stale ports before the notebook backend-real smoke lane', failures);
requireMatch(backendRealRun, /cleanup_gate_ports 20064 3065 e2e\/integration-chat-llm-runner\.spec\.ts/, 'backend-real-run must clean stale ports before the external chat runner backend-real lane', failures);
requireMatch(backendRealRun, /cleanup_gate_ports 20064 3065 e2e\/integration-notebook-codex-runner\.spec\.ts/, 'backend-real-run must clean stale ports before the external notebook runner backend-real lane', failures);
requireMatch(integrationE2EFull, /clear_runtime_stack_env[\s\S]*resolve_loopback_runtime_stack/, 'run-integration-e2e-full must clear inherited runtime stack addresses before rebuilding its isolated loopback stack', failures);

requireMatch(workflow, /^  gate-fast:\n/m, 'quality-gates workflow is missing the gate-fast job', failures);
requireMatch(workflow, /^  gate-default:\n/m, 'quality-gates workflow is missing the gate-default job', failures);
requireMatch(workflow, /^  lane-visual:\n/m, 'quality-gates workflow is missing the lane-visual job', failures);
requireMatch(workflow, /^  lane-backend-real-core:\n/m, 'quality-gates workflow is missing the lane-backend-real-core job', failures);
requireMatch(workflow, /run_visual_lane:/, 'quality-gates workflow must expose the run_visual_lane manual input', failures);
requireMatch(workflow, /run_backend_real_core:/, 'quality-gates workflow must expose the run_backend_real_core manual input', failures);
requireMatch(workflow, /run: npm run gate:fast/, 'quality-gates workflow must run npm run gate:fast', failures);
requireMatch(workflow, /run: npm run gate:default/, 'quality-gates workflow must run npm run gate:default', failures);
requireMatch(workflow, /run: npm run lane:visual/, 'quality-gates workflow must run npm run lane:visual', failures);
requireMatch(workflow, /run: npm run lane:backend-real:core/, 'quality-gates workflow must run npm run lane:backend-real:core', failures);
forbidMatch(workflow, /run_l2:|run_l3:|visual-manual:|lane-mock:/, 'quality-gates workflow must use current gate job/input names instead of legacy lane-mock or run_l2/run_l3 inputs', failures);

for (const content of [readme, development, governanceModel]) {
  requireMatch(content, /current-gate-manifest\.ts/, 'README/DEVELOPMENT/current engineering governance model must reference current-gate-manifest.ts', failures);
}

requireMatch(gateContract, /gate:default/, 'current gate manifest contract must define gate:default', failures);
requireMatch(gateContract, /lane:visual/, 'current gate manifest contract must define lane:visual', failures);
requireMatch(gateContract, /lane:demo-rehearsal/, 'current gate manifest contract must define lane:demo-rehearsal', failures);
requireMatch(gateContract, /lane:cluster-rehearsal/, 'current gate manifest contract must define lane:cluster-rehearsal', failures);
requireMatch(gateContract, /gate:release:full/, 'current gate manifest contract must define gate:release:full', failures);
requireMatch(gateContract, /full visual/, 'current gate manifest contract must explain full visual ownership', failures);
requireMatch(gateContract, /targeted visual/, 'current gate manifest contract must explain targeted visual ownership', failures);
requireMatch(gateContract, /story evidence/, 'current gate manifest contract must define story evidence ownership', failures);
requireMatch(gateContract, /visual_scene_catalog/, 'current gate manifest contract must define visual_scene_catalog evidence', failures);
requireMatch(gateContract, /ux_trace_bundle/, 'current gate manifest contract must define ux_trace_bundle evidence', failures);
requireMatch(gateContract, /e2e\/visual-baseline-support\.ts/, 'current gate manifest contract must identify the visual scene catalog source', failures);
requireMatch(gateContract, /artifacts\/backend-real-visual\/<run-id>\/ux-traces/, 'current gate manifest contract must identify backend-real ux trace bundle roots', failures);
requireMatch(gateContract, /scenario-owned local clean reset/, 'current gate manifest contract must require clean-reset semantics for rehearsal lanes', failures);
requireMatch(gateContract, /generated handoff state/, 'current gate manifest contract must describe rehearsal-generated handoff state ownership', failures);

requireMatch(workspaceDefaultChecklist, /npm run test:default-e2e/, 'workspace/project checklist must keep test:default-e2e as its canonical gate command', failures);
requireMatch(workspaceDefaultChecklist, /targeted visual/, 'workspace/project checklist must explain that its visual coverage is targeted', failures);
requireMatch(workspaceDefaultChecklist, /npm run lane:visual/, 'workspace/project checklist must point full visual verification to npm run lane:visual', failures);
forbidMatch(workspaceDefaultChecklist, /npm run gate:default/, 'workspace/project checklist must document its own canonical gate command instead of gate:default', failures);

requireMatch(governanceDefaultChecklist, /npm run test:governance/, 'governance checklist must keep test:governance as its canonical gate command', failures);
requireMatch(governanceDefaultChecklist, /targeted visual/, 'governance checklist must explain that its visual coverage is targeted', failures);
requireMatch(governanceDefaultChecklist, /npm run lane:visual/, 'governance checklist must point full visual verification to npm run lane:visual', failures);
forbidMatch(governanceDefaultChecklist, /npm run gate:default/, 'governance checklist must document its own canonical gate command instead of gate:default', failures);

requireMatch(releaseChecklist, /npm run gate:default/, 'release checklist must require npm run gate:default', failures);
requireMatch(releaseChecklist, /npm run lane:visual/, 'release checklist must require npm run lane:visual', failures);
requireMatch(releaseChecklist, /npm run lane:demo-rehearsal/, 'release checklist must require npm run lane:demo-rehearsal', failures);
requireMatch(releaseChecklist, /npm run lane:cluster-rehearsal/, 'release checklist must require npm run lane:cluster-rehearsal', failures);
requireMatch(releaseChecklist, /npm run gate:release:full/, 'release checklist must define npm run gate:release:full as the full release command', failures);
requireMatch(releaseChecklist, /does not run the full visual lane|不能被 `gate:default` 代替/, 'release checklist must explain that gate:default does not run the full visual lane', failures);
requireMatch(releaseChecklist, /visual_scene_catalog/, 'release checklist must identify visual_scene_catalog as a required release evidence kind', failures);
requireMatch(releaseChecklist, /ux_trace_bundle/, 'release checklist must identify ux_trace_bundle as a required release evidence kind', failures);
requireMatch(releaseChecklist, /e2e\/visual-baseline-support\.ts/, 'release checklist must identify the visual scene catalog source', failures);
requireMatch(releaseChecklist, /artifacts\/backend-real-visual\/<run-id>\/ux-traces/, 'release checklist must identify the backend-real ux trace bundle path', failures);
requireMatch(releaseChecklist, /clean reset/, 'release checklist must explain that rehearsal lanes begin from a clean reset', failures);

for (const relativePath of CURRENT_GATE_DOCUMENT_FILES) {
  requireMatch(read(relativePath), /(gate|visual|backend-real|manifest|current)/, `${relativePath} must remain populated with current gate truth content`, failures);
}

if (failures.length > 0) {
  console.error('[contracts] current gate check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] current gate check passed');
