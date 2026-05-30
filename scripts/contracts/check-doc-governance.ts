import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();

const SCAN_ROOTS = ['README.md', 'AGENTS.md', 'DESIGN.md', 'DEVELOPMENT.md', 'docs'] as const;

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'artifacts', 'marketing']);

const RELEASE_KIT_SPLIT_PLAN = 'docs/engineering/release-kit-and-runner-repo-split-kiss-plan-v1.md';

const DOC_INDEX_EXPECTATIONS: Array<{ file: string; includes: string[] }> = [
  {
    file: 'docs/README.md',
    includes: ['CURRENT_BASELINE.md', 'contracts/README.md', 'user-guides/README.md'],
  },
  {
    file: 'docs/user-guides/README.md',
    includes: ['local-runtime-flows.md', 'test-and-evidence-directory-model.md'],
  },
  {
    file: 'docs/testing/README.md',
    includes: ['visual-baseline-policy-v1.md', '2026-02-05-前端-testid-规范.md'],
  },
];

const ACTIVE_ASBCP_GUIDANCE_FILES = new Set([
  'DEVELOPMENT.md',
  'docs/engineering/afscp-file-library-runtime-rearchitecture-plan.md',
  'docs/engineering/internal-agent-terminal-pod-lifecycle-analysis-v1.md',
  'docs/engineering/file-library-version-management-fast-path-plan-v1.md',
  'docs/engineering/agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md',
]);

const HISTORICAL_ASBCP_REFERENCE_NOTICES = new Map([
  [
    'docs/engineering/agentsmith-sandbox-control-plane-release-independence-plan-v1.md',
    '本文件降级为历史迁移计划与 AgentSmith consumer-side 边界说明',
  ],
]);

const ACTIVE_ASBCP_GUIDANCE_RULES: Array<{ rule: string; regex: RegExp; detail: string }> = [
  {
    rule: 'legacy-asbcp-source-guidance',
    regex: /\.\.\/mbos-sandbox-v1|\bmbos-sandbox-v1\b/u,
    detail: 'Active docs must use ASBCP image/contract collaboration, not sibling sandbox source guidance.',
  },
  {
    rule: 'legacy-asbcp-manager-guidance',
    regex: /\bsandbox-manager\b|\bsandbox manager\b|\bSandbox Manager\b|\bsandbox_manager\b|\b[Ss]andboxManager\b/u,
    detail: 'Active docs must not route developers back to sandbox-manager terminology.',
  },
  {
    rule: 'legacy-asbcp-env-guidance',
    regex: /\bSANDBOX_MANAGER[A-Z0-9_]*\b|\bSANDBOX_SOURCE_DIR\b/u,
    detail: 'Active docs must not use legacy sandbox manager env guidance.',
  },
  {
    rule: 'product-unsafe-sandbox-workload-guidance',
    regex: /\bsandbox workload\b/iu,
    detail: 'Active docs should describe task execution workload/environment instead of sandbox workload.',
  },
];

type Violation = {
  file: string;
  line: number;
  rule: string;
  detail: string;
};

