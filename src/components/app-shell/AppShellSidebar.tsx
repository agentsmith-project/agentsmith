'use client';

import * as React from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { useWorkspaceGovernance } from '@/lib/hooks/use-workspace-governance';
import { useProject } from '@/lib/hooks/use-projects-queries';
import {
  LayoutDashboard,
  MessageSquare,
  Wrench,
  FolderOpen,
  Bot,
  Server,
  Database,
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

const PROJECT_MENU_ITEMS = [
  { icon: LayoutDashboard, labelKey: 'overview', href: 'overview' },
  { icon: MessageSquare, labelKey: 'chat', href: 'chat' },
  { icon: Wrench, labelKey: 'workbench', href: 'workbench' },
  { icon: FolderOpen, labelKey: 'sources', href: 'sources' },
  { icon: Database, labelKey: 'userdata', href: 'userdata', permission: 'userdata:storage:read' as const },
  { icon: Bot, labelKey: 'agents', href: 'agents' },
  { icon: Server, labelKey: 'endpoints', href: 'endpoints' },
  { icon: SlidersHorizontal, labelKey: 'resource_policy', href: 'resource-policy', permission: 'project:resource:update' as const },
  { icon: Key, labelKey: 'credentials', href: 'credentials', governance: 'wheel' as const },
  { icon: Users, labelKey: 'members', href: 'members' },
  { icon: Shield, labelKey: 'audit', href: 'audit', permission: 'project:audit:read' as const },
  { icon: BarChart3, labelKey: 'usage', href: 'usage', permission: 'project:usage:read' as const },
  { icon: SettingsIcon, labelKey: 'settings', href: 'settings' },
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
  const canReadAudit = useHasPermission('project:audit:read');
  const canReadUsage = useHasPermission('project:usage:read');
  const canReadUserdata = useHasPermission('userdata:storage:read');
  const canUpdateResourcePolicy = useHasPermission('project:resource:update');

  const workspaceId = params?.workspace as string | undefined;
  const projectId = params?.project as string | undefined;
  const { canViewCredentials } = useWorkspaceGovernance(workspaceId || '');
  const { data: currentProject } = useProject(workspaceId || '', projectId || '');

  const projectMenuItems = currentProject
    ? PROJECT_MENU_ITEMS.filter((item) => {
        if ('permission' in item && item.permission) {
          if (item.permission === 'project:audit:read') return canReadAudit;
          if (item.permission === 'project:usage:read') return canReadUsage;
          if (item.permission === 'userdata:storage:read') return canReadUserdata;
          if (item.permission === 'project:resource:update') return canUpdateResourcePolicy;
        }
        if ('governance' in item && item.governance === 'wheel') {
          return canViewCredentials;
        }
        return true;
      })
    : [];
  const menuItems = currentProject ? projectMenuItems : WORKSPACE_MENU_ITEMS;

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
              href={item.href}
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
        <button
          type="button"
          data-testid="sidebar__collapse-btn"
          onClick={toggleCollapsed}
          className={cn(
            'h-10 w-10 rounded-sm flex items-center justify-center transition-colors duration-200',
            'text-icon-default hover:bg-hover hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
          )}
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>
    </aside>
  );
}
