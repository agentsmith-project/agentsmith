'use client';

import { Download, Plus, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageToolbar } from '@/components/layout/PageToolbar';

interface EndpointsToolbarProps {
  canManageEndpoints: boolean;
  canReadEndpoints: boolean;
  endpointsCount: number;
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
  syncPending,
  t,
  onCreate,
  onExport,
  onImport,
  onSyncCatalog,
}: EndpointsToolbarProps) {
  return (
    <PageToolbar>
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
