import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { OSS_TARGET_DIR, REMOVE_PUBLIC_TEXT_PATTERNS } from './export-manifest.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function grepTree(pattern: string): string {
  try {
    return execFileSync('rg', ['-n', '--glob', '!package-lock.json', pattern, '.'], { cwd: OSS_TARGET_DIR, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const requiredPaths = [
  'package.json',
  'README.md',
  'src',
  'packages',
  'infra/runner/Dockerfile.notebook-codex-runner',
  'infra/deploy/Dockerfile.agentsmith-app',
  'docs/DEPLOYMENT.md',
  'docs/RUNNER_RUNTIME.md',
];

for (const rel of requiredPaths) {
  assert(existsSync(join(OSS_TARGET_DIR, rel)), `missing_required_path:${rel}`);
}

const forbiddenPaths = [
  'e2e',
  'artifacts',
  'marketing',
  '.infra',
  'docs/archive',
  'docs/UXUI',
  'scripts/contracts',
  'scripts/governance',
  'scripts/local-manual',
];
for (const rel of forbiddenPaths) {
  assert(!existsSync(join(OSS_TARGET_DIR, rel)), `forbidden_path_present:${rel}`);
}

for (const pattern of ['__tests__', 'vitest', 'playwright', 'backend-real', 'local-manual', 'governance-default-gate']) {
  const matches = grepTree(pattern);
  if (matches) {
    throw new Error(`forbidden_content:${pattern}\n${matches.split('\n').slice(0, 20).join('\n')}`);
  }
}

const rootPkg = JSON.parse(readFileSync(join(OSS_TARGET_DIR, 'package.json'), 'utf8')) as Record<string, any>;
const scripts = rootPkg.scripts ?? {};
for (const key of Object.keys(scripts)) {
  assert(!key.startsWith('test'), `forbidden_root_script:${key}`);
  assert(!key.startsWith('gate:'), `forbidden_root_script:${key}`);
  assert(!key.startsWith('lane:'), `forbidden_root_script:${key}`);
}

const readme = readFileSync(join(OSS_TARGET_DIR, 'README.md'), 'utf8');
for (const phrase of REMOVE_PUBLIC_TEXT_PATTERNS) {
  assert(!readme.includes(phrase), `forbidden_readme_phrase:${phrase}`);
}

console.log(`OSS tree verification passed for ${OSS_TARGET_DIR}`);
