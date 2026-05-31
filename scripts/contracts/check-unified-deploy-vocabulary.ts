import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPLOY_CONTRACT_PATH = 'docs/contracts/unified-deploy-contract.md';
const CHECK_NPM_SCRIPT = 'contracts:check-unified-deploy-vocabulary';
const CHECK_SCRIPT_COMMAND = 'tsx scripts/contracts/check-unified-deploy-vocabulary.ts';
const RELEASE_KIT_SPLIT_PLAN_PATH = 'docs/engineering/release-kit-and-runner-repo-split-kiss-plan-v1.md';

const ACTIVE_DEPLOY_TRUTH_FILES = [
  'README.md',
  DEPLOY_CONTRACT_PATH,
  RELEASE_KIT_SPLIT_PLAN_PATH,
  'docs/engineering/README.md',
  'docs/contracts/README.md',
  'docs/contracts/product-terminology.md',
  'docs/CURRENT_BASELINE.md',
  'docs/README.md',
  'docs/current-engineering-governance-model.md',
  'docs/testing/verification-campaigns-v1.md',
  'docs/user-guides/README.md',
  'docs/user-guides/local-runtime-flows.md',
  'docs/user-guides/release-readiness-checklist.md',
  'docs/user-guides/runtime-lines-matrix.md',
  'docs/user-guides/uxui-review-runbook.md',
  'docs/user-guides/unified-deploy-operations.md',
  'docs/agent-task-runner-runbook.md',
  'DEVELOPMENT.md',
  'AGENTS.md',
  '.env.local-manual.example',
  '.github/workflows/contracts-check.yml',
  '.gitignore',
  'package.json',
  'Makefile',
  'scripts/workspace-project-default-gate.sh',
  'scripts/contracts/check-current-gates.ts',
  'scripts/contracts/check-current-runtime-lines.ts',
  'scripts/contracts/check-current-workflows.ts',
  'scripts/contracts/check-engineering-governance.ts',
  'scripts/governance/current-gate-manifest.ts',
  'scripts/governance/current-resource-lock-manifest.ts',
  'scripts/governance/current-runtime-line-manifest.ts',
  'scripts/governance/current-workflow-manifest.ts',
  'scripts/governance/current-verification-campaign-manifest.ts',
  'scripts/governance/current-status-projection-schema.ts',
  'scripts/governance/current-governance-observability-manifest.ts',
  'scripts/governance/release-campaign-execution.ts',
  'scripts/governance/release-ready.ts',
  'scripts/governance/release-summary.ts',
  'scripts/governance/run-current-verification-campaign.ts',
  'scripts/governance/run-verify.ts',
  'scripts/governance/verify-impact-selector.ts',
  'scripts/agent-task-terminal-matrix-real-gate.sh',
  'scripts/agent-task-terminal-real-smoke.sh',
  'scripts/local-manual/internal-common.sh',
  'scripts/local-manual/seed-agent-task-diagnostics.sh',
  'scripts/local-manual/verify-agent-task-diagnostics.sh',
] as const;

const P0_HANDOFF_BOUNDARY_FILES = new Set<string>([
  'docs/engineering/README.md',
  DEPLOY_CONTRACT_PATH,
  'docs/contracts/README.md',
  'docs/contracts/product-terminology.md',
  'docs/user-guides/runtime-lines-matrix.md',
  'docs/user-guides/unified-deploy-operations.md',
]);

const RELEASE_KIT_HANDOFF_BOUNDARY_FILES = new Set<string>([
  'docs/user-guides/release-readiness-checklist.md',
  'docs/user-guides/unified-deploy-operations.md',
]);

const CURRENT_RELEASE_SUBSTRATE_STRATEGY_FILES = new Set<string>([
  'README.md',
  DEPLOY_CONTRACT_PATH,
  RELEASE_KIT_SPLIT_PLAN_PATH,
  'docs/CURRENT_BASELINE.md',
  'docs/current-engineering-governance-model.md',
  'docs/contracts/README.md',
  'docs/contracts/product-terminology.md',
  'docs/engineering/README.md',
  'docs/user-guides/README.md',
  'docs/user-guides/local-runtime-flows.md',
  'docs/user-guides/runtime-lines-matrix.md',
  'DEVELOPMENT.md',
]);

