import { describe, expect, it } from 'vitest';
import { buildWorkspaceGovernancePosture } from '@/lib/workspace-governance-posture';
import type { Project, WorkspaceMember } from '@/lib/api/types';

const members: WorkspaceMember[] = [
  {
    id: 'wm_1',
    user_id: 'u_1',
    name: 'Owner',
    email: 'owner@example.com',
    role: 'owner',
    governance_group: 'wheel',
    permissions: ['workspace:read'],
    status: 'active',
    joined_at: '2026-03-01T00:00:00Z',
  },
  {
    id: 'wm_2',
    user_id: 'u_2',
    name: 'Dev',
    email: 'dev@example.com',
    role: 'developer',
    governance_group: 'user',
    permissions: ['workspace:read'],
    status: 'active',
    joined_at: '2026-03-01T00:00:00Z',
  },
];

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'Alpha',
    owner_id: 'u_1',
    visibility: 'private',
    join_policy: 'approval_required',
    status: 'active',
    governance_json: {
      quotas: {
        source_library: {
          max_total_files: 2000,
          max_file_size_bytes: 104857600,
        },
      },
    },
    runtime_preferences_json: {},
    limits_json: {},
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildWorkspaceGovernancePosture', () => {
  it('marks public open projects as blocked', () => {
    const posture = buildWorkspaceGovernancePosture({
      members,
      projects: [makeProject({ visibility: 'public', join_policy: 'open' })],
    });

    expect(posture.readiness).toBe('blocked');
    expect(posture.summary.publicProjects).toBe(1);
    expect(posture.summary.openJoinProjects).toBe(1);
    expect(posture.projects[0]?.riskCodes).toContain('public_open_access');
  });

  it('marks missing source library quotas as warning', () => {
    const posture = buildWorkspaceGovernancePosture({
      members,
      projects: [makeProject({ governance_json: {}, limits_json: {} })],
    });

    expect(posture.readiness).toBe('warning');
    expect(posture.projects[0]?.readiness).toBe('warning');
    expect(posture.projects[0]?.riskCodes).toContain('missing_source_library_quota');
  });

  it('treats archived projects as informational and keeps ready posture when active projects are healthy', () => {
    const posture = buildWorkspaceGovernancePosture({
      members,
      projects: [
        makeProject({ id: 'proj_ready' }),
        makeProject({ id: 'proj_archived', status: 'archived' }),
      ],
    });

    expect(posture.readiness).toBe('ready');
    expect(posture.summary.activeProjects).toBe(1);
    expect(posture.projects.find((project) => project.projectId === 'proj_archived')?.readiness).toBe('info');
  });
});
