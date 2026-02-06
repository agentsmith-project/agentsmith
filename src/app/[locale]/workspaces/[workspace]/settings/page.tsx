'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Settings as SettingsIcon } from 'lucide-react';
import { Topbar } from '@/components/app-shell/Topbar';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';
import { useWorkspace, useWorkspaceMembers } from '@/lib/hooks/use-workspaces';

export default function WorkspaceSettingsPage() {
  const params = useParams();
  const t = useTranslations('settings');
  const workspaceId = params?.workspace as string;
  const { data: currentWorkspace } = useWorkspace(workspaceId);
  const { data: members = [] } = useWorkspaceMembers(workspaceId);
  useSyncAuthFromUrl();

  const workspace = currentWorkspace || { id: workspaceId, name: workspaceId };

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          <Topbar />

          <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-4 md:px-5 md:py-5">
            <div className="mb-5">
              <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
                <SettingsIcon className="w-6 h-6 text-icon-default" />
                {t('workspace_title')}
              </h1>
              <p className="text-tertiary">{t('workspace_subtitle')}</p>
            </div>

            <div className="p-5 rounded-xl border border-border bg-surface">
              <h2 className="font-semibold text-foreground mb-4">{t('workspace_general')}</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-secondary mb-2">{t('workspace_name')}</label>
                  <p className="text-primary" data-testid="ws-settings__name">{workspace.name}</p>
                </div>
              </div>
            </div>

            <div className="mt-5 p-5 rounded-xl border border-border bg-surface" data-testid="ws-settings__members">
              <h2 className="font-semibold text-foreground mb-4">{t('workspace_members')}</h2>
              {members.length === 0 ? (
                <p className="text-tertiary text-sm">{t('workspace_members_empty')}</p>
              ) : (
                <div className="space-y-3">
                  {members.map((member) => (
                    <div key={member.id} className="flex items-center justify-between rounded-md border border-subtle bg-surface-high px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm text-primary truncate">{member.name}</p>
                        <p className="text-xs text-tertiary truncate">{member.email}</p>
                      </div>
                      <span className="text-xs text-tertiary capitalize">{member.role}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
