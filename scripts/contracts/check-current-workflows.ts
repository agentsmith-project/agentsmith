import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

type Rule = {
  pattern: RegExp;
  message: string;
  allowedFiles?: Set<string>;
};

const failFastFiles = new Set([
  'Makefile',
  'scripts/dev-real/common.sh',
  'scripts/notebook-agent-init-resources.sh',
]);

const rules: Rule[] = [
  {
    pattern: /notebook-agent-demo-(up|down|status|check|restart-runner)/,
    message: 'legacy notebook-agent-demo command leaked into current path',
  },
  {
    pattern: /\bdemo-full-up\b|\bdemo-full-down\b/,
    message: 'legacy demo-full command leaked into current path',
  },
  {
    pattern: /\bmake dev-up\b|\bmake dev-down\b/,
    message: 'legacy dev-up/dev-down command leaked into current path',
  },
  {
    pattern: /\bGLM_API_KEY\b|\bGLM_APIKEY\b|\bGLM_BASE_URL\b|\bGLM_MODEL\b|\bINTEGRATION_GLM_MODEL\b|\bINTEGRATION_GLM_BASE_URL\b/,
    message: 'legacy GLM_* naming leaked into current path',
    allowedFiles: failFastFiles,
  },
];

function listTrackedFiles(): string[] {
  const stdout = execFileSync('git', ['ls-files'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith('artifacts/'))
    .filter((file) => !file.startsWith('.tmp/'));
}

const failures: string[] = [];

for (const relativePath of listTrackedFiles()) {
  const absPath = path.join(rootDir, relativePath);
  let content = '';
  try {
    content = readFileSync(absPath, 'utf8');
  } catch {
    continue;
  }

  for (const rule of rules) {
    if (!rule.pattern.test(content)) {
      continue;
    }
    if (rule.allowedFiles?.has(relativePath)) {
      continue;
    }
    failures.push(`${relativePath}: ${rule.message}`);
  }
}

if (failures.length > 0) {
  console.error('[contracts] current workflow check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] current workflow check passed');
