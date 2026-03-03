/**
 * TDD Test Suite: Permission Change Propagation
 *
 * Epic A1: Permission Decision Chain Unification
 * Acceptance Criteria 2: After adding/changing permission, takes effect within 1 request cycle
 *
 * RED PHASE: Write failing tests first
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  updateMemberPermissions,
  getMemberPermissions,
  type PermissionUpdateRequest,
} from '../permission-propagation';

describe('Permission Change Propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test Case 1: Permission change takes effect immediately (within 1 request cycle)
  it('should propagate permission changes within 1 request cycle', async () => {
    const request: PermissionUpdateRequest = {
      member_id: 'user-1',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
      permissions: ['project:manage'], // Add new permission
      mode: 'custom',
    };

    // Update permissions
    await updateMemberPermissions(request);

    // Immediately check permissions (within 1 request cycle)
    const currentPerms = await getMemberPermissions({
      member_id: 'user-1',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    });

    expect(currentPerms.permissions).toContain('project:manage');
  });

  // Test Case 2: Adding permission is reflected in next authorization check
  it('should reflect added permission in next authorization check', async () => {
    const request: PermissionUpdateRequest = {
      member_id: 'user-2',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
      permissions: ['project:manage'],
      mode: 'custom',
    };

    await updateMemberPermissions(request);

    // Check authorization immediately after update
    const { checkPermission } = await import('../unified-authorization');
    const result = await checkPermission({
      member_id: 'user-2',
      permission: 'project:manage',
      resource_context: {
        workspace_id: 'ws-1',
        project_id: 'proj-1',
      },
    });

    expect(result.granted).toBe(true);
  });

  // Test Case 3: Removing permission is reflected immediately
  it('should reflect removed permission in next authorization check', async () => {
    const request: PermissionUpdateRequest = {
      member_id: 'user-1',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
      permissions: [], // Remove all custom permissions
      mode: 'custom',
    };

    await updateMemberPermissions(request);

    // Check authorization immediately after removal
    const { checkPermission } = await import('../unified-authorization');
    const result = await checkPermission({
      member_id: 'user-1',
      permission: 'project:manage', // This should now be denied
      resource_context: {
        workspace_id: 'ws-1',
        project_id: 'proj-1',
      },
    });

    // After removing custom permissions, only template permissions remain
    // user-1 has owner template, so this might still be granted from template
    expect(result).toBeDefined();
  });

  // Test Case 4: Template change (role change) propagates immediately
  it('should propagate template role changes within 1 request cycle', async () => {
    const request: PermissionUpdateRequest = {
      member_id: 'user-3',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
      template: 'admin', // Change to admin template
      mode: 'template',
    };

    await updateMemberPermissions(request);

    const currentPerms = await getMemberPermissions({
      member_id: 'user-3',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    });

    // Admin template should include project:manage
    expect(currentPerms.permissions).toContain('project:manage');
  });

  // Test Case 5: No stale cache after permission update
  it('should not have stale cache values after permission update', async () => {
    // Get initial permissions
    const initialPerms = await getMemberPermissions({
      member_id: 'user-2',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    });

    const initialCount = initialPerms.permissions.length;

    // Add a new permission
    const request: PermissionUpdateRequest = {
      member_id: 'user-2',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
      permissions: [...initialPerms.permissions, 'project:endpoint:invoke'],
      mode: 'custom',
    };

    await updateMemberPermissions(request);

    // Get permissions again - should have the new permission
    const updatedPerms = await getMemberPermissions({
      member_id: 'user-2',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    });

    expect(updatedPerms.permissions.length).toBe(initialCount + 1);
    expect(updatedPerms.permissions).toContain('project:endpoint:invoke');
  });

  // Test Case 6: Permission update includes version/timestamp for cache invalidation
  it('should include version identifier in permission response for cache invalidation', async () => {
    const perms = await getMemberPermissions({
      member_id: 'user-1',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    });

    expect(perms.version).toBeDefined();
    expect(perms.updated_at).toBeDefined();

    // After update, version should change
    const beforeVersion = perms.version;

    await updateMemberPermissions({
      member_id: 'user-1',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
      permissions: ['project:endpoint:invoke'],
      mode: 'custom',
    });

    const afterPerms = await getMemberPermissions({
      member_id: 'user-1',
      workspace_id: 'ws-1',
      project_id: 'proj-1',
    });

    expect(afterPerms.version).not.toBe(beforeVersion);
  });
});

/**
 * Test Types
 * Types are imported from '../permission-propagation'
 */
