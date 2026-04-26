import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CURRENT_GATE_DOCUMENT_FILES,
  CURRENT_GATE_MANIFEST,
  type CurrentGateExecutionTarget,
  findCurrentGateDefinitionById,
} from '../governance/current-gate-manifest';
import { listCurrentWorkflowCommands } from '../governance/current-workflow-manifest';

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

const RELEASE_DOC_FORBIDDEN_COPYABLE_COMMAND_PATTERNS = [
  /\bnpm run release:campaign:full\b/,
  /\bnpm run gate:[a-z0-9:_-]+\b/,
  /\bnpm run lane:[a-z0-9:_-]+\b/,
  /\bRELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full\b/,
] as const;

function assertReleaseHumanEntrypointSurface(
  content: string,
  owner: string,
  failures: string[],
): void {
  requireMatch(
    content,
    /npm run release:ready/,
    `${owner} must point human release-grade execution to npm run release:ready`,
    failures,
  );
  requireMatch(
    content,
    /npm run release:status/,
    `${owner} must point read-only release inspection to npm run release:status`,
    failures,
  );
  requireMatch(
    content,
    /release:campaign:full[\s\S]{0,240}internal adapter|internal adapter[\s\S]{0,240}release:campaign:full/i,
    `${owner} must describe release:campaign:full only as an internal adapter identity`,
    failures,
  );
  requireMatch(
    content,
    /gate:release:full[\s\S]{0,240}aggregate-only/i,
    `${owner} must describe gate:release:full as aggregate-only`,
    failures,
  );
  for (const pattern of RELEASE_DOC_FORBIDDEN_COPYABLE_COMMAND_PATTERNS) {
    forbidMatch(
      content,
      pattern,
      `${owner} must not expose internal release/gate/lane adapters as copyable human commands: ${pattern}`,
      failures,
    );
  }
}

