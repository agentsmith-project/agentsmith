'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Settings as SettingsIcon } from 'lucide-react';
import { Topbar } from '@/components/app-shell/Topbar';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { SectionHeading } from '@/components/ui/section-heading';
import { StatusBadge } from '@/components/ui/status-badge';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { useWorkspace, useWorkspaceMembers } from '@/lib/hooks/use-workspaces';
import { useProjects } from '@/lib/hooks/use-projects-queries';
import { useWorkspaceGovernance } from '@/lib/hooks/use-workspace-governance';
import { buildProjectAdminSummary } from '@/lib/projects/project-view';
import {
  buildWorkspaceGovernancePosture,
  buildWorkspaceMemberAdministration,
} from '@/lib/workspace-governance-posture';
import { formatBytes } from '@/lib/utils/formatters';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

function formatWorkspaceGroupAlias(groupAlias: string): string {
  switch (groupAlias) {
    case 'owner':
      return 'governance';
    case 'admin':
      return 'manager';
    case 'developer':
      return 'operator';
    case 'user':
      return 'member';
    default:
      return groupAlias;
  }
}

export default function WorkspaceSettingsPage() {
  const params = useParams();
  const t = useTranslations('settings');
  const tErrors = useTranslations('errors');
  const tProjects = useTranslations('projects');
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const canReadWorkspace = useHasWorkspacePermission('workspace:read');
  const canManageGovernance = useHasWorkspacePermission('workspace:governance:update');
  const { data: currentWorkspace } = useWorkspace(workspaceId ?? '');
  const { data: members = [] } = useWorkspaceMembers(workspaceId ?? '');
  const { data: projects = [] } = useProjects(workspaceId ?? '');
  const { getMemberGovernanceGroup, updateMemberGovernanceGroup, isUpdating } = useWorkspaceGovernance(workspaceId ?? '');
  useSyncAuthFromUrl();
  const memberNameById = React.useMemo(
    () => new Map(members.map((member) => [member.user_id, member.name])),
    [members],
  );
  const adminSummaryByProjectId = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      map.set(project.id, buildProjectAdminSummary(project, memberNameById));
    }
    return map;
  }, [memberNameById, projects]);
  const governancePosture = React.useMemo(
    () => buildWorkspaceGovernancePosture({ members, projects, adminSummaryByProjectId }),
    [adminSummaryByProjectId, members, projects],
  );
  const memberAdministration = React.useMemo(
    () => buildWorkspaceMemberAdministration({ members, projects }),
    [members, projects],
  );

  if (!workspaceId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadWorkspace) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  const workspace = currentWorkspace || { id: workspaceId, name: workspaceId };

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          <Topbar />

          <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-4 md:px-5 md:py-5">
            <div className="mb-5">
              <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
                <SettingsIcon className="w-6 h-6 text-icon-default" />
                {t('workspace_title')}
              </h1>
              <p className="text-tertiary">{t('workspace_subtitle')}</p>
            </div>

            <div className="p-5 rounded-xl border border-border bg-surface">
              <h2 className="font-semibold text-foreground mb-4">{t('workspace_general')}</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">{t('workspace_name')}</label>
                  <p className="text-primary" data-testid="ws-settings__name">{workspace.name}</p>
                </div>
              </div>
            </div>

            <div className="mt-5 p-5 rounded-xl border border-border bg-surface" data-testid="ws-settings__governance-overview">
              <SectionHeading
                eyebrow={t('workspace_governance_eyebrow')}
                title={t('workspace_governance_title')}
                subtitle={t('workspace_governance_subtitle')}
                actions={(
                  <StatusBadge status={governancePosture.readiness}>
                    {t(`workspace_governance_status_${governancePosture.readiness}`)}
                  </StatusBadge>
                )}
              />

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_governance_summary_active_members')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{governancePosture.summary.activeMembers}</div>
                  <div className="mt-1 text-xs text-tertiary">
                    {t('workspace_governance_summary_wheel_members', { count: governancePosture.summary.wheelMembers })}
                  </div>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_governance_summary_active_projects')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{governancePosture.summary.activeProjects}</div>
                  <div className="mt-1 text-xs text-tertiary">
                    {t('workspace_governance_summary_total_projects', { count: governancePosture.summary.totalProjects })}
                  </div>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_governance_summary_exposed_projects')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{governancePosture.summary.publicProjects}</div>
                  <div className="mt-1 text-xs text-tertiary">
                    {t('workspace_governance_summary_open_join_projects', { count: governancePosture.summary.openJoinProjects })}
                  </div>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_governance_summary_attention_projects')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{governancePosture.summary.riskyProjects}</div>
                  <div className="mt-1 text-xs text-tertiary">
                    {t(`workspace_governance_status_${governancePosture.readiness}`)}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 p-5 rounded-xl border border-border bg-surface" data-testid="ws-settings__project-posture">
              <SectionHeading
                eyebrow={t('workspace_projects_eyebrow')}
                title={t('workspace_projects_title')}
                subtitle={t('workspace_projects_subtitle')}
              />
              {governancePosture.projects.length === 0 ? (
                <p className="mt-4 text-sm text-tertiary">{t('workspace_projects_empty')}</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {governancePosture.projects.map((project) => (
                    <div
                      key={project.projectId}
                      className="rounded-lg border border-subtle bg-bg-base/20 p-4"
                      data-testid={`ws-settings__project-posture--${project.projectId}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{project.name}</p>
                            <StatusBadge status={project.readiness === 'info' ? 'info' : project.readiness}>
                              {project.readiness === 'info'
                                ? t('workspace_projects_status_info')
                                : t(`workspace_governance_status_${project.readiness}`)}
                            </StatusBadge>
                          </div>
                          <p className="mt-1 text-xs text-tertiary">
                            {t('workspace_projects_meta', {
                              visibility: tProjects(`visibility.${project.visibility}`),
                              joinPolicy: tProjects(project.joinPolicy),
                              status: project.status,
                            })}
                          </p>
                        </div>
                        <div className="text-right text-xs text-tertiary">
                          <div>{t('workspace_projects_admin_summary')}</div>
                          <div className="mt-1 text-sm text-foreground">{project.adminSummary}</div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {project.riskCodes.map((riskCode) => (
                          <StatusBadge
                            key={riskCode}
                            status={riskCode === 'public_open_access' ? 'blocked' : riskCode === 'archived_project' ? 'info' : 'warning'}
                          >
                            {t(`workspace_projects_risk_${riskCode}`)}
                          </StatusBadge>
                        ))}
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-subtle bg-bg-base/10 p-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_projects_quota_total_files')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">
                            {project.sourceLibraryMaxTotalFiles?.toLocaleString() ?? t('workspace_projects_quota_missing')}
                          </div>
                        </div>
                        <div className="rounded-lg border border-subtle bg-bg-base/10 p-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_projects_quota_max_file_size')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">
                            {project.sourceLibraryMaxFileSizeBytes !== undefined
                              ? formatBytes(project.sourceLibraryMaxFileSizeBytes)
                              : t('workspace_projects_quota_missing')}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 p-5 rounded-xl border border-border bg-surface" data-testid="ws-settings__members">
              <SectionHeading
                eyebrow={t('workspace_members_eyebrow')}
                title={t('workspace_members')}
                subtitle={t('workspace_members_subtitle')}
              />
              {members.length === 0 ? (
                <p className="mt-4 text-tertiary text-sm">{t('workspace_members_empty')}</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {members.map((member) => (
                    <div key={member.id} className="flex items-center justify-between rounded-md border border-subtle bg-surface-high px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm text-primary truncate">{member.name}</p>
                        <p className="text-xs text-tertiary truncate">{member.email}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-tertiary">group: {formatWorkspaceGroupAlias(member.role)}</span>
                        <select
                          data-testid={`ws-settings__governance--${member.id}`}
                          value={getMemberGovernanceGroup(member)}
                          onChange={(event) => {
                            void updateMemberGovernanceGroup(member.id, event.target.value as 'wheel' | 'user');
                          }}
                          disabled={!canManageGovernance || isUpdating}
                          className="h-8 min-w-24 rounded-sm border border-subtle bg-surface px-2 text-xs text-primary disabled:opacity-50"
                        >
                          <option value="wheel">{t('workspace_governance_wheel')}</option>
                          <option value="user">{t('workspace_governance_user')}</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 p-5 rounded-xl border border-border bg-surface" data-testid="ws-settings__member-administration">
              <SectionHeading
                eyebrow={t('workspace_member_admin_eyebrow')}
                title={t('workspace_member_admin_title')}
                subtitle={t('workspace_member_admin_subtitle')}
              />
              {memberAdministration.length === 0 ? (
                <p className="mt-4 text-sm text-tertiary">{t('workspace_members_empty')}</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {memberAdministration.map((member) => (
                    <div
                      key={member.memberId}
                      className="rounded-lg border border-subtle bg-bg-base/20 p-4"
                      data-testid={`ws-settings__member-administration--${member.memberId}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{member.name}</p>
                            <StatusBadge status={member.readiness === 'info' ? 'info' : member.readiness}>
                              {member.readiness === 'info'
                                ? t('workspace_member_admin_status_info')
                                : t(`workspace_governance_status_${member.readiness}`)}
                            </StatusBadge>
                            <StatusBadge status={member.status === 'active' ? 'ready' : 'info'}>
                              {t(`workspace_member_admin_membership_${member.status}`)}
                            </StatusBadge>
                          </div>
                          <p className="mt-1 text-xs text-tertiary">{member.email}</p>
                        </div>
                        <div className="text-right text-xs text-tertiary">
                          <div>{t('workspace_member_admin_governance_group')}</div>
                          <div className="mt-1 text-sm text-foreground">
                            {member.governanceGroup === 'wheel'
                              ? t('workspace_governance_wheel')
                              : t('workspace_governance_user')}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <div className="rounded-lg border border-subtle bg-bg-base/10 p-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_member_admin_owned_projects')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{member.ownedProjects}</div>
                        </div>
                        <div className="rounded-lg border border-subtle bg-bg-base/10 p-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_member_admin_admin_projects')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{member.administeredProjects}</div>
                        </div>
                        <div className="rounded-lg border border-subtle bg-bg-base/10 p-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_member_admin_exposed_projects')}</div>
                          <div className="mt-1 text-sm font-medium text-foreground">{member.exposedProjects}</div>
                        </div>
                      </div>

                      {member.riskCodes.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {member.riskCodes.map((riskCode) => (
                            <StatusBadge
                              key={riskCode}
                              status={riskCode === 'removed_member_with_project_scope' ? 'blocked' : 'warning'}
                            >
                              {t(`workspace_member_admin_risk_${riskCode}`)}
                            </StatusBadge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
