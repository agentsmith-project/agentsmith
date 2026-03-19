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

export type SystemWorkspaceAdminMode = 'directory_user' | 'email_pending';

export type SystemWorkspaceIdpVerificationState =
  | 'idle'
  | 'verifying'
  | 'verified_with_directory'
  | 'verified_without_directory'
  | 'failed';

export type SystemWorkspaceDraft = {
  name: string;
  adminMode: SystemWorkspaceAdminMode;
  adminEmail: string;
  adminQuery: string;
  admin: SystemWorkspaceDraftAdmin | null;
  loginIdpUrl: string;
  loginIdpRealm: string;
  loginClientId: string;
  directoryClientId: string;
  directoryClientSecret: string;
};

export type SystemWorkspaceEditorState = {
  draft: SystemWorkspaceDraft;
  selectedWorkspaceId: string | null;
  selectedWorkspace: PublicSystemWorkspaceRecord | null;
  selectedStatus: WorkspaceProvisioningStatus;
  isEditingWorkspace: boolean;
  isEditMode: boolean;
  canSubmit: boolean;
  canPublish: boolean;
  canDisable: boolean;
  canDelete: boolean;
  isProvisioning: boolean;
  idpVerificationState: SystemWorkspaceIdpVerificationState;
  directorySearchEnabled: boolean;
};
