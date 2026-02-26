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
  Bell,
} from 'lucide-react';

interface AppShellSidebarProps {
  currentValue?: string;
  onChange?: (value: string) => void;
  className?: string;
}

const PROJECT_MENU_ITEMS = [
  { icon: LayoutDashboard, labelKey: 'overview', href: 'overview', permission: 'project:read' as const },
  { icon: MessageSquare, labelKey: 'chat', href: 'chat', permission: 'project:chat:access' as const },
  { icon: Wrench, labelKey: 'notebook', href: 'notebook', permission: 'project:notebook:access' as const },
  { icon: FolderOpen, labelKey: 'files', href: 'files', permission: 'project:source:use' as const },
  { icon: Bot, labelKey: 'agents', href: 'agents', permission: 'project:agent:use' as const },
  { icon: Server, labelKey: 'endpoints', href: 'endpoints', permission: 'project:endpoint:use' as const },
  { icon: Bell, labelKey: 'alerts', href: 'alerts', permission: 'project:alert:view' as const },
  { icon: SlidersHorizontal, labelKey: 'resource_policy', href: 'resource-policy', permission: 'project:resource_policy:manage' as const },
  { icon: Key, labelKey: 'credentials', href: 'credentials', permission: 'project:credential:manage' as const },
  { icon: Users, labelKey: 'members', href: 'members', permission: 'project:member:view' as const },
  { icon: Shield, labelKey: 'audit', href: 'audit', permission: 'project:audit:view' as const },
  { icon: BarChart3, labelKey: 'usage', href: 'usage', permission: 'project:usage:view' as const },
  { icon: SettingsIcon, labelKey: 'settings', href: 'settings', permission: 'project:settings:manage' as const },
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
  const canReadOverview = useHasPermission('project:read');
  const canAccessChat = useHasPermission('project:chat:access');
  const canAccessNotebook = useHasPermission('project:notebook:access');
  const canUseSources = useHasPermission('project:source:use');
  const canUseEndpoints = useHasPermission('project:endpoint:use');
  const canViewAlerts = useHasPermission('project:alert:view');
  const canReadAudit = useHasPermission('project:audit:view');
  const canReadUsage = useHasPermission('project:usage:view');
  const canReadAgents = useHasPermission('project:agent:use');
  const canManageCredentials = useHasPermission('project:credential:manage');
  const canViewMembers = useHasPermission('project:member:view');
  const canManageSettings = useHasPermission('project:settings:manage');
  const canManageResourcePolicy = useCanManageResourcePolicy();

  const workspaceId = params?.workspace as string | undefined;
  const projectId = params?.project as string | undefined;
  const locale = params?.locale as string | undefined;
  const { data: currentProject } = useProject(workspaceId || '', projectId || '');

  const projectMenuItems = currentProject
    ? PROJECT_MENU_ITEMS.filter((item) => {
        if ('permission' in item && item.permission) {
          if (item.permission === 'project:read') return canReadOverview;
          if (item.permission === 'project:chat:access') return canAccessChat;
          if (item.permission === 'project:notebook:access') return canAccessNotebook;
          if (item.permission === 'project:source:use') return canUseSources;
          if (item.permission === 'project:endpoint:use') return canUseEndpoints;
          if (item.permission === 'project:alert:view') return canViewAlerts;
          if (item.permission === 'project:audit:view') return canReadAudit;
          if (item.permission === 'project:usage:view') return canReadUsage;
          if (item.permission === 'project:resource_policy:manage') return canManageResourcePolicy;
          if (item.permission === 'project:agent:use') return canReadAgents;
          if (item.permission === 'project:credential:manage') return canManageCredentials;
          if (item.permission === 'project:member:view') return canViewMembers;
          if (item.permission === 'project:settings:manage') return canManageSettings;
        }
        return true;
      })
    : [];
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
      <nav className="flex-1 px-2 py-4 space-y-1">
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
              {isActive && (
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full"
                  style={{ backgroundColor: 'rgb(var(--accent))' }}
                />
          )}
        </Link>
      );
        })}
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
