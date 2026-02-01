import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LogOut, User, Settings, Languages, type LucideIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface UserMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
}

interface UserMenuProps {
  user: {
    name: string;
    email: string;
    avatar?: string;
  } | null;
  onProfile?: () => void;
  onApiKeys?: () => void;
  onLanguage?: () => void;
  onLogout?: () => void;
  className?: string;
}

const defaultItems: UserMenuItem[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'api-keys', label: 'API Keys', icon: Settings },
  { id: 'language', label: 'Language', icon: Languages },
];

export function UserMenu({
  user,
  onProfile,
  onApiKeys,
  onLanguage,
  onLogout,
  className = '',
}: UserMenuProps) {
  const handleClick = (itemId: string) => {
    switch (itemId) {
      case 'profile':
        onProfile?.();
        break;
      case 'api-keys':
        onApiKeys?.();
        break;
      case 'language':
        onLanguage?.();
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
            className="flex items-center gap-2 hover:bg-hover rounded-full p-1 pr-3 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Avatar className="w-8 h-8">
              {user?.avatar ? (
                <AvatarImage src={user.avatar} alt={user.name} />
              ) : (
                <AvatarFallback
                  className="text-foreground text-xs"
                  style={{ backgroundImage: 'var(--ai-gradient)' }}
                >
                  {user ? getInitials(user.name) : '?'}
                </AvatarFallback>
              )}
            </Avatar>
            <span className="hidden sm:block text-sm text-foreground max-w-[120px] truncate">
              {user?.name || 'User'}
            </span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64 p-2">
          <div className="px-2 py-2">
            <p className="text-sm font-medium text-foreground truncate">{user?.name || 'User'}</p>
            <p className="text-xs text-tertiary truncate">{user?.email || ''}</p>
          </div>

          <DropdownMenuSeparator />

          {defaultItems.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => handleClick(item.id)}
              className="gap-3"
            >
              <item.icon className="w-4 h-4 text-icon-default" />
              <span>{item.label}</span>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => handleClick('logout')}
            className="gap-3 text-error hover:text-error focus:text-error"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
