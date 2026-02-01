'use client';

import * as React from 'react';
import { Bell } from 'lucide-react';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';
import { useAuthStore } from '@/lib/stores/authStore';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Globe, FolderKanban, ChevronDown } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

interface TopbarProps {
  className?: string;
}

export function Topbar({ className = '' }: TopbarProps) {
  const { currentWorkspace, currentProject, workspaces, projects, user } = useAuthStore();
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';

  const handleWorkspaceChange = (workspaceId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects`);
  };

  const handleProjectChange = (projectId: string) => {
    if (!currentWorkspace?.id) return;
    router.push(`/${locale}/workspaces/${currentWorkspace.id}/projects/${projectId}/overview`);
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
      {/* Left: Brand */}
      <div className="flex items-center gap-3">
        <Logo />
      </div>

      {/* Center: Workspace / Project (breadcrumb-like) */}
      <div className="flex-1 min-w-0 px-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Workspace Switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger className="max-w-[340px] flex items-center gap-2 px-3 h-10 rounded-sm hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-colors">
              <Globe className="w-4 h-4 text-icon-default flex-shrink-0" />
              <span className="text-sm text-foreground truncate">
                {currentWorkspace?.name || 'Select Workspace'}
              </span>
              <ChevronDown className="w-4 h-4 text-tertiary flex-shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {workspaces?.map((ws) => (
                <DropdownMenuItem key={ws.id} onSelect={() => handleWorkspaceChange(ws.id)}>
                  {ws.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {currentProject && (
            <>
              <span className="text-tertiary">/</span>

              {/* Project Switcher */}
              <DropdownMenu>
                <DropdownMenuTrigger className="max-w-[420px] flex items-center gap-2 px-3 h-10 rounded-sm hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-colors">
                  <FolderKanban className="w-4 h-4 text-icon-default flex-shrink-0" />
                  <span className="text-sm text-primary truncate">
                    {currentProject.name}
                  </span>
                  <ChevronDown className="w-4 h-4 text-tertiary flex-shrink-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {projects?.map((proj) => (
                    <DropdownMenuItem key={proj.id} onSelect={() => handleProjectChange(proj.id)}>
                      {proj.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-4">
        {/* Notification Bell (optional v1.5) */}
        <button className="relative p-2 hover:bg-hover rounded-md text-icon-default hover:text-foreground transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
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
