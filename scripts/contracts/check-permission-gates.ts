import fs from 'node:fs';
import path from 'node:path';
import { ALL_PLATFORM_PERMISSIONS } from '@/lib/constants/permissions';

const ROOT = process.cwd();
const SHELL_DIR = path.join(
  ROOT,
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)'
);
const PROJECTS_LIST_PAGE = path.join(
  ROOT,
  'src/app/[locale]/workspaces/[workspace]/projects/page.tsx'
);

type PageReport = {
  page: string;
  permissions: string[];
  hasParamValidation: boolean;
  hasRouteTest: boolean;
  hasInvalidParamTest: boolean;
  hasForbiddenTest: boolean;
  hasAuthFallbackGate: boolean;
};

type DeprecatedTokenUsage = {
  file: string;
  token: string;
};

const DEPRECATED_PERMISSION_TOKENS = [
  'project:endpoint:invoke',
  'project:agent:create',
  'project:agent:publish',
] as const;

const DEPRECATED_TOKEN_ALLOWLIST = new Set<string>([
  'src/lib/constants/permissions.ts',
  'src/lib/hooks/use-permissions.ts',
]);

function collectPageFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPageFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name === 'page.tsx') {
      files.push(fullPath);
    }
  }
  return files;
}

function collectTsSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsSourceFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!fullPath.endsWith('.ts') && !fullPath.endsWith('.tsx')) continue;
    if (fullPath.includes(`${path.sep}__tests__${path.sep}`)) continue;
    files.push(fullPath);
  }
  return files;
}

function toWorkspaceRelative(filePath: string): string {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

function extractPermissions(source: string): string[] {
  const regex = /useHasPermission\('([^']+)'\)/g;
  const found = new Set<string>();
  let match = regex.exec(source);
  while (match) {
    found.add(match[1]);
    match = regex.exec(source);
  }
  return [...found].sort();
}

function requiresProjectParamValidation(pageFile: string): boolean {
  return pageFile.includes('/projects/[project]/');
}

function hasParamValidation(pageFile: string, source: string): boolean {
  const hasWorkspaceParamValidation = source.includes('validateWorkspaceParam');
  const hasProjectParamValidation = source.includes('validateProjectParam');

  if (!hasWorkspaceParamValidation) return false;
  if (requiresProjectParamValidation(pageFile) && !hasProjectParamValidation) return false;
  return true;
}

function getRouteTestPath(pageFile: string): string {
  const dir = path.dirname(pageFile);
  return path.join(dir, '__tests__', 'page.test.tsx');
}

function hasInvalidParamTest(testSource: string): boolean {
  const normalized = testSource.toLowerCase();
  return (
    normalized.includes('invalid parameter') ||
    normalized.includes('unsafe route params') ||
    normalized.includes('unsafe params') ||
    normalized.includes('validation_error')
  );
}

function hasForbiddenTest(testSource: string): boolean {
  const normalized = testSource.toLowerCase();
  return (
    normalized.includes('permission denied') ||
    normalized.includes('permission_denied_title') ||
    normalized.includes('forbidden')
  );
}

function collectKnownPermissions(): Set<string> {
  return new Set<string>([...ALL_PLATFORM_PERMISSIONS]);
}

function hasAuthFallbackGate(pageFile: string, source: string): boolean {
  if (pageFile !== PROJECTS_LIST_PAGE) return false;
  const readFallback = /const\s+canReadProjects\s*=\s*[^;]*(?:isAuthenticated|currentWorkspace)/.test(
    source
  );
  const createFallback =
    /const\s+canCreateProject\s*=\s*[^;]*(?:isAuthenticated|currentWorkspace)/.test(source);
  return readFallback || createFallback;
}

