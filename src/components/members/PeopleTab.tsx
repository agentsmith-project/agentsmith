'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useCanManageMemberGovernance, useHasPermission } from '@/lib/hooks/use-permissions';
import { useMembersContext } from './MembersContext';
import { MembersTable } from './MembersTable';
import { MemberDetailDrawer } from './MemberDetailDrawer';

export interface PeopleTabProps {
  workspaceId: string;
  projectId: string;
}

function getMemberAccessProfile(member: { permissions?: string[] }) {
  const permissions = Array.isArray(member.permissions) ? member.permissions : [];
  if (
    permissions.includes('project:governance:update')
    || permissions.includes('project:membership:update')
    || permissions.includes('project:admins:update')
    || permissions.includes('project:lifecycle:update')
    || permissions.includes('project:audit:read')
  ) {
    return 'governance';
  }
  if (
    permissions.includes('project:files:update')
    || permissions.includes('project:agent:manage')
    || permissions.includes('project:agent:public')
  ) {
    return 'resource_manage';
  }
  return 'access_only';
}

export function PeopleTab({ workspaceId, projectId }: PeopleTabProps) {
  const PAGE_SIZE = 20;
  const t = useTranslations('members');
  const context = useMembersContext();
  const canReadMembers = useHasPermission('project:membership:update');
  const canManageMembers = useCanManageMemberGovernance();
  const searchParams = useSearchParams();
  const [search, setSearch] = React.useState('');
  const [accessFilter, setAccessFilter] = React.useState<'all' | 'governance' | 'resource_manage' | 'access_only'>(
    'all'
  );
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'active' | 'removed'>('all');
  const [page, setPage] = React.useState(1);
  const deepLinkMemberId = searchParams.get('member_id');
  const initialAuthorization = React.useMemo(() => {
    const resourceType = searchParams.get('authorize_resource_type');
    const resourceId = searchParams.get('authorize_resource_id');
    const action = searchParams.get('authorize_action');
    if (!resourceType || !resourceId || !action) return undefined;
    if (resourceType !== 'endpoint') {
      return undefined;
    }
    return {
      resourceType,
      resourceId,
      action,
    } as const;
  }, [searchParams]);

  const filteredMembers = React.useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return context.members.filter((member) => {
      const matchesSearch = keyword.length === 0
        || member.name?.toLowerCase().includes(keyword)
        || member.email.toLowerCase().includes(keyword);
      const matchesAccess = accessFilter === 'all' || getMemberAccessProfile(member) === accessFilter;
      const matchesStatus = statusFilter === 'all' || member.status === statusFilter;
      return matchesSearch && matchesAccess && matchesStatus;
    });
  }, [context.members, accessFilter, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));

  React.useEffect(() => {
    setPage(1);
  }, [search, accessFilter, statusFilter]);

  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  React.useEffect(() => {
    if (!deepLinkMemberId) return;
    const matched = context.members.find((member) => member.id === deepLinkMemberId);
    if (!matched) return;
    if (context.selectedMember?.id === matched.id && context.drawerOpen) return;
    context.setSelectedMember(matched);
    context.setDrawerOpen(true);
  }, [context, deepLinkMemberId]);

  const pagedMembers = React.useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredMembers.slice(start, start + PAGE_SIZE);
  }, [filteredMembers, page, PAGE_SIZE]);

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
            value={accessFilter}
            onChange={(event) =>
              setAccessFilter(event.target.value as 'all' | 'governance' | 'resource_manage' | 'access_only')
            }
            data-testid="members__role-filter"
          >
            <option value="all">{t('filters.access_all')}</option>
            <option value="governance">{t('filters.access_governance')}</option>
            <option value="resource_manage">{t('filters.access_resource_manage')}</option>
            <option value="access_only">{t('filters.access_only')}</option>
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
              data={pagedMembers}
              loading={context.isLoading}
              enableSelection={canManageMembers}
              selectedMemberIds={context.selectedMemberIds}
              onSelectionChange={context.setSelectedMemberIds}
              onRemove={canManageMembers ? context.handleRemove : undefined}
              onViewHistory={context.handleViewHistory}
            />
          ) : (
            <div className="text-center py-8 text-tertiary">
              <p className="text-sm">{t('no_permission_to_view')}</p>
            </div>
          )}
        </div>

        {canReadMembers && pageCount > 1 && (
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              className="h-8 rounded-md border border-subtle bg-surface px-2 text-xs text-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1}
              data-testid="members__page-prev"
            >
              {t('filters.prev_page')}
            </button>
            <span className="text-xs text-tertiary" data-testid="members__page-info">
              {t('filters.page_info', { page, totalPages: pageCount })}
            </span>
            <button
              type="button"
              className="h-8 rounded-md border border-subtle bg-surface px-2 text-xs text-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
              disabled={page >= pageCount}
              data-testid="members__page-next"
            >
              {t('filters.next_page')}
            </button>
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
            _workspaceId={workspaceId}
            _projectId={projectId}
            effectiveAccessSnapshot={context.effectiveAccessSnapshot}
            authorizationCheckResult={context.authorizationCheckResult}
            isCheckingAuthorization={context.isCheckingAuthorization}
            onRunAuthorizationCheck={async ({ resourceType, resourceId, action }) =>
              context.handleAuthorizationCheck({
                subject: { type: 'user', id: context.selectedMember!.id },
                resource: { type: resourceType, id: resourceId },
                action,
              })
            }
            onViewHistory={() => {
              context.setDrawerOpen(false);
              context.setHistoryDrawerOpen(true);
            }}
            initialAuthorization={initialAuthorization}
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
            _workspaceId={workspaceId}
            _projectId={projectId}
            effectiveAccessSnapshot={context.effectiveAccessSnapshot}
            authorizationCheckResult={context.authorizationCheckResult}
            isCheckingAuthorization={context.isCheckingAuthorization}
            onRunAuthorizationCheck={async ({ resourceType, resourceId, action }) =>
              context.handleAuthorizationCheck({
                subject: { type: 'user', id: context.selectedMember!.id },
                resource: { type: resourceType, id: resourceId },
                action,
              })
            }
            onViewHistory={() => {
              context.setDrawerOpen(false);
              context.setHistoryDrawerOpen(true);
            }}
            initialAuthorization={initialAuthorization}
          />
        </div>
      )}
    </div>
  );
}
