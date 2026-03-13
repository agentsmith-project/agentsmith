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

export interface SystemWorkspaceRecord {
  id: string;
  name: string;
  workspace_admin: string;
  project_creators: string[];
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
  workspace_admin: string;
  project_creators?: string[];
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
