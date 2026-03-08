import type { GovernanceDrilldownContext } from '@/lib/governance-drilldown-context';

export type GovernanceEvidenceFocus = 'limit' | 'deny' | 'cost' | 'exposure' | 'membership' | 'other';
export type LegacyGovernanceEvidenceFocus = 'quota';
export type GovernanceEvidenceFocusInput = GovernanceEvidenceFocus | LegacyGovernanceEvidenceFocus;

export type EvidenceTargetPage = 'audit' | 'usage' | 'members' | 'settings' | 'runtime-console';

export interface EvidenceFilterContext extends GovernanceDrilldownContext {
  gov_focus?: GovernanceEvidenceFocus;
  gov_time_range?: { start: string; end: string };
  gov_entity_filter?: {
    workspace_ids?: string[];
    project_ids?: string[];
  };
}

export function normalizeGovernanceEvidenceFocus(focus: GovernanceEvidenceFocusInput): GovernanceEvidenceFocus {
  return focus === 'quota' ? 'limit' : focus;
}

/**
 * Enhanced pattern matching for evidence focus classification.
 * Supports more patterns and is case-insensitive.
 */
export function classifyGovernanceEvidenceFocus(reason: string | undefined): GovernanceEvidenceFocus {
  if (!reason) {
    return 'other';
  }
  const normalized = reason.trim().toLowerCase();
  if (normalized.length === 0) {
    return 'other';
  }

  const matches = (patterns: string[]) => patterns.some((pattern) => normalized.includes(pattern));

  // Limit-related patterns
  if (matches([
    'quota',
    'limit',
    'rate_limit',
    'rate limit',
    'max_total_files',
    'max_file_size',
    'missing_source_library_quota',
    'daily_quota',
    'quota_exceeded',
    'limit_reached',
    'throttle',
    'throttled',
  ])) {
    return 'limit';
  }

  // Cost/billing-related patterns
  if (matches([
    'cost',
    'billing',
    'usage',
    'budget',
    'token',
    'token_usage',
    'spend',
    'overrun',
    'budget_alert',
    'usage_spike',
    'billing_threshold',
  ])) {
    return 'cost';
  }

  // Deny/access-related patterns
  if (matches([
    'deny',
    'denied',
    'blocked',
    'forbidden',
    'removed_member_with_project_scope',
    'permission',
    'permission_denied',
    'access_blocked',
    'access_denied',
    'unauthorized',
    'request_forbidden',
  ])) {
    return 'deny';
  }

  // Exposure/visibility-related patterns
  if (matches([
    'public',
    'open_access',
    'visibility',
    'exposed',
    'public_visibility',
    'open_access_enabled',
    'visibility_exposed',
    'access_control',
  ])) {
    return 'exposure';
  }

  // Membership/scope-related patterns
  if (matches([
    'member',
    'scope',
    'role',
    'governance',
    'member_scope',
    'role_change',
    'governance_policy',
    'membership',
    'scope_review',
  ])) {
    return 'membership';
  }

  return 'other';
}

/**
 * Gets the evidence count from drilldown context.
 * Prefers related_signals, falls back to blocked + warning sum.
 */
export function getGovernanceEvidenceCount(context: GovernanceDrilldownContext): number | undefined {
  if (typeof context.gov_related_signals === 'number') {
    return context.gov_related_signals;
  }
  const blocked = context.gov_blocked_signals ?? 0;
  const warning = context.gov_warning_signals ?? 0;
  const fallback = blocked + warning;
  return fallback > 0 ? fallback : undefined;
}

/**
 * Determines the most appropriate target page for viewing evidence
 * based on the evidence focus type.
 */
