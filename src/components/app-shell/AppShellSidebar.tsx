'use client';

import * as React from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  Workflow,
  Bot,
  Server,
  Database,
  Users,
  FileSearch,
  BarChart3,
  Settings,
} from 'lucide-react';
import { Sidebar, type SidebarItem } from './Sidebar';

interface AppShellSidebarProps {
  _currentMode?: 'chat' | 'workbench';
  currentValue: string;
  onChange: (value: string) => void;
  items?: SidebarItem[];
  className?: string;
}

export function AppShellSidebar({
  _currentMode,
  currentValue,
  onChange,
  items: overrideItems,
  className = '',
}: AppShellSidebarProps) {
  // Define default sidebar items
  const getDefaultItems = (): SidebarItem[] => {
    const commonItems: SidebarItem[] = [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'chat', label: 'Chat', icon: MessageSquare },
      { id: 'workbench', label: 'Workbench', icon: Workflow },
    ];

    const managementItems: SidebarItem[] = [
      { id: 'agents', label: 'Agents', icon: Bot },
      { id: 'endpoints', label: 'Endpoints', icon: Server },
      { id: 'userdata', label: 'UserData', icon: Database },
    ];

    const adminItems: SidebarItem[] = [
      { id: 'members', label: 'Members', icon: Users },
      { id: 'audit', label: 'Audit', icon: FileSearch },
      { id: 'usage', label: 'Usage', icon: BarChart3 },
      { id: 'settings', label: 'Settings', icon: Settings },
    ];

    return [...commonItems, ...managementItems, ...adminItems];
  };

  const items = overrideItems || getDefaultItems();

  return (
    <Sidebar
      items={items}
      value={currentValue}
      onChange={onChange}
      className={className}
    />
  );
}
