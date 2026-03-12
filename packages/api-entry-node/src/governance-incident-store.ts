import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export type GovernanceIncidentEvent = {
  id: string;
  incident_id: string;
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
  governance_decision?: 'ready' | 'warning' | 'blocked';
  execution_review_status?: 'ready' | 'blocked';
  failed_step_name?: string;
  failure_categories?: string[];
  acknowledged_at?: string;
  acknowledged_by_user_id?: string;
  acknowledged_by_name?: string;
  assignee_user_id?: string;
  assignee_name?: string;
  due_at?: string;
  age_ms?: number;
  sla_status?: 'on_track' | 'due_soon' | 'overdue' | 'resolved';
  resolution_reason?: string;
  resolution_category?: 'mitigated' | 'accepted_risk' | 'false_positive' | 'deferred';
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
  incident_history?: Array<{
    id: string;
    incident_id: string;
    escalation_id: string;
    event_kind: 'escalation_assignment';
    created_at: string;
    actor_user_id: string;
    actor_name?: string;
    previous_assignee_user_id?: string;
    previous_assignee_name?: string;
    previous_due_at?: string;
    next_assignee_user_id: string;
    next_assignee_name?: string;
    next_due_at?: string;
  }>;
};

function normalizeName(name: string): string {
  return basename(name).replace(/\.json$/i, '');
}

function parseEscalation(filePath: string): GovernanceIncidentEvent | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as GovernanceIncidentEvent;
  } catch {
    return null;
  }
}

export function listGovernanceIncidents(dir: string): GovernanceIncidentEvent[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => parseEscalation(join(dir, name)))
    .filter((item): item is GovernanceIncidentEvent => item !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getGovernanceIncidentDetail(dir: string, id: string): GovernanceIncidentEvent | null {
  const filePath = join(dir, `${normalizeName(id)}.json`);
  if (!existsSync(filePath)) return null;
  return parseEscalation(filePath);
}
