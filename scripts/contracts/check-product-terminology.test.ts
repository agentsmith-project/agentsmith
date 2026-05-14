import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectProductFacingTerminologyFiles,
  scanProductFacingTerminology,
} from "./check-product-terminology";

describe("check-product-terminology contract", () => {
  it("passes against the active product terminology contract and route truth", () => {
    const tsxCli = path.join(process.cwd(), "node_modules", ".bin", "tsx");

    expect(() =>
      execFileSync(tsxCli, ["scripts/contracts/check-product-terminology.ts"], {
        cwd: process.cwd(),
        env: process.env,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("keeps the active product IA on Chat/Model, Agent tasks, and Agent Runners", () => {
    const root = process.cwd();
    const terminology = readFileSync(
      path.join(root, "docs/contracts/product-terminology.md"),
      "utf8",
    );
    const routeGateChecklist = readFileSync(
      path.join(root, "docs/contracts/route-gate-test-checklist.md"),
      "utf8",
    );
    const gatingMatrix = readFileSync(
      path.join(root, "docs/contracts/frontend-backend-gating-matrix.md"),
      "utf8",
    );
    const routeManifest = readFileSync(
      path.join(root, "src/lib/routes/project-route-policy-manifest.ts"),
      "utf8",
    );

    expect(terminology).toMatch(/`Model`[\s\S]*Chat selector/);
    expect(terminology).toMatch(/`Agent tasks`/);
    expect(terminology).toMatch(/`Agent Runners`/);
    expect(terminology).toMatch(
      /Pre-GA target contracts reject and remove old runtime\/API surfaces instead of keeping aliases, bridges, double-read paths, fallback APIs, or compatibility views/,
    );
    expect(terminology).toMatch(
      /Old route paths, payload fields, terminal views, and public API names may appear only in breaking allowlists, negative contract tests, or one-shot cleanup\/assertion evidence/,
    );
    expect(terminology).not.toMatch(
      /Chat target selection[\s\S]*must not be labeled as `model`/,
    );
    expect(terminology).not.toMatch(/Canonical route: `\.\.\.\/notebook`/);
    expect(terminology).not.toMatch(
      /compatibility requires it|Historical or migration\/audit/,
    );

    expect(routeGateChecklist).toContain(
      "Agent tasks: `project:agent_task:use`",
    );
    expect(routeGateChecklist).toContain(
      "Agent Runners: `project:agent_runner:read`",
    );
    expect(routeGateChecklist).not.toContain(
      "Notebook: `project:endpoint:use`",
    );

    expect(gatingMatrix).toContain("| agent tasks |");
    expect(gatingMatrix).toContain("| Agent Runners |");
    expect(gatingMatrix).toContain("`project:agent_task:terminal`");
    expect(gatingMatrix).not.toContain("| notebook list/detail |");
    expect(gatingMatrix).not.toMatch(
      /project:agent:(?:use|manage|public)|project:terminal:use/,
    );

    expect(routeManifest).toContain("/agent-tasks/page.tsx");
    expect(routeManifest).toContain("/agent-runners/page.tsx");
    expect(routeManifest).not.toContain("/notebook/page.tsx");
    expect(routeManifest).not.toContain("/agents/page.tsx");

    expect(
      existsSync(
        path.join(root, "docs/contracts/agent-task-frontend-module-map.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        path.join(root, "docs/contracts/agent-runners-frontend-module-map.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        path.join(root, "docs/contracts/notebook-frontend-module-map.md"),
      ),
    ).toBe(false);
  });

  it("flags retired product terms in product-facing docs while allowing path and implementation contexts", () => {
    const findings = scanProductFacingTerminology([
      {
        path: "README.md",
        content:
          "Use Notebook for work and Credentials for project secret setup.\n",
      },
      {
        path: "DEVELOPMENT.md",
        content: "Manual UAT still says agents create/edit/toggle.\n",
      },
      {
        path: "docs/user-guides/terminology-drift.md",
        content:
          "Notebook was retired but still appears in the product page.\n",
      },
      {
        path: "docs/user-guides/terminology-policy.md",
        content: "Do not use Notebook as a product-facing term.\n",
      },
      {
        path: "marketing/市场推广文案-英文-v1.md",
        content: "Enterprise teams can manage AI agents safely.\n",
      },
      {
        path: "marketing/README.md",
        content:
          "Generated screenshot paths may remain `05-agent-tasks/` and `13-credentials/`.\n",
      },
      {
        path: "docs/user-guides/workspace-isolation-model.md",
        content:
          "| Mongo | `credentials` | collection_prefix + baseCollection | Yes |\n",
      },
      {
        path: "docs/contracts/product-terminology.md",
        content:
          "Use `Agent tasks` for the active product surface instead of Notebook.\nNotebook was retired but still appears in the product page.\n",
      },
    ]);

    expect(
      findings.map((finding) => ({
        path: finding.path,
        term: finding.term,
        line: finding.line,
      })),
    ).toEqual([
      { path: "README.md", term: "Notebook", line: 1 },
      { path: "README.md", term: "Credentials", line: 1 },
      { path: "DEVELOPMENT.md", term: "Agents", line: 1 },
      {
        path: "docs/user-guides/terminology-drift.md",
        term: "Notebook",
        line: 1,
      },
    ]);
  });

  it("keeps UXUI terminology coverage to selected product-facing corrected files", () => {
    const paths = collectProductFacingTerminologyFiles().map(
      (file) => file.path,
    );

    expect(paths).toContain(
      "docs/UXUI/00-设计系统/站点页面配方与壳层规范-v1.md",
    );
    expect(paths).toContain("docs/UXUI/00-设计系统/错误码映射表-v1.md");
    expect(paths).not.toContain(
      "docs/UXUI/01-通用规范/usage-audit-职责边界-v1.md",
    );
  });
});
