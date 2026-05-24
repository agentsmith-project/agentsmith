import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECK_NPM_SCRIPT = 'contracts:check-release-kit-source-boundary';
const CHECK_SCRIPT_COMMAND = 'tsx scripts/contracts/check-release-kit-source-boundary.ts';
const FIXTURE_SCAN_ROOT = 'scripts/contracts/fixtures/release-kit-source-boundary/valid-release-kit';

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'test-results',
]);

const SCANNED_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.sh',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const PACKAGE_DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

type PackageJson = {
  scripts?: unknown;
};

type ReferenceCandidate = {
  value: string;
  source: 'string' | 'path.join';
};

type SimpleStringReference = ReferenceCandidate;

export type ReleaseKitSourceBoundaryFailure = {
  path: string;
  message: string;
  line?: number;
  excerpt?: string;
};

export type ReleaseKitSourceBoundaryCheckResult = {
  ok: boolean;
  failures: ReleaseKitSourceBoundaryFailure[];
};

export type ReleaseKitSourceBoundaryCheckOptions = {
  rootDir?: string;
  scanRoots?: readonly string[];
};

function addFailure(
  failures: ReleaseKitSourceBoundaryFailure[],
  path: string,
  message: string,
  line?: number,
  excerpt?: string,
): void {
  failures.push({
    path,
    message,
    ...(line === undefined ? {} : { line }),
    ...(excerpt === undefined || excerpt.trim().length === 0 ? {} : { excerpt: excerpt.trim() }),
  });
}

function toAbsolutePath(rootDir: string, candidate: string): string {
  return isAbsolute(candidate) ? candidate : join(rootDir, candidate);
}

function toRelativePath(rootDir: string, absolutePath: string): string {
  return relative(rootDir, absolutePath).replaceAll('\\', '/');
}

function readPackageJson(rootDir: string, failures: ReleaseKitSourceBoundaryFailure[]): Record<string, unknown> | null {
  const relativePath = 'package.json';
  const absolutePath = join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    addFailure(failures, relativePath, 'package.json must exist.');
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
    if (!isRecord(parsed)) {
      addFailure(failures, relativePath, 'package.json must be a JSON object.');
      return null;
    }

    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse error';
    addFailure(failures, relativePath, `Invalid package.json: ${message}`);
    return null;
  }
}

function validatePackageScripts(rootDir: string, failures: ReleaseKitSourceBoundaryFailure[]): void {
  const packageJson = readPackageJson(rootDir, failures);
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};

  if (scripts[CHECK_NPM_SCRIPT] !== CHECK_SCRIPT_COMMAND) {
    addFailure(
      failures,
      'package.json',
      `package.json must expose ${CHECK_NPM_SCRIPT} as ${CHECK_SCRIPT_COMMAND}.`,
    );
  }
  if (typeof scripts['contracts:check'] !== 'string'
    || !scripts['contracts:check'].includes(`npm run ${CHECK_NPM_SCRIPT}`)) {
    addFailure(
      failures,
      'package.json',
      `contracts:check must include npm run ${CHECK_NPM_SCRIPT}.`,
    );
  }
}

function defaultScanRoots(rootDir: string): string[] {
  const roots: string[] = [];
  if (existsSync(join(rootDir, FIXTURE_SCAN_ROOT))) {
    roots.push(FIXTURE_SCAN_ROOT);
  }

  return roots;
}

function collectFiles(
  rootDir: string,
  scanRoot: string,
  failures: ReleaseKitSourceBoundaryFailure[],
): string[] {
  const absoluteRoot = resolve(toAbsolutePath(rootDir, scanRoot));
  if (!existsSync(absoluteRoot)) {
    addFailure(failures, scanRoot, 'release kit source boundary scan root must exist.');
    return [];
  }

  const rootStat = statSync(absoluteRoot);
  if (!rootStat.isDirectory()) {
    addFailure(failures, scanRoot, 'release kit source boundary scan root must be a directory.');
    return [];
  }

  const files: string[] = [];
  const stack = [absoluteRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !SCANNED_EXTENSIONS.has(extname(entry.name))) {
        continue;
      }
      files.push(fullPath);
    }
  }

  return files.sort();
}

