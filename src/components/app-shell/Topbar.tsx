'use client';

import * as React from 'react';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';
import { useAuthStore } from '@/lib/stores/authStore';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Globe, FolderKanban, ChevronDown } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useRouter, usePathname } from '@/lib/i18n/routing';
import { useTranslations } from 'next-intl';
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
  const { 
    currentWorkspace, 
    currentProject, 
    workspaces, 
    projects: allProjects, 
    user,
    setWorkspace,
    setProject,
    mockLogout,
  } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';
  const t = useTranslations('nav');

  // Filter projects for current workspace
  const projects = React.useMemo(() => {
    if (!currentWorkspace) return [];
    return allProjects.filter((p) => p.workspace_id === currentWorkspace.id);
  }, [allProjects, currentWorkspace]);

  const handleWorkspaceChange = (workspaceId: string) => {
    // Find the workspace object
    const newWorkspace = workspaces?.find((ws) => ws.id === workspaceId);
    if (!newWorkspace) {
      console.error(`Workspace ${workspaceId} not found`);
      return;
    }

    // Update store: set new workspace and clear current project
    // This will automatically clear currentProject via setWorkspace
    setWorkspace(newWorkspace);
    // Note: We don't update projects here - projects should contain all projects
    // Components will filter by currentWorkspace.id when needed

    // Navigate to the new workspace's project list
    router.push(`/workspaces/${workspaceId}/projects`);
  };

  const handleProjectChange = (projectId: string) => {
    if (!currentWorkspace?.id) return;

    // Find the project object from filtered projects (current workspace only)
    const newProject = projects.find((p) => p.id === projectId);
    if (!newProject) {
      console.error(`Project ${projectId} not found in current workspace`);
      return;
    }

    // Verify project belongs to current workspace (should always be true if filtered correctly)
    if (newProject.workspace_id !== currentWorkspace.id) {
      console.error(`Project ${projectId} does not belong to workspace ${currentWorkspace.id}`);
      return;
    }

    // Update store: set new project
    setProject(newProject);

    // Navigate to the new project's overview
    router.push(`/workspaces/${currentWorkspace.id}/projects/${projectId}/overview`);
  };

  const handleGoToProjects = () => {
    if (currentWorkspace?.id) {
      router.push(`/workspaces/${currentWorkspace.id}/projects`);
    }
  };

  const handleLogoClick = () => {
    if (currentWorkspace?.id) {
      router.push(`/workspaces/${currentWorkspace.id}/projects`);
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
    mockLogout();
    router.push(`/login`);
  };

  return (
    <header className={`h-14 flex items-center justify-between px-4 bg-panel border-b border-subtle ${className}`}>
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
            <DropdownMenuTrigger className="max-w-[340px] flex items-center gap-2 px-3 h-10 rounded-sm hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-colors">
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
