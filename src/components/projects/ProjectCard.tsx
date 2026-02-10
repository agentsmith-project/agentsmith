'use client';

import type { useTranslations } from 'next-intl';
import { FolderOpen, Globe, Lock, Pin, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import type { Project } from '@/lib/projects/project-view';
import { hasProjectPermission } from '@/lib/projects/project-view';

export function ProjectCard({
  project,
  onClick,
  onSettingsClick,
  onTogglePin,
  adminSummary,
  t,
}: {
  project: Project;
  onClick: () => void;
  onSettingsClick?: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
  adminSummary: string;
  t: ReturnType<typeof useTranslations<'projects'>>;
}) {
  const canManageSettings = hasProjectPermission(project, 'project:settings:manage');
  return (
    <div
      onClick={onClick}
      className="relative group bg-surface border border-border rounded-md p-5 transition-colors duration-200 hover:bg-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
            className="h-8 w-8 rounded-sm hover:bg-surface-high"
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
          className="h-8 w-8 rounded-sm hover:bg-surface-high"
          aria-label={t('actions.unpin')}
          data-testid="projects__pin-btn"
        >
          <Pin className="w-4 h-4 text-icon-default" />
        </Button>
      </div>

      <div className="flex items-start gap-4 mb-4">
        <div className="w-10 h-10 rounded-sm bg-surface-high flex items-center justify-center">
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

      <div className="flex items-center justify-between pt-4 border-t border-border gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-tertiary uppercase tracking-wide">{t('table.project_admin')}</p>
          <p className="text-xs text-primary truncate" title={adminSummary}>
            {adminSummary}
          </p>
        </div>
        <StatusBadge status={project.status === 'active' ? 'active' : 'paused'}>{project.status}</StatusBadge>
      </div>
    </div>
  );
}
