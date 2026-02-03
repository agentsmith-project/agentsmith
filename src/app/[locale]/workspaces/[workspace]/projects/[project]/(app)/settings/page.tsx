/**
 * Settings Page
 *
 * Project settings and configuration.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Settings as SettingsIcon, Save } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { Button } from '@/components/ui/button';
import { ProjectAPI, getApiClient } from '@/lib/api';
import { handleErrorForToast } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { useTranslations } from 'next-intl';
import { DeleteProjectDialog } from '@/components/projects/DeleteProjectDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RuntimePreferencesEditor, type RuntimePreferences } from '@/components/settings/RuntimePreferencesEditor';
import { GovernanceEditor, type GovernanceJson } from '@/components/settings/GovernanceEditor';
import { LimitsEditor, type LimitsJson } from '@/components/settings/LimitsEditor';
import { SettingsTokenReference } from '@/components/settings/SettingsTokenReference';
import {
  RUNTIME_PREFERENCES_TOKENS,
  GOVERNANCE_TOKENS,
  LIMITS_TOKENS,
} from '@/components/settings/settingsTokenRefs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface SettingsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function SettingsPage({ params }: SettingsPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{
    workspace: string;
    project: string;
    locale: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [joinPolicy, setJoinPolicy] = useState<'approval_required' | 'open'>('approval_required');
  const [runtimePreferences, setRuntimePreferences] = useState<RuntimePreferences>({});
  const [governance, setGovernance] = useState<GovernanceJson>({});
  const [limits, setLimits] = useState<LimitsJson>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [governanceConfirmOpen, setGovernanceConfirmOpen] = useState(false);
  const router = useRouter();
  const currentProject = useAuthStore((state) => state.currentProject);
  const setProject = useAuthStore((state) => state.setProject);
  const clearProject = useAuthStore((state) => state.clearProject);
  const projects = useAuthStore((state) => state.projects);
  const setProjects = useAuthStore((state) => state.setProjects);
  const commonT = useTranslations('common');
  const settingsT = useTranslations('settings');

  const projectAPI = useMemo(() => new ProjectAPI(getApiClient()), []);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project, locale: p.locale }));
  }, [params]);

  useEffect(() => {
    if (currentProject) {
      setName(currentProject.name);
      setVisibility(currentProject.visibility || 'private');
      setJoinPolicy('approval_required');
    }
  }, [currentProject]);

  useEffect(() => {
    if (!resolvedParams) return;
    const load = async () => {
      try {
        const p = await projectAPI.get(resolvedParams.workspace, resolvedParams.project);
        setName(p.name ?? '');
        setDescription(p.description ?? '');
        setVisibility((p.visibility as 'public' | 'private') ?? 'private');
        setJoinPolicy((p.join_policy as 'approval_required' | 'open') ?? 'approval_required');
        setRuntimePreferences((p.runtime_preferences_json as RuntimePreferences) ?? {});
        setGovernance((p.governance_json as GovernanceJson) ?? {});
        setLimits((p.limits_json as LimitsJson) ?? {});
      } catch {
        // Use auth store defaults
      }
    };
    load();
  }, [resolvedParams, projectAPI]);

  const handleSaveGeneral = async () => {
    if (!resolvedParams || !currentProject) return;
    setSaving(true);
    try {
      const updated = await projectAPI.update(resolvedParams.workspace, resolvedParams.project, {
        name: name.trim(),
        description: description.trim() || undefined,
        visibility,
        join_policy: joinPolicy,
      });
      setProject({
        ...currentProject,
        name: updated.name,
        visibility: updated.visibility,
      });
      setProjects(
        projects.map((p) =>
          p.id === currentProject.id ? { ...p, name: updated.name, visibility: updated.visibility } : p
        )
      );
      toast.success(commonT('refreshed_data'));
    } catch (error) {
      handleErrorForToast(error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRuntimePrefs = async () => {
    if (!resolvedParams) return;
    setSaving(true);
    try {
      await projectAPI.update(resolvedParams.workspace, resolvedParams.project, {
        runtime_preferences_json: runtimePreferences as Record<string, unknown>,
      });
      toast.success(commonT('refreshed_data'));
    } catch (error) {
      handleErrorForToast(error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGovernanceClick = () => {
    setGovernanceConfirmOpen(true);
  };

  const handleSaveGovernanceConfirm = async () => {
    if (!resolvedParams) return;
    setGovernanceConfirmOpen(false);
    setSaving(true);
    try {
      await projectAPI.update(resolvedParams.workspace, resolvedParams.project, {
        governance_json: governance as Record<string, unknown>,
      });
      toast.success(commonT('refreshed_data'));
    } catch (error) {
      handleErrorForToast(error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLimits = async () => {
    if (!resolvedParams) return;
    setSaving(true);
    try {
      await projectAPI.update(resolvedParams.workspace, resolvedParams.project, {
        limits_json: limits as Record<string, unknown>,
      });
      toast.success(commonT('refreshed_data'));
    } catch (error) {
      handleErrorForToast(error);
    } finally {
      setSaving(false);
    }
  };

  if (!resolvedParams || !currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-tertiary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-icon-default" />
          {settingsT('title')}
        </h1>
        <p className="mt-1 text-sm text-tertiary">{settingsT('subtitle')}</p>
      </header>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList>
          <TabsTrigger value="general">{settingsT('tab_general')}</TabsTrigger>
          <TabsTrigger value="runtime">{settingsT('tab_runtime_preferences')}</TabsTrigger>
          <TabsTrigger value="governance">{settingsT('tab_governance')}</TabsTrigger>
          <TabsTrigger value="limits">{settingsT('tab_limits')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <div className="rounded-xl border border-border bg-surface p-6">
            <h2 className="text-base font-semibold text-foreground mb-1">{settingsT('general_access_title')}</h2>
            <p className="text-sm text-tertiary mb-4">{settingsT('general_help')}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('project_name')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('description')}</label>
                <textarea
                  placeholder="Add a description..."
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('visibility')}</label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                  className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-primary mb-2">{settingsT('join_policy')}</label>
                <select
                  value={joinPolicy}
                  onChange={(e) => setJoinPolicy(e.target.value as 'approval_required' | 'open')}
                  className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="approval_required">Approval Required</option>
                  <option value="open">Open</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={handleSaveGeneral} disabled={saving} variant="action" size="lg">
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save'}
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
            />
            <div className="mt-4 flex justify-end">
              <Button onClick={handleSaveRuntimePrefs} disabled={saving} variant="action" size="lg">
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="governance" className="space-y-6">
          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">{settingsT('governance_title')}</h2>
              <p className="text-sm text-tertiary">{settingsT('governance_help')}</p>
            </div>
            <SettingsTokenReference tokens={GOVERNANCE_TOKENS} />
            <GovernanceEditor value={governance} onChange={setGovernance} />
            <div className="mt-4 flex justify-end">
              <Button onClick={handleSaveGovernanceClick} disabled={saving} variant="action" size="lg">
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="limits" className="space-y-6">
          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground mb-1">{settingsT('limits_title')}</h2>
              <p className="text-sm text-tertiary">{settingsT('limits_help')}</p>
            </div>
            <SettingsTokenReference tokens={LIMITS_TOKENS} />
            <LimitsEditor value={limits} onChange={setLimits} />
            <div className="mt-4 flex justify-end">
              <Button onClick={handleSaveLimits} disabled={saving} variant="action" size="lg">
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={governanceConfirmOpen} onOpenChange={setGovernanceConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{settingsT('governance_save_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{settingsT('governance_save_confirm_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{commonT('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleSaveGovernanceConfirm();
              }}
              disabled={saving}
            >
              {saving ? 'Saving...' : settingsT('governance_save_confirm_action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Danger Zone - fixed at bottom */}
      <div className="mt-8 rounded-xl border border-subtle bg-surface-high border-l-2 border-l-error/70 p-6">
        <h2 className="font-semibold text-error mb-4">Danger Zone</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">Delete Project</div>
            <div className="text-sm text-tertiary">Permanently delete this project and all data</div>
          </div>
          <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
            Delete Project
          </Button>
        </div>
      </div>

      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        project={currentProject}
        workspaceId={resolvedParams?.workspace || ''}
        onConfirm={() => {
          if (currentProject) {
            const remaining = projects.filter((p) => p.id !== currentProject.id);
            setProjects(remaining);
            clearProject();
            router.push(`/${resolvedParams?.locale || 'en-US'}/workspaces/${resolvedParams?.workspace}/projects`);
          }
        }}
        onDeleted={() => {
          if (currentProject) {
            const remaining = projects.filter((p) => p.id !== currentProject.id);
            setProjects(remaining);
            clearProject();
            router.push(`/${resolvedParams?.locale || 'en-US'}/workspaces/${resolvedParams?.workspace}/projects`);
          }
        }}
        deleteProject={(wsId, projectId) => projectAPI.delete(wsId, projectId)}
      />
    </div>
  );
}
