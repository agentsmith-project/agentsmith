'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AuditListParams } from '@/lib/api/types';
import { cn } from '@/lib/utils';

import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_RESOURCE_TYPE_OPTIONS,
  formatFilterToken,
} from './filter-options';
import { TimeRangePicker, type TimeRange } from './TimeRangePicker';

export type AuditEventCategoryFilter = 'all' | 'change' | 'event' | 'anomaly';

export interface AuditFiltersProps {
  filters: AuditListParams;
  onChange: (filters: AuditListParams) => void;
  onClear: () => void;
  className?: string;
  compact?: boolean;
  defaultEndUserId?: string;
  categoryFilter?: AuditEventCategoryFilter;
  onCategoryFilterChange?: (category: AuditEventCategoryFilter) => void;
}

type ActiveFilterToken = {
  key: string;
  label: string;
  value: string;
};

function hasLockedEndUserContext(filters: AuditListParams, defaultEndUserId?: string): boolean {
  return Boolean(defaultEndUserId && filters.end_user_id === defaultEndUserId);
}

function hasAdvancedQueryFilters(filters: AuditListParams, defaultEndUserId?: string): boolean {
  return Boolean(
    filters.action
    || filters.actor_type
    || filters.actor_id
    || (filters.end_user_id && !hasLockedEndUserContext(filters, defaultEndUserId))
    || filters.request_id
    || filters.decision_id
    || filters.trace_ref
    || filters.trace_incident_id
    || filters.trace_escalation_id
    || filters.trace_run_id,
  );
}

function getActorTypeLabel(actorType: NonNullable<AuditListParams['actor_type']>, commonT: ReturnType<typeof useTranslations>) {
  if (actorType === 'user') return commonT('user');
  if (actorType === 'runner') return commonT('runner');
  if (actorType === 'plugin') return commonT('plugin');
  return formatFilterToken(actorType);
}

function buildActiveFilterTokens(
  filters: AuditListParams,
  defaultEndUserId: string | undefined,
  t: ReturnType<typeof useTranslations>,
  commonT: ReturnType<typeof useTranslations>,
): ActiveFilterToken[] {
  const tokens: ActiveFilterToken[] = [];

  if (filters.action) {
    tokens.push({
      key: 'action',
      label: t('filters.action'),
      value: formatFilterToken(filters.action),
    });
  }

  if (filters.actor_type) {
    tokens.push({
      key: 'actor_type',
      label: t('filters.actor_type'),
      value: getActorTypeLabel(filters.actor_type, commonT),
    });
  }

  if (filters.actor_id) {
    tokens.push({
      key: 'actor_id',
      label: t('filters.actor_id'),
      value: filters.actor_id,
    });
  }

  if (filters.end_user_id && filters.end_user_id !== defaultEndUserId) {
    tokens.push({
      key: 'end_user_id',
      label: t('filters.end_user_id'),
      value: filters.end_user_id,
    });
  }

  if (filters.request_id) {
    tokens.push({
      key: 'request_id',
      label: t('filters.request_id'),
      value: filters.request_id,
    });
  }

  if (filters.decision_id) {
    tokens.push({
      key: 'decision_id',
      label: t('filters.decision_id'),
      value: filters.decision_id,
    });
  }

  if (filters.trace_ref) {
    tokens.push({
      key: 'trace_ref',
      label: t('filters.trace_ref'),
      value: filters.trace_ref,
    });
  }

  if (filters.trace_incident_id) {
    tokens.push({
      key: 'trace_incident_id',
      label: t('filters.trace_incident_id'),
      value: filters.trace_incident_id,
    });
  }

  if (filters.trace_escalation_id) {
    tokens.push({
      key: 'trace_escalation_id',
      label: t('filters.trace_escalation_id'),
      value: filters.trace_escalation_id,
    });
  }

  if (filters.trace_run_id) {
    tokens.push({
      key: 'trace_run_id',
      label: t('filters.trace_run_id'),
      value: filters.trace_run_id,
    });
  }

  return tokens;
}

