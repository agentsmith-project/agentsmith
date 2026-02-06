/**
 * Members Page - Compound Component
 *
 * Root component that provides context to child components.
 */

'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import { MembersProvider, useMembersContext } from './MembersContext';
import { useMembersList } from '@/lib/hooks/use-members-list';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { useJoinRequests } from '@/lib/hooks/use-join-requests';
import { MembersTable } from './MembersTable';
import { MemberDetailDrawer } from './MemberDetailDrawer';
import { ChangeHistoryDrawer } from './ChangeHistoryDrawer';
import { InviteMemberDialog } from './InviteMemberDialog';
import { QuotaOverrideHistoryDrawer } from './QuotaOverrideHistoryDrawer';
import { JoinRequestsTab } from './JoinRequestsTab';
import { TemplatesTab } from './TemplatesTab';
import { BatchApplyBar } from './BatchApplyBar';
import { BatchApplyPermissionDialog } from './BatchApplyPermissionDialog';
import { BatchApplyQuotaDialog } from './BatchApplyQuotaDialog';

export interface MembersPageProps {
  workspaceId: string;
  projectId: string;
}

function MembersPageContent({ workspaceId, projectId }: MembersPageProps) {
  const t = useTranslations('members');
  const canReadMembers = useHasPermission('project:member:read');
  const canManageMembers = useHasPermission('project:member:manage');

  const { data: joinRequests = [], isLoading: isLoadingRequests } = useJoinRequests(workspaceId, projectId);
  const contextValue = useMembersList({ workspaceId, projectId });
  const [activeTab, setActiveTab] = React.useState<'members' | 'requests' | 'templates'>('members');

  return (
    <MembersProvider value={contextValue}>
      <div className="flex-1 min-h-0 flex flex-col gap-6">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
            <p className="text-sm text-tertiary mt-1">
              {t('description')}
            </p>
          </div>
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
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'members' | 'requests' | 'templates')} className="flex-1 min-h-0 flex flex-col min-w-0">
          <TabsList className="flex-shrink-0">
            <TabsTrigger value="members">{t('tabs.members')}</TabsTrigger>
            <TabsTrigger value="requests">{t('tabs.requests')}</TabsTrigger>
            <TabsTrigger value="templates">{t('tabs.templates')}</TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
            {/* Table + selection bar (bar overlays bottom, no layout shift) */}
            <div className="flex-1 min-h-0 flex flex-col relative">
              <div
                className={cn(
                  'flex-1 min-h-0 overflow-auto overflow-x-auto transition-[padding] duration-200',
                  contextValue.selectedMemberIds.length > 0 && canManageMembers && 'pb-14',
                )}
              >
                {canReadMembers ? (
                  <MembersTableWithContext />
                ) : (
                  <div className="text-center py-8 text-tertiary">
                    <p className="text-sm">{t('no_permission_to_view')}</p>
                  </div>
                )}
              </div>

              {/* Selection bar: fixed at bottom of table area, overlays content (no layout shift) */}
              {contextValue.selectedMemberIds.length > 0 && canManageMembers && (
                <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-subtle bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.15)]">
                  <BatchApplyBarWithContext overlay />
                </div>
              )}
            </div>
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

          <TabsContent value="templates" className="flex-1 min-h-0 mt-4 flex flex-col min-w-0 data-[state=inactive]:hidden">
            <div className="flex-1 min-h-0 overflow-auto overflow-x-auto">
              <TemplatesTab workspaceId={workspaceId} projectId={projectId} />
            </div>
          </TabsContent>
        </Tabs>

        {/* Detail Drawers and Dialogs with context */}
        <MemberDetailDrawersAndDialogs workspaceId={workspaceId} projectId={projectId} />
      </div>
    </MembersProvider>
  );
}

/**
 * Internal component that uses context for MembersTable
 */
