import type { ApiClient } from '../client';
import { APIError } from '../errors';
import type { MemberPermissions, QuotaOverride } from '../types';
import type { Membership } from './members';

export type GovernanceSubjectType = 'user' | 'group' | 'agent';
export type GovernanceResourceType = 'project' | 'endpoint' | 'source_library' | 'agent';
export type GovernanceMembershipStatus = 'active' | 'pending' | 'suspended' | 'none';

export interface GovernanceAuthorizationRequest {
  subject: {
    type: GovernanceSubjectType;
    id: string;
  };
  resource: {
    type: GovernanceResourceType;
    id: string;
  };
  action: string;
  context?: {
    end_user_id?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface GovernanceAuthorizationDecision {
  source: 'permission' | 'resource_policy' | 'project_default';
  rule_id?: string;
  reason: string;
}

export interface GovernanceMatchedPolicy {
  id: string;
  resource_type: 'endpoint' | 'source_library' | 'agent';
  resource_id: string;
  access_mode: 'allow_all_members' | 'allow_list';
  matched_subject?: {
    type: 'user' | 'group';
    id: string;
  };
}

export interface GovernanceAuthorizationResponse {
  allowed: boolean;
  decision: GovernanceAuthorizationDecision;
  matched_policy?: GovernanceMatchedPolicy;
}

export interface GovernanceQuotaCheckRequest {
  subject_id: string;
  resource_type: 'endpoint' | 'source_library' | 'agent';
  resource_id: string;
  operation: 'invoke' | 'upload' | 'create';
  estimated_cost?: number;
}

export interface GovernanceQuotaCheckResponse {
  allowed: boolean;
  quota_remaining: number;
  quota_limit: number;
  quota_reset_at: string;
  policy_id: string;
}

export interface GovernanceQuotaExceededDetails {
  error_code: 'RESOURCE_POLICY_QUOTA_EXCEEDED';
  message: string;
  resource_type?: 'endpoint' | 'source_library' | 'agent';
  resource_id?: string;
  quota_key?: string;
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

export interface GovernanceEvidenceDetails extends GovernanceQuotaExceededDetails {
  governance_kind?: 'resource_policy' | 'member_quota';
  enforcement_kind?: 'allow_list' | 'quota_limit' | 'rate_limit';
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
  quota_overrides: QuotaOverride;
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
    value.governance_kind === 'resource_policy' || value.governance_kind === 'member_quota'
      ? value.governance_kind
      : undefined;
  const enforcementKind =
    value.enforcement_kind === 'allow_list'
    || value.enforcement_kind === 'quota_limit'
    || value.enforcement_kind === 'rate_limit'
      ? value.enforcement_kind
      : undefined;

  const hasForbiddenAuthz =
    errorCode === 'FORBIDDEN'
    && (Array.isArray(value.missing_permissions) || isRecord(value.authz_decision));

  if (
    !governanceKind
    && !enforcementKind
    && errorCode !== 'RESOURCE_POLICY_QUOTA_EXCEEDED'
    && errorCode !== 'MEMBER_QUOTA_EXCEEDED'
    && errorCode !== 'RESOURCE_POLICY_DENIED'
    && !hasForbiddenAuthz
  ) {
    return null;
  }

  return value as unknown as GovernanceEvidenceDetails;
}

export function getGovernanceQuotaExceededDetails(error: unknown): GovernanceQuotaExceededDetails | null {
  if (!(error instanceof APIError)) return null;
  if (error.errorCode !== 'RESOURCE_POLICY_QUOTA_EXCEEDED') return null;
  if (!isRecord(error.details)) return null;
  return error.details as unknown as GovernanceQuotaExceededDetails;
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
    return this.client.post(
      `/workspaces/${workspaceId}/projects/${projectId}/authorize`,
      payload,
    );
  }

  async checkQuota(
    workspaceId: string,
    projectId: string,
    payload: GovernanceQuotaCheckRequest,
  ): Promise<GovernanceQuotaCheckResponse> {
    return this.client.post(
      `/workspaces/${workspaceId}/projects/${projectId}/quota/check`,
      payload,
    );
  }

  async getEffectiveAccessSnapshot(
    workspaceId: string,
    projectId: string,
    memberId: string,
  ): Promise<GovernanceEffectiveAccessSnapshot> {
    const [membership, permissions, quotaOverrides] = await Promise.all([
      this.client.get<Membership>(
        `/workspaces/${workspaceId}/projects/${projectId}/memberships/${memberId}`,
      ),
      this.client.get<MemberPermissions>(
        `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/permissions`,
      ),
      this.client.get<{ overrides: QuotaOverride }>(
        `/workspaces/${workspaceId}/projects/${projectId}/members/${memberId}/quota-overrides`,
      ),
    ]);

    return {
      membership,
      permissions: {
        platform_permissions: permissions.platform_permissions ?? [],
        resource_permissions: permissions.resource_permissions,
      },
      quota_overrides: quotaOverrides.overrides ?? {},
      effective_permissions: permissions.platform_permissions ?? [],
      membership_status: membership.status,
    };
  }
}
