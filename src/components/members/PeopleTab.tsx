'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useCanManageMemberGovernance, useHasPermission } from '@/lib/hooks/use-permissions';
import { useMembersContext } from './MembersContext';
import { MembersTable } from './MembersTable';
import { BatchApplyBar } from './BatchApplyBar';
import { MemberDetailDrawer } from './MemberDetailDrawer';

export interface PeopleTabProps {
  workspaceId: string;
  projectId: string;
}

export function PeopleTab({ workspaceId, projectId }: PeopleTabProps) {
  const t = useTranslations('members');
  const context = useMembersContext();
  const canReadMembers = useHasPermission('project:member:view');
  const canManageMembers = useCanManageMemberGovernance();
  const [search, setSearch] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState<'all' | 'owner' | 'admin' | 'developer' | 'user'>('all');
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'active' | 'removed'>('all');

  const filteredMembers = React.useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return context.members.filter((member) => {
      const matchesSearch = keyword.length === 0
        || member.name?.toLowerCase().includes(keyword)
        || member.email.toLowerCase().includes(keyword);
      const matchesRole = roleFilter === 'all' || member.role === roleFilter;
      const matchesStatus = statusFilter === 'all' || member.status === statusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [context.members, roleFilter, search, statusFilter]);

  return (
    <div className="flex-1 min-h-0 flex gap-0">
      <div className="flex-1 min-h-0 flex flex-col relative">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('filters.search_placeholder')}
            className="h-9 w-[260px]"
            data-testid="members__search-input"
          />
          <select
            className="h-9 rounded-md border border-subtle bg-surface px-3 text-sm text-primary"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as 'all' | 'owner' | 'admin' | 'developer' | 'user')}
            data-testid="members__role-filter"
          >
            <option value="all">{t('filters.role_all')}</option>
            <option value="owner">{t('filters.role_owner')}</option>
            <option value="admin">{t('filters.role_admin')}</option>
            <option value="developer">{t('filters.role_developer')}</option>
            <option value="user">{t('filters.role_user')}</option>
          </select>
          <select
            className="h-9 rounded-md border border-subtle bg-surface px-3 text-sm text-primary"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'removed')}
            data-testid="members__status-filter"
          >
            <option value="all">{t('filters.status_all')}</option>
            <option value="active">{t('filters.status_active')}</option>
            <option value="removed">{t('filters.status_removed')}</option>
          </select>
          <span className="text-xs text-tertiary" data-testid="members__filtered-count">
            {t('filters.result_count', { count: filteredMembers.length })}
          </span>
        </div>

        <div
          className={cn(
            'flex-1 min-h-0 overflow-auto overflow-x-auto',
            canManageMembers && 'pb-14',
          )}
        >
          {canReadMembers ? (
            <MembersTable
              data={filteredMembers}
              loading={context.isLoading}
              enableSelection={canManageMembers}
              selectedMemberIds={context.selectedMemberIds}
              onSelectionChange={context.setSelectedMemberIds}
              onEditPermissions={canManageMembers ? context.handleEditPermissions : undefined}
              onRemove={canManageMembers ? context.handleRemove : undefined}
              onViewHistory={context.handleViewHistory}
            />
          ) : (
            <div className="text-center py-8 text-tertiary">
              <p className="text-sm">{t('no_permission_to_view')}</p>
            </div>
          )}
        </div>

        {context.selectedMemberIds.length > 0 && canManageMembers && (
          <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-subtle bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.15)]">
            <BatchApplyBar
              overlay
              selectedCount={context.selectedMemberIds.length}
              onApplyPermissionTemplate={() => context.setBatchPermDialogOpen(true)}
              onApplyQuotaTemplate={() => context.setBatchQuotaDialogOpen(true)}
              onClearSelection={context.clearSelection}
            />
          </div>
        )}
      </div>

      {context.selectedMember && context.drawerOpen && (
        <div className="hidden xl:block w-[640px] max-w-[45%] min-w-[520px]">
          <MemberDetailDrawer
            open
            embedded
            onOpenChange={context.setDrawerOpen}
            member={context.selectedMember}
            permissions={context.permissions}
            projectGovernance={context.project?.governance_json as Record<string, unknown> | undefined}
            quotaOverrides={context.quotaOverrides}
            _workspaceId={workspaceId}
            _projectId={projectId}
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
        </div>
      )}

      {context.selectedMember && (
        <div className="xl:hidden">
          <MemberDetailDrawer
            open={context.drawerOpen}
            onOpenChange={context.setDrawerOpen}
            member={context.selectedMember}
            permissions={context.permissions}
            projectGovernance={context.project?.governance_json as Record<string, unknown> | undefined}
            quotaOverrides={context.quotaOverrides}
            _workspaceId={workspaceId}
            _projectId={projectId}
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
        </div>
      )}
    </div>
  );
}
