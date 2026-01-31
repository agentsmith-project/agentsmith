'use client';

import * as React from 'react';
import { Bell } from 'lucide-react';
import { Logo } from './Logo';
import { Switcher } from './Switcher';
import { UserMenu } from './UserMenu';
import { useAuthStore } from '@/lib/stores/authStore';

interface TopbarProps {
  className?: string;
}

export function Topbar({ className = '' }: TopbarProps) {
  const { user } = useAuthStore();

  // Mock workspaces - will come from API
  const workspaces = [
    { value: 'ws_default', label: 'Default Workspace' },
    { value: 'ws_test', label: 'Test Workspace' },
  ];

  // Mock projects - will come from API
  const projects = [
    { value: 'proj_001', label: 'AI Assistant Project', badge: 'Active' },
    { value: 'proj_002', label: 'Research Project', badge: 'Private' },
  ];

  const handleWorkspaceChange = (value: string) => {
    console.log('Workspace changed:', value);
    // TODO: Update authStore
  };

  const handleProjectChange = (value: string) => {
    console.log('Project changed:', value);
    // TODO: Update authStore
  };

  const _handleModeChange = (mode: 'chat' | 'workbench') => {
    console.log('Mode changed:', mode);
    // TODO: Navigate to mode
  };

  const handleProfile = () => {
    console.log('Navigate to profile');
    // TODO: Navigate to profile
  };

  const handleApiKeys = () => {
    console.log('Navigate to API keys');
    // TODO: Navigate to API keys
  };

  const handleLanguage = () => {
    console.log('Open language selector');
    // TODO: Open language selector
  };

  const handleLogout = () => {
    console.log('Logout');
    // TODO: Clear auth and redirect to login
  };

  return (
    <header className={`h-14 flex items-center justify-between px-4 bg-panel border-b border-subtle ${className}`}>
      {/* Left Side */}
      <div className="flex items-center gap-6">
        <Logo />

        {/* Workspace Switcher */}
        <Switcher
          label="Workspace"
          value="ws_default"
          onChange={handleWorkspaceChange}
          options={workspaces}
        />

        {/* Project Switcher */}
        <Switcher
          label="Project"
          value="proj_001"
          onChange={handleProjectChange}
          options={projects}
        />
      </div>

      {/* Right Side */}
      <div className="flex items-center gap-4">
        {/* Notification Bell (optional v1.5) */}
        <button className="relative p-2 hover:bg-hover rounded-lg text-secondary hover:text-primary transition-all duration-200">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-error rounded-full border-2 border-panel" />
        </button>

        {/* User Menu */}
        <UserMenu
          user={user}
          onProfile={handleProfile}
          onApiKeys={handleApiKeys}
          onLanguage={handleLanguage}
          onLogout={handleLogout}
        />
      </div>
    </header>
  );
}
