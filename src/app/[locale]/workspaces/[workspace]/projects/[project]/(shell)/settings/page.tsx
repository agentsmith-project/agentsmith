/**
 * Settings Page
 *
 * Project settings and configuration.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Settings as SettingsIcon, Save } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ProjectAPI, getApiClient } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useTranslations } from 'next-intl';
import { DeleteProjectDialog } from '@/components/projects/DeleteProjectDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RuntimePreferencesEditor, type RuntimePreferences } from '@/components/settings/RuntimePreferencesEditor';
import { SettingsTokenReference } from '@/components/settings/SettingsTokenReference';
import { useApiError } from '@/lib/hooks/use-api-error';
import { RUNTIME_PREFERENCES_TOKENS } from '@/components/settings/settingsTokenRefs';
import { useProject } from '@/lib/hooks/use-projects-queries';
import {
  useCanReadProjectPolicy,
  useCanUpdateProjectPolicy,
  useHasPermission,
} from '@/lib/hooks/use-permissions';
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
  const [savingRuntime, setSavingRuntime] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [joinPolicy, setJoinPolicy] = useState<'approval_required' | 'open'>('approval_required');
  const [runtimePreferences, setRuntimePreferences] = useState<RuntimePreferences>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const router = useRouter();
  const commonT = useTranslations('common');
  const settingsT = useTranslations('settings');
  const tErrors = useTranslations('errors');
  const { handleError } = useApiError();
  const queryClient = useQueryClient();
  const canReadSettings = useCanReadProjectPolicy();
  const canManageSettings = useCanUpdateProjectPolicy();
  const canDeleteProject = useHasPermission('project:delete');

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
      setRuntimePreferences((currentProject.runtime_preferences_json as RuntimePreferences) ?? {});
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

  const handleSaveRuntimePrefs = async () => {
    if (!resolvedParams) return;
    if (!canManageSettings) return;
    if (!resolvedParams.workspace || !resolvedParams.project) return;
    setSavingRuntime(true);
    try {
      await projectAPI.update(resolvedParams.workspace, resolvedParams.project, {
        runtime_preferences_json: runtimePreferences as Record<string, unknown>,
      });
      toast.success(commonT('refreshed_data'));
    } catch (error) {
      handleError(error, { context: settingsT('tab_runtime_preferences') });
    } finally {
      setSavingRuntime(false);
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
      <PageLayout>
        <div className="p-6 max-w-6xl mx-auto w-full space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold text-foreground flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-icon-default" />
          {settingsT('title')}
        </h1>
        <p className="text-sm text-tertiary">{settingsT('subtitle')}</p>
      </header>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList>
          <TabsTrigger value="general" data-testid="settings__tab--general">{settingsT('tab_general')}</TabsTrigger>
          <TabsTrigger value="runtime" data-testid="settings__tab--runtime">{settingsT('tab_runtime_preferences')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <div className="rounded-xl border border-border bg-surface p-6">
            <h2 className="text-base font-semibold text-foreground mb-1">{settingsT('general_access_title')}</h2>
            <p className="text-sm text-tertiary mb-4">{settingsT('general_help')}</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('project_name')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canManageSettings}
                  className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('visibility')}</label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                  disabled={!canManageSettings}
                  className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('description')}</label>
                <textarea
                  placeholder="Add a description..."
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!canManageSettings}
                  className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('join_policy')}</label>
                <select
                  value={joinPolicy}
                  onChange={(e) => setJoinPolicy(e.target.value as 'approval_required' | 'open')}
                  disabled={!canManageSettings}
                  className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="approval_required">Approval Required</option>
                  <option value="open">Open</option>
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={handleSaveGeneral} disabled={!canManageSettings || savingGeneral} variant="action" size="lg" data-testid="settings__save-btn">
                <Save className="w-4 h-4" />
                {savingGeneral ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="runtime" className="space-y-6">
          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">{settingsT('runtime_preferences_title')}</h2>
              <p className="text-sm text-tertiary">{settingsT('runtime_help')}</p>
            </div>
            <SettingsTokenReference tokens={RUNTIME_PREFERENCES_TOKENS} />
            <RuntimePreferencesEditor
              value={runtimePreferences}
              onChange={setRuntimePreferences}
              disabled={!canManageSettings}
            />
            <div className="mt-4 flex justify-end">
              <Button onClick={handleSaveRuntimePrefs} disabled={!canManageSettings || savingRuntime} variant="action" size="lg" data-testid="settings__save-btn">
                <Save className="w-4 h-4" />
                {savingRuntime ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

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
          role: 'owner',
          permissions: ['project:*'],
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
