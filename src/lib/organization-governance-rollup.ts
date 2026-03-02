import type { Project, Workspace, WorkspaceMember } from '@/lib/api/types';
import {
  buildWorkspaceGovernanceAttentionFeed,
  buildWorkspaceGovernancePosture,
  buildWorkspaceMemberAdministration,
  type WorkspaceGovernanceReadiness,
} from '@/lib/workspace-governance-posture';

/** Execution status for an action */
export type ActionExecutionStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';

/** Enhanced workspace snapshot with drill-down capability */
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
  /** Drill-down URL to workspace settings */
  drillDownUrl: string;
  /** Workspace risk category for sorting */
  riskCategory: 'critical' | 'high' | 'medium' | 'low';
}

/** Enhanced attention item with drill-down capability */
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
  /** Drill-down URL to the specific item (workspace/project/member settings) */
  drillDownUrl: string;
  /** Risk impact score for prioritization */
  impactScore: number;
}

/** Enhanced action item with execution tracking */
export interface OrganizationGovernanceActionItem {
  id: string;
  workspaceId: string;
  workspaceName: string;
  projectId?: string;
  memberId?: string;
  severity: WorkspaceGovernanceReadiness;
  actionType: 'investigate_project_risk' | 'review_member_scope' | 'review_workspace_posture';
  title: string;
  description: string;
  /** Drill-down URL to start the action */
  drillDownUrl: string;
  /** Current execution status */
  status: ActionExecutionStatus;
  /** Priority rank (lower = higher priority) */
  priority: number;
  /** Estimated effort in minutes */
  estimatedEffortMinutes: number;
  /** Execution timestamp tracking */
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Error message if status is 'failed' */
  error?: string;
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

/**
 * Build drill-down URL for workspace navigation
 */
function buildDrillDownUrl(baseUrl: string, workspaceId: string, projectId?: string, memberId?: string): string {
  const basePath = `${baseUrl}/workspaces/${workspaceId}`;

  if (projectId) {
    // Navigate to project runtime console for project-level investigation
    return `${basePath}/projects/${projectId}/runtime-console?tab=control`;
  }

  if (memberId) {
    // Navigate to workspace members for member review
    return `${basePath}/settings/members`;
  }

  // Navigate to workspace settings for workspace posture review
  return `${basePath}/settings`;
}

/**
 * Calculate risk category based on score and readiness
 */
function getRiskCategory(readiness: WorkspaceGovernanceReadiness, riskScore: number): 'critical' | 'high' | 'medium' | 'low' {
  if (readiness === 'blocked') return 'critical';
  if (readiness === 'warning') {
    if (riskScore >= 200) return 'high';
    return 'medium';
  }
  return 'low';
}

/**
 * Calculate impact score for prioritization
 */
function calculateImpactScore(readiness: WorkspaceGovernanceReadiness, riskScore: number): number {
  // Blocked items get highest priority (1000+)
  if (readiness === 'blocked') return 1000 + riskScore;
  // Warning items get medium priority (500+)
  if (readiness === 'warning') return 500 + riskScore;
  // Ready items get lowest priority
  return riskScore;
}

export function buildOrganizationGovernanceRollup(args: {
  workspaces: Workspace[];
  membersByWorkspaceId: Record<string, WorkspaceMember[]>;
  projectsByWorkspaceId: Record<string, Project[]>;
  locale?: string;
}): {
  summary: OrganizationGovernanceRollup;
  workspaceRanking: OrganizationWorkspaceGovernanceSnapshot[];
  attention: OrganizationGovernanceAttentionItem[];
  actionsQueue: OrganizationGovernanceActionItem[];
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
    const riskCategory = getRiskCategory(posture.readiness, riskScore);

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
      drillDownUrl: buildDrillDownUrl(baseUrl, workspace.id),
      riskCategory,
    });

    const workspaceAttention = buildWorkspaceGovernanceAttentionFeed({
      projects: posture.projects,
      members: memberAdmin,
    }).map<OrganizationGovernanceAttentionItem>((item) => {
      const impactScore = calculateImpactScore(item.severity, riskScore);
      const drillDownUrl = buildDrillDownUrl(baseUrl, workspace.id, item.projectId, item.memberId);

      return {
        id: `${workspace.id}:${item.id}`,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        severity: item.severity,
        kind: item.kind,
        title: item.title,
        description: item.description,
        projectId: item.projectId,
        memberId: item.memberId,
        drillDownUrl,
        impactScore,
      };
    });

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
    // Sort by risk category first (critical > high > medium > low)
    const categoryOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const categoryDiff = categoryOrder[left.riskCategory] - categoryOrder[right.riskCategory];
    if (categoryDiff !== 0) return categoryDiff;

    // Then by risk score (descending)
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

  const actionsQueue = attentionRanking.slice(0, 8).map<OrganizationGovernanceActionItem>((item, index) => {
    let actionType: OrganizationGovernanceActionItem['actionType'];
    if (item.kind === 'project') {
      actionType = 'investigate_project_risk';
    } else if (item.memberId) {
      actionType = 'review_member_scope';
    } else {
      actionType = 'review_workspace_posture';
    }

    return {
      id: `action:${item.id}`,
      workspaceId: item.workspaceId,
      workspaceName: item.workspaceName,
      projectId: item.projectId,
      memberId: item.memberId,
      severity: item.severity,
      actionType,
      title: item.title,
      description: item.description,
      drillDownUrl: item.drillDownUrl,
      status: 'pending' as ActionExecutionStatus,
      priority: index, // Lower index = higher priority
      estimatedEffortMinutes: estimateEffortMinutes(actionType, item.severity),
      createdAt: now,
    };
  });

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
    actionsQueue,
  };
}
