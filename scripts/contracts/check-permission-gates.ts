import fs from 'node:fs';
import path from 'node:path';
import { ALL_PLATFORM_PERMISSIONS } from '@/lib/constants/permissions';
import { PROJECT_ROUTE_POLICY_MANIFEST } from '@/lib/routes/project-route-policy-manifest';

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
  hasRoutePolicy: boolean;
  hasUnifiedRouteGuard: boolean;
};

type RemovedTokenUsage = {
  file: string;
  token: string;
};

const REMOVED_PERMISSION_TOKENS = [
  'project:endpoint:invoke',
  'project:agent:create',
  'project:agent:publish',
  'project:agent:use',
  'project:agent:manage',
  'project:agent:public',
  'project:terminal:use',
] as const;

const REMOVED_TOKEN_ALLOWLIST = new Set<string>([
  'src/lib/constants/permissions.ts',
  'src/lib/hooks/use-permissions.ts',
]);

const REMOVED_TOKEN_DOC_ALLOWLIST = new Set<string>([
  'docs/contracts/product-terminology.md',
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
  const routePolicyPermissions = extractRoutePolicyPermissions(source);
  if (routePolicyPermissions.length > 0) {
    return routePolicyPermissions;
  }

  const regex = /useHasPermission\('([^']+)'\)/g;
  const found = new Set<string>();
  let match = regex.exec(source);
  while (match) {
    found.add(match[1]);
    match = regex.exec(source);
  }
  return [...found].sort();
}

function extractRoutePolicyPermissions(source: string): string[] {
  return [];
}

function requiresProjectParamValidation(pageFile: string): boolean {
  return pageFile.includes('/projects/[project]/');
}

function hasParamValidation(pageFile: string, source: string): boolean {
  const relativePagePath = toWorkspaceRelative(pageFile);
  if (PROJECT_ROUTE_POLICY_MANIFEST[relativePagePath as keyof typeof PROJECT_ROUTE_POLICY_MANIFEST]) {
    return true;
  }

  const hasWorkspaceParamValidation = source.includes('validateWorkspaceParam');
  const hasProjectParamValidation = source.includes('validateProjectParam');

  if (!hasWorkspaceParamValidation) return false;
  if (requiresProjectParamValidation(pageFile) && !hasProjectParamValidation) return false;
  return true;
}

function hasUnifiedRouteGuard(source: string): boolean {
  return source.includes('useResolvedProjectRoute(');
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

function requiresRoutePolicy(pageFile: string): boolean {
  return pageFile !== PROJECTS_LIST_PAGE;
}

function collectRemovedTokenUsageInSource(): RemovedTokenUsage[] {
  const srcDir = path.join(ROOT, 'src');
  if (!fs.existsSync(srcDir)) return [];
  const files = collectTsSourceFiles(srcDir);
  const results: RemovedTokenUsage[] = [];

  for (const file of files) {
    const rel = toWorkspaceRelative(file);
    if (REMOVED_TOKEN_ALLOWLIST.has(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const token of REMOVED_PERMISSION_TOKENS) {
      if (source.includes(token)) {
        results.push({ file: rel, token });
      }
    }
  }
  return results;
}

function collectRemovedTokenUsageInContractDocs(): RemovedTokenUsage[] {
  const contractsDir = path.join(ROOT, 'docs/contracts');
  if (!fs.existsSync(contractsDir)) return [];
  const files = fs
    .readdirSync(contractsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(contractsDir, entry.name));
  const results: RemovedTokenUsage[] = [];

  for (const file of files) {
    const rel = toWorkspaceRelative(file);
    if (REMOVED_TOKEN_DOC_ALLOWLIST.has(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const token of REMOVED_PERMISSION_TOKENS) {
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
    const relativePagePath = toWorkspaceRelative(page);
    const testPath = getRouteTestPath(page);
    const routeTestExists = fs.existsSync(testPath);
    const testSource = routeTestExists ? fs.readFileSync(testPath, 'utf8') : '';
    const permissions = (
      PROJECT_ROUTE_POLICY_MANIFEST[relativePagePath as keyof typeof PROJECT_ROUTE_POLICY_MANIFEST]?.permissions
      ?? extractPermissions(source)
    ).slice();
    return {
      page: relativePagePath,
      permissions,
      hasParamValidation: hasParamValidation(page, source),
      hasRouteTest: routeTestExists,
      hasInvalidParamTest: hasInvalidParamTest(testSource),
      hasForbiddenTest: permissions.length === 0 ? true : hasForbiddenTest(testSource),
      hasAuthFallbackGate: hasAuthFallbackGate(page, source),
      hasRoutePolicy: Boolean(
        PROJECT_ROUTE_POLICY_MANIFEST[relativePagePath as keyof typeof PROJECT_ROUTE_POLICY_MANIFEST],
      ),
      hasUnifiedRouteGuard: hasUnifiedRouteGuard(source),
    };
  });

  const unknownPermissions: Array<{ page: string; permission: string }> = [];
  const pagesMissingParamValidation: string[] = [];
  const pagesMissingRouteTest: string[] = [];
  const pagesMissingInvalidParamTest: string[] = [];
  const pagesMissingForbiddenTest: string[] = [];
  const pagesWithAuthFallbackGate: string[] = [];
  const pagesMissingRoutePolicy: string[] = [];
  const pagesMissingUnifiedRouteGuard: string[] = [];
  const removedTokenUsage = collectRemovedTokenUsageInSource();
  const removedTokenUsageInDocs = collectRemovedTokenUsageInContractDocs();

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
    if (requiresRoutePolicy(path.join(ROOT, report.page)) && !report.hasRoutePolicy) {
      pagesMissingRoutePolicy.push(report.page);
    }
    if (requiresRoutePolicy(path.join(ROOT, report.page)) && !report.hasUnifiedRouteGuard) {
      pagesMissingUnifiedRouteGuard.push(report.page);
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
    console.log(`  route_policy: ${report.hasRoutePolicy ? 'yes' : 'no'}`);
    console.log(`  unified_route_guard: ${report.hasUnifiedRouteGuard ? 'yes' : 'no'}`);
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

  if (pagesMissingRoutePolicy.length > 0) {
    hasErrors = true;
    console.error('\nPages missing routePolicy declaration:');
    for (const page of pagesMissingRoutePolicy) {
      console.error(`  - ${page}`);
    }
  }

  if (pagesMissingUnifiedRouteGuard.length > 0) {
    hasErrors = true;
    console.error('\nPages missing unified route guard:');
    for (const page of pagesMissingUnifiedRouteGuard) {
      console.error(`  - ${page}`);
    }
  }

  if (removedTokenUsage.length > 0) {
    hasErrors = true;
    console.error('\nRemoved permission tokens found in source code:');
    for (const row of removedTokenUsage) {
      console.error(`  - ${row.file}: ${row.token}`);
    }
  }

  if (removedTokenUsageInDocs.length > 0) {
    hasErrors = true;
    console.error('\nRemoved permission tokens found in contract docs:');
    for (const row of removedTokenUsageInDocs) {
      console.error(`  - ${row.file}: ${row.token}`);
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log('\nAll contract checks passed.');
}

main();
