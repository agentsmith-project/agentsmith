import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Languages,
  LogOut,
  MoonStar,
  Settings,
  SunMedium,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/components/providers/ThemeProvider';
import type { Theme } from '@/lib/theme';

interface UserMenuItem {
  id: string;
  labelKey: 'profile' | 'workspace_integrations' | 'personal_connections' | 'api_keys';
  icon: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
}

const LOCALES = [
  { id: 'en-US', label: 'English', icon: Languages },
  { id: 'zh-CN', label: '中文', icon: Languages },
] as const;

const THEME_OPTIONS: Array<{ id: Theme; labelKey: 'theme_light' | 'theme_dark'; icon: LucideIcon }> = [
  { id: 'light', labelKey: 'theme_light', icon: SunMedium },
  { id: 'dark', labelKey: 'theme_dark', icon: MoonStar },
];

interface UserMenuProps {
  user: {
    name: string;
    email: string;
    avatar?: string;
  } | null;
  onProfile?: () => void;
  onWorkspaceIntegrations?: () => void;
  onPersonalConnections?: () => void;
  onApiKeys?: () => void;
  onLanguageSwitch?: (locale: string) => void;
  onLogout?: () => void;
  className?: string;
  currentLocale?: string;
}

export function UserMenu({
  user,
  onProfile,
  onWorkspaceIntegrations,
  onPersonalConnections,
  onApiKeys,
  onLanguageSwitch,
  onLogout,
  currentLocale = 'en-US',
  className = '',
}: UserMenuProps) {
  const t = useTranslations('common.user_menu');
  const commonT = useTranslations('common');
  const { theme, setTheme, mounted } = useTheme();

  const items = React.useMemo<UserMenuItem[]>(
    () => [
      ...(onProfile
        ? [{ id: 'profile', labelKey: 'profile', icon: User, onClick: onProfile }] satisfies UserMenuItem[]
        : []),
      ...(onWorkspaceIntegrations
        ? [{ id: 'workspace_integrations', labelKey: 'workspace_integrations', icon: Settings, onClick: onWorkspaceIntegrations }] satisfies UserMenuItem[]
        : []),
      ...(onPersonalConnections
        ? [{ id: 'personal_connections', labelKey: 'personal_connections', icon: Settings, onClick: onPersonalConnections }] satisfies UserMenuItem[]
        : []),
      ...(onApiKeys
        ? [{ id: 'api_keys', labelKey: 'api_keys', icon: Settings, onClick: onApiKeys }] satisfies UserMenuItem[]
        : []),
    ],
    [onApiKeys, onPersonalConnections, onProfile, onWorkspaceIntegrations],
  );

  const handleClick = (itemId: string) => {
    switch (itemId) {
      case 'profile':
        onProfile?.();
        break;
      case 'workspace_integrations':
        onWorkspaceIntegrations?.();
        break;
      case 'personal_connections':
        onPersonalConnections?.();
        break;
      case 'api_keys':
        onApiKeys?.();
        break;
      case 'logout':
        onLogout?.();
        break;
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className={`relative ${className}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            data-testid="topbar__user-menu"
            className="control-pill flex h-11 items-center gap-3 px-2.5 py-1.5 text-primary shadow-ambient transition-colors duration-150 hover:bg-surface hover:text-foreground"
          >
            <Avatar className="h-8 w-8">
              {user?.avatar ? (
                <AvatarImage src={user.avatar} alt={user.name} />
              ) : (
                <AvatarFallback className="type-system-caption bg-surface-high text-foreground">
                  {user ? getInitials(user.name) : commonT('user')}
                </AvatarFallback>
              )}
            </Avatar>
            <div className="hidden min-w-0 sm:block">
              <div className="truncate text-sm text-foreground">{user?.name || commonT('user')}</div>
              <div className="truncate text-[11px] text-tertiary">{user?.email || ''}</div>
            </div>
            <span className="sr-only">{user?.name || commonT('user')}</span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-72 p-2.5">
          <div className="surface-soft px-3 py-3">
            <p className="type-title truncate text-foreground">{user?.name || commonT('user')}</p>
            <p className="mt-1 truncate text-xs text-secondary">{user?.email || ''}</p>
          </div>

          {items.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              {items.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  data-testid={`user-menu__${item.id === 'api_keys' ? 'api-keys' : item.id}`}
                  onSelect={() => handleClick(item.id)}
                  className="gap-3"
                >
                  <item.icon className="h-4 w-4 text-icon-default" />
                  <span>{t(item.labelKey)}</span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}

          {onLanguageSwitch ? (
            <>
              <DropdownMenuSeparator />
              <div className="px-3 pb-1 pt-1.5 text-[10px] uppercase tracking-[0.16em] text-tertiary">
                {t('language')}
              </div>
              {LOCALES.map((loc) => (
                <DropdownMenuItem
                  key={loc.id}
                  data-testid={`user-menu__language-${loc.id}`}
                  onSelect={() => onLanguageSwitch(loc.id)}
                  className="gap-3"
                >
                  <loc.icon className="h-4 w-4 text-icon-default" />
                  <span>{loc.label}</span>
                  {currentLocale === loc.id ? <span className="ml-auto text-xs text-accent">{t('current')}</span> : null}
                </DropdownMenuItem>
              ))}
            </>
          ) : null}

          <DropdownMenuSeparator />
          <div className="px-3 pb-1 pt-1.5 text-[10px] uppercase tracking-[0.16em] text-tertiary">
            {t('appearance')}
          </div>
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.id}
              data-testid={`user-menu__theme-${option.id}`}
              onSelect={() => setTheme(option.id)}
              className="gap-3"
            >
              <option.icon className="h-4 w-4 text-icon-default" />
              <span>{t(option.labelKey)}</span>
              {mounted && theme === option.id ? <span className="ml-auto text-xs text-accent">{t('current')}</span> : null}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="user-menu__logout"
            onSelect={() => handleClick('logout')}
            className="gap-3 text-error hover:text-error focus:text-error"
          >
            <LogOut className="h-4 w-4" />
            <span>{t('logout')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
