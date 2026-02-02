/**
 * Recipe Type Definitions
 *
 * Types for Recipe, RecipeMessage, Artifact and related operations.
 */

export type RecipeStatus = 'active' | 'closed' | 'archived';

export interface Recipe {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_user_id: string;
  title: string;
  agent_id: string; // Fixed after creation, cannot be changed
  agent_name: string; // Redundant field for display
  status: RecipeStatus;
  attached_source_ids: string[]; // Attached Source file IDs
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  last_activity_at: string; // ISO 8601
}

export interface RecipeMessage {
  id: string;
  recipe_id: string;
  role: 'user' | 'agent';
  content: string;
  created_at: string; // ISO 8601
  referenced_source_ids?: string[]; // Source files referenced by agent
  turn_id?: string; // Associated turn ID (if any)
}

export type ArtifactType = 'text' | 'image' | 'file' | 'other';

export interface Artifact {
  id: string;
  recipe_id: string;
  turn_id?: string; // Associated turn ID
  type: ArtifactType;
  title?: string;
  content?: string; // Text content or file URL
  thumbnail_url?: string; // Image thumbnail URL
  file_size?: number;
  mime_type?: string;
  created_at: string; // ISO 8601
}

export interface CreateRecipeRequest {
  title: string;
  agent_id: string;
  initial_source_ids?: string[]; // Optional initial files
}

export interface UpdateRecipeRequest {
  title?: string;
  status?: RecipeStatus;
}

export interface SendMessageRequest {
  recipe_id: string;
  content: string;
}

export interface SaveArtifactRequest {
  artifact_id: string;
  filename?: string;
  description?: string;
}

export interface RecipeListParams {
  status?: RecipeStatus;
  search?: string;
  sort_by?: 'created_at' | 'updated_at' | 'last_activity_at';
  sort_order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export interface RecipeListResponse {
  items: Recipe[];
  total: number;
  page: number;
  page_size: number;
  has_more?: boolean;
}