function collectDeprecatedTokenUsageInSource(): DeprecatedTokenUsage[] {
  const srcDir = path.join(ROOT, 'src');
  if (!fs.existsSync(srcDir)) return [];
  const files = collectTsSourceFiles(srcDir);
  const results: DeprecatedTokenUsage[] = [];

  for (const file of files) {
    const rel = toWorkspaceRelative(file);
    if (DEPRECATED_TOKEN_ALLOWLIST.has(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const token of DEPRECATED_PERMISSION_TOKENS) {
      if (source.includes(token)) {
        results.push({ file: rel, token });
      }
    }
  }
  return results;
}

function main(): void {
  const known = collectKnownPermissions();
  const pageFiles = [
    ...collectPageFiles(SHELL_DIR),
    ...(fs.existsSync(PROJECTS_LIST_PAGE) ? [PROJECTS_LIST_PAGE] : []),
  ].sort();

  const reports: PageReport[] = pageFiles.map((page) => {
    const source = fs.readFileSync(page, 'utf8');
    const testPath = getRouteTestPath(page);
    const routeTestExists = fs.existsSync(testPath);
    const testSource = routeTestExists ? fs.readFileSync(testPath, 'utf8') : '';
    const permissions = extractPermissions(source);
    return {
      page: toWorkspaceRelative(page),
      permissions,
      hasParamValidation: hasParamValidation(page, source),
      hasRouteTest: routeTestExists,
      hasInvalidParamTest: hasInvalidParamTest(testSource),
      hasForbiddenTest: permissions.length === 0 ? true : hasForbiddenTest(testSource),
      hasAuthFallbackGate: hasAuthFallbackGate(page, source),
    };
  });

  const unknownPermissions: Array<{ page: string; permission: string }> = [];
  const pagesMissingParamValidation: string[] = [];
  const pagesMissingRouteTest: string[] = [];
  const pagesMissingInvalidParamTest: string[] = [];
  const pagesMissingForbiddenTest: string[] = [];
  const pagesWithAuthFallbackGate: string[] = [];
  const deprecatedTokenUsage = collectDeprecatedTokenUsageInSource();

  for (const report of reports) {
    for (const permission of report.permissions) {
      if (!known.has(permission)) {
        unknownPermissions.push({ page: report.page, permission });
      }
    }
    if (!report.hasParamValidation) {
      pagesMissingParamValidation.push(report.page);
    }
    if (!report.hasRouteTest) {
      pagesMissingRouteTest.push(report.page);
    }
    if (!report.hasInvalidParamTest) {
      pagesMissingInvalidParamTest.push(report.page);
    }
    if (!report.hasForbiddenTest) {
      pagesMissingForbiddenTest.push(report.page);
    }
    if (report.hasAuthFallbackGate) {
      pagesWithAuthFallbackGate.push(report.page);
    }
  }

  console.log('Permission Gate Check Report');
  console.log('='.repeat(80));
  for (const report of reports) {
    const perms = report.permissions.length > 0 ? report.permissions.join(', ') : '-';
    console.log(`\n${report.page}`);
    console.log(`  permissions: ${perms}`);
    console.log(`  param_validation: ${report.hasParamValidation ? 'yes' : 'no'}`);
    console.log(`  route_test: ${report.hasRouteTest ? 'yes' : 'no'}`);
    console.log(`  invalid_param_test: ${report.hasInvalidParamTest ? 'yes' : 'no'}`);
    console.log(`  forbidden_test: ${report.hasForbiddenTest ? 'yes' : 'no'}`);
    console.log(`  auth_fallback_gate: ${report.hasAuthFallbackGate ? 'yes' : 'no'}`);
  }

  let hasErrors = false;

  if (unknownPermissions.length > 0) {
    hasErrors = true;
    console.error('\nUnknown permissions found:');
    for (const row of unknownPermissions) {
      console.error(`  - ${row.page}: ${row.permission}`);
    }
  }

  if (pagesMissingParamValidation.length > 0) {
    hasErrors = true;
    console.error('\nPages missing route param validation:');
    for (const page of pagesMissingParamValidation) {
      console.error(`  - ${page}`);
    }
  }

  if (pagesMissingRouteTest.length > 0) {
    hasErrors = true;
    console.error('\nPages missing route tests (__tests__/page.test.tsx):');
    for (const page of pagesMissingRouteTest) {
      console.error(`  - ${page}`);
    }
  }

  if (pagesMissingInvalidParamTest.length > 0) {
    hasErrors = true;
    console.error('\nRoute tests missing invalid-param coverage:');
    for (const page of pagesMissingInvalidParamTest) {
      console.error(`  - ${page}`);
    }
  }

  if (pagesMissingForbiddenTest.length > 0) {
    hasErrors = true;
    console.error('\nRoute tests missing forbidden coverage (permission-denied case):');
    for (const page of pagesMissingForbiddenTest) {
      console.error(`  - ${page}`);
    }
  }

  if (pagesWithAuthFallbackGate.length > 0) {
    hasErrors = true;
    console.error('\nPages with non-strict auth fallback gate logic:');
    for (const page of pagesWithAuthFallbackGate) {
      console.error(`  - ${page}`);
    }
  }

  if (deprecatedTokenUsage.length > 0) {
    hasErrors = true;
    console.error('\nDeprecated permission tokens found in source code:');
    for (const row of deprecatedTokenUsage) {
      console.error(`  - ${row.file}: ${row.token}`);
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log('\nAll contract checks passed.');
}

main();
