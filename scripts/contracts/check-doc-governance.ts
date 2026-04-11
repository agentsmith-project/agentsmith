import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const SCAN_ROOTS = ['README.md', 'AGENTS.md', 'DESIGN.md', 'DEVELOPMENT.md', 'docs'] as const;

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'artifacts', 'marketing']);

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
];

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

function isHistoricalDoc(relativePath: string, content: string): boolean {
  const normalized = relativePath.toLowerCase();
  const basename = path.basename(normalized);
  const titleLine = content.split('\n', 1)[0]?.toLowerCase() ?? '';
  const historicalMarkers = ['handoff', 'refactor', 'migration', 'retro', 'todo', 'phase', 'task'];

  return (
    normalized.startsWith('docs/archive/')
    || /Status:\s*`redirect`/.test(content)
    || historicalMarkers.some((marker) => basename.includes(marker))
    || historicalMarkers.some((marker) => titleLine.includes(marker))
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

  if (/Status:\s*`redirect`/.test(content)) {
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
        'Historical task/refactor/migration/retro/todo docs must not remain in the current documentation tree. Delete them instead of keeping compatibility material.',
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

function main(): void {
  const files = SCAN_ROOTS.flatMap((target) => collectMarkdownFiles(target)).sort();
  const violations: Violation[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    violations.push(...findViolations(file, content));
    violations.push(...checkMarkdownLinks(file, content));
    violations.push(...checkHistoricalDocsPlacement(file, content));
  }

  violations.push(...checkIndexExpectations());

  if (violations.length > 0) {
    console.error('[docs-governance] check failed.');
    for (const v of violations) {
      console.error(`- ${v.file}:${v.line} [${v.rule}] ${v.detail}`);
    }
    process.exit(1);
  }

  console.log(`[docs-governance] check passed. scanned ${files.length} markdown files.`);
}

main();
