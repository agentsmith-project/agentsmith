import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const SCAN_ROOTS = ['README.md', 'CLAUDE.md', 'DEVELOPMENT.md', 'docs'] as const;

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'artifacts', 'marketing']);

type Violation = {
  file: string;
  line: number;
  rule: string;
  detail: string;
};

const BANNED_RULES: Array<{ rule: string; regex: RegExp; detail: string }> = [
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

function findViolations(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of BANNED_RULES) {
      if (rule.regex.test(line)) {
        violations.push({
          file: toRel(filePath),
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
    link.startsWith('http://') ||
    link.startsWith('https://') ||
    link.startsWith('mailto:') ||
    link.startsWith('file:') ||
    link.startsWith('#')
  );
}

function checkMarkdownLinks(filePath: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  const linkRegex = /\[[^\]]+]\(([^)]+)\)/g;

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

function main(): void {
  const files = SCAN_ROOTS.flatMap((target) => collectMarkdownFiles(target)).sort();
  const violations: Violation[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    violations.push(...findViolations(file, content));
    violations.push(...checkMarkdownLinks(file, content));
  }

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
