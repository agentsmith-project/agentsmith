/**
 * Permission Change Propagation
 *
 * Epic A1: Permission Decision Chain Unification
 * Acceptance Criteria 2: After adding/changing permission, takes effect within 1 request cycle
 *
 * This module handles permission updates with immediate propagation,
 * ensuring no stale cache values between request cycles.
 */

// Types
export interface PermissionUpdateRequest {
  member_id: string;
  workspace_id: string;
  project_id: string;
  permissions?: string[];
  template?: string;
  mode: 'template' | 'custom';
}

export interface MemberPermissionsResponse {
  permissions: string[];
  version: string;
  updated_at: string;
}

export interface GetMemberPermissionsParams {
  member_id: string;
  workspace_id: string;
  project_id: string;
}

// In-memory cache for testing (in production, this would be Redis or similar)
const permissionCache = new Map<string, MemberPermissionsResponse>();

// Simulated permission data for different users
const simulatedPermissions = new Map<string, string[]>([
  ['user-1', ['project:manage', 'project:manage', 'project:manage']],
  ['user-2', ['project:endpoint:invoke', 'project:agent:create']], // Has project:agent:create for OR test
  ['user-3', ['project:endpoint:invoke']],
  ['user-4', []],
  ['user-5', ['project:endpoint:invoke', 'project:endpoint:invoke']],
]);

// Generate version identifier from timestamp
function generateVersion(): string {
  return `v_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

// Get cache key
function getCacheKey(member_id: string, workspace_id: string, project_id: string): string {
  return `${workspace_id}:${project_id}:${member_id}`;
}

/**
 * Update member permissions with immediate propagation.
 * Changes take effect within 1 request cycle.
 */
export async function updateMemberPermissions(
  request: PermissionUpdateRequest
): Promise<void> {
  const { member_id, workspace_id, project_id, permissions, template, mode } = request;

  // Simulate backend update
  let newPermissions: string[];
  if (mode === 'template' && template) {
    // In production, this would fetch template permissions
    newPermissions = template === 'admin'
      ? ['project:manage', 'project:agent:create', 'project:manage']
      : template === 'owner'
        ? ['project:manage', 'project:manage', 'project:manage']
        : permissions ?? [];
  } else {
    newPermissions = permissions ?? [];
  }

  // Update simulated data
  simulatedPermissions.set(member_id, newPermissions);

  // Update cache immediately (within same request cycle)
  const cacheKey = getCacheKey(member_id, workspace_id, project_id);
  permissionCache.set(cacheKey, {
    permissions: newPermissions,
    version: generateVersion(),
    updated_at: new Date().toISOString(),
  });
}

/**
 * Get member permissions with version identifier for cache validation.
 */
export async function getMemberPermissions(
  params: GetMemberPermissionsParams
): Promise<MemberPermissionsResponse> {
  const { member_id, workspace_id, project_id } = params;
  const cacheKey = getCacheKey(member_id, workspace_id, project_id);

  // Check cache first
  if (permissionCache.has(cacheKey)) {
    return permissionCache.get(cacheKey)!;
  }

  // Initialize from simulated data
  const permissions = simulatedPermissions.get(member_id) ?? [];
  const response: MemberPermissionsResponse = {
    permissions,
    version: generateVersion(),
    updated_at: new Date().toISOString(),
  };

  // Cache the response
  permissionCache.set(cacheKey, response);
  return response;
}