const BANNED_RULES: Array<{ rule: string; regex: RegExp; detail: string; currentOnly?: boolean }> = [
  {
    rule: 'deprecated-doc-path',
    regex: /docs\/release\//,
    detail: 'Deprecated docs path `docs/release/` must not be referenced.',
  },
  {
    rule: 'deprecated-doc-path',
    regex: /docs\/plans\//,
    detail: 'Deprecated docs path `docs/plans/` must not be referenced.',
  },
  {
    rule: 'removed-root-instruction-name',
    regex: /CLAUDE\.md/,
    detail: 'Root instruction truth has been converged to `AGENTS.md`.',
    currentOnly: true,
  },
  {
    rule: 'removed-legacy-design-truth',
    regex: /视觉设计系统-v1\.md/,
    detail: 'Legacy visual design truth must not be referenced by current docs; use `DESIGN.md` instead.',
    currentOnly: true,
  },
  {
    rule: 'removed-doc-archive-path',
    regex: /docs\/archive\//,
    detail: 'Current docs must not reference docs/archive/.',
    currentOnly: true,
  },
  {
    rule: 'removed-redirect-doc-model',
    regex: /Status:\s*`redirect`/,
    detail: 'Redirect/tombstone docs are no longer allowed in the current documentation tree.',
  },
  {
    rule: 'archive-index-leaked-into-current-docs',
    regex: /\bArchive Index\b|archived example/i,
    detail: 'Current docs must not advertise archive/example navigation.',
    currentOnly: true,
  },
  {
    rule: 'deprecated-release-governance-doc',
    regex: /release-governance-control-plane\.md/,
    detail: 'Removed governance doc must not be referenced.',
  },
  {
    rule: 'ambiguous-gate-terminology',
    regex: /`release`\s*\/\s*`gate`/,
    detail:
      'Use explicit terminology: `release`/`engineering gate` for engineering workflow, and `permission gate` for product access control.',
  },
  {
    rule: 'removed-formal-gate-wording',
    regex: /\bformal gate\b/i,
    detail: 'Use `engineering gate` wording instead of `formal gate`.',
  },
  {
    rule: 'deprecated-env-entrypoint',
    regex: /Copy `\.env\.example` to `\.env\.local`/,
    detail: 'Current local frontend/backend entrypoint must use `.env.local.example`, not `.env.example`.',
  },
  {
    rule: 'deprecated-local-api-base-example',
    regex: /^\s*NEXT_PUBLIC_API_BASE=http:\/\/localhost:\d+\s*$/,
    detail: 'Current local frontend API base examples must include `/api/v1`.',
  },
  {
    rule: 'deprecated-preset-protocol-example',
    regex: /PRESET_ANTHROPIC_ENDPOINT_PROTOCOL=anthropic_compatible/,
    detail: 'Current preset protocol examples must use canonical protocol names.',
  },
  {
    rule: 'deprecated-preset-protocol-example',
    regex: /PRESET_OPENAI_ENDPOINT_PROTOCOL=openai_compatible/,
    detail: 'Current preset protocol examples must use canonical protocol names.',
  },
  {
    rule: 'legacy-runtime-compatibility-wording',
    regex: /compatibility requires it|backward compatibility|compatible while moving toward/i,
    detail: 'Pre-GA current docs must state the target model directly, not describe legacy compatibility bridges.',
  },
  {
    rule: 'retired-agent-task-runbook-name',
    regex: /notebook-codex-runbook\.md|Notebook Codex Runner Runbook/,
    detail: 'Current docs must use Agent Task Runner Runbook and docs/agent-task-runner-runbook.md.',
  },
];

const REDIRECT_STATUS_REGEX = /Status:\s*`redirect`/i;

const HISTORICAL_LIFECYCLE_MARKERS = [
  'handoff',
  'refactor',
  'migration',
  'retro',
  'todo',
  'phase',
  'archive',
  'redirect',
] as const;

const CURRENT_INDEX_LIFECYCLE_ENTRY_REGEX =
  /\b(handoff_plan_ready|handoff|refactor|migration|retro|todo|phase|archive|redirect)\b/i;

function toRel(filePath: string): string {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

function collectMarkdownFiles(target: string): string[] {
  const abs = path.join(ROOT, target);
  if (!fs.existsSync(abs)) return [];

  const stat = fs.statSync(abs);
  if (stat.isFile()) return abs.endsWith('.md') ? [abs] : [];

  const out: string[] = [];
  const stack = [abs];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (entry.isFile() && full.endsWith('.md')) {
        out.push(full);
      }
    }
  }
  return out;
}

function containsHistoricalLifecycleMarker(value: string): boolean {
  return HISTORICAL_LIFECYCLE_MARKERS.some((marker) => {
    const markerRegex = new RegExp(`(^|[^a-z0-9])${marker}([^a-z0-9]|$)`, 'i');
    return markerRegex.test(value);
  });
}

export function isHistoricalDoc(relativePath: string, content: string): boolean {
  const normalized = relativePath.toLowerCase();
  const basename = path.basename(normalized);
  const titleLine = content.split('\n', 1)[0]?.toLowerCase() ?? '';

  return (
    normalized.startsWith('docs/archive/')
    || REDIRECT_STATUS_REGEX.test(content)
    || containsHistoricalLifecycleMarker(basename)
    || containsHistoricalLifecycleMarker(titleLine)
    || /Historical handoff note/i.test(content)
  );
}