export function AuditFilters({
  filters,
  onChange,
  onClear,
  className,
  compact = false,
  defaultEndUserId,
  categoryFilter = 'all',
  onCategoryFilterChange,
}: AuditFiltersProps) {
  const t = useTranslations('audit');
  const commonT = useTranslations('common');
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [advancedExpanded, setAdvancedExpanded] = React.useState(() =>
    hasAdvancedQueryFilters(filters, defaultEndUserId),
  );
  const filtersRef = React.useRef(filters);
  filtersRef.current = filters;

  const hasAdvancedFilters = React.useMemo(
    () => hasAdvancedQueryFilters(filters, defaultEndUserId),
    [defaultEndUserId, filters],
  );

  const activeTokens = React.useMemo(
    () => buildActiveFilterTokens(filters, defaultEndUserId, t, commonT),
    [commonT, defaultEndUserId, filters, t],
  );

  const hasActiveFilters = React.useMemo(() => {
    return Boolean(
      filters.resource_type
      || filters.resource_id
      || filters.result
      || categoryFilter !== 'all'
      || activeTokens.length > 0,
    );
  }, [activeTokens.length, categoryFilter, filters.resource_id, filters.resource_type, filters.result]);

  const handleTimeRangeChange = (range: TimeRange) => {
    onChange({
      ...filtersRef.current,
      start_time: range.start_time,
      end_time: range.end_time,
    });
  };

  const handleSelectFilterChange = (key: keyof AuditListParams, value: string | undefined) => {
    onChange({
      ...filtersRef.current,
      [key]: value || undefined,
    });
  };

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

  React.useEffect(() => {
    if (hasAdvancedFilters) {
      setAdvancedExpanded(true);
    }
  }, [hasAdvancedFilters]);

  return (
    <div
      className={cn(
        compact ? 'space-y-3' : 'rounded-md border border-border bg-surface p-4 space-y-4',
        className,
      )}
      data-testid="audit-filters__surface"
    >
      {!compact ? (
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{commonT('filters')}</h3>
          <div className="flex items-center gap-2" data-testid="audit-filters__actions">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAdvancedExpanded((value) => !value)}
              data-testid="audit-filters__toggle-advanced"
            >
              {advancedExpanded ? commonT('collapse') : commonT('expand')}
            </Button>
            {hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={onClear}>
                <X className="mr-2 h-4 w-4" />
                {commonT('clear_filters')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-end gap-3" data-testid="audit-filters__primary-controls">
              <div className={compact ? 'min-w-[240px] flex-[1.3]' : 'min-w-[260px] flex-[1.4]'}>
                <TimeRangePicker
                  value={{
                    start_time: filters.start_time,
                    end_time: filters.end_time,
                  }}
                  onChange={handleTimeRangeChange}
                  presets={['last_24h', 'custom']}
                  maxDays={2}
                  showResolvedRangeLabel={!compact}
                  className="w-full"
                />
              </div>

              <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                <label htmlFor="audit-filter-category" className="mb-1 block text-xs text-tertiary">
                  {t('filters.category')}
                </label>
                <Select
                  value={categoryFilter}
                  onValueChange={(value) => onCategoryFilterChange?.(value as AuditEventCategoryFilter)}
                >
                  <SelectTrigger id="audit-filter-category" data-testid="audit-filter-category">
                    <SelectValue placeholder={commonT('all')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{commonT('all')}</SelectItem>
                    <SelectItem value="change">{t('category.change')}</SelectItem>
                    <SelectItem value="event">{t('category.event')}</SelectItem>
                    <SelectItem value="anomaly">{t('category.anomaly')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                <label htmlFor="audit-filter-resource-type" className="mb-1 block text-xs text-tertiary">
                  {t('filters.resource_type')}
                </label>
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

              <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                <label htmlFor="audit-filter-resource-id" className="mb-1 block text-xs text-tertiary">
                  {t('filters.resource_id')}
                </label>
                <Input
                  id="audit-filter-resource-id"
                  placeholder={commonT('filter_by_resource_id')}
                  value={filters.resource_id || ''}
                  onChange={(event) => handleTextFilterChange('resource_id', event.target.value || undefined)}
                />
              </div>

              <div className={compact ? 'min-w-[160px] flex-[0.8]' : 'min-w-[160px] flex-[0.8]'}>
                <label htmlFor="audit-filter-result" className="mb-1 block text-xs text-tertiary">
                  {t('filters.result')}
                </label>
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
            </div>
          </div>

          {compact ? (
            <div className="flex flex-wrap items-center gap-2 xl:justify-end" data-testid="audit-filters__actions">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAdvancedExpanded((value) => !value)}
                data-testid="audit-filters__toggle-advanced"
              >
                {advancedExpanded ? commonT('collapse') : commonT('expand')}
              </Button>
              {hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={onClear}>
                  <X className="mr-2 h-4 w-4" />
                  {commonT('clear_filters')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {activeTokens.length > 0 ? (
          <div className="flex flex-wrap gap-2" data-testid="audit-filters__active-tokens">
            {activeTokens.map((token) => (
              <Badge key={token.key} variant="outline">
                <span className="text-xs text-tertiary">{token.label}:</span>
                <code className="text-xs text-foreground">{token.value}</code>
              </Badge>
            ))}
          </div>
        ) : null}

        {advancedExpanded ? (
          <div
            className={cn(
              compact ? 'space-y-3 border-t border-subtle/70 pt-3' : 'space-y-4 border-t border-subtle/70 pt-4',
            )}
            data-testid="audit-filters__advanced"
          >
            <div className="flex flex-wrap items-end gap-3" data-testid="audit-filters__advanced-controls">
              <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                <label htmlFor="audit-filter-action" className="mb-1 block text-xs text-tertiary">
                  {t('filters.action')}
                </label>
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

              <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                <label htmlFor="audit-filter-actor-type" className="mb-1 block text-xs text-tertiary">
                  {t('filters.actor_type')}
                </label>
                <Select
                  value={filters.actor_type || 'all'}
                  onValueChange={(value) => handleSelectFilterChange(
                    'actor_type',
                    value === 'all' ? undefined : value as 'user' | 'runner' | 'plugin',
                  )}
                >
                  <SelectTrigger id="audit-filter-actor-type">
                    <SelectValue placeholder={commonT('all_types')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{commonT('all')}</SelectItem>
                    <SelectItem value="user">{commonT('user')}</SelectItem>
                    <SelectItem value="runner">{commonT('runner')}</SelectItem>
                    <SelectItem value="plugin">{commonT('plugin')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                <label htmlFor="audit-filter-actor-id" className="mb-1 block text-xs text-tertiary">
                  {t('filters.actor_id')}
                </label>
                <Input
                  id="audit-filter-actor-id"
                  placeholder={commonT('filter_by_actor_id')}
                  value={filters.actor_id || ''}
                  onChange={(event) => handleTextFilterChange('actor_id', event.target.value || undefined)}
                />
              </div>

              <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                <label htmlFor="audit-filter-end-user-id" className="mb-1 block text-xs text-tertiary">
                  {t('filters.end_user_id')}
                </label>
                <Input
                  id="audit-filter-end-user-id"
                  placeholder={commonT('filter_by_end_user_id')}
                  value={filters.end_user_id || defaultEndUserId || ''}
                  onChange={(event) => handleTextFilterChange('end_user_id', event.target.value || defaultEndUserId || undefined)}
                  disabled={Boolean(defaultEndUserId)}
                />
              </div>
            </div>

            <div
              className={compact ? 'space-y-3 border-t border-subtle/70 pt-3' : 'space-y-3 border-t border-subtle/70 pt-4'}
              data-testid="audit-filters__investigation"
            >
              <h4 className="text-xs font-semibold text-foreground">{t('filters.investigation_group')}</h4>
              <div className="flex flex-wrap items-end gap-3" data-testid="audit-filters__investigation-controls">
                <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                  <label htmlFor="audit-filter-request-id" className="mb-1 block text-xs text-tertiary">
                    {t('filters.request_id')}
                  </label>
                  <Input
                    id="audit-filter-request-id"
                    placeholder={commonT('filter_by_request_id')}
                    value={filters.request_id || ''}
                    onChange={(event) => handleTextFilterChange('request_id', event.target.value || undefined)}
                  />
                </div>

                <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                  <label htmlFor="audit-filter-decision-id" className="mb-1 block text-xs text-tertiary">
                    {t('filters.decision_id')}
                  </label>
                  <Input
                    id="audit-filter-decision-id"
                    placeholder={commonT('filter_by_decision_id')}
                    value={filters.decision_id || ''}
                    onChange={(event) => handleTextFilterChange('decision_id', event.target.value || undefined)}
                  />
                </div>

                <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                  <label htmlFor="audit-filter-trace-ref" className="mb-1 block text-xs text-tertiary">
                    {t('filters.trace_ref')}
                  </label>
                  <Input
                    id="audit-filter-trace-ref"
                    placeholder={commonT('filter_by_trace_ref')}
                    value={filters.trace_ref || ''}
                    onChange={(event) => handleTextFilterChange('trace_ref', event.target.value || undefined)}
                  />
                </div>

                <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                  <label htmlFor="audit-filter-trace-incident-id" className="mb-1 block text-xs text-tertiary">
                    {t('filters.trace_incident_id')}
                  </label>
                  <Input
                    id="audit-filter-trace-incident-id"
                    placeholder={commonT('filter_by_trace_incident_id')}
                    value={filters.trace_incident_id || ''}
                    onChange={(event) => handleTextFilterChange('trace_incident_id', event.target.value || undefined)}
                  />
                </div>

                <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                  <label htmlFor="audit-filter-trace-escalation-id" className="mb-1 block text-xs text-tertiary">
                    {t('filters.trace_escalation_id')}
                  </label>
                  <Input
                    id="audit-filter-trace-escalation-id"
                    placeholder={commonT('filter_by_trace_escalation_id')}
                    value={filters.trace_escalation_id || ''}
                    onChange={(event) => handleTextFilterChange('trace_escalation_id', event.target.value || undefined)}
                  />
                </div>

                <div className={compact ? 'min-w-[180px] flex-1' : 'min-w-[180px] flex-1'}>
                  <label htmlFor="audit-filter-trace-run-id" className="mb-1 block text-xs text-tertiary">
                    {t('filters.trace_run_id')}
                  </label>
                  <Input
                    id="audit-filter-trace-run-id"
                    placeholder={commonT('filter_by_trace_run_id')}
                    value={filters.trace_run_id || ''}
                    onChange={(event) => handleTextFilterChange('trace_run_id', event.target.value || undefined)}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
