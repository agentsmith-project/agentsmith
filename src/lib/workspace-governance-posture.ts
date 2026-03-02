import type { Project, WorkspaceMember } from '@/lib/api/types';

export type WorkspaceGovernanceReadiness = 'ready' | 'warning' | 'blocked';

export type WorkspaceProjectRiskCode =
  | 'public_open_access'
  | 'public_visibility'
  | 'open_join_policy'
  | 'missing_source_library_quota'
  | 'archived_project';

export interface WorkspaceProjectGovernancePosture {
  projectId: string;
  name: string;
  readiness: WorkspaceGovernanceReadiness | 'info';
  status: Project['status'];
  visibility: Project['visibility'];
  joinPolicy: Project['join_policy'] | 'approval_required';
  adminSummary: string;
  sourceLibraryMaxTotalFiles?: number;
  sourceLibraryMaxFileSizeBytes?: number;
  riskCodes: WorkspaceProjectRiskCode[];
}

export interface WorkspaceGovernancePostureSummary {
  totalMembers: number;
  activeMembers: number;
  wheelMembers: number;
  totalProjects: number;
  activeProjects: number;
  riskyProjects: number;
  publicProjects: number;
  openJoinProjects: number;
}

export interface WorkspaceGovernancePosture {
  readiness: WorkspaceGovernanceReadiness;
  summary: WorkspaceGovernancePostureSummary;
  projects: WorkspaceProjectGovernancePosture[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getSourceLibraryQuota(project: Project, key: 'max_total_files' | 'max_file_size_bytes'): number | undefined {
  const governance = asRecord(project.governance_json);
  const governanceQuotas = asRecord(governance?.quotas);
  const governanceSourceLibrary = asRecord(governanceQuotas?.source_library);
  const limits = asRecord(project.limits_json);
  const limitsSourceLibrary = asRecord(limits?.source_library);

  const value = governanceSourceLibrary?.[key] ?? limitsSourceLibrary?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function buildWorkspaceGovernancePosture(args: {
  members: WorkspaceMember[];
  projects: Project[];
  adminSummaryByProjectId?: Map<string, string>;
}): WorkspaceGovernancePosture {
  const { members, projects, adminSummaryByProjectId } = args;

  const activeMembers = members.filter((member) => member.status === 'active');
  const wheelMembers = activeMembers.filter((member) => member.governance_group === 'wheel');
  const activeProjects = projects.filter((project) => project.status === 'active');
  const publicProjects = activeProjects.filter((project) => project.visibility === 'public');
  const openJoinProjects = activeProjects.filter((project) => (project.join_policy ?? 'approval_required') === 'open');

  const projectPosture = projects
    .map<WorkspaceProjectGovernancePosture>((project) => {
      const riskCodes: WorkspaceProjectRiskCode[] = [];
      const joinPolicy = project.join_policy ?? 'approval_required';
      const sourceLibraryMaxTotalFiles = getSourceLibraryQuota(project, 'max_total_files');
      const sourceLibraryMaxFileSizeBytes = getSourceLibraryQuota(project, 'max_file_size_bytes');

      if (project.status !== 'active') {
        riskCodes.push('archived_project');
      } else {
        if (project.visibility === 'public' && joinPolicy === 'open') {
          riskCodes.push('public_open_access');
        } else {
          if (project.visibility === 'public') {
            riskCodes.push('public_visibility');
          }
          if (joinPolicy === 'open') {
            riskCodes.push('open_join_policy');
          }
        }
        if (sourceLibraryMaxTotalFiles === undefined || sourceLibraryMaxFileSizeBytes === undefined) {
          riskCodes.push('missing_source_library_quota');
        }
      }

      const readiness: WorkspaceProjectGovernancePosture['readiness'] = riskCodes.includes('public_open_access')
        ? 'blocked'
        : riskCodes.some((code) => code !== 'archived_project')
          ? 'warning'
          : project.status === 'active'
            ? 'ready'
            : 'info';

      return {
        projectId: project.id,
        name: project.name,
        readiness,
        status: project.status,
        visibility: project.visibility,
        joinPolicy,
        adminSummary: adminSummaryByProjectId?.get(project.id) ?? project.owner_id,
        sourceLibraryMaxTotalFiles,
        sourceLibraryMaxFileSizeBytes,
        riskCodes,
      };
    })
    .sort((left, right) => {
      const rank = (readiness: WorkspaceProjectGovernancePosture['readiness']) => {
        switch (readiness) {
          case 'blocked':
            return 0;
          case 'warning':
            return 1;
          case 'ready':
            return 2;
          default:
            return 3;
        }
      };
      return rank(left.readiness) - rank(right.readiness) || left.name.localeCompare(right.name);
    });

  const readiness: WorkspaceGovernanceReadiness = projectPosture.some((project) => project.readiness === 'blocked')
    ? 'blocked'
    : projectPosture.some((project) => project.readiness === 'warning')
      ? 'warning'
      : 'ready';

  return {
    readiness,
    summary: {
      totalMembers: members.length,
      activeMembers: activeMembers.length,
      wheelMembers: wheelMembers.length,
      totalProjects: projects.length,
      activeProjects: activeProjects.length,
      riskyProjects: projectPosture.filter((project) => project.readiness === 'blocked' || project.readiness === 'warning').length,
      publicProjects: publicProjects.length,
      openJoinProjects: openJoinProjects.length,
    },
    projects: projectPosture,
  };
}