function countMatches(content: string, pattern: RegExp): number {
  return [...content.matchAll(pattern)].length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectWorkflowJobNames(content: string): Set<string> {
  const jobNames = new Set<string>();
  for (const match of content.matchAll(/^  ([a-z0-9][a-z0-9-]*):$/gm)) {
    jobNames.add(match[1]);
  }
  return jobNames;
}

function assertExecutionTarget(
  actualCommand: string,
  target: CurrentGateExecutionTarget,
  owner: string,
  failures: string[],
): void {
  if (target.kind === 'npm_script') {
    requireMatch(
      actualCommand,
      new RegExp(`\\bnpm run ${escapeRegExp(target.npmScript)}(?:\\b|\\s)`),
      `${owner} adapter must invoke npm run ${target.npmScript}`,
      failures,
    );
    return;
  }

  if (target.kind === 'shell_script') {
    requireMatch(
      actualCommand,
      new RegExp(`\\bbash\\s+${escapeRegExp(target.scriptPath)}(?:\\b|\\s)`),
      `${owner} adapter must invoke bash ${target.scriptPath}`,
      failures,
    );
    for (const arg of target.args ?? []) {
      requireMatch(
        actualCommand,
        new RegExp(escapeRegExp(arg)),
        `${owner} adapter must include shell target argument: ${arg}`,
        failures,
      );
    }
    return;
  }

  requireMatch(
    actualCommand,
    new RegExp(`\\bnpx\\s+${escapeRegExp(target.command)}(?:\\b|\\s)`),
    `${owner} adapter must invoke npx ${target.command}`,
    failures,
  );
  for (const arg of target.args ?? []) {
    requireMatch(
      actualCommand,
      new RegExp(escapeRegExp(arg)),
      `${owner} adapter must include npx target argument: ${arg}`,
      failures,
    );
  }
}

const packageJson = readJson('package.json') as { scripts?: Record<string, string> };
const workflow = read('.github/workflows/quality-gates.yml');
const readme = read('README.md');
const development = read('DEVELOPMENT.md');
const governanceModel = read('docs/current-engineering-governance-model.md');
const gateContract = read('docs/contracts/current-gate-manifest-contract.md');
const gateResultContract = read('docs/contracts/current-gate-result-schema-contract.md');
const notebookCodexRunbook = read('docs/notebook-codex-runbook.md');
const verificationCampaigns = read('docs/testing/verification-campaigns-v1.md');
const workspaceDefaultChecklist = read('docs/user-guides/workspace-project-default-engineering-gate-checklist.md');
const governanceDefaultChecklist = read('docs/user-guides/governance-default-engineering-gate-checklist.md');
const releaseChecklist = read('docs/user-guides/release-readiness-checklist.md');
const defaultGateScript = read('scripts/default-gate.sh');
const workspaceDefaultGate = read('scripts/workspace-project-default-gate.sh');
const governanceDefaultGate = read('scripts/governance-default-gate.sh');
const backendRealRun = read('scripts/backend-real-run.sh');
const backendRealFullGate = read('scripts/backend-real-full-gate.sh');
const integrationE2EFull = read('scripts/run-integration-e2e-full.sh');
const releaseFullAggregateGate = read('scripts/release-full-aggregate-gate.sh');
const releaseFullCampaign = read('scripts/release-full-campaign.sh');

const failures: string[] = [];
const workflowJobNames = collectWorkflowJobNames(workflow);

for (const definition of CURRENT_GATE_MANIFEST) {
  const actualCommand = packageJson.scripts?.[definition.npmScript];
  if (!actualCommand) {
    failures.push(`package.json is missing gate adapter script: ${definition.npmScript}`);
    continue;
  }
  if (definition.executionTargets.length === 0) {
    failures.push(`${definition.id} must declare at least one structured execution target`);
  }
  for (const target of definition.executionTargets) {
    assertExecutionTarget(actualCommand, target, definition.id, failures);
  }
  if (definition.ciJob && !workflowJobNames.has(definition.ciJob)) {
    failures.push(`${definition.id} references missing quality-gates ci job: ${definition.ciJob}`);
  }
  if (definition.storyEvidencePolicy === 'required' && definition.storyEvidenceKinds.length === 0) {
    failures.push(`${definition.npmScript} must declare at least one required story evidence kind`);
  }
  if (definition.storyEvidencePolicy === 'required' && definition.storyEvidenceArtifacts.length === 0) {
    failures.push(`${definition.npmScript} must declare required story evidence artifact roots`);
  }
  if (definition.storyEvidencePolicy === 'required' && definition.storyEvidenceRequiredFor.length === 0) {
    failures.push(`${definition.npmScript} must declare the tiers where missing story evidence is blocking`);
  }
  if (definition.storyEvidenceKinds.includes('visual_scene_catalog') && !definition.storyEvidenceSceneSource) {
    failures.push(`${definition.npmScript} must declare its visual scene source when it owns visual_scene_catalog evidence`);
  }
}

for (const command of listCurrentWorkflowCommands()) {
  if (!command.gateId) {
    continue;
  }
  const gate = findCurrentGateDefinitionById(command.gateId);
  if (!gate) {
    failures.push(`workflow command ${command.command} references unknown gate id: ${command.gateId}`);
    continue;
  }
  if (command.npmScript && gate.npmScript !== command.npmScript) {
    failures.push(`workflow command ${command.command} must map gate id ${command.gateId} back to npm adapter ${gate.npmScript}`);
  }
}

const releaseCampaignWorkflow = listCurrentWorkflowCommands()
  .find((command) => command.npmScript === 'release:campaign:full');
const releaseFullAggregateWorkflow = listCurrentWorkflowCommands()
  .find((command) => command.npmScript === 'gate:release:full');
if (releaseCampaignWorkflow?.command !== 'npm run release:campaign:full') {
  failures.push('workflow command surface must define npm run release:campaign:full as the campaign launcher behind npm run release:ready');
}
if (!/behind release:ready/.test(releaseCampaignWorkflow?.description ?? '')) {
  failures.push('workflow command surface must describe release:campaign:full as the campaign launcher behind release:ready');
}
if (releaseCampaignWorkflow?.recommended === true) {
  failures.push('workflow command surface must not recommend release:campaign:full as a human release entrypoint');
}
if (releaseFullAggregateWorkflow?.command !== 'RELEASE_CAMPAIGN_ROOT=<campaign-root> npm run gate:release:full') {
  failures.push('workflow command surface must show gate:release:full as an aggregate-only terminal verifier with explicit campaign context');
}

const gateDefault = findCurrentGateDefinitionById('gate-default');
const laneVisual = findCurrentGateDefinitionById('lane-visual');
const testVisual = findCurrentGateDefinitionById('visual-lane-command');
const testBackendRealCore = findCurrentGateDefinitionById('test-backend-real-core');
const backendRealCore = findCurrentGateDefinitionById('lane-backend-real-core');
const laneDemoRehearsal = findCurrentGateDefinitionById('lane-demo-rehearsal');
const laneClusterRehearsal = findCurrentGateDefinitionById('lane-cluster-rehearsal');
const gateReleaseFull = findCurrentGateDefinitionById('gate-release-full');
const laneMock = findCurrentGateDefinitionById('lane-mock');

if (!gateDefault || !laneVisual || !testVisual || !testBackendRealCore || !backendRealCore || !laneDemoRehearsal || !laneClusterRehearsal || !gateReleaseFull || !laneMock) {
  failures.push('current gate manifest is missing required default/visual/backend-real/rehearsal definitions');
}

requireMatch(defaultGateScript, /npm run contracts:check[\s\S]*npm run contracts:check-openapi[\s\S]*npm run openapi:check-generated[\s\S]*npm run lint/, 'default gate must run shared repo preflight and lint before domain gates', failures);
for (const [command, pattern] of [
  ['npm run contracts:check', /npm run contracts:check(?!-openapi)/g],
  ['npm run contracts:check-openapi', /npm run contracts:check-openapi/g],
  ['npm run openapi:check-generated', /npm run openapi:check-generated/g],
  ['npm run lint', /npm run lint/g],
] as const) {
  const count = countMatches(defaultGateScript, pattern);
  if (count !== 1) {
    failures.push(`default gate must run shared preflight command exactly once: ${command} (found ${count})`);
  }
}
requireMatch(defaultGateScript, /next_generated_root_run_locked_type_state_gate_sequence/, 'default gate must run typegen, tsc, and build through the shared locked type-state helper', failures);
requireMatch(defaultGateScript, /npx next typegen \.[\s\S]*npx tsc --noEmit[\s\S]*npm run build/, 'default gate locked type-state helper callback must keep typegen -> tsc -> build order', failures);
requireMatch(defaultGateScript, /workspace-project-default-gate\.sh --skip-shared-preflight/, 'default gate must delegate workspace-project domain checks with shared preflight skipped', failures);
requireMatch(defaultGateScript, /governance-default-gate\.sh --skip-shared-preflight/, 'default gate must delegate governance domain checks with shared preflight skipped', failures);
requireMatch(workspaceDefaultGate, /--skip-shared-preflight/, 'workspace-project default gate must expose --skip-shared-preflight for gate:default dedupe', failures);
requireMatch(governanceDefaultGate, /--skip-shared-preflight/, 'governance default gate must expose --skip-shared-preflight for gate:default dedupe', failures);
requireMatch(workspaceDefaultGate, /e2e\/visual\.spec\.ts[\s\S]*--project=visual[\s\S]*--grep /, 'workspace-project default gate must keep targeted visual coverage with --grep', failures);
requireMatch(governanceDefaultGate, /e2e\/visual\.spec\.ts[\s\S]*--project=visual[\s\S]*--grep /, 'governance default gate must keep targeted visual coverage with --grep', failures);
forbidMatch(workspaceDefaultGate, /npm run test:visual/, 'workspace-project default gate must not delegate to the full visual lane', failures);
forbidMatch(governanceDefaultGate, /npm run test:visual/, 'governance default gate must not delegate to the full visual lane', failures);
requireMatch(workspaceDefaultGate, /source "\$\{ROOT_DIR\}\/scripts\/lib\/backend-real-gate-ports\.sh"/, 'workspace-project default gate must source backend-real-gate-ports when backend-real is enabled', failures);
requireMatch(workspaceDefaultGate, /cleanup_gate_ports "\$\{real_api_port\}" "\$\{real_web_port\}" "\$\{real_spec\}"/, 'workspace-project default gate must clean stale backend-real ports before running integration-minimal', failures);

forbidMatch(backendRealFullGate, /npm run gate:default/, 'backend-real release lane must not rerun gate:default; release campaign owns that ordering', failures);
requireMatch(backendRealFullGate, /npm run test:visual:backend-real:review/, 'backend-real full gate must keep backend-real visual review as a release-only evidence step', failures);
requireMatch(releaseFullAggregateGate, /run-release-full-aggregate\.ts/, 'gate:release:full adapter must be aggregate-only and execute run-release-full-aggregate.ts', failures);
requireMatch(releaseFullAggregateGate, /run-release-full-aggregate\.ts "\$@"/, 'gate:release:full adapter must pass operator flags through to the terminal aggregate verifier', failures);
requireMatch(releaseFullCampaign, /run-current-verification-campaign\.ts release-full/, 'release:campaign:full adapter must execute the release-full campaign runner', failures);
forbidMatch(packageJson.scripts?.['gate:release:full'] ?? '', /npm run gate:release|npm run lane:visual|npm run lane:demo-rehearsal|npm run lane:cluster-rehearsal/, 'gate:release:full package adapter must not rerun release campaign steps', failures);
for (const scriptName of ['lane:visual', 'lane:demo-rehearsal', 'lane:cluster-rehearsal'] as const) {
  requireMatch(
    packageJson.scripts?.[scriptName] ?? '',
    /scripts\/run-current-gate-result-wrapped\.sh/,
    `${scriptName} must route standalone execution through the canonical result writer wrapper`,
    failures,
  );
}
requireMatch(backendRealRun, /FIRST_LANE_API_PORT="\$\{INTEGRATION_API_PORT:-20040\}"[\s\S]*FIRST_LANE_WEB_PORT="\$\{INTEGRATION_WEB_PORT:-3041\}"/, 'backend-real-run must resolve first-lane ports from inherited integration ports before defaulting to 20040/3041', failures);
requireMatch(backendRealRun, /cleanup_gate_ports "\$\{FIRST_LANE_API_PORT\}" "\$\{FIRST_LANE_WEB_PORT\}" e2e\/integration-minimal\.spec\.ts/, 'backend-real-run must clean stale ports before the external default backend-real lane using the resolved first-lane ports', failures);
requireMatch(backendRealRun, /cleanup_gate_ports 20060 3061 e2e\/integration-system-notebook-default\.spec\.ts/, 'backend-real-run must clean stale ports before the notebook backend-real smoke lane', failures);
requireMatch(backendRealRun, /cleanup_gate_ports 20064 3065 e2e\/integration-chat-llm-runner\.spec\.ts/, 'backend-real-run must clean stale ports before the external chat runner backend-real lane', failures);
requireMatch(backendRealRun, /cleanup_gate_ports 20064 3065 e2e\/integration-notebook-codex-runner\.spec\.ts/, 'backend-real-run must clean stale ports before the external notebook runner backend-real lane', failures);
requireMatch(integrationE2EFull, /clear_runtime_stack_env[\s\S]*resolve_loopback_runtime_stack/, 'run-integration-e2e-full must clear inherited runtime stack addresses before rebuilding its isolated loopback stack', failures);
requireMatch(integrationE2EFull, /UX_TRACE_OUTPUT_ROOT="\$\{UX_TRACE_OUTPUT_ROOT:-\$\{INTEGRATION_RUN_ROOT\}\/ux-traces\}"/, 'run-integration-e2e-full must root backend-real ux trace bundles under artifacts/backend-real/runs/<run-id>/ux-traces by default', failures);

requireMatch(workflow, /^  gate-fast:\n/m, 'quality-gates workflow is missing the gate-fast job', failures);
requireMatch(workflow, /^  gate-default:\n/m, 'quality-gates workflow is missing the gate-default job', failures);
requireMatch(workflow, /^  lane-visual:\n/m, 'quality-gates workflow is missing the lane-visual job', failures);
requireMatch(workflow, /^  lane-backend-real-core:\n/m, 'quality-gates workflow is missing the lane-backend-real-core job', failures);
requireMatch(workflow, /run_visual_lane:/, 'quality-gates workflow must expose the run_visual_lane manual input', failures);
requireMatch(workflow, /run_backend_real_core:/, 'quality-gates workflow must expose the run_backend_real_core manual input', failures);
forbidMatch(workflow, /run_l2:|run_l3:|visual-manual:|lane-mock:/, 'quality-gates workflow must use current gate job/input names instead of legacy lane-mock or run_l2/run_l3 inputs', failures);

for (const content of [readme, development, governanceModel]) {
  requireMatch(content, /current-gate-manifest\.ts/, 'README/DEVELOPMENT/current engineering governance model must reference current-gate-manifest.ts', failures);
}

requireMatch(gateContract, /stable gate id/i, 'current gate manifest contract must describe stable gate ids as the gate identity truth', failures);
requireMatch(gateContract, /adapter surface/i, 'current gate manifest contract must describe npmScript\\/command\\/ciJob as adapter surfaces', failures);
requireMatch(gateContract, /execution target/i, 'current gate manifest contract must describe structured execution targets', failures);
requireMatch(gateContract, /operator hint/i, 'current gate manifest contract must describe command as an operator hint', failures);
requireMatch(gateContract, /npm run release:ready/, 'current gate manifest contract must identify npm run release:ready as the human-facing release entrypoint', failures);
requireMatch(gateContract, /release:campaign:full[\s\S]{0,240}internal adapter|internal adapter[\s\S]{0,240}release:campaign:full/i, 'current gate manifest contract must describe release:campaign:full as an internal adapter identity', failures);
requireMatch(gateResultContract, /release:campaign:full[\s\S]{0,240}not a writer identity/i, 'current gate result schema contract must keep campaign launchers out of writer identity truth', failures);
requireMatch(gateResultContract, /gate:release:full[\s\S]{0,240}aggregate-only/i, 'current gate result schema contract must describe gate:release:full as aggregate-only', failures);
for (const [content, owner] of [
  [gateContract, 'current gate manifest contract'],
  [gateResultContract, 'current gate result schema contract'],
] as const) {
  forbidMatch(content, /\bnpm run release:campaign:full\b/, `${owner} must not expose release:campaign:full as a copyable command`, failures);
  forbidMatch(content, /\bnpm run gate:release:full\b/, `${owner} must not expose gate:release:full as a copyable command`, failures);
  forbidMatch(content, /\bRELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full\b/, `${owner} must not expose gate:release:full explicit context as a copyable command`, failures);
}
requireMatch(governanceModel, /gate id/i, 'current engineering governance model must describe gate ids as the stable identity', failures);
requireMatch(governanceModel, /execution target/i, 'current engineering governance model must describe structured execution targets', failures);
requireMatch(governanceModel, /operator hint/i, 'current engineering governance model must describe command as an operator hint', failures);

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
requireMatch(gateContract, /test:backend-real:core/, 'current gate manifest contract must define test:backend-real:core as a backend-real story-evidence owner', failures);
requireMatch(gateContract, /lane:backend-real:core/, 'current gate manifest contract must define lane:backend-real:core as a backend-real story-evidence owner', failures);
requireMatch(gateContract, /e2e\/visual-baseline-support\.ts/, 'current gate manifest contract must identify the visual scene catalog source', failures);
requireMatch(gateContract, /artifacts\/backend-real\/runs\/<run-id>\/ux-traces/, 'current gate manifest contract must identify the default-tier backend-real ux trace bundle root', failures);
requireMatch(gateContract, /artifacts\/backend-real-visual\/<run-id>\/ux-traces/, 'current gate manifest contract must identify backend-real ux trace bundle roots', failures);
requireMatch(gateContract, /scenario-owned local clean reset/, 'current gate manifest contract must require clean-reset semantics for rehearsal lanes', failures);
requireMatch(gateContract, /generated handoff state/, 'current gate manifest contract must describe rehearsal-generated handoff state ownership', failures);

requireMatch(workspaceDefaultChecklist, /npm run test:default-e2e/, 'workspace/project checklist must keep test:default-e2e as its canonical gate command', failures);
requireMatch(workspaceDefaultChecklist, /npm run test:backend-real:core/, 'workspace/project checklist must keep test:backend-real:core as the optional real-backend command', failures);
requireMatch(workspaceDefaultChecklist, /ux_trace_bundle/, 'workspace/project checklist must describe the default-tier backend-real ux_trace_bundle evidence', failures);
requireMatch(workspaceDefaultChecklist, /artifacts\/backend-real\/runs\/<run-id>\/ux-traces/, 'workspace/project checklist must identify the default-tier backend-real ux trace bundle root', failures);
requireMatch(workspaceDefaultChecklist, /targeted visual/, 'workspace/project checklist must explain that its visual coverage is targeted', failures);
requireMatch(workspaceDefaultChecklist, /npm run lane:visual/, 'workspace/project checklist must point full visual verification to npm run lane:visual', failures);
forbidMatch(workspaceDefaultChecklist, /npm run gate:default/, 'workspace/project checklist must document its own canonical gate command instead of gate:default', failures);

requireMatch(governanceDefaultChecklist, /npm run test:governance/, 'governance checklist must keep test:governance as its canonical gate command', failures);
requireMatch(governanceDefaultChecklist, /targeted visual/, 'governance checklist must explain that its visual coverage is targeted', failures);
requireMatch(governanceDefaultChecklist, /npm run lane:visual/, 'governance checklist must point full visual verification to npm run lane:visual', failures);
forbidMatch(governanceDefaultChecklist, /npm run gate:default/, 'governance checklist must document its own canonical gate command instead of gate:default', failures);

requireMatch(releaseChecklist, /npm run release:ready/, 'release checklist must define npm run release:ready as the human-facing full release entrypoint', failures);
requireMatch(releaseChecklist, /npm run release:status/, 'release checklist must define npm run release:status as the read-only status entrypoint', failures);
requireMatch(releaseChecklist, /npm run rehearse:demo/, 'release checklist must expose npm run rehearse:demo as the clean demo rehearsal entrypoint', failures);
requireMatch(releaseChecklist, /npm run rehearse:cluster/, 'release checklist must expose npm run rehearse:cluster as the clean cluster rehearsal entrypoint', failures);
requireMatch(releaseChecklist, /precheck[\s\S]*internal adapter/i, 'release checklist must state that release:ready delegates to internal adapters only after precheck passes', failures);
requireMatch(releaseChecklist, /gate:release:full[\s\S]*aggregate-only/i, 'release checklist must describe gate:release:full as an aggregate-only internal verifier', failures);
forbidMatch(releaseChecklist, /\bnpm run (?:gate|lane|backend-real):[a-z0-9:_-]+/, 'release checklist must not present internal gate/lane/backend-real adapters as copyable human defaults', failures);
forbidMatch(releaseChecklist, /\bnpm run release:campaign:full\b/, 'release checklist must not present release:campaign:full as a copyable human default', failures);
forbidMatch(releaseChecklist, /\bRELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full\b/, 'release checklist must not present gate:release:full as a copyable human default', failures);
forbidMatch(releaseChecklist, /gate:release:full as the full release command/, 'release checklist must not describe gate:release:full as the full release command', failures);
assertReleaseHumanEntrypointSurface(notebookCodexRunbook, 'notebook codex runbook', failures);
assertReleaseHumanEntrypointSurface(verificationCampaigns, 'verification campaigns guide', failures);
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
