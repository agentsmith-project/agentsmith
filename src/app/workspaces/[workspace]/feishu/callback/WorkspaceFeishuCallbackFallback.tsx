'use client';

import * as React from 'react';
import Link from 'next/link';
import { PageState } from '@/components/layout/PageState';
import { buttonVariants } from '@/components/ui/button';
import { readFeishuOAuthFlow, type FeishuOAuthFlowIntent } from '@/lib/feishu-oauth-flow';
import { cn } from '@/lib/utils';

type LocaleMessages = {
  failedTitle: string;
  failedDescription: string;
  timeoutTitle: string;
  timeoutDescription: string;
  openConnections: string;
  adminFailedTitle: string;
  adminFailedDescription: string;
  adminTimeoutTitle: string;
  adminTimeoutDescription: string;
  openSettings: string;
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
      failedTitle: '飞书授权失败',
      failedDescription: '系统未能完成本次飞书授权，请返回上一页后重试。',
      timeoutTitle: '飞书授权耗时较长',
      timeoutDescription: '系统仍在等待飞书回调结果。你可以点击下方按钮返回并继续当前流程。',
      openConnections: '打开工作区连接页',
      adminFailedTitle: '飞书验证失败',
      adminFailedDescription: '系统未能完成本次飞书验证，请返回飞书配置页后重试。',
      adminTimeoutTitle: '飞书验证耗时较长',
      adminTimeoutDescription: '系统仍在等待飞书验证结果。你可以点击下方按钮返回并继续当前配置流程。',
      openSettings: '返回飞书配置页',
    };
  }
  return {
    failedTitle: 'Feishu authorization failed',
    failedDescription: 'We could not complete this Feishu authorization. Return and try again.',
    timeoutTitle: 'Feishu authorization is taking longer than expected',
    timeoutDescription: 'We are still waiting for the Feishu callback. You can return below and continue the current flow.',
    openConnections: 'Open workspace connections',
    adminFailedTitle: 'Feishu verification failed',
    adminFailedDescription: 'We could not complete this Feishu verification. Return to Feishu setup and try again.',
    adminTimeoutTitle: 'Feishu verification is taking longer than expected',
    adminTimeoutDescription: 'We are still waiting for the Feishu verification callback. You can return below and continue setup.',
    openSettings: 'Return to Feishu setup',
  };
}

function resolveFallback(intent: FeishuOAuthFlowIntent | null, locale: 'zh-CN' | 'en-US', workspaceId: string | null) {
  if (!workspaceId) {
    return {
      href: `/${locale}/workspaces`,
      label: locale === 'zh-CN' ? '返回工作区列表' : 'Return to workspaces',
    };
  }
  if (intent === 'admin_verify') {
    return {
      href: `/${locale}/workspaces/${workspaceId}/settings/feishu?step=enable`,
      label: resolveMessages(locale).openSettings,
    };
  }
  return {
    href: `/${locale}/workspaces/${workspaceId}/connections?provider=feishu`,
    label: resolveMessages(locale).openConnections,
  };
}

export function WorkspaceFeishuCallbackFallback(props: {
  workspaceId: string | null;
  initialError: string;
  initialIntent?: FeishuOAuthFlowIntent | null;
}) {
  const { workspaceId, initialError, initialIntent = null } = props;
  const locale = React.useMemo(resolveLocale, []);
  const messages = React.useMemo(() => resolveMessages(locale), [locale]);
  const storedFlow = React.useMemo(
    () => (workspaceId ? readFeishuOAuthFlow(workspaceId) : null),
    [workspaceId],
  );
  const resolvedIntent = initialIntent ?? storedFlow?.intent ?? null;
  const fallback = React.useMemo(
    () => resolveFallback(resolvedIntent, locale, workspaceId),
    [resolvedIntent, locale, workspaceId],
  );
  const isTimeout = initialError === 'workspace_feishu_callback_timeout';
  const title = resolvedIntent === 'admin_verify'
    ? (isTimeout ? messages.adminTimeoutTitle : messages.adminFailedTitle)
    : (isTimeout ? messages.timeoutTitle : messages.failedTitle);
  const description = isTimeout
    ? (resolvedIntent === 'admin_verify' ? messages.adminTimeoutDescription : messages.timeoutDescription)
    : (resolvedIntent === 'admin_verify' ? messages.adminFailedDescription : messages.failedDescription);

  return (
    <PageState state="error">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-tertiary">{description}</p>
        <Link
          href={fallback.href}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          {fallback.label}
        </Link>
      </div>
    </PageState>
  );
}
