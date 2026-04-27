'use client';

import * as React from 'react';
import { ChevronDown, FolderKanban, Globe, PanelRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';

import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { SurfaceThemeToggle } from '@/components/theme/SurfaceThemeToggle';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { broadcastProjectLayoutMode, useProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';
import { useGovernableProjects, useProject, useProjects } from '@/lib/hooks/use-projects-queries';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { useRouter, usePathname } from '@/lib/i18n/routing';
import { useQueryClient } from '@tanstack/react-query';
import {
  buildProjectSurfacePath,
  listSwitchableProjects,
  resolveDefaultProjectSurfaceHref,
  shouldUseGovernableProjectSwitcher,
} from '@/lib/projects/project-surface-access';
import { selectCurrentUser, useAuthStore } from '@/lib/stores/authStore';
import { buildWorkspaceOverviewPath } from '@/lib/workspaces/workspace-paths';
import { buildWorkspaceSelectionPath, clearLoginContinuationState, persistLogoutIntent } from '@/lib/auth/invite-handoff';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';

import { Logo } from './Logo';
import { UserMenu } from './UserMenu';

interface TopbarProps {
  className?: string;
  workspaceId?: string;
  projectId?: string;
}

function stripLocalePrefix(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/|$)/, '');
}

function extractWorkspaceProjectIds(pathname: string): { workspaceId?: string; projectId?: string } {
  const normalizedPathname = stripLocalePrefix(pathname);
  const match = normalizedPathname.match(/^\/workspaces\/([^/]+)(?:\/projects\/([^/]+))?/);
  if (!match) {
    return {};
  }
  return {
    workspaceId: match[1],
    projectId: match[2],
  };
}

function resolveTopbarHomeHref(params: {
  pathname: string;
  workspaceId?: string;
  locale: string;
}): string {
  if (params.workspaceId) {
    return `/workspaces/${params.workspaceId}`;
  }

  const normalizedPathname = stripLocalePrefix(params.pathname);
  if (normalizedPathname.startsWith('/system')) {
    return '/system/workspaces';
  }

  return buildWorkspaceOverviewPath();
}

const quietSwitcherClassName =
  'inline-flex h-8 items-center gap-2 rounded-sm border border-transparent bg-transparent px-1.5 text-left text-secondary transition-[background-color,border-color,color] duration-150 hover:bg-surface-low/20 hover:text-foreground';

export function Topbar({ className = '', workspaceId: workspaceIdProp, projectId: projectIdProp }: TopbarProps) {
  const user = useAuthStore(selectCurrentUser);
  const { clearAuth } = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';
  const t = useTranslations('nav');

  const routeIds = React.useMemo(() => extractWorkspaceProjectIds(pathname), [pathname]);
  const workspaceId =
    validateWorkspaceParam(workspaceIdProp) ??
    validateWorkspaceParam(params?.workspace) ??
    routeIds.workspaceId;
  const projectId =
    validateProjectParam(projectIdProp) ??
    validateProjectParam(params?.project) ??
    routeIds.projectId;
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
  const currentWorkspaceLabel = currentWorkspace?.name || workspaceId || t('select_workspace');

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
    router.push(resolveTopbarHomeHref({ pathname, workspaceId, locale }));
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

  const handleWorkspacePersonalContext = () => {
    if (!workspaceId) return;
    router.push(`/workspaces/${workspaceId}/context`);
  };

  const handleProjectPersonalContext = () => {
    if (!workspaceId || !projectId) return;
    router.push(`/workspaces/${workspaceId}/projects/${projectId}/my-context`);
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
    persistLogoutIntent();
    void queryClient.cancelQueries();
    queryClient.clear();
    clearLoginContinuationState();
    clearAuth();
    router.replace(buildWorkspaceSelectionPath());
  };

  const handleLayoutToggle = React.useCallback(() => {
    const next = layoutMode === 'standard' ? 'ultrawide' : 'standard';
    broadcastProjectLayoutMode(next);
  }, [layoutMode]);

  return (
    <header
      data-testid='topbar'
      className={`sticky top-0 z-30 flex h-11 items-center justify-between gap-4 border-b border-border/12 bg-background/94 px-4 md:px-5 ${className}`}
    >
      <div className='flex min-w-0 items-center gap-3'>
        <button
          onClick={handleLogoClick}
          className='rounded-sm px-0.5 py-0.5 text-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20'
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
            <span className='truncate text-[13px] text-foreground'>{currentWorkspaceLabel}</span>
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
            <div className='hidden h-3.5 w-px bg-border/10 md:block' />
            <div className='flex min-w-0 items-center gap-2'>
              <DropdownMenu>
                <DropdownMenuTrigger
                  data-testid='topbar__project-switcher'
                  className={`${quietSwitcherClassName} max-w-[22rem] text-[13px]`}
                >
                  <FolderKanban className='h-4 w-4 flex-shrink-0 text-icon-default' />
                  <span className='truncate text-sm text-foreground'>{currentProject.name}</span>
                  <ChevronDown className='ml-auto h-4 w-4 flex-shrink-0 text-tertiary' />
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
            className='h-8 gap-2 border-transparent px-2.5 text-secondary hover:text-foreground'
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

        <SurfaceThemeToggle
          compact
          dataTestId='topbar__theme-toggle'
          optionTestIdPrefix='topbar__theme'
          className='shrink-0'
        />

        <NotificationCenter />

        <UserMenu
          user={user}
          onProfile={handleProfile}
          onWorkspacePersonalContext={workspaceId ? handleWorkspacePersonalContext : undefined}
          onProjectPersonalContext={workspaceId && projectId ? handleProjectPersonalContext : undefined}
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