export function getEvidenceTargetPage(focusInput: GovernanceEvidenceFocusInput): EvidenceTargetPage {
  const focus = normalizeGovernanceEvidenceFocus(focusInput);
  switch (focus) {
    case 'limit':
      return 'audit';  // Limit violations are typically in audit logs
    case 'cost':
      return 'usage';  // Cost issues are best viewed in usage page
    case 'deny':
      return 'audit';  // Authorization denials are in audit logs
    case 'membership':
      return 'members';  // Membership issues go to members page
    case 'exposure':
      return 'settings';  // Visibility settings are in settings
    case 'other':
    default:
      return 'audit';  // Default to audit for general investigation
  }
}

/**
 * Builds an extended filter context for evidence navigation.
 * Includes focus, entity filters, and preserves original drilldown context.
 */
export function buildEvidenceFilterContext(
  context: GovernanceDrilldownContext,
  focusInput: GovernanceEvidenceFocusInput,
): EvidenceFilterContext {
  const focus = normalizeGovernanceEvidenceFocus(focusInput);
  const filterContext: EvidenceFilterContext = {
    ...context,
    gov_focus: focus,
  };

  // Build entity filter from context
  const entityFilter: NonNullable<EvidenceFilterContext['gov_entity_filter']> = {};

  if (context.gov_workspace_id) {
    entityFilter.workspace_ids = [context.gov_workspace_id];
  }

  if (context.gov_project_id) {
    entityFilter.project_ids = [context.gov_project_id];
  }

  if (Object.keys(entityFilter).length > 0) {
    filterContext.gov_entity_filter = entityFilter;
  }

  return filterContext;
}

/**
 * Generates the href for navigating to the evidence detail page
 * with proper context preservation.
 */
export function buildEvidenceHref(
  context: GovernanceDrilldownContext,
  focusInput: GovernanceEvidenceFocusInput,
  locale: string,
): string {
  const filterContext = buildEvidenceFilterContext(context, focusInput);
  const targetPage = getEvidenceTargetPage(focusInput);

  const workspaceId = context.gov_workspace_id;
  const projectId = context.gov_project_id;

  // Build query string from filter context
  const params = new URLSearchParams();
  params.set('gov_from', filterContext.gov_from);
  params.set('gov_kind', filterContext.gov_kind);
  params.set('gov_workspace_id', filterContext.gov_workspace_id);
  params.set('gov_focus', filterContext.gov_focus ?? '');

  if (filterContext.gov_action_id) {
    params.set('gov_action_id', filterContext.gov_action_id);
  }
  if (filterContext.gov_project_id) {
    params.set('gov_project_id', filterContext.gov_project_id);
  }
  if (filterContext.gov_member_id) {
    params.set('gov_member_id', filterContext.gov_member_id);
  }
  if (filterContext.gov_reason) {
    params.set('gov_reason', filterContext.gov_reason);
  }

  const queryString = params.toString();

  // Build href based on target page
  if (targetPage === 'usage' && workspaceId && projectId) {
    return `/${locale}/workspaces/${workspaceId}/projects/${projectId}/usage${queryString ? `?${queryString}` : ''}`;
  }

  if (targetPage === 'members' && workspaceId && projectId) {
    return `/${locale}/workspaces/${workspaceId}/projects/${projectId}/members${queryString ? `?${queryString}` : ''}`;
  }

  if (targetPage === 'settings' && workspaceId && projectId) {
    return `/${locale}/workspaces/${workspaceId}/projects/${projectId}/settings${queryString ? `?${queryString}` : ''}`;
  }

  if (targetPage === 'runtime-console' && workspaceId && projectId) {
    return `/${locale}/workspaces/${workspaceId}/projects/${projectId}/runtime-console?tab=control${queryString ? `&${queryString}` : ''}`;
  }

  // Default to audit page
  if (workspaceId && projectId) {
    return `/${locale}/workspaces/${workspaceId}/projects/${projectId}/audit${queryString ? `?${queryString}` : ''}`;
  }

  // Fallback to workspace project list if no project context
  if (workspaceId) {
    return `/${locale}/workspaces/${workspaceId}/projects${queryString ? `?${queryString}` : ''}`;
  }
  return `/${locale}/workspaces${queryString ? `?${queryString}` : ''}`;
}
