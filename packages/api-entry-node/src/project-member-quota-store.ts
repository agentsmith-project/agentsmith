export type MemberQuotaHistoryItemRecord = {
  id: string;
  created_at: string;
  created_by_user_id: string;
  overrides_json: Record<string, unknown>;
};

export type MemberQuotaOverridesRecord = {
  overrides: Record<string, unknown>;
  history: MemberQuotaHistoryItemRecord[];
};

const PROJECT_MEMBER_QUOTA_OVERRIDES_BY_PROJECT = new Map<string, Map<string, MemberQuotaOverridesRecord>>();

function projectScopedKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

export function getMemberQuotaState(
  workspaceId: string,
  projectId: string,
): Map<string, MemberQuotaOverridesRecord> {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_MEMBER_QUOTA_OVERRIDES_BY_PROJECT.get(key);
  if (existing) return existing;
  const created = new Map<string, MemberQuotaOverridesRecord>();
  PROJECT_MEMBER_QUOTA_OVERRIDES_BY_PROJECT.set(key, created);
  return created;
}

export function readMemberEndpointDailyTokenLimit(
  workspaceId: string,
  projectId: string,
  userId: string,
): number | undefined {
  const state = getMemberQuotaState(workspaceId, projectId);
  const raw = state.get(userId)?.overrides;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const endpoint = (raw as { endpoint?: unknown }).endpoint;
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) return undefined;
  const limit = (endpoint as { daily_token_limit?: unknown }).daily_token_limit;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return undefined;
  return Math.floor(limit);
}
