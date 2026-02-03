'use client';
import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TimeRangePicker, type TimeRange } from './TimeRangePicker';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import type { UsageListParams } from '@/lib/api/types';

export interface UsageFiltersProps {
  filters: UsageListParams;
  onChange: (filters: UsageListParams) => void;
  onClear: () => void;
  className?: string;
  defaultEndUserId?: string; // For project-user permission
}

const RESOURCE_TYPES = [
  'endpoints',
  'userdata-docdb',
  'userdata-vectordb',
  'userdata-storage',
  'workspace',
];

export function UsageFilters({
  filters,
  onChange,
  onClear,
  className,
  defaultEndUserId,
}: UsageFiltersProps) {
  const [debounceTimer, setDebounceTimer] = React.useState<NodeJS.Timeout | null>(null);

  const handleTimeRangeChange = (range: TimeRange) => {
    onChange({
      ...filters,
      start_time: range.start_time,
      end_time: range.end_time,
    });
  };

  const handleFilterChange = (key: keyof UsageListParams, value: string | undefined) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    const timer = setTimeout(() => {
      onChange({
        ...filters,
        [key]: value || undefined,
      });
    }, 500);

    setDebounceTimer(timer);
  };

  React.useEffect(() => {
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [debounceTimer]);

  const hasActiveFilters = React.useMemo(() => {
    return !!(filters.resource_type || filters.agent_id || filters.end_user_id);
  }, [filters]);

  return (
    <div className={cn('bg-surface border border-border rounded-md p-4 space-y-4', className)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Filters</h3>
        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={onClear}>
            <X className="h-4 w-4 mr-2" />
            Clear Filters
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <TimeRangePicker
          value={{
            start_time: filters.start_time,
            end_time: filters.end_time,
          }}
          onChange={handleTimeRangeChange}
          presets={['today', 'last_7d', 'last_30d', 'this_month', 'custom']}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-tertiary mb-1 block">Resource Type</label>
            <Select
              value={filters.resource_type || 'all'}
              onValueChange={(value) => handleFilterChange('resource_type', value === 'all' ? undefined : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {RESOURCE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs text-tertiary mb-1 block">Agent ID</label>
            <Input
              placeholder="Filter by agent ID..."
              value={filters.agent_id || ''}
              onChange={(e) => handleFilterChange('agent_id', e.target.value || undefined)}
            />
          </div>

          <div>
            <label className="text-xs text-tertiary mb-1 block">End User ID</label>
            <Input
              placeholder="Filter by end user ID..."
              value={filters.end_user_id || defaultEndUserId || ''}
              onChange={(e) => handleFilterChange('end_user_id', e.target.value || defaultEndUserId || undefined)}
              disabled={!!defaultEndUserId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