function MembersTableWithContext() {
  const context = useMembersContext();
  const canManageMembers = useHasPermission('project:member:manage');

  return (
    <MembersTable
      data={context.members}
      loading={context.isLoading}
      enableSelection={canManageMembers}
      selectedMemberIds={context.selectedMemberIds}
      onSelectionChange={context.setSelectedMemberIds}
      onEditPermissions={canManageMembers ? context.handleEditPermissions : undefined}
      onRemove={canManageMembers ? context.handleRemove : undefined}
      onViewHistory={context.handleViewHistory}
    />
  );
}

/**
 * Internal component that uses context for BatchApplyBar
 */
function BatchApplyBarWithContext({ overlay }: { overlay?: boolean }) {
  const context = useMembersContext();

  return (
    <BatchApplyBar
      overlay={overlay}
      selectedCount={context.selectedMemberIds.length}
      onApplyPermissionTemplate={() => context.setBatchPermDialogOpen(true)}
      onApplyQuotaTemplate={() => context.setBatchQuotaDialogOpen(true)}
      onClearSelection={context.clearSelection}
    />
  );
}

/**
 * Internal component for all detail drawers and dialogs
 */
function MemberDetailDrawersAndDialogs({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const context = useMembersContext();

  return (
    <>
      {/* Member Detail Drawer */}
      {context.selectedMember && (
        <>
          <MemberDetailDrawer
            open={context.drawerOpen}
            onOpenChange={context.setDrawerOpen}
            member={context.selectedMember}
            permissions={context.permissions}
            projectGovernance={context.project?.governance_json as Record<string, unknown> | undefined}
            quotaOverrides={context.quotaOverrides}
            workspaceId={workspaceId}
            projectId={projectId}
            permissionTemplates={context.permissionTemplates}
            quotaTemplates={context.quotaTemplates}
            onSavePermissions={context.handleSavePermissions}
            onSaveQuota={context.handleSaveQuota}
            onViewHistory={() => {
              context.setDrawerOpen(false);
              context.setHistoryDrawerOpen(true);
            }}
            onViewQuotaHistory={context.handleViewQuotaHistory}
          />
          <ChangeHistoryDrawer
            open={context.historyDrawerOpen}
            onOpenChange={context.setHistoryDrawerOpen}
            memberName={context.selectedMember.name || context.selectedMember.email}
            history={context.changeHistory ?? []}
          />
          <QuotaOverrideHistoryDrawer
            open={context.quotaHistoryDrawerOpen}
            onOpenChange={context.setQuotaHistoryDrawerOpen}
            memberName={context.selectedMember.name || context.selectedMember.email}
            items={context.quotaHistoryData?.items ?? []}
            total={context.quotaHistoryData?.total ?? 0}
            page={context.quotaHistoryPage}
            pageSize={20}
            isLoading={context.quotaHistoryLoading}
            onPageChange={context.setQuotaHistoryPage}
          />
        </>
      )}

      <InviteMemberDialogWithContext workspaceId={workspaceId} projectId={projectId} />

      <BatchApplyPermissionDialogWithContext />

      <BatchApplyQuotaDialogWithContext />

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
 * Batch permission dialog with context
 */
function BatchApplyPermissionDialogWithContext() {
  const context = useMembersContext();

  return (
    <BatchApplyPermissionDialog
      open={context.batchPermDialogOpen}
      onOpenChange={context.setBatchPermDialogOpen}
      templates={context.permissionTemplates}
      selectedCount={context.selectedMemberIds.length}
      onApply={context.handleBatchApplyPermission}
    />
  );
}

/**
 * Batch quota dialog with context
 */
function BatchApplyQuotaDialogWithContext() {
  const context = useMembersContext();

  return (
    <BatchApplyQuotaDialog
      open={context.batchQuotaDialogOpen}
      onOpenChange={context.setBatchQuotaDialogOpen}
      templates={context.quotaTemplates}
      selectedCount={context.selectedMemberIds.length}
      onApply={context.handleBatchApplyQuota}
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
