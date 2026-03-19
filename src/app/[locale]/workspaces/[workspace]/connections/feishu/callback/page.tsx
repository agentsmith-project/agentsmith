'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { WorkspaceAPI, getApiClient, handleErrorForToast } from '@/lib/api';
import { PageState } from '@/components/layout/PageState';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

export default function WorkspaceFeishuCallbackPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const t = useTranslations('third_party_accounts');
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const api = React.useMemo(() => new WorkspaceAPI(getApiClient()), []);
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
    let cancelled = false;
    void api.completeWorkspaceFeishuAuth(workspaceId, { code, state })
      .then((result) => {
        if (cancelled) return;
        window.location.replace(result.redirect_path || `/${locale}/workspaces/${workspaceId}/connections`);
      })
      .catch((caughtError) => {
        if (cancelled) return;
        handleErrorForToast(caughtError);
        setError(caughtError instanceof Error ? caughtError.message : 'feishu_callback_failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, locale, searchParams, workspaceId]);

  return (
    <PageState state={error ? 'error' : 'loading'}>
      <div className="max-w-md text-center space-y-2">
        <h2 className="text-lg font-semibold">
          {error ? t('workspace_feishu_callback_failed_title') : t('workspace_feishu_callback_title')}
        </h2>
        <p className="text-sm text-tertiary">
          {error || t('workspace_feishu_callback_description')}
        </p>
      </div>
    </PageState>
  );
}
