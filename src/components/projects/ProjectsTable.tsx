'use client';

import { useMemo } from 'react';
import type { useTranslations } from 'next-intl';
import { Eye, FolderOpen, Globe, Lock, MoreVertical, Pin, PinOff, Settings, Trash2 } from 'lucide-react';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';

import type { Project } from '@/lib/projects/project-view';
import { buildProjectAdminSummary, hasAnyProjectPermission } from '@/lib/projects/project-view';
import { getMemberAccessGroupLabel } from '@/lib/governance/member-groups';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { canRequestProjectJoin, canSelfJoinProject, isPendingProjectMembership } from '@/lib/projects/project-view';

const columnHelper = createColumnHelper<Project>();

type ProjectEntryActionClusterProps = {
  project: Project;
  onProjectClick: (project: Project) => void;
  onSettingsClick: (project: Project) => void;
  onDeleteClick: (project: Project) => void;
  onJoinRequest: (project: Project) => void;
  pendingJoinRequestIds: ReadonlySet<string>;
  canDeleteProjectByWorkspacePermission: boolean;
  t: ReturnType<typeof useTranslations<'projects'>>;
  showOpenButton?: boolean;
  openButtonTestId?: string;
  settingsButtonTestId?: string;
  moreButtonTestId?: string;
  className?: string;
  iconButtonClassName?: string;
};

