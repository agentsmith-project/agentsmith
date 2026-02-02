'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { MembersTable } from './MembersTable';
import { MemberDetailDrawer } from './MemberDetailDrawer';
import { ChangeHistoryDrawer } from './ChangeHistoryDrawer';
import { JoinRequestsTab } from './JoinRequestsTab';
import { PermissionTemplatesTab } from './PermissionTemplatesTab';
import { useMembers, useMemberPermissions, useUpdateMemberPermissions, useMemberQuotaOverrides, useUpdateMemberQuotaOverrides, useMemberChangeHistory } from '@/lib/hooks/use-members';
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
  const [activeTab, setActiveTab] = React.useState<'members' | 'requests' | 'templates'>('members');

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
          template: template as any,
        });
        setDrawerOpen(false);
      } catch (error) {
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
      } catch (error) {
        // Error handled by hook
      }
    },
    [selectedMember, updateQuotaOverrides]
  );

  const handleViewHistory = React.useCallback((member: Member) => {
    setSelectedMember(member);
    setHistoryDrawerOpen(true);
  }, []);

  const handleRemove = React.useCallback((member: Member) => {
    // TODO: Implement remove member
    console.log('Remove member', member);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-tertiary mt-1">
            {t('description')}
          </p>
        </div>
        <Button variant="action" className="gap-2">
          <Plus className="h-4 w-4" />
          {t('invite_member')}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="members">{t('tabs.members')}</TabsTrigger>
          <TabsTrigger value="requests">{t('tabs.requests')}</TabsTrigger>
          <TabsTrigger value="templates">{t('tabs.templates')}</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          {canReadMembers ? (
            <MembersTable
              data={Array.isArray(members) ? members : []}
              loading={isLoading}
              onEditPermissions={canManageMembers ? handleEditPermissions : undefined}
              onRemove={canManageMembers ? handleRemove : undefined}
              onViewHistory={handleViewHistory}
            />
          ) : (
            <div className="text-center py-8 text-tertiary">
              <p className="text-sm">{t('no_permission_to_view')}</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="requests" className="mt-4">
          <JoinRequestsTab
            workspaceId={workspaceId}
            projectId={projectId}
            requests={Array.isArray(joinRequests) ? joinRequests : []}
            loading={isLoadingRequests}
          />
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <PermissionTemplatesTab
            workspaceId={workspaceId}
            projectId={projectId}
          />
        </TabsContent>
      </Tabs>

      {/* Member Detail Drawer */}
      {selectedMember && (
        <>
          <MemberDetailDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            member={selectedMember}
            permissions={permissions as any}
            quotaOverrides={quotaOverrides as any}
            workspaceId={workspaceId}
            projectId={projectId}
            onSavePermissions={handleSavePermissions}
            onSaveQuota={handleSaveQuota}
            onViewHistory={() => {
              setDrawerOpen(false);
              setHistoryDrawerOpen(true);
            }}
          />
          <ChangeHistoryDrawer
            open={historyDrawerOpen}
            onOpenChange={setHistoryDrawerOpen}
            memberName={selectedMember.name || selectedMember.email}
            history={(changeHistory as any) || []}
          />
        </>
      )}
    </div>
  );
}
