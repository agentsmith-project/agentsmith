'use client';

import * as React from 'react';
import { Calendar, Filter } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface DashboardFiltersProps {
  filters: {
    granularity?: 'day' | 'week' | 'month';
    resource_type?: string;
    resource_id?: string;
    end_user_id?: string;
    start_time: string;
    end_time: string;
  };
  onChange: (filters: Partial<DashboardFiltersProps['filters']>) => void;
  onClear: () => void;
}

export function DashboardFilters({ filters, onChange, onClear }: DashboardFiltersProps) {
  const t = useTranslations('dashboard');

  const hasActiveFilters = filters.resource_type || filters.resource_id || filters.end_user_id;

  return (
    <div className="bg-surface border border-border rounded-xl p-4" data-testid="dashboard-filters">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-tertiary" />
          <h3 className="text-sm font-medium text-foreground">{t('filters')}</h3>
        </div>
        {hasActiveFilters && (
          <button
            onClick={onClear}
            className="text-xs text-accent hover:underline"
          >
            {t('clear_filters')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Granularity Selector */}
        <div>
          <label className="block text-xs text-tertiary mb-1">{t('granularity')}</label>
          <select
            value={filters.granularity}
            onChange={(e) => onChange({ granularity: e.target.value as 'day' | 'week' | 'month' })}
            className="w-full px-3 py-2 bg-surface-high border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="day">{t('granularity_day')}</option>
            <option value="week">{t('granularity_week')}</option>
            <option value="month">{t('granularity_month')}</option>
          </select>
        </div>

        {/* Resource Type Filter */}
        <div>
          <label className="block text-xs text-tertiary mb-1">{t('resource_type')}</label>
          <select
            value={filters.resource_type || ''}
            onChange={(e) => onChange({ resource_type: e.target.value || undefined })}
            className="w-full px-3 py-2 bg-surface-high border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">{t('all_types')}</option>
            <option value="endpoint">{t('type_endpoint')}</option>
            <option value="agent">{t('type_agent')}</option>
            <option value="source_library">{t('type_source_library')}</option>
          </select>
        </div>

        {/* Resource ID Filter */}
        <div>
          <label className="block text-xs text-tertiary mb-1">{t('resource_id')}</label>
          <input
            type="text"
            value={filters.resource_id || ''}
            onChange={(e) => onChange({ resource_id: e.target.value || undefined })}
            placeholder={t('filter_by_resource_id')}
            className="w-full px-3 py-2 bg-surface-high border border-border rounded-lg text-sm text-foreground placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      {/* Date Range Display */}
      <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 text-xs text-tertiary">
        <Calendar className="h-3 w-3" />
        <span>
          {new Date(filters.start_time).toLocaleDateString()} - {new Date(filters.end_time).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}
