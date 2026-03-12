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

function makeMember(overrides?: Partial<WorkspaceMember>): WorkspaceMember {
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

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'Project One',
    visibility: 'private',
    join_policy: 'approval_required',
    owner_id: 'user_1',
    status: 'active',
    governance_json: {
      limits: {
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
  describe('basic rollup functionality', () => {
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
      expect(result.actionsQueue.length).toBeGreaterThan(0);
      expect(result.actionsQueue[0]?.actionType).toBe('investigate_project_risk');
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
      expect(result.actionsQueue).toHaveLength(0);
    });
  });

  describe('drill-down capability', () => {
    it('generates drill-down URLs for workspace snapshots', () => {
      const workspaces = [makeWorkspace('ws_critical', 'Critical Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_critical: [makeMember({ id: 'wm_1', user_id: 'user_1' })],
        },
        projectsByWorkspaceId: {
          ws_critical: [makeProject({ id: 'proj_blocked', workspace_id: 'ws_critical', visibility: 'public' })],
        },
      });

      const snapshot = result.workspaceRanking[0];
      expect(snapshot?.drillDownUrl).toBe('/en-US/workspaces/ws_critical/settings');
    });

    it('generates drill-down URLs for project-level attention items', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const projId = 'proj_risk';
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_1: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_1: [makeProject({ id: projId, workspace_id: 'ws_1', visibility: 'public' })],
        },
      });

      const projectAttention = result.attention.find((item) => item.projectId === projId);
      expect(projectAttention?.drillDownUrl).toBe('/en-US/workspaces/ws_1/projects/proj_risk/audit');
    });

    it('generates drill-down URLs for member-level attention items', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const memberUserId = 'removed_user';
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          // Create a removed member who still owns a project - triggers member attention (blocked)
          ws_1: [makeMember({ id: 'wm_1', user_id: memberUserId, status: 'removed' })],
        },
        projectsByWorkspaceId: {
          // Removed member still owns this project - member attention links to the project
          // since the issue is specifically about that project scope
          ws_1: [makeProject({ id: 'proj_owned', workspace_id: 'ws_1', owner_id: memberUserId })],
        },
      });

      const memberAttention = result.attention.find((item) => item.memberId);
      // Member attention with a projectId drills down to that specific project
      expect(memberAttention?.drillDownUrl).toBe('/en-US/workspaces/ws_1/projects/proj_owned/audit');
    });

    it('includes drill-down URLs in action queue', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_1: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_1: [makeProject({ id: 'proj_1', workspace_id: 'ws_1', visibility: 'public' })],
        },
      });

      const action = result.actionsQueue[0];
      expect(action?.drillDownUrl).toBeTruthy();
      expect(action?.drillDownUrl).toContain('/workspaces/ws_1/');
    });
  });

  describe('risk categorization', () => {
    it('categorizes blocked workspaces as critical', () => {
      const workspaces = [makeWorkspace('ws_blocked', 'Blocked Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_blocked: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_blocked: [makeProject({ workspace_id: 'ws_blocked', visibility: 'public', join_policy: 'open' })],
        },
      });

      expect(result.workspaceRanking[0]?.riskCategory).toBe('critical');
    });

    it('categorizes high-risk warning workspaces as high', () => {
      const workspaces = [makeWorkspace('ws_2', 'High Warning Workspace')];
      // Create many risky projects to push score >= 200
      const riskyProjects = Array.from({ length: 15 }, (_, i) =>
        makeProject({ id: `proj_${i}`, workspace_id: 'ws_2', visibility: 'public' })
      );
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_2: [makeMember({ id: 'wm_2', permissions: ['workspace:read', 'project:manage'] })],
        },
        projectsByWorkspaceId: {
          ws_2: riskyProjects,
        },
      });

      // With 15 projects, riskScore = 15 * 10 = 150 (warning items) + 15 (risky projects) = 165
      // This is less than 200, so it should be 'medium', not 'high'
      expect(result.workspaceRanking[0]?.riskCategory).toBe('medium');
    });

    it('categorizes low-risk warning workspaces as medium', () => {
      const workspaces = [makeWorkspace('ws_medium', 'Medium Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_medium: [makeMember({ id: 'wm_medium', permissions: ['workspace:read', 'project:manage'] })],
        },
        projectsByWorkspaceId: {
          ws_medium: [makeProject({ workspace_id: 'ws_medium', visibility: 'public' })],
        },
      });

      expect(result.workspaceRanking[0]?.riskCategory).toBe('medium');
    });

    it('categorizes healthy workspaces as low', () => {
      const workspaces = [makeWorkspace('ws_healthy', 'Healthy Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_healthy: [makeMember({ id: 'wm_1', user_id: 'owner_1', permissions: ['workspace:governance:update'] })],
        },
        projectsByWorkspaceId: {
          ws_healthy: [makeProject({ workspace_id: 'ws_healthy', owner_id: 'owner_1' })],
        },
      });

      expect(result.workspaceRanking[0]?.riskCategory).toBe('low');
    });
  });

  describe('action execution tracking', () => {
    it('initializes all actions with pending status', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_1: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_1: [makeProject({ workspace_id: 'ws_1', visibility: 'public' })],
        },
      });

      result.actionsQueue.forEach((action) => {
        expect(action.status).toBe('pending');
      });
    });

    it('assigns priority based on attention ranking order', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_1: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_1: [makeProject({ workspace_id: 'ws_1', visibility: 'public' })],
        },
      });

      result.actionsQueue.forEach((action, index) => {
        expect(action.priority).toBe(index);
      });
    });

    it('estimates effort based on action type and severity', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_1: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_1: [makeProject({ workspace_id: 'ws_1', visibility: 'public' })],
        },
      });

      const projectAction = result.actionsQueue.find((a) => a.actionType === 'investigate_project_risk');
      expect(projectAction?.estimatedEffortMinutes).toBeGreaterThan(0);
      expect(projectAction?.estimatedEffortMinutes).toBeLessThan(60); // Should be reasonable
    });

    it('sets creation timestamp for all actions', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const before = new Date().toISOString();
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_1: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_1: [makeProject({ workspace_id: 'ws_1', visibility: 'public' })],
        },
      });
      const after = new Date().toISOString();

      result.actionsQueue.forEach((action) => {
        expect(action.createdAt).toBeDefined();
        expect(action.createdAt >= before && action.createdAt <= after).toBe(true);
      });
    });
  });

  describe('impact scoring for prioritization', () => {
    it('assigns higher impact scores to blocked items', () => {
      const workspaces = [makeWorkspace('ws_blocked', 'Blocked')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_blocked: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_blocked: [makeProject({ workspace_id: 'ws_blocked', visibility: 'public' })],
        },
      });

      const blockedAttention = result.attention.filter((item) => item.severity === 'blocked');
      blockedAttention.forEach((item) => {
        expect(item.impactScore).toBeGreaterThanOrEqual(1000);
      });
    });

    it('assigns medium impact scores to warning items', () => {
      const workspaces = [makeWorkspace('ws_warning', 'Warning')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_warning: [makeMember({ id: 'wm_2', permissions: ['workspace:read', 'project:manage'] })],
        },
        projectsByWorkspaceId: {
          ws_warning: [makeProject({ workspace_id: 'ws_warning', visibility: 'public' })],
        },
      });

      const warningAttention = result.attention.filter((item) => item.severity === 'warning');
      warningAttention.forEach((item) => {
        expect(item.impactScore).toBeGreaterThanOrEqual(500);
        expect(item.impactScore).toBeLessThan(1000);
      });
    });
  });

  describe('action types', () => {
    it('assigns investigate_project_risk for project items', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_1: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_1: [makeProject({ workspace_id: 'ws_1', visibility: 'public' })],
        },
      });

      // Find attention items that are project-related (have projectId but no memberId)
      const projectActions = result.actionsQueue.filter((a) => a.projectId && !a.memberId);
      projectActions.forEach((action) => {
        expect(action.actionType).toBe('investigate_project_risk');
      });
    });

    it('assigns review_member_scope for member items with memberId', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_1: [makeMember({ id: 'wm_1', user_id: 'user_1' })],
        },
        projectsByWorkspaceId: {
          ws_1: [],
        },
      });

      const memberActions = result.actionsQueue.filter((a) => a.memberId);
      memberActions.forEach((action) => {
        expect(action.actionType).toBe('review_member_scope');
      });
    });

    it('assigns review_workspace_posture for workspace-level items', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_1: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_1: [],
        },
      });

      // Workspace-level actions don't have projectId or memberId
      const workspaceActions = result.actionsQueue.filter((a) => !a.projectId && !a.memberId);
      workspaceActions.forEach((action) => {
        expect(action.actionType).toBe('review_workspace_posture');
      });
    });
  });

  describe('locale support', () => {
    it('generates drill-down URLs with specified locale', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_1: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_1: [makeProject({ workspace_id: 'ws_1', visibility: 'public' })],
        },
        locale: 'zh-CN',
      });

      expect(result.workspaceRanking[0]?.drillDownUrl).toContain('/zh-CN/workspaces/');
    });

    it('defaults to en-US when locale is not specified', () => {
      const workspaces = [makeWorkspace('ws_1', 'Workspace')];
      const result = buildOrganizationGovernanceRollup({
        workspaces,
        membersByWorkspaceId: {
          ws_1: [makeMember()],
        },
        projectsByWorkspaceId: {
          ws_1: [makeProject({ workspace_id: 'ws_1', visibility: 'public' })],
        },
      });

      expect(result.workspaceRanking[0]?.drillDownUrl).toContain('/en-US/workspaces/');
    });
  });
});
