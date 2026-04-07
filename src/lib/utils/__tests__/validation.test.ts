import { describe, it, expect } from 'vitest';
import { validateProjectWithMembership } from '../validation-zod';

describe('validateProjectWithMembership', () => {
  it('should validate a valid project with membership', () => {
    const validProject = {
      id: 'proj_001',
      workspace_id: 'ws_default',
      name: 'Test Project',
      owner_id: 'user_001',
      status: 'active',
      visibility: 'public',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      groups: [{ id: 'grp_project_owner', name: 'Project Owner', permission_template_id: 'tpl_project_owner', built_in: true, system_key: 'owner' }],
      permissions: ['project:endpoint:use', 'project:governance:update'],
      membership_status: 'active',
    };

    const result = validateProjectWithMembership(validProject);
    expect(result).not.toBeNull();
    expect(result?.groups).toEqual([{ id: 'grp_project_owner', name: 'Project Owner', permission_template_id: 'tpl_project_owner', built_in: true, system_key: 'owner' }]);
    expect(result?.permissions).toEqual(['project:endpoint:use', 'project:governance:update']);
    expect(result?.membership_status).toBe('active');
  });

  it('should return null for invalid project', () => {
    const invalidProject = {
      id: 'proj_001',
    };

    const result = validateProjectWithMembership(invalidProject);
    expect(result).toBeNull();
  });

  it('should return null for invalid groups payload', () => {
    const projectWithInvalidGroups = {
      id: 'proj_001',
      workspace_id: 'ws_default',
      name: 'Test Project',
      owner_id: 'user_001',
      status: 'active',
      visibility: 'public',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      groups: 'invalid_group_payload',
      permissions: [],
      membership_status: 'none',
    };

    const result = validateProjectWithMembership(projectWithInvalidGroups);
    expect(result).toBeNull();
  });

  it('should return null for non-array permissions', () => {
    const projectWithInvalidPermissions = {
      id: 'proj_001',
      workspace_id: 'ws_default',
      name: 'Test Project',
      owner_id: 'user_001',
      status: 'active',
      visibility: 'public',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      groups: [{ id: 'grp_project_owner', name: 'Project Owner', permission_template_id: 'tpl_project_owner', built_in: true, system_key: 'owner' }],
      permissions: 'not-an-array',
      membership_status: 'active',
    };

    const result = validateProjectWithMembership(projectWithInvalidPermissions);
    expect(result).toBeNull();
  });

  it('should require explicit membership status and permissions', () => {
    const projectWithoutMembership = {
      id: 'proj_001',
      workspace_id: 'ws_default',
      name: 'Test Project',
      owner_id: 'user_001',
      status: 'active',
      visibility: 'public',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const result = validateProjectWithMembership(projectWithoutMembership);
    expect(result).toBeNull();
  });
});
