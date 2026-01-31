import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: string | number;
  disabled?: boolean;
}

interface SidebarProps {
  items: SidebarItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Sidebar({ items, value, onChange, className = '' }: SidebarProps) {
  return (
    <aside className={`w-60 bg-panel border-r border-subtle flex flex-col ${className}`}>
      {/* Menu Items */}
      <nav className="flex-1 py-4">
        <ul className="space-y-1 px-3">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = value === item.id;
            const isDisabled = item.disabled === true;

            return (
              <li key={item.id}>
                <button
                  onClick={() => !isDisabled && onChange(item.id)}
                  disabled={isDisabled}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-all duration-200 relative",
                    isActive
                      ? 'bg-hover text-primary'
                      : 'text-secondary hover:bg-hover hover:text-primary',
                    isDisabled && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {/* Active Indicator */}
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-accent rounded-r" />
                  )}

                  {/* Icon */}
                  <Icon className="w-5 h-5 flex-shrink-0" />

                  {/* Label */}
                  <span className="flex-1 text-left truncate">{item.label}</span>

                  {/* Badge */}
                  {item.badge && (
                    <span className="px-1.5 py-0.5 bg-surface border border-subtle rounded text-xs text-tertiary">
                      {item.badge}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer (optional) */}
      <div className="p-3 border-t border-subtle">
        {/* Collapse button could go here */}
        <button className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-secondary hover:bg-hover hover:text-primary rounded-lg transition-all duration-200">
          <span>Collapse</span>
        </button>
      </div>
    </aside>
  );
}
