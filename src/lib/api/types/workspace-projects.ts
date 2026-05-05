import type { MemberGroupSummary } from './governance';

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface PublicWorkspaceSummary {
  id: string;
  name: string;
}

export interface WorkspaceMember {
  id: string;
  user_id: string;
  name: string;
  email: string;
  groups?: MemberGroupSummary[];
  permissions?: string[];
  status: 'active' | 'removed';
  joined_at: string;
}

export interface WorkspaceDirectoryUser {
  user_id: string;
  email: string;
  name: string | null;
}

export type WorkspaceFeishuIntegrationStatus =
  | 'not_configured'
  | 'verification_required'
  | 'verified'
  | 'enabled'
  | 'error';

export interface WorkspaceFeishuIntegration {
  id: string;
  workspace_id: string;
  provider: 'feishu';
  status: WorkspaceFeishuIntegrationStatus;
  app_id: string;
  redirect_uri: string;
  verified_at: string | null;
  verified_by_user_id?: string | null;
  verified_by_email?: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  has_app_secret: boolean;
}

export interface WorkspaceFeishuOAuthStartResponse {
  authorization_url: string;
  state: string;
  redirect_uri: string;
  expires_at: string;
  scopes?: string[];
}

export interface WorkspaceFeishuOAuthCompleteResponse {
  intent: 'admin_verify' | 'user_connect';
  redirect_path: string;
}

export type ProjectMembershipStatus = 'active' | 'pending' | 'suspended' | 'none';

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  visibility: 'public' | 'private';
  join_policy?: 'approval_required' | 'open';
  owner_id: string;
  status: 'active' | 'archived' | 'deleted';
  governance_json?: Record<string, unknown>;
  limits_json?: Record<string, unknown>;
  admin_member_ids?: string[];
  created_at: string;
  updated_at: string;
}

export interface ProjectWithMembership extends Project {
  admin_member_ids?: string[];
  groups?: MemberGroupSummary[];
  permissions: string[];
  membership_status: ProjectMembershipStatus;
}

export interface ProjectListResponse {
  items: ProjectWithMembership[];
}

export interface ProjectMembership {
  project_id: string;
  user_id: string;
  groups?: MemberGroupSummary[];
  permissions: string[];
  status: 'active' | 'pending' | 'suspended' | 'removed';
  joined_at: string;
}
