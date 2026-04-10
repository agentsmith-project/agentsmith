import { readFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function requireMatch(content: string, pattern: RegExp, message: string, failures: string[]): void {
  if (!pattern.test(content)) {
    failures.push(message);
  }
}

function forbidMatch(content: string, pattern: RegExp, message: string, failures: string[]): void {
  if (pattern.test(content)) {
    failures.push(message);
  }
}

const terminologyDoc = read('docs/contracts/product-terminology.md');
const authPermissionModel = read('docs/contracts/auth-permission-model.md');
const tokenContract = read('docs/contracts/frontend-token-interaction-contract.md');
const contractsIndex = read('docs/contracts/README.md');
const routeManifest = read('src/lib/routes/project-route-policy-manifest.ts');

const failures: string[] = [];

function readPolicyBlock(content: string, hrefSlug: string): string | null {
  const escaped = hrefSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`${escaped}[\\s\\S]*?\\}\\),`, 'm'));
  return match?.[0] ?? null;
}

for (const requiredTerm of [
  'Execution target',
  'Project secrets',
  'Workspace integrations',
  'Personal connections',
  'Shared context',
  'Access guide',
]) {
  requireMatch(
    terminologyDoc,
    new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `product-terminology.md must define ${requiredTerm}`,
    failures,
  );
}

requireMatch(terminologyDoc, /Sources[\s\S]*Files/, 'product-terminology.md must explain that Files replaces Sources as the product-facing file surface', failures);
requireMatch(terminologyDoc, /Machine-readable specs may retain implementation-oriented names/, 'product-terminology.md must explain that OpenAPI/backend names do not redefine product-facing terminology', failures);
requireMatch(terminologyDoc, /Shared context[\s\S]*must not regress into a hidden route/, 'product-terminology.md must define the hidden-object rule for Shared context', failures);
requireMatch(contractsIndex, /product-terminology\.md/, 'docs/contracts/README.md must keep product-terminology.md in the core contracts list', failures);

forbidMatch(authPermissionModel, /Configuration and policy \| Endpoints, Resource Policy, Credentials, Members, Usage, Audit, Settings/, 'auth-permission-model.md must not keep the old govern object list with Credentials/Usage', failures);
requireMatch(authPermissionModel, /Configuration and policy \| Endpoints, Policy, Shared context, Project secrets, Members, Audit, Settings/, 'auth-permission-model.md must use the current governance object list', failures);

forbidMatch(tokenContract, /- Credentials: `project:governance:update`/, 'frontend-token-interaction-contract.md must not refer to the project governance page as Credentials', failures);
requireMatch(tokenContract, /- Shared context: `project:governance:update`/, 'frontend-token-interaction-contract.md must include Shared context in the route-level permission contract', failures);
requireMatch(tokenContract, /- Project secrets: `project:governance:update`/, 'frontend-token-interaction-contract.md must include Project secrets in the route-level permission contract', failures);
requireMatch(tokenContract, /- Access guide: `project:endpoint:use`/, 'frontend-token-interaction-contract.md must include Access guide in the route-level permission contract', failures);
requireMatch(tokenContract, /Project secret create\/rotate\/delete/, 'frontend-token-interaction-contract.md must use Project secret wording in action-level permission gates', failures);

const sharedContextBlock = readPolicyBlock(routeManifest, "context/page.tsx': createProjectRoutePolicy({");
const accessGuideBlock = readPolicyBlock(routeManifest, "use-guide/page.tsx': createProjectRoutePolicy({");

if (!sharedContextBlock) {
  failures.push('project-route-policy-manifest.ts is missing the Shared context route policy block');
} else {
  requireMatch(sharedContextBlock, /href: 'context'/, 'project-route-policy-manifest.ts must keep Shared context on href context', failures);
  requireMatch(sharedContextBlock, /navSection: 'govern'/, 'project-route-policy-manifest.ts must keep Shared context on the govern path', failures);
  requireMatch(sharedContextBlock, /navOrder: 30/, 'project-route-policy-manifest.ts must keep Shared context nav order stable at 30', failures);
  forbidMatch(sharedContextBlock, /sidebar: false/, 'project-route-policy-manifest.ts must not hide the Shared context route from sidebar governance navigation', failures);
  forbidMatch(sharedContextBlock, /governanceObject: false/, 'project-route-policy-manifest.ts must not hide the Shared context route from governance-object listings', failures);
}

if (!accessGuideBlock) {
  failures.push('project-route-policy-manifest.ts is missing the Access guide route policy block');
} else {
  requireMatch(accessGuideBlock, /href: 'use-guide'/, 'project-route-policy-manifest.ts must keep Access guide on href use-guide', failures);
  requireMatch(accessGuideBlock, /navSection: 'use'/, 'project-route-policy-manifest.ts must keep Access guide as a visible use-surface route', failures);
  forbidMatch(accessGuideBlock, /sidebar: false/, 'project-route-policy-manifest.ts must not hide the Access guide route from the use navigation', failures);
}

if (failures.length > 0) {
  console.error('[contracts] product terminology check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] product terminology check passed');
