/**
 * Settings Page
 *
 * Project settings and configuration.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';

interface SettingsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function SettingsPage({ params }: SettingsPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
    locale: string;
  } | null>(null);
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
  const canReadSettings = useHasPermission('project:manage');
  const canManageSettings = useHasPermission('project:manage');
  const canDeleteProject = canManageSettings;

  const projectAPI = useMemo(() => new ProjectAPI(getApiClient()), []);

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        locale: p.locale,
      }),
    );
  }, [params]);

  // Fetch project data
  const { data: currentProject } = useProject(
    resolvedParams?.workspace ?? '',
    resolvedParams?.project ?? ''
  );

  useEffect(() => {
    if (currentProject) {
      setName(currentProject.name);
      setDescription(currentProject.description ?? '');
      setVisibility(currentProject.visibility || 'private');
      setJoinPolicy(currentProject.join_policy || 'approval_required');
    }
  }, [currentProject]);

  const handleSaveGeneral = async () => {
    if (!resolvedParams) return;
    if (!canManageSettings) return;
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



  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!resolvedParams.workspace || !resolvedParams.project) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadSettings) {
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
            className="[&>div>h1]:flex [&>div>h1]:items-center [&>div>h1]:gap-2"
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="action" size="sm" data-testid="settings__open-audit">
                  <Link href={`/${resolvedParams.locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/audit`}>
                    {settingsT('open_audit')}
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" data-testid="settings__open-members">
                  <Link href={`/${resolvedParams.locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/members`}>
                    {settingsT('open_members')}
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" data-testid="settings__open-credentials">
                  <Link href={`/${resolvedParams.locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/credentials`}>
                    {settingsT('open_credentials')}
                  </Link>
                </Button>
              </div>
            )}
          />
        )}
      >
        <div className="w-full space-y-6">
          <div className="rounded-xl border border-border bg-surface p-5 md:p-6" data-testid="settings__general-section">
            <h2 className="text-base font-semibold text-foreground mb-1">{settingsT('general_access_title')}</h2>
            <p className="text-sm text-tertiary mb-4">{settingsT('general_help')}</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('project_name')}</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canManageSettings}
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('visibility')}</label>
                <Select value={visibility} onValueChange={(value) => setVisibility(value as 'public' | 'private')} disabled={!canManageSettings}>
                  <SelectTrigger data-testid="settings__visibility-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">{projectT('public')}</SelectItem>
                    <SelectItem value="private">{projectT('private')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('description')}</label>
                <Textarea
                  placeholder="Add a description..."
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!canManageSettings}
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('join_policy')}</label>
                <Select value={joinPolicy} onValueChange={(value) => setJoinPolicy(value as 'approval_required' | 'open')} disabled={!canManageSettings}>
                  <SelectTrigger data-testid="settings__join-policy-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approval_required">{projectT('approval_required')}</SelectItem>
                    <SelectItem value="open">{projectT('open')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={handleSaveGeneral} disabled={!canManageSettings || savingGeneral} variant="primary" data-testid="settings__save-btn">
                <Save className="w-4 h-4" />
                {savingGeneral ? 'Saving...' : commonT('save')}
              </Button>
            </div>
          </div>

      <div className="mt-2 rounded-xl border border-subtle bg-surface-high border-l-2 border-l-error/70 p-6">
        <h2 className="font-semibold text-error mb-4">Danger Zone</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">Delete Project</div>
            <div className="text-sm text-tertiary">Permanently delete this project and all data</div>
          </div>
          <Button
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={!canDeleteProject}
            data-testid="settings__delete-project-btn"
          >
            Delete Project
          </Button>
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
