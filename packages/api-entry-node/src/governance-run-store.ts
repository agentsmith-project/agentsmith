import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export type GovernanceRunListItem = {
  id: string;
  incident_id: string;
  report_name: string;
  artifact_name: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  trigger: 'manual' | 'scheduled' | 'ci' | 'unknown';
  status: 'pass' | 'fail';
  branch?: string;
  commit_short?: string;
  governance_decision?: 'ready' | 'warning' | 'blocked';
  execution_review_status?: 'ready' | 'blocked';
  usage_review_status?: 'ready' | 'blocked';
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  failed_step_name?: string;
  failed_step_category?: string;
  actor_user_id?: string;
  actor_name?: string;
  notes?: string;
  rerun_of_run_id?: string;
};

export type GovernanceRunDetail = GovernanceRunListItem & {
  failed_step_names: string[];
  failed_check_ids?: string[];
  requested_check_ids?: string[];
  failure_categories: string[];
};

type GovernanceRunShape = GovernanceRunDetail;

function normalizeName(name: string): string {
  return basename(name).replace(/\.json$/i, '');
}

function getJsonPath(dir: string, name: string): string {
  return join(dir, `${normalizeName(name)}.json`);
}

function parseReleaseRun(filePath: string): GovernanceRunShape | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as GovernanceRunShape;
  } catch {
    return null;
  }
}

export function listGovernanceRuns(dir: string): GovernanceRunListItem[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => parseReleaseRun(join(dir, name)))
    .filter((item): item is GovernanceRunShape => item !== null)
    .map((item) => ({
      id: item.id,
      incident_id: item.incident_id,
      report_name: item.report_name,
      artifact_name: item.artifact_name,
      started_at: item.started_at,
      completed_at: item.completed_at,
      duration_ms: item.duration_ms,
      trigger: item.trigger,
      status: item.status,
      branch: item.branch,
      commit_short: item.commit_short,
      governance_decision: item.governance_decision,
      execution_review_status: item.execution_review_status,
      usage_review_status: item.usage_review_status,
      total_checks: item.total_checks,
      passed_checks: item.passed_checks,
      failed_checks: item.failed_checks,
      failed_step_name: item.failed_step_name,
      failed_step_category: item.failed_step_category,
      actor_user_id: item.actor_user_id,
      actor_name: item.actor_name,
      notes: item.notes,
      rerun_of_run_id: item.rerun_of_run_id,
    }))
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at));
}

export function getGovernanceRunDetail(dir: string, name: string): GovernanceRunDetail | null {
  const jsonPath = getJsonPath(dir, name);
  if (!existsSync(jsonPath)) return null;
  return parseReleaseRun(jsonPath);
}