function scanFile(rootDir: string, absolutePath: string): ReleaseKitSourceBoundaryFailure[] {
  const failures: ReleaseKitSourceBoundaryFailure[] = [];
  const relativePath = toRelativePath(rootDir, absolutePath);
  const isPackageJson = relativePath.endsWith('/package.json') || relativePath === 'package.json';
  const scansPackageSpecifiers = !relativePath.endsWith('.json') || isPackageJson;
  const lines = readFileSync(absolutePath, 'utf8').split('\n');

  if (isPackageJson) {
    failures.push(...scanPackageJsonDependencies(relativePath, lines.join('\n')));
  }

  const simpleStringAliases = new Map<string, SimpleStringReference>();
  lines.forEach((line, index) => {
    const seenMessages = new Set<string>();
    const constAlias = extractSimpleConstStringAlias(line, simpleStringAliases);
    if (constAlias !== null) {
      simpleStringAliases.set(constAlias.name, constAlias.reference);
    }

    const computedSiblingLabel = matchComputedSiblingAgentSmithSourcePath(line);
    if (computedSiblingLabel !== null) {
      addLineFailureOnce(
        failures,
        seenMessages,
        relativePath,
        index + 1,
        line,
        `release kit must read release contracts, deploy template packages, and generated artifacts; it must not import/read AgentSmith product source via ${computedSiblingLabel}.`,
      );
    }

    for (const candidate of extractReferenceCandidates(line, simpleStringAliases)) {
      if (scansPackageSpecifiers) {
        const forbiddenPackage = matchForbiddenAgentSmithPackageSpecifier(candidate.value);
        if (forbiddenPackage) {
          addLineFailureOnce(
            failures,
            seenMessages,
            relativePath,
            index + 1,
            line,
            `release kit must not import or depend on AgentSmith product package ${forbiddenPackage}; only release contract JSON, deploy template package manifests, generated artifacts, or independently released non-AgentSmith contract artifacts are allowed.`,
          );
        }
      }

      const forbiddenNpmAliasTarget = matchForbiddenNpmAliasTargetPackage(candidate.value);
      if (forbiddenNpmAliasTarget) {
        addLineFailureOnce(
          failures,
          seenMessages,
          relativePath,
          index + 1,
          line,
          `release kit must not alias AgentSmith product package ${forbiddenNpmAliasTarget}; only release contract JSON, deploy template package manifests, generated artifacts, or independently released non-AgentSmith contract artifacts are allowed.`,
        );
      }

      for (const label of forbiddenPathReferenceLabels(candidate)) {
        addLineFailureOnce(
          failures,
          seenMessages,
          relativePath,
          index + 1,
          line,
          `release kit must read release contracts, deploy template packages, and generated artifacts; it must not import/read AgentSmith product source via ${label}.`,
        );
      }
    }
  });

  return failures;
}

function addLineFailureOnce(
  failures: ReleaseKitSourceBoundaryFailure[],
  seenMessages: Set<string>,
  path: string,
  line: number,
  excerpt: string,
  message: string,
): void {
  const key = `${line}:${message}`;
  if (seenMessages.has(key)) {
    return;
  }
  seenMessages.add(key);
  addFailure(failures, path, message, line, excerpt);
}

function scanPackageJsonDependencies(
  relativePath: string,
  content: string,
): ReleaseKitSourceBoundaryFailure[] {
  const failures: ReleaseKitSourceBoundaryFailure[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return failures;
  }

  if (!isRecord(parsed)) {
    return failures;
  }

  for (const sectionName of PACKAGE_DEPENDENCY_SECTIONS) {
    const section = parsed[sectionName];
    if (!isRecord(section)) {
      continue;
    }

    for (const [packageName, version] of Object.entries(section)) {
      const forbiddenPackage = matchForbiddenAgentSmithPackageSpecifier(packageName);
      if (forbiddenPackage) {
        addFailure(
          failures,
          relativePath,
          `${sectionName}.${packageName} must not depend on AgentSmith product package ${forbiddenPackage}; release kit may only consume release contract JSON, deploy template package manifests, generated artifacts, or independently released non-AgentSmith contract artifacts.`,
        );
      }

      if (typeof version === 'string') {
        const forbiddenNpmAliasTarget = matchForbiddenNpmAliasTargetPackage(version);
        if (forbiddenNpmAliasTarget) {
          addFailure(
            failures,
            relativePath,
            `${sectionName}.${packageName} must not alias AgentSmith product package ${forbiddenNpmAliasTarget} via npm alias ${version}.`,
          );
        }

        for (const label of forbiddenPathReferenceLabels({ value: version, source: 'string' })) {
          addFailure(
            failures,
            relativePath,
            `${sectionName}.${packageName} must not point at AgentSmith product source via ${label}.`,
          );
        }
      }
    }
  }

  return failures;
}

