export interface MemberPermissions {
  platform_permissions: string[];
  resource_permissions?: {
    endpoint?: string[];
  };
}

export interface LimitOverride {
  endpoint?: {
    daily_token_limit?: number;
  };
  file_library?: {
    max_total_files?: number;
    max_file_size_bytes?: number;
  };
  agent?: {
    max_concurrency?: number;
  };
}

export type PolicyResourceType = 'endpoint' | 'file_library' | 'agent';
export type PolicySubjectType = 'group' | 'user';

export type PolicyRuleKey =
  | 'endpoint.requests_per_minute'
  | 'endpoint.requests_per_5_hours'
  | 'endpoint.requests_per_day'
  | 'endpoint.spending_usd_per_minute'
  | 'endpoint.spending_usd_per_5_hours'
  | 'endpoint.spending_usd_per_day'
  | 'file_library.requests_per_minute'
  | 'file_library.max_total_files'
  | 'file_library.max_file_size_bytes';

export interface PolicyRule<K extends PolicyRuleKey = PolicyRuleKey> {
  key: K;
  value: number;
  window?: 'day' | null;
}

export interface PolicyRateLimit {
  rules: PolicyRule[];
  [key: string]: unknown;
}

export interface PolicySpendingLimit {
  rules: PolicyRule[];
  [key: string]: unknown;
}

export interface ResourcePolicySubject {
  subject_type: PolicySubjectType;
  subject_id: string;
  rate_limits?: PolicyRateLimit;
  spending_limits?: PolicySpendingLimit;
  updated_at?: string;
}

export interface ResourcePolicy {
  resource_type: PolicyResourceType;
  resource_id: string;
  access_mode: 'allow_all_members' | 'allow_list';
  allowed_subjects: ResourcePolicySubject[];
  rate_limits?: PolicyRateLimit;
  spending_limits?: PolicySpendingLimit;
}

export interface ResourcePolicyUpdateRequest {
  access_mode: 'allow_all_members' | 'allow_list';
  allowed_subjects: Array<{
    subject_type: PolicySubjectType;
    subject_id: string;
    rate_limits?: PolicyRateLimit;
    spending_limits?: PolicySpendingLimit;
  }>;
  rate_limits?: PolicyRateLimit;
  spending_limits?: PolicySpendingLimit;
}

export interface ProjectGovernanceDefaults {
  endpoint: {
    access_mode: 'allow_all_members' | 'allow_list';
    rate_limits?: {
      rules: Array<
        PolicyRule<'endpoint.requests_per_minute'>
        | PolicyRule<'endpoint.requests_per_5_hours'>
        | PolicyRule<'endpoint.requests_per_day'>
      >;
    };
    spending_limits?: {
      rules: Array<
        PolicyRule<'endpoint.spending_usd_per_minute'>
        | PolicyRule<'endpoint.spending_usd_per_5_hours'>
        | PolicyRule<'endpoint.spending_usd_per_day'>
      >;
    };
  };
  file_library: {
    access_mode: 'allow_all_members' | 'allow_list';
    rate_limits?: {
      rules: PolicyRule<'file_library.requests_per_minute'>[];
    };
    spending_limits?: {
      rules: Array<
        PolicyRule<'file_library.max_total_files'> | PolicyRule<'file_library.max_file_size_bytes'>
      >;
    };
  };
  agent: {
    access_mode: 'allow_all_members' | 'allow_list';
  };
}

export interface PermissionTemplate {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  built_in?: boolean;
  editable?: boolean;
  is_default: boolean;
  is_readonly: boolean;
}

export interface MemberGroupSummary {
  id: string;
  name: string;
  permission_template_id: string;
  built_in?: boolean;
  system_key?: string;
}

export interface ChangeHistoryEntry {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  change_type: 'permissions' | 'resource_policy' | 'role';
  changes: {
    added?: string[];
    removed?: string[];
    updated?: Record<string, { from: unknown; to: unknown }>;
  };
}

export interface LimitOverrideHistoryItem {
  id: string;
  created_at: string;
  created_by_user_id: string;
  overrides_json: LimitOverride;
}

export interface LimitTemplate {
  id: string;
  name: string;
  description?: string;
  overrides_json: LimitOverride;
}
