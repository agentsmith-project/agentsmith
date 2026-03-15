import type { Project, WorkspaceMember } from '@/lib/api/types';
import type { Member } from '@/lib/api/endpoints/members';

export interface ResolvedProjectSettingsParams {
  workspace?: string;
  project?: string;
  locale: string;
}

export type SettingsProject = Project;
export type SettingsWorkspaceMember = WorkspaceMember;
export type SettingsProjectMember = Member;
export interface SettingsProjectAdminOption {
  id: string;
  user_id: string;
  name: string;
  email: string;
}
