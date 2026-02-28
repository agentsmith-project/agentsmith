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

  const hasNonDefaultTimeRange = React.useMemo(() => {
    const start = new Date(filters.start_time).getTime();
    const end = new Date(filters.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return true;

    const durationHours = (end - start) / (1000 * 60 * 60);
    const endOffsetMinutes = Math.abs(Date.now() - end) / (1000 * 60);

    return Math.abs(durationHours - 24) > 0.2 || endOffsetMinutes > 10;
  }, [filters.start_time, filters.end_time]);

  const hasActiveFilters = React.useMemo(() => {
    return !!(
      hasNonDefaultTimeRange
      || filters.resource_type
      || filters.resource_id
      || filters.end_user_id
      || filters.provider
      || filters.model
      || filters.result
      || filters.error_class
    );
  }, [filters.resource_type, filters.resource_id, filters.end_user_id, filters.provider, filters.model, filters.result, filters.error_class, hasNonDefaultTimeRange]);

  return (
    <div className={cn('bg-surface border border-border rounded-xl p-4 space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{commonT('filters')}</h3>
        {hasActiveFilters && (
          <Button variant="outline" size="sm" className="h-8" onClick={onClear}>
            <X className="h-4 w-4 mr-2" />
            {commonT('clear_filters')}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <TimeRangePicker
          className="lg:col-span-1"
          value={{
            start_time: filters.start_time,
            end_time: filters.end_time,
          }}
          onChange={handleTimeRangeChange}
          presets={['last_24h', 'last_7d', 'last_30d', 'today', 'this_month', 'custom']}
          showResolvedRangeLabel={false}
        />

        <div>
          <label className="text-xs text-tertiary mb-1 block">{t('filters.resource_type')}</label>
          <Select
            value={filters.resource_type || 'all'}
            onValueChange={(value) => handleSelectFilterChange('resource_type', value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="h-10">
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
            className="h-10"
            placeholder={commonT('filter_by_resource_id')}
            value={filters.resource_id || ''}
            onChange={(e) => handleTextFilterChange('resource_id', e.target.value || undefined)}
          />
        </div>

        <div>
          <label className="text-xs text-tertiary mb-1 block">{t('filters.end_user_id')}</label>
          <Input
            className="h-10"
            placeholder={commonT('filter_by_end_user_id')}
            value={filters.end_user_id || defaultEndUserId || ''}
            onChange={(e) => handleTextFilterChange('end_user_id', e.target.value || defaultEndUserId || undefined)}
            disabled={!!defaultEndUserId}
          />
        </div>

        <div>
          <label className="text-xs text-tertiary mb-1 block">{t('filters.provider')}</label>
          <Input
            className="h-10"
            placeholder={t('filters.provider_placeholder')}
            value={filters.provider || ''}
            onChange={(e) => handleTextFilterChange('provider', e.target.value || undefined)}
          />
        </div>

        <div>
          <label className="text-xs text-tertiary mb-1 block">{t('filters.model')}</label>
          <Input
            className="h-10"
            placeholder={t('filters.model_placeholder')}
            value={filters.model || ''}
            onChange={(e) => handleTextFilterChange('model', e.target.value || undefined)}
          />
        </div>

        <div>
          <label className="text-xs text-tertiary mb-1 block">{t('filters.result')}</label>
          <Select
            value={filters.result || 'all'}
            onValueChange={(value) => handleSelectFilterChange('result', value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder={commonT('all')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{commonT('all')}</SelectItem>
              <SelectItem value="ok">{t('filters.result_ok')}</SelectItem>
              <SelectItem value="error">{t('filters.result_error')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-tertiary mb-1 block">{t('filters.error_class')}</label>
          <Select
            value={filters.error_class || 'all'}
            onValueChange={(value) => handleSelectFilterChange('error_class', value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder={commonT('all')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{commonT('all')}</SelectItem>
              <SelectItem value="provider_retryable">{t('error_class.provider_retryable')}</SelectItem>
              <SelectItem value="provider_non_retryable">{t('error_class.provider_non_retryable')}</SelectItem>
              <SelectItem value="system_error">{t('error_class.system_error')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