const CURRENT_OPERATOR_STRATEGY_PATTERN =
  /\bonline\b[\s\S]{0,80}\bairgap\b[\s\S]{0,120}\buse_existing\b[\s\S]{0,80}\bkit_provided\b|\buse_existing\b[\s\S]{0,80}\bkit_provided\b[\s\S]{0,120}\bonline\b[\s\S]{0,80}\bairgap\b/iu;

const FUTURE_INSTALL_SUBSTRATES_PATTERN =
  /\binstall_substrates\b[\s\S]{0,200}(?:\b(?:future|installer\s+producer|installer\s+confirmation|confirmation\s+flag|fail[- ]?fast|not\s+current|future\s+capability)\b|(?:未来|后续|不是当前|当前不|失败|安装器|确认\s*flag|显式))|(?:未来|后续|不是当前|当前不|失败|安装器|确认\s*flag|显式)[\s\S]{0,120}\binstall_substrates\b/iu;

const ALLOWED_FUTURE_INSTALL_SUBSTRATES_LINE =
  /\b(?:future|installer\s+producer|installer\s+confirmation|confirmation\s+flag|fail[- ]?fast|not\s+current|future\s+capability)\b|(?:未来|后续|不是当前|当前不|失败|安装器|确认\s*flag|显式)/iu;

const FORBIDDEN_CURRENT_INSTALL_SUBSTRATES_LINES = [
  /\bformal\s+release\s+language\b[\s\S]{0,120}\binstall_substrates\b/iu,
  /正式\s*release\s*语言[\s\S]{0,120}\binstall_substrates\b/iu,
  /\boperator-facing\b[\s\S]{0,120}\binstall_substrates\b/iu,
  /operator-facing\s*发布语言[\s\S]{0,120}\binstall_substrates\b/iu,
  /\b(?:online|airgap)\b`?\s*(?:\+|\/|和|与)\s*`?\binstall_substrates\b/iu,
  /\buse_existing\b`?\s*(?:\/|和|与)\s*`?\binstall_substrates\b/iu,
  /\b(?:cover|covers|covering)\b[\s\S]{0,120}\buse_existing\b[\s\S]{0,80}\binstall_substrates\b/iu,
  /覆盖[\s\S]{0,120}\buse_existing\b[\s\S]{0,80}\binstall_substrates\b/iu,
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
    pattern: /\bdemo[-_ ]deploy\b|(?<!existing[-_ ])\bcluster[-_ ]deploy\b|\b(?:DEMO|CLUSTER)_DEPLOY_MODE\b/iu,
  },
  {
    label: 'removed rehearsal command family',
    pattern: /\b(?:demo|cluster)[-_ ]rehearsal\b|\brehearse:(?:demo|cluster)\b|\blane-(?:demo|cluster)-rehearsal\b/iu,
  },
  {
    label: 'generic demo mental model',
    pattern: /\bagent[- ]tasks?\s+demo\b|\bapp[- ]shell\s+demo\b|\bdemo\s+(?:seed(?:ing)?|resources?|evidence|state|ready|verify)\b|\bseed-agent-task-demo\.sh\b|\bverify-agent-task-demo\.sh\b/iu,
  },
] as const;

