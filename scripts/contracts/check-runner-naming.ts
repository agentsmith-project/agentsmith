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
const notebookPackage = readJson('packages/notebook-codex-runner/package.json') as { name?: string };
const chatPackage = readJson('packages/chat-llm-runner/package.json') as { name?: string };
const makefile = readText('Makefile');
const notebookDockerfile = readText('infra/runner/Dockerfile.notebook-codex-runner');
const notebookBaseDockerfile = readText('infra/runner/Dockerfile.notebook-codex-runner-base');
const chatRuntimeBackendRealGate = readText('scripts/chat-runtime-backend-real-gate.sh');
const skillsRuntimeBackendRealGate = readText('scripts/skills-runtime-backend-real-gate.sh');

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

if (rootPackage.scripts?.['agent:notebook-runner'] !== 'npm run dev -w @mbos/notebook-codex-runner') {
  failures.push('package.json agent:notebook-runner must point to @mbos/notebook-codex-runner');
}

if (rootPackage.scripts?.['agent:chat-runner'] !== 'npm run dev -w @mbos/chat-llm-runner') {
  failures.push('package.json agent:chat-runner must point to @mbos/chat-llm-runner');
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

requireMatch(notebookDockerfile, /packages\/notebook-codex-runner\/src/, 'notebook runner Dockerfile must copy notebook-codex-runner sources');
requireMatch(notebookDockerfile, /packages\/notebook-codex-runner\/builtin-skills/, 'notebook runner Dockerfile must copy notebook-codex-runner builtin skills');
requireMatch(notebookBaseDockerfile, /"name": "notebook-codex-runner-image"/, 'notebook runner base Dockerfile must use notebook-codex-runner image metadata');

if (failures.length > 0) {
  console.error('[contracts] runner naming check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] runner naming check passed');