function findViolations(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  const relativePath = toRel(filePath);
  const isHistorical = isHistoricalDoc(relativePath, content);

  if (relativePath.startsWith('docs/archive/')) {
    violations.push({
      file: relativePath,
      line: 1,
      rule: 'archive-doc-present',
      detail: 'docs/archive/ is not part of the current documentation model. Delete historical docs instead of keeping them in-tree.',
    });
  }

  if (REDIRECT_STATUS_REGEX.test(content)) {
    violations.push({
      file: relativePath,
      line: 1,
      rule: 'redirect-doc-present',
      detail: 'Redirect/tombstone docs are no longer allowed. Delete the file and update references directly.',
    });
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of BANNED_RULES) {
      if (rule.currentOnly && isHistorical) {
        continue;
      }
      if (rule.regex.test(line)) {
        violations.push({
          file: relativePath,
          line: i + 1,
          rule: rule.rule,
          detail: `${rule.detail} Found: ${line.trim()}`,
        });
      }
    }
  }
  return violations;
}

function checkActiveAsbcpGuidance(filePath: string, content: string): Violation[] {
  const relativePath = toRel(filePath);
  if (!ACTIVE_ASBCP_GUIDANCE_FILES.has(relativePath)) {
    return [];
  }

  const violations: Violation[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of ACTIVE_ASBCP_GUIDANCE_RULES) {
      if (!rule.regex.test(line)) {
        continue;
      }
      violations.push({
        file: relativePath,
        line: i + 1,
        rule: rule.rule,
        detail: `${rule.detail} Found: ${line.trim()}`,
      });
    }
  }
  return violations;
}

function checkHistoricalAsbcpReferenceNotice(filePath: string, content: string): Violation[] {
  const relativePath = toRel(filePath);
  const requiredNotice = HISTORICAL_ASBCP_REFERENCE_NOTICES.get(relativePath);
  if (!requiredNotice || content.includes(requiredNotice)) {
    return [];
  }

  return [{
    file: relativePath,
    line: 1,
    rule: 'missing-historical-asbcp-reference-notice',
    detail: 'Historical ASBCP old-name/source-build references require an exact-file historical notice and reason.',
  }];
}

function isExternalLink(link: string): boolean {
  return (
    link.startsWith('http://')
    || link.startsWith('https://')
    || link.startsWith('mailto:')
    || link.startsWith('file:')
    || link.startsWith('#')
  );
}

function checkMarkdownLinks(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  const linkRegex = /\[[^\]]+\]\(([^)]+)\)/g;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let match = linkRegex.exec(line);
    while (match) {
      const raw = match[1].trim();
      const target = raw.split('#')[0].split('?')[0].trim();
      if (target.length > 0 && !isExternalLink(target)) {
        const resolved = path.resolve(path.dirname(filePath), target);
        if (!fs.existsSync(resolved)) {
          violations.push({
            file: toRel(filePath),
            line: i + 1,
            rule: 'broken-local-link',
            detail: `Broken local link target: ${target}`,
          });
        }
      }
      match = linkRegex.exec(line);
    }
  }

  return violations;
}

function checkHistoricalDocsPlacement(filePath: string, content: string): Violation[] {
  const relativePath = toRel(filePath);
  if (!isHistoricalDoc(relativePath, content)) {
    return [];
  }

  return [
    {
      file: relativePath,
      line: 1,
      rule: 'historical-doc-present',
      detail:
        'Historical handoff/refactor/migration/retro/todo/phase/archive/redirect docs must not remain in the current documentation tree. Delete them instead of keeping compatibility material.',
    },
  ];
}

function checkIndexExpectations(): Violation[] {
  const violations: Violation[] = [];
  for (const expectation of DOC_INDEX_EXPECTATIONS) {
    const absPath = path.join(ROOT, expectation.file);
    if (!fs.existsSync(absPath)) {
      continue;
    }
    const content = fs.readFileSync(absPath, 'utf8');
    for (const needle of expectation.includes) {
      if (!content.includes(needle)) {
        violations.push({
          file: expectation.file,
          line: 1,
          rule: 'missing-doc-index-entry',
          detail: `Current doc index must include ${needle}.`,
        });
      }
    }
  }
  return violations;
}

