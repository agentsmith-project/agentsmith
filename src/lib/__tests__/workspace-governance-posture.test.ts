import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceGovernancePosture,
  buildWorkspaceMemberAdministration,
  buildWorkspaceGovernanceAttentionFeed,
  buildWorkspaceGovernanceExplainabilitySummary,
} from '@/lib/workspace-governance-posture';
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

  it('marks missing source library limits as warning', () => {
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

describe('buildWorkspaceMemberAdministration', () => {
  it('flags removed members that still hold project scope', () => {
    const entries = buildWorkspaceMemberAdministration({
      members: [
        ...members,
        {
          id: 'wm_3',
          user_id: 'u_3',
          name: 'Removed Admin',
          email: 'removed@example.com',
          role: 'admin',
          permissions: ['workspace:read'],
          status: 'removed',
          joined_at: '2026-03-01T00:00:00Z',
        },
      ],
      projects: [
        makeProject({
          governance_json: {
            project_admins: ['u_3'],
            quotas: {
              source_library: {
                max_total_files: 2000,
                max_file_size_bytes: 104857600,
              },
            },
          },
        }),
      ],
    });

    const removed = entries.find((entry) => entry.userId === 'u_3');
    expect(removed?.readiness).toBe('blocked');
    expect(removed?.riskCodes).toContain('removed_member_with_project_scope');
  });

  it('tracks exposed project scope for active members', () => {
    const entries = buildWorkspaceMemberAdministration({
      members,
      projects: [
        makeProject({
          owner_id: 'u_2',
          visibility: 'public',
          join_policy: 'open',
        }),
      ],
    });

    const dev = entries.find((entry) => entry.userId === 'u_2');
    expect(dev?.readiness).toBe('warning');
    expect(dev?.administeredProjects).toBe(1);
    expect(dev?.exposedProjects).toBe(1);
    expect(dev?.riskCodes).toContain('public_project_scope');
    expect(dev?.riskCodes).toContain('open_join_scope');
    expect(dev?.primaryProjectId).toBe('proj_1');
    expect(dev?.primaryExposedProjectId).toBe('proj_1');
  });

  it('uses governance group fallback from permissions when api field is missing', () => {
    const entries = buildWorkspaceMemberAdministration({
      members: [
        {
          id: 'wm_4',
          user_id: 'u_4',
          name: 'Wheel Fallback',
          email: 'wheel@example.com',
          role: 'admin',
          permissions: ['workspace:governance:update'],
          status: 'active',
          joined_at: '2026-03-01T00:00:00Z',
        },
      ],
      projects: [],
    });

    expect(entries[0]?.governanceGroup).toBe('wheel');
  });
});

describe('buildWorkspaceGovernanceAttentionFeed', () => {
  it('prioritizes blocked project and member governance issues', () => {
    const projects = buildWorkspaceGovernancePosture({
      members,
      projects: [makeProject({ visibility: 'public', join_policy: 'open' })],
    }).projects;
    const memberEntries = buildWorkspaceMemberAdministration({
      members: [
        ...members,
        {
          id: 'wm_3',
          user_id: 'u_3',
          name: 'Removed Admin',
          email: 'removed@example.com',
          role: 'admin',
          permissions: ['workspace:read'],
          status: 'removed',
          joined_at: '2026-03-01T00:00:00Z',
        },
      ],
      projects: [
        makeProject({
          id: 'proj_scope',
          governance_json: {
            project_admins: ['u_3'],
          },
        }),
      ],
    });

    const feed = buildWorkspaceGovernanceAttentionFeed({
      projects,
      members: memberEntries,
    });

    expect(feed[0]?.severity).toBe('blocked');
    expect(feed.some((item) => item.kind === 'project')).toBe(true);
    expect(feed.some((item) => item.kind === 'member')).toBe(true);
  });
});

describe('buildWorkspaceGovernanceExplainabilitySummary', () => {
  it('summarizes blocked and warning governance posture', () => {
    const projects = buildWorkspaceGovernancePosture({
      members,
      projects: [
        makeProject({ id: 'proj_blocked', visibility: 'public', join_policy: 'open' }),
        makeProject({ id: 'proj_warning', governance_json: {}, limits_json: {} }),
      ],
    }).projects;
    const memberEntries = buildWorkspaceMemberAdministration({
      members: [
        ...members,
        {
          id: 'wm_removed',
          user_id: 'u_removed',
          name: 'Removed Admin',
          email: 'removed@example.com',
          role: 'admin',
          permissions: ['workspace:read'],
          status: 'removed',
          joined_at: '2026-03-01T00:00:00Z',
        },
      ],
      projects: [
        makeProject({
          id: 'proj_scope',
          governance_json: {
            project_admins: ['u_removed'],
          },
        }),
      ],
    });

    const summary = buildWorkspaceGovernanceExplainabilitySummary({
      projects,
      members: memberEntries,
    });

    expect(summary.blockedProjects).toBeGreaterThan(0);
    expect(summary.warningProjects).toBeGreaterThan(0);
    expect(summary.blockedMembers).toBeGreaterThan(0);
    expect(summary.primaryBlockedProjectId).toBe('proj_blocked');
    expect(summary.primaryBlockedMemberProjectId).toBe('proj_scope');
  });
});
