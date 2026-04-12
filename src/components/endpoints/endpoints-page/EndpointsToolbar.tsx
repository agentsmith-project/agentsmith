'use client';

import { Download, Plus, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageToolbar } from '@/components/layout/PageToolbar';

interface EndpointsToolbarProps {
  canManageEndpoints: boolean;
  canReadEndpoints: boolean;
  endpointsCount: number;
  activeCount: number;
  disabledCount: number;
  syncPending: boolean;
  t: (key: string) => string;
  onCreate: () => void;
  onExport: () => void;
  onImport: () => void;
  onSyncCatalog: () => void;
}

export function EndpointsToolbar({
  canManageEndpoints,
  canReadEndpoints,
  endpointsCount,
  activeCount,
  disabledCount,
  syncPending,
  t,
  onCreate,
  onExport,
  onImport,
  onSyncCatalog,
}: EndpointsToolbarProps) {
  return (
    <PageToolbar className="w-full items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3" data-testid="endpoints__work-toolbar">
        <div
          className="flex flex-wrap items-center gap-2 text-xs text-tertiary"
          data-testid="endpoints__summary-line"
        >
          <span>
            <span className="text-foreground">{endpointsCount}</span> {t('title').toLowerCase()}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <span className="text-foreground">{activeCount}</span> {t('status_active').toLowerCase()}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <span className="text-foreground">{disabledCount}</span> {t('status_disabled').toLowerCase()}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={onImport}
          disabled={!canManageEndpoints}
          data-testid="endpoints__import-btn"
          variant="outline"
        >
          <Upload className="w-4 h-4" />
          {t('import')}
        </Button>
        <Button
          onClick={onExport}
          disabled={!canReadEndpoints || endpointsCount === 0}
          data-testid="endpoints__export-btn"
          variant="outline"
        >
          <Download className="w-4 h-4" />
          {t('export')}
        </Button>
        <Button
          onClick={onSyncCatalog}
          disabled={!canManageEndpoints || syncPending}
          data-testid="endpoints__sync-catalog-btn"
          variant="outline"
        >
          {syncPending ? '...' : null}
          {t('sync_catalog')}
        </Button>
        <Button
          onClick={onCreate}
          disabled={!canManageEndpoints}
          data-testid="endpoints__create-btn"
          variant="action"
        >
          <Plus className="w-4 h-4" />
          {t('create')}
        </Button>
      </div>
    </PageToolbar>
  );
}