export function findEngineeringIndexCurrentSectionViolations(
  content: string,
  file = 'docs/engineering/README.md',
): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  const startIndex = lines.findIndex((line) => /^Current .+:$/.test(line.trim()));
  if (startIndex === -1) {
    return violations;
  }

  const nextSectionIndex = lines.findIndex((line, index) => (
    index > startIndex
    && line.trim().endsWith(':')
    && !line.trim().startsWith('-')
  ));
  const endIndex = nextSectionIndex === -1 ? lines.length : nextSectionIndex;

  for (let i = startIndex + 1; i < endIndex; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('-')) {
      continue;
    }
    if (!CURRENT_INDEX_LIFECYCLE_ENTRY_REGEX.test(line)) {
      continue;
    }
    violations.push({
      file,
      line: i + 1,
      rule: 'historical-doc-current-index-entry',
      detail:
        'Engineering current docs index must not list handoff/refactor/migration/retro/todo/phase/archive/redirect material as a current entrypoint.',
    });
  }

  return violations;
}

function checkEngineeringIndexCurrentSection(): Violation[] {
  const file = 'docs/engineering/README.md';
  const absPath = path.join(ROOT, file);
  if (!fs.existsSync(absPath)) {
    return [];
  }
  return findEngineeringIndexCurrentSectionViolations(
    fs.readFileSync(absPath, 'utf8'),
    file,
  );
}

function findLineNumber(content: string, matcher: string | RegExp): number {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (typeof matcher === 'string' ? line.includes(matcher) : matcher.test(line)) {
      return i + 1;
    }
  }
  return 1;
}

function extractSection(content: string, startRegex: RegExp, endRegex: RegExp): { content: string; startLine: number } {
  const lines = content.split('\n');
  const startIndex = lines.findIndex((line) => startRegex.test(line.trim()));
  if (startIndex === -1) {
    return { content: '', startLine: 1 };
  }
  const endIndex = lines.findIndex((line, index) => index > startIndex && endRegex.test(line.trim()));
  return {
    content: lines.slice(startIndex, endIndex === -1 ? lines.length : endIndex).join('\n'),
    startLine: startIndex + 1,
  };
}

type TextBlock = {
  content: string;
  startLine: number;
};

function normalizeBlock(content: string): string {
  return content.replaceAll('`', '').replace(/\s+/gu, ' ').trim();
}

function splitMarkdownBlocks(content: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const lines = content.split('\n');
  let current: string[] = [];
  let startLine = 1;

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    blocks.push({
      content: current.join('\n'),
      startLine,
    });
    current = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') {
      flush();
      continue;
    }

    const startsStandaloneBlock =
      /^#{1,6}\s/u.test(trimmed)
      || /^[-*]\s/u.test(trimmed)
      || /^\d+\.\s/u.test(trimmed);

    if (current.length > 0 && startsStandaloneBlock) {
      flush();
    }

    if (current.length === 0) {
      startLine = i + 1;
    }
    current.push(line);
  }

  flush();
  return blocks;
}

function isPositiveConstitutionWrite(line: string): boolean {
  const normalized = normalizeBlock(line);
  if (!/(?:docs\/项目宪法\.md|宪法条款)/u.test(normalized)) {
    return false;
  }
  if (!/(?:写入|写进|新增|加入|纳入|补充|修改|更新|改到|落到)/u.test(normalized)) {
    return false;
  }

  return !/(?:(?:不|不应|不要|不得|不能|未|没有|无需|不再).{0,100}(?:写入|写进|新增|加入|纳入|补充|修改|更新|改到|落到)|(?:写入|写进|新增|加入|纳入|补充|修改|更新|改到|落到).{0,100}(?:不|不应|不要|不得|不能|未|没有|无需|不再))/u.test(normalized);
}

function isAllowedP6ReleaseReadyReference(block: string): boolean {
  const normalized = normalizeBlock(block);

  return (
    /(?:(?:不默认|不是默认|不作为|不得|不能|不应|不可|未接入|不接入|不消费|不接回|不把|不给|不属于).{0,100}release:ready|release:ready.{0,100}(?:不默认|不是默认|不作为|不得|不能|不应|不可|未接入|不接入|不消费|不接回|不给|不属于))/u.test(normalized)
    || /(?:只有|仅当|只在|仅限|只限).{0,120}(?:release\/runtime\/product readiness|release.{0,30}runtime.{0,30}product readiness|release.{0,30}runtime|product readiness).{0,120}(?:release:ready|发布级重门禁|重门禁)/u.test(normalized)
    || /release:ready.{0,80}(?:仅限|只限|only when|only for).{0,100}(?:release|runtime|product readiness).{0,80}(?:路径|变更|改动|changes?)/iu.test(normalized)
  );
}

