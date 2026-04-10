/**
 * Settings Page
 *
 * Project settings and configuration.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ProjectAPI, getApiClient } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useTranslations } from 'next-intl';
import { DeleteProjectDialog } from '@/components/projects/DeleteProjectDialog';
import { useApiError } from '@/lib/hooks/use-api-error';
import { useProject } from '@/lib/hooks/use-projects-queries';
import {
  useProjectSettingsCapabilities,
} from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { useWorkspaceMembers } from '@/lib/hooks/use-workspaces';
import { useMembers, useProjectGroups, useUpdateProjectGroup } from '@/lib/hooks/use-members';
import { GeneralSettingsSection } from './_components/GeneralSettingsSection';
import { ProjectAdminGroupSection } from './_components/ProjectAdminGroupSection';
import { ProjectOwnerSection } from './_components/ProjectOwnerSection';
import { PROJECT_BUILT_IN_GROUP_IDS } from '@/lib/governance/member-groups';
import type { SettingsProjectAdminOption } from './settings-page-types';

interface SettingsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function SettingsPage({ params }: SettingsPageProps) {
  const resolvedParams = useResolvedProjectRoute(params);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [joinPolicy, setJoinPolicy] = useState<'approval_required' | 'open'>('approval_required');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const router = useRouter();
  const commonT = useTranslations('common');
  const settingsT = useTranslations('settings');
  const projectT = useTranslations('project');
  const tErrors = useTranslations('errors');
  const { handleError } = useApiError();
  const queryClient = useQueryClient();
  const capabilities = useProjectSettingsCapabilities();

  const projectAPI = useMemo(() => new ProjectAPI(getApiClient()), []);

  // Fetch project data
  const { data: currentProject } = useProject(
    resolvedParams?.workspace ?? '',
    resolvedParams?.project ?? ''
  );
  const { data: workspaceMembers = [] } = useWorkspaceMembers(resolvedParams?.workspace ?? '');
  const { data: projectMembers = [] } = useMembers(
    resolvedParams?.workspace ?? '',
    resolvedParams?.project ?? ''
  );
  const { data: projectGroups = [] } = useProjectGroups(
    resolvedParams?.workspace ?? '',
    resolvedParams?.project ?? '',
  );
  const updateProjectGroup = useUpdateProjectGroup(
    resolvedParams?.workspace ?? '',
    resolvedParams?.project ?? '',
  );
  const [selectedProjectAdmins, setSelectedProjectAdmins] = useState<string[]>([]);
  const [savingProjectAdmins, setSavingProjectAdmins] = useState(false);
  const [selectedProjectOwner, setSelectedProjectOwner] = useState('');
  const [savingProjectOwner, setSavingProjectOwner] = useState(false);

  useEffect(() => {
    if (currentProject) {
      const adminGroup = projectGroups.find((group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.admins);
      const nextAdminIds = adminGroup?.member_ids ?? [];
      setName((current) => (current === currentProject.name ? current : currentProject.name));
      setDescription((current) => (current === (currentProject.description ?? '') ? current : (currentProject.description ?? '')));
      setVisibility((current) => (current === (currentProject.visibility || 'private') ? current : (currentProject.visibility || 'private')));
      setJoinPolicy((current) => (
        current === (currentProject.join_policy || 'approval_required')
          ? current
          : (currentProject.join_policy || 'approval_required')
      ));
      setSelectedProjectAdmins((current) => {
        if (
          current.length === nextAdminIds.length
          && current.every((value, index) => value === nextAdminIds[index])
        ) {
          return current;
        }
        return [...nextAdminIds];
      });
      setSelectedProjectOwner((current) => (current === currentProject.owner_id ? current : currentProject.owner_id));
    }
  }, [currentProject, projectGroups]);

  const selectableProjectAdminMembers = useMemo<SettingsProjectAdminOption[]>(() => {
    const merged = new Map<string, SettingsProjectAdminOption>();

    for (const member of workspaceMembers) {
      merged.set(member.user_id, {
        id: member.id,
        user_id: member.user_id,
        name: member.name || member.email || member.user_id,
        email: member.email || member.user_id,
      });
    }

    for (const member of projectMembers) {
      if (!merged.has(member.id)) {
        merged.set(member.id, {
          id: member.id,
          user_id: member.id,
          name: member.name || member.email || member.id,
          email: member.email || member.id,
        });
      }
    }

    for (const userId of selectedProjectAdmins) {
      if (!merged.has(userId)) {
        merged.set(userId, {
          id: userId,
          user_id: userId,
          name: userId,
          email: userId,
        });
      }
    }

    return [...merged.values()];
  }, [projectMembers, selectedProjectAdmins, workspaceMembers]);

  const canManageProjectLifecycle = capabilities.canManageProjectLifecycle;
  const canDeleteProject = capabilities.canManageProjectLifecycle;
  const canAssignProjectAdmins = capabilities.canManageProjectAdmins;
  const canTransferProjectOwner = capabilities.canManageProjectLifecycle;
  const projectAdminCount = selectedProjectAdmins.length;
  const membersHref = resolvedParams
    ? `/${resolvedParams.locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/members?member_tab=requests`
    : '#';
  const ownerDisplayName = useMemo(() => {
    const ownerId = selectedProjectOwner || currentProject?.owner_id || '';
    const fromWorkspace = workspaceMembers.find((member) => member.user_id === ownerId);
    return fromWorkspace?.name || fromWorkspace?.email || ownerId;
  }, [currentProject?.owner_id, selectedProjectOwner, workspaceMembers]);
  const visibilityLabel = visibility === 'public'
    ? settingsT('visibility_public')
    : settingsT('visibility_private');
  const joinPolicyLabel = joinPolicy === 'approval_required'
    ? settingsT('join_policy_approval_required')
    : settingsT('join_policy_open');

  const handleProjectAdminCheckedChange = (userId: string, checked: boolean) => {
    setSelectedProjectAdmins((current) => {
      if (checked) return current.includes(userId) ? current : [...current, userId];
      return current.filter((value) => value !== userId);
    });
  };

  const handleSaveProjectAdmins = async () => {
    if (!resolvedParams || !currentProject || !canAssignProjectAdmins) return;
    setSavingProjectAdmins(true);
    try {
      await updateProjectGroup.mutateAsync({
        groupId: PROJECT_BUILT_IN_GROUP_IDS.admins,
        data: { member_ids: selectedProjectAdmins },
      });
      queryClient.invalidateQueries({
        queryKey: ['workspaces', resolvedParams.workspace, 'projects', resolvedParams.project],
      });
      queryClient.invalidateQueries({
        queryKey: ['workspaces', resolvedParams.workspace, 'projects'],
      });
      queryClient.invalidateQueries({
        queryKey: ['project-groups', resolvedParams.workspace, resolvedParams.project],
      });
      queryClient.invalidateQueries({
        queryKey: ['members', resolvedParams.workspace, resolvedParams.project],
      });
      toast.success(commonT('refreshed_data'));
    } catch (error) {
      handleError(error, { context: settingsT('admin_group_title') });
    } finally {
      setSavingProjectAdmins(false);
    }
  };

  const handleSaveProjectOwner = async () => {
    if (!resolvedParams || !currentProject || !canTransferProjectOwner) return;
    const nextOwnerId = selectedProjectOwner.trim();
    if (!nextOwnerId || nextOwnerId === currentProject.owner_id) return;
    setSavingProjectOwner(true);
    try {
      await projectAPI.update(resolvedParams.workspace!, resolvedParams.project!, {
        owner_id: nextOwnerId,
      });
      queryClient.invalidateQueries({
        queryKey: ['workspaces', resolvedParams.workspace, 'projects', resolvedParams.project],
      });
      queryClient.invalidateQueries({
        queryKey: ['workspaces', resolvedParams.workspace, 'projects'],
      });
      toast.success(commonT('refreshed_data'));
      router.push(`/${resolvedParams.locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/overview`);
    } catch (error) {
      handleError(error, { context: settingsT('project_owner_title') });
    } finally {
      setSavingProjectOwner(false);
    }
  };

  const handleSaveGeneral = async () => {
    if (!resolvedParams) return;
    if (!canManageProjectLifecycle) return;
    if (!resolvedParams.workspace || !resolvedParams.project) return;
    setSavingGeneral(true);
    try {
      await projectAPI.update(resolvedParams.workspace, resolvedParams.project, {
        name: name.trim(),
        description: description.trim() || undefined,
        visibility,
        join_policy: joinPolicy,
      });
      // Invalidate and refetch project data
      queryClient.invalidateQueries({
        queryKey: ['workspaces', resolvedParams.workspace, 'projects', resolvedParams.project],
      });
      queryClient.invalidateQueries({
        queryKey: ['workspaces', resolvedParams.workspace, 'projects'],
      });
      toast.success(commonT('refreshed_data'));
    } catch (error) {
      handleError(error, { context: settingsT('tab_general') });
    } finally {
      setSavingGeneral(false);
    }
  };



  if (!resolvedParams.isReady) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!resolvedParams.isValid || !resolvedParams.workspace || !resolvedParams.project) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!capabilities.canReadSettings) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  if (!currentProject) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={settingsT('title')}
            subtitle={settingsT('subtitle')}
            variant="compact"
            className="[&>div>h1]:flex [&>div>h1]:items-center [&>div>h1]:gap-2"
          />
        )}
      >
        <div className="w-full space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
              {visibilityLabel}
            </div>
            <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
              {settingsT('join_policy')}: {joinPolicyLabel}
            </div>
            <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
              {settingsT('admin_group_title')}: {projectAdminCount}
            </div>
            <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
              {settingsT('workspace_project_owner_label')}: {ownerDisplayName}
            </div>
          </div>

          <div className="rounded-[22px] border border-subtle bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)] md:p-6 space-y-6" data-testid="settings__ownership-section">
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">{settingsT('ownership_lifecycle_title')}</h2>
              <p className="text-sm text-tertiary">
                {canManageProjectLifecycle ? settingsT('ownership_lifecycle_help') : settingsT('ownership_lifecycle_read_only_help')}
              </p>
            </div>

            <GeneralSettingsSection
              canManageProjectLifecycle={canManageProjectLifecycle}
              commonT={commonT}
              description={description}
              joinPolicy={joinPolicy}
              name={name}
              projectT={projectT}
              savingGeneral={savingGeneral}
              settingsT={settingsT}
              visibility={visibility}
              onDescriptionChange={setDescription}
              onJoinPolicyChange={setJoinPolicy}
              onNameChange={setName}
              onSave={handleSaveGeneral}
              onVisibilityChange={setVisibility}
            />

          <ProjectAdminGroupSection
              canAssignProjectAdmins={canAssignProjectAdmins}
              savingProjectAdmins={savingProjectAdmins}
              selectedProjectAdmins={selectedProjectAdmins}
              settingsT={settingsT}
              workspaceMembers={selectableProjectAdminMembers}
              membersHref={membersHref}
              onCheckedChange={handleProjectAdminCheckedChange}
              onSave={handleSaveProjectAdmins}
            />

            <ProjectOwnerSection
              canTransferProjectOwner={canTransferProjectOwner}
              currentProject={currentProject}
              savingProjectOwner={savingProjectOwner}
              selectedProjectOwner={selectedProjectOwner}
              settingsT={settingsT}
              workspaceMembers={workspaceMembers}
              onOwnerChange={setSelectedProjectOwner}
              onSave={handleSaveProjectOwner}
            />

            <div className="rounded-[18px] border border-error/20 bg-error/5 p-4">
              <h3 className="text-sm font-semibold text-error mb-3">{settingsT('danger_zone_title')}</h3>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-foreground">{settingsT('delete_project_title')}</div>
                  <div className="text-sm text-tertiary">
                    {canDeleteProject ? settingsT('delete_project_help') : settingsT('delete_project_owner_only')}
                  </div>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={!canDeleteProject}
                  data-testid="settings__delete-project-btn"
                >
                  {settingsT('delete_project_action')}
                </Button>
              </div>
            </div>
          </div>

      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        project={currentProject ? {
          id: currentProject.id,
          workspace_id: currentProject.workspace_id,
          name: currentProject.name,
          description: currentProject.description,
          visibility: currentProject.visibility,
          owner_id: currentProject.owner_id,
          status: currentProject.status,
          admin_member_ids: currentProject.admin_member_ids,
          groups: currentProject.groups,
          permissions: currentProject.permissions,
          membership_status: currentProject.membership_status,
          created_at: currentProject.created_at,
          updated_at: currentProject.updated_at,
        } : null}
        workspaceId={resolvedParams?.workspace || ''}
        onDeleted={() => {
          queryClient.invalidateQueries({
            queryKey: ['workspaces', resolvedParams?.workspace, 'projects'],
          });
          router.push(`/${resolvedParams?.locale || 'en-US'}/workspaces/${resolvedParams?.workspace}/projects`);
        }}
        deleteProject={(wsId, projectId) => projectAPI.delete(wsId, projectId)}
      />
        </div>
      </PageLayout>
    </PageState>
  );
}
