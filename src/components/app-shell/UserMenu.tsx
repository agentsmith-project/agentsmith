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
  onProfile?: () => void;
  onThirdPartyAccounts?: () => void;
  onApiKeys?: () => void;
  onLanguageSwitch?: (locale: string) => void;
  onLogout?: () => void;
  className?: string;
  currentLocale?: string;
}

const defaultItems: Omit<UserMenuItem, 'label'>[] = [
  { id: 'profile', icon: User },
  { id: 'third_party_accounts', icon: Settings },
  { id: 'api_keys', icon: Settings },
];

export function UserMenu({
  user,
  onProfile,
  onThirdPartyAccounts,
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
      case 'third_party_accounts':
        onThirdPartyAccounts?.();
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

          {defaultItems.map((item) => (
            <DropdownMenuItem
              key={item.id}
              data-testid={`user-menu__${item.id === 'api_keys' ? 'api-keys' : item.id}`}
              onSelect={() => handleClick(item.id)}
              className="gap-3"
            >
              <item.icon className="w-4 h-4 text-icon-default" />
              <span>{t(item.id as 'profile' | 'api_keys' | 'third_party_accounts')}</span>
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
