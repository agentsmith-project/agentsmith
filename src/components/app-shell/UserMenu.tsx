import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LogOut, User, Settings, Languages, type LucideIcon } from 'lucide-react';

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
  const [isOpen, setIsOpen] = React.useState(false);

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
    setIsOpen(false);
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
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 hover:bg-hover rounded-full p-1 pr-3 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <Avatar className="w-8 h-8">
          {user?.avatar ? (
            <AvatarImage src={user.avatar} alt={user.name} />
          ) : (
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-blue-600 text-white text-xs">
              {user ? getInitials(user.name) : '?'}
            </AvatarFallback>
          )}
        </Avatar>
        <span className="hidden sm:block text-sm text-primary max-w-[100px] truncate">
          {user?.name || 'User'}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu */}
          <div className="absolute right-0 z-20 mt-2 w-56 bg-surface border border-subtle rounded-lg shadow-sm">
            {/* User Info */}
            <div className="px-4 py-3 border-b border-subtle">
              <p className="text-sm font-medium text-primary truncate">
                {user?.name || 'User'}
              </p>
              <p className="text-xs text-secondary truncate">
                {user?.email || ''}
              </p>
            </div>

            {/* Menu Items */}
            <div className="py-1">
              {defaultItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleClick(item.id)}
                  className="w-full px-4 py-2 text-left text-sm text-secondary hover:bg-hover hover:text-primary flex items-center gap-3 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                </button>
              ))}

              <div className="my-1 border-t border-subtle" />

              <button
                onClick={() => handleClick('logout')}
                className="w-full px-4 py-2 text-left text-sm text-error hover:bg-hover hover:text-error flex items-center gap-3 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <LogOut className="w-4 h-4 flex-shrink-0" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