const FORBIDDEN_PACKAGE_SCRIPT_KEY_PREFIXES = [
  {
    label: 'removed demo package script alias',
    pattern: /^demo:/iu,
  },
  {
    label: 'removed cluster package script alias',
    pattern: /^cluster:/iu,
  },
  {
    label: 'removed rehearsal package script alias',
    pattern: /^rehearse:/iu,
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

const FORBIDDEN_RELEASE_KIT_SPLIT_PLAN_CLAIMS = [
  {
    label: 'kind/local-kind formal release target or prerequisite',
    pattern: /\b(?:local-kind|kind|kind_rehearsal)\b[\s\S]{0,100}\b(?:(?:formal|official|production)\s+(?:release\s+)?targets?|(?:operator|deployment|release)\s+prerequisites?|required\s+(?:operator|deployment|release|production)\s+(?:targets?|prerequisites?)|production\s+defaults?|airgap\s+declarable\s+targets?)\b|\b(?:(?:formal|official|production)\s+(?:release\s+)?targets?|(?:operator|deployment|release)\s+prerequisites?|required\s+(?:operator|deployment|release|production)\s+(?:targets?|prerequisites?)|production\s+defaults?|airgap\s+declarable\s+targets?)\b[\s\S]{0,100}\b(?:local-kind|kind|kind_rehearsal)\b|\b(?:local-kind|kind|kind_rehearsal)\b[\s\S]{0,100}(?:正式\s*release\s*target|正式目标|用户部署前提|生产默认|必需部署目标)/iu,
  },
  {
    label: 'release-kit focused evidence as AgentSmith release readiness',
    pattern: /\b(?:release[- ]kit|online-adoption-report|airgap-adoption-report|release-engineering-gate-intake|focused evidence|focused diagnostics?)\b[\s\S]{0,160}\b(?:becomes?|is|equals?|counts?\s+as|feeds?|maps?\s+into|writes?\s+into|connects?\s+to)\b[\s\S]{0,120}\b(?:AgentSmith\s+)?(?:release:ready|release readiness|product readiness|product gate)\b|\b(?:AgentSmith\s+)?(?:release:ready|release readiness|product readiness|product gate)\b[\s\S]{0,160}\b(?:uses?|requires?|consumes?|accepts?|includes?|is|equals?)\b[\s\S]{0,120}\b(?:release[- ]kit|online-adoption-report|airgap-adoption-report|release-engineering-gate-intake|focused evidence|focused diagnostics?)\b/iu,
  },
  {
    label: 'deployment/operator verdict connected to release:ready',
    pattern: /\brelease:ready\b[\s\S]{0,160}\b(?:owns?|produces?|issues?|gives?|includes?|requires?|consumes?|accepts?|uses?|writes?|maps?|feeds?|connects?|adopts?|is|becomes?|equals?)\b[\s\S]{0,120}\b(?:deployment|deploy|package|operator)\b[\s\S]{0,80}\b(?:verdict|readiness|gate|evidence)\b|\b(?:deployment|deploy|package|operator)\b[\s\S]{0,80}\b(?:verdict|readiness|gate|evidence)\b[\s\S]{0,160}\b(?:feeds?|maps?|connects?|writes?|belongs?\s+to|is|becomes?|equals?)\b[\s\S]{0,120}\brelease:ready\b/iu,
  },
] as const;

const NEGATED_CLAIM_WORDS = /\b(no|not|without|must not|should not|does not|do not|forbidden|rejects?|out of scope|does not include|not include|not included|separate architecture plan|fail-fast contract tests?)\b|(?:不是|不属于|不在|不得|不能|不应|不要|无需|不进入|不等于|不作为|不代表|不再|未|没有|只作为|只允许)/iu;

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

function lineTextForIndex(content: string, index: number): string {
  const start = content.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const end = content.indexOf('\n', index);
  return content.slice(start, end === -1 ? content.length : end).replace(/\r$/u, '');
}

function lineForPackageScriptKey(content: string, scriptName: string): number | undefined {
  const index = content.indexOf(JSON.stringify(scriptName));
  return index >= 0 ? lineForIndex(content, index) : undefined;
}

function asGlobalRegExp(pattern: RegExp): RegExp {
  return new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
}

function isAllowedLegacyDenylistMatch(args: {
  path: string;
  forbiddenLabel: string;
  content: string;
  index: number;
}): boolean {
  if (args.path !== '.gitignore' || args.forbiddenLabel !== 'removed deploy command family') {
    return false;
  }

  return lineTextForIndex(args.content, args.index).trim() === '.infra/cluster-deploy/';
}

function validateNoSplitDeployVocabulary(
  path: string,
  content: string,
  failures: UnifiedDeployVocabularyFailure[],
): void {
  for (const forbidden of FORBIDDEN_SPLIT_DEPLOY_TERMS) {
    const pattern = asGlobalRegExp(forbidden.pattern);
    for (const match of content.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (
        isAllowedLegacyDenylistMatch({
          path,
          forbiddenLabel: forbidden.label,
          content,
          index,
        })
      ) {
        continue;
      }

      const line = lineForIndex(content, index);
      addFailure(
        failures,
        path,
        `current deploy truth must not use ${forbidden.label}; fold the logic into the current deploy model.`,
        line,
        match[0],
      );
    }
  }
}

function validateCurrentReleaseSubstrateStrategy(
  path: string,
  content: string,
  failures: UnifiedDeployVocabularyFailure[],
): void {
  if (!CURRENT_RELEASE_SUBSTRATE_STRATEGY_FILES.has(path)) {
    return;
  }

  if (!CURRENT_OPERATOR_STRATEGY_PATTERN.test(content)) {
    addFailure(
      failures,
      path,
      `${path} must state the current operator-facing substrate strategy as online/airgap x use_existing/kit_provided.`,
    );
  }

  if (!FUTURE_INSTALL_SUBSTRATES_PATTERN.test(content)) {
    addFailure(
      failures,
      path,
      `${path} must keep install_substrates as a future capability that requires an independent installer producer and explicit installer confirmation flag.`,
    );
  }

  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of FORBIDDEN_CURRENT_INSTALL_SUBSTRATES_LINES) {
      if (!pattern.test(line) || ALLOWED_FUTURE_INSTALL_SUBSTRATES_LINE.test(line)) {
        continue;
      }

      addFailure(
        failures,
        path,
        'current operator-facing substrate strategy must use kit_provided, not install_substrates.',
        index + 1,
        line,
      );
    }
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

function hasBlockWithPatterns(blocks: readonly MarkdownBlock[], patterns: readonly RegExp[]): boolean {
  return blocks.some((block) => patterns.every((pattern) => pattern.test(block.text)));
}

function hasNearbyTextWithPatterns(
  blocks: readonly MarkdownBlock[],
  patterns: readonly RegExp[],
  radius = 3,
): boolean {
  return blocks.some((_block, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(blocks.length, index + radius + 1);
    const nearbyText = blocks.slice(start, end).map((block) => block.text).join(' ');

    return patterns.every((pattern) => pattern.test(nearbyText));
  });
}

function splitClaimSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;。！？；])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function isNegatedClaimMatch(sentence: string, matchIndex: number, matchText: string): boolean {
  const sameSentencePrefix = sentence.slice(0, matchIndex);

  return NEGATED_CLAIM_WORDS.test(`${sameSentencePrefix} ${matchText}`);
}

