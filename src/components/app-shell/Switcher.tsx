import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SwitcherProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}

export function Switcher({
  label,
  value,
  onChange,
  options,
  className = '',
}: SwitcherProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className={`relative ${className}`}>
      {/* Label */}
      <span className="text-sm text-tertiary">{label}</span>

      {/* Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 h-10 bg-surface-high hover:bg-hover border border-subtle rounded-sm text-sm text-primary transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {selectedOption?.label || label}
        <ChevronsUpDown className="w-4 h-4 text-tertiary" />
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
          <div className="absolute z-20 mt-1 w-full min-w-[160px] bg-surface-high border border-subtle rounded-md shadow-float py-1">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                  value === option.value
                    ? "bg-hover text-foreground"
                    : "text-primary hover:bg-hover hover:text-foreground",
                )}
              >
                {option.label}
                {value === option.value && (
                  <Check className="w-4 h-4 text-accent ml-auto" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
