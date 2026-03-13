'use client';

import { PlugZap } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface FeishuOAuthCardProps {
  authConfigured?: boolean;
  callbackUri?: string | null;
  interactiveLoginRequired?: boolean;
  connectPending: boolean;
  onConnect: () => void;
  t: (key: string) => string;
}

export function FeishuOAuthCard({
  authConfigured,
  callbackUri,
  interactiveLoginRequired,
  connectPending,
  onConnect,
  t,
}: FeishuOAuthCardProps) {
  return (
    <div className="rounded-md border border-border bg-surface p-5 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <PlugZap className="w-4 h-4 text-icon-default" />
        {t('feishu_oauth_title')}
      </div>
      <p className="text-sm text-tertiary">{t('feishu_oauth_description')}</p>
      <div className="grid gap-2 text-sm text-tertiary md:grid-cols-2">
        <div>{t('callback_uri_label')}: <code className="text-primary">{callbackUri ?? '—'}</code></div>
        <div>{t('interactive_login_label')}: <span className="text-primary">{interactiveLoginRequired ? t('yes') : t('no')}</span></div>
      </div>
      <div className="pt-2">
        <Button
          variant="action"
          onClick={onConnect}
          disabled={!authConfigured || connectPending}
          data-testid="third-party-accounts__feishu-connect"
        >
          <PlugZap className="w-4 h-4" />
          {t('connect_feishu')}
        </Button>
        {!authConfigured ? (
          <p className="mt-2 text-xs text-warning">{t('feishu_not_configured')}</p>
        ) : null}
      </div>
    </div>
  );
}