function extractReferenceCandidates(
  line: string,
  simpleStringAliases: ReadonlyMap<string, SimpleStringReference>,
): ReferenceCandidate[] {
  const stringCandidates = extractQuotedStrings(line).map((value) => ({
    value,
    source: 'string' as const,
  }));
  const joinedCandidates = extractJoinedPathReferences(line, simpleStringAliases);
  const constAlias = extractSimpleConstStringAlias(line, simpleStringAliases);
  const constAliasCandidates = constAlias === null ? [] : [constAlias.reference];

  return [...stringCandidates, ...joinedCandidates, ...constAliasCandidates];
}

function extractQuotedStrings(value: string): string[] {
  const matches: string[] = [];
  const pattern = /(["'`])((?:\\.|(?!\1)[\s\S])*)\1/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    matches.push(match[2] ?? '');
  }

  return matches;
}

function extractJoinedPathReferences(
  line: string,
  simpleStringAliases: ReadonlyMap<string, SimpleStringReference>,
): ReferenceCandidate[] {
  const references: ReferenceCandidate[] = [];
  const pattern = /\b(?:path\.)?(?:join|resolve)\s*\(([^)]*)\)/gu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    const reference = evaluatePathJoinExpression(match[0] ?? '', simpleStringAliases);
    if (reference !== null) {
      references.push(reference);
    }
  }

  return references;
}

function extractSimpleConstStringAlias(
  line: string,
  simpleStringAliases: ReadonlyMap<string, SimpleStringReference>,
): { name: string; reference: SimpleStringReference } | null {
  const match = /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+)/u.exec(line);
  if (!match) {
    return null;
  }

  const name = match[1];
  const expression = match[2];
  if (name === undefined || expression === undefined) {
    return null;
  }

  const reference = evaluateSimpleStringExpression(expression, simpleStringAliases);
  return reference === null ? null : { name, reference };
}

function evaluateSimpleStringExpression(
  expression: string,
  simpleStringAliases: ReadonlyMap<string, SimpleStringReference>,
): SimpleStringReference | null {
  const trimmed = stripOuterParentheses(expression.trim());
  if (trimmed.length === 0) {
    return null;
  }

  const pathJoin = evaluatePathJoinExpression(trimmed, simpleStringAliases);
  if (pathJoin !== null) {
    return pathJoin;
  }

  const literal = parseSimpleStringLiteral(trimmed);
  if (literal !== null) {
    return { value: literal, source: 'string' };
  }

  const alias = simpleStringAliases.get(trimmed);
  if (alias !== undefined) {
    return alias;
  }

  const concatenated = evaluateStringConcatenation(trimmed, simpleStringAliases);
  if (concatenated !== null) {
    return concatenated;
  }

  return null;
}

function evaluatePathJoinExpression(
  expression: string,
  simpleStringAliases: ReadonlyMap<string, SimpleStringReference>,
): SimpleStringReference | null {
  const match = /^(?:path\.)?(?:join|resolve)\s*\(([\s\S]*)\)$/u.exec(expression.trim());
  if (!match) {
    return null;
  }

  const parts = splitTopLevel(match[1] ?? '', ',');
  if (parts.length <= 1) {
    return null;
  }

  const values: string[] = [];
  for (const part of parts) {
    const evaluated = evaluateSimpleStringExpression(part, simpleStringAliases);
    if (evaluated === null) {
      return null;
    }
    values.push(evaluated.value);
  }

  return {
    value: joinPathLikeSegments(values),
    source: 'path.join',
  };
}

function evaluateStringConcatenation(
  expression: string,
  simpleStringAliases: ReadonlyMap<string, SimpleStringReference>,
): SimpleStringReference | null {
  const parts = splitTopLevel(expression, '+');
  if (parts.length <= 1) {
    return null;
  }

  const values: string[] = [];
  let source: SimpleStringReference['source'] = 'string';
  for (const part of parts) {
    const evaluated = evaluateSimpleStringExpression(part, simpleStringAliases);
    if (evaluated === null) {
      return null;
    }
    values.push(evaluated.value);
    if (evaluated.source === 'path.join') {
      source = 'path.join';
    }
  }

  return {
    value: values.join(''),
    source,
  };
}

