'use client';

import * as React from 'react';
import { useAuthStore } from '@/lib/stores/authStore';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  MessageSquare,
  Wrench,
  FolderOpen,
  Bot,
  Server,
  Users,
  Settings as SettingsIcon,
  FolderKanban,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

interface AppShellSidebarProps {
  currentValue?: string;
  onChange?: (value: string) => void;
  className?: string;
}

const PROJECT_MENU_ITEMS = [
  { icon: LayoutDashboard, label: 'Overview', href: 'overview' },
  { icon: MessageSquare, label: 'Chat', href: 'chat' },
  { icon: Wrench, label: 'Workbench', href: 'workbench' },
  { icon: FolderOpen, label: 'Sources', href: 'sources' },
  { icon: Bot, label: 'Agents', href: 'agents' },
  { icon: Server, label: 'Endpoints', href: 'endpoints' },
  { icon: Users, label: 'Members', href: 'members' },
  { icon: SettingsIcon, label: 'Settings', href: 'settings' },
];

const WORKSPACE_MENU_ITEMS = [
  { icon: FolderKanban, label: 'Projects', href: '../projects' },
  { icon: SettingsIcon, label: 'Settings', href: '../settings' },
];

export function AppShellSidebar({
  currentValue: _currentValue,
  onChange: _onChange,
  className = '',
}: AppShellSidebarProps) {
  const { currentProject } = useAuthStore();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);

  const menuItems = currentProject ? PROJECT_MENU_ITEMS : WORKSPACE_MENU_ITEMS;

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
      className={cn(
        collapsed ? 'w-[72px]' : 'w-[260px]',
        'border-r border-subtle bg-panel flex flex-col transition-[width] duration-200',
        className,
      )}
    >
      <div className={cn('px-2 py-2', collapsed ? 'flex justify-center' : 'flex justify-end')}>
        <button
          type="button"
          onClick={toggleCollapsed}
          className={cn(
            'h-10 w-10 rounded-sm flex items-center justify-center transition-colors duration-200',
            'text-icon-default hover:bg-hover hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {menuItems.map((item) => {
          const isActive = pathname?.includes(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
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
              <span className={cn('truncate', collapsed && 'hidden')}>{item.label}</span>
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
    </aside>
  );
}
