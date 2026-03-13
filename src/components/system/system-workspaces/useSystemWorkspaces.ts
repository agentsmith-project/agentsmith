'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildWorkspaceTenantPreview } from '@/lib/system-admin/config';
import type { PublicSystemWorkspaceRecord } from '@/lib/system-admin/workspace-registry';
import type { SystemWorkspaceAction, SystemWorkspaceDraft, SystemWorkspaceEditorState } from './types';

type UseSystemWorkspacesArgs = {
  t: (key: string, values?: Record<string, string>) => string;
};

type FetchResponse = { error_message?: string; id?: string };

const EMPTY_DRAFT: SystemWorkspaceDraft = {
  name: '',
  admin: '',
  idpUrl: '',
  idpRealm: '',
  idpClientId: '',
  idpClientSecret: '',
};

async function parseJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

export function useSystemWorkspaces({ t }: UseSystemWorkspacesArgs) {
  const [workspaces, setWorkspaces] = useState<PublicSystemWorkspaceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeAction, setActiveAction] = useState<SystemWorkspaceAction>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draft, setDraft] = useState<SystemWorkspaceDraft>(EMPTY_DRAFT);

  const loadWorkspaces = async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('load_failed');
      }
      const data = await parseJson<{ items?: PublicSystemWorkspaceRecord[] }>(response);
      setWorkspaces(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkspaces();
  }, []);

  const filteredWorkspaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return workspaces;
    return workspaces.filter((workspace) => (
      workspace.name.toLowerCase().includes(query) || workspace.id.toLowerCase().includes(query)
    ));
  }, [searchQuery, workspaces]);

  const preview = useMemo(() => buildWorkspaceTenantPreview(draft.name || 'workspace'), [draft.name]);
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const selectedStatus = selectedWorkspace?.provisioning_status ?? 'draft';
  const isProvisioning = selectedStatus === 'provisioning';

  const editorState: SystemWorkspaceEditorState = {
    draft,
    selectedWorkspaceId,
    selectedWorkspace,
    selectedStatus,
    isEditingWorkspace: Boolean(selectedWorkspaceId),
    canSubmit:
      Boolean(draft.name.trim()) &&
      Boolean(draft.admin.trim()) &&
      Boolean(draft.idpUrl.trim()) &&
      Boolean(draft.idpRealm.trim()) &&
      Boolean(draft.idpClientId.trim()),
    canPublish:
      Boolean(selectedWorkspaceId) &&
      (selectedStatus === 'draft' || selectedStatus === 'failed' || selectedStatus === 'disabled'),
    canDisable: Boolean(selectedWorkspaceId) && selectedStatus === 'ready',
    canDelete: Boolean(selectedWorkspaceId) && selectedStatus === 'disabled',
    isProvisioning,
  };

  const resetDraft = () => {
    setSelectedWorkspaceId(null);
    setDraft(EMPTY_DRAFT);
  };

  const selectWorkspace = (workspace: PublicSystemWorkspaceRecord) => {
    setSelectedWorkspaceId(workspace.id);
    setSaveError(null);
    setSaveNotice(null);
    setDraft({
      name: workspace.name,
      admin: workspace.workspace_admin,
      idpUrl: workspace.idp.url,
      idpRealm: workspace.idp.realm,
      idpClientId: workspace.idp.client_id,
      idpClientSecret: '',
    });
  };

  const updateDraft = (patch: Partial<SystemWorkspaceDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const runMutation = async (action: Exclude<SystemWorkspaceAction, null>, execute: () => Promise<void>) => {
    setIsSubmitting(true);
    setActiveAction(action);
    setSaveError(null);
    setSaveNotice(null);
    try {
      await execute();
    } finally {
      setIsSubmitting(false);
      setActiveAction(null);
    }
  };

  const submit = async () => {
    await runMutation(selectedWorkspaceId ? 'update' : 'create', async () => {
      const response = await fetch(selectedWorkspaceId ? `/api/system/workspaces/${selectedWorkspaceId}` : '/api/system/workspaces', {
        method: selectedWorkspaceId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          workspace_admin: draft.admin,
          idp_url: draft.idpUrl,
          idp_realm: draft.idpRealm,
          idp_client_id: draft.idpClientId,
          idp_client_secret: draft.idpClientSecret || undefined,
        }),
      });
      const data = await parseJson<FetchResponse>(response);
      if (!response.ok) {
        setSaveError(data?.error_message || 'invalid_system_workspace_payload');
        return;
      }
      await loadWorkspaces();
      if (data?.id) {
        setSelectedWorkspaceId(data.id);
      }
      setDraft((current) => ({ ...current, idpClientSecret: '' }));
      setSaveNotice(selectedWorkspaceId ? t('update_success') : t('draft_success'));
    });
  };

  const publish = async () => {
    if (!selectedWorkspaceId) return;
    await runMutation('publish', async () => {
      const response = await fetch(`/api/system/workspaces/${selectedWorkspaceId}/publish`, { method: 'POST' });
      const data = await parseJson<FetchResponse>(response);
      if (!response.ok) {
        setSaveError(data?.error_message || 'workspace_publish_failed');
        return;
      }
      await loadWorkspaces();
      setDraft((current) => ({ ...current, idpClientSecret: '' }));
      setSaveNotice(t('publish_success'));
    });
  };

  const disable = async () => {
    if (!selectedWorkspaceId) return;
    await runMutation('disable', async () => {
      const response = await fetch(`/api/system/workspaces/${selectedWorkspaceId}/disable`, { method: 'POST' });
      const data = await parseJson<FetchResponse>(response);
      if (!response.ok) {
        setSaveError(data?.error_message || 'workspace_disable_failed');
        return;
      }
      await loadWorkspaces();
      setDraft((current) => ({ ...current, idpClientSecret: '' }));
      setSaveNotice(t('disable_success'));
    });
  };

  const remove = async () => {
    if (!selectedWorkspaceId) return;
    if (!window.confirm(t('delete_confirm'))) return;

    await runMutation('delete', async () => {
      const response = await fetch(`/api/system/workspaces/${selectedWorkspaceId}`, { method: 'DELETE' });
      const data = await parseJson<FetchResponse>(response);
      if (!response.ok) {
        setSaveError(data?.error_message || 'workspace_delete_failed');
        return;
      }
      await loadWorkspaces();
      resetDraft();
      setSaveNotice(t('delete_success'));
    });
  };

  return {
    workspaces,
    filteredWorkspaces,
    isLoading,
    isError,
    isSubmitting,
    activeAction,
    searchQuery,
    saveError,
    saveNotice,
    preview,
    editorState,
    setSearchQuery,
    loadWorkspaces,
    resetDraft,
    selectWorkspace,
    updateDraft,
    submit,
    publish,
    disable,
    remove,
  };
}
