'use client';

import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { createColumnHelper } from '@tanstack/react-table';
import { File, Plus } from 'lucide-react';
import { useMemo } from 'react';

const columnHelper = createColumnHelper<any>();

const sourceColumns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => {
      const source = info.row.original;
      return (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-surface-high flex items-center justify-center">
            <File className="w-4 h-4 text-foreground-secondary" />
          </div>
          <div>
            <span className="text-foreground block">{source.name}</span>
            <span className="text-foreground-muted text-xs">{source.type}</span>
          </div>
        </div>
      );
    },
  }),
  columnHelper.accessor('size', {
    header: 'Size',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm font-mono">
        {formatBytes(info.getValue())}
      </span>
    ),
  }),
  columnHelper.accessor('uploadedAt', {
    header: 'Uploaded',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm">
        {new Date(info.getValue()).toLocaleDateString()}
      </span>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue() || 'active'} />,
  }),
];

export default function SourcesPage() {
  const sources = useMemo(() => [], []);

  const table = useMemo(() => {
    return {
      ...createTable({
        data: sources,
        columns: sourceColumns,
      }),
      getHeaderGroups: () => [],
      getRowModel: () => ({ rows: [] }),
    };
  }, [sources]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Sources</h1>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium"
                style={{ background: 'var(--color-gemini-product-gradient)', borderRadius: 'var(--radius-sm)' }}>
          <Plus className="w-4 h-4" />
          Add Source
        </button>
      </div>
      <DataTable table={table} />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function createTable(options: any) {
  return options;
}
