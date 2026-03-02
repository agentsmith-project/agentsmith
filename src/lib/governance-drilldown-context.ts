export type GovernanceDrilldownOrigin = 'organization_overview' | 'workspace_settings';
export type GovernanceDrilldownKind = 'project' | 'member' | 'workspace';

export interface GovernanceDrilldownContext {
  gov_from: GovernanceDrilldownOrigin;
  gov_action_id?: string;
  gov_kind: GovernanceDrilldownKind;
  gov_workspace_id: string;
  gov_project_id?: string;
  gov_member_id?: string;
  gov_reason?: string;
  gov_related_signals?: number;
  gov_blocked_signals?: number;
  gov_warning_signals?: number;
  gov_project_signals?: number;
  gov_member_signals?: number;
  gov_workspace_risk_score?: number;
  gov_workspace_blocked_items?: number;
  gov_workspace_warning_items?: number;
  gov_workspace_risky_projects?: number;
}

type SearchParamReader = {
  get: (key: string) => string | null;
};

function asNonEmpty(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNonNegativeInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

export function buildGovernanceDrilldownQuery(context: GovernanceDrilldownContext): string {
  const query = new URLSearchParams();
  query.set('gov_from', context.gov_from);
  query.set('gov_kind', context.gov_kind);
  query.set('gov_workspace_id', context.gov_workspace_id);
  if (context.gov_action_id) {
    query.set('gov_action_id', context.gov_action_id);
  }
  if (context.gov_project_id) {
    query.set('gov_project_id', context.gov_project_id);
  }
  if (context.gov_member_id) {
    query.set('gov_member_id', context.gov_member_id);
  }
  if (context.gov_reason) {
    query.set('gov_reason', context.gov_reason);
  }
  if (typeof context.gov_related_signals === 'number') {
    query.set('gov_related_signals', String(context.gov_related_signals));
  }
  if (typeof context.gov_blocked_signals === 'number') {
    query.set('gov_blocked_signals', String(context.gov_blocked_signals));
  }
  if (typeof context.gov_warning_signals === 'number') {
    query.set('gov_warning_signals', String(context.gov_warning_signals));
  }
  if (typeof context.gov_project_signals === 'number') {
    query.set('gov_project_signals', String(context.gov_project_signals));
  }
  if (typeof context.gov_member_signals === 'number') {
    query.set('gov_member_signals', String(context.gov_member_signals));
  }
  if (typeof context.gov_workspace_risk_score === 'number') {
    query.set('gov_workspace_risk_score', String(context.gov_workspace_risk_score));
  }
  if (typeof context.gov_workspace_blocked_items === 'number') {
    query.set('gov_workspace_blocked_items', String(context.gov_workspace_blocked_items));
  }
  if (typeof context.gov_workspace_warning_items === 'number') {
    query.set('gov_workspace_warning_items', String(context.gov_workspace_warning_items));
  }
  if (typeof context.gov_workspace_risky_projects === 'number') {
    query.set('gov_workspace_risky_projects', String(context.gov_workspace_risky_projects));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export function parseGovernanceDrilldownContext(searchParams: SearchParamReader): GovernanceDrilldownContext | null {
  const from = asNonEmpty(searchParams.get('gov_from'));
  const kind = asNonEmpty(searchParams.get('gov_kind'));
  const workspaceId = asNonEmpty(searchParams.get('gov_workspace_id'));
  if (!from || !workspaceId || !kind) {
    return null;
  }
  if (from !== 'organization_overview' && from !== 'workspace_settings') {
    return null;
  }
  if (kind !== 'project' && kind !== 'member' && kind !== 'workspace') {
    return null;
  }
  return {
    gov_from: from,
    gov_kind: kind,
    gov_workspace_id: workspaceId,
    gov_action_id: asNonEmpty(searchParams.get('gov_action_id')),
    gov_project_id: asNonEmpty(searchParams.get('gov_project_id')),
    gov_member_id: asNonEmpty(searchParams.get('gov_member_id')),
    gov_reason: asNonEmpty(searchParams.get('gov_reason')),
    gov_related_signals: asNonNegativeInt(searchParams.get('gov_related_signals')),
    gov_blocked_signals: asNonNegativeInt(searchParams.get('gov_blocked_signals')),
    gov_warning_signals: asNonNegativeInt(searchParams.get('gov_warning_signals')),
    gov_project_signals: asNonNegativeInt(searchParams.get('gov_project_signals')),
    gov_member_signals: asNonNegativeInt(searchParams.get('gov_member_signals')),
    gov_workspace_risk_score: asNonNegativeInt(searchParams.get('gov_workspace_risk_score')),
    gov_workspace_blocked_items: asNonNegativeInt(searchParams.get('gov_workspace_blocked_items')),
    gov_workspace_warning_items: asNonNegativeInt(searchParams.get('gov_workspace_warning_items')),
    gov_workspace_risky_projects: asNonNegativeInt(searchParams.get('gov_workspace_risky_projects')),
  };
}
