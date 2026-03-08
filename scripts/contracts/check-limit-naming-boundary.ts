import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const SCAN_ROOTS = ['src', 'packages'] as const;
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'artifacts',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
]);

const FORBIDDEN_RULES: Array<{ key: string; regex: RegExp; detail: string }> = [
  {
    key: 'quota',
    regex: /\bquota\b/i,
    detail: 'Use `rate limit` / `spending limit`, do not introduce `quota` naming.',
  },
  {
    key: 'limit_total',
    regex: /\blimit_total\b/,
    detail: 'Use canonical limit fields: `used` / `remaining` / `max` / `reset_at`.',
  },
  {
    key: 'total_limit',
    regex: /\btotal_limit\b/,
    detail: 'Use explicit aggregate fields (for example `project_max`, `project_used`).',
  },
  {
    key: 'limit_limit',
    regex: /\blimit_limit\b/,
    detail: 'Use canonical limit fields: `used` / `remaining` / `max` / `reset_at`.',
  },
  {
    key: 'total_limit_limit',
    regex: /\btotal_limit_limit\b/,
    detail: 'Use explicit aggregate fields (for example `project_max`).',
  },
];

type Violation = {
  file: string;
  line: number;
  key: string;
  excerpt: string;
  detail: string;
};

function toRel(filePath: string): string {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

function shouldSkipFile(filePath: string): boolean {
  const rel = toRel(filePath);
  if (rel.includes('/__tests__/')) return true;
  if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) return true;
  if (rel.endsWith('.spec.ts') || rel.endsWith('.spec.tsx')) return true;
  if (rel.endsWith('.d.ts')) return true;
  return false;
}

function collectFiles(rootDir: string): string[] {
  const absolute = path.join(ROOT, rootDir);
  if (!fs.existsSync(absolute)) return [];
  const out: string[] = [];
  const stack = [absolute];

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
      if (!entry.isFile()) continue;
      if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (shouldSkipFile(full)) continue;
      out.push(full);
    }
  }

  return out.sort();
}

function scanFile(filePath: string): Violation[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of FORBIDDEN_RULES) {
      if (!rule.regex.test(line)) continue;
      violations.push({
        file: toRel(filePath),
        line: i + 1,
        key: rule.key,
        excerpt: line.trim(),
        detail: rule.detail,
      });
    }
  }

  return violations;
}

function main(): void {
  const files = SCAN_ROOTS.flatMap((rootDir) => collectFiles(rootDir));
  const violations = files.flatMap((filePath) => scanFile(filePath));

  if (violations.length > 0) {
    console.error('[limit-naming] check failed.');
    for (const item of violations) {
      console.error(`- ${item.file}:${item.line} [${item.key}] ${item.detail}`);
      console.error(`  > ${item.excerpt}`);
    }
    process.exit(1);
  }

  console.log(`[limit-naming] check passed. scanned ${files.length} files.`);
}

main();
