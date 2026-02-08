'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Settings as SettingsIcon } from 'lucide-react';
import { Topbar } from '@/components/app-shell/Topbar';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { useWorkspace, useWorkspaceMembers } from '@/lib/hooks/use-workspaces';
import { useWorkspaceGovernance } from '@/lib/hooks/use-workspace-governance';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

function formatWorkspaceGroupAlias(role: string): string {
  switch (role) {
    case 'owner':
      return 'governance';
    case 'admin':
      return 'manager';
    case 'developer':
      return 'operator';
    case 'user':
      return 'member';
    default:
      return role;
  }
}

export default function WorkspaceSettingsPage() {
  const params = useParams();
  const t = useTranslations('settings');
  const tErrors = useTranslations('errors');
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const canManageGovernance = useHasWorkspacePermission('workspace:governance:update');
  const { data: currentWorkspace } = useWorkspace(workspaceId ?? '');
  const { data: members = [] } = useWorkspaceMembers(workspaceId ?? '');
  const { getMemberGovernanceGroup, updateMemberGovernanceGroup } = useWorkspaceGovernance(workspaceId ?? '');
  useSyncAuthFromUrl();

  if (!workspaceId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

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
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-tertiary">group: {formatWorkspaceGroupAlias(member.role)}</span>
                        <select
                          data-testid={`ws-settings__governance--${member.id}`}
                          value={getMemberGovernanceGroup(member)}
                          onChange={(event) => updateMemberGovernanceGroup(member.id, event.target.value as 'wheel' | 'user')}
                          disabled={!canManageGovernance}
                          className="h-8 min-w-24 rounded-sm border border-subtle bg-surface px-2 text-xs text-primary disabled:opacity-50"
                        >
                          <option value="wheel">{t('workspace_governance_wheel')}</option>
                          <option value="user">{t('workspace_governance_user')}</option>
                        </select>
                      </div>
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
