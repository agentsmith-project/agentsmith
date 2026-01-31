import * as React from 'react';
import { MessageSquare, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type Mode = 'chat' | 'workbench';

interface ModeSwitcherProps {
  value: Mode;
  onChange: (mode: Mode) => void;
  className?: string;
}

const modes: Array<{
  value: Mode;
  label: string;
  icon: LucideIcon;
}> = [
  { value: 'chat', label: 'Chat', icon: MessageSquare },
  { value: 'workbench', label: 'Workbench', icon: Workflow },
];

export function ModeSwitcher({ value, onChange, className = '' }: ModeSwitcherProps) {
  return (
    <div className={`inline-flex items-center bg-surface border border-subtle rounded-lg p-1 ${className}`}>
      {modes.map((mode) => {
        const Icon = mode.icon;
        const isActive = value === mode.value;

        return (
          <button
            key={mode.value}
            onClick={() => onChange(mode.value)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200
              ${isActive
                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm'
                : 'text-secondary hover:text-primary hover:bg-hover'
              }
            `}
          >
            <Icon className="w-4 h-4" />
            <span>{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}
