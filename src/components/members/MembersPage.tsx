/**
 * Members Page - Compound Component
 *
 * Root component that provides context to child components.
 */

'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button, buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus } from 'lucide-react';
import { MembersProvider, useMembersContext } from './MembersContext';
import { useMembersList } from '@/lib/hooks/use-members-list';
import { useCanManageMemberGovernance } from '@/lib/hooks/use-permissions';
import { useJoinRequests } from '@/lib/hooks/use-join-requests';
import { ChangeHistoryDrawer } from './ChangeHistoryDrawer';
import { InviteMemberDialog } from './InviteMemberDialog';
import { PeopleTab } from './PeopleTab';
import { GroupsTab } from './GroupsTab';
import { JoinRequestsTab } from './JoinRequestsTab';
import { cn } from '@/lib/utils';
import { parseGovernanceDrilldownContext } from '@/lib/governance-drilldown-context';
import { GovernanceDrilldownBanner } from '@/components/ui/GovernanceDrilldownBanner';

export interface MembersPageProps {
  workspaceId: string;
  projectId: string;
  locale?: string;
}

function MembersPageContent({ workspaceId, projectId, locale = 'en-US' }: MembersPageProps) {
  const t = useTranslations('members');
  const canManageMembers = useCanManageMemberGovernance();
  const searchParams = useSearchParams();
  const drilldownContext = React.useMemo(() => parseGovernanceDrilldownContext(searchParams), [searchParams]);
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;

  const contextValue = useMembersList({ workspaceId, projectId });
  const [activeTab, setActiveTab] = React.useState<'people' | 'requests' | 'groups'>('people');
  const { data: joinRequests = [], isLoading: isLoadingRequests } = useJoinRequests(workspaceId, projectId);
  const peopleCount = contextValue.members.length;
  const joinRequestCount = Array.isArray(joinRequests) ? joinRequests.length : 0;
  const tabFocusTitle = t(`tab_focus.${activeTab}.title`);
  const tabFocusDescription = t(`tab_focus.${activeTab}.description`);

  React.useEffect(() => {
    const requestedTab = searchParams.get('member_tab');
    if (requestedTab === 'people' || requestedTab === 'requests' || requestedTab === 'groups') {
      setActiveTab(requestedTab);
    }
  }, [searchParams]);

  return (
    <MembersProvider value={contextValue}>
      <PageLayout
        header={(
          <PageHeader
            title={t('title')}
            subtitle={t('description')}
            variant="compact"
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="action"
                  className="gap-2"
                  onClick={() => contextValue.setInviteDialogOpen(true)}
                  disabled={!canManageMembers}
                  data-testid="members__invite-btn"
                >
                  <Plus className="h-4 w-4" />
                  {t('invite_member')}
                </Button>
                <Link
                  href={`${basePath}/credentials`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="members__open-credentials"
                >
                  {t('open_credentials')}
                </Link>
                <Link
                  href={`${basePath}/resource-policy`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="members__open-resource-policy"
                >
                  {t('open_resource_policy')}
                </Link>
                <Link
                  href={`${basePath}/audit`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="members__open-audit"
                >
                  {t('open_audit')}
                </Link>
              </div>
            )}
          />
        )}
      >
        {drilldownContext ? (
          <GovernanceDrilldownBanner context={drilldownContext} locale={locale} />
        ) : null}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'people' | 'requests' | 'groups')}
          className="flex min-h-0 min-w-0 flex-1 flex-col rounded-[24px] border border-subtle bg-surface/95 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
        >
          <div className="mb-4 flex flex-col gap-3 rounded-[18px] border border-white/6 bg-white/[0.025] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">{t('title')}</p>
              <p className="text-sm font-medium text-foreground">{tabFocusTitle}</p>
              <p className="text-sm text-secondary">{tabFocusDescription}</p>
            </div>
            <TabsList className="flex-shrink-0 rounded-[18px] border border-white/6 bg-white/[0.04] p-1">
              <TabsTrigger value="people">
                <span className="inline-flex items-center gap-2">
                  <span>{t('tabs.people')}</span>
                  <span className="rounded-full border border-white/8 bg-white/[0.06] px-2 py-0.5 text-[11px] text-tertiary">
                    {peopleCount}
                  </span>
                </span>
              </TabsTrigger>
              <TabsTrigger value="requests">
                <span className="inline-flex items-center gap-2">
                  <span>{t('tabs.requests')}</span>
                  {joinRequestCount > 0 ? (
                    <span
                      className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[11px] text-accent"
                      data-testid="members__requests-badge"
                    >
                      {joinRequestCount}
                    </span>
                  ) : null}
                </span>
              </TabsTrigger>
              <TabsTrigger value="groups">{t('tabs.groups')}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="people" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
            <PeopleTab workspaceId={workspaceId} projectId={projectId} locale={locale} />
          </TabsContent>

          <TabsContent value="requests" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
            <div className="flex-1 min-h-0 overflow-auto overflow-x-auto">
              <JoinRequestsTab
                workspaceId={workspaceId}
                projectId={projectId}
                requests={Array.isArray(joinRequests) ? joinRequests : []}
                loading={isLoadingRequests}
              />
            </div>
          </TabsContent>

          <TabsContent value="groups" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
            <GroupsTab workspaceId={workspaceId} projectId={projectId} />
          </TabsContent>
        </Tabs>

        {/* Detail Drawers and Dialogs with context */}
        <MemberDetailDrawersAndDialogs workspaceId={workspaceId} projectId={projectId} />
      </PageLayout>
    </MembersProvider>
  );
}

/**
 * Internal component for all detail drawers and dialogs
 */
function MemberDetailDrawersAndDialogs({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const context = useMembersContext();

  return (
    <>
      {context.selectedMember && (
        <>
          <ChangeHistoryDrawer
            open={context.historyDrawerOpen}
            onOpenChange={context.setHistoryDrawerOpen}
            memberName={context.selectedMember.name || context.selectedMember.email}
            history={context.changeHistory ?? []}
          />
        </>
      )}

      <InviteMemberDialogWithContext workspaceId={workspaceId} projectId={projectId} />

      <RemoveMemberAlertDialog />
    </>
  );
}

/**
 * Invite dialog with context
 */
function InviteMemberDialogWithContext({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const context = useMembersContext();

  return (
    <InviteMemberDialog
      open={context.inviteDialogOpen}
      onOpenChange={context.setInviteDialogOpen}
      workspaceId={workspaceId}
      projectId={projectId}
    />
  );
}

/**
 * Remove member alert dialog with context
 */
function RemoveMemberAlertDialog() {
  const t = useTranslations('members');
  const context = useMembersContext();

  return (
    <AlertDialog open={!!context.memberToRemove} onOpenChange={(open) => !open && context.setMemberToRemove(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('remove_confirm_title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {context.memberToRemove
              ? t('remove_confirm_message', { name: context.memberToRemove.name || context.memberToRemove.email })
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('permissions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void context.handleConfirmRemove();
            }}
            disabled={context.isRemovingMember}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {context.isRemovingMember ? t('removing') : t('actions.remove_member')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function MembersPage(props: MembersPageProps) {
  return <MembersPageContent {...props} />;
}
