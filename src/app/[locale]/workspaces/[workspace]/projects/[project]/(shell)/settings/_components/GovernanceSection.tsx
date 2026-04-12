'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';

interface GovernanceSectionProps {
  canManageGovernance: boolean;
  canManageMembership: boolean;
  canReadAudit: boolean;
  locale: string;
  projectId: string;
  settingsT: (key: string) => string;
  workspaceId: string;
}

export function GovernanceSection({
  canManageGovernance,
  canManageMembership,
  canReadAudit,
  locale,
  projectId,
  settingsT,
  workspaceId,
}: GovernanceSectionProps) {
  return (
    <section className="space-y-4 py-5" data-testid="settings__governance-section">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">{settingsT('governance_title')}</h2>
        <p className="text-sm text-tertiary">{settingsT('governance_help')}</p>
      </div>
      {(canReadAudit || canManageMembership || canManageGovernance) ? (
        <div className="flex flex-wrap gap-2">
          {canReadAudit ? (
            <Button asChild variant="action" size="sm" data-testid="settings__governance-link--audit">
              <Link href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/audit`}>
                {settingsT('open_audit')}
              </Link>
            </Button>
          ) : null}
          {canManageMembership ? (
            <Button asChild variant="outline" size="sm" data-testid="settings__governance-link--members">
              <Link href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/members`}>
                {settingsT('open_members')}
              </Link>
            </Button>
          ) : null}
          {canManageGovernance ? (
            <Button asChild variant="outline" size="sm" data-testid="settings__governance-link--credentials">
              <Link href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/credentials`}>
                {settingsT('open_credentials')}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