function parseSimpleStringLiteral(expression: string): string | null {
  const match = /^(["'`])((?:\\.|(?!\1)[\s\S])*)\1$/u.exec(expression);
  if (!match) {
    return null;
  }

  const quote = match[1];
  const value = match[2] ?? '';
  if (quote === '`' && value.includes('${')) {
    return null;
  }

  return value.replace(/\\(["'`\\])/gu, '$1');
}

function splitTopLevel(expression: string, delimiter: ',' | '+'): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | '\'' | '`' | null = null;
  let escaped = false;
  let parenDepth = 0;

  for (const char of expression) {
    if (quote !== null) {
      current += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') {
      parenDepth += 1;
      current += char;
      continue;
    }

    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
      continue;
    }

    if (char === delimiter && parenDepth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  parts.push(current.trim());
  return parts;
}

function stripOuterParentheses(expression: string): string {
  let current = expression;

  while (current.startsWith('(') && current.endsWith(')') && enclosesWholeExpression(current)) {
    current = current.slice(1, -1).trim();
  }

  return current;
}

function enclosesWholeExpression(expression: string): boolean {
  let quote: '"' | '\'' | '`' | null = null;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if (quote !== null) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0 && index < expression.length - 1) {
        return false;
      }
    }
  }

  return depth === 0;
}

function joinPathLikeSegments(parts: string[]): string {
  return parts
    .map((part, index) => {
      if (index === 0) {
        return part.replace(/\/+$/u, '');
      }

      return part.replace(/^\/+|\/+$/gu, '');
    })
    .join('/');
}

function matchForbiddenAgentSmithPackageSpecifier(value: string): string | null {
  const packageName = extractPackageName(value.trim());
  if (packageName === null) {
    return null;
  }
  if (packageName === 'agentsmith') {
    return packageName;
  }
  if (!packageName.startsWith('@mbos/')) {
    return null;
  }

  return packageName;
}

function extractPackageName(value: string): string | null {
  if (/^agentsmith(?:\/|$)/u.test(value)) {
    return 'agentsmith';
  }

  const match = /^(@[^/\s]+\/[^/\s]+)(?:\/|$)/u.exec(value);
  return match?.[1] ?? null;
}

function matchForbiddenNpmAliasTargetPackage(value: string): string | null {
  const targetPackage = extractNpmAliasTargetPackageName(value);
  return targetPackage === null ? null : matchForbiddenAgentSmithPackageSpecifier(targetPackage);
}

function extractNpmAliasTargetPackageName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('npm:')) {
    return null;
  }

  const target = trimmed.slice('npm:'.length);
  if (target.startsWith('@')) {
    const match = /^(@[^/@\s]+\/[^/@\s]+)(?:@|\/|$)/u.exec(target);
    return match?.[1] ?? null;
  }

  const match = /^([^/@\s]+)(?:@|\/|$)/u.exec(target);
  return match?.[1] ?? null;
}

function forbiddenPathReferenceLabels(candidate: ReferenceCandidate): string[] {
  const normalized = candidate.value.trim().replaceAll('\\', '/');
  const labels: string[] = [];

  if (normalized.startsWith('@/')) {
    labels.push('@/');
  }

  if (isAgentSmithProductSourceReference(normalized)) {
    if (candidate.source === 'path.join') {
      labels.push('path.join agentsmith product source path');
    }
    if (normalized.startsWith('file://')) {
      labels.push('file URI agentsmith product source path');
    } else if (normalized.startsWith('/')) {
      labels.push('absolute agentsmith product source path');
    }
    labels.push(...relativeAgentSmithPathLabels(normalized));
  }

  return [...new Set(labels)];
}

