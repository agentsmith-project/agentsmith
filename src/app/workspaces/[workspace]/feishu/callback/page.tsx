import { redirect } from 'next/navigation';
import { getPublicApiBaseUrl } from '@/lib/public-runtime-config';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { WorkspaceFeishuCallbackFallback } from './WorkspaceFeishuCallbackFallback';

const CALLBACK_REQUEST_TIMEOUT_MS = 15000;

type CallbackPageProps = {
  params: Promise<{ workspace?: string }>;
  searchParams: Promise<{ code?: string; state?: string }>;
};

type CallbackResult = {
  intent?: 'admin_verify' | 'user_connect';
  redirect_path?: string;
};

export default async function WorkspaceFeishuCallbackPage({ params, searchParams }: CallbackPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const workspaceId = validateWorkspaceParam(resolvedParams.workspace);
  const code = typeof resolvedSearchParams.code === 'string' ? resolvedSearchParams.code.trim() : '';
  const state = typeof resolvedSearchParams.state === 'string' ? resolvedSearchParams.state.trim() : '';

  if (!workspaceId) {
    return <WorkspaceFeishuCallbackFallback workspaceId={null} initialError="workspace_not_found" />;
  }

  if (!code || !state) {
    return <WorkspaceFeishuCallbackFallback workspaceId={workspaceId} initialError="feishu_callback_missing_code_or_state" />;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALLBACK_REQUEST_TIMEOUT_MS);
  let response: Response;
  let payload: unknown;

  try {
    const publicApiBase = getPublicApiBaseUrl().replace(/\/api\/v1$/i, '');
    response = await fetch(
      `${publicApiBase}/api/public/workspaces/${encodeURIComponent(workspaceId)}/feishu/oauth/complete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    payload = await response.json().catch(() => ({}));
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? 'workspace_feishu_callback_timeout'
      : 'workspace_feishu_callback_failed';
    return (
      <WorkspaceFeishuCallbackFallback
        workspaceId={workspaceId}
        initialError={message}
      />
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message = typeof (payload as { message?: unknown })?.message === 'string' && (payload as { message?: string }).message
      ? (payload as { message: string }).message
      : 'workspace_feishu_callback_failed';
    return (
      <WorkspaceFeishuCallbackFallback
        workspaceId={workspaceId}
        initialError={message}
      />
    );
  }

  const result = payload as CallbackResult;
  redirect(result.redirect_path || `/en-US/workspaces/${workspaceId}/connections`);
}
