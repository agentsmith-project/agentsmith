import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

function requireMatch(
  content: string,
  pattern: RegExp,
  message: string,
  failures: string[],
): void {
  if (!pattern.test(content)) {
    failures.push(message);
  }
}

function forbidMatch(
  content: string,
  pattern: RegExp,
  message: string,
  failures: string[],
): void {
  if (pattern.test(content)) {
    failures.push(message);
  }
}

const terminologyDoc = read("docs/contracts/product-terminology.md");
const authPermissionModel = read("docs/contracts/auth-permission-model.md");
const tokenContract = read(
  "docs/contracts/frontend-token-interaction-contract.md",
);
const contractsIndex = read("docs/contracts/README.md");
const routeManifest = read("src/lib/routes/project-route-policy-manifest.ts");

const failures: string[] = [];

function readPolicyBlock(content: string, hrefSlug: string): string | null {
  const escaped = hrefSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`${escaped}[\\s\\S]*?\\}\\),`, "m"));
  return match?.[0] ?? null;
}

for (const requiredTerm of [
  "Model",
  "Agent tasks",
  "Agent Runners",
  "Agent Runner",
  "Managed runner",
  "Developer mode",
  "Project secrets",
  "Workspace integrations",
  "Personal connections",
  "Shared context",
  "Access guide",
]) {
  requireMatch(
    terminologyDoc,
    new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `product-terminology.md must define ${requiredTerm}`,
    failures,
  );
}

requireMatch(
  terminologyDoc,
  /Sources[\s\S]*Files/,
  "product-terminology.md must explain that Files replaces Sources as the product-facing file surface",
  failures,
);
requireMatch(
  terminologyDoc,
  /Pre-GA target contracts reject and remove old runtime\/API surfaces instead of keeping aliases, bridges, double-read paths, fallback APIs, or compatibility views/,
  "product-terminology.md must state that pre-GA contracts reject/remove old runtime/API surfaces instead of keeping compatibility layers",
  failures,
);
requireMatch(
  terminologyDoc,
  /Old route paths, payload fields, terminal views, and public API names may appear only in breaking allowlists, negative contract tests, or one-shot cleanup\/assertion evidence/,
  "product-terminology.md must restrict old public names to breaking allowlists, negative contract tests, or one-shot cleanup/assertion evidence",
  failures,
);
requireMatch(
  terminologyDoc,
  /Shared context[\s\S]*must not regress into a hidden route/,
  "product-terminology.md must define the hidden-object rule for Shared context",
  failures,
);
requireMatch(
  terminologyDoc,
  /Product-facing Chat UI must use `Model`/,
  "product-terminology.md must require Model as the Chat selector label",
  failures,
);
requireMatch(
  terminologyDoc,
  /Use `Agent tasks` for the active product surface/,
  "product-terminology.md must replace Notebook with Agent tasks",
  failures,
);
requireMatch(
  terminologyDoc,
  /Use `Agent Runners` for the active developer\/governance surface/,
  "product-terminology.md must replace Agents with Agent Runners",
  failures,
);
requireMatch(
  contractsIndex,
  /product-terminology\.md/,
  "docs/contracts/README.md must keep product-terminology.md in the core contracts list",
  failures,
);
requireMatch(
  contractsIndex,
  /agent-task-frontend-module-map\.md/,
  "docs/contracts/README.md must list the Agent task module map",
  failures,
);
requireMatch(
  contractsIndex,
  /agent-runners-frontend-module-map\.md/,
  "docs/contracts/README.md must list the Agent Runners module map",
  failures,
);
forbidMatch(
  contractsIndex,
  /notebook-frontend-module-map\.md/,
  "docs/contracts/README.md must not list the retired Notebook module map",
  failures,
);
forbidMatch(
  terminologyDoc,
  /Chat target selection[\s\S]*must not be labeled as `model`/,
  "product-terminology.md must not forbid Model as the Chat selector",
  failures,
);
forbidMatch(
  terminologyDoc,
  /Canonical route: `\.\.\.\/notebook`/,
  "product-terminology.md must not keep notebook as a canonical route",
  failures,
);
forbidMatch(
  terminologyDoc,
  /compatibility requires it|Historical or migration\/audit/,
  "product-terminology.md must not keep legacy compatibility allowances",
  failures,
);

forbidMatch(
  authPermissionModel,
  /Configuration and policy \| Endpoints, Resource Policy, Credentials, Members, Usage, Audit, Settings/,
  "auth-permission-model.md must not keep the old govern object list with Credentials/Usage",
  failures,
);
requireMatch(
  authPermissionModel,
  /Configuration and policy \| Endpoints, Policy, Shared context, Project secrets, Members, Audit, Settings/,
  "auth-permission-model.md must use the current governance object list",
  failures,
);
requireMatch(
  authPermissionModel,
  /End-user daily AI tools \| Chat, Agent tasks, Files, Usage, Access guide/,
  "auth-permission-model.md must use Agent tasks in the use IA",
  failures,
);
requireMatch(
  authPermissionModel,
  /Developer task execution capability \| Agent Runners/,
  "auth-permission-model.md must use Agent Runners in the develop IA",
  failures,
);
forbidMatch(
  authPermissionModel,
  /project:agent:(?:use|manage|public)|project:terminal:use/,
  "auth-permission-model.md must not keep retired agent/terminal permission tokens",
  failures,
);

