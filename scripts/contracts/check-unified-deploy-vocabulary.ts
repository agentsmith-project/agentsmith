import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPLOY_CONTRACT_PATH = 'docs/contracts/unified-deploy-contract.md';
const CHECK_NPM_SCRIPT = 'contracts:check-unified-deploy-vocabulary';
const CHECK_SCRIPT_COMMAND = 'tsx scripts/contracts/check-unified-deploy-vocabulary.ts';

const ACTIVE_DEPLOY_TRUTH_FILES = [
  DEPLOY_CONTRACT_PATH,
  'docs/contracts/README.md',
  'docs/contracts/product-terminology.md',
  'docs/CURRENT_BASELINE.md',
  'docs/user-guides/README.md',
  'docs/user-guides/unified-deploy-operations.md',
  'docs/engineering/agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md',
  'DEVELOPMENT.md',
  'package.json',
  'Makefile',
  'scripts/governance/current-workflow-manifest.ts',
  'scripts/governance/current-status-projection-schema.ts',
  'scripts/governance/current-governance-observability-manifest.ts',
] as const;

const FORBIDDEN_SPLIT_DEPLOY_TERMS = [
  {
    label: 'split deploy contract path',
    pattern: /\bunified-deploy-contract-v2\.md\b/iu,
  },
  {
    label: 'split deploy naming',
    pattern: /\b(?:target[-_ ]?v2|deploy\s+v2|unified deploy contract v2)\b/iu,
  },
  {
    label: 'split current-version wording',
    pattern: /\bcurrent[-_ ]?v1\b/iu,
  },
  {
    label: 'not-current deploy marker',
    pattern: /\bnot_current_runtime_truth\b/iu,
  },
  {
    label: 'superseded deploy marker',
    pattern: /\bsuperseded_by_unified_deploy_v2\b/iu,
  },
  {
    label: 'removed deploy command family',
    pattern: /\b(?:demo|cluster)[-_ ]deploy\b|\b(?:DEMO|CLUSTER)_DEPLOY_MODE\b/iu,
  },
  {
    label: 'removed rehearsal command family',
    pattern: /\b(?:demo|cluster)[-_ ]rehearsal\b|\brehearse:(?:demo|cluster)\b|\blane-(?:demo|cluster)-rehearsal\b/iu,
  },
] as const;

const FORBIDDEN_CURRENT_DEPLOY_CLAIMS = [
  {
    label: 'Keycloak app pod',
    pattern: /\bKeycloak\b[\s\S]{0,80}\b(?:app|application)\s+pod\b|\b(?:app|application)\s+pod\b[\s\S]{0,80}\bKeycloak\b/iu,
  },
  {
    label: 'Kubernetes substrate',
    pattern: /\b(?:K8s|Kubernetes)\s+substrate\b|\bsubstrate\b\s+(?:implementation\s+)?(?:is|=|:|as|uses|provider\s+is)\s+(?:K8s|Kubernetes)\b/iu,
  },
  {
    label: 'api replicas > 1',
    pattern: /\bapi\b[\s\S]{0,80}\breplicas?\b\s*(?:=|:|>|>=|is|are|count\s*)\s*(?:[2-9]|\d{2,})\b/iu,
  },
  {
    label: 'execution-gateway',
    pattern: /\bexecution-gateway\b/iu,
  },
] as const;

const NEGATED_CLAIM_WORDS = /\b(no|not|without|must not|should not|does not|do not|forbidden|rejects?|out of scope|does not include|not include|not included|separate architecture plan)\b/iu;

const REQUIRED_DEPLOY_DECISIONS = [
  {
    label: 'Docker-only substrate',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\bDocker[- ]only\b[\s\S]{0,40}\bsubstrate\b|\bsubstrate\b[\s\S]{0,40}\bDocker[- ]only\b/iu),
  },
  {
    label: 'Keycloak substrate',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\bKeycloak\b[\s\S]{0,40}\bsubstrate\b|\bKeycloak is substrate\b/iu),
  },
  {
    label: 'llmup app-managed workload',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\bllmup\b[\s\S]{0,80}\bapp[- ]managed\b/iu)
      && hasPositiveBlock(blocks, /\bllmup\b[\s\S]{0,120}\bKubernetes workload\b/iu),
  },
  {
    label: 'api replicas=1',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\bapi\b[\s\S]{0,80}\breplicas?\b\s*(?:=|:|is|are|fixed to)\s*1\b/iu),
  },
  {
    label: '/api/v1 routes to api',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\/api\/v1[\s\S]{0,80}\b(?:to|->|routes?\s+to|route to|route)\b[\s\S]{0,80}\bapi\b/iu),
  },
  {
    label: '/api/public and /api/system route to web',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\/api\/public[\s\S]{0,80}\b(?:to|->|routes?\s+to|route to|route)\b[\s\S]{0,80}\bweb\b/iu)
      && hasPositiveBlock(blocks, /\/api\/system[\s\S]{0,80}\b(?:to|->|routes?\s+to|route to|route)\b[\s\S]{0,80}\bweb\b/iu),
  },
  {
    label: 'no execution-gateway',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      blocks.some((block) => /\bexecution-gateway\b/iu.test(block.text) && NEGATED_CLAIM_WORDS.test(block.text)),
  },
] as const;

