import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

type ReleaseReportShape = {
  metadata?: {
    timestamp?: string;
    git?: {
      branch?: string;
      commit_short?: string;
    };
  };
  summary?: {
    status?: 'pass' | 'fail';
    runtime_release_evidence?: {
      guardrails?: {
        release_readiness?: 'ready' | 'blocked';
      };
    };
    usage_report_evidence?: {
      release_readiness?: 'ready' | 'blocked';
    };
  };
};

export type ReleaseReportListItem = {
  name: string;
  generated_at: string;
  status: 'pass' | 'fail' | 'unknown';
  branch?: string;
  commit_short?: string;
  runtime_release_readiness?: 'ready' | 'blocked';
  usage_release_readiness?: 'ready' | 'blocked';
  markdown_available: boolean;
};

export type ReleaseReportDetail = {
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

function parseReleaseReport(filePath: string): ReleaseReportShape | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ReleaseReportShape;
  } catch {
    return null;
  }
}

function getGeneratedAt(filePath: string, parsed: ReleaseReportShape | null): string {
  return parsed?.metadata?.timestamp
    ?? statSync(filePath).mtime.toISOString();
}

export function listReleaseReports(dir: string): ReleaseReportListItem[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const filePath = join(dir, name);
      const parsed = parseReleaseReport(filePath);
      const base = normalizeName(name);
      return {
        name: base,
        generated_at: getGeneratedAt(filePath, parsed),
        status: parsed?.summary?.status ?? 'unknown',
        branch: parsed?.metadata?.git?.branch,
        commit_short: parsed?.metadata?.git?.commit_short,
        runtime_release_readiness: parsed?.summary?.runtime_release_evidence?.guardrails?.release_readiness,
        usage_release_readiness: parsed?.summary?.usage_report_evidence?.release_readiness,
        markdown_available: existsSync(getMarkdownPath(dir, base)),
      } satisfies ReleaseReportListItem;
    })
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at));
}

export function getReleaseReportDetail(dir: string, name: string): ReleaseReportDetail | null {
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
