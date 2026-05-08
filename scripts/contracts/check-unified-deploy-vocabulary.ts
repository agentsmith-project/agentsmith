import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_CONTRACT_PATH = 'docs/contracts/unified-deploy-contract-v2.md';
const V1_CONTRACT_PATHS = [
  'docs/contracts/deployment-spec-v1.md',
  'docs/contracts/cluster-deployment-spec-v1.md',
  'docs/contracts/substrate-governance-and-runtime-lines-v1.md',
  'docs/contracts/address-truth-and-release-governance-v1.md',
  'docs/contracts/universal-proxy-integration-v1.md',
] as const;
const CHECK_NPM_SCRIPT = 'contracts:check-unified-deploy-vocabulary';
const CHECK_SCRIPT_COMMAND = 'tsx scripts/contracts/check-unified-deploy-vocabulary.ts';

const LEGACY_DEPLOYMENT_TERMS = [
  'demo-deploy',
  'cluster-deploy',
  'DEMO_DEPLOY_MODE',
  'CLUSTER_DEPLOY_MODE',
] as const;

const LEGACY_CONTEXT_ALLOWLIST = [
  /\bmigration\b/iu,
  /\bcurrent[-_ ]?v1\b/iu,
  /\blegacy\b/iu,
  /\bhistorical\b|\bhistory\b/iu,
  /\bnegative\b|\bnon[-_ ]?target\b|\bnot target\b/iu,
  /\bsuperseded\b|\bretired\b|\bdeprecated\b/iu,
  /\breplaces?\b|\breplacement\b/iu,
  /\bboundary\b/iu,
  /\bprevious\b|\bold\b/iu,
] as const;

const ACTIVE_MODE_WORDS = /\b(active|canonical|supported|future|target[-_ ]?v2|unified|product)\b/iu;
const MODE_NOUNS = /\bmodes?\b/iu;
const ACTIVE_MODE_NEGATION = /\b(must not|should not|do not|does not|not active|not an active|not a future|not target|non[-_ ]?target|forbidden|rejects?|negative example|superseded|retired|deprecated|legacy-only|current[-_ ]?v1 only|historical only)\b/iu;