export type UnifiedDeployVocabularyFailure = {
  path: string;
  line?: number;
  message: string;
  excerpt?: string;
};

export type UnifiedDeployVocabularyCheckResult = {
  ok: boolean;
  failures: UnifiedDeployVocabularyFailure[];
};

type CheckOptions = {
  rootDir?: string;
};

type Heading = {
  level: number;
  text: string;
};

type MarkdownLine = {
  line: number;
  text: string;
  headingPath: string[];
};

type MarkdownBlock = {
  startLine: number;
  endLine: number;
  text: string;
  headingPath: string[];
};

type PackageJson = {
  scripts?: Record<string, string>;
};

function addFailure(
  failures: UnifiedDeployVocabularyFailure[],
  path: string,
  message: string,
  line?: number,
  excerpt?: string,
): void {
  failures.push({
    path,
    ...(line === undefined ? {} : { line }),
    message,
    ...(excerpt === undefined || excerpt.trim().length === 0 ? {} : { excerpt: excerpt.trim() }),
  });
}

function readRequiredText(
  rootDir: string,
  relativePath: string,
  failures: UnifiedDeployVocabularyFailure[],
  missingMessage: string,
): string | null {
  const absolutePath = join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    addFailure(failures, relativePath, missingMessage);
    return null;
  }

  return readFileSync(absolutePath, 'utf8');
}

function normalizeMarkdownText(text: string): string {
  return text
    .replace(/[`*_#[\]()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function parseMarkdownLines(content: string): MarkdownLine[] {
  const lines = content.split(/\r?\n/u);
  const headingStack: Heading[] = [];

  return lines.map((text, index) => {
    const headingMatch = text.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = normalizeMarkdownText(headingMatch[2]);
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text: headingText });
    }

    return {
      line: index + 1,
      text,
      headingPath: headingStack.map((heading) => heading.text),
    };
  });
}

function parseMarkdownBlocks(lines: readonly MarkdownLine[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let current: MarkdownLine[] = [];

  function flush(): void {
    if (current.length === 0) {
      return;
    }

    blocks.push({
      startLine: current[0].line,
      endLine: current[current.length - 1].line,
      text: current.map((line) => normalizeMarkdownText(line.text)).join(' ').trim(),
      headingPath: current[0].headingPath,
    });
    current = [];
  }

  for (const line of lines) {
    if (line.text.trim().length === 0) {
      flush();
      continue;
    }

    if (/^(#{1,6})\s+/u.test(line.text)) {
      flush();
      current = [line];
      flush();
      continue;
    }

    const trimmedLine = line.text.trim();
    if (trimmedLine.startsWith('|')) {
      flush();
      current = [line];
      flush();
      continue;
    }
    if (/^(?:[-*+]|\d+\.)\s+/u.test(trimmedLine)) {
      flush();
      current = [line];
      continue;
    }

    current.push(line);
  }

  flush();
  return blocks;
}

function hasPositiveBlock(blocks: readonly MarkdownBlock[], pattern: RegExp): boolean {
  return blocks.some((block) => pattern.test(block.text) && !NEGATED_CLAIM_WORDS.test(block.text));
}

function lineForIndex(content: string, index: number): number {
  return content.slice(0, Math.max(0, index)).split(/\r?\n/u).length;
}

function validateNoSplitDeployVocabulary(
  path: string,
  content: string,
  failures: UnifiedDeployVocabularyFailure[],
): void {
  for (const forbidden of FORBIDDEN_SPLIT_DEPLOY_TERMS) {
    const match = forbidden.pattern.exec(content);
    if (!match) {
      continue;
    }

    const line = lineForIndex(content, match.index);
    addFailure(
      failures,
      path,
      `current deploy truth must not use ${forbidden.label}; fold the logic into the current V1 deploy model.`,
      line,
      match[0],
    );
  }
}

function validateDeployContract(
  content: string,
  failures: UnifiedDeployVocabularyFailure[],
): void {
  const lines = parseMarkdownLines(content);
  const blocks = parseMarkdownBlocks(lines);

  if (!/\bcurrent_deploy_contract\b/u.test(content)) {
    addFailure(
      failures,
      DEPLOY_CONTRACT_PATH,
      'unified deploy contract must contain current_deploy_contract marker.',
    );
  }

  for (const decision of REQUIRED_DEPLOY_DECISIONS) {
    if (!decision.predicate(blocks)) {
      addFailure(
        failures,
        DEPLOY_CONTRACT_PATH,
        `current deploy contract must state ${decision.label}.`,
      );
    }
  }

  for (const block of blocks) {
    if (NEGATED_CLAIM_WORDS.test(block.text)) {
      continue;
    }

    for (const forbidden of FORBIDDEN_CURRENT_DEPLOY_CLAIMS) {
      if (forbidden.pattern.test(block.text)) {
        addFailure(
          failures,
          DEPLOY_CONTRACT_PATH,
          `current deploy contract must not state ${forbidden.label}.`,
          block.startLine,
          block.text,
        );
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePackageJson(
  content: string,
  failures: UnifiedDeployVocabularyFailure[],
): PackageJson | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    addFailure(
      failures,
      'package.json',
      `package.json must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  if (!isRecord(parsed)) {
    addFailure(failures, 'package.json', 'package.json must be a JSON object.');
    return null;
  }

  const scripts = parsed.scripts;
  if (scripts === undefined) {
    return {};
  }
  if (!isRecord(scripts)) {
    addFailure(failures, 'package.json', 'package.json scripts must be a JSON object.');
    return null;
  }

  const normalizedScripts: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value === 'string') {
      normalizedScripts[key] = value;
    }
  }

  return { scripts: normalizedScripts };
}

