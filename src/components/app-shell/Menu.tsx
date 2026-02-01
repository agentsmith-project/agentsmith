import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';

interface MenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: string | number;
  disabled?: boolean;
}

interface MenuProps {
  items: MenuItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Menu({ items, value, onChange, className = '' }: MenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const selectedItem = items.find((item) => item.id === value);

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 hover:bg-hover rounded-lg text-sm text-secondary hover:text-primary transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {selectedItem?.icon && (
          <selectedItem.icon className="w-4 h-4" />
        )}
        <span className="max-w-[120px] truncate">
          {selectedItem?.label || 'Select...'}
        </span>
        {selectedItem?.badge && (
          <span className="ml-1 px-1.5 py-0.5 bg-surface border border-subtle rounded text-xs text-tertiary">
            {selectedItem.badge}
          </span>
        )}
        <ChevronDown className="w-4 h-4 text-tertiary" />
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
          <div className="absolute z-20 mt-1 w-full min-w-[200px] bg-surface border border-subtle rounded-lg shadow-sm py-1 max-h-[400px] overflow-y-auto">
            {items.map((item) => {
              const Icon = item.icon;
              const isSelected = value === item.id;
              const isDisabled = item.disabled === true;

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (!isDisabled) {
                      onChange(item.id);
                      setIsOpen(false);
                    }
                  }}
                  disabled={isDisabled}
                  className={`
                    w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
                    ${isSelected
                      ? 'bg-hover text-primary'
                      : 'text-secondary hover:bg-hover hover:text-primary'
                    }
                    ${isDisabled
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer'
                    }
                  `}
                >
                  {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto px-1.5 py-0.5 bg-surface border border-subtle rounded text-xs text-tertiary flex-shrink-0">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
