'use client';
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
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
import { ErrorState } from '@/components/ui/error-state';
import type { AuditEvent, AuditListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { parseGovernanceDrilldownContext } from '@/lib/governance-drilldown-context';
import { GovernanceDrilldownBanner } from '@/components/ui/GovernanceDrilldownBanner';

export interface AuditPageProps {
  workspaceId: string;
  projectId: string;
  defaultEndUserId?: string;
  locale?: string;
}

function getDefaultTimeRange() {
  return {
    start_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date().toISOString(),
  };
}

function asValidIsoTimestamp(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function asPositiveInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function buildAuditFiltersFromSearchParams(
  searchParams: URLSearchParams,
  defaultEndUserId?: string,
): AuditListParams {
  const defaults = getDefaultTimeRange();
  const actorTypeRaw = searchParams.get('actor_type');
  const resultRaw = searchParams.get('result');
  const sortByRaw = searchParams.get('sort_by');
  const sortOrderRaw = searchParams.get('sort_order');
  const actorType =
    actorTypeRaw === 'user' || actorTypeRaw === 'agent' || actorTypeRaw === 'plugin'
      ? actorTypeRaw
      : undefined;
  const result = resultRaw === 'ok' || resultRaw === 'error' ? resultRaw : undefined;
  const sortBy = sortByRaw === 'timestamp' ? sortByRaw : 'timestamp';
  const sortOrder = sortOrderRaw === 'asc' || sortOrderRaw === 'desc' ? sortOrderRaw : 'desc';
  return {
    start_time: asValidIsoTimestamp(searchParams.get('start_time')) ?? defaults.start_time,
    end_time: asValidIsoTimestamp(searchParams.get('end_time')) ?? defaults.end_time,
    action: searchParams.get('action') ?? undefined,
    actor_type: actorType,
    actor_id: searchParams.get('actor_id') ?? undefined,
    end_user_id: searchParams.get('end_user_id') ?? defaultEndUserId,
    resource_type: searchParams.get('resource_type') ?? undefined,
    resource_id: searchParams.get('resource_id') ?? undefined,
    result,
    page: asPositiveInt(searchParams.get('page')) ?? 1,
    page_size: asPositiveInt(searchParams.get('page_size')) ?? 25,
    sort_by: sortBy,
    sort_order: sortOrder,
  };
}

export function AuditPage({ workspaceId, projectId, defaultEndUserId, locale = 'en-US' }: AuditPageProps) {
  const t = useTranslations('audit');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const canReadAudit = useHasPermission('project:audit:view');
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  const searchParams = useSearchParams();
  const drilldownContext = React.useMemo(() => parseGovernanceDrilldownContext(searchParams), [searchParams]);
  const searchParamsKey = searchParams.toString();

  const [filters, setFilters] = React.useState<AuditListParams>(() =>
    buildAuditFiltersFromSearchParams(searchParams, defaultEndUserId),
  );
  const [selectedEvent, setSelectedEvent] = React.useState<AuditEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const { data, isLoading, error } = useAuditEvents(workspaceId, projectId, filters, {
    enabled: canReadAudit,
  });

  React.useEffect(() => {
    setFilters(buildAuditFiltersFromSearchParams(searchParams, defaultEndUserId));
  }, [defaultEndUserId, searchParams, searchParamsKey]);

  if (!canReadAudit) {
    return (
      <PageLayout
        header={(
          <PageHeader
            title={t('title')}
            subtitle={t('subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${basePath}/members`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-members"
                >
                  {t('open_members')}
                </Link>
                <Link
                  href={`${basePath}/resource-policy`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-resource-policy"
                >
                  {t('open_resource_policy')}
                </Link>
                <Link
                  href={`${basePath}/usage`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-usage"
                >
                  {t('open_usage')}
                </Link>
              </div>
            )}
          />
        )}
      >
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
    const defaults = getDefaultTimeRange();
    setFilters({
      start_time: defaults.start_time,
      end_time: defaults.end_time,
      page: 1,
      page_size: 25,
      sort_by: 'timestamp',
      sort_order: 'desc',
      ...(defaultEndUserId && { end_user_id: defaultEndUserId }),
    });
  };

  const currentPage = data?.page ?? filters.page ?? 1;
  const pageSize = data?.page_size ?? filters.page_size ?? 25;
  const totalItems = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const canGoPrev = currentPage > 1;
  const canGoNext = !!data?.has_more || currentPage < totalPages;

  if (error) {
    return (
      <PageLayout
        header={(
          <PageHeader
            title={t('title')}
            subtitle={t('subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${basePath}/members`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-members"
                >
                  {t('open_members')}
                </Link>
                <Link
                  href={`${basePath}/resource-policy`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-resource-policy"
                >
                  {t('open_resource_policy')}
                </Link>
                <Link
                  href={`${basePath}/usage`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-usage"
                >
                  {t('open_usage')}
                </Link>
              </div>
            )}
          />
        )}
      >
        <ErrorState
          title={commonT('something_went_wrong')}
          message={t('load_failed_with_reason', {
            reason: error instanceof Error ? error.message : commonT('unknown_error'),
          })}
          onRetry={handleRefresh}
          retryLabel={commonT('retry')}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={(
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`${basePath}/members`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                data-testid="audit__open-members"
              >
                {t('open_members')}
              </Link>
              <Link
                href={`${basePath}/resource-policy`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                data-testid="audit__open-resource-policy"
              >
                {t('open_resource_policy')}
              </Link>
              <Link
                href={`${basePath}/usage`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                data-testid="audit__open-usage"
              >
                {t('open_usage')}
              </Link>
            </div>
          )}
        />
      )}
      toolbar={(
        <PageToolbar>
          <Button variant="outline" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {commonT('refresh')}
          </Button>
        </PageToolbar>
      )}
    >
      {drilldownContext ? (
        <GovernanceDrilldownBanner context={drilldownContext} locale={locale} />
      ) : null}
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
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-tertiary">
            {commonT('page_of', { page: String(currentPage), total: String(totalPages) })} ·
            {' '}
            {commonT('total_items', { count: String(totalItems) })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoPrev || isLoading}
              onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, (prev.page ?? 1) - 1) }))}
            >
              {commonT('previous')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoNext || isLoading}
              onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }))}
            >
              {commonT('next')}
            </Button>
          </div>
        </div>
      </div>

      <AuditDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        event={selectedEvent}
        basePath={basePath}
      />
    </PageLayout>
  );
}
