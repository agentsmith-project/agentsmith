'use client';
import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TimeRangePicker, type TimeRange } from './TimeRangePicker';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import type { AuditListParams } from '@/lib/api/types';
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_RESOURCE_TYPE_OPTIONS,
  formatFilterToken,
} from './filter-options';
import { useTranslations } from 'next-intl';

export interface AuditFiltersProps {
  filters: AuditListParams;
  onChange: (filters: AuditListParams) => void;
  onClear: () => void;
  className?: string;
  defaultEndUserId?: string;
}

export function AuditFilters({
  filters,
  onChange,
  onClear,
  className,
  defaultEndUserId,
}: AuditFiltersProps) {
  const t = useTranslations('audit');
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

  /** Immediate change — for Select dropdowns that should apply instantly */
  const handleSelectFilterChange = (key: keyof AuditListParams, value: string | undefined) => {
    onChange({
      ...filtersRef.current,
      [key]: value || undefined,
    });
  };

  /** Debounced change — for text inputs that need a typing delay */
  const handleTextFilterChange = (key: keyof AuditListParams, value: string | undefined) => {
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
    return !!(
      filters.action ||
      filters.actor_type ||
      filters.actor_id ||
      filters.end_user_id ||
      filters.resource_type ||
      filters.resource_id ||
      filters.request_id ||
      filters.decision_id ||
      filters.trace_ref ||
      filters.result
    );
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
          presets={['last_24h', 'custom']}
          maxDays={2}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label htmlFor="audit-filter-action" className="text-xs text-tertiary mb-1 block">{t('filters.action')}</label>
            <Select
              value={filters.action || 'all'}
              onValueChange={(value) => handleSelectFilterChange('action', value === 'all' ? undefined : value)}
            >
              <SelectTrigger id="audit-filter-action">
                <SelectValue placeholder={commonT('all_actions')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{commonT('all')}</SelectItem>
                {AUDIT_ACTION_OPTIONS.map((action) => (
                  <SelectItem key={action} value={action}>
                    {formatFilterToken(action)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label htmlFor="audit-filter-actor-type" className="text-xs text-tertiary mb-1 block">{t('filters.actor_type')}</label>
            <Select
              value={filters.actor_type || 'all'}
              onValueChange={(value) => handleSelectFilterChange('actor_type', value === 'all' ? undefined : value as 'user' | 'agent' | 'plugin')}
            >
              <SelectTrigger id="audit-filter-actor-type">
                <SelectValue placeholder={commonT('all_types')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{commonT('all')}</SelectItem>
                <SelectItem value="user">{commonT('user')}</SelectItem>
                <SelectItem value="agent">{commonT('agent')}</SelectItem>
                <SelectItem value="plugin">{commonT('plugin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label htmlFor="audit-filter-actor-id" className="text-xs text-tertiary mb-1 block">{t('filters.actor_id')}</label>
            <Input
              id="audit-filter-actor-id"
              placeholder={commonT('filter_by_actor_id')}
              value={filters.actor_id || ''}
              onChange={(e) => handleTextFilterChange('actor_id', e.target.value || undefined)}
            />
          </div>

          <div>
            <label htmlFor="audit-filter-end-user-id" className="text-xs text-tertiary mb-1 block">{t('filters.end_user_id')}</label>
            <Input
              id="audit-filter-end-user-id"
              placeholder={commonT('filter_by_end_user_id')}
              value={filters.end_user_id || defaultEndUserId || ''}
              onChange={(e) => handleTextFilterChange('end_user_id', e.target.value || defaultEndUserId || undefined)}
              disabled={!!defaultEndUserId}
            />
          </div>

          <div>
            <label htmlFor="audit-filter-resource-type" className="text-xs text-tertiary mb-1 block">{t('filters.resource_type')}</label>
            <Select
              value={filters.resource_type || 'all'}
              onValueChange={(value) => handleSelectFilterChange('resource_type', value === 'all' ? undefined : value)}
            >
              <SelectTrigger id="audit-filter-resource-type">
                <SelectValue placeholder={commonT('all_types')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{commonT('all')}</SelectItem>
                {AUDIT_RESOURCE_TYPE_OPTIONS.map((type) => (
                  <SelectItem key={type} value={type}>
                    {formatFilterToken(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label htmlFor="audit-filter-resource-id" className="text-xs text-tertiary mb-1 block">{t('filters.resource_id')}</label>
            <Input
              id="audit-filter-resource-id"
              placeholder={commonT('filter_by_resource_id')}
              value={filters.resource_id || ''}
              onChange={(e) => handleTextFilterChange('resource_id', e.target.value || undefined)}
            />
          </div>

          <div>
            <label htmlFor="audit-filter-result" className="text-xs text-tertiary mb-1 block">{t('filters.result')}</label>
            <Select
              value={filters.result || 'all'}
              onValueChange={(value) => handleSelectFilterChange('result', value === 'all' ? undefined : value as 'ok' | 'error')}
            >
              <SelectTrigger id="audit-filter-result">
                <SelectValue placeholder={commonT('all_results')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{commonT('all')}</SelectItem>
                <SelectItem value="ok">{commonT('success')}</SelectItem>
                <SelectItem value="error">{commonT('error')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label htmlFor="audit-filter-request-id" className="text-xs text-tertiary mb-1 block">{t('filters.request_id')}</label>
            <Input
              id="audit-filter-request-id"
              placeholder={commonT('filter_by_request_id')}
              value={filters.request_id || ''}
              onChange={(e) => handleTextFilterChange('request_id', e.target.value || undefined)}
            />
          </div>

          <div>
            <label htmlFor="audit-filter-decision-id" className="text-xs text-tertiary mb-1 block">{t('filters.decision_id')}</label>
            <Input
              id="audit-filter-decision-id"
              placeholder={commonT('filter_by_decision_id')}
              value={filters.decision_id || ''}
              onChange={(e) => handleTextFilterChange('decision_id', e.target.value || undefined)}
            />
          </div>

          <div>
            <label htmlFor="audit-filter-trace-ref" className="text-xs text-tertiary mb-1 block">{t('filters.trace_ref')}</label>
            <Input
              id="audit-filter-trace-ref"
              placeholder={commonT('filter_by_trace_ref')}
              value={filters.trace_ref || ''}
              onChange={(e) => handleTextFilterChange('trace_ref', e.target.value || undefined)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
