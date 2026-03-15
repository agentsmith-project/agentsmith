import type {
  PublicSystemWorkspaceRecord,
  WorkspaceProvisioningStatus,
} from '@/lib/system-admin/workspace-registry';

export type SystemWorkspaceAction = 'create' | 'update' | 'delete' | 'publish' | 'disable' | null;

export type SystemWorkspaceDraftAdmin = {
  user_id: string;
  email: string;
  name: string | null;
};

export type SystemWorkspaceDraft = {
  name: string;
  adminQuery: string;
  admin: SystemWorkspaceDraftAdmin | null;
  idpUrl: string;
  idpRealm: string;
  idpClientId: string;
  idpClientSecret: string;
};

export type SystemWorkspaceEditorState = {
  draft: SystemWorkspaceDraft;
  selectedWorkspaceId: string | null;
  selectedWorkspace: PublicSystemWorkspaceRecord | null;
  selectedStatus: WorkspaceProvisioningStatus;
  isEditingWorkspace: boolean;
  canSubmit: boolean;
  canPublish: boolean;
  canDisable: boolean;
  canDelete: boolean;
  isProvisioning: boolean;
};
