'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PublicSystemWorkspaceRecord } from '@/lib/system-admin/workspace-registry';
import type {
  SystemWorkspaceAction,
  SystemWorkspaceDraft,
  SystemWorkspaceDraftAdmin,
  SystemWorkspaceEditorState,
  SystemWorkspaceIdpVerificationState,
} from './types';

type UseSystemWorkspacesArgs = {
  t: (key: string, values?: Record<string, string>) => string;
};

type FetchResponse = { error_message?: string; id?: string };

const EMPTY_DRAFT: SystemWorkspaceDraft = {
  name: '',
  adminMode: 'directory_user',
  adminEmail: '',
  adminQuery: '',
  admin: null,
  loginIdpUrl: '',
  loginIdpRealm: '',
  loginClientId: '',
  directoryClientId: '',
  directoryClientSecret: '',
};

type DirectorySearchResponse = {
  items?: SystemWorkspaceDraftAdmin[];
  error_message?: string;
};

type IdpVerifyResponse = {
  idp_ok?: boolean;
  directory_search_supported?: boolean;
  advice_code?: string;
  error_message?: string;
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

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
  const [isEditMode, setIsEditMode] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draft, setDraft] = useState<SystemWorkspaceDraft>(EMPTY_DRAFT);
  const [adminSearchResults, setAdminSearchResults] = useState<SystemWorkspaceDraftAdmin[]>([]);
  const [adminSearchLoading, setAdminSearchLoading] = useState(false);
  const [adminSearchError, setAdminSearchError] = useState<string | null>(null);
  const [idpVerificationState, setIdpVerificationState] = useState<SystemWorkspaceIdpVerificationState>('idle');
  const [idpVerificationNotice, setIdpVerificationNotice] = useState<string | null>(null);

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

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const selectedStatus = selectedWorkspace?.provisioning_status ?? 'draft';
  const isProvisioning = selectedStatus === 'provisioning';
  const hasIdpInputs = Boolean(
    draft.loginIdpUrl.trim() &&
    draft.loginIdpRealm.trim() &&
    draft.loginClientId.trim(),
  );
  const effectiveDirectoryClientSecret = draft.directoryClientSecret.trim()
    || (selectedWorkspace?.directory_idp.has_client_secret ? '__persisted__' : '');
  const idpVerified = idpVerificationState === 'verified_with_directory' || idpVerificationState === 'verified_without_directory';
  const canSubmitAdmin = draft.adminMode === 'directory_user'
    ? Boolean(draft.admin?.user_id.trim()) && idpVerificationState === 'verified_with_directory'
    : isValidEmail(draft.adminEmail) && idpVerified;

  const editorState: SystemWorkspaceEditorState = {
    draft,
    selectedWorkspaceId,
    selectedWorkspace,
    selectedStatus,
    isEditingWorkspace: Boolean(selectedWorkspaceId),
    isEditMode,
    canSubmit:
      isEditMode &&
      Boolean(draft.name.trim()) &&
      hasIdpInputs &&
      idpVerified &&
      canSubmitAdmin,
    canPublish:
      Boolean(selectedWorkspaceId) &&
      (selectedStatus === 'draft' || selectedStatus === 'failed' || selectedStatus === 'disabled'),
    canDisable: Boolean(selectedWorkspaceId) && selectedStatus === 'ready',
    canDelete: Boolean(selectedWorkspaceId) && selectedStatus === 'disabled',
    isProvisioning,
    idpVerificationState,
    directorySearchEnabled: idpVerificationState === 'verified_with_directory',
  };

  const resetDraft = () => {
    setSelectedWorkspaceId(null);
    setIsEditMode(false);
    setDraft(EMPTY_DRAFT);
    setAdminSearchResults([]);
    setAdminSearchError(null);
    setIdpVerificationState('idle');
    setIdpVerificationNotice(null);
  };

  const selectWorkspace = (workspace: PublicSystemWorkspaceRecord) => {
    setSelectedWorkspaceId(workspace.id);
    setIsEditMode(false);
    setSaveError(null);
    setSaveNotice(null);
    setAdminSearchResults([]);
    setAdminSearchError(null);
    setDraft({
      name: workspace.name,
      adminMode: workspace.workspace_admin_user_id ? 'directory_user' : 'email_pending',
      adminEmail: workspace.workspace_admin,
      adminQuery: workspace.workspace_admin,
      admin: workspace.workspace_admin_user_id
        ? {
            user_id: workspace.workspace_admin_user_id,
            email: workspace.workspace_admin,
            name: workspace.workspace_admin_name ?? null,
          }
        : null,
      loginIdpUrl: workspace.login_idp.url,
      loginIdpRealm: workspace.login_idp.realm,
      loginClientId: workspace.login_idp.client_id,
      directoryClientId: workspace.directory_idp.client_id || '',
      directoryClientSecret: '',
    });
    setIdpVerificationState('idle');
    setIdpVerificationNotice(null);
  };

  const enableEditMode = () => {
    setIsEditMode(true);
    setSaveError(null);
    setSaveNotice(null);
  };

  const cancelEditMode = () => {
    if (selectedWorkspace) {
      selectWorkspace(selectedWorkspace);
    } else {
      setIsEditMode(false);
    }
  };

  const updateDraft = (patch: Partial<SystemWorkspaceDraft>) => {
    const idpChanged = 'loginIdpUrl' in patch
      || 'loginIdpRealm' in patch
      || 'loginClientId' in patch
      || 'directoryClientId' in patch
      || 'directoryClientSecret' in patch;
    const modeChanged = 'adminMode' in patch;
    setDraft((current) => ({
      ...current,
      ...patch,
      ...(idpChanged && current.adminMode === 'directory_user' ? { admin: null } : {}),
      ...(modeChanged && patch.adminMode === 'email_pending'
        ? {
            admin: null,
            adminQuery: '',
            adminEmail: patch.adminEmail ?? current.adminEmail ?? current.admin?.email ?? '',
          }
        : {}),
      ...(modeChanged && patch.adminMode === 'directory_user'
        ? {
            adminQuery: patch.adminQuery ?? current.admin?.email ?? current.adminEmail,
          }
        : {}),
    }));
    if (idpChanged) {
      setIdpVerificationState('idle');
      setIdpVerificationNotice(null);
      setAdminSearchResults([]);
      setAdminSearchError(null);
    }
  };

  const verifyIdentityProvider = async () => {
    if (
      !draft.loginIdpUrl.trim()
      || !draft.loginIdpRealm.trim()
      || !draft.loginClientId.trim()
    ) {
      return;
    }
    setIdpVerificationState('verifying');
    setIdpVerificationNotice(null);
    try {
      const response = await fetch('/api/system/workspaces/idp/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          login_idp_url: draft.loginIdpUrl,
          login_idp_realm: draft.loginIdpRealm,
          login_client_id: draft.loginClientId,
          directory_client_id: draft.directoryClientId.trim() || undefined,
          directory_client_secret: draft.directoryClientSecret.trim() || undefined,
          workspace_id: selectedWorkspaceId ?? undefined,
        }),
      });
      const data = await parseJson<IdpVerifyResponse>(response);
      if (!response.ok) {
        setIdpVerificationState('failed');
        setIdpVerificationNotice(data?.error_message || 'keycloak_idp_invalid');
        return;
      }
      if (data?.directory_search_supported) {
        setIdpVerificationState('verified_with_directory');
        setIdpVerificationNotice('idp_directory_ready');
        return;
      }
      setIdpVerificationState('verified_without_directory');
      setIdpVerificationNotice(data?.advice_code === 'DIRECTORY_PERMISSION_RECOMMENDED'
        ? 'idp_directory_recommended'
        : 'idp_directory_unavailable_but_email_pending_allowed');
    } catch {
      setIdpVerificationState('failed');
      setIdpVerificationNotice('keycloak_directory_unavailable');
    }
  };

  const searchAdminDirectory = async (query: string) => {
    const normalizedQuery = query.trim();
    if (
      normalizedQuery.length < 2 ||
      idpVerificationState !== 'verified_with_directory' ||
      !draft.loginIdpUrl.trim() ||
      !draft.loginIdpRealm.trim() ||
      !draft.directoryClientId.trim() ||
      !effectiveDirectoryClientSecret
    ) {
      setAdminSearchResults([]);
      setAdminSearchError(null);
      return;
    }
    setAdminSearchLoading(true);
    setAdminSearchError(null);
    try {
      const response = await fetch('/api/system/workspaces/directory/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          login_idp_url: draft.loginIdpUrl,
          login_idp_realm: draft.loginIdpRealm,
          login_client_id: draft.loginClientId,
          directory_client_id: draft.directoryClientId,
          directory_client_secret: draft.directoryClientSecret.trim() || undefined,
          workspace_id: selectedWorkspaceId ?? undefined,
          query: normalizedQuery,
        }),
      });
      const data = await parseJson<DirectorySearchResponse>(response);
      if (!response.ok) {
        setAdminSearchResults([]);
        setAdminSearchError(data?.error_message || 'keycloak_directory_unavailable');
        return;
      }
      setAdminSearchResults(Array.isArray(data?.items) ? data.items : []);
    } finally {
      setAdminSearchLoading(false);
    }
  };

  useEffect(() => {
    if (draft.adminMode !== 'directory_user') {
      setAdminSearchResults([]);
      setAdminSearchError(null);
      return;
    }
    const handle = window.setTimeout(() => {
      void searchAdminDirectory(draft.adminQuery);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [draft.adminMode, draft.adminQuery, draft.directoryClientId, draft.directoryClientSecret, draft.loginIdpRealm, draft.loginIdpUrl, idpVerificationState, selectedWorkspaceId, effectiveDirectoryClientSecret]);

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
          workspace_admin_mode: draft.adminMode,
          workspace_admin_user_id: draft.adminMode === 'directory_user' ? draft.admin?.user_id : undefined,
          workspace_admin_email: draft.adminMode === 'directory_user'
            ? draft.admin?.email || draft.adminEmail
            : draft.adminEmail,
          login_idp_url: draft.loginIdpUrl,
          login_idp_realm: draft.loginIdpRealm,
          login_client_id: draft.loginClientId,
          directory_client_id: draft.directoryClientId.trim() || undefined,
          directory_client_secret: draft.directoryClientSecret.trim() || (selectedWorkspaceId ? undefined : draft.directoryClientSecret),
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
      setIsEditMode(false);
      setDraft((current) => ({ ...current, directoryClientSecret: '' }));
      setAdminSearchResults([]);
      setIdpVerificationState('idle');
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
      setDraft((current) => ({ ...current, directoryClientSecret: '' }));
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
      setDraft((current) => ({ ...current, directoryClientSecret: '' }));
      setSaveNotice(t('disable_success'));
    });
  };

  const remove = async () => {
    if (!selectedWorkspaceId) return;
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
    editorState,
    setSearchQuery,
    loadWorkspaces,
    resetDraft,
    selectWorkspace,
    updateDraft,
    adminSearchResults,
    adminSearchLoading,
    adminSearchError,
    idpVerificationNotice,
    verifyIdentityProvider,
    submit,
    publish,
    disable,
    remove,
    enableEditMode,
    cancelEditMode,
  };
}
