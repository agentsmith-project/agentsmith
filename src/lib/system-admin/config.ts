import { readPublicRuntimeConfigFromEnv } from '@/lib/public-runtime-config';
import { slugifyWorkspaceId } from './slugify-workspace-id';

export interface WorkspaceTenantPreview {
  workspace_id: string;
  workspace_name: string;
  substrate_label: string;
  database_name: string;
  collection_prefix: string;
  key_prefix: string;
}

export interface SystemInfoSnapshot {
  system_admin_username: string;
  api_base_url: string;
  workspace_registry_status: 'available' | 'unavailable';
  substrate_label: string;
  substrate_url: string;
  data_service_status: 'configured' | 'missing';
  database_prefix: string;
  collection_prefix: string;
  key_prefix: string;
  default_workspace_id: string;
  default_workspace_name: string;
  default_idp_url: string;
  default_idp_realm: string;
  default_idp_client_id: string;
  default_idp_status: 'configured' | 'incomplete';
  workspace_provisioning: {
    total: number;
    draft: number;
    provisioning: number;
    ready: number;
    failed: number;
    disabled: number;
    last_initialized_at: string | null;
    last_ready_at: string | null;
    last_failed_at: string | null;
    last_init_error: string | null;
  };
}

const DEFAULT_SYSTEM_ADMIN_USERNAME = 'mbos-admin';
const DEFAULT_SYSTEM_ADMIN_PASSWORD = 'mbos-admin';
const DEFAULT_SUBSTRATE_LABEL = 'primary';
const DEFAULT_SUBSTRATE_URL = 'mongodb://localhost:27017';
const DEFAULT_DATABASE_PREFIX = 'agentsmith_ws_';
const DEFAULT_COLLECTION_PREFIX = 'ws_';
const DEFAULT_KEY_PREFIX = 'ws:';

export function getSystemAdminUsername(): string {
  return process.env.SYSTEM_ADMIN_USERNAME || DEFAULT_SYSTEM_ADMIN_USERNAME;
}

export function getSystemAdminPassword(): string {
  return process.env.SYSTEM_ADMIN_PASSWORD || DEFAULT_SYSTEM_ADMIN_PASSWORD;
}

export function buildWorkspaceTenantPreview(workspaceNameOrId: string): WorkspaceTenantPreview {
  const workspaceId = slugifyWorkspaceId(workspaceNameOrId);
  const substrateLabel = process.env.SYSTEM_SUBSTRATE_LABEL || DEFAULT_SUBSTRATE_LABEL;
  const databasePrefix = process.env.SYSTEM_TENANT_DATABASE_PREFIX || DEFAULT_DATABASE_PREFIX;
  const collectionPrefix = process.env.SYSTEM_TENANT_COLLECTION_PREFIX || DEFAULT_COLLECTION_PREFIX;
  const keyPrefix = process.env.SYSTEM_TENANT_KEY_PREFIX || DEFAULT_KEY_PREFIX;

  return {
    workspace_id: workspaceId,
    workspace_name: workspaceNameOrId.trim() || workspaceId,
    substrate_label: substrateLabel,
    database_name: `${databasePrefix}${workspaceId}`,
    collection_prefix: `${collectionPrefix}${workspaceId}_`,
    key_prefix: `${keyPrefix}${workspaceId}:`,
  };
}

export function getBaseSystemInfoSnapshot(): Omit<
  SystemInfoSnapshot,
  'workspace_registry_status' | 'data_service_status' | 'default_idp_status' | 'workspace_provisioning'
> {
  const publicConfig = readPublicRuntimeConfigFromEnv(process.env);
  return {
    system_admin_username: getSystemAdminUsername(),
    api_base_url: publicConfig.apiBase,
    substrate_label: process.env.SYSTEM_SUBSTRATE_LABEL || DEFAULT_SUBSTRATE_LABEL,
    substrate_url: process.env.SYSTEM_SUBSTRATE_URL || DEFAULT_SUBSTRATE_URL,
    database_prefix: process.env.SYSTEM_TENANT_DATABASE_PREFIX || DEFAULT_DATABASE_PREFIX,
    collection_prefix: process.env.SYSTEM_TENANT_COLLECTION_PREFIX || DEFAULT_COLLECTION_PREFIX,
    key_prefix: process.env.SYSTEM_TENANT_KEY_PREFIX || DEFAULT_KEY_PREFIX,
    default_workspace_id: process.env.MBOS_DEFAULT_WORKSPACE_ID || 'ws_default',
    default_workspace_name: process.env.MBOS_DEFAULT_WORKSPACE_NAME || 'Default Workspace',
    default_idp_url: publicConfig.keycloakUrl,
    default_idp_realm: publicConfig.keycloakRealm,
    default_idp_client_id: publicConfig.keycloakClientId,
  };
}
