'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AuditFilters } from './AuditFilters';
import { AuditTable } from './AuditTable';
import { AuditDetailDrawer } from './AuditDetailDrawer';
import { useAuditEvents } from '@/lib/hooks/use-audit-usage';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { toast } from '@/components/ui/toast';
import type { AuditEvent, AuditListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';

export interface AuditPageProps {
  workspaceId: string;
  projectId: string;
  defaultEndUserId?: string; // For project-user permission
}

function getDefaultTimeRange() {
  return {
    start_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date().toISOString(),
  };
}

export function AuditPage({ workspaceId, projectId, defaultEndUserId }: AuditPageProps) {
  const t = useTranslations('audit');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const canReadAudit = useHasPermission('project:audit:read');

  const [filters, setFilters] = React.useState<AuditListParams>(() => ({
    ...getDefaultTimeRange(),
    page: 1,
    page_size: 25,
    sort_by: 'timestamp',
    sort_order: 'desc',
    ...(defaultEndUserId && { end_user_id: defaultEndUserId }),
  }));
  const [selectedEvent, setSelectedEvent] = React.useState<AuditEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const { data, isLoading, error } = useAuditEvents(workspaceId, projectId, filters, {
    enabled: canReadAudit,
  });

  if (!canReadAudit) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-6">
        <div className="rounded-xl border border-border bg-surface p-8 text-center max-w-md">
          <p className="text-sm text-tertiary">{t('permission_denied')}</p>
        </div>
      </div>
    );
  }

  const handleRefresh = () => {
    queryClient.invalidateQueries({
      queryKey: ['audit', workspaceId, projectId],
    });
    toast.success(commonT('refreshed_data') || 'Refreshed audit events');
  };

  const handleViewDetails = (event: AuditEvent) => {
    setSelectedEvent(event);
    setDrawerOpen(true);
  };

  const handleClearFilters = () => {
    setFilters({
      ...getDefaultTimeRange(),
      page: 1,
      page_size: 25,
      sort_by: 'timestamp',
      sort_order: 'desc',
      ...(defaultEndUserId && { end_user_id: defaultEndUserId }),
    });
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-error/10 border border-error/30 rounded-md p-4">
          <p className="text-error">
            Failed to load audit events: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="p-6 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-tertiary mt-1">{t('subtitle')}</p>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          {commonT('refresh')}
        </Button>
      </div>

      {/* Filters */}
      <div className="p-6" data-testid="audit__filters">
        <AuditFilters
          filters={filters}
          onChange={setFilters}
          onClear={handleClearFilters}
          defaultEndUserId={defaultEndUserId}
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <AuditTable
          data={data?.items || []}
          loading={isLoading}
          onViewDetails={handleViewDetails}
          onClearFilters={handleClearFilters}
        />
      </div>

      {/* Detail Drawer */}
      <AuditDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        event={selectedEvent}
      />
    </div>
  );
}
