import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export type ReleaseEscalationEvent = {
  id: string;
  report_name: string;
  run_id: string;
  created_at: string;
  event_type: 'gate_blocked' | 'gate_warning' | 'gate_ready' | 'override_requested' | 'override_decided';
  severity: 'critical' | 'warning' | 'info';
  status: 'open' | 'resolved';
  title: string;
  body?: string;
  artifact_name?: string;
  trigger?: 'manual' | 'scheduled' | 'ci' | 'unknown';
  release_policy_decision?: 'ready' | 'warning' | 'blocked';
  runtime_release_readiness?: 'ready' | 'blocked';
  usage_release_readiness?: 'ready' | 'blocked';
  failed_step_name?: string;
  failure_categories?: string[];
  acknowledged_at?: string;
  acknowledged_by_user_id?: string;
  acknowledged_by_name?: string;
  resolution_reason?: string;
  resolved_at?: string;
  resolved_by_user_id?: string;
  resolved_by_name?: string;
  webhook_delivery?: {
    status: 'success' | 'failed' | 'skipped';
    attempted_at?: string;
    response_status?: number;
    error?: string;
    duration_ms?: number;
  };
};

function normalizeName(name: string): string {
  return basename(name).replace(/\.json$/i, '');
}

function parseEscalation(filePath: string): ReleaseEscalationEvent | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ReleaseEscalationEvent;
  } catch {
    return null;
  }
}

export function listReleaseEscalations(dir: string): ReleaseEscalationEvent[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => parseEscalation(join(dir, name)))
    .filter((item): item is ReleaseEscalationEvent => item !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getReleaseEscalationDetail(dir: string, id: string): ReleaseEscalationEvent | null {
  const filePath = join(dir, `${normalizeName(id)}.json`);
  if (!existsSync(filePath)) return null;
  return parseEscalation(filePath);
}
