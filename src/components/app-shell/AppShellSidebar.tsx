'use client';

import * as React from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useCanManageResourcePolicy, useHasPermission } from '@/lib/hooks/use-permissions';
import { useProject } from '@/lib/hooks/use-projects-queries';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  LucideIcon,
  MessageSquare,
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
  Monitor,
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
    | 'project:settings:manage'
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
  // Develop section
  { icon: Bot, labelKey: 'agents', href: 'agents', permission: 'project:agent:use', section: 'develop' },
  // Govern section
  { icon: Server, labelKey: 'endpoints', href: 'endpoints', permission: 'project:endpoint:use', section: 'govern' },
  { icon: SlidersHorizontal, labelKey: 'resource_policy', href: 'resource-policy', permission: 'project:settings:manage', section: 'govern' },
  { icon: Key, labelKey: 'credentials', href: 'credentials', permission: 'project:settings:manage', section: 'govern' },
  { icon: Users, labelKey: 'members', href: 'members', permission: 'project:settings:manage', section: 'govern' },
  { icon: BarChart3, labelKey: 'usage', href: 'usage', permission: 'project:endpoint:use', section: 'govern' },
  { icon: Shield, labelKey: 'audit', href: 'audit', permission: 'project:endpoint:use', section: 'govern' },
  { icon: SettingsIcon, labelKey: 'settings', href: 'settings', permission: 'project:settings:manage', section: 'govern' },
  // Operate section
  // Runtime Console is accessible for users with endpoint use or settings manage.
  { icon: Monitor, labelKey: 'runtime_console', href: 'runtime-console', permission: '__multi__', section: 'operate' },
];

const PROJECT_MENU_SECTIONS: Array<{ id: ProjectMenuSection; labelKey: string }> = [
  { id: 'home', labelKey: 'sidebar.home' },
  { id: 'use', labelKey: 'sidebar.use' },
  { id: 'develop', labelKey: 'sidebar.develop' },
  { id: 'govern', labelKey: 'sidebar.govern' },
  { id: 'operate', labelKey: 'sidebar.operate' },
];

const WORKSPACE_MENU_ITEMS = [
  { icon: FolderKanban, labelKey: 'sidebar.projects', href: '../projects' },
  { icon: SettingsIcon, labelKey: 'settings', href: '../../settings' },
];

export function AppShellSidebar({
  currentValue: _currentValue,
  onChange: _onChange,
  className = '',
}: AppShellSidebarProps) {
  const params = useParams();
  const pathname = usePathname();
  const t = useTranslations('nav');
  const [collapsed, setCollapsed] = React.useState(false);
  const canReadOverview = useHasPermission('project:endpoint:use');
  const canAccessChat = useHasPermission('project:endpoint:use');
  const canAccessNotebook = useHasPermission('project:endpoint:use');
  const canUseSources = useHasPermission('project:endpoint:use');
  const canUseEndpoints = useHasPermission('project:endpoint:use');
  const canViewAlerts = useHasPermission('project:endpoint:use');
  const canReadAudit = useHasPermission('project:endpoint:use');
  const canReadUsage = useHasPermission('project:endpoint:use');
  const canReadAgents = useHasPermission('project:agent:use');
  const canManageCredentials = useHasPermission('project:settings:manage');
  const canViewMembers = useHasPermission('project:settings:manage');
  const canManageSettings = useHasPermission('project:settings:manage');
  const canManageResourcePolicy = useCanManageResourcePolicy();

  const workspaceId = params?.workspace as string | undefined;
  const projectId = params?.project as string | undefined;
  const locale = params?.locale as string | undefined;
  const { data: currentProject } = useProject(workspaceId || '', projectId || '');

  const projectMenuItems = currentProject
    ? PROJECT_MENU_ITEMS.filter((item) => {
        if (item.permission === 'project:endpoint:use') {
          return (
            canReadOverview
            || canAccessChat
            || canAccessNotebook
            || canUseSources
            || canUseEndpoints
            || canViewAlerts
            || canReadAudit
            || canReadUsage
          );
        }
        if (item.permission === 'project:agent:use') return canReadAgents;
        if (item.permission === 'project:settings:manage') {
          return canManageResourcePolicy || canManageCredentials || canViewMembers || canManageSettings;
        }
        if (item.permission === '__multi__') {
          return canReadUsage || canViewAlerts || canManageSettings;
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
  const menuItems = currentProject ? projectMenuItems : WORKSPACE_MENU_ITEMS;

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
        'border-r border-subtle bg-panel flex flex-col transition-[width] duration-200',
        className,
      )}
    >
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {currentProject ? (
          <div className="space-y-4">
            {groupedProjectMenuItems.map((section) => (
              <div key={section.id} data-testid={`sidebar__section--${section.id}`}>
                {!collapsed ? (
                  <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">
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
                          'relative flex items-center h-10 rounded-sm text-sm transition-colors duration-200',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                          collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                          isActive
                            ? 'bg-hover text-foreground'
                            : 'text-primary hover:bg-hover hover:text-foreground',
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
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {menuItems.map((item) => {
              const isActive = pathname?.split('/').includes(item.href);
              const label = t(item.labelKey);
              return (
                <Link
                  key={item.href}
                  href={resolveItemHref(item.href)}
                  data-testid={`sidebar__nav-item--${item.labelKey.replace('sidebar.', '')}`}
                  title={collapsed ? label : undefined}
                  className={cn(
                    'relative flex items-center h-10 rounded-sm text-sm transition-colors duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                    collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                    isActive
                      ? 'bg-hover text-foreground'
                      : 'text-primary hover:bg-hover hover:text-foreground',
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

      <div className={cn('p-2 border-t border-subtle', collapsed ? 'flex justify-center' : 'flex justify-end')}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid="sidebar__collapse-btn"
          onClick={toggleCollapsed}
          className={cn('h-10 w-10 rounded-sm text-icon-default hover:bg-hover hover:text-foreground')}
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </Button>
      </div>
    </aside>
  );
}
