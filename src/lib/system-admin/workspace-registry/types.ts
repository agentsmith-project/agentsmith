import type { buildWorkspaceTenantPreview } from '../config';

export interface SystemWorkspaceLoginIdpConfig {
  kind: 'keycloak';
  url: string;
  realm: string;
  client_id: string;
}

export interface SystemWorkspaceDirectoryIdpConfig {
  client_id?: string;
  client_secret?: string;
}

export type WorkspaceProvisioningStatus =
  | 'draft'
  | 'provisioning'
  | 'ready'
  | 'failed'
  | 'disabled';

export interface WorkspaceIdentitySnapshot {
  user_id: string;
  email: string;
  name: string | null;
}

export type WorkspaceAdminBindingMode = 'directory_user' | 'email_pending';

export interface SystemWorkspaceRecord {
  id: string;
  name: string;
  workspace_admin: string;
  workspace_admin_user_id?: string;
  workspace_admin_name?: string | null;
  workspace_admin_binding_required?: boolean;
  project_creators: WorkspaceIdentitySnapshot[];
  login_idp: SystemWorkspaceLoginIdpConfig;
  directory_idp?: SystemWorkspaceDirectoryIdpConfig;
  tenant: ReturnType<typeof buildWorkspaceTenantPreview>;
  provisioning_status: WorkspaceProvisioningStatus;
  last_initialized_at: string | null;
  last_init_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicSystemWorkspaceRecord extends Omit<SystemWorkspaceRecord, 'login_idp' | 'directory_idp'> {
  login_idp: SystemWorkspaceLoginIdpConfig;
  directory_idp: {
    client_id?: string;
    has_client_secret: boolean;
  };
}

export interface UpsertSystemWorkspaceInput {
  name: string;
  workspace_admin_mode: WorkspaceAdminBindingMode;
  workspace_admin_user_id?: string;
  workspace_admin_email: string;
  login_idp_url: string;
  login_idp_realm: string;
  login_client_id: string;
  directory_client_id?: string;
  directory_client_secret?: string;
}

export interface PublishSystemWorkspaceResult {
  status: WorkspaceProvisioningStatus;
  initialized_at: string | null;
  init_error: string | null;
}
