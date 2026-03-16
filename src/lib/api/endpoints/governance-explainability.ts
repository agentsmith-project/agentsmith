import type { ApiClient } from '../client';
import { APIError } from '../errors';
import type { MemberPermissions } from '../types';
import type { Membership } from './members';

export type GovernanceSubjectType = 'user' | 'group' | 'agent';
export type GovernanceResourceType = 'project' | 'endpoint' | 'file_library' | 'agent';
export type GovernanceMembershipStatus = 'active' | 'pending' | 'suspended' | 'none';

export interface GovernanceAuthorizationRequest {
  subject: { type: GovernanceSubjectType; id: string };
  resource: { type: GovernanceResourceType; id: string };
  action: string;
  context?: { end_user_id?: string; metadata?: Record<string, unknown> };
}

export interface GovernanceAuthorizationDecision {
  source: 'permission' | 'resource_policy' | 'project_default';
  rule_id?: string;
  reason: string;
}

export interface GovernanceMatchedPolicy {
  id: string;
  resource_type: 'endpoint' | 'file_library' | 'agent';
  resource_id: string;
  access_mode: 'allow_all_members' | 'allow_list';
  matched_subject?: { type: 'user' | 'group'; id: string };
}

export interface GovernanceAuthorizationResponse {
  allowed: boolean;
  decision: GovernanceAuthorizationDecision;
  matched_policy?: GovernanceMatchedPolicy;
}

export interface GovernanceLimitCheckRequest {
  subject_id: string;
  resource_type: 'endpoint' | 'file_library' | 'agent';
  resource_id: string;
  operation: 'invoke' | 'upload' | 'create';
  estimated_cost?: number;
}

export interface GovernanceLimitCheckResponse {
  allowed: boolean;
  used: number;
  remaining: number;
  max: number;
  reset_at: string;
  policy_id: string;
}

export interface GovernanceLimitExceededDetails {
  error_code: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED';
  message: string;
  resource_type?: 'endpoint' | 'file_library' | 'agent';
  resource_id?: string;
  limit_key?: string;
  retry_after_seconds?: number;
  effective_limit?: number;
  current_usage?: number;
  usage_unit?: string;
  scope?: string;
  effective_max_total_files?: number;
  current_total_files?: number;
  effective_max_file_size_bytes?: number;
  current_file_size_bytes?: number;
}

export interface GovernanceEvidenceDetails extends GovernanceLimitExceededDetails {
  governance_kind?: 'resource_policy' | 'member_spending_limit';
  enforcement_kind?: 'allow_list' | 'spending_limit' | 'rate_limit';
  route_kind?: string;
  reason?: string;
  missing_permissions?: string[];
  authz_decision?: GovernanceRouteForbiddenDetails['authz_decision'];
}

export interface GovernanceRouteForbiddenDetails {
  error_code: 'FORBIDDEN';
  message: string;
  missing_permissions?: string[];
  authz_decision?: {
    membership_status?: GovernanceMembershipStatus;
    decisions?: Array<{
      permission: string;
      granted: boolean;
      reason: string;
      source: 'permission' | 'project_default';
      source_detail?: {
        type: 'owner' | 'project_default' | 'group_template' | 'member_template' | 'member_custom';
        permission: string;
        group_id?: string;
        group_name?: string;
        template_id?: string;
        template_name?: string;
      };
      membership_status: GovernanceMembershipStatus;
    }>;
  };
}

export interface GovernanceEffectiveAccessSnapshot {
  membership: Membership;
  permissions: MemberPermissions;
  effective_permissions: string[];
  membership_status: Extract<Membership['status'], 'active' | 'pending' | 'suspended'>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getGovernanceEvidenceDetails(value: unknown): GovernanceEvidenceDetails | null {
  if (!isRecord(value)) return null;
  const errorCode = typeof value.error_code === 'string' ? value.error_code : undefined;
  const governanceKind =
    value.governance_kind === 'resource_policy' || value.governance_kind === 'member_spending_limit'
      ? value.governance_kind
      : undefined;
  const enforcementKind =
    value.enforcement_kind === 'allow_list'
    || value.enforcement_kind === 'spending_limit'
    || value.enforcement_kind === 'rate_limit'
      ? value.enforcement_kind
      : undefined;

  const hasForbiddenAuthz =
    errorCode === 'FORBIDDEN'
    && (Array.isArray(value.missing_permissions) || isRecord(value.authz_decision));

  if (
    !governanceKind
    && !enforcementKind
    && errorCode !== 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED'
    && errorCode !== 'RESOURCE_POLICY_DENIED'
    && !hasForbiddenAuthz
  ) {
    return null;
  }

  const normalized = {
    ...value,
    error_code: errorCode,
    enforcement_kind: enforcementKind,
  } as GovernanceEvidenceDetails;
  return normalized;
}

export function getGovernanceLimitExceededDetails(error: unknown): GovernanceLimitExceededDetails | null {
  if (!(error instanceof APIError)) return null;
  if (error.errorCode !== 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED') return null;
  return getGovernanceEvidenceDetails(error.details);
}

export function getGovernanceRouteForbiddenDetails(error: unknown): GovernanceRouteForbiddenDetails | null {
  if (!(error instanceof APIError)) return null;
  if (error.errorCode !== 'FORBIDDEN') return null;
  if (!isRecord(error.details)) return null;
  return error.details as unknown as GovernanceRouteForbiddenDetails;
}

export class GovernanceExplainabilityAPI {
  constructor(private readonly client: ApiClient) {}

  async authorize(
    workspaceId: string,
    projectId: string,
    payload: GovernanceAuthorizationRequest,
  ): Promise<GovernanceAuthorizationResponse> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/authorize`, payload);
  }

  async checkLimits(
    workspaceId: string,
    projectId: string,
    payload: GovernanceLimitCheckRequest,
  ): Promise<GovernanceLimitCheckResponse> {
    return this.client.post(`/workspaces/${workspaceId}/projects/${projectId}/spending-limits/check`, payload).then((response) => {
      const raw = response as Partial<GovernanceLimitCheckResponse>;
      const max = raw.max ?? 0;
      const remaining = raw.remaining ?? 0;
      return {
        allowed: Boolean(raw.allowed),
        used: raw.used ?? Math.max(0, max - remaining),
        remaining,
        max,
        reset_at: raw.reset_at ?? '',
        policy_id: raw.policy_id ?? '',
      };
    });
  }

  async getEffectiveAccessSnapshot(
    workspaceId: string,
    projectId: string,
    memberId: string,
  ): Promise<GovernanceEffectiveAccessSnapshot> {
    const [membership, permissions] = await Promise.all([
      this.client.get<Membership>(`/workspaces/${workspaceId}/projects/${projectId}/memberships/${memberId}`),
      this.client.get<MemberPermissions>(`/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/permissions`),
    ]);

    return {
      membership,
      permissions: {
        platform_permissions: permissions.platform_permissions ?? [],
        resource_permissions: permissions.resource_permissions,
      },
      effective_permissions: permissions.platform_permissions ?? [],
      membership_status: membership.status,
    };
  }
}
