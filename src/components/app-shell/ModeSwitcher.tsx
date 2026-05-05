import * as React from 'react';
import { MessageSquare, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type Mode = 'chat' | 'agent_tasks';

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
  { value: 'agent_tasks', label: 'Agent tasks', icon: Workflow },
];

export function ModeSwitcher({ value, onChange, className = '' }: ModeSwitcherProps) {
  return (
    <div className={`inline-flex items-center bg-surface-high border border-subtle rounded-sm p-1 ${className}`}>
      {modes.map((mode) => {
        const Icon = mode.icon;
        const isActive = value === mode.value;

        return (
          <button
            key={mode.value}
            onClick={() => onChange(mode.value)}
            className={`
              flex items-center gap-2 px-4 h-9 rounded-sm text-sm font-medium transition-colors duration-200
              ${isActive ? 'bg-hover text-foreground' : 'text-primary hover:bg-hover hover:text-foreground'}
            `}
          >
            <Icon className={`w-4 h-4 ${isActive ? 'text-accent' : 'text-icon-default'}`} />
            <span>{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}
