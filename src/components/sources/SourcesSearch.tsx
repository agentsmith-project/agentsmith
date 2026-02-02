'use client';
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SourcesSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SourcesSearch({
  value,
  onChange,
  placeholder = 'Search files...',
  className,
}: SourcesSearchProps) {
  const [debouncedValue, setDebouncedValue] = React.useState(value);

  // Debounce search input
  React.useEffect(() => {
    const timer = setTimeout(() => {
      onChange(debouncedValue);
    }, 300);

    return () => clearTimeout(timer);
  }, [debouncedValue, onChange]);

  // Sync external value changes
  React.useEffect(() => {
    setDebouncedValue(value);
  }, [value]);

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary pointer-events-none" />
      <Input
        type="text"
        value={debouncedValue}
        onChange={(e) => setDebouncedValue(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-9"
      />
      {debouncedValue && (
        <button
          type="button"
          onClick={() => {
            setDebouncedValue('');
            onChange('');
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-tertiary hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
