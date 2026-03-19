import type { buildWorkspaceTenantPreview } from '../config';

export interface SystemWorkspaceIdpConfig {
  kind: 'keycloak';
  url: string;
  realm: string;
  client_id: string;
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
  idp: SystemWorkspaceIdpConfig;
  tenant: ReturnType<typeof buildWorkspaceTenantPreview>;
  provisioning_status: WorkspaceProvisioningStatus;
  last_initialized_at: string | null;
  last_init_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicSystemWorkspaceRecord extends Omit<SystemWorkspaceRecord, 'idp'> {
  idp: Omit<SystemWorkspaceIdpConfig, 'client_secret'> & {
    has_client_secret: boolean;
  };
}

export interface UpsertSystemWorkspaceInput {
  name: string;
  workspace_admin_mode: WorkspaceAdminBindingMode;
  workspace_admin_user_id?: string;
  workspace_admin_email: string;
  idp_url: string;
  idp_realm: string;
  idp_client_id: string;
  idp_client_secret?: string;
}

export interface PublishSystemWorkspaceResult {
  status: WorkspaceProvisioningStatus;
  initialized_at: string | null;
  init_error: string | null;
}
