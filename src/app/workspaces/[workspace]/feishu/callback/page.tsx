'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { PageState } from '@/components/layout/PageState';
import { clearFeishuOAuthFlow, type FeishuOAuthFlowIntent } from '@/lib/feishu-oauth-flow';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { WorkspaceFeishuCallbackFallback } from './WorkspaceFeishuCallbackFallback';

const CALLBACK_REQUEST_TIMEOUT_MS = 7000;

type CallbackResult = {
  intent?: FeishuOAuthFlowIntent;
  redirect_path?: string;
};

export default function WorkspaceFeishuCallbackPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const [error, setError] = React.useState<string | null>(null);
  const hasSubmittedRef = React.useRef(false);

  React.useEffect(() => {
    if (!workspaceId) {
      setError('workspace_not_found');
      return;
    }
    const code = searchParams.get('code')?.trim() ?? '';
    const state = searchParams.get('state')?.trim() ?? '';
    if (!code || !state) {
      setError('feishu_callback_missing_code_or_state');
      return;
    }
    if (hasSubmittedRef.current) {
      return;
    }
    hasSubmittedRef.current = true;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CALLBACK_REQUEST_TIMEOUT_MS);
    let cancelled = false;

    void fetch(`/api/public/workspaces/${encodeURIComponent(workspaceId)}/feishu/oauth/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof payload?.message === 'string' && payload.message
              ? payload.message
              : 'workspace_feishu_callback_failed',
          );
        }
        return payload as CallbackResult;
      })
      .then((result) => {
        if (cancelled) return;
        window.clearTimeout(timeout);
        if (workspaceId) {
          clearFeishuOAuthFlow(workspaceId);
        }
        window.location.replace(result.redirect_path || `/en-US/workspaces/${workspaceId}/connections`);
      })
      .catch((caughtError) => {
        if (cancelled) return;
        window.clearTimeout(timeout);
        if (caughtError instanceof DOMException && caughtError.name === 'AbortError') {
          setError('workspace_feishu_callback_timeout');
          return;
        }
        setError(caughtError instanceof Error ? caughtError.message : 'workspace_feishu_callback_failed');
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchParams, workspaceId]);

  if (error) {
    return <WorkspaceFeishuCallbackFallback workspaceId={workspaceId ?? null} initialError={error} />;
  }

  return (
    <PageState state="loading">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-lg font-semibold">Completing Feishu callback</h2>
        <p className="text-sm text-tertiary">Please wait while we complete the current Feishu flow.</p>
      </div>
    </PageState>
  );
}
