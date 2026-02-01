'use client';

import * as React from 'react';
import { Bell } from 'lucide-react';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';
import { useAuthStore } from '@/lib/stores/authStore';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, MenuItem } from '@/components/ui/dropdown-menu';
import { Globe, FolderKanban, ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface TopbarProps {
  className?: string;
}

export function Topbar({ className = '' }: TopbarProps) {
  const { currentWorkspace, currentProject, workspaces, projects, user } = useAuthStore();
  const router = useRouter();

  const handleWorkspaceChange = (workspaceId: string) => {
    router.push(`/en-US/workspaces/${workspaceId}/projects`);
  };

  const handleProjectChange = (projectId: string) => {
    router.push(`/en-US/workspaces/${currentWorkspace?.id}/projects/${projectId}/overview`);
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
      <div className="flex items-center gap-4">
        <Logo className="w-8 h-8" />

        {/* Workspace Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-colors">
            <Globe className="w-4 h-4 text-secondary" />
            <span className="text-sm text-primary">{currentWorkspace?.name || 'Select Workspace'}</span>
            <ChevronDown className="w-4 h-4 text-foreground-muted" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-surface border border-border rounded-md" align="start">
            {workspaces?.map(ws => (
              <MenuItem key={ws.id} onClick={() => handleWorkspaceChange(ws.id)}>
                {ws.name}
              </MenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Right Side */}
      <div className="flex items-center gap-4">
        {/* Project Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!currentProject}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${
              currentProject
                ? 'hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
                : 'text-foreground-muted cursor-not-allowed'
            }`}
          >
            <FolderKanban className="w-4 h-4" />
            <span className="text-sm">{currentProject?.name || 'No project'}</span>
            {currentProject && <ChevronDown className="w-4 h-4" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-surface border border-border rounded-md" align="end">
            {projects?.map(proj => (
              <MenuItem key={proj.id} onClick={() => handleProjectChange(proj.id)}>
                {proj.name}
              </MenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

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
