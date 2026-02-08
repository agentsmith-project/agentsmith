'use client';
import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TimeRangePicker, type TimeRange } from './TimeRangePicker';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import type { UsageListParams } from '@/lib/api/types';
import { USAGE_RESOURCE_TYPE_OPTIONS, formatFilterToken } from './filter-options';
import { useTranslations } from 'next-intl';

export interface UsageFiltersProps {
  filters: UsageListParams;
  onChange: (filters: UsageListParams) => void;
  onClear: () => void;
  className?: string;
  defaultEndUserId?: string;
}

export function UsageFilters({
  filters,
  onChange,
  onClear,
  className,
  defaultEndUserId,
}: UsageFiltersProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Use a ref to always read the latest filters in debounced callbacks
  const filtersRef = React.useRef(filters);
  filtersRef.current = filters;

  const handleTimeRangeChange = (range: TimeRange) => {
    onChange({
      ...filtersRef.current,
      start_time: range.start_time,
      end_time: range.end_time,
    });
  };

  /** Immediate change — for Select dropdowns */
  const handleSelectFilterChange = (key: keyof UsageListParams, value: string | undefined) => {
    onChange({
      ...filtersRef.current,
      [key]: value || undefined,
    });
  };

  /** Debounced change — for text inputs */
  const handleTextFilterChange = (key: keyof UsageListParams, value: string | undefined) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      onChange({
        ...filtersRef.current,
        [key]: value || undefined,
      });
      debounceTimerRef.current = null;
    }, 500);
  };

  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const hasActiveFilters = React.useMemo(() => {
    return !!(filters.resource_type || filters.resource_id || filters.end_user_id);
  }, [filters]);

  return (
    <div className={cn('bg-surface border border-border rounded-md p-4 space-y-4', className)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">{commonT('filters')}</h3>
        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={onClear}>
            <X className="h-4 w-4 mr-2" />
            {commonT('clear_filters')}
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
            <label className="text-xs text-tertiary mb-1 block">{t('filters.resource_type')}</label>
            <Select
              value={filters.resource_type || 'all'}
              onValueChange={(value) => handleSelectFilterChange('resource_type', value === 'all' ? undefined : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder={commonT('all_types')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{commonT('all')}</SelectItem>
                {USAGE_RESOURCE_TYPE_OPTIONS.map((type) => (
                  <SelectItem key={type} value={type}>
                    {formatFilterToken(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs text-tertiary mb-1 block">{t('filters.resource_id')}</label>
            <Input
              placeholder={commonT('filter_by_resource_id')}
              value={filters.resource_id || ''}
              onChange={(e) => handleTextFilterChange('resource_id', e.target.value || undefined)}
            />
          </div>

          <div>
            <label className="text-xs text-tertiary mb-1 block">{t('filters.end_user_id')}</label>
            <Input
              placeholder={commonT('filter_by_end_user_id')}
              value={filters.end_user_id || defaultEndUserId || ''}
              onChange={(e) => handleTextFilterChange('end_user_id', e.target.value || defaultEndUserId || undefined)}
              disabled={!!defaultEndUserId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
