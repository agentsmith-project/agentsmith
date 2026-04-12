'use client';

import { Key } from 'lucide-react';
import type { Table } from '@tanstack/react-table';
import type { Credential } from '@/lib/api/types';
import { DataTable } from '@/components/ui/data-table';
import { PageLoading, EmptyState } from '@/components/ui/loading';

export function CredentialsContent(args: {
  isLoading: boolean;
  credentials?: Credential[];
  canManageCredentials: boolean;
  createLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  onCreate: () => void;
  table: Table<Credential>;
}) {
  const {
    isLoading,
    credentials,
    canManageCredentials,
    createLabel,
    emptyTitle,
    emptyDescription,
    onCreate,
    table,
  } = args;

  if (isLoading) {
    return <PageLoading />;
  }

  if (!credentials || credentials.length === 0) {
    return (
      <div className="rounded-md border border-subtle bg-surface/95 p-6 shadow-card">
        <EmptyState
          icon={Key}
          title={emptyTitle}
          description={emptyDescription}
          action={canManageCredentials ? {
            label: createLabel,
            onClick: onCreate,
          } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="rounded-md border border-subtle bg-surface/95 p-4 shadow-card">
      <DataTable table={table} testId="credentials__table" />
    </div>
  );
}
