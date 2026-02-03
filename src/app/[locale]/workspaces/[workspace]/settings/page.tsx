'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Settings as SettingsIcon } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { Topbar } from '@/components/app-shell/Topbar';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';

export default function WorkspaceSettingsPage() {
  const params = useParams();
  const t = useTranslations('settings');
  const workspaceId = params?.workspace as string;
  const currentWorkspace = useAuthStore((state) => state.currentWorkspace);
  useSyncAuthFromUrl();

  const workspace = currentWorkspace || { id: workspaceId, name: workspaceId, role: 'owner' as const };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Topbar />

      <main className="flex-1 max-w-4xl mx-auto w-full p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <SettingsIcon className="w-6 h-6 text-icon-default" />
            {t('title')}
          </h1>
          <p className="text-tertiary">Workspace configuration</p>
        </div>

        <div className="p-6 rounded-md border border-border bg-surface">
          <h2 className="font-semibold text-foreground mb-4">General</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-primary mb-2">Workspace Name</label>
              <p className="text-primary">{workspace.name}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 p-6 rounded-md border border-subtle bg-surface-high">
          <p className="text-tertiary text-sm">Workspace members and advanced settings coming soon.</p>
        </div>
      </main>
    </div>
  );
}