function findPositiveForbiddenClaim(text: string, pattern: RegExp): string | null {
  for (const sentence of splitClaimSentences(text)) {
    const globalPattern = asGlobalRegExp(pattern);
    for (const match of sentence.matchAll(globalPattern)) {
      const matchText = match[0];
      if (isNegatedClaimMatch(sentence, match.index ?? 0, matchText)) {
        continue;
      }

      return matchText;
    }
  }

  return null;
}

function validateP0HandoffBoundary(
  path: string,
  content: string,
  failures: UnifiedDeployVocabularyFailure[],
): void {
  const blocks = parseMarkdownBlocks(parseMarkdownLines(content));
  const hasCompleteBoundaryBlock = hasBlockWithPatterns(blocks, [
    /\bcurrent\b|当前/iu,
    /\bDocker[- ]only\b/iu,
    /\blocal-kind\b/iu,
    /\bunified deploy\b/iu,
    /\bmainline\b|主线|\b(?:pre-GA|focused diagnostic|diagnostic baseline|diagnostic)\b|过渡期专项诊断|诊断/iu,
    /\bexternal[-_ ]declared\b/iu,
    /\bP0\b/u,
    /\bschema\b/iu,
    /\bfixtures?\b/iu,
    /\bvalidator\b/iu,
    /\bevidence\s+boundary\b/iu,
    /\bP2\b/u,
    /\bP3\b/u,
    /\bdoes not mean\b|\bnot\b[\s\S]{0,80}\bcomplete\b|不能|不得|不等于|未[\s\S]{0,40}支持/u,
    /\breal Kubernetes\b|真实\s*(?:K8s|Kubernetes)/iu,
    /\bcloud\b|云端/iu,
    /\bairgap\b|离线/iu,
    /\bhandoff\b|交接|交付/u,
  ]);

  if (!hasCompleteBoundaryBlock) {
    addFailure(
      failures,
      path,
      `${path} must state the P0/vNext handoff boundary: current Docker-only/local-kind unified deploy is a pre-GA focused diagnostic baseline, not a long-term deployment truth; external_declared is P0 schema/fixture/validator/evidence boundary only; P2/P3 real Kubernetes/cloud/airgap handoff is not complete.`,
    );
  }
}

