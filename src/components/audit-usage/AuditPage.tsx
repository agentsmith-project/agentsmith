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
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageToolbar } from '@/components/layout/PageToolbar';
import type { AuditEvent, AuditListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';

export interface AuditPageProps {
  workspaceId: string;
  projectId: string;
  defaultEndUserId?: string;
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
  const canReadAudit = useHasPermission('project:audit:view');

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
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="rounded-xl border border-border bg-surface p-8 text-center max-w-md">
            <p className="text-sm text-tertiary">{t('permission_denied')}</p>
          </div>
        </div>
      </PageLayout>
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
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
        <div className="bg-error/10 border border-error/30 rounded-md p-4">
          <p className="text-error">
            Failed to load audit events: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}
      toolbar={(
        <PageToolbar>
          <Button variant="outline" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {commonT('refresh')}
          </Button>
        </PageToolbar>
      )}
    >
      <div data-testid="audit__filters">
        <AuditFilters
          filters={filters}
          onChange={setFilters}
          onClear={handleClearFilters}
          defaultEndUserId={defaultEndUserId}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <AuditTable
          data={data?.items || []}
          loading={isLoading}
          onViewDetails={handleViewDetails}
          onClearFilters={handleClearFilters}
        />
      </div>

      <AuditDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        event={selectedEvent}
      />
    </PageLayout>
  );
}
