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
  };
}
