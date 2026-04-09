export type ContextScope = 'member' | 'task' | 'project' | 'workspace';
export type ContextContentType = 'text' | 'json' | 'markdown' | 'yaml';

export interface ContextEntry {
  id: string;
  scope: ContextScope;
  key: string;
  content: string;
  content_type: ContextContentType;
  user_id?: string | null;
  task_id?: string | null;
  project_id?: string | null;
  workspace_id?: string | null;
  read_only: boolean;
  updated_at: string;
  updated_by: string;
}

export interface PutContextEntryRequest {
  scope: ContextScope;
  key: string;
  content: string;
  content_type?: ContextContentType;
  workspace_id?: string | null;
  project_id?: string | null;
  task_id?: string | null;
}

export interface ContextQuery {
  scope: ContextScope;
  key?: string;
  workspace_id?: string | null;
  project_id?: string | null;
  task_id?: string | null;
}
