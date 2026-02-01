/**
 * Members Page
 *
 * Manage project members and their roles.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper } from '@tanstack/react-table';
import { Users, UserPlus, Shield } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';

interface MembersPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

interface Member {
  id: string;
  name?: string;
  email: string;
  role: string;
  status: 'active' | 'pending' | 'inactive';
  joined?: string;
  avatar?: string;
}

const columnHelper = createColumnHelper<Member>();

const memberColumns = [
  columnHelper.display({
    id: 'user',
    header: 'Name',
    cell: (info) => {
      const member = info.row.original;
      const initials = member.name?.[0] || member.email?.[0] || '?';
      return (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-hover flex items-center justify-center text-foreground text-xs font-medium">
            {member.avatar || initials}
          </div>
          <div className="flex flex-col">
            <span className="text-foreground font-medium">{member.name || member.email}</span>
            {member.name && (
              <span className="text-xs text-tertiary">{member.email}</span>
            )}
          </div>
        </div>
      );
    },
  }),
  columnHelper.accessor('email', {
    header: 'Email',
    cell: (info) => (
      <span className="text-tertiary text-sm">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('role', {
    header: 'Role',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-icon-default" />
        <span className="text-tertiary text-sm capitalize">
          {info.getValue()}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('joined', {
    header: 'Joined',
    cell: (info) => {
      const value = info.getValue();
      return (
        <span className="text-tertiary text-sm">
          {value ? new Date(value).toLocaleDateString() : '-'}
        </span>
      );
    },
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => {
      const status = info.getValue();
      const statusMap: Record<string, 'active' | 'paused' | 'error' | 'success' | 'warning'> = {
        active: 'active',
        pending: 'warning',
        inactive: 'paused',
      };
      return <StatusBadge status={statusMap[status] || 'active'} />;
    },
  }),
];

export default function MembersPage({ params }: MembersPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const currentProject = useAuthStore((state) => state.currentProject);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['members', workspaceId, projectId],
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/members`);
      return response.json();
    },
    enabled: !!workspaceId && !!projectId,
  });

  const members = membersData?.items || [];

  const table = useReactTable({
    data: members,
    columns: memberColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!resolvedParams || !currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-tertiary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Members</h1>
          <p className="text-sm text-tertiary mt-1">Manage project members and their roles</p>
        </div>
        <button className="flex items-center gap-2 px-4 h-10 bg-hover hover:bg-hover/80 text-foreground rounded-sm border border-subtle transition-colors">
          <UserPlus className="w-4 h-4" />
          Invite Member
        </button>
      </div>

      {membersLoading ? (
        <PageLoading />
      ) : members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members yet"
          description="Invite team members to collaborate"
          action={{
            label: 'Invite Member',
            onClick: () => {},
          }}
        />
      ) : (
        <DataTable table={table} />
      )}
    </div>
  );
}
