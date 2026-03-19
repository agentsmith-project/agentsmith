'use client';

import * as React from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageState } from '@/components/layout/PageState';
import { WorkspaceAPI, getApiClient, handleErrorForToast } from '@/lib/api';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

export default function WorkspaceFeishuSettingsCallbackPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('settings');
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const api = React.useMemo(() => new WorkspaceAPI(getApiClient()), []);
  const [error, setError] = React.useState<string | null>(null);

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
    let cancelled = false;
    void api.completeWorkspaceFeishuAuth(workspaceId, { code, state })
      .then((result) => {
        if (cancelled) return;
        router.replace(result.redirect_path || `/${locale}/workspaces/${workspaceId}/settings/feishu?step=enable`);
      })
      .catch((caughtError) => {
        if (cancelled) return;
        handleErrorForToast(caughtError);
        setError(caughtError instanceof Error ? caughtError.message : 'workspace_feishu_callback_failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, locale, router, searchParams, workspaceId]);

  return (
    <PageState state={error ? 'error' : 'loading'}>
      <div className="max-w-md text-center space-y-2">
        <h2 className="text-lg font-semibold">
          {error ? t('feishu_verify_callback_failed_title') : t('feishu_verify_callback_title')}
        </h2>
        <p className="text-sm text-tertiary">
          {error || t('feishu_verify_callback_description')}
        </p>
      </div>
    </PageState>
  );
}
