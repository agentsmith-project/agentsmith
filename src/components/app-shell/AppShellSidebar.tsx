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
  href: string;
  // Permission is a contract token from src/lib/constants/permissions.ts
  // Use '__multi__' for items that require multiple permission checks (handled in filter logic)
  permission:
    | 'project:endpoint:use'
    | 'project:agent:use'
    | 'project:agent:manage'
    | 'project:audit:read'
    | 'project:governance:update'
    | 'project:membership:update'
    | '__multi__';
  section: ProjectMenuSection;
};

const PROJECT_MENU_ITEMS: ProjectMenuItem[] = [
  // Home section
  { icon: LayoutDashboard, labelKey: 'overview', href: 'overview', permission: 'project:endpoint:use', section: 'home' },
  // Use section
  { icon: MessageSquare, labelKey: 'chat', href: 'chat', permission: 'project:endpoint:use', section: 'use' },
  { icon: Wrench, labelKey: 'notebook', href: 'notebook', permission: 'project:endpoint:use', section: 'use' },
  { icon: FolderOpen, labelKey: 'files', href: 'files', permission: 'project:endpoint:use', section: 'use' },
  { icon: BarChart3, labelKey: 'usage', href: 'usage', permission: 'project:endpoint:use', section: 'use' },
  { icon: BookOpen, labelKey: 'api_access_guide', href: 'use-guide', permission: 'project:endpoint:use', section: 'use' },
  // Develop section
  { icon: Bot, labelKey: 'agents', href: 'agents', permission: 'project:agent:use', section: 'develop' },
  // Govern section
  { icon: Server, labelKey: 'endpoints', href: 'endpoints', permission: 'project:endpoint:use', section: 'govern' },
  { icon: SlidersHorizontal, labelKey: 'resource_policy', href: 'resource-policy', permission: 'project:governance:update', section: 'govern' },
  { icon: Key, labelKey: 'credentials', href: 'credentials', permission: 'project:governance:update', section: 'govern' },
  { icon: Users, labelKey: 'members', href: 'members', permission: 'project:membership:update', section: 'govern' },
  { icon: Shield, labelKey: 'audit', href: 'audit', permission: 'project:audit:read', section: 'govern' },
  { icon: SettingsIcon, labelKey: 'settings', href: 'settings', permission: '__multi__', section: 'govern' },
];

const PROJECT_MENU_SECTIONS: Array<{ id: ProjectMenuSection; labelKey: string }> = [
  { id: 'home', labelKey: 'sidebar.home' },
  { id: 'use', labelKey: 'sidebar.use' },
  { id: 'develop', labelKey: 'sidebar.develop' },
  { id: 'govern', labelKey: 'sidebar.govern' },
  { id: 'operate', labelKey: 'sidebar.operate' },
];

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
  const t = useTranslations('nav');
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

  const projectMenuItems = currentProject
    ? PROJECT_MENU_ITEMS.filter((item) => {
        if (item.permission === 'project:endpoint:use') {
          return canUseProject;
        }
        if (item.permission === 'project:agent:use') return canUseAgents || canManageAgents;
        if (item.permission === 'project:agent:manage') return canManageAgents;
        if (item.permission === 'project:audit:read') return canReadAudit;
        if (item.permission === 'project:governance:update') return canManageGovernance;
        if (item.permission === 'project:membership:update') return canManageMembership;
        if (item.href === 'settings') {
          return canReadProjectSettings;
        }
        return true;
      })
    : [];
  const groupedProjectMenuItems = PROJECT_MENU_SECTIONS
    .map((section) => ({
      ...section,
      items: projectMenuItems.filter((item) => item.section === section.id),
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
                    {t(section.labelKey)}
                  </div>
                ) : null}
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = pathname?.split('/').includes(item.href);
                    const label = t(item.labelKey);
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
              const label = t(item.labelKey);
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
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </Button>
      </div>
    </aside>
  );
}
