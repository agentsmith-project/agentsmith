'use client';

import { Server } from 'lucide-react';
import type { Table } from '@tanstack/react-table';

import type { Endpoint } from '@/lib/api/types';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState, PageLoading } from '@/components/ui/loading';

interface EndpointsContentProps {
  canManageEndpoints: boolean;
  endpoints: Endpoint[];
  endpointsLoading: boolean;
  t: (key: string) => string;
  table: Table<Endpoint>;
  onCreate: () => void;
}

export function EndpointsContent({
  canManageEndpoints,
  endpoints,
  endpointsLoading,
  t,
  table,
  onCreate,
}: EndpointsContentProps) {
  if (endpointsLoading) {
    return <PageLoading />;
  }

  if (endpoints.length === 0) {
    return (
      <EmptyState
        icon={Server}
        title={t('empty.title')}
        description={t('empty.description')}
        action={canManageEndpoints ? {
          label: `Add ${t('title')}`,
          onClick: onCreate,
        } : undefined}
      />
    );
  }

  return <DataTable table={table} testId="endpoints__table" />;
}
