'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageState } from '@/components/layout/PageState';
import { buttonVariants } from '@/components/ui/button';
import { WorkspaceAPI, getApiClient, handleErrorForToast } from '@/lib/api';
import { cn } from '@/lib/utils';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

export default function WorkspaceFeishuSettingsCallbackPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const t = useTranslations('third_party_accounts');
  const settingsT = useTranslations('settings');
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const api = React.useMemo(() => new WorkspaceAPI(getApiClient()), []);
  const [error, setError] = React.useState<string | null>(null);
  const [showFallback, setShowFallback] = React.useState(false);
  const hasSubmittedRef = React.useRef(false);
  const fallbackHref = workspaceId ? `/${locale}/workspaces/${workspaceId}/settings/feishu?step=enable` : `/${locale}/workspaces`;

  React.useEffect(() => {
    const timer = window.setTimeout(() => setShowFallback(true), 4000);
    return () => window.clearTimeout(timer);
  }, []);

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
        window.location.replace(result.redirect_path || `/${locale}/workspaces/${workspaceId}/settings/feishu?step=enable`);
      })
      .catch((caughtError) => {
        if (cancelled) return;
        handleErrorForToast(caughtError);
        setError(caughtError instanceof Error ? caughtError.message : 'workspace_feishu_callback_failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, locale, searchParams, workspaceId]);

  return (
    <PageState state={error ? 'error' : 'loading'}>
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-lg font-semibold">
          {error ? t('workspace_feishu_callback_failed_title') : t('workspace_feishu_callback_title')}
        </h2>
        <p className="text-sm text-tertiary">
          {error || t('workspace_feishu_callback_description')}
        </p>
        {(error || showFallback) ? (
          <Link
            href={fallbackHref}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            {settingsT('feishu_back_to_settings')}
          </Link>
        ) : null}
      </div>
    </PageState>
  );
}
