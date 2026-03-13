import type { SystemInfoSnapshot } from './config';
import { getBaseSystemInfoSnapshot } from './config';
import { listSystemWorkspaces } from './workspace-registry';

export async function getSystemInfoSnapshot(): Promise<SystemInfoSnapshot> {
  const base = getBaseSystemInfoSnapshot();

  try {
    const workspaces = await listSystemWorkspaces();
    const initializedWorkspaces = workspaces
      .filter((workspace) => typeof workspace.last_initialized_at === 'string' && workspace.last_initialized_at)
      .sort((left, right) => String(right.last_initialized_at).localeCompare(String(left.last_initialized_at)));
    const lastReadyWorkspace = workspaces
      .filter((workspace) => workspace.provisioning_status === 'ready' && workspace.last_initialized_at)
      .sort((left, right) => String(right.last_initialized_at).localeCompare(String(left.last_initialized_at)))[0];
    const lastFailedWorkspace = workspaces
      .filter((workspace) => workspace.provisioning_status === 'failed' && workspace.updated_at)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];

    return {
      ...base,
      workspace_registry_status: 'available',
      data_service_status: base.substrate_url.trim().length > 0 ? 'configured' : 'missing',
      default_idp_status:
        base.default_idp_url.trim().length > 0 &&
        base.default_idp_realm.trim().length > 0 &&
        base.default_idp_client_id.trim().length > 0
          ? 'configured'
          : 'incomplete',
      workspace_provisioning: {
        total: workspaces.length,
        draft: workspaces.filter((workspace) => workspace.provisioning_status === 'draft').length,
        provisioning: workspaces.filter((workspace) => workspace.provisioning_status === 'provisioning').length,
        ready: workspaces.filter((workspace) => workspace.provisioning_status === 'ready').length,
        failed: workspaces.filter((workspace) => workspace.provisioning_status === 'failed').length,
        disabled: workspaces.filter((workspace) => workspace.provisioning_status === 'disabled').length,
        last_initialized_at: initializedWorkspaces[0]?.last_initialized_at ?? null,
        last_ready_at: lastReadyWorkspace?.last_initialized_at ?? null,
        last_failed_at: lastFailedWorkspace?.updated_at ?? null,
        last_init_error: lastFailedWorkspace?.last_init_error ?? null,
      },
    };
  } catch {
    return {
      ...base,
      workspace_registry_status: 'unavailable',
      data_service_status: base.substrate_url.trim().length > 0 ? 'configured' : 'missing',
      default_idp_status:
        base.default_idp_url.trim().length > 0 &&
        base.default_idp_realm.trim().length > 0 &&
        base.default_idp_client_id.trim().length > 0
          ? 'configured'
          : 'incomplete',
      workspace_provisioning: {
        total: 0,
        draft: 0,
        provisioning: 0,
        ready: 0,
        failed: 0,
        disabled: 0,
        last_initialized_at: null,
        last_ready_at: null,
        last_failed_at: null,
        last_init_error: null,
      },
    };
  }
}