function matchComputedSiblingAgentSmithSourcePath(line: string): string | null {
  const normalized = line.replace(/\s+/gu, ' ');
  if (!/\b(?:path\.)?(?:join|resolve)\s*\(/u.test(normalized)) {
    return null;
  }
  if (!/\bpath\.dirname\s*\(\s*RELEASE_KIT_ROOT\s*\)/u.test(normalized)) {
    return null;
  }
  if (!/(["'`])agent\1\s*\+\s*(["'`])smith\2/u.test(normalized)) {
    return null;
  }
  if (!hasQuotedAgentSmithProductSourceSegment(normalized)) {
    return null;
  }

  return 'computed sibling agentsmith product source path';
}

function hasQuotedAgentSmithProductSourceSegment(value: string): boolean {
  return /(["'`])src\1/u.test(value)
    || /(["'`])packages\1/u.test(value)
    || /(["'`])package\.json\1/u.test(value);
}

function isAgentSmithProductSourceReference(value: string): boolean {
  const pathValue = stripFilePathPrefix(value);
  return /(?:^|\/)agentsmith\/(?:src(?:\/|$)|package\.json$|packages(?:\/|$))/u.test(pathValue)
    || isAgentSmithRepositoryRootReference(pathValue);
}

function isAgentSmithRepositoryRootReference(value: string): boolean {
  return /(?:^|\/)(?:\.\.\/)+agentsmith\/?$/u.test(value)
    || /^(?:[A-Za-z]:)?\/.*\/agentsmith\/?$/u.test(value);
}

function stripFilePathPrefix(value: string): string {
  if (value.startsWith('file://')) {
    return value.slice('file://'.length);
  }
  if (value.startsWith('file:')) {
    return value.slice('file:'.length);
  }

  return value;
}

function relativeAgentSmithPathLabels(value: string): string[] {
  const labels: string[] = [];
  const isFileRelativePath = value.startsWith('file:') && !value.startsWith('file://');
  const pathValue = stripFilePathPrefix(value);
  const relativeMatch = /(?:^|\/)((?:\.\.\/)+)agentsmith(?:\/([^"'`\s)]*))?\/?$/u.exec(pathValue);
  if (!relativeMatch) {
    return labels;
  }

  const prefix = relativeMatch[1] ?? '';
  const suffix = (relativeMatch[2] ?? '').replace(/\/$/u, '');
  const repoRootLabel = (prefix.match(/\.\.\//gu) ?? []).length >= 2
    ? '../../agentsmith'
    : '../agentsmith';

  if (suffix.length === 0) {
    labels.push(isFileRelativePath ? `file:${repoRootLabel}` : repoRootLabel);
    return labels;
  }

  if (repoRootLabel === '../../agentsmith') {
    labels.push('../../agentsmith');
  }
  if (suffix === 'src' || suffix.startsWith('src/')) {
    labels.push('../agentsmith/src');
  }
  if (suffix === 'package.json') {
    labels.push('../agentsmith/package.json');
  }
  if (suffix === 'packages' || suffix.startsWith('packages/')) {
    const packageSegment = suffix.split('/')[1];
    labels.push(packageSegment ? `../agentsmith/packages/${packageSegment}` : '../agentsmith/packages');
  }

  return labels;
}

export function checkReleaseKitSourceBoundary(
  options: ReleaseKitSourceBoundaryCheckOptions = {},
): ReleaseKitSourceBoundaryCheckResult {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const failures: ReleaseKitSourceBoundaryFailure[] = [];

  validatePackageScripts(rootDir, failures);

  const scanRoots = options.scanRoots ?? defaultScanRoots(rootDir);
  if (scanRoots.length === 0) {
    addFailure(
      failures,
      FIXTURE_SCAN_ROOT,
      'release kit source boundary must scan a fixture or release kit repo path.',
    );
  }

  const files = scanRoots.flatMap((scanRoot) => collectFiles(rootDir, scanRoot, failures));
  for (const file of files) {
    failures.push(...scanFile(rootDir, file));
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatFailure(failure: ReleaseKitSourceBoundaryFailure): string {
  const location = failure.line === undefined ? failure.path : `${failure.path}:${failure.line}`;
  const excerpt = failure.excerpt === undefined ? '' : `\n  > ${failure.excerpt}`;
  return `- ${location}: ${failure.message}${excerpt}`;
}

function parseCliArgs(args: readonly string[]): { options: ReleaseKitSourceBoundaryCheckOptions; errors: string[] } {
  const scanRoots: string[] = [];
  const errors: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--scan-root') {
      const value = args[index + 1];
      if (value === undefined || value.trim().length === 0 || value.startsWith('--')) {
        errors.push('--scan-root requires a path.');
      } else {
        scanRoots.push(value);
        index += 1;
      }
      continue;
    }

    if (arg?.startsWith('--scan-root=')) {
      const value = arg.slice('--scan-root='.length);
      if (value.trim().length === 0) {
        errors.push('--scan-root requires a path.');
      } else {
        scanRoots.push(value);
      }
      continue;
    }

    errors.push(`Unknown argument: ${arg}`);
  }

  return {
    options: scanRoots.length === 0 ? {} : { scanRoots },
    errors,
  };
}

function main(): void {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.errors.length > 0) {
    console.error('[contracts] release kit source boundary check failed:');
    for (const error of cli.errors) {
      console.error(`- ${error}`);
    }
    console.error('Usage: npm run contracts:check-release-kit-source-boundary -- [--scan-root <path>]');
    process.exit(1);
  }

  const result = checkReleaseKitSourceBoundary(cli.options);

  if (!result.ok) {
    console.error('[contracts] release kit source boundary check failed:');
    for (const failure of result.failures) {
      console.error(formatFailure(failure));
    }
    process.exit(1);
  }

  console.log('[contracts] release kit source boundary check passed');
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedModulePath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);

if (currentModulePath === invokedModulePath) {
  main();
}
