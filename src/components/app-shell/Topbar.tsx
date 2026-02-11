'use client';

import * as React from 'react';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';
import { useAuthStore, selectCurrentUser } from '@/lib/stores/authStore';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Globe, FolderKanban, ChevronDown, PanelRight } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useRouter, usePathname } from '@/lib/i18n/routing';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { useProjects, useProject } from '@/lib/hooks/use-projects-queries';
import { broadcastProjectLayoutMode, useProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface TopbarProps {
  className?: string;
}

export function Topbar({ className = '' }: TopbarProps) {
  const user = useAuthStore(selectCurrentUser);
  const { clearAuth } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';
  const t = useTranslations('nav');

  const workspaceId = params?.workspace as string | undefined;
  const projectId = params?.project as string | undefined;

  const { data: workspaces } = useWorkspaces();
  const { data: projects } = useProjects(workspaceId || '');
  const { data: currentProject } = useProject(workspaceId || '', projectId || '');
  const { layoutMode, showLayoutToggle } = useProjectLayoutMode();

  // Get current workspace from workspaces list
  const currentWorkspace = React.useMemo(() => {
    if (!workspaceId || !workspaces) return null;
    return workspaces.find((ws) => ws.id === workspaceId) || null;
  }, [workspaceId, workspaces]);

  const handleWorkspaceChange = (newWorkspaceId: string) => {
    // Navigate to the new workspace's project list
    router.push(`/workspaces/${newWorkspaceId}/projects`);
  };

  const handleProjectChange = (newProjectId: string) => {
    if (!workspaceId) return;

    // Navigate to the new project's overview
    router.push(`/workspaces/${workspaceId}/projects/${newProjectId}/overview`);
  };

  const handleGoToProjects = () => {
    if (workspaceId) {
      router.push(`/workspaces/${workspaceId}/projects`);
    }
  };

  const handleLogoClick = () => {
    if (workspaceId) {
      router.push(`/workspaces/${workspaceId}/projects`);
    }
  };

  const handleProfile = () => {
    router.push(`/user/profile`);
  };

  const handleApiKeys = () => {
    router.push(`/user/api-keys`);
  };

  const handleLanguageSwitch = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale });
  };

  const handleLogout = () => {
    clearAuth();
    router.push(`/login`);
  };

  const handleLayoutToggle = React.useCallback(() => {
    const next = layoutMode === 'standard' ? 'ultrawide' : 'standard';
    broadcastProjectLayoutMode(next);
  }, [layoutMode]);

  return (
    <header data-testid="topbar" className={`h-14 flex items-center justify-between px-4 bg-panel border-b border-subtle ${className}`}>
      {/* Left: Brand */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleLogoClick}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm"
          aria-label={t('go_to_projects')}
        >
          <Logo />
        </button>
      </div>

      {/* Center: Workspace / Project (breadcrumb-like) */}
      <div className="flex-1 min-w-0 px-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Workspace Switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger data-testid="topbar__workspace-switcher" className="max-w-[340px] flex items-center gap-2 px-3 h-10 rounded-sm hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-colors">
              <Globe className="w-4 h-4 text-icon-default flex-shrink-0" />
              <span className="text-sm text-foreground truncate">
                {currentWorkspace?.name || t('select_workspace')}
              </span>
              <ChevronDown className="w-4 h-4 text-tertiary flex-shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {workspaces && workspaces.length > 0 ? (
                <>
                  {workspaces.map((ws) => (
                    <DropdownMenuItem key={ws.id} onSelect={() => handleWorkspaceChange(ws.id)}>
                      {ws.name}
                      {currentWorkspace?.id === ws.id && (
                        <span className="ml-auto text-xs text-tertiary">({t('current_workspace')})</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : (
                <DropdownMenuItem disabled>
                  {t('no_workspaces')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {currentProject && (
            <>
              <span className="text-tertiary">/</span>

              {/* Project Switcher */}
              <div className="flex items-center gap-2 max-w-[420px]">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        data-testid="topbar__project-switcher"
                        onClick={handleGoToProjects}
                        className="flex items-center gap-2 px-3 h-10 rounded-sm hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-colors group"
                        aria-label={t('go_to_projects')}
                      >
                        <FolderKanban className="w-4 h-4 text-icon-default flex-shrink-0" />
                        <span className="text-sm text-primary truncate group-hover:text-accent transition-colors">
                          {currentProject.name}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t('go_to_projects')}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenu>
                  <DropdownMenuTrigger className="p-1.5 h-10 rounded-sm hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-colors">
                    <ChevronDown className="w-4 h-4 text-tertiary" />
                  </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {projects?.map((proj) => (
                    <DropdownMenuItem key={proj.id} onSelect={() => handleProjectChange(proj.id)}>
                      {proj.name}
                    </DropdownMenuItem>
                  ))}
                  <div className="h-px bg-border my-1" />
                  <DropdownMenuItem onSelect={handleGoToProjects}>
                    {t('view_all_projects')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-4">
        {workspaceId && projectId && showLayoutToggle ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            onClick={handleLayoutToggle}
            title={layoutMode === 'ultrawide' ? t('switch_to_standard') : t('switch_to_ultrawide')}
            aria-label={layoutMode === 'ultrawide' ? t('switch_to_standard') : t('switch_to_ultrawide')}
            data-testid="topbar__layout-toggle"
            data-state={layoutMode}
          >
            <PanelRight className="h-4 w-4" />
            {layoutMode === 'ultrawide' ? t('layout_ultrawide') : t('layout_standard')}
          </Button>
        ) : null}

        <NotificationCenter />

        {/* User Menu */}
        <UserMenu
          user={user}
          onProfile={handleProfile}
          onApiKeys={handleApiKeys}
          onLanguageSwitch={handleLanguageSwitch}
          currentLocale={locale}
          onLogout={handleLogout}
        />
      </div>
    </header>
  );
}
