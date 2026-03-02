import type { Project, Workspace, WorkspaceMember } from '@/lib/api/types';
import {
  buildWorkspaceGovernanceAttentionFeed,
  buildWorkspaceGovernancePosture,
  buildWorkspaceMemberAdministration,
  type WorkspaceGovernanceReadiness,
} from '@/lib/workspace-governance-posture';

export interface OrganizationWorkspaceGovernanceSnapshot {
  workspaceId: string;
  workspaceName: string;
  readiness: WorkspaceGovernanceReadiness;
  riskScore: number;
  blockedItems: number;
  warningItems: number;
  riskyProjects: number;
  totalProjects: number;
  topRiskProjectId?: string;
}

export interface OrganizationGovernanceAttentionItem {
  id: string;
  workspaceId: string;
  workspaceName: string;
  severity: WorkspaceGovernanceReadiness;
  kind: 'project' | 'member';
  title: string;
  description: string;
  projectId?: string;
  memberId?: string;
}

export interface OrganizationGovernanceRollup {
  readiness: WorkspaceGovernanceReadiness;
  totalWorkspaces: number;
  blockedWorkspaces: number;
  warningWorkspaces: number;
  riskyWorkspaces: number;
  totalRiskyProjects: number;
  topRiskWorkspaceId?: string;
}

export function buildOrganizationGovernanceRollup(args: {
  workspaces: Workspace[];
  membersByWorkspaceId: Record<string, WorkspaceMember[]>;
  projectsByWorkspaceId: Record<string, Project[]>;
}): {
  summary: OrganizationGovernanceRollup;
  workspaceRanking: OrganizationWorkspaceGovernanceSnapshot[];
  attention: OrganizationGovernanceAttentionItem[];
} {
  const ranking: OrganizationWorkspaceGovernanceSnapshot[] = [];
  const attention: OrganizationGovernanceAttentionItem[] = [];

  for (const workspace of args.workspaces) {
    const projects = args.projectsByWorkspaceId[workspace.id] ?? [];
    const members = args.membersByWorkspaceId[workspace.id] ?? [];
    const posture = buildWorkspaceGovernancePosture({ members, projects });
    const memberAdmin = buildWorkspaceMemberAdministration({ members, projects });

    const blockedProjects = posture.projects.filter((project) => project.readiness === 'blocked').length;
    const blockedMembers = memberAdmin.filter((member) => member.readiness === 'blocked').length;
    const warningProjects = posture.projects.filter((project) => project.readiness === 'warning').length;
    const warningMembers = memberAdmin.filter((member) => member.readiness === 'warning').length;

    const blockedItems = blockedProjects + blockedMembers;
    const warningItems = warningProjects + warningMembers;
    const riskScore = blockedItems * 100 + warningItems * 10 + posture.summary.riskyProjects;

    ranking.push({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      readiness: posture.readiness,
      riskScore,
      blockedItems,
      warningItems,
      riskyProjects: posture.summary.riskyProjects,
      totalProjects: posture.summary.totalProjects,
      topRiskProjectId: posture.projects.find((project) => project.readiness === 'blocked' || project.readiness === 'warning')?.projectId,
    });

    const workspaceAttention = buildWorkspaceGovernanceAttentionFeed({
      projects: posture.projects,
      members: memberAdmin,
    }).map<OrganizationGovernanceAttentionItem>((item) => ({
      id: `${workspace.id}:${item.id}`,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      severity: item.severity,
      kind: item.kind,
      title: item.title,
      description: item.description,
      projectId: item.projectId,
      memberId: item.memberId,
    }));

    attention.push(...workspaceAttention);
  }

  const sortReadiness = (readiness: WorkspaceGovernanceReadiness) => {
    switch (readiness) {
      case 'blocked':
        return 0;
      case 'warning':
        return 1;
      default:
        return 2;
    }
  };

  const workspaceRanking = ranking.sort((left, right) => {
    if (left.riskScore !== right.riskScore) {
      return right.riskScore - left.riskScore;
    }
    return left.workspaceName.localeCompare(right.workspaceName);
  });

  const attentionRanking = attention
    .sort((left, right) => {
      const severityRank = sortReadiness(left.severity) - sortReadiness(right.severity);
      if (severityRank !== 0) {
        return severityRank;
      }
      return left.workspaceName.localeCompare(right.workspaceName) || left.title.localeCompare(right.title);
    })
    .slice(0, 8);

  const blockedWorkspaces = workspaceRanking.filter((workspace) => workspace.readiness === 'blocked').length;
  const warningWorkspaces = workspaceRanking.filter((workspace) => workspace.readiness === 'warning').length;
  const riskyWorkspaces = blockedWorkspaces + warningWorkspaces;
  const totalRiskyProjects = workspaceRanking.reduce((sum, workspace) => sum + workspace.riskyProjects, 0);

  const summary: OrganizationGovernanceRollup = {
    readiness: blockedWorkspaces > 0 ? 'blocked' : warningWorkspaces > 0 ? 'warning' : 'ready',
    totalWorkspaces: workspaceRanking.length,
    blockedWorkspaces,
    warningWorkspaces,
    riskyWorkspaces,
    totalRiskyProjects,
    topRiskWorkspaceId: workspaceRanking[0]?.workspaceId,
  };

  return {
    summary,
    workspaceRanking,
    attention: attentionRanking,
  };
}
