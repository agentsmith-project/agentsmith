import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CURRENT_WORKFLOW_DOCUMENT_FILES } from '../governance/current-workflow-manifest';

const rootDir = process.cwd();

type Rule = {
  pattern: RegExp;
  message: string;
  allowedFiles?: Set<string>;
};

const failFastFiles = new Set([
  'Makefile',
  'scripts/local-manual/common.sh',
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
  {
    pattern: /\bGLM-5\b|\bglm-5\b|\bGLM path\b/,
    message: 'legacy provider wording leaked into current path',
  },
  {
    pattern:
      /\btest:mainline:strict\b|\btest:mainline:strict:real\b|\btest:governance:strict\b|\btest:visual:strict\b|\btest:smoke:real:notebook-mainline\b|\bgate:main\b|\bgate-main\b|\bworkspace-project-mainline-gate\.sh\b|\bgovernance-mainline-gate\.sh\b|\bsystem-notebook-real-smoke-gate\.sh\b|\bworkspace-project-mainline-engineering-checklist\.md\b|\bgovernance-mainline-engineering-checklist\.md\b/,
    message: 'legacy current command naming leaked into current path',
  },
  {
    pattern:
      /\btest:e2e:lane:mock:full\b(?!:with-visual)|\btest:members-governance\b|\btest:bundle:inputs\b|\btest:rendered-env\b|\bcontracts:check-engineering-sync\b/,
    message: 'duplicate workflow alias leaked into current path',
  },
];

function listTrackedFiles(): string[] {
  const stdout = execFileSync('git', ['ls-files'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const currentPathFiles = new Set([
    ...CURRENT_WORKFLOW_DOCUMENT_FILES,
    'package.json',
    'playwright.config.ts',
    'docs/项目宪法.md',
  ]);

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => currentPathFiles.has(file));
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
