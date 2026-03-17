'use client';

import { Key, Plus, Trash2 } from 'lucide-react';

import type { AgentServiceKey } from '@/lib/api/types';
import { Button } from '@/components/ui/button';

import { formatRelativeTime } from './utils';

interface KeysListSectionProps {
  activeKeys: AgentServiceKey[];
  createPending: boolean;
  createLabel: string;
  emptyLabel: string;
  isLoading: boolean;
  sectionTitle: string;
  onCreate: () => void;
  onRevoke: (keyId: string) => void;
}

export function KeysListSection({
  activeKeys,
  createPending,
  createLabel,
  emptyLabel,
  isLoading,
  sectionTitle,
  onCreate,
  onRevoke,
}: KeysListSectionProps) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-high/20 p-4" data-testid="agents__keys__list">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-primary">
          <span>{sectionTitle}</span>
          <span className="rounded-full border border-subtle bg-surface px-2 py-0.5 text-xs text-tertiary">
            {activeKeys.length}
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={onCreate}
          disabled={createPending}
          className="w-full sm:w-auto"
          data-testid="agents__keys__create"
        >
          <Plus className="w-4 h-4" />
          {createLabel}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-tertiary py-8 text-center">Loading...</div>
      ) : activeKeys.length === 0 ? (
        <div className="py-8 text-center border border-border rounded-md bg-surface">
          <Key className="w-10 h-10 text-tertiary mx-auto mb-2" />
          <p className="text-secondary text-sm">{emptyLabel}</p>
        </div>
      ) : (
        <div className="w-full max-w-full space-y-2 max-h-64 overflow-y-auto pr-1">
          {activeKeys.map((key) => (
            <AgentKeyRow
              key={key.id}
              item={key}
              onRevoke={() => onRevoke(key.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentKeyRow({ item, onRevoke }: { item: AgentServiceKey; onRevoke: () => void }) {
  return (
    <div
      className="flex w-full max-w-full items-center justify-between overflow-hidden rounded-md border border-subtle bg-surface px-3 py-2.5 transition-colors hover:bg-hover"
      data-testid={`agents__keys__row--${item.id}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Key className="w-4 h-4 text-icon-default flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <code className="block truncate text-sm font-mono text-primary">{item.key_prefix}</code>
          <span className="text-xs text-tertiary">
            {item.created_at ? formatRelativeTime(new Date(item.created_at)) : '—'}
          </span>
        </div>
      </div>
      <div className="ml-2 flex items-center flex-shrink-0">
        <span className="sr-only">
          {item.created_at ? formatRelativeTime(new Date(item.created_at)) : '—'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-error hover:text-error"
          onClick={onRevoke}
          data-testid={`agents__keys__revoke--${item.id}`}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
