'use client';

import { Key, Trash2 } from 'lucide-react';

import type { AgentRunnerServiceKey } from '@/lib/api/types';
import { Button } from '@/components/ui/button';

import { formatRelativeTime } from './utils';

interface KeysListSectionProps {
  activeKeys: AgentRunnerServiceKey[];
  emptyLabel: string;
  isLoading: boolean;
  loadingLabel: string;
  sectionTitle: string;
  showRevoke: boolean;
  revokeDisabled: boolean;
  onRevoke: (keyId: string) => void;
}

export function KeysListSection({
  activeKeys,
  emptyLabel,
  isLoading,
  loadingLabel,
  sectionTitle,
  showRevoke,
  revokeDisabled,
  onRevoke,
}: KeysListSectionProps) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-high/20 p-4" data-testid="agent-runners__connection-keys-list">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-primary">
          <span>{sectionTitle}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="text-tertiary py-8 text-center">{loadingLabel}</div>
      ) : activeKeys.length === 0 ? (
        <div className="py-8 text-center border border-border rounded-md bg-surface">
          <Key className="w-10 h-10 text-tertiary mx-auto mb-2" />
          <p className="text-secondary text-sm">{emptyLabel}</p>
        </div>
      ) : (
        <div
          className="w-full max-w-full space-y-2 max-h-64 overflow-y-auto pr-1"
          data-testid="agent-runners__connection-keys-active-list"
        >
          {activeKeys.map((key) => (
            <AgentRunnerKeyRow
              key={key.id}
              item={key}
              showRevoke={showRevoke}
              revokeDisabled={revokeDisabled}
              onRevoke={() => onRevoke(key.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentRunnerKeyRow({
  item,
  showRevoke,
  revokeDisabled,
  onRevoke,
}: {
  item: AgentRunnerServiceKey;
  showRevoke: boolean;
  revokeDisabled: boolean;
  onRevoke: () => void;
}) {
  return (
    <div
      className="flex w-full max-w-full items-center justify-between overflow-hidden rounded-md border border-subtle bg-surface px-3 py-2.5 transition-colors hover:bg-hover"
      data-testid={`agent-runners__connection-keys-row--${item.id}`}
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
        {showRevoke ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-error hover:text-error"
            onClick={onRevoke}
            disabled={revokeDisabled}
            data-testid={`agent-runners__connection-keys-revoke--${item.id}`}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
