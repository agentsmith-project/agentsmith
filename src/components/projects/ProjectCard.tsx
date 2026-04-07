'use client';

import type { useTranslations } from 'next-intl';
import { FolderOpen, Globe, Lock, Pin, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import type { Project } from '@/lib/projects/project-view';
import { canRequestProjectJoin, canSelfJoinProject, hasAnyProjectPermission, isPendingProjectMembership } from '@/lib/projects/project-view';

export function ProjectCard({
  project,
  onClick,
  onSettingsClick,
  onTogglePin,
  onJoinRequest,
  isJoinRequestPending = false,
  adminSummary,
  t,
}: {
  project: Project;
  onClick: () => void;
  onSettingsClick?: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
  onJoinRequest?: () => void;
  isJoinRequestPending?: boolean;
  adminSummary: string;
  t: ReturnType<typeof useTranslations<'projects'>>;
}) {
  const canManageSettings = hasAnyProjectPermission(project, [
    'project:governance:update',
    'project:admins:update',
    'project:lifecycle:update',
  ]);
  const canRequestJoin = canRequestProjectJoin(project) && !!onJoinRequest;
  const canSelfJoin = canSelfJoinProject(project) && !!onJoinRequest;
  const membershipPending = isPendingProjectMembership(project);
  const joinRequestPending = membershipPending || isJoinRequestPending;
  return (
    <div
      onClick={onClick}
      className="relative group rounded-[20px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/20 hover:bg-white/[0.045] hover:shadow-[0_18px_40px_rgba(0,0,0,0.22)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="absolute top-4 right-4 flex items-center gap-1">
        {canManageSettings && onSettingsClick && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onSettingsClick();
            }}
            className="h-8 w-8 rounded-lg hover:bg-white/8"
            aria-label={t('actions.settings')}
          >
            <Settings className="w-4 h-4 text-icon-default" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(e);
          }}
          className="h-8 w-8 rounded-lg hover:bg-white/8"
          aria-label={t('actions.unpin')}
          data-testid="projects__pin-btn"
        >
          <Pin className="w-4 h-4 text-icon-default" />
        </Button>
      </div>

      <div className="flex items-start gap-4 mb-4">
        <div className="w-11 h-11 rounded-xl border border-white/6 bg-white/[0.05] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <FolderOpen className="w-5 h-5 text-icon-default" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-foreground mb-1 truncate">{project.name}</h3>
          <div className="flex items-center gap-2 text-sm">
            {project.visibility === 'public' ? (
              <Globe className="w-3.5 h-3.5 text-icon-default" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-icon-default" />
            )}
            <span className="text-tertiary">{t(`visibility.${project.visibility}`)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/6 pt-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-tertiary uppercase tracking-wide">{t('table.project_admin')}</p>
          <p className="text-xs text-primary truncate" title={adminSummary}>
            {adminSummary}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {membershipPending && !canSelfJoin ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onJoinRequest?.();
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
              onClick={(e) => {
                e.stopPropagation();
                onJoinRequest?.();
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
              onClick={(e) => {
                e.stopPropagation();
                onJoinRequest?.();
              }}
              disabled={joinRequestPending}
              data-testid={`projects__join-project-btn--${project.id}`}
            >
              {joinRequestPending ? t('join_request.joining') : t('join_request.join_now')}
            </Button>
          ) : null}
          <StatusBadge status={project.status === 'active' ? 'active' : 'paused'}>{project.status}</StatusBadge>
        </div>
      </div>
    </div>
  );
}
