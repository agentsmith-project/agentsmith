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

  const menuItems = currentProject ? PROJECT_MENU_ITEMS : WORKSPACE_MENU_ITEMS;

  return (
    <aside
      className={cn('w-60 border-r border-border-subtle bg-surface flex flex-col', className)}
      style={{
        backgroundColor: 'var(--color-v3-surface-left-nav)',
        borderRightColor: 'var(--color-v3-surface-left-nav-border)',
      }}
    >
      <nav className="flex-1 px-2 py-4 space-y-1">
        {menuItems.map((item) => {
          const isActive = pathname?.includes(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-200 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              style={{
                color: isActive ? 'var(--color-v3-text)' : 'var(--color-v3-text-var)',
                backgroundColor: isActive ? 'var(--color-v3-nav-item-active)' : undefined,
              }}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
              {isActive && (
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full"
                  style={{ backgroundColor: 'var(--color-v3-text-link)' }}
                />
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
