/**
 * Login Page with Mock Authentication
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
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
  const t = useTranslations('auth');
  const hydrated = useAuthStoreHydration();
  const { setAuth, isAuthenticated } = useAuthStore();

  const [workspaceId, setWorkspaceId] = useState('ws_default');
  const [userEmail, setUserEmail] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Get locale from params
  const locale = (params?.locale as string) || 'en-US';

  // Redirect authenticated users to workspace selection
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    router.replace(`/${locale}/login/workspace`);
  }, [hydrated, isAuthenticated, locale, router]);

  const handleQuickLogin = async () => {
    if (!userEmail.trim()) {
      return;
    }

    setIsLoggingIn(true);
    try {
      // Mock login: set auth state directly
      setAuth(
        {
          id: 'user_default',
          email: userEmail,
          name: userEmail.split('@')[0],
          locale: locale as 'en-US' | 'zh-CN',
        },
        'mock_token_' + Date.now()
      );
      // Redirect to workspace selection page
      const redirectPath = `/${locale}/login/workspace`;
      router.push(redirectPath);
    } catch (error) {
      console.error('Login failed:', error);
      setIsLoggingIn(false);
    }
  };

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          {/* Main Content */}
          <main className="flex-1 flex items-center justify-center p-4">
            <div className="w-full max-w-md space-y-8">
          {/* Logo & Title */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <Logo className="scale-150" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">
              {t('welcome_title')}
            </h1>
            <p className="text-tertiary">
              {t('welcome_subtitle')}
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-surface border border-border rounded-md p-8">
            <h2 className="text-lg font-semibold text-foreground mb-6">
              {t('sign_in')}
            </h2>

            {/* Keycloak Login Button */}
            <button
              data-testid="login__keycloak-btn"
              className="w-full h-10 px-4 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200 mb-4"
              onClick={() => console.log('Keycloak login not configured')}
            >
              {t('login_with_keycloak')}
            </button>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-subtle"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-background text-tertiary">{t('or')}</span>
              </div>
            </div>

            {/* Mock Development Login */}
            <div className="space-y-4">
              <div className="bg-surface-high border border-subtle rounded-md p-4">
                <p className="text-sm text-tertiary mb-4 text-center">
                  {t('dev_mode')}
                </p>

                {/* Workspace Select */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-secondary mb-2">
                    {t('workspace')}
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        data-testid="login__workspace-select"
                        className="w-full h-10 px-3 bg-surface-high border border-subtle rounded-sm text-primary flex items-center gap-2 justify-between hover:bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Globe className="w-4 h-4 text-icon-default flex-shrink-0" />
                          <span className="truncate text-sm">
                            {mockWorkspaces.find((ws) => ws.value === workspaceId)?.label || t('select_workspace_placeholder')}
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
                    {t('user_id_email')}
                  </label>
                  <input
                    type="text"
                    data-testid="login__email-input"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder={t('user_id_placeholder')}
                    className="w-full px-3 py-2 bg-surface-high border border-subtle rounded-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </div>

                {/* Quick Login Button */}
                <button
                  data-testid="login__submit"
                  onClick={handleQuickLogin}
                  disabled={isLoggingIn || !userEmail.trim()}
                  className="w-full h-10 px-4 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoggingIn ? t('signing_in') : t('quick_login')}
                </button>
              </div>

              {/* Development Notice */}
              <p className="text-xs text-tertiary text-center">
                {t('dev_notice')}
              </p>
            </div>
          </div>
            </div>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