export function ProjectEntryActionCluster({
  project,
  onProjectClick,
  onSettingsClick,
  onDeleteClick,
  onJoinRequest,
  pendingJoinRequestIds,
  canDeleteProjectByWorkspacePermission,
  t,
  showOpenButton = true,
  openButtonTestId,
  settingsButtonTestId,
  moreButtonTestId,
  className = 'flex items-center gap-1',
  iconButtonClassName = 'h-8 w-8 rounded-sm hover:bg-surface-high',
}: ProjectEntryActionClusterProps) {
  const canDeleteProject = canDeleteProjectByWorkspacePermission;
  const canManageSettings = hasAnyProjectPermission(project, [
    'project:governance:update',
    'project:admins:update',
    'project:lifecycle:update',
  ]);
  const canRequestJoin = canRequestProjectJoin(project);
  const canSelfJoin = canSelfJoinProject(project);
  const membershipPending = isPendingProjectMembership(project);
  const joinRequestPending = membershipPending || pendingJoinRequestIds.has(project.id);

  return (
    <div className={className}>
      {joinRequestPending && !canSelfJoin ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onJoinRequest(project);
          }}
          disabled={joinRequestPending}
          data-testid={`projects__join-request-btn--${project.id}`}
        >
          {t('join_request.pending')}
        </Button>
      ) : canRequestJoin ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onJoinRequest(project);
          }}
          data-testid={`projects__join-request-btn--${project.id}`}
        >
          {t('join_request.action')}
        </Button>
      ) : canSelfJoin ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onJoinRequest(project);
          }}
          disabled={joinRequestPending}
          data-testid={`projects__join-project-btn--${project.id}`}
        >
          {joinRequestPending ? t('join_request.joining') : t('join_request.join_now')}
        </Button>
      ) : showOpenButton ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(event) => {
            event.stopPropagation();
            onProjectClick(project);
          }}
          className={iconButtonClassName}
          aria-label={t('actions.open')}
          data-testid={openButtonTestId}
        >
          <Eye className="w-4 h-4 text-icon-default" />
        </Button>
      ) : null}
      {canManageSettings ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(event) => {
            event.stopPropagation();
            onSettingsClick(project);
          }}
          className={iconButtonClassName}
          aria-label={t('actions.settings')}
          data-testid={settingsButtonTestId ?? 'projects__settings-btn'}
        >
          <Settings className="w-4 h-4 text-icon-default" />
        </Button>
      ) : null}
      {canDeleteProject ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(event) => event.stopPropagation()}
              className={iconButtonClassName}
              aria-label="More actions"
              data-testid={moreButtonTestId}
            >
              <MoreVertical className="w-4 h-4 text-icon-default" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onDeleteClick(project);
              }}
              className="text-error focus:text-error"
            >
              <Trash2 className="w-4 h-4" />
              {t('actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function ProjectsTable({
  projects,
  onProjectClick,
  onSettingsClick,
  onDeleteClick,
  onTogglePin,
  onJoinRequest,
  pendingJoinRequestIds,
  canDeleteProjectByWorkspacePermission,
  memberNameById,
  t,
}: {
  projects: Project[];
  onProjectClick: (project: Project) => void;
  onSettingsClick: (project: Project) => void;
  onDeleteClick: (project: Project) => void;
  onTogglePin: (projectId: string, e: React.MouseEvent) => void;
  onJoinRequest: (project: Project) => void;
  pendingJoinRequestIds: ReadonlySet<string>;
  canDeleteProjectByWorkspacePermission: boolean;
  memberNameById: Map<string, string>;
  t: ReturnType<typeof useTranslations<'projects'>>;
}) {
  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'pin',
        header: '',
        cell: ({ row }) => {
          const isPinned = !!row.original.pinned;
          return (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(e) => onTogglePin(row.original.id, e)}
              className="h-8 w-8 rounded-sm hover:bg-surface-high"
              aria-label={isPinned ? t('actions.unpin') : t('actions.pin')}
              data-testid="projects__pin-btn"
            >
              {isPinned ? <PinOff className="w-4 h-4 text-icon-default" /> : <Pin className="w-4 h-4 text-icon-default" />}
            </Button>
          );
        },
      }),
      columnHelper.accessor('name', {
        header: t('table.name'),
        cell: (info) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onProjectClick(info.row.original);
            }}
            className="flex items-center gap-3 text-left hover:opacity-90"
          >
            <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center">
              <FolderOpen className="w-4 h-4 text-icon-default" />
            </div>
            <span className="font-medium text-foreground">{info.getValue()}</span>
          </button>
        ),
      }),
      columnHelper.display({
        id: 'project_admin',
        header: t('table.project_admin'),
        cell: ({ row }) => {
          const summary = buildProjectAdminSummary(row.original, memberNameById);
          return (
            <span className="text-primary truncate block max-w-[260px]" title={summary}>
              {summary}
            </span>
          );
        },
      }),
      columnHelper.accessor('visibility', {
        header: t('table.visibility'),
        cell: (info) => (
          <div className="flex items-center gap-2">
            {info.getValue() === 'public' ? (
              <>
                <Globe className="w-4 h-4 text-icon-default" />
                <span className="text-primary">{t('visibility.public')}</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4 text-icon-default" />
                <span className="text-primary">{t('visibility.private')}</span>
              </>
            )}
          </div>
        ),
      }),
      columnHelper.display({
        id: 'access_group',
        header: t('table.role'),
        cell: ({ row }) => (
          <span className="text-primary">
            {getMemberAccessGroupLabel({
              groups: row.original.groups,
            })}
          </span>
        ),
      }),
      columnHelper.accessor('status', {
        header: t('table.status'),
        cell: (info) => (
          <StatusBadge status={info.getValue() === 'active' ? 'active' : 'paused'}>
            {info.getValue()}
          </StatusBadge>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <ProjectEntryActionCluster
            project={row.original}
            onProjectClick={onProjectClick}
            onSettingsClick={onSettingsClick}
            onDeleteClick={onDeleteClick}
            onJoinRequest={onJoinRequest}
            pendingJoinRequestIds={pendingJoinRequestIds}
            canDeleteProjectByWorkspacePermission={canDeleteProjectByWorkspacePermission}
            t={t}
          />
        ),
      }),
    ],
    [
      canDeleteProjectByWorkspacePermission,
      memberNameById,
      onDeleteClick,
      onJoinRequest,
      onProjectClick,
      onSettingsClick,
      onTogglePin,
      pendingJoinRequestIds,
      t,
    ],
  );

  const table = useReactTable({
    data: projects,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (projects.length === 0) {
    return (
      <div className="text-center py-12 bg-surface border border-border rounded-md">
        <p className="text-tertiary">{t('no_results')}</p>
      </div>
    );
  }

  return <DataTable table={table} testId="projects__table" onRowClick={onProjectClick} />;
}
