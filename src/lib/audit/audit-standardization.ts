/**
 * Audit Field Standardization (Epic B2)
 *
 * Standardized audit structure:
 * - actor: { type, id, name? } - who performed the action
 * - target: { type, id, workspace_id, project_id? } - what was affected
 * - action: string - what was done
 * - at: ISO timestamp - when it happened
 * - request_id: string - for tracing
 * - diff: object - optional, what changed (before/after)
 */

import type { AuditEvent } from '@/lib/api/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Actor who performed the audit action
 */
export interface AuditActor {
  /** Actor type: user, agent, or plugin */
  type: 'user' | 'agent' | 'plugin';
  /** Unique identifier for the actor */
  id: string;
  /** Optional human-readable name */
  name?: string;
}

/**
 * Target resource that was affected by the audit action
 */
export interface AuditTarget {
  /** Resource type (e.g., member, agent, endpoint, project) */
  type: string;
  /** Unique identifier for the target resource */
  id: string;
  /** Workspace ID containing the target */
  workspace_id: string;
  /** Optional project ID if target is within a project */
  project_id?: string;
}

/**
 * Diff representing what changed in an update action
 */
export interface AuditDiff {
  /** State before the change */
  before: Record<string, unknown>;
  /** State after the change */
  after: Record<string, unknown>;
}

/**
 * Standardized Audit Event structure
 *
 * Per PRD requirements: actor/target/action/at/request_id/diff(optional)
 */
export interface StandardizedAuditEvent {
  /** Who performed the action */
  actor: AuditActor;
  /** What was affected */
  target: AuditTarget;
  /** What was done (e.g., 'member.add', 'agent.update') */
  action: string;
  /** When it happened (ISO 8601 timestamp) */
  at: string;
  /** Request ID for tracing */
  request_id: string;
  /** Optional: what changed (for update actions) */
  diff?: AuditDiff;
}

// =============================================================================
// Adapter Functions
// =============================================================================

/**
 * Transform AuditEvent to StandardizedAuditEvent
 *
 * Maps the old AuditEvent structure to the new standardized format.
 */
export function standardizeAuditEvent(event: AuditEvent): StandardizedAuditEvent {
  const standardized: StandardizedAuditEvent = {
    actor: {
      type: event.actor_type,
      id: event.actor_id,
    },
    target: {
      type: event.resource_type ?? 'unknown',
      id: event.resource_id ?? 'unknown',
      workspace_id: event.workspace_id,
      project_id: event.project_id,
    },
    action: event.action,
    at: event.timestamp,
    request_id: event.request_id,
  };

  // Parse diff for update actions
  const diff = parseAuditDiff(event.action, event.metadata_json);
  if (diff) {
    standardized.diff = diff;
  }

  return standardized;
}

/**
 * Parse metadata_json into before/after diff for update actions
 *
 * Recognized patterns:
 * - previous_* / new_* pairs
 * - old_* / new_* pairs
 *
 * Keeps original key names to preserve full context.
 */
export function parseAuditDiff(
  action: string,
  metadata: Record<string, unknown>,
): AuditDiff | null {
  // Only extract diff for update actions
  if (!action.endsWith('.update') && !action.endsWith('.change')) {
    return null;
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  let hasDiff = false;

  for (const [key, value] of Object.entries(metadata)) {
    if (key.startsWith('previous_') || key.startsWith('old_')) {
      before[key] = value;
      hasDiff = true;
    } else if (key.startsWith('new_')) {
      after[key] = value;
      hasDiff = true;
    }
  }

  if (!hasDiff) {
    return null;
  }

  return { before, after };
}

// =============================================================================
// Export Functions
// =============================================================================

/**
 * Export audit events to CSV format
 *
 * CSV structure:
 * - Header: actor_type,actor_id,actor_name,target_type,target_id,workspace_id,project_id,action,at,request_id,diff
 * - Rows: one per audit event
 */
export function exportAuditToCSV(events: StandardizedAuditEvent[]): string {
  const headers = [
    'actor_type',
    'actor_id',
    'actor_name',
    'target_type',
    'target_id',
    'workspace_id',
    'project_id',
    'action',
    'at',
    'request_id',
    'diff',
  ];

  const rows = events.map((event) => {
    const diffStr = event.diff ? JSON.stringify(event.diff) : '';
    const values = [
      event.actor.type,
      event.actor.id,
      event.actor.name ?? '',
      event.target.type,
      event.target.id,
      event.target.workspace_id,
      event.target.project_id ?? '',
      event.action,
      event.at,
      event.request_id,
      diffStr,
    ];

    // Only quote values containing commas, quotes, or newlines
    return values
      .map((v) => {
        const str = String(v);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Export audit events to JSON format
 *
 * Returns a JSON string representation of the audit events array.
 */
export function exportAuditToJSON(events: StandardizedAuditEvent[]): string {
  return JSON.stringify(events, null, 2);
}
