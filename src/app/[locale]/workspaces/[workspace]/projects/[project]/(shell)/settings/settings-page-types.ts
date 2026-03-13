import type { Project, WorkspaceMember } from '@/lib/api/types';

export interface ResolvedProjectSettingsParams {
  workspace?: string;
  project?: string;
  locale: string;
}

export type SettingsProject = Project;
export type SettingsWorkspaceMember = WorkspaceMember;
