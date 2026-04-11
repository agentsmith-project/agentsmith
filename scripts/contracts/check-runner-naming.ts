import { readFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(rootDir, relativePath), 'utf8')) as unknown;
}

function readText(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

const failures: string[] = [];

const rootPackage = readJson('package.json') as { scripts?: Record<string, string> };
const notebookPackage = readJson('packages/notebook-codex-runner/package.json') as {
  name?: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const chatPackage = readJson('packages/chat-llm-runner/package.json') as {
  name?: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const messagesEn = readJson('src/messages/en-US.json') as { agents?: { create_dialog?: { interaction_kind?: string } } };
const messagesZh = readJson('src/messages/zh-CN.json') as { agents?: { create_dialog?: { interaction_kind?: string } } };
const makefile = readText('Makefile');
const developmentDoc = readText('DEVELOPMENT.md');
const baselineDoc = readText('docs/CURRENT_BASELINE.md');
const readmeDoc = readText('docs/README.md');
const troubleshootingDoc = readText('docs/troubleshooting-guide-v1.md');
const notebookRunbook = readText('docs/notebook-codex-runbook.md');
const preprodCaptureBaseline = readText('scripts/preprod-capture-baseline.sh');
const notebookDockerfile = readText('infra/runner/Dockerfile.notebook-codex-runner');
const notebookBaseDockerfile = readText('infra/runner/Dockerfile.notebook-codex-runner-base');
const chatDockerfile = readText('infra/runner/Dockerfile.chat-llm-runner');
const chatBaseDockerfile = readText('infra/runner/Dockerfile.chat-llm-runner-base');
const chatRuntimeBackendRealGate = readText('scripts/chat-runtime-backend-real-gate.sh');
const skillsRuntimeBackendRealGate = readText('scripts/skills-runtime-backend-real-gate.sh');
const mockLaneScript = readText('scripts/run-mock-lane-playwright.sh');
const clusterBuildImages = readText('scripts/cluster-deploy/build-images.sh');
const demoBundleBuild = readText('scripts/demo-deploy/build-offline-bundle.sh');
const releaseUserStory = readText('scripts/run-integration-release-user-story.sh');
const buildRunnerImageScript = readText('scripts/build-runner-image.sh');
const integrationRealHelpers = readText('e2e/integration-real-helpers.ts');
const deploymentSpec = readText('docs/contracts/deployment-spec-v1.md');
const releaseGovernanceSpec = readText('docs/contracts/address-truth-and-release-governance-v1.md');
const agentResourceService = readText('packages/api-entry-node/src/agent-resource-service.ts');
const agentExecutionPreferences = readText('packages/api-entry-node/src/agent-execution-preferences.ts');
const agentExecutionService = readText('packages/api-entry-node/src/agent-execution-service.ts');
const internalChatIntegrationSpec = readText('e2e/integration-internal-chat-runner.spec.ts');
const internalChatRealGate = readText('scripts/run-internal-chat-real-gate.sh');

function requireMatch(content: string, pattern: RegExp, message: string): void {
  if (!pattern.test(content)) {
    failures.push(message);
  }
}

if (notebookPackage.name !== '@mbos/notebook-codex-runner') {
  failures.push(`packages/notebook-codex-runner/package.json has unexpected name: ${notebookPackage.name ?? '<missing>'}`);
}

if (chatPackage.name !== '@mbos/chat-llm-runner') {
  failures.push(`packages/chat-llm-runner/package.json has unexpected name: ${chatPackage.name ?? '<missing>'}`);
}

if (notebookPackage.scripts?.dev?.includes('tsx') && !notebookPackage.devDependencies?.tsx) {
  failures.push('packages/notebook-codex-runner/package.json must declare tsx when the dev script uses tsx');
}

if (chatPackage.scripts?.dev?.includes('tsx') && !chatPackage.devDependencies?.tsx) {
  failures.push('packages/chat-llm-runner/package.json must declare tsx when the dev script uses tsx');
}

if (rootPackage.scripts?.['agent:notebook-runner'] !== 'npm run dev -w @mbos/notebook-codex-runner') {
  failures.push('package.json agent:notebook-runner must point to @mbos/notebook-codex-runner');
}

if (rootPackage.scripts?.['agent:chat-runner'] !== 'npm run dev -w @mbos/chat-llm-runner') {
  failures.push('package.json agent:chat-runner must point to @mbos/chat-llm-runner');
}

if (rootPackage.scripts?.['test:internal:backend-real:chat'] !== 'bash scripts/run-internal-chat-real-gate.sh') {
  failures.push('package.json test:internal:backend-real:chat must point to scripts/run-internal-chat-real-gate.sh');
}

if (rootPackage.scripts?.['agent:codex-runner'] !== undefined) {
  failures.push('package.json must not expose legacy agent:codex-runner');
}

if (rootPackage.scripts?.['test:e2e:integration:agents:chat'] !== 'playwright test --config playwright.config.integration.ts e2e/integration-chat-llm-runner.spec.ts --project=chromium --workers=1') {
  failures.push('package.json test:e2e:integration:agents:chat must point to the chat runner integration spec');
}

if (rootPackage.scripts?.['test:agents:backend-real:runner'] === undefined) {
  failures.push('package.json is missing test:agents:backend-real:runner');
}

if (rootPackage.scripts?.['test:agents:backend-real:runner'] !== 'bash scripts/run-integration-e2e-full.sh e2e/integration-chat-llm-runner.spec.ts && bash scripts/run-integration-e2e-full.sh e2e/integration-notebook-codex-runner.spec.ts && bash scripts/run-integration-e2e-full.sh e2e/integration-notebook-codex-runner.spec.ts --grep docker') {
  failures.push('package.json test:agents:backend-real:runner must point to the canonical chat runner and notebook runner specs');
}

if (rootPackage.scripts?.['test:e2e:integration:agents:codex'] !== undefined) {
  failures.push('package.json must not expose legacy test:e2e:integration:agents:codex');
}

if (rootPackage.scripts?.['test:e2e:integration:notebook:codex'] !== undefined) {
  failures.push('package.json must not expose legacy test:e2e:integration:notebook:codex');
}

if (rootPackage.scripts?.['test:e2e:integration:notebook:codex:docker'] !== undefined) {
  failures.push('package.json must not expose legacy test:e2e:integration:notebook:codex:docker');
}

if (rootPackage.scripts?.['test:agents:backend-real:runner']?.includes('integration-agents-codex-runner.spec.ts')) {
  failures.push('package.json test:agents:backend-real:runner must not reference integration-agents-codex-runner.spec.ts');
}

if (rootPackage.scripts?.['test:e2e:integration:agents:chat']?.includes('integration-agents-codex-runner.spec.ts')) {
  failures.push('package.json test:e2e:integration:agents:chat must not reference integration-agents-codex-runner.spec.ts');
}

if (chatRuntimeBackendRealGate.includes('integration-agents-codex-runner.spec.ts')) {
  failures.push('scripts/chat-runtime-backend-real-gate.sh must not reference integration-agents-codex-runner.spec.ts');
}

if (!chatRuntimeBackendRealGate.includes('integration-chat-llm-runner.spec.ts')) {
  failures.push('scripts/chat-runtime-backend-real-gate.sh must reference integration-chat-llm-runner.spec.ts');
}

if (skillsRuntimeBackendRealGate.includes('integration-agents-codex-runner.spec.ts')) {
  failures.push('scripts/skills-runtime-backend-real-gate.sh must not reference integration-agents-codex-runner.spec.ts');
}

if (!skillsRuntimeBackendRealGate.includes('integration-chat-llm-runner.spec.ts')) {
  failures.push('scripts/skills-runtime-backend-real-gate.sh must reference integration-chat-llm-runner.spec.ts');
}

requireMatch(makefile, /^notebook-runner:/m, 'Makefile is missing notebook-runner target');
requireMatch(makefile, /^chat-runner:/m, 'Makefile is missing chat-runner target');
requireMatch(makefile, /^notebook-agent-runner:/m, 'Makefile is missing notebook-agent-runner alias target');
requireMatch(makefile, /BUILTIN_SKILLS_DIR_DEFAULT \?= .*packages\/notebook-codex-runner\/builtin-skills/, 'Makefile default builtin skills dir must target notebook-codex-runner');
requireMatch(makefile, /agent:notebook-runner/, 'Makefile must reference agent:notebook-runner');
requireMatch(makefile, /agent:chat-runner/, 'Makefile must reference agent:chat-runner');

if (/^agent-codex-runner:/m.test(makefile)) {
  failures.push('Makefile must not expose legacy agent-codex-runner target');
}

requireMatch(notebookDockerfile, /packages\/agent-runner\/src/, 'notebook runner Dockerfile must copy agent-runner sources');
requireMatch(notebookDockerfile, /packages\/notebook-codex-runner\/src/, 'notebook runner Dockerfile must copy notebook-codex-runner sources');
requireMatch(notebookDockerfile, /packages\/notebook-codex-runner\/builtin-skills/, 'notebook runner Dockerfile must copy notebook-codex-runner builtin skills');
requireMatch(notebookDockerfile, /COPY packages\/notebook-codex-runner\/builtin-skills \/etc\/codex\/skills/, 'notebook runner Dockerfile must install builtin skills into /etc/codex/skills');
requireMatch(notebookBaseDockerfile, /COPY package\.json package-lock\.json \.\//, 'notebook runner base Dockerfile must copy workspace root manifests');
requireMatch(notebookBaseDockerfile, /COPY packages\/agent-runner\/package\.json/, 'notebook runner base Dockerfile must copy agent-runner package metadata');
requireMatch(notebookBaseDockerfile, /COPY packages\/notebook-codex-runner\/package\.json/, 'notebook runner base Dockerfile must copy notebook runner package metadata');
requireMatch(notebookBaseDockerfile, /npm ci --workspace @mbos\/agent-runner --workspace @mbos\/notebook-codex-runner/, 'notebook runner base Dockerfile must install workspace-aware runner dependencies');
requireMatch(chatDockerfile, /packages\/agent-runner\/src/, 'chat runner Dockerfile must copy agent-runner sources');
requireMatch(chatDockerfile, /packages\/chat-llm-runner\/src/, 'chat runner Dockerfile must copy chat-llm-runner sources');
requireMatch(chatBaseDockerfile, /COPY package\.json package-lock\.json \.\//, 'chat runner base Dockerfile must copy workspace root manifests');
requireMatch(chatBaseDockerfile, /COPY packages\/agent-runner\/package\.json/, 'chat runner base Dockerfile must copy agent-runner package metadata');
requireMatch(chatBaseDockerfile, /COPY packages\/chat-llm-runner\/package\.json/, 'chat runner base Dockerfile must copy chat runner package metadata');
requireMatch(chatBaseDockerfile, /npm ci --workspace @mbos\/agent-runner --workspace @mbos\/chat-llm-runner/, 'chat runner base Dockerfile must install workspace-aware runner dependencies');
requireMatch(clusterBuildImages, /runner_release_base_image chat/, 'cluster build-images must resolve chat runner base image through runner-image-common.sh');
requireMatch(clusterBuildImages, /agentsmith_chat_runner_image=/, 'cluster build-images VERSION output must include chat runner image');
requireMatch(clusterBuildImages, /source "\$\{ROOT_DIR\}\/scripts\/lib\/runner-image-common\.sh"/, 'cluster build-images must source runner-image-common.sh');
requireMatch(clusterBuildImages, /build_runner_image notebook/, 'cluster build-images must build notebook runner through runner-image-common.sh');
requireMatch(clusterBuildImages, /build_runner_image chat/, 'cluster build-images must build chat runner through runner-image-common.sh');
requireMatch(demoBundleBuild, /CHAT_RUNNER_BASE_IMAGE="\$\{CHAT_RUNNER_BASE_IMAGE:-agentsmith-chat-llm-runner-base:/, 'demo bundle build must define a chat runner base image default');
requireMatch(demoBundleBuild, /agentsmith_chat_runner_image=/, 'demo bundle VERSION output must include chat runner image');
requireMatch(demoBundleBuild, /source "\$\{ROOT_DIR\}\/scripts\/lib\/runner-image-common\.sh"/, 'demo bundle build must source runner-image-common.sh');
requireMatch(demoBundleBuild, /build_runner_image notebook/, 'demo bundle build must build notebook runner through runner-image-common.sh');
requireMatch(demoBundleBuild, /build_runner_image chat/, 'demo bundle build must build chat runner through runner-image-common.sh');
requireMatch(releaseUserStory, /source "\$\{ROOT_DIR\}\/scripts\/lib\/runner-image-common\.sh"/, 'integration release user story must source runner-image-common.sh');
requireMatch(releaseUserStory, /build_runner_image "\$\{RUNNER_KIND\}"/, 'integration release user story must build internal runner via runner-image-common.sh');
requireMatch(buildRunnerImageScript, /source "\$\{ROOT_DIR\}\/scripts\/lib\/runner-image-common\.sh"/, 'build-runner-image.sh must source runner-image-common.sh');
requireMatch(integrationRealHelpers, /scripts\/build-runner-image\.sh/, 'integration real helpers must use the shared build-runner-image.sh entrypoint');
requireMatch(mockLaneScript, /artifacts\/mock-lane\/runs\/\$\{MOCK_RUN_ID\}/, 'mock lane script must default to run-scoped state paths');
if (mockLaneScript.includes('MOCK_NEXT_DIST_DIR:-.next-mock')) {
  failures.push('mock lane script must not default NEXT_DIST_DIR to shared .next-mock');
}

if (agentResourceService.includes('interaction_mode')) {
  failures.push('packages/api-entry-node/src/agent-resource-service.ts must not retain interaction_mode compatibility logic');
}

if (agentExecutionPreferences.includes('migration_required') || agentExecutionService.includes('migration_required')) {
  failures.push('agent execution runtime must not retain migration_required legacy error paths');
}

if (/test\.skip\(!namespace/.test(internalChatIntegrationSpec)) {
  failures.push('e2e/integration-internal-chat-runner.spec.ts must not skip when sandbox env is missing');
}

requireMatch(chatRuntimeBackendRealGate, /run-internal-chat-real-gate\.sh/, 'scripts/chat-runtime-backend-real-gate.sh must delegate internal chat coverage to scripts/run-internal-chat-real-gate.sh');
requireMatch(internalChatRealGate, /source "\$\{ROOT_DIR\}\/scripts\/lib\/backend-real-gate-ports\.sh"/, 'scripts/run-internal-chat-real-gate.sh must source backend-real-gate-ports.sh');
requireMatch(internalChatRealGate, /cleanup_gate_ports "\$\{API_PORT\}" "\$\{WEB_PORT\}" "\$\{SPEC_PATH\}"/, 'scripts/run-internal-chat-real-gate.sh must clean stale ports before running the internal chat spec');

if (developmentDoc.includes('agent-codex-runner')) {
  failures.push('DEVELOPMENT.md must not reference legacy agent-codex-runner naming');
}

if (baselineDoc.includes('Agent Codex Notebook Runbook') || readmeDoc.includes('Agent Codex Notebook Runbook') || troubleshootingDoc.includes('Agent Codex Notebook Runbook') || developmentDoc.includes('Agent Codex Notebook Runbook')) {
  failures.push('active docs must not reference legacy Agent Codex Notebook Runbook naming');
}

if (!baselineDoc.includes('Notebook Codex Runner Runbook') || !readmeDoc.includes('Notebook Codex Runner Runbook') || !troubleshootingDoc.includes('Notebook Codex Runner Runbook') || !developmentDoc.includes('Notebook Codex Runner Runbook')) {
  failures.push('active docs must reference Notebook Codex Runner Runbook naming');
}

if (notebookRunbook.includes('agent-codex-runner')) {
  failures.push('docs/notebook-codex-runbook.md must not reference legacy agent-codex-runner naming');
}

if (preprodCaptureBaseline.includes('agent-codex')) {
  failures.push('scripts/preprod-capture-baseline.sh must not reference legacy agent-codex naming');
}

if (deploymentSpec.includes('every runner mode must use the same runner image')) {
  failures.push('docs/contracts/deployment-spec-v1.md must not require one shared runner image for all modes');
}

if (releaseGovernanceSpec.includes('所有 runner 必须使用同一个 runner image')) {
  failures.push('docs/contracts/address-truth-and-release-governance-v1.md must not require one shared runner image for all modes');
}

if (messagesEn.agents?.create_dialog?.interaction_kind !== 'Interaction Kind') {
  failures.push(`src/messages/en-US.json must label agents.create_dialog.interaction_kind as "Interaction Kind"`);
}

if (messagesZh.agents?.create_dialog?.interaction_kind !== '交互类型') {
  failures.push(`src/messages/zh-CN.json must label agents.create_dialog.interaction_kind as "交互类型"`);
}

if (failures.length > 0) {
  console.error('[contracts] runner naming check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] runner naming check passed');
