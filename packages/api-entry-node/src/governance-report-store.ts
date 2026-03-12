import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

type GovernanceReportShape = {
  metadata?: {
    timestamp?: string;
    git?: {
      branch?: string;
      commit_short?: string;
    };
  };
  summary?: {
    status?: 'pass' | 'fail';
    governance_policy?: {
      decision?: 'ready' | 'warning' | 'blocked';
      summary?: {
        blocker_count?: number;
        warning_count?: number;
      };
    };
    execution_review_evidence?: {
      checks?: {
        review_status?: 'ready' | 'blocked';
      };
    };
  };
};

export type GovernanceReportListItem = {
  name: string;
  generated_at: string;
  status: 'pass' | 'fail' | 'unknown';
  branch?: string;
  commit_short?: string;
  governance_decision?: 'ready' | 'warning' | 'blocked';
  policy_blocker_count?: number;
  policy_warning_count?: number;
  execution_review_status?: 'ready' | 'blocked';
  markdown_available: boolean;
};

export type GovernanceReportDetail = {
  name: string;
  report: Record<string, unknown>;
  markdown?: string;
};

function normalizeName(name: string): string {
  return basename(name).replace(/\.json$/i, '').replace(/\.md$/i, '');
}

function getJsonPath(dir: string, name: string): string {
  return join(dir, `${normalizeName(name)}.json`);
}

function getMarkdownPath(dir: string, name: string): string {
  return join(dir, `${normalizeName(name)}.md`);
}

function parseGovernanceReport(filePath: string): GovernanceReportShape | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as GovernanceReportShape;
  } catch {
    return null;
  }
}

function getGeneratedAt(filePath: string, parsed: GovernanceReportShape | null): string {
  return parsed?.metadata?.timestamp
    ?? statSync(filePath).mtime.toISOString();
}

export function listGovernanceReports(dir: string): GovernanceReportListItem[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const filePath = join(dir, name);
      const parsed = parseGovernanceReport(filePath);
      const base = normalizeName(name);
      return {
        name: base,
        generated_at: getGeneratedAt(filePath, parsed),
        status: parsed?.summary?.status ?? 'unknown',
        branch: parsed?.metadata?.git?.branch,
        commit_short: parsed?.metadata?.git?.commit_short,
        governance_decision: parsed?.summary?.governance_policy?.decision,
        policy_blocker_count: parsed?.summary?.governance_policy?.summary?.blocker_count,
        policy_warning_count: parsed?.summary?.governance_policy?.summary?.warning_count,
        execution_review_status: parsed?.summary?.execution_review_evidence?.checks?.review_status,
        markdown_available: existsSync(getMarkdownPath(dir, base)),
      } satisfies GovernanceReportListItem;
    })
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at));
}

export function getGovernanceReportDetail(dir: string, name: string): GovernanceReportDetail | null {
  const normalized = normalizeName(name);
  const jsonPath = getJsonPath(dir, normalized);
  if (!existsSync(jsonPath)) return null;

  const rawJson = readFileSync(jsonPath, 'utf-8');
  const report = JSON.parse(rawJson) as Record<string, unknown>;
  const markdownPath = getMarkdownPath(dir, normalized);

  return {
    name: normalized,
    report,
    markdown: existsSync(markdownPath) ? readFileSync(markdownPath, 'utf-8') : undefined,
  };
}