const FORBIDDEN_TARGET_PATTERNS = [
  {
    label: 'Keycloak app pod',
    pattern: /\bKeycloak\b[\s\S]{0,80}\b(?:app|application)\s+pod\b|\b(?:app|application)\s+pod\b[\s\S]{0,80}\bKeycloak\b/iu,
  },
  {
    label: 'K8s substrate',
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

const FORBIDDEN_TARGET_NEGATION = /\b(no|not|without|outside|must not|should not|does not|do not|forbidden|rejects?|removed|superseded|retired|deprecated|negative|non[-_ ]?goals?|historical|legacy|current[-_ ]?v1)\b/iu;

const REQUIRED_TARGET_DECISIONS = [
  {
    label: 'Docker-only substrate',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\bDocker[- ]only substrate\b/iu),
  },
  {
    label: 'Keycloak substrate',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\bKeycloak substrate\b|\bKeycloak\b\s+(?:is|as)\s+substrate\b/iu),
  },
  {
    label: 'llmup app-managed K8s workload',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\bllmup\b[\s\S]{0,80}\bapp[- ]managed K8s workload\b/iu)
      || hasPositiveBlock(blocks, /\bllmup\b[\s\S]{0,80}\bAgentSmith app Kubernetes workload\b/iu)
      || hasPositiveBlock(blocks, /\bllmup\b[\s\S]{0,80}\bapp Kubernetes workload\b/iu),
  },
  {
    label: 'api replicas=1',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\bapi\b[\s\S]{0,80}\breplicas?\b\s*(?:=|:|is|are|must be)\s*1\b/iu),
  },
  {
    label: '/api/v1 to api',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\/api\/v1[\s\S]{0,80}\b(?:to|->|routes?\s+to)\b[\s\S]{0,80}\bapi\b/iu),
  },
  {
    label: '/api/public and /api/system to web',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      hasPositiveBlock(blocks, /\/api\/public[\s\S]{0,120}\/api\/system[\s\S]{0,120}\b(?:to|->|routes?\s+to)\b[\s\S]{0,80}\bweb\b/iu)
      || hasPositiveBlock(blocks, /\/api\/system[\s\S]{0,120}\/api\/public[\s\S]{0,120}\b(?:to|->|routes?\s+to)\b[\s\S]{0,80}\bweb\b/iu)
      || (
        hasPositiveBlock(blocks, /\/api\/public[\s\S]{0,80}\b(?:to|->|routes?\s+to)\b[\s\S]{0,80}\bweb\b/iu)
        && hasPositiveBlock(blocks, /\/api\/system[\s\S]{0,80}\b(?:to|->|routes?\s+to)\b[\s\S]{0,80}\bweb\b/iu)
      ),
  },
  {
    label: 'no execution-gateway',
    predicate: (blocks: readonly MarkdownBlock[]) =>
      blocks.some((block) =>
        /\bexecution-gateway\b/iu.test(block.text)
        && /\b(no|without|must not|should not|does not|do not|not include|not included|removed|superseded|forbidden|rejects?)\b/iu.test(block.text),
      ),
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

type ReadResult =
  | { ok: true; content: string }
  | { ok: false };

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
): ReadResult {
  const absolutePath = join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    addFailure(failures, relativePath, missingMessage);
    return { ok: false };
  }

  return { ok: true, content: readFileSync(absolutePath, 'utf8') };
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

    const headingMatch = line.text.match(/^(#{1,6})\s+/u);
    if (headingMatch) {
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

function normalizeMarkdownText(text: string): string {
  return text
    .replace(/[`*_#[\]()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function contextTextForBlock(block: MarkdownBlock): string {
  return `${block.headingPath.join(' > ')}\n${block.text}`;
}

function includesLegacyTerm(text: string): boolean {
  return LEGACY_DEPLOYMENT_TERMS.some((term) => text.includes(term));
}

function isLegacyContextAllowed(block: MarkdownBlock): boolean {
  return LEGACY_CONTEXT_ALLOWLIST.some((pattern) => pattern.test(contextTextForBlock(block)));
}

function hasPositiveBlock(blocks: readonly MarkdownBlock[], pattern: RegExp): boolean {
  return blocks.some((block) =>
    pattern.test(block.text)
    && !/\b(no|not|without|must not|should not|does not|do not|forbidden|rejects?|removed|superseded|retired|deprecated)\b/iu.test(block.text),
  );
}

function validatesActiveFutureModeClaim(block: MarkdownBlock): boolean {
  if (!includesLegacyTerm(block.text)) {
    return false;
  }

  const context = contextTextForBlock(block);
  return ACTIVE_MODE_WORDS.test(context)
    && MODE_NOUNS.test(context)
    && !ACTIVE_MODE_NEGATION.test(context);
}

function shouldIgnoreForbiddenTargetBlock(block: MarkdownBlock): boolean {
  return FORBIDDEN_TARGET_NEGATION.test(contextTextForBlock(block));
}

function validateTargetContract(
  content: string,
  failures: UnifiedDeployVocabularyFailure[],
): void {
  const lines = parseMarkdownLines(content);
  const blocks = parseMarkdownBlocks(lines);

  if (!/\btarget_v2_contract\b/u.test(content)) {
    addFailure(
      failures,
      TARGET_CONTRACT_PATH,
      'unified deploy target-v2 contract must contain target_v2_contract marker.',
    );
  }
  if (!/\bnot_current_runtime_truth\b/u.test(content)) {
    addFailure(
      failures,
      TARGET_CONTRACT_PATH,
      'unified deploy target-v2 contract must contain not_current_runtime_truth marker.',
    );
  }

  for (const decision of REQUIRED_TARGET_DECISIONS) {
    if (!decision.predicate(blocks)) {
      addFailure(
        failures,
        TARGET_CONTRACT_PATH,
        `target-v2 contract must state ${decision.label}.`,
      );
    }
  }

  for (const block of blocks) {
    for (const term of LEGACY_DEPLOYMENT_TERMS) {
      if (block.text.includes(term) && !isLegacyContextAllowed(block)) {
        addFailure(
          failures,
          TARGET_CONTRACT_PATH,
          `legacy deployment term ${term} may appear only in allowed migration/current-v1/legacy/historical/negative/superseded contexts.`,
          block.startLine,
          block.text,
        );
      }
    }
  }

  for (const block of blocks) {
    if (validatesActiveFutureModeClaim(block)) {
      addFailure(
        failures,
        TARGET_CONTRACT_PATH,
        'target-v2 contract must not claim demo-deploy/cluster-deploy are active future product modes.',
        block.startLine,
        block.text,
      );
    }

    if (shouldIgnoreForbiddenTargetBlock(block)) {
      continue;
    }

    for (const forbidden of FORBIDDEN_TARGET_PATTERNS) {
      if (forbidden.pattern.test(block.text)) {
        addFailure(
          failures,
          TARGET_CONTRACT_PATH,
          `target-v2 must not state ${forbidden.label}.`,
          block.startLine,
          block.text,
        );
      }
    }
  }
}

function validateV1BoundaryNotes(
  rootDir: string,
  failures: UnifiedDeployVocabularyFailure[],
): void {
  for (const contractPath of V1_CONTRACT_PATHS) {
    const result = readRequiredText(
      rootDir,
      contractPath,
      failures,
      `${contractPath} must exist for the current-v1 boundary check.`,
    );

    if (!result.ok) {
      continue;
    }

    if (!/\bcurrent[-_ ]v1 boundary(?: note)?\b/iu.test(result.content)) {
      addFailure(
        failures,
        contractPath,
        'v1 deployment contract must include a current-v1 boundary note.',
      );
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
  const result = readRequiredText(
    rootDir,
    'package.json',
    failures,
    'package.json must exist for unified deploy vocabulary checker wiring.',
  );

  if (!result.ok) {
    return;
  }

  const packageJson = parsePackageJson(result.content, failures);
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

  const targetContract = readRequiredText(
    rootDir,
    TARGET_CONTRACT_PATH,
    failures,
    'unified deploy target-v2 contract must exist at docs/contracts/unified-deploy-contract-v2.md.',
  );
  if (targetContract.ok) {
    validateTargetContract(targetContract.content, failures);
  }

  validateV1BoundaryNotes(rootDir, failures);
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
