'use client';

import * as React from 'react';
import { ChevronDown, FolderKanban, Globe, PanelRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';

import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { broadcastProjectLayoutMode, useProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';
import { useGovernableProjects, useProject, useProjects } from '@/lib/hooks/use-projects-queries';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { useRouter, usePathname } from '@/lib/i18n/routing';
import {
  buildProjectSurfacePath,
  listSwitchableProjects,
  resolveDefaultProjectSurfaceHref,
  shouldUseGovernableProjectSwitcher,
} from '@/lib/projects/project-surface-access';
import { selectCurrentUser, useAuthStore } from '@/lib/stores/authStore';

import { Logo } from './Logo';
import { UserMenu } from './UserMenu';

interface TopbarProps {
  className?: string;
}

function stripLocalePrefix(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/|$)/, '');
}

function resolveTopbarHomeHref(params: {
  pathname: string;
  workspaceId?: string;
}): string {
  if (params.workspaceId) {
    return `/workspaces/${params.workspaceId}`;
  }

  const normalizedPathname = stripLocalePrefix(params.pathname);
  if (normalizedPathname.startsWith('/system')) {
    return '/system/workspaces';
  }

  return '/workspaces';
}

const quietSwitcherClassName =
  'inline-flex h-9 items-center gap-2 rounded-md border border-transparent bg-transparent px-2.5 text-left text-primary transition-[background-color,border-color,color] duration-150 hover:bg-surface-low/80 hover:text-foreground';

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
  const canManageWorkspaceGovernance = useHasWorkspacePermission('workspace:governance:update');

  const { data: workspaces } = useWorkspaces();
  const { data: projects } = useProjects(workspaceId || '');
  const { data: currentProject } = useProject(workspaceId || '', projectId || '');
  const shouldIncludeGovernableProjects = React.useMemo(
    () =>
      shouldUseGovernableProjectSwitcher({
        discoverableProjects: projects ?? [],
        currentProject,
        canManageWorkspaceGovernance,
      }),
    [canManageWorkspaceGovernance, currentProject, projects],
  );
  const { data: governableProjects } = useGovernableProjects(workspaceId || '', {
    enabled: Boolean(workspaceId) && shouldIncludeGovernableProjects,
  });
  const { layoutMode, showLayoutToggle } = useProjectLayoutMode();
  const switchableProjects = React.useMemo(
    () =>
      listSwitchableProjects({
        discoverableProjects: projects ?? [],
        governableProjects: governableProjects ?? [],
        currentProject,
        includeGovernableProjects: shouldIncludeGovernableProjects,
      }),
    [currentProject, governableProjects, projects, shouldIncludeGovernableProjects],
  );

  const currentWorkspace = React.useMemo(() => {
    if (!workspaceId || !workspaces) return null;
    return workspaces.find((ws) => ws.id === workspaceId) || null;
  }, [workspaceId, workspaces]);

  const handleWorkspaceChange = (newWorkspaceId: string) => {
    router.push(`/workspaces/${newWorkspaceId}`);
  };

  const handleProjectChange = (newProjectId: string) => {
    if (!workspaceId) return;
    const nextProject = switchableProjects.find((project) => project.id === newProjectId);
    const defaultHref = resolveDefaultProjectSurfaceHref(nextProject);
    if (!defaultHref) return;
    router.push(buildProjectSurfacePath(locale, workspaceId, newProjectId, defaultHref));
  };

  const handleGoToProjects = () => {
    if (workspaceId) {
      router.push(`/workspaces/${workspaceId}`);
    }
  };

  const handleLogoClick = () => {
    router.push(resolveTopbarHomeHref({ pathname, workspaceId }));
  };

  const handleProfile = () => {
    const searchParams = new URLSearchParams();
    if (workspaceId) searchParams.set('workspace', workspaceId);
    if (projectId) searchParams.set('project', projectId);
    const query = searchParams.toString();
    router.push(query ? `/user/profile?${query}` : '/user/profile');
  };

  const handleApiKeys = () => {
    router.push('/user/api-keys');
  };

  const handleWorkspaceIntegrations = () => {
    if (!workspaceId) return;
    router.push(`/workspaces/${workspaceId}/connections`);
  };

  const handlePersonalConnections = () => {
    router.push('/user/third-party-accounts');
  };

  const handleLanguageSwitch = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale });
  };

  const handleLogout = () => {
    clearAuth();
    router.push('/login/workspace');
  };

  const handleLayoutToggle = React.useCallback(() => {
    const next = layoutMode === 'standard' ? 'ultrawide' : 'standard';
    broadcastProjectLayoutMode(next);
  }, [layoutMode]);

  return (
    <header
      data-testid='topbar'
      className={`sticky top-0 z-30 flex h-12 items-center justify-between gap-4 border-b border-border/45 bg-background px-4 md:px-5 ${className}`}
    >
      <div className='flex min-w-0 items-center gap-3'>
        <button
          onClick={handleLogoClick}
          className='rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20'
          aria-label={t('go_to_projects')}
        >
          <Logo />
        </button>
      </div>

      <div className='flex min-w-0 flex-1 items-center gap-2'>
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid='topbar__workspace-switcher'
            className={`${quietSwitcherClassName} max-w-[20rem]`}
          >
            <Globe className='h-4 w-4 flex-shrink-0 text-icon-default' />
            <span className='truncate text-sm text-foreground'>{currentWorkspace?.name || t('select_workspace')}</span>
            <ChevronDown className='ml-auto h-4 w-4 flex-shrink-0 text-tertiary' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            {workspaces && workspaces.length > 0 ? (
              workspaces.map((ws) => (
                <DropdownMenuItem key={ws.id} onSelect={() => handleWorkspaceChange(ws.id)}>
                  {ws.name}
                  {currentWorkspace?.id === ws.id ? (
                    <span className='ml-auto text-xs text-tertiary'>{t('current_workspace')}</span>
                  ) : null}
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>{t('no_workspaces')}</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {currentProject ? (
          <>
            <div className='hidden h-4 w-px bg-border/30 md:block' />
            <div className='flex min-w-0 items-center gap-2'>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      data-testid='topbar__project-switcher'
                      onClick={handleGoToProjects}
                      className={`${quietSwitcherClassName} max-w-[22rem]`}
                      aria-label={t('go_to_projects')}
                    >
                      <FolderKanban className='h-4 w-4 flex-shrink-0 text-icon-default' />
                      <span className='truncate text-sm text-foreground'>{currentProject.name}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('go_to_projects')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <DropdownMenu>
                <DropdownMenuTrigger
                  data-testid='topbar__project-switcher-menu'
                  className='inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent bg-transparent text-tertiary transition-[background-color,border-color,color] duration-150 hover:bg-surface-low/80 hover:text-foreground'
                >
                  <ChevronDown className='h-4 w-4' />
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start'>
                  {switchableProjects.map((proj) => (
                    <DropdownMenuItem key={proj.id} onSelect={() => handleProjectChange(proj.id)}>
                      {proj.name}
                    </DropdownMenuItem>
                  ))}
                  <div className='my-1 h-px bg-border/50' />
                  <DropdownMenuItem onSelect={handleGoToProjects}>{t('view_all_projects')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        ) : null}
      </div>

      <div className='flex items-center gap-2'>
        {workspaceId && projectId && showLayoutToggle ? (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-8 gap-2'
            onClick={handleLayoutToggle}
            title={layoutMode === 'ultrawide' ? t('switch_to_standard') : t('switch_to_ultrawide')}
            aria-label={layoutMode === 'ultrawide' ? t('switch_to_standard') : t('switch_to_ultrawide')}
            data-testid='topbar__layout-toggle'
            data-state={layoutMode}
          >
            <PanelRight className='h-4 w-4' />
            {layoutMode === 'ultrawide' ? t('layout_ultrawide') : t('layout_standard')}
          </Button>
        ) : null}

        <NotificationCenter />

        <UserMenu
          user={user}
          onProfile={handleProfile}
          onWorkspaceIntegrations={workspaceId ? handleWorkspaceIntegrations : undefined}
          onPersonalConnections={handlePersonalConnections}
          onApiKeys={handleApiKeys}
          onLanguageSwitch={handleLanguageSwitch}
          currentLocale={locale}
          onLogout={handleLogout}
        />
      </div>
    </header>
  );
}