function validatePackageScripts(
  rootDir: string,
  failures: UnifiedDeployVocabularyFailure[],
): void {
  const content = readRequiredText(
    rootDir,
    'package.json',
    failures,
    'package.json must exist for unified deploy vocabulary checker wiring.',
  );
  if (content === null) {
    return;
  }

  const packageJson = parsePackageJson(content, failures);
  if (packageJson === null) {
    return;
  }

  const scripts = packageJson.scripts ?? {};
  if (scripts[CHECK_NPM_SCRIPT] !== CHECK_SCRIPT_COMMAND) {
    addFailure(
      failures,
      'package.json',
      `package.json must expose ${CHECK_NPM_SCRIPT}: ${CHECK_SCRIPT_COMMAND}.`,
    );
  }

  if (!scripts['contracts:check']?.includes(`npm run ${CHECK_NPM_SCRIPT}`)) {
    addFailure(
      failures,
      'package.json',
      `contracts:check must include npm run ${CHECK_NPM_SCRIPT}.`,
    );
  }
}

export function checkUnifiedDeployVocabulary(
  options: CheckOptions = {},
): UnifiedDeployVocabularyCheckResult {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const failures: UnifiedDeployVocabularyFailure[] = [];

  for (const path of ACTIVE_DEPLOY_TRUTH_FILES) {
    const content = readRequiredText(rootDir, path, failures, `${path} must exist.`);
    if (content === null) {
      continue;
    }

    validateNoSplitDeployVocabulary(path, content, failures);
    if (path === DEPLOY_CONTRACT_PATH) {
      validateDeployContract(content, failures);
    }
  }

  validatePackageScripts(rootDir, failures);

  return {
    ok: failures.length === 0,
    failures,
  };
}

function formatFailure(failure: UnifiedDeployVocabularyFailure): string {
  const location = failure.line === undefined
    ? failure.path
    : `${failure.path}:${failure.line}`;
  const excerpt = failure.excerpt === undefined ? '' : `\n  > ${failure.excerpt}`;

  return `- ${location}: ${failure.message}${excerpt}`;
}

function main(): void {
  const result = checkUnifiedDeployVocabulary();

  if (!result.ok) {
    console.error('[contracts] unified deploy vocabulary check failed:');
    for (const failure of result.failures) {
      console.error(formatFailure(failure));
    }
    process.exit(1);
  }

  console.log('[contracts] unified deploy vocabulary check passed');
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedModulePath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);

if (currentModulePath === invokedModulePath) {
  main();
}
