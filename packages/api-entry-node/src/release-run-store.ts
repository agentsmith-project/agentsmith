import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export type ReleaseGateRunListItem = {
  id: string;
  report_name: string;
  artifact_name: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  trigger: 'manual' | 'scheduled' | 'ci' | 'unknown';
  status: 'pass' | 'fail';
  branch?: string;
  commit_short?: string;
  release_policy_decision?: 'ready' | 'warning' | 'blocked';
  runtime_release_readiness?: 'ready' | 'blocked';
  usage_release_readiness?: 'ready' | 'blocked';
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  failed_step_name?: string;
  failed_step_category?: string;
};

export type ReleaseGateRunDetail = ReleaseGateRunListItem & {
  failed_step_names: string[];
  failure_categories: string[];
};

type ReleaseGateRunShape = ReleaseGateRunDetail;

function normalizeName(name: string): string {
  return basename(name).replace(/\.json$/i, '');
}

function getJsonPath(dir: string, name: string): string {
  return join(dir, `${normalizeName(name)}.json`);
}

function parseReleaseRun(filePath: string): ReleaseGateRunShape | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ReleaseGateRunShape;
  } catch {
    return null;
  }
}

export function listReleaseGateRuns(dir: string): ReleaseGateRunListItem[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => parseReleaseRun(join(dir, name)))
    .filter((item): item is ReleaseGateRunShape => item !== null)
    .map((item) => ({
      id: item.id,
      report_name: item.report_name,
      artifact_name: item.artifact_name,
      started_at: item.started_at,
      completed_at: item.completed_at,
      duration_ms: item.duration_ms,
      trigger: item.trigger,
      status: item.status,
      branch: item.branch,
      commit_short: item.commit_short,
      release_policy_decision: item.release_policy_decision,
      runtime_release_readiness: item.runtime_release_readiness,
      usage_release_readiness: item.usage_release_readiness,
      total_checks: item.total_checks,
      passed_checks: item.passed_checks,
      failed_checks: item.failed_checks,
      failed_step_name: item.failed_step_name,
      failed_step_category: item.failed_step_category,
    }))
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at));
}

export function getReleaseGateRunDetail(dir: string, name: string): ReleaseGateRunDetail | null {
  const jsonPath = getJsonPath(dir, name);
  if (!existsSync(jsonPath)) return null;
  return parseReleaseRun(jsonPath);
}
