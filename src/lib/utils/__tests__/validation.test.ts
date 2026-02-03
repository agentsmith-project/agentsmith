import { describe, it, expect } from 'vitest';
import { validateProjectWithMembership, type ProjectWithMembership } from '../validation';

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
      role: 'owner',
      permissions: ['project:read', 'project:update'],
    };

    const result = validateProjectWithMembership(validProject);
    expect(result).not.toBeNull();
    expect(result?.role).toBe('owner');
    expect(result?.permissions).toEqual(['project:read', 'project:update']);
  });

  it('should return null for invalid project', () => {
    const invalidProject = {
      id: 'proj_001',
      // Missing required fields
    };

    const result = validateProjectWithMembership(invalidProject);
    expect(result).toBeNull();
  });

  it('should return null for invalid role', () => {
    const projectWithInvalidRole = {
      id: 'proj_001',
      workspace_id: 'ws_default',
      name: 'Test Project',
      owner_id: 'user_001',
      status: 'active',
      visibility: 'public',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      role: 'invalid_role',
      permissions: [],
    };

    const result = validateProjectWithMembership(projectWithInvalidRole);
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
      role: 'owner',
      permissions: 'not-an-array',
    };

    const result = validateProjectWithMembership(projectWithInvalidPermissions);
    expect(result).toBeNull();
  });

  it('should allow optional role and permissions', () => {
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
    expect(result).not.toBeNull();
    expect(result?.role).toBeUndefined();
    expect(result?.permissions).toBeUndefined();
  });
});