function validateReleaseKitHandoffBoundary(
  path: string,
  content: string,
  failures: UnifiedDeployVocabularyFailure[],
): void {
  const blocks = parseMarkdownBlocks(parseMarkdownLines(content));
  const hasBoundary = hasNearbyTextWithPatterns(blocks, [
    /\bAgentSmith\b/u,
    /\bcurrent\b|当前/iu,
    /\bproduct readiness\b|产品验收|产品 readiness/iu,
    /\bfull visual\b/iu,
    /\bbackend-real\b/iu,
    /\bterminal aggregate\b/iu,
    /\bunified deploy\b/iu,
    /\blocal-kind\b/iu,
    /\btransition-only\b|\bpre-GA\b/iu,
    /\bfocused diagnostics?\b/iu,
    /过渡期专项诊断/u,
    /\bnot\b[\s\S]{0,120}\b(?:AgentSmith product gate|AgentSmith release verdict|(?:deployment|deploy)[\s\S]{0,50}package[\s\S]{0,50}operator[\s\S]{0,30}verdict|deploy\/package\/operator verdict)\b|不属于[\s\S]{0,80}(?:AgentSmith 产品门禁|AgentSmith release verdict|AgentSmith product gate)/iu,
    /\brelease[- ]kit\b|\bagentsmith-release-kit\b/iu,
    /\bfuture\b|\bready\s+后\b|完成后|未来|长期/u,
    /\bdeploy(?:ment)?\b|部署/iu,
    /\bpackage\b|发布包/iu,
    /\boperator\b|\brunbooks?\b|运维|操作手册/iu,
    /\bverdict\b|\bgate\b|\bevidence\b|结论|验收/iu,
    /\bown(?:s|er|ership)?\b|负责|归/u,
    /\bimages?\b|镜像/iu,
    /\brelease contract\b|\bimage contract\b|发布合同/iu,
    /\blocal full test\b|本地完整测试/iu,
    /\bthin adapter\b|薄\s*adapter/iu,
  ]);

  if (!hasBoundary) {
    addFailure(
      failures,
      path,
      `${path} must state the release-kit handoff boundary: AgentSmith release:ready is product readiness / local complete / current product gate, not a deployment/package/operator verdict; unified deploy/local-kind deploy commands are transition-only focused diagnostics / 过渡期专项诊断; release-kit owns deploy/package/operator verdict through repo-local gate/evidence; AgentSmith retains product readiness, images/release contract, local full test, and thin adapter.`,
    );
  }

  if (/legacy\/focused diagnostics|legacy focused diagnostics|legacy deploy diagnostics|旧部署诊断/iu.test(content)) {
    addFailure(
      failures,
      path,
      `${path} must not describe current unified deploy diagnostics as legacy; use transition-only focused diagnostics / 过渡期专项诊断.`,
    );
  }
}

function validateReleaseKitSplitPlan(
  content: string,
  failures: UnifiedDeployVocabularyFailure[],
): void {
  const blocks = parseMarkdownBlocks(parseMarkdownLines(content));

  for (const block of blocks) {
    for (const forbidden of FORBIDDEN_RELEASE_KIT_SPLIT_PLAN_CLAIMS) {
      const forbiddenClaim = findPositiveForbiddenClaim(block.text, forbidden.pattern);
      if (forbiddenClaim === null) {
        continue;
      }

      addFailure(
        failures,
        RELEASE_KIT_SPLIT_PLAN_PATH,
        `release kit split plan must not state ${forbidden.label}.`,
        block.startLine,
        forbiddenClaim,
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

  for (const scriptName of Object.keys(scripts)) {
    for (const forbidden of FORBIDDEN_PACKAGE_SCRIPT_KEY_PREFIXES) {
      if (!forbidden.pattern.test(scriptName)) {
        continue;
      }
      addFailure(
        failures,
        'package.json',
        `package.json script key ${scriptName} must not use ${forbidden.label}; fold current deploy entrypoints into unified deploy scripts.`,
        lineForPackageScriptKey(content, scriptName),
        scriptName,
      );
    }
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
    validateCurrentReleaseSubstrateStrategy(path, content, failures);
    if (P0_HANDOFF_BOUNDARY_FILES.has(path)) {
      validateP0HandoffBoundary(path, content, failures);
    }
    if (RELEASE_KIT_HANDOFF_BOUNDARY_FILES.has(path)) {
      validateReleaseKitHandoffBoundary(path, content, failures);
    }
    if (path === RELEASE_KIT_SPLIT_PLAN_PATH) {
      validateReleaseKitSplitPlan(content, failures);
    }
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