function isAllowedFormalOperatorReference(block: string): boolean {
  const normalized = normalizeBlock(block);
  const formalTerm = '(?:formal operator adoption verdict|formal release engineering verdict|offline release engineering gate)';

  return (
    new RegExp(`(?:不是|不等于|不作为|不得|不能|不应|不可|未接入|未输出|不再|不把|不能据此宣称).{0,120}${formalTerm}`, 'u').test(normalized)
    || new RegExp(`${formalTerm}.{0,120}(?:不是|不等于|不作为|不得|不能|不应|不可|未接入|未输出|不再|只输出|not_issued)`, 'u').test(normalized)
    || new RegExp(`(?:只有|仅当|只在|仅限|只限).{0,120}(?:客户|合规|GA|发布要求).{0,120}${formalTerm}`, 'u').test(normalized)
    || new RegExp(`${formalTerm}.{0,120}(?:只有|仅当|只在|仅限|只限).{0,120}(?:客户|合规|GA|发布要求)`, 'u').test(normalized)
  );
}

export function findReleaseKitSplitKissPlanViolations(
  content: string,
  file = RELEASE_KIT_SPLIT_PLAN,
): Violation[] {
  const violations: Violation[] = [];

  const p6Section = extractSection(content, /^### P6\./u, /^## 9\./u);
  const constitutionLines = content.split('\n');
  for (let i = 0; i < constitutionLines.length; i += 1) {
    if (!isPositiveConstitutionWrite(constitutionLines[i])) {
      continue;
    }
    violations.push({
      file,
      line: i + 1,
      rule: 'constitution-governance-expansion',
      detail:
        'Release-kit split plan must not turn this slice into a project constitution update.',
    });
  }

  for (const block of splitMarkdownBlocks(p6Section.content)) {
    if (!/release:ready/u.test(block.content) || isAllowedP6ReleaseReadyReference(block.content)) {
      continue;
    }
    violations.push({
      file,
      line: p6Section.startLine + block.startLine + findLineNumber(block.content, 'release:ready') - 2,
      rule: 'p6-lite-heavy-release-ready-default',
      detail:
        'P6-lite docs/old-reference cleanup must use doc/static guards and targeted contracts; release:ready is only for release/runtime/product readiness path changes.',
    });
  }

  const formalOperatorTermRegex = /formal operator adoption verdict|formal release engineering verdict|offline release engineering gate/u;
  const formalOperatorDefaultRegex =
    /仍未完成|未完成|后续|下一步|推进|待办|todo|blocker|阻断|默认|收口|验收|必须|要做|应当/u;
  for (const block of splitMarkdownBlocks(content)) {
    if (
      !formalOperatorTermRegex.test(block.content)
      || !formalOperatorDefaultRegex.test(block.content)
      || isAllowedFormalOperatorReference(block.content)
    ) {
      continue;
    }
    violations.push({
      file,
      line: block.startLine + findLineNumber(block.content, formalOperatorTermRegex) - 1,
      rule: 'heavy-formal-operator-verdict-default',
      detail:
        'Pre-GA split plan must not make formal operator adoption verdict the default next step without the explicit customer/compliance/GA trigger.',
    });
  }

  return violations;
}

function main(): void {
  const files = SCAN_ROOTS.flatMap((target) => collectMarkdownFiles(target)).sort();
  const violations: Violation[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    violations.push(...findViolations(file, content));
    violations.push(...checkActiveAsbcpGuidance(file, content));
    violations.push(...checkHistoricalAsbcpReferenceNotice(file, content));
    violations.push(...checkMarkdownLinks(file, content));
    violations.push(...checkHistoricalDocsPlacement(file, content));
    if (toRel(file) === RELEASE_KIT_SPLIT_PLAN) {
      violations.push(...findReleaseKitSplitKissPlanViolations(content));
    }
  }

  violations.push(...checkIndexExpectations());
  violations.push(...checkEngineeringIndexCurrentSection());

  if (violations.length > 0) {
    console.error('[docs-governance] check failed.');
    for (const v of violations) {
      console.error(`- ${v.file}:${v.line} [${v.rule}] ${v.detail}`);
    }
    process.exit(1);
  }

  console.log(`[docs-governance] check passed. scanned ${files.length} markdown files.`);
}

function isMainModule(): boolean {
  return Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  main();
}
