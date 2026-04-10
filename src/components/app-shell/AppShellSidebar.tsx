'use client';

import * as React from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  useHasWorkspacePermission,
  useProjectOverviewCapabilities,
} from '@/lib/hooks/use-permissions';
import { useProject } from '@/lib/hooks/use-projects-queries';
import { Button } from '@/components/ui/button';
import { listSidebarProjectRoutePolicies } from '@/lib/routes/project-route-policy-manifest';
import {
  LayoutDashboard,
  LucideIcon,
  MessageSquare,
  BookOpen,
  Wrench,
  FolderOpen,
  Bot,
  Server,
  Key,
  Users,
  Settings as SettingsIcon,
  FolderKanban,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  BarChart3,
  SlidersHorizontal,
  ScrollText,
} from 'lucide-react';

interface AppShellSidebarProps {
  currentValue?: string;
  onChange?: (value: string) => void;
  className?: string;
}

type ProjectMenuSection = 'home' | 'use' | 'develop' | 'govern' | 'operate';

type ProjectMenuItem = {
  icon: LucideIcon;
  labelKey: string;
  labelNamespace: 'nav' | 'context_store';
  href: string;
  section: ProjectMenuSection;
  navOrder: number;
};

const PROJECT_MENU_SECTIONS: Array<{ id: ProjectMenuSection; labelKey: string }> = [
  { id: 'home', labelKey: 'sidebar.home' },
  { id: 'use', labelKey: 'sidebar.use' },
  { id: 'develop', labelKey: 'sidebar.develop' },
  { id: 'govern', labelKey: 'sidebar.govern' },
  { id: 'operate', labelKey: 'sidebar.operate' },
];

const PROJECT_MENU_ICON_BY_HREF: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  chat: MessageSquare,
  notebook: Wrench,
  files: FolderOpen,
  usage: BarChart3,
  'use-guide': BookOpen,
  agents: Bot,
  endpoints: Server,
  'resource-policy': SlidersHorizontal,
  context: ScrollText,
  credentials: Key,
  members: Users,
  audit: Shield,
  settings: SettingsIcon,
};

type WorkspaceMenuItem = {
  icon: LucideIcon;
  labelKey: string;
  href: string;
  visible: boolean;
  isActive: (pathname: string | null | undefined, baseWorkspacePath: string | null) => boolean;
};

