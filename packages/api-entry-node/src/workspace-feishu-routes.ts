import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { completeWorkspaceFeishuOAuth, enableWorkspaceFeishuIntegration, startWorkspaceFeishuOAuth } from './workspace-feishu-oauth.js';
import {
  getWorkspaceFeishuIntegrationOrDefault,
  presentWorkspaceFeishuIntegration,
  upsertWorkspaceFeishuIntegration,
} from './workspace-feishu-settings-store.js';
import { resolveWorkspacePermissions } from './workspace-permissions.js';
import type { WorkspaceRecordLike } from './project-handler-types.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

function findWorkspaceRecord(args: {
  workspaces: WorkspaceRecordLike[];
  workspaceId: string;
  defaultWorkspace?: WorkspaceRecordLike;
}) {
  const { workspaces, workspaceId, defaultWorkspace } = args;
  return workspaces.find((item) => item.id === workspaceId)
    ?? (defaultWorkspace && workspaceId === defaultWorkspace.id ? defaultWorkspace : null);
}

async function assertWorkspaceAccess(args: {
  workspaceId: string;
  user: AuthenticatedUser;
  defaultWorkspace?: WorkspaceRecordLike;
  requireGovernanceUpdate?: boolean;
}) {
  const permissions = await resolveWorkspacePermissions({
    workspaceId: args.workspaceId,
    actorId: args.user.id,
    actorEmail: args.user.email,
    defaultWorkspaceId: args.defaultWorkspace?.id,
  });
  const required = args.requireGovernanceUpdate ? 'workspace:governance:update' : 'workspace:read';
  if (!permissions.includes(required)) {
    const error = new Error('workspace_admin_required');
    Object.assign(error, { code: 'PERMISSION_DENIED' });
    throw error;
  }
}

