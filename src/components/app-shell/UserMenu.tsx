import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LogOut, User, Settings, Languages, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface UserMenuItem {
  id: string;
  icon: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
}

const LOCALES = [
  { id: 'en-US', label: 'English', icon: Languages },
  { id: 'zh-CN', label: '中文', icon: Languages },
] as const;

interface UserMenuProps {
  user: {
    name: string;
    email: string;
    avatar?: string;
  } | null;
  workspacePermissions?: readonly string[];
  projectPermissions?: readonly string[];
  onProfile?: () => void;
  onApiKeys?: () => void;
  onLanguageSwitch?: (locale: string) => void;
  onLogout?: () => void;
  className?: string;
  currentLocale?: string;
}

const defaultItems: Omit<UserMenuItem, 'label'>[] = [
  { id: 'profile', icon: User },
  { id: 'api_keys', icon: Settings },
];

export function UserMenu({
  user,
  workspacePermissions = [],
  projectPermissions = [],
  onProfile,
  onApiKeys,
  onLanguageSwitch,
  onLogout,
  currentLocale = 'en-US',
  className = '',
}: UserMenuProps) {
  const t = useTranslations('common.user_menu');
  const commonT = useTranslations('common');

  const handleClick = (itemId: string) => {
    switch (itemId) {
      case 'profile':
        onProfile?.();
        break;
      case 'api_keys':
        onApiKeys?.();
        break;
      case 'logout':
        onLogout?.();
        break;
    }
  };

  // Get initials from name
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
            className="flex items-center gap-2 hover:bg-hover rounded-full p-1 pr-3 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Avatar className="w-8 h-8">
              {user?.avatar ? (
                <AvatarImage src={user.avatar} alt={user.name} />
              ) : (
                <AvatarFallback className="text-foreground text-xs bg-surface-high border border-subtle">
                  {user ? getInitials(user.name) : commonT('user')}
                </AvatarFallback>
              )}
            </Avatar>
            <span className="hidden sm:block text-sm text-foreground max-w-[120px] truncate">
              {user?.name || commonT('user')}
            </span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64 p-2">
          <div className="px-2 py-2">
            <p className="text-sm font-medium text-foreground truncate">{user?.name || commonT('user')}</p>
            <p className="text-xs text-tertiary truncate">{user?.email || ''}</p>
          </div>

          <DropdownMenuSeparator />

          <div className="px-2 py-2 space-y-2" data-testid="user-menu__permission-tokens">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-tertiary">
              {t('permission_tokens')}
            </p>

            <div className="space-y-1" data-testid="user-menu__workspace-permissions">
              <p className="text-xs text-secondary">{t('workspace_permissions')}</p>
              {workspacePermissions.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {workspacePermissions.map((permission) => (
                    <span
                      key={`workspace-${permission}`}
                      className="rounded-sm border border-subtle bg-surface-high px-1.5 py-0.5 text-[11px] font-mono text-foreground"
                    >
                      {permission}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-tertiary">{t('no_permissions')}</p>
              )}
            </div>

            <div className="space-y-1" data-testid="user-menu__project-permissions">
              <p className="text-xs text-secondary">{t('project_permissions')}</p>
              {projectPermissions.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {projectPermissions.map((permission) => (
                    <span
                      key={`project-${permission}`}
                      className="rounded-sm border border-subtle bg-surface-high px-1.5 py-0.5 text-[11px] font-mono text-foreground"
                    >
                      {permission}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-tertiary">{t('no_permissions')}</p>
              )}
            </div>
          </div>

          <DropdownMenuSeparator />

          {defaultItems.map((item) => (
            <DropdownMenuItem
              key={item.id}
              data-testid={`user-menu__${item.id === 'api_keys' ? 'api-keys' : item.id}`}
              onSelect={() => handleClick(item.id)}
              className="gap-3"
            >
              <item.icon className="w-4 h-4 text-icon-default" />
              <span>{t(item.id as 'profile' | 'api_keys')}</span>
            </DropdownMenuItem>
          ))}

          {onLanguageSwitch && (
            <>
              <DropdownMenuSeparator />
              {LOCALES.map((loc) => (
                <DropdownMenuItem
                  key={loc.id}
                  data-testid="user-menu__language"
                  onSelect={() => onLanguageSwitch(loc.id)}
                  className="gap-3"
                >
                  <loc.icon className="w-4 h-4 text-icon-default" />
                  <span>{loc.label}</span>
                  {currentLocale === loc.id && (
                    <span className="ml-auto text-xs text-accent">✓</span>
                  )}
                </DropdownMenuItem>
              ))}
            </>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            data-testid="user-menu__logout"
            onSelect={() => handleClick('logout')}
            className="gap-3 text-error hover:text-error focus:text-error"
          >
            <LogOut className="w-4 h-4" />
            <span>{t('logout')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
