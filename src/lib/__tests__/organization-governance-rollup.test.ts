import { describe, expect, it } from 'vitest';
import type { Project, Workspace, WorkspaceMember } from '@/lib/api/types';
import { buildOrganizationGovernanceRollup } from '@/lib/organization-governance-rollup';

function makeWorkspace(id: string, name: string): Workspace {
  return {
    id,
    name,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  };
}

function makeMember(overrides: Partial<WorkspaceMember>): WorkspaceMember {
  return {
    id: 'wm_1',
    user_id: 'user_1',
    name: 'User One',
    email: 'user-1@example.com',
    role: 'admin',
    governance_group: 'wheel',
    permissions: ['workspace:read'],
    status: 'active',
    joined_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'Project One',
    visibility: 'private',
    join_policy: 'approval_required',
    owner_id: 'user_1',
    status: 'active',
    governance_json: {
      quotas: {
        source_library: {
          max_total_files: 10,
          max_file_size_bytes: 1024,
        },
      },
    },
    limits_json: {},
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildOrganizationGovernanceRollup', () => {
  it('ranks blocked workspace before warning workspace and computes summary', () => {
    const workspaces = [makeWorkspace('ws_1', 'Workspace Alpha'), makeWorkspace('ws_2', 'Workspace Beta')];
    const membersByWorkspaceId = {
      ws_1: [makeMember({ id: 'wm_a', user_id: 'user_a' })],
      ws_2: [makeMember({ id: 'wm_b', user_id: 'user_b' })],
    };
    const projectsByWorkspaceId = {
      ws_1: [makeProject({ workspace_id: 'ws_1', visibility: 'public', join_policy: 'open' })],
      ws_2: [makeProject({ id: 'proj_2', workspace_id: 'ws_2', visibility: 'public' })],
    };

    const result = buildOrganizationGovernanceRollup({
      workspaces,
      membersByWorkspaceId,
      projectsByWorkspaceId,
    });

    expect(result.summary.readiness).toBe('blocked');
    expect(result.summary.totalWorkspaces).toBe(2);
    expect(result.summary.blockedWorkspaces).toBe(1);
    expect(result.summary.warningWorkspaces).toBe(1);
    expect(result.workspaceRanking[0]?.workspaceId).toBe('ws_1');
    expect(result.workspaceRanking[1]?.workspaceId).toBe('ws_2');
    expect(result.attention.length).toBeGreaterThan(0);
  });

  it('returns ready summary when no risks are present', () => {
    const workspaces = [makeWorkspace('ws_1', 'Workspace Alpha')];
    const result = buildOrganizationGovernanceRollup({
      workspaces,
      membersByWorkspaceId: {
        ws_1: [makeMember({ id: 'wm_1', user_id: 'owner_1', permissions: ['workspace:governance:update'] })],
      },
      projectsByWorkspaceId: {
        ws_1: [makeProject({ workspace_id: 'ws_1', owner_id: 'owner_1' })],
      },
    });

    expect(result.summary.readiness).toBe('ready');
    expect(result.summary.riskyWorkspaces).toBe(0);
    expect(result.summary.totalRiskyProjects).toBe(0);
    expect(result.attention).toHaveLength(0);
  });
});
