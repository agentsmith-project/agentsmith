/**
 * Login Page with Mock Authentication
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Topbar } from '@/components/app-shell/Topbar';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import { Logo } from '@/components/app-shell/Logo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Globe, ChevronDown } from 'lucide-react';

const mockWorkspaces = [
  { value: 'ws_default', label: 'Default Workspace' },
  { value: 'ws_test', label: 'Test Workspace' },
];

export default function LoginPage() {
  const router = useRouter();
  const params = useParams();
  const { mockLogin, isAuthenticated, currentProject, currentWorkspace } = useAuthStore();
  const hydrated = useAuthStoreHydration();

  const [workspaceId, setWorkspaceId] = useState('ws_default');
  const [userEmail, setUserEmail] = useState('');
  const [_userName, _setUserName] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Get locale from params
  const locale = (params?.locale as string) || 'en-US';

  // If already authenticated and has a workspace, redirect to appropriate page
  // Don't redirect if on login page (user might be selecting workspace)
  useEffect(() => {
    if (!hydrated) return;
    if (isAuthenticated && currentProject) {
      setIsLoggingIn(false);
      router.replace(`/${locale}/workspaces/${currentProject.workspace_id}/projects/${currentProject.id}/overview`);
    } else if (isAuthenticated && currentWorkspace) {
      setIsLoggingIn(false);
      router.replace(`/${locale}/workspaces/${currentWorkspace.id}/projects`);
    }
    // If no workspace selected, stay on current page (workspace selection will handle it)
  }, [hydrated, isAuthenticated, currentProject, currentWorkspace, locale, router]);

  const handleQuickLogin = async () => {
    if (!userEmail.trim()) {
      return;
    }

    setIsLoggingIn(true);
    try {
      mockLogin(workspaceId, userEmail, _userName);
      // Redirect to workspace selection page
      const redirectPath = `/${locale}/login/workspace`;
      router.push(redirectPath);
    } catch (error) {
      console.error('Login failed:', error);
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Topbar */}
      <Topbar />

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          {/* Logo & Title */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <Logo className="scale-150" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">
              Welcome to MBOS
            </h1>
            <p className="text-tertiary">
              Intelligent Agent Platform
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-surface border border-border rounded-md p-8">
            <h2 className="text-lg font-semibold text-foreground mb-6">
              Sign in
            </h2>

            {/* Keycloak Login Button */}
            <button
              className="w-full h-10 px-4 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200 mb-4"
              onClick={() => console.log('Keycloak login not configured')}
            >
              Login with Keycloak
            </button>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-subtle"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-background text-tertiary">or</span>
              </div>
            </div>

            {/* Mock Development Login */}
            <div className="space-y-4">
              <div className="bg-surface-high border border-subtle rounded-md p-4">
                <p className="text-sm text-tertiary mb-4 text-center">
                  Development Mode Only
                </p>

                {/* Workspace Select */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-secondary mb-2">
                    Workspace
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="w-full h-10 px-3 bg-surface-high border border-subtle rounded-sm text-primary flex items-center gap-2 justify-between hover:bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Globe className="w-4 h-4 text-icon-default flex-shrink-0" />
                          <span className="truncate text-sm">
                            {mockWorkspaces.find((ws) => ws.value === workspaceId)?.label || 'Select workspace'}
                          </span>
                        </span>
                        <ChevronDown className="w-4 h-4 text-tertiary flex-shrink-0" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                      {mockWorkspaces.map((ws) => (
                        <DropdownMenuItem
                          key={ws.value}
                          onSelect={() => setWorkspaceId(ws.value)}
                        >
                          {ws.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* User Email */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-secondary mb-2">
                    User ID / Email
                  </label>
                  <input
                    type="text"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full px-3 py-2 bg-surface-high border border-subtle rounded-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </div>

                {/* Quick Login Button */}
                <button
                  onClick={handleQuickLogin}
                  disabled={isLoggingIn || !userEmail.trim()}
                  className="w-full h-10 px-4 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoggingIn ? 'Signing in...' : 'Quick Login'}
                </button>
              </div>

              {/* Development Notice */}
              <p className="text-xs text-tertiary text-center">
                Mock authentication for development. In production, this will
                be replaced with Keycloak OIDC.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
