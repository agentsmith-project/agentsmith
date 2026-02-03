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
import { useMembers, useMemberPermissions, useUpdateMemberPermissions, useMemberQuotaOverrides, useUpdateMemberQuotaOverrides, useMemberChangeHistory, useMemberQuotaOverridesHistory, useRemoveMember, usePermissionTemplates, useQuotaTemplates, useBatchApplyPermissionTemplate, useBatchApplyQuotaTemplate } from '@/lib/hooks/use-members';
import { useProject } from '@/lib/hooks/use-projects';
import { useJoinRequests } from '@/lib/hooks/use-join-requests';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import type { Member } from '@/lib/api/endpoints/members';
import type { QuotaOverride } from '@/lib/api/types';

export interface MembersPageProps {
  workspaceId: string;
  projectId: string;
}

export function MembersPage({ workspaceId, projectId }: MembersPageProps) {
  const t = useTranslations('members');
  const canReadMembers = useHasPermission('project:member:read');
  const canManageMembers = useHasPermission('project:member:manage');
  
  const [selectedMember, setSelectedMember] = React.useState<Member | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = React.useState(false);
  const [quotaHistoryDrawerOpen, setQuotaHistoryDrawerOpen] = React.useState(false);
  const [quotaHistoryPage, setQuotaHistoryPage] = React.useState(1);
  const [activeTab, setActiveTab] = React.useState<'members' | 'requests' | 'templates'>('members');
  const [inviteDialogOpen, setInviteDialogOpen] = React.useState(false);
  const [memberToRemove, setMemberToRemove] = React.useState<Member | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = React.useState<string[]>([]);
  const [batchPermDialogOpen, setBatchPermDialogOpen] = React.useState(false);
  const [batchQuotaDialogOpen, setBatchQuotaDialogOpen] = React.useState(false);

  const { data: project } = useProject(workspaceId, projectId);
  const { data: members, isLoading } = useMembers(workspaceId, projectId);
  const { data: joinRequests = [], isLoading: isLoadingRequests } = useJoinRequests(workspaceId, projectId);
  const { data: permissions } = useMemberPermissions(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );
  const { data: quotaOverrides } = useMemberQuotaOverrides(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );
  const { data: changeHistory } = useMemberChangeHistory(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );
  const { data: quotaHistoryData, isLoading: quotaHistoryLoading } = useMemberQuotaOverridesHistory(
    workspaceId,
    projectId,
    selectedMember?.id || '',
    { page: quotaHistoryPage, page_size: 20 },
    { enabled: quotaHistoryDrawerOpen }
  );
  const updatePermissions = useUpdateMemberPermissions(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );
  const updateQuotaOverrides = useUpdateMemberQuotaOverrides(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );
  const removeMember = useRemoveMember(workspaceId, projectId);
  const { data: permissionTemplates = [] } = usePermissionTemplates(workspaceId, projectId);
  const { data: quotaTemplates = [] } = useQuotaTemplates(workspaceId, projectId);
  const batchApplyPermission = useBatchApplyPermissionTemplate(workspaceId, projectId);
  const batchApplyQuota = useBatchApplyQuotaTemplate(workspaceId, projectId);

  const handleEditPermissions = React.useCallback((member: Member) => {
    setSelectedMember(member);
    setDrawerOpen(true);
  }, []);

  const handleSavePermissions = React.useCallback(
    async (permissions: string[], mode: 'template' | 'custom', template?: string) => {
      if (!selectedMember) return;

      try {
        await updatePermissions.mutateAsync({
          permissions,
          mode,
          template: template as 'admin' | 'developer' | 'user' | null | undefined,
        });
        setDrawerOpen(false);
      } catch {
        // Error handled by hook
      }
    },
    [selectedMember, updatePermissions]
  );

  const handleSaveQuota = React.useCallback(
    async (quota: QuotaOverride) => {
      if (!selectedMember) return;

      try {
        await updateQuotaOverrides.mutateAsync(quota);
        setDrawerOpen(false);
      } catch {
        // Error handled by hook
      }
    },
    [selectedMember, updateQuotaOverrides]
  );

  const handleViewHistory = React.useCallback((member: Member) => {
    setSelectedMember(member);
    setHistoryDrawerOpen(true);
  }, []);

  const handleViewQuotaHistory = React.useCallback(() => {
    setDrawerOpen(false);
    setQuotaHistoryPage(1);
    setQuotaHistoryDrawerOpen(true);
  }, []);

  const handleRemove = React.useCallback((member: Member) => {
    setMemberToRemove(member);
  }, []);

  const handleConfirmRemove = React.useCallback(async () => {
    if (!memberToRemove) return;
    try {
      await removeMember.mutateAsync(memberToRemove.id);
      setMemberToRemove(null);
    } catch {
      // Error handled by hook
    }
  }, [memberToRemove, removeMember]);

  const handleBatchApplyPermission = React.useCallback(
    async (templateId: string, permissions: string[], template?: 'admin' | 'developer' | 'user' | null) => {
      await batchApplyPermission.mutateAsync({
        memberIds: selectedMemberIds,
        permissions,
        template: template ?? undefined,
      });
      setSelectedMemberIds([]);
    },
    [selectedMemberIds, batchApplyPermission]
  );

  const handleBatchApplyQuota = React.useCallback(
    async (templateId: string) => {
      await batchApplyQuota.mutateAsync({
        templateId,
        memberIds: selectedMemberIds,
      });
      setSelectedMemberIds([]);
    },
    [selectedMemberIds, batchApplyQuota]
  );

  return (
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
          onClick={() => setInviteDialogOpen(true)}
          disabled={!canManageMembers}
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
                selectedMemberIds.length > 0 && canManageMembers && 'pb-14',
              )}
            >
              {canReadMembers ? (
                <MembersTable
                  data={Array.isArray(members) ? members : []}
                  loading={isLoading}
                  enableSelection={canManageMembers}
                  selectedMemberIds={selectedMemberIds}
                  onSelectionChange={setSelectedMemberIds}
                  onEditPermissions={canManageMembers ? handleEditPermissions : undefined}
                  onRemove={canManageMembers ? handleRemove : undefined}
                  onViewHistory={handleViewHistory}
                />
              ) : (
                <div className="text-center py-8 text-tertiary">
                  <p className="text-sm">{t('no_permission_to_view')}</p>
                </div>
              )}
            </div>

            {/* Selection bar: fixed at bottom of table area, overlays content (no layout shift) */}
            {selectedMemberIds.length > 0 && canManageMembers && (
              <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-subtle bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.15)]">
                <BatchApplyBar
                  overlay
                  selectedCount={selectedMemberIds.length}
                  onApplyPermissionTemplate={() => setBatchPermDialogOpen(true)}
                  onApplyQuotaTemplate={() => setBatchQuotaDialogOpen(true)}
                  onClearSelection={() => setSelectedMemberIds([])}
                />
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

      {/* Member Detail Drawer */}
      {selectedMember && (
        <>
          <MemberDetailDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            member={selectedMember}
            permissions={permissions}
            projectGovernance={project?.governance_json as Record<string, unknown> | undefined}
            quotaOverrides={quotaOverrides}
            workspaceId={workspaceId}
            projectId={projectId}
            permissionTemplates={permissionTemplates}
            quotaTemplates={quotaTemplates}
            onSavePermissions={handleSavePermissions}
            onSaveQuota={handleSaveQuota}
            onViewHistory={() => {
              setDrawerOpen(false);
              setHistoryDrawerOpen(true);
            }}
            onViewQuotaHistory={handleViewQuotaHistory}
          />
          <ChangeHistoryDrawer
            open={historyDrawerOpen}
            onOpenChange={setHistoryDrawerOpen}
            memberName={selectedMember.name || selectedMember.email}
            history={changeHistory ?? []}
          />
          <QuotaOverrideHistoryDrawer
            open={quotaHistoryDrawerOpen}
            onOpenChange={setQuotaHistoryDrawerOpen}
            memberName={selectedMember.name || selectedMember.email}
            items={quotaHistoryData?.items ?? []}
            total={quotaHistoryData?.total ?? 0}
            page={quotaHistoryPage}
            pageSize={20}
            isLoading={quotaHistoryLoading}
            onPageChange={setQuotaHistoryPage}
          />
        </>
      )}

      <InviteMemberDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        workspaceId={workspaceId}
        projectId={projectId}
      />

      <BatchApplyPermissionDialog
        open={batchPermDialogOpen}
        onOpenChange={setBatchPermDialogOpen}
        templates={permissionTemplates}
        selectedCount={selectedMemberIds.length}
        onApply={handleBatchApplyPermission}
      />

      <BatchApplyQuotaDialog
        open={batchQuotaDialogOpen}
        onOpenChange={setBatchQuotaDialogOpen}
        templates={quotaTemplates}
        selectedCount={selectedMemberIds.length}
        onApply={handleBatchApplyQuota}
      />

      <AlertDialog open={!!memberToRemove} onOpenChange={(open) => !open && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('remove_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {memberToRemove
                ? t('remove_confirm_message', { name: memberToRemove.name || memberToRemove.email })
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('permissions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmRemove();
              }}
              disabled={removeMember.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeMember.isPending ? t('removing') : t('actions.remove_member')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