forbidMatch(
  tokenContract,
  /- Credentials: `project:governance:update`/,
  "frontend-token-interaction-contract.md must not refer to the project governance page as Credentials",
  failures,
);
requireMatch(
  tokenContract,
  /- Shared context: `project:governance:update`/,
  "frontend-token-interaction-contract.md must include Shared context in the route-level permission contract",
  failures,
);
requireMatch(
  tokenContract,
  /- Project secrets: `project:governance:update`/,
  "frontend-token-interaction-contract.md must include Project secrets in the route-level permission contract",
  failures,
);
requireMatch(
  tokenContract,
  /- Access guide: `project:endpoint:use`/,
  "frontend-token-interaction-contract.md must include Access guide in the route-level permission contract",
  failures,
);
requireMatch(
  tokenContract,
  /Project secret create\/rotate\/delete/,
  "frontend-token-interaction-contract.md must use Project secret wording in action-level permission gates",
  failures,
);
requireMatch(
  tokenContract,
  /- Agent tasks list\/detail: `project:agent_task:use`/,
  "frontend-token-interaction-contract.md must include Agent tasks route gates",
  failures,
);
requireMatch(
  tokenContract,
  /- Agent task terminal session use: `project:agent_task:use` \+ `project:agent_task:terminal`/,
  "frontend-token-interaction-contract.md must include Agent task terminal gates",
  failures,
);
requireMatch(
  tokenContract,
  /- Agent Runners: `project:agent_runner:read` or `project:agent_runner:manage`/,
  "frontend-token-interaction-contract.md must include Agent Runners route gates",
  failures,
);
forbidMatch(
  tokenContract,
  /Notebook|Agents:|project:agent:(?:use|manage|public)|project:terminal:use/,
  "frontend-token-interaction-contract.md must not keep retired Notebook/Agents permission gates",
  failures,
);

const sharedContextBlock = readPolicyBlock(
  routeManifest,
  "context/page.tsx': createProjectRoutePolicy({",
);
const accessGuideBlock = readPolicyBlock(
  routeManifest,
  "use-guide/page.tsx': createProjectRoutePolicy({",
);
const agentTasksBlock = readPolicyBlock(
  routeManifest,
  "agent-tasks/page.tsx': createProjectRoutePolicy({",
);
const agentRunnersBlock = readPolicyBlock(
  routeManifest,
  "agent-runners/page.tsx': createProjectRoutePolicy({",
);

if (!sharedContextBlock) {
  failures.push(
    "project-route-policy-manifest.ts is missing the Shared context route policy block",
  );
} else {
  requireMatch(
    sharedContextBlock,
    /href: 'context'/,
    "project-route-policy-manifest.ts must keep Shared context on href context",
    failures,
  );
  requireMatch(
    sharedContextBlock,
    /navSection: 'govern'/,
    "project-route-policy-manifest.ts must keep Shared context on the govern path",
    failures,
  );
  requireMatch(
    sharedContextBlock,
    /navOrder: 30/,
    "project-route-policy-manifest.ts must keep Shared context nav order stable at 30",
    failures,
  );
  forbidMatch(
    sharedContextBlock,
    /sidebar: false/,
    "project-route-policy-manifest.ts must not hide the Shared context route from sidebar governance navigation",
    failures,
  );
  forbidMatch(
    sharedContextBlock,
    /governanceObject: false/,
    "project-route-policy-manifest.ts must not hide the Shared context route from governance-object listings",
    failures,
  );
}

if (!accessGuideBlock) {
  failures.push(
    "project-route-policy-manifest.ts is missing the Access guide route policy block",
  );
} else {
  requireMatch(
    accessGuideBlock,
    /href: 'use-guide'/,
    "project-route-policy-manifest.ts must keep Access guide on href use-guide",
    failures,
  );
  requireMatch(
    accessGuideBlock,
    /navSection: 'use'/,
    "project-route-policy-manifest.ts must keep Access guide as a visible use-surface route",
    failures,
  );
  forbidMatch(
    accessGuideBlock,
    /sidebar: false/,
    "project-route-policy-manifest.ts must not hide the Access guide route from the use navigation",
    failures,
  );
}

if (!agentTasksBlock) {
  failures.push(
    "project-route-policy-manifest.ts is missing the Agent tasks route policy block",
  );
} else {
  requireMatch(
    agentTasksBlock,
    /href: 'agent-tasks'/,
    "project-route-policy-manifest.ts must keep Agent tasks on href agent-tasks",
    failures,
  );
  requireMatch(
    agentTasksBlock,
    /permissions: \['project:agent_task:use'\]/,
    "project-route-policy-manifest.ts must gate Agent tasks with project:agent_task:use",
    failures,
  );
  requireMatch(
    agentTasksBlock,
    /navSection: 'use'/,
    "project-route-policy-manifest.ts must keep Agent tasks in use navigation",
    failures,
  );
}

if (!agentRunnersBlock) {
  failures.push(
    "project-route-policy-manifest.ts is missing the Agent Runners route policy block",
  );
} else {
  requireMatch(
    agentRunnersBlock,
    /href: 'agent-runners'/,
    "project-route-policy-manifest.ts must keep Agent Runners on href agent-runners",
    failures,
  );
  requireMatch(
    agentRunnersBlock,
    /project:agent_runner:read/,
    "project-route-policy-manifest.ts must allow Agent Runner read access",
    failures,
  );
  requireMatch(
    agentRunnersBlock,
    /project:agent_runner:manage/,
    "project-route-policy-manifest.ts must allow Agent Runner manage access",
    failures,
  );
  requireMatch(
    agentRunnersBlock,
    /navSection: 'develop'/,
    "project-route-policy-manifest.ts must keep Agent Runners in develop navigation",
    failures,
  );
}

forbidMatch(
  routeManifest,
  /\/notebook\/page\.tsx|\/agents\/page\.tsx|navLabelKey: 'notebook'|navLabelKey: 'agents'/,
  "project-route-policy-manifest.ts must not keep Notebook/Agents route policies",
  failures,
);

if (failures.length > 0) {
  console.error("[contracts] product terminology check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[contracts] product terminology check passed");
