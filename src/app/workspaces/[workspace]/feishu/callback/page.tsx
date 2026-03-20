'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { PageState } from '@/components/layout/PageState';
import { buttonVariants } from '@/components/ui/button';
import { WorkspaceAPI, getApiClient, handleErrorForToast } from '@/lib/api';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

type LocaleMessages = {
  title: string;
  description: string;
  failedTitle: string;
  openConnections: string;
};

function resolveLocale(): 'zh-CN' | 'en-US' {
  if (typeof document === 'undefined') {
    return 'en-US';
  }
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  const cookieLocale = match ? decodeURIComponent(match[1]) : '';
  return cookieLocale === 'zh-CN' ? 'zh-CN' : 'en-US';
}

function resolveMessages(locale: 'zh-CN' | 'en-US'): LocaleMessages {
  if (locale === 'zh-CN') {
    return {
      title: '正在完成飞书授权',
      description: '请稍候，系统正在完成当前工作区的飞书流程。',
      failedTitle: '飞书授权失败',
      openConnections: '打开工作区连接页',
    };
  }
  return {
    title: 'Completing Feishu authorization',
    description: 'Please wait while we complete the Feishu flow for this workspace.',
    failedTitle: 'Feishu authorization failed',
    openConnections: 'Open workspace connections',
  };
}

export default function WorkspaceFeishuCallbackPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const api = React.useMemo(() => new WorkspaceAPI(getApiClient()), []);
  const hydrated = useAuthStoreHydration();
  const token = useAuthStore((state) => state.token);
  const [error, setError] = React.useState<string | null>(null);
  const [showFallback, setShowFallback] = React.useState(false);
  const hasSubmittedRef = React.useRef(false);
  const locale = React.useMemo(resolveLocale, []);
  const messages = React.useMemo(() => resolveMessages(locale), [locale]);
  const fallbackHref = workspaceId ? `/${locale}/workspaces/${workspaceId}/connections` : `/${locale}/workspaces`;

  React.useEffect(() => {
    const timer = window.setTimeout(() => setShowFallback(true), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!workspaceId) {
      setError('workspace_not_found');
      return;
    }
    if (!token) {
      setError('authentication_required');
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
        setError(caughtError instanceof Error ? caughtError.message : 'workspace_feishu_callback_failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, hydrated, locale, searchParams, token, workspaceId]);

  return (
    <PageState state={error ? 'error' : 'loading'}>
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-lg font-semibold">
          {error ? messages.failedTitle : messages.title}
        </h2>
        <p className="text-sm text-tertiary">
          {error || messages.description}
        </p>
        {(error || showFallback) ? (
          <Link
            href={fallbackHref}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            {messages.openConnections}
          </Link>
        ) : null}
      </div>
    </PageState>
  );
}
