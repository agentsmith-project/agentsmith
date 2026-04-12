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
    <PageToolbar className="rounded-md border border-subtle bg-surface-low p-3 shadow-ambient">
      <div className="mr-1 rounded-full border border-subtle bg-black/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
        {endpointsCount} {t('title').toLowerCase()}
      </div>
      <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
        {activeCount} {t('status_active').toLowerCase()}
      </div>
      <div className="rounded-full border border-subtle bg-surface-low px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
        {disabledCount} {t('status_disabled').toLowerCase()}
      </div>
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
    </PageToolbar>
  );
}
