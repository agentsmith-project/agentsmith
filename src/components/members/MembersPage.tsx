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
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'people' | 'requests' | 'groups')} className="flex-1 min-h-0 flex flex-col min-w-0">
          <TabsList className="flex-shrink-0">
            <TabsTrigger value="people">{t('tabs.people')}</TabsTrigger>
            <TabsTrigger value="requests">{t('tabs.requests')}</TabsTrigger>
            <TabsTrigger value="groups">{t('tabs.groups')}</TabsTrigger>
          </TabsList>

          <TabsContent value="people" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
            <PeopleTab workspaceId={workspaceId} projectId={projectId} />
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
