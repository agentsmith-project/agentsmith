import type { MemberGroupSummary } from './governance';

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
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
  execution_preferences_json?: Record<string, unknown>;
  limits_json?: Record<string, unknown>;
  admin_member_ids?: string[];
  created_at: string;
  updated_at: string;
}

export interface ProjectMembership {
  project_id: string;
  user_id: string;
  groups?: MemberGroupSummary[];
  permissions: string[];
  status: 'active' | 'removed';
  joined_at: string;
}
