import { readFileSync } from 'node:fs';
import path from 'node:path';

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
const playwrightConfig = read('playwright.config.ts');
const makefile = read('Makefile');

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

requireMatch(playwrightConfig, /\bdefaultE2ESpecMatch\b/, 'playwright.config.ts must use the defaultE2ESpecMatch name');
forbidMatch(playwrightConfig, /\bchromiumMvpSpecMatch\b/, 'playwright.config.ts still uses chromiumMvpSpecMatch');

requireMatch(visualPolicy, /整页视觉基线/, 'visual baseline policy must define full-page visual baselines');
requireMatch(visualPolicy, /局部视觉基线/, 'visual baseline policy must define focused visual baselines');
requireMatch(visualPolicy, /默认工程门禁/, 'visual baseline policy must explain default engineering gate semantics');
requireMatch(visualPolicy, /视觉验证通道/, 'visual baseline policy must explain visual verification channel semantics');
forbidMatch(visualPolicy, /ignored by git/, 'visual baseline policy still says screenshots are ignored by git');

requireMatch(constitution, /视觉验证属于独立证据通道/, 'constitution must describe visual verification as an independent evidence channel');
forbidMatch(constitution, /smoke \+ chromium/, 'constitution still uses legacy smoke + chromium wording');

forbidMatch(makefile, /\bGLM-5\b|\bglm-5\b/, 'Makefile help still contains legacy provider wording');
forbidMatch(readme, /\bGLM-5\b|\bglm-5\b/, 'README still contains legacy provider wording');
forbidMatch(development, /\bGLM-5\b|\bglm-5\b|\bGLM path\b/, 'DEVELOPMENT still contains legacy provider wording');

if (failures.length > 0) {
  console.error('[contracts] engineering governance check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] engineering governance check passed');
