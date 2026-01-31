/**
 * Login Page with Mock Authentication
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Topbar } from '@/components/app-shell/Topbar';
import { useAuthStore } from '@/lib/stores/authStore';
import { Logo } from '@/components/app-shell/Logo';

const mockWorkspaces = [
  { value: 'ws_default', label: 'Default Workspace' },
  { value: 'ws_test', label: 'Test Workspace' },
];

export default function LoginPage() {
  const router = useRouter();
  const params = useParams();
  const { mockLogin, isAuthenticated, currentProject } = useAuthStore();

  const [workspaceId, setWorkspaceId] = useState('ws_default');
  const [userEmail, setUserEmail] = useState('');
  const [_userName, _setUserName] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Get locale from params
  const locale = (params?.locale as string) || 'en-US';

  // If already authenticated and has a project, redirect to overview
  useEffect(() => {
    if (isAuthenticated && currentProject) {
      setIsLoggingIn(false);
      router.push(`/${locale}/workspaces/${workspaceId}/projects/${currentProject.id}/overview`);
    } else if (isAuthenticated) {
      setIsLoggingIn(false);
      router.push(`/${locale}/workspaces/${workspaceId}/projects`);
    }
  }, [isAuthenticated, currentProject, workspaceId, locale, router]);

  const handleQuickLogin = async () => {
    if (!userEmail.trim()) {
      return;
    }

    setIsLoggingIn(true);
    try {
      mockLogin(workspaceId, userEmail, _userName);
      // Note: redirect will happen via useEffect when isAuthenticated updates
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
            <h1 className="text-3xl font-bold text-primary">
              Welcome to MBOS
            </h1>
            <p className="text-secondary">
              Intelligent Agent Platform
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-surface border border-subtle rounded-xl p-8 shadow-lg">
            <h2 className="text-xl font-semibold text-primary mb-6">
              Sign in
            </h2>

            {/* Keycloak Login Button */}
            <button
              className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium rounded-lg transition-all duration-200 mb-4"
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
              <div className="bg-panel border border-subtle rounded-lg p-4">
                <p className="text-sm text-tertiary mb-4 text-center">
                  Development Mode Only
                </p>

                {/* Workspace Select */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-secondary mb-2">
                    Workspace
                  </label>
                  <select
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                    className="w-full px-3 py-2 bg-hover border border-subtle rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {mockWorkspaces.map((ws) => (
                      <option key={ws.value} value={ws.value}>
                        {ws.label}
                      </option>
                    ))}
                  </select>
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
                    className="w-full px-3 py-2 bg-hover border border-subtle rounded-lg text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>

                {/* Quick Login Button */}
                <button
                  onClick={handleQuickLogin}
                  disabled={isLoggingIn || !userEmail.trim()}
                  className="w-full py-3 px-4 bg-surface border border-subtle hover:bg-hover text-primary font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
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
