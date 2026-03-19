export type ProjectMembershipRecord = {
  project_id: string;
  user_id: string;
  role?: string;
  status: 'active' | 'pending' | 'suspended';
  joined_at: string;
  approved_via_join_request_id?: string;
};

export type ProjectGroupRecord = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  permission_template_id: string;
  member_ids: string[];
  built_in?: boolean;
  system_key?: 'owner' | 'admins' | 'members';
  membership_mode?: 'system_managed' | 'manual';
  deletable?: boolean;
  created_at: string;
  updated_at: string;
};

export type ProjectMemberPermissionState = {
  mode: 'template' | 'custom';
  template?: string | null;
  permissions: string[];
};

export type ProjectPermissionTemplateRecord = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  permissions: string[];
  built_in?: boolean;
  editable?: boolean;
  created_at: string;
  updated_at: string;
};