export function AppShellSidebar({
  currentValue: _currentValue,
  onChange: _onChange,
  className = '',
}: AppShellSidebarProps) {
  const params = useParams();
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tContextStore = useTranslations('context_store');
  const [collapsed, setCollapsed] = React.useState(false);
  const {
    canUseProject,
    canUseAgents,
    canManageAgents,
    canReadAudit,
    canManageGovernance,
    canManageMembership,
    canReadProjectSettings,
  } = useProjectOverviewCapabilities();
  const canReadWorkspace = useHasWorkspacePermission('workspace:read');
  const canManageWorkspaceGovernance = useHasWorkspacePermission('workspace:governance:update');

  const workspaceId = params?.workspace as string | undefined;
  const projectId = params?.project as string | undefined;
  const locale = params?.locale as string | undefined;
  const { data: currentProject } = useProject(workspaceId || '', projectId || '');

  const routePolicies = React.useMemo(
    () => listSidebarProjectRoutePolicies(),
    [],
  );

  const projectMenuItems = currentProject
    ? routePolicies
        .filter((policy) => {
          if (policy.href === 'overview') return canUseProject;
          if (policy.href === 'chat' || policy.href === 'notebook' || policy.href === 'files' || policy.href === 'usage' || policy.href === 'use-guide') {
            return canUseProject;
          }
          if (policy.href === 'agents') return canUseAgents || canManageAgents;
          if (policy.href === 'endpoints') return canUseProject || canManageGovernance;
          if (policy.href === 'resource-policy' || policy.href === 'context' || policy.href === 'credentials') {
            return canManageGovernance;
          }
          if (policy.href === 'members') return canManageMembership;
          if (policy.href === 'audit') return canReadAudit;
          if (policy.href === 'settings') {
            return canReadProjectSettings;
          }
          return true;
        })
        .map((policy) => ({
          icon: PROJECT_MENU_ICON_BY_HREF[policy.href] ?? LayoutDashboard,
          labelKey: policy.navLabelKey,
          labelNamespace: policy.navLabelNamespace,
          href: policy.href,
          section: policy.navSection,
          navOrder: policy.navOrder,
        }))
    : [];
  const groupedProjectMenuItems = PROJECT_MENU_SECTIONS
    .map((section) => ({
      ...section,
      items: projectMenuItems
        .filter((item) => item.section === section.id)
        .sort((left, right) => left.navOrder - right.navOrder),
    }))
    .filter((section) => section.items.length > 0);
  const workspaceMenuItems: WorkspaceMenuItem[] = [
    {
      icon: LayoutDashboard,
      labelKey: 'sidebar.workspace_home',
      href: '.',
      visible: canReadWorkspace,
      isActive: (currentPath, baseWorkspacePath) => Boolean(currentPath && baseWorkspacePath && currentPath === baseWorkspacePath),
    },
    {
      icon: FolderKanban,
      labelKey: 'sidebar.projects',
      href: '../projects',
      visible: canReadWorkspace,
      isActive: (currentPath, baseWorkspacePath) =>
        Boolean(currentPath && baseWorkspacePath && currentPath.startsWith(`${baseWorkspacePath}/projects`)),
    },
    {
      icon: SettingsIcon,
      labelKey: 'settings',
      href: '../../settings',
      visible: canManageWorkspaceGovernance,
      isActive: (currentPath, baseWorkspacePath) =>
        Boolean(currentPath && baseWorkspacePath && currentPath === `${baseWorkspacePath}/settings`),
    },
  ];
  const visibleWorkspaceMenuItems = workspaceMenuItems.filter((item) => item.visible);

  const baseProjectPath =
    locale && workspaceId && projectId
      ? `/${locale}/workspaces/${workspaceId}/projects/${projectId}`
      : null;
  const baseWorkspacePath =
    locale && workspaceId
      ? `/${locale}/workspaces/${workspaceId}`
      : null;

  const resolveItemHref = React.useCallback(
    (href: string) => {
      if (href.startsWith('/')) return href;
      if (currentProject && baseProjectPath) return `${baseProjectPath}/${href}`;
      if (!currentProject && baseWorkspacePath) {
        if (href === '.') return baseWorkspacePath;
        if (href === '../projects') return `${baseWorkspacePath}/projects`;
        if (href === '../../settings') return `${baseWorkspacePath}/settings`;
      }
      return href;
    },
    [baseProjectPath, baseWorkspacePath, currentProject],
  );

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('mbos.sidebar.collapsed');
      if (raw === '1') setCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('mbos.sidebar.collapsed', next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        collapsed ? 'w-[var(--sidebar-width-collapsed)]' : 'w-[var(--sidebar-width)]',
        'border-r border-white/6 bg-[linear-gradient(180deg,rgba(23,24,27,0.98),rgba(19,20,23,0.96))] shadow-[inset_-1px_0_0_rgba(255,255,255,0.02)] flex flex-col transition-[width] duration-200',
        className,
      )}
    >
      <nav className="flex-1 overflow-y-auto px-2.5 py-5">
        {currentProject ? (
          <div className="space-y-4">
            {groupedProjectMenuItems.map((section) => (
              <div key={section.id} data-testid={`sidebar__section--${section.id}`}>
                {!collapsed ? (
                  <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-tertiary/90">
                    {tNav(section.labelKey)}
                  </div>
                ) : null}
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = pathname?.split('/').includes(item.href);
                    const label = item.labelNamespace === 'context_store'
                      ? tContextStore(item.labelKey)
                      : tNav(item.labelKey);
                    return (
                      <Link
                        key={item.href}
                        href={resolveItemHref(item.href)}
                        data-testid={`sidebar__nav-item--${item.href}`}
                        title={collapsed ? label : undefined}
                        className={cn(
                          'relative flex items-center h-10 rounded-xl text-sm transition-colors duration-200',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                          collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                          isActive
                            ? 'border border-accent/20 bg-accent/10 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                            : 'border border-transparent text-primary hover:border-white/5 hover:bg-white/5 hover:text-foreground',
                        )}
                      >
                        <item.icon className={cn('w-5 h-5', isActive ? 'text-accent' : 'text-icon-default')} />
                        <span className={cn('truncate', collapsed && 'hidden')}>{label}</span>
                        {isActive ? (
                          <div
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-7 rounded-r-full"
                            style={{ backgroundColor: 'rgb(var(--accent))' }}
                          />
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {visibleWorkspaceMenuItems.map((item) => {
              const isActive = currentProject
                ? pathname?.split('/').includes(item.href)
                : item.isActive(pathname, baseWorkspacePath);
              const label = tNav(item.labelKey);
              return (
                <Link
                  key={item.href}
                  href={resolveItemHref(item.href)}
                  data-testid={`sidebar__nav-item--${item.labelKey.replace('sidebar.', '')}`}
                  title={collapsed ? label : undefined}
                  className={cn(
                    'relative flex items-center h-10 rounded-xl text-sm transition-colors duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                    collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                    isActive
                      ? 'border border-accent/20 bg-accent/10 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                      : 'border border-transparent text-primary hover:border-white/5 hover:bg-white/5 hover:text-foreground',
                  )}
                >
                  <item.icon className={cn('w-5 h-5', isActive ? 'text-accent' : 'text-icon-default')} />
                  <span className={cn('truncate', collapsed && 'hidden')}>{label}</span>
                  {isActive ? (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full"
                      style={{ backgroundColor: 'rgb(var(--accent))' }}
                    />
                  ) : null}
                </Link>
              );
            })}
          </div>
        )}
      </nav>

      <div className={cn('p-2.5 border-t border-white/6', collapsed ? 'flex justify-center' : 'flex justify-end')}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid="sidebar__collapse-btn"
          onClick={toggleCollapsed}
          className={cn('h-10 w-10 rounded-xl text-icon-default hover:bg-white/6 hover:text-foreground')}
          aria-label={collapsed ? tNav('sidebar.expand') : tNav('sidebar.collapse')}
          title={collapsed ? tNav('sidebar.expand') : tNav('sidebar.collapse')}
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </Button>
      </div>
    </aside>
  );
}
