'use client';
import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TimeRangePicker, type TimeRange } from './TimeRangePicker';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import type { AuditListParams } from '@/lib/api/types';

export interface AuditFiltersProps {
  filters: AuditListParams;
  onChange: (filters: AuditListParams) => void;
  onClear: () => void;
  className?: string;
  defaultEndUserId?: string; // For project-user permission
}

const ACTIONS = [
  'project.create',
  'project.update',
  'project.delete',
  'member.add',
  'member.remove',
  'chat.session.create',
  'chat.message.create',
  'recipe.create',
  'recipe.update',
  'agent.thread.create',
  'source.file.upload',
  'endpoint.invoke',
  'key.create',
  'key.revoke',
];

const RESOURCE_TYPES = [
  'chat_session',
  'chat_message',
  'recipe',
  'agent_thread',
  'endpoint',
  'source_file',
  'key',
  'project',
  'member',
];

export function AuditFilters({
  filters,
  onChange,
  onClear,
  className,
  defaultEndUserId,
}: AuditFiltersProps) {
  const [debounceTimer, setDebounceTimer] = React.useState<NodeJS.Timeout | null>(null);

  const handleTimeRangeChange = (range: TimeRange) => {
    onChange({
      ...filters,
      start_time: range.start_time,
      end_time: range.end_time,
    });
  };

  const handleFilterChange = (key: keyof AuditListParams, value: string | undefined) => {
    // Clear existing debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Set new debounce timer
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
    return !!(
      filters.action ||
      filters.actor_type ||
      filters.actor_id ||
      filters.end_user_id ||
      filters.resource_type ||
      filters.resource_id ||
      filters.result
    );
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
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-tertiary mb-1 block">Action</label>
            <Select
              value={filters.action || 'all'}
              onValueChange={(value) => handleFilterChange('action', value === 'all' ? undefined : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {ACTIONS.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs text-tertiary mb-1 block">Actor Type</label>
            <Select
              value={filters.actor_type || 'all'}
              onValueChange={(value) => handleFilterChange('actor_type', value === 'all' ? undefined : value as 'user' | 'agent' | 'plugin')}
            >
              <SelectTrigger>
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="plugin">Plugin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs text-tertiary mb-1 block">Actor ID</label>
            <Input
              placeholder="Filter by actor ID..."
              value={filters.actor_id || ''}
              onChange={(e) => handleFilterChange('actor_id', e.target.value || undefined)}
            />
          </div>

          <div>
            <label className="text-xs text-tertiary mb-1 block">End User ID</label>
            <Input
              placeholder="Filter by end user ID..."
              value={filters.end_user_id || defaultEndUserId || ''}
              onChange={(e) => handleFilterChange('end_user_id', e.target.value || defaultEndUserId || undefined)}
              disabled={!!defaultEndUserId} // Lock for project-user
            />
          </div>

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
            <label className="text-xs text-tertiary mb-1 block">Resource ID</label>
            <Input
              placeholder="Filter by resource ID..."
              value={filters.resource_id || ''}
              onChange={(e) => handleFilterChange('resource_id', e.target.value || undefined)}
            />
          </div>

          <div>
            <label className="text-xs text-tertiary mb-1 block">Result</label>
            <Select
              value={filters.result || 'all'}
              onValueChange={(value) => handleFilterChange('result', value === 'all' ? undefined : value as 'ok' | 'error')}
            >
              <SelectTrigger>
                <SelectValue placeholder="All results" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ok">Success</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