type WorkspaceFeishuDraftInput = {
  app_id?: unknown;
  app_secret?: unknown;
  redirect_uri?: unknown;
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePostRedirectPath(value: unknown, fallback: string): string {
  const candidate = normalizeString(value);
  return candidate.startsWith('/') ? candidate : fallback;
}

function writeError(res: http.ServerResponse, json: JsonResponder, error: unknown): void {
  const message = error instanceof Error ? error.message : 'workspace_feishu_request_failed';
  switch (message) {
    case 'workspace_feishu_not_configured':
      json(res, 422, { error_code: 'VALIDATION_ERROR', message });
      return;
    case 'workspace_feishu_not_enabled':
    case 'workspace_feishu_verification_required':
      json(res, 409, { error_code: 'STATE_CONFLICT', message });
      return;
    case 'feishu_callback_missing_code_or_state':
    case 'feishu_callback_state_invalid':
      json(res, 422, { error_code: 'VALIDATION_ERROR', message });
      return;
    default:
      throw error;
  }
}

export async function handleWorkspaceFeishuRoute(args: {
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  workspaces: WorkspaceRecordLike[];
  defaultWorkspace?: WorkspaceRecordLike;
  workspaceId: string;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  routeKind:
    | 'workspaceFeishuSettings'
    | 'workspaceFeishuVerifyStart'
    | 'workspaceFeishuEnable'
    | 'workspaceFeishuOAuthComplete'
    | 'workspaceFeishuUserAuthStart';
}): Promise<boolean> {
  const {
    method,
    req,
    res,
    deps,
    user,
    workspaces,
    defaultWorkspace,
    workspaceId,
    json,
    readBody,
    routeKind,
  } = args;
  const workspaceRecord = findWorkspaceRecord({ workspaces, workspaceId, defaultWorkspace });
  if (!workspaceRecord) {
    json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
    return true;
  }

  try {
    if (routeKind === 'workspaceFeishuSettings') {
      if (method === 'GET') {
        await assertWorkspaceAccess({ workspaceId, user, defaultWorkspace });
        const record = await getWorkspaceFeishuIntegrationOrDefault(deps.docStore, workspaceId);
        json(res, 200, presentWorkspaceFeishuIntegration(record));
        return true;
      }
      if (method === 'PUT') {
        await assertWorkspaceAccess({
          workspaceId,
          user,
          defaultWorkspace,
          requireGovernanceUpdate: true,
        });
        const body = await readBody(req) as WorkspaceFeishuDraftInput;
        const appId = normalizeString(body?.app_id);
        const redirectUri = normalizeString(body?.redirect_uri);
        const nextSecret = normalizeString(body?.app_secret);
        const current = await getWorkspaceFeishuIntegrationOrDefault(deps.docStore, workspaceId);
        if (!appId || !redirectUri) {
          json(res, 422, {
            error_code: 'VALIDATION_ERROR',
            message: 'workspace_feishu_credentials_required',
          });
          return true;
        }
        if (!nextSecret && !current.app_secret) {
          json(res, 422, {
            error_code: 'VALIDATION_ERROR',
            message: 'workspace_feishu_secret_required',
          });
          return true;
        }
        const now = new Date().toISOString();
        const record = await upsertWorkspaceFeishuIntegration(deps.docStore, {
          ...current,
          status: 'verification_required',
          app_id: appId,
          app_secret: nextSecret || current.app_secret,
          redirect_uri: redirectUri,
          verified_at: null,
          verified_by_user_id: null,
          verified_by_email: null,
          last_error: null,
          created_at: current.created_at || now,
          updated_at: now,
        });
        json(res, 200, presentWorkspaceFeishuIntegration(record));
        return true;
      }
      return false;
    }

    if (routeKind === 'workspaceFeishuVerifyStart' && method === 'POST') {
      await assertWorkspaceAccess({
        workspaceId,
        user,
        defaultWorkspace,
        requireGovernanceUpdate: true,
      });
      const body = await readBody(req) as { post_redirect_path?: unknown } | undefined;
      const auth = await startWorkspaceFeishuOAuth({
        cache: deps.cache,
        docStore: deps.docStore,
        workspaceId,
        userId: user.id,
        userEmail: user.email,
        intent: 'admin_verify',
        postRedirectPath: normalizePostRedirectPath(
          body?.post_redirect_path,
          `/workspaces/${workspaceId}/settings/feishu?step=verify`,
        ),
      });
      json(res, 200, auth);
      return true;
    }

    if (routeKind === 'workspaceFeishuEnable' && method === 'POST') {
      await assertWorkspaceAccess({
        workspaceId,
        user,
        defaultWorkspace,
        requireGovernanceUpdate: true,
      });
      const record = await enableWorkspaceFeishuIntegration({
        docStore: deps.docStore,
        workspaceId,
      });
      json(res, 200, presentWorkspaceFeishuIntegration(record));
      return true;
    }

    if (routeKind === 'workspaceFeishuUserAuthStart' && method === 'POST') {
      await assertWorkspaceAccess({ workspaceId, user, defaultWorkspace });
      const body = await readBody(req) as { post_redirect_path?: unknown } | undefined;
      const auth = await startWorkspaceFeishuOAuth({
        cache: deps.cache,
        docStore: deps.docStore,
        workspaceId,
        userId: user.id,
        userEmail: user.email,
        intent: 'user_connect',
        postRedirectPath: normalizePostRedirectPath(
          body?.post_redirect_path,
          `/workspaces/${workspaceId}/connections?provider=feishu`,
        ),
        requireEnabled: true,
      });
      json(res, 200, auth);
      return true;
    }

    if (routeKind === 'workspaceFeishuOAuthComplete' && method === 'POST') {
      await assertWorkspaceAccess({ workspaceId, user, defaultWorkspace });
      const body = await readBody(req) as { code?: unknown; state?: unknown } | undefined;
      const result = await completeWorkspaceFeishuOAuth({
        cache: deps.cache,
        docStore: deps.docStore,
        workspaceId,
        userId: user.id,
        userEmail: user.email,
        code: normalizeString(body?.code),
        state: normalizeString(body?.state),
      });
      json(res, 200, result);
      return true;
    }
  } catch (error) {
    if (error instanceof Error && (error as Error & { code?: string }).code === 'PERMISSION_DENIED') {
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'workspace_admin_required' });
      return true;
    }
    writeError(res, json, error);
    return true;
  }

  return false;
}
